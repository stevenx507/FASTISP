import React, { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'

interface DashboardStats {
  currentSpeed?: string
  ping?: string
}

interface DiagnosticsResult {
  ping_gateway_ms?: number
  ping_internet_ms?: number
  packet_loss_pct?: number
}

interface SpeedResults {
  download: number
  upload: number
  ping: number
  jitter: number
  packetLoss: number
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const parseSpeed = (value?: string) => {
  if (!value) return { download: 0, upload: 0 }
  const [downloadRaw, uploadRaw] = value.split('/').map((item) => item.trim())
  const download = Number.parseFloat((downloadRaw || '0').replace(/[^0-9.]/g, ''))
  const upload = Number.parseFloat((uploadRaw || '0').replace(/[^0-9.]/g, ''))
  return {
    download: Number.isFinite(download) ? download : 0,
    upload: Number.isFinite(upload) ? upload : 0,
  }
}

const parsePing = (value?: string) => {
  if (!value) return 0
  const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

const SpeedTestWidget: React.FC = () => {
  const [isTesting, setIsTesting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<SpeedResults>({
    download: 0,
    upload: 0,
    ping: 0,
    jitter: 0,
    packetLoss: 0,
  })

  const startTest = async () => {
    if (isTesting) return

    setIsTesting(true)
    setProgress(0)

    for (const step of [12, 27, 43, 61, 79]) {
      await wait(140)
      setProgress(step)
    }

    try {
      const [statsResponse, diagnosticsResponse] = await Promise.allSettled([
        apiClient.get('/dashboard/stats') as Promise<DashboardStats>,
        apiClient.post('/client/diagnostics/run') as Promise<DiagnosticsResult>,
      ])

      const stats = statsResponse.status === 'fulfilled' ? statsResponse.value : {}
      const diagnostics = diagnosticsResponse.status === 'fulfilled' ? diagnosticsResponse.value : {}

      if (statsResponse.status === 'rejected' && diagnosticsResponse.status === 'rejected') {
        throw new Error('No se pudo obtener telemetria de velocidad')
      }

      const speed = parseSpeed(stats.currentSpeed)
      const pingFromStats = parsePing(stats.ping)
      const pingInternet = Number.isFinite(Number(diagnostics.ping_internet_ms))
        ? Number(diagnostics.ping_internet_ms)
        : pingFromStats
      const pingGateway = Number.isFinite(Number(diagnostics.ping_gateway_ms))
        ? Number(diagnostics.ping_gateway_ms)
        : pingInternet
      const jitter = Math.max(0, Math.abs(pingInternet - pingGateway))
      const packetLoss = Number.isFinite(Number(diagnostics.packet_loss_pct))
        ? Number(diagnostics.packet_loss_pct)
        : 0

      setResults({
        download: Number(speed.download.toFixed(1)),
        upload: Number(speed.upload.toFixed(1)),
        ping: Number(pingInternet.toFixed(1)),
        jitter: Number(jitter.toFixed(1)),
        packetLoss: Number(packetLoss.toFixed(2)),
      })

      if (statsResponse.status === 'rejected' || diagnosticsResponse.status === 'rejected') {
        toast.error('Prueba parcial: algunas metricas no estuvieron disponibles.')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo ejecutar la prueba'
      toast.error(msg)
      setResults({
        download: 0,
        upload: 0,
        ping: 0,
        jitter: 0,
        packetLoss: 0,
      })
    } finally {
      setProgress(100)
      setIsTesting(false)
    }
  }

  return (
    <div className="text-center">
      <div className="relative mb-6 inline-block">
        <div className="relative h-32 w-32">
          <svg className="h-full w-full -rotate-90 transform">
            <circle cx="64" cy="64" r="56" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-700" />
            <circle
              cx="64"
              cy="64"
              r="56"
              stroke="currentColor"
              strokeWidth="8"
              fill="transparent"
              strokeDasharray="352"
              strokeDashoffset={352 - (352 * progress) / 100}
              className="text-cyan-400 transition-all duration-300"
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <div>
              <div className="text-2xl font-bold text-white">{progress}%</div>
              <div className="text-sm text-slate-300">{isTesting ? 'Midiendo...' : 'Listo'}</div>
            </div>
          </div>
        </div>
      </div>

      {!isTesting && progress === 0 ? (
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={startTest}
          className="rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 px-8 py-3 font-semibold text-slate-950 transition hover:brightness-110"
        >
          Iniciar prueba
        </motion.button>
      ) : null}

      {!isTesting && progress === 100 ? (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 p-4">
              <div className="text-2xl font-bold text-cyan-100">{results.download.toFixed(1)} Mbps</div>
              <div className="text-sm text-cyan-200">Descarga</div>
            </div>
            <div className="rounded-lg border border-violet-300/25 bg-violet-400/10 p-4">
              <div className="text-2xl font-bold text-violet-100">{results.upload.toFixed(1)} Mbps</div>
              <div className="text-sm text-violet-200">Subida</div>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-3">
            <div>
              <span className="text-slate-300">Ping:</span>
              <span className="ml-2 font-semibold text-white">{results.ping.toFixed(1)} ms</span>
            </div>
            <div>
              <span className="text-slate-300">Jitter:</span>
              <span className="ml-2 font-semibold text-white">{results.jitter.toFixed(1)} ms</span>
            </div>
            <div>
              <span className="text-slate-300">Perdida:</span>
              <span className="ml-2 font-semibold text-white">{results.packetLoss.toFixed(2)}%</span>
            </div>
          </div>
          <button onClick={startTest} className="mt-4 text-sm font-medium text-cyan-300 hover:text-cyan-200">
            Ejecutar de nuevo
          </button>
        </motion.div>
      ) : null}

      {isTesting ? (
        <div className="mt-4">
          <div className="flex justify-center space-x-3">
            {['Telemetria', 'Ping', 'Throughput'].map((text, i) => (
              <div key={text} className="flex items-center space-x-1 text-sm text-slate-300">
                <span className={`h-2 w-2 rounded-full ${progress > i * 30 ? 'bg-green-500' : 'bg-gray-300'}`} />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default SpeedTestWidget
