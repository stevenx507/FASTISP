import React from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { 
  RocketLaunchIcon, 
  ShieldCheckIcon, 
  CpuChipIcon, 
  GlobeAltIcon,
  ChevronRightIcon,
  WifiIcon,
  BoltIcon
} from '@heroicons/react/24/outline'

const LandingPage: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* --- Glass Navbar --- */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-slate-950/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <div className="flex items-center gap-2 group cursor-pointer" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})}>
              <div className="h-10 w-10 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-cyan-500/20 group-hover:scale-110 transition-transform">
                <span className="text-xl font-black text-white">I</span>
              </div>
              <span className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                ISPFAST
              </span>
            </div>
            
            <div className="hidden md:flex items-center gap-8">
              {['Tecnología', 'Planes', 'Cobertura', 'Soporte IA'].map((item) => (
                <a key={item} href={`#${item.toLowerCase()}`} className="text-sm font-medium text-slate-400 hover:text-white transition-colors">
                  {item}
                </a>
              ))}
              <button 
                onClick={() => navigate('/login')}
                className="px-6 py-2.5 rounded-full bg-white text-slate-950 font-bold text-sm hover:bg-cyan-400 hover:text-white transition-all active:scale-95 shadow-lg shadow-white/5"
              >
                Portal Clientes
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* --- Hero Section --- */}
      <section className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        {/* Animated Background Blobs */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-20 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] animate-pulse delay-700" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest mb-8">
              <BoltIcon className="h-4 w-4" />
              Internet de Nueva Generación
            </span>
            <h1 className="text-5xl lg:text-8xl font-black tracking-tight leading-[0.9] mb-8">
              Velocidad que <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600">
                Desafía Límites
              </span>
            </h1>
            <p className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-400 leading-relaxed mb-12">
              Experimenta el internet más estable y rápido del país, impulsado por infraestructura de fibra óptica pura y gestión inteligente con IA.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => navigate('/login')}
                className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg hover:shadow-[0_0_40px_-10px_rgba(6,182,212,0.5)] transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                Contratar Ahora
                <ChevronRightIcon className="h-5 w-5" />
              </button>
              <button className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg hover:bg-white/10 transition-all">
                Ver Cobertura
              </button>
            </div>
          </motion.div>
        </div>
      </section>

      {/* --- Features Grid --- */}
      <section id="tecnología" className="py-24 bg-slate-900/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                title: 'Fibra Óptica Pura',
                desc: 'Conexión simétrica GPON de última milla sin interferencias.',
                icon: GlobeAltIcon,
                color: 'text-cyan-400'
              },
              {
                title: 'NOC Impulsado por IA',
                desc: 'Diagnóstico autónomo 24/7 para garantizar 99.9% de uptime.',
                icon: CpuChipIcon,
                color: 'text-purple-400'
              },
              {
                title: 'Seguridad de Nivel Elite',
                desc: 'Protección anti-DDoS y firewalls avanzados perimetrales.',
                icon: ShieldCheckIcon,
                color: 'text-emerald-400'
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.2 }}
                className="p-8 rounded-3xl bg-slate-950 border border-white/5 hover:border-white/10 transition-colors group"
              >
                <div className={`h-14 w-14 rounded-2xl bg-slate-900 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${feature.color}`}>
                  <feature.icon className="h-8 w-8" />
                </div>
                <h3 className="text-xl font-bold text-white mb-4">{feature.title}</h3>
                <p className="text-slate-400 leading-relaxed">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* --- AI Section --- */}
      <section id="soporte ia" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-indigo-900/40 to-slate-900/40 rounded-[3rem] border border-white/10 p-8 lg:p-20 overflow-hidden relative">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <span className="text-cyan-400 font-bold tracking-widest text-xs uppercase mb-6 block">Soporte del Futuro</span>
                <h2 className="text-4xl lg:text-6xl font-black text-white mb-8">
                  Zero-Touch Support <br />
                  con Gemini AI
                </h2>
                <p className="text-lg text-slate-300 leading-relaxed mb-10">
                  ¿Problemas con tu conexión? Nuestra inteligencia avanzada resuelve incidencias técnicas de forma autónoma en minutos, configurando tu router remotamente sin esperas.
                </p>
                <ul className="space-y-4 mb-10">
                  {[
                    'Auto-reparación de configuración MikroTik',
                    'Asistente virtual especializado en redes',
                    'Priorización inteligente de tráfico (QoS)'
                  ].map((text, i) => (
                    <li key={i} className="flex items-center gap-3 text-slate-300">
                      <div className="h-5 w-5 rounded-full bg-cyan-500/20 flex items-center justify-center">
                        <div className="h-2 w-2 rounded-full bg-cyan-400" />
                      </div>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="relative group">
                <div className="absolute inset-0 bg-cyan-500/20 blur-[60px] rounded-full animate-pulse" />
                <div className="relative bg-slate-950 border border-white/10 rounded-2xl p-6 shadow-2xl">
                  <div className="flex items-center gap-4 mb-6 pb-6 border-b border-white/5">
                    <div className="h-12 w-12 rounded-full bg-cyan-500 flex items-center justify-center animate-bounce">
                      <CpuChipIcon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">ISPFAST AI Bot</p>
                      <p className="text-xs text-cyan-400">Analizando red en tiempo real...</p>
                    </div>
                  </div>
                  <div className="space-y-4 font-mono text-[11px] lg:text-xs">
                    <div className="p-3 bg-white/5 rounded-lg text-slate-300">
                      > Iniciando diagnóstico de nodo NAP-12...
                    </div>
                    <div className="p-3 bg-cyan-500/10 rounded-lg text-cyan-300">
                      > Anomalía detectada en puerto 4. Aplicando script correctivo.
                    </div>
                    <div className="p-3 bg-emerald-500/10 rounded-lg text-emerald-300">
                      > Servicio restaurado. Latencia: 4ms. Packet Loss: 0%.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Footer --- */}
      <footer className="py-20 border-t border-white/5 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 bg-gradient-to-br from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-sm font-black text-white">I</span>
              </div>
              <span className="text-xl font-black text-white">ISPFAST</span>
            </div>
            <p className="text-slate-500 text-sm">
              © 2026 ISPFAST Infrastructure. Potenciado por Gemini 1.5 Flash.
            </p>
            <div className="flex gap-6">
              {['Facebook', 'X', 'LinkedIn', 'Support'].map((item) => (
                <a key={item} href="#" className="text-slate-500 hover:text-white transition-colors text-sm">
                  {item}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
