import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
  ShieldCheckIcon,
  CpuChipIcon,
  GlobeAltIcon,
  ChevronRightIcon,
  BoltIcon,
  Bars3Icon,
  XMarkIcon,
  CheckIcon,
  StarIcon,
  SignalIcon,
  ClockIcon,
} from '@heroicons/react/24/outline'

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } }

const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const [mobileMenu, setMobileMenu] = useState(false)
  const navLinks = ['Tecnología', 'Planes', 'Testimonios', 'Soporte IA']

  return (
    <div className="min-h-screen bg-ivory-200 text-slate-800 selection:bg-coral-500/30 overflow-x-hidden font-sans">

      {/* ─── Navbar ─── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-ivory-300 bg-white/80 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex h-20 items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-coral-400 to-coral-600 flex items-center justify-center shadow-lg shadow-coral-500/25 group-hover:scale-110 transition-transform">
              <span className="text-xl font-black text-white">I</span>
            </div>
            <span className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">ISPFAST</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((t) => (
              <a key={t} href={`#${t.toLowerCase().replace(' ', '-')}`} className="text-sm font-bold text-slate-500 hover:text-coral-500 transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-0.5 after:bg-coral-400 hover:after:w-full after:transition-all">{t}</a>
            ))}
            <button onClick={() => navigate('/login')} className="px-6 py-2.5 rounded-full bg-gradient-to-r from-coral-500 to-coral-600 text-white font-black text-sm hover:shadow-[0_10px_20px_-10px_rgba(255,105,97,0.5)] transition-all active:scale-95 uppercase tracking-wider">
              Portal Clientes
            </button>
          </div>

          <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden p-2 rounded-lg text-slate-600 hover:text-coral-500">
            {mobileMenu ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
        </div>

        {mobileMenu && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="md:hidden border-t border-ivory-300 bg-white/95 backdrop-blur-xl px-6 py-6 space-y-3 shadow-xl">
            {navLinks.map((t) => (
              <a key={t} href={`#${t.toLowerCase().replace(' ', '-')}`} onClick={() => setMobileMenu(false)} className="block text-sm font-bold text-slate-600 hover:text-coral-500 py-2">{t}</a>
            ))}
            <button onClick={() => { navigate('/login'); setMobileMenu(false) }} className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-coral-500 to-coral-600 text-white font-black text-sm uppercase tracking-widest">Portal Clientes</button>
          </motion.div>
        )}
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative pt-36 pb-24 lg:pt-52 lg:pb-36 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-10 left-1/4 w-[500px] h-[500px] bg-coral-500/5 rounded-full blur-[150px] animate-pulse" />
          <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-orange-400/5 rounded-full blur-[130px] animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12 } } }}>
            <motion.span variants={fadeUp} className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-coral-50 border border-coral-100 text-coral-500 text-xs font-black uppercase tracking-widest mb-8">
              <BoltIcon className="h-4 w-4 animate-bounce" /> Software de Gestión para ISPs
            </motion.span>

            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl lg:text-[6rem] font-black tracking-tight leading-[0.9] mb-8 text-slate-900">
              Gestión Inteligente <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-coral-500 via-orange-500 to-coral-600">Para tu ISP</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-500 font-medium leading-relaxed mb-12">
              La plataforma definitiva para administrar tu red. Facturación automática, portal de clientes, integración nativa con MikroTik/OLT y diagnóstico impulsado por IA.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <button onClick={() => navigate('/login')} className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-gradient-to-r from-coral-500 to-coral-600 text-white font-black text-lg hover:shadow-[0_15px_40px_-10px_rgba(255,105,97,0.6)] transition-all active:scale-95 flex items-center justify-center gap-3 group uppercase tracking-widest">
                Prueba Gratis <ChevronRightIcon className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-white border border-ivory-300 text-slate-800 font-black text-lg hover:bg-ivory-50 transition-all shadow-sm uppercase tracking-widest">
                Agendar Demo
              </button>
            </motion.div>

            <motion.div variants={fadeUp} className="max-w-4xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { value: '100%', label: 'Control MikroTik', icon: SignalIcon },
                { value: '+40%', label: 'Ahorro Operativo', icon: BoltIcon },
                { value: '24/7', label: 'Monitoreo IA', icon: ClockIcon },
                { value: '∞', label: 'Escalabilidad', icon: GlobeAltIcon },
              ].map((s, i) => (
                <div key={i} className="py-6 px-4 rounded-3xl bg-white border border-ivory-300 hover:border-coral-300 transition-all group shadow-sm">
                  <s.icon className="h-5 w-5 text-slate-600 group-hover:text-coral-500 transition-colors mx-auto mb-3" />
                  <p className="text-2xl lg:text-3xl font-black text-slate-800">{s.value}</p>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mt-1">{s.label}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="tecnología" className="py-32 bg-white relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-ivory-200/50 rounded-full blur-[100px] -mr-48 -mt-48" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-center mb-20">
            <span className="text-coral-500 font-black text-xs uppercase tracking-[0.3em]">Infraestructura</span>
            <h2 className="text-4xl lg:text-6xl font-black text-slate-900 mt-4 mb-4">Todo tu ISP en un solo lugar</h2>
            <p className="text-slate-500 max-w-xl mx-auto font-medium">Automatiza procesos, reduce costos de soporte técnico y toma el control total de tu red.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { title: 'Facturación Automatizada', desc: 'Suscripciones, pasarelas de pago (Stripe, PagoEfectivo) y suspensión por morosidad 100% automática.', icon: GlobeAltIcon, color: 'text-coral-500', bg: 'bg-coral-50' },
              { title: 'NOC Inteligente (IA)', desc: 'Diagnóstico autónomo 24/7. Nuestra IA detecta fallas en clientes y aplica scripts correctivos antes de generar tickets.', icon: CpuChipIcon, color: 'text-orange-500', bg: 'bg-orange-50' },
              { title: 'Control OLT & MikroTik', desc: 'Sincronización en tiempo real. Gestión de túneles SSTP, perfiles de ancho de banda y cortes desde una interfaz unificada.', icon: ShieldCheckIcon, color: 'text-rose-500', bg: 'bg-rose-50' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className="p-10 rounded-[2.5rem] bg-ivory-100 border border-ivory-300 hover:bg-white hover:shadow-xl hover:-translate-y-2 transition-all duration-500 group">
                <div className={`h-16 w-16 rounded-2xl ${f.bg} flex items-center justify-center mb-8 group-hover:scale-110 group-hover:rotate-6 transition-transform ${f.color}`}>
                  <f.icon className="h-8 w-8" />
                </div>
                <h3 className="text-2xl font-black text-slate-900 mb-4">{f.title}</h3>
                <p className="text-slate-500 leading-relaxed font-medium">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── AI Section ─── */}
      <section id="soporte-ia" className="py-24 bg-ivory-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-[3rem] border border-ivory-300 p-10 lg:p-20 shadow-2xl overflow-hidden relative">
             <div className="absolute top-0 left-0 w-32 h-32 bg-coral-500/5 rounded-full blur-3xl -ml-16 -mt-16" />
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <span className="text-coral-500 font-black tracking-widest text-xs uppercase mb-6 block">Operaciones Automatizadas</span>
                <h2 className="text-4xl lg:text-6xl font-black text-slate-900 mb-8 leading-tight">
                  Técnico Virtual 24/7<br /><span className="text-coral-500">con Gemini AI</span>
                </h2>
                <p className="text-lg text-slate-500 font-medium leading-relaxed mb-10">
                  Reduce tus tickets de soporte en un 40%. Nuestra inteligencia artificial identifica anomalías en tu red y aplica scripts correctivos directamente en tus routers MikroTik sin intervención humana.
                </p>
                <div className="space-y-4 mb-10">
                  {[
                    'Auto-reparación y diagnóstico de CPEs',
                    'Aislamiento de tormentas de broadcast',
                    'Sugerencias operativas en tiempo real',
                    'Detección de puertos y antenas saturadas',
                  ].map((text, i) => (
                    <div key={i} className="flex items-center gap-4 text-slate-600 font-bold">
                      <div className="h-6 w-6 rounded-full bg-coral-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-coral-500/20">
                        <CheckIcon className="h-3.5 w-3.5 text-white" />
                      </div>
                      {text}
                    </div>
                  ))}
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-coral-500/10 blur-[80px] rounded-full" />
                <div className="relative bg-ivory-200 border border-ivory-300 rounded-[2rem] p-8 shadow-inner">
                  <div className="flex items-center gap-4 mb-8 pb-6 border-b border-ivory-300">
                    <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-coral-400 to-coral-600 flex items-center justify-center shadow-lg">
                      <CpuChipIcon className="h-7 w-7 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-900 uppercase tracking-widest">ISPFAST AI Bot</p>
                      <p className="text-xs font-bold text-coral-500 animate-pulse">Analizando red en tiempo real...</p>
                    </div>
                    <div className="ml-auto flex gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-ping" />
                    </div>
                  </div>
                  <div className="space-y-4 font-mono text-xs">
                    <div className="p-4 bg-white rounded-xl text-slate-600 shadow-sm border border-ivory-300">
                      <span className="text-coral-500 font-bold">{'>'}</span> Iniciando diagnóstico de nodo NAP-12...
                    </div>
                    <div className="p-4 bg-orange-50 rounded-xl text-orange-700 border border-orange-200 shadow-sm">
                      <span className="text-orange-500 font-bold">{'>'}</span> Anomalía detectada en puerto 4. Aplicando script correctivo.
                    </div>
                    <div className="p-4 bg-emerald-50 rounded-xl text-emerald-700 border border-emerald-200 shadow-sm">
                      <span className="text-emerald-500 font-bold">{'>'}</span> ✓ Servicio restaurado. Latencia: 4ms. Packet Loss: 0%.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section id="testimonios" className="py-32 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-center mb-20">
            <span className="text-coral-500 font-black text-xs uppercase tracking-[0.3em]">Testimonios</span>
            <h2 className="text-4xl lg:text-6xl font-black text-slate-900 mt-4 mb-4">Lo que dicen nuestros clientes</h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { name: 'Carlos M.', role: 'Dueño WISP - 1500 Clientes', text: 'ISPFAST redujo nuestras llamadas de soporte drásticamente. La IA soluciona problemas de CPEs sola y los cortes automáticos por mora ya no son un dolor de cabeza.', stars: 5 },
              { name: 'María L.', role: 'Admin ISP de Fibra', text: 'Migrar de nuestro viejo sistema a ISPFAST tomó solo un día. La integración con MikroTik, OLT y la pasarela de pagos nos cambió la vida por completo.', stars: 5 },
              { name: 'Roberto S.', role: 'Gerente de Operaciones', text: 'Manejar 60 routers antes era un caos total. Con el panel unificado y los túneles SSTP ahora tenemos visibilidad completa de cada nodo 24/7.', stars: 5 },
            ].map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                className="p-10 rounded-[2.5rem] bg-ivory-100 border border-ivory-300 hover:shadow-xl transition-all group">
                <div className="flex gap-1 mb-6">
                  {Array.from({ length: t.stars }).map((_, si) => (
                    <StarIcon key={si} className="h-5 w-5 text-orange-400 fill-orange-400" />
                  ))}
                </div>
                <p className="text-slate-600 font-medium italic leading-relaxed mb-8">"{t.text}"</p>
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-coral-400 to-coral-600 flex items-center justify-center text-white font-black">{t.name[0]}</div>
                  <div>
                    <p className="text-sm font-black text-slate-900 uppercase tracking-widest">{t.name}</p>
                    <p className="text-xs font-bold text-slate-500">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-32 bg-ivory-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className="rounded-[4rem] bg-gradient-to-br from-coral-500 to-coral-700 p-16 lg:p-24 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-80 h-80 bg-white/10 rounded-full blur-[100px] -mr-40 -mt-40" />
            <h2 className="text-4xl lg:text-7xl font-black text-white mb-8 relative leading-tight uppercase tracking-tighter">¿Listo para escalar tu ISP?</h2>
            <p className="text-xl text-coral-50 mb-12 max-w-xl mx-auto relative font-medium opacity-90">Moderniza la administración de tu empresa hoy y experimenta el poder de la automatización con IA.</p>
            <button onClick={() => navigate('/login')} className="px-12 py-6 rounded-2xl bg-white text-coral-600 font-black text-xl shadow-xl hover:scale-105 hover:shadow-2xl transition-all active:scale-95 relative group uppercase tracking-widest">
              Inicia prueba gratis <ChevronRightIcon className="inline h-6 w-6 ml-2 group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="py-20 bg-white border-t border-ivory-300">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-20">
            <div className="md:col-span-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-coral-400 to-coral-600 flex items-center justify-center shadow-lg">
                  <span className="text-lg font-black text-white">I</span>
                </div>
                <span className="text-2xl font-black text-slate-900">ISPFAST</span>
              </div>
              <p className="text-sm text-slate-500 font-medium leading-relaxed">Plataforma de gestión SaaS de nueva generación para proveedores de internet e infraestructura (ISPs).</p>
            </div>
            {[
              { title: 'Producto', links: ['Planes', 'Cobertura', 'Empresas', 'API'] },
              { title: 'Soporte', links: ['Centro de Ayuda', 'Estado del Servicio', 'Contacto', 'WhatsApp'] },
              { title: 'Legal', links: ['Términos', 'Privacidad', 'SLA', 'Cookies'] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6">{col.title}</h4>
                <ul className="space-y-4">
                  {col.links.map((link) => (
                    <li key={link}><a href="#" className="text-sm font-bold text-slate-500 hover:text-coral-500 transition-colors">{link}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-ivory-300 pt-10 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-slate-500 text-xs font-bold uppercase tracking-widest">© 2026 ISPFAST Infrastructure. Potenciado por Gemini 1.5 Flash.</p>
            <div className="flex gap-8">
              {['Facebook', 'Instagram', 'X', 'LinkedIn'].map((s) => (
                <a key={s} href="#" className="text-slate-500 hover:text-coral-500 transition-colors text-xs font-black uppercase tracking-widest">{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
