import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { apiClient } from '../lib/apiClient'
import config from '../lib/config'
import { useAuthStore } from '../store/authStore'
import { ArrowDownTrayIcon, ArrowPathIcon } from '@heroicons/react/24/outline'

type BackupFile = { name: string; size: number; modified: string }
type VerifyItem = { name: string; valid: boolean; issues?: string[]; sha256?: string }
type VerifyResponse = { valid: boolean; count: number; items: VerifyItem[] }
type PruneResponse = { success: boolean; prune: { removed: number; retention_days: number } }

const BackupsView: React.FC = () => {
  const [items, setItems] = useState<BackupFile[]>([])
  const [verificationByName, setVerificationByName] = useState<Record<string, VerifyItem>>({})
  const [loading, setLoading] = useState(false)
  const [verifyingName, setVerifyingName] = useState<string | null>(null)
  const [pruning, setPruning] = useState(false)
  const [retentionDays, setRetentionDays] = useState<number>(14)
  const token = useAuthStore((state) => state.token)

  const apiBase = config.API_BASE_URL.endsWith('/')
    ? config.API_BASE_URL.slice(0, -1)
    : config.API_BASE_URL

  const buildApiUrl = (endpoint: string) => {
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint
    const normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return `${apiBase}${normalized}`
  }

  const load = async () => {
    setLoading(true)
    try {
      const resp = await apiClient.get('/admin/backups/list') as { items?: BackupFile[]; retention_days?: number }
      const loadedItems = resp.items || []
      setItems(loadedItems)
      setRetentionDays(Number(resp.retention_days || 14))
      setVerificationByName((prev) => {
        const next: Record<string, VerifyItem> = {}
        loadedItems.forEach((item) => {
          if (prev[item.name]) next[item.name] = prev[item.name]
        })
        return next
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudieron cargar los backups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const triggerDb = async () => {
    try {
      const response = await apiClient.post('/admin/backups/db') as { filename?: string; prune?: { removed?: number } }
      const removed = Number(response?.prune?.removed || 0)
      toast.success(removed > 0 ? `Backup generado y ${removed} backups antiguos eliminados` : 'Backup de DB generado')
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo generar backup')
    }
  }

  const pruneBackups = async () => {
    setPruning(true)
    try {
      const response = await apiClient.post('/admin/backups/prune') as PruneResponse
      const removed = Number(response?.prune?.removed || 0)
      const days = Number(response?.prune?.retention_days || retentionDays)
      setRetentionDays(days)
      toast.success(
        removed > 0
          ? `Limpieza completada: ${removed} backups eliminados`
          : 'Limpieza completada: no hubo backups para eliminar',
      )
      load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo limpiar backups')
    } finally {
      setPruning(false)
    }
  }

  const verifyBackup = async (name?: string) => {
    setVerifyingName(name || '__all__')
    try {
      const endpoint = name
        ? `/admin/backups/verify?name=${encodeURIComponent(name)}`
        : '/admin/backups/verify'
      const resp = await apiClient.get(endpoint) as VerifyResponse
      const updates: Record<string, VerifyItem> = {}
      ;(resp.items || []).forEach((item) => {
        updates[item.name] = item
      })
      setVerificationByName((prev) => ({ ...prev, ...updates }))
      toast.success(name ? `Verificacion completada: ${name}` : 'Verificacion de backups completada')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo verificar backups')
    } finally {
      setVerifyingName(null)
    }
  }

  const downloadBackup = async (name: string) => {
    try {
      const response = await fetch(
        buildApiUrl(`/admin/backups/download?name=${encodeURIComponent(name)}`),
        {
          method: 'GET',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        },
      )
      if (!response.ok) {
        let message = `No se pudo descargar backup (${response.status})`
        const contentType = response.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const payload = await response.json().catch(() => null)
          const apiError = payload && typeof payload.error === 'string' ? payload.error : null
          if (apiError) message = apiError
        }
        throw new Error(message)
      }

      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(objectUrl)
      toast.success(`Descarga iniciada: ${name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo descargar backup')
    }
  }

  const formatSize = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`

  const statusPill = (item: BackupFile) => {
    const verified = verificationByName[item.name]
    if (!verified) {
      return <span className="text-xs font-medium text-slate-300">Sin verificar</span>
    }
    if (verified.valid) {
      return <span className="text-xs font-medium text-emerald-300">Integridad OK</span>
    }
    return <span className="text-xs font-medium text-rose-300">Con problemas</span>
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Backups</h2>
        <div className="flex gap-2">
          <span className="inline-flex items-center rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-slate-200">
            Retencion: {retentionDays} dias
          </span>
          <button
            onClick={triggerDb}
            className="px-4 py-2 rounded-lg bg-cyan-500 text-white text-sm font-semibold hover:bg-cyan-400"
          >
            Backup DB ahora
          </button>
          <button
            onClick={pruneBackups}
            disabled={pruning}
            className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-500 disabled:opacity-50"
          >
            {pruning ? 'Limpiando...' : 'Limpiar antiguos'}
          </button>
          <button
            onClick={() => verifyBackup()}
            disabled={verifyingName === '__all__' || items.length === 0}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            Verificar todo
          </button>
          <button
            onClick={load}
            className="px-3 py-2 rounded-lg bg-white/10 text-slate-100 hover:bg-white/20"
          >
            <ArrowPathIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-slate-900/70 shadow-xl overflow-x-auto">
        <table className="w-full text-slate-100 min-w-[760px]">
          <thead className="bg-white/5 border-b border-white/10">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Nombre</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Tamano</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Modificado</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Estado</th>
              <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-sm text-slate-300">
                  Cargando...
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-sm text-slate-300 text-center">
                  No hay backups aun.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((f, i) => (
                <motion.tr key={f.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.03 }}>
                  <td className="px-4 py-3 text-sm">{f.name}</td>
                  <td className="px-4 py-3 text-sm">{formatSize(f.size)}</td>
                  <td className="px-4 py-3 text-sm">{new Date(f.modified).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm">
                    {statusPill(f)}
                    {verificationByName[f.name]?.issues && verificationByName[f.name].issues!.length > 0 && (
                      <div className="mt-1 text-xs text-rose-300">
                        {verificationByName[f.name].issues!.join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => verifyBackup(f.name)}
                        disabled={verifyingName === f.name || verifyingName === '__all__'}
                        className="text-emerald-300 hover:text-white text-sm disabled:opacity-50"
                      >
                        {verifyingName === f.name ? 'Verificando...' : 'Verificar'}
                      </button>
                      <button
                        onClick={() => downloadBackup(f.name)}
                        className="inline-flex items-center gap-1 text-cyan-300 hover:text-white text-sm"
                      >
                        <ArrowDownTrayIcon className="w-4 h-4" />
                        Descargar
                      </button>
                    </div>
                    {verificationByName[f.name]?.sha256 && (
                      <div className="mt-1 text-[11px] text-slate-400" title={verificationByName[f.name].sha256}>
                        SHA256: {verificationByName[f.name].sha256!.slice(0, 16)}...
                      </div>
                    )}
                  </td>
                </motion.tr>
              ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  )
}

export default BackupsView
