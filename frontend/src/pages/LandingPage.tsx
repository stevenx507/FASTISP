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
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-500/30 overflow-x-hidden">

      {/* ─── Navbar ─── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-white/5 bg-slate-950/60 backdrop-blur-2xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex h-20 items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 group-hover:scale-110 transition-transform">
              <span className="text-xl font-black text-white">I</span>
            </div>
            <span className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">ISPFAST</span>
          </div>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((t) => (
              <a key={t} href={`#${t.toLowerCase().replace(' ', '-')}`} className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative after:absolute after:bottom-0 after:left-0 after:w-0 after:h-px after:bg-cyan-400 hover:after:w-full after:transition-all">{t}</a>
            ))}
            <button onClick={() => navigate('/login')} className="px-6 py-2.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm hover:shadow-[0_0_30px_-6px_rgba(6,182,212,0.5)] transition-all active:scale-95">
              Portal Clientes
            </button>
          </div>

          <button onClick={() => setMobileMenu(!mobileMenu)} className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white">
            {mobileMenu ? <XMarkIcon className="h-6 w-6" /> : <Bars3Icon className="h-6 w-6" />}
          </button>
        </div>

        {mobileMenu && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="md:hidden border-t border-white/5 bg-slate-950/95 backdrop-blur-xl px-6 py-6 space-y-3">
            {navLinks.map((t) => (
              <a key={t} href={`#${t.toLowerCase().replace(' ', '-')}`} onClick={() => setMobileMenu(false)} className="block text-sm text-slate-300 hover:text-white py-2">{t}</a>
            ))}
            <button onClick={() => { navigate('/login'); setMobileMenu(false) }} className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-sm">Portal Clientes</button>
          </motion.div>
        )}
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative pt-36 pb-24 lg:pt-52 lg:pb-36 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-10 left-1/4 w-[500px] h-[500px] bg-cyan-500/8 rounded-full blur-[150px] animate-pulse" />
          <div className="absolute bottom-10 right-1/4 w-[400px] h-[400px] bg-blue-600/8 rounded-full blur-[130px] animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[300px] h-[300px] bg-indigo-500/5 rounded-full blur-[100px]" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.12 } } }}>
            <motion.span variants={fadeUp} className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest mb-8">
              <BoltIcon className="h-4 w-4 animate-pulse" /> Software de Gestión para ISPs
            </motion.span>

            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl lg:text-[5.5rem] font-black tracking-tight leading-[0.9] mb-8">
              Gestión Inteligente <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500">Para tu ISP</span>
            </motion.h1>

            <motion.p variants={fadeUp} className="max-w-2xl mx-auto text-lg lg:text-xl text-slate-400 leading-relaxed mb-12">
              La plataforma definitiva para administrar tu red. Facturación automática, portal de clientes, integración nativa con MikroTik/OLT y diagnóstico impulsado por IA.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
              <button onClick={() => navigate('/login')} className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg hover:shadow-[0_0_50px_-10px_rgba(6,182,212,0.6)] transition-all active:scale-95 flex items-center justify-center gap-3 group">
                Prueba Gratis <ChevronRightIcon className="h-5 w-5 group-hover:translate-x-1 transition-transform" />
              </button>
              <button className="w-full sm:w-auto px-10 py-5 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-lg hover:bg-white/10 hover:border-white/20 transition-all">
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
                <div key={i} className="py-5 px-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-cyan-500/20 transition-colors group">
                  <s.icon className="h-5 w-5 text-slate-600 group-hover:text-cyan-400 transition-colors mx-auto mb-2" />
                  <p className="text-2xl lg:text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-400">{s.value}</p>
                  <p className="text-xs text-slate-500 mt-1">{s.label}</p>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="tecnología" className="py-24 bg-gradient-to-b from-slate-900/50 to-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-center mb-16">
            <span className="text-cyan-400 font-bold text-xs uppercase tracking-widest">Infraestructura</span>
            <h2 className="text-4xl lg:text-5xl font-black text-white mt-4 mb-4">Todo tu ISP en un solo lugar</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Automatiza procesos, reduce costos de soporte técnico y toma el control total de tu red.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: 'Facturación Automatizada', desc: 'Suscripciones, pasarelas de pago (Stripe, PagoEfectivo) y suspensión por morosidad 100% automática.', icon: GlobeAltIcon, grad: 'from-cyan-500/15', color: 'text-cyan-400', hover: 'hover:border-cyan-500/30' },
              { title: 'NOC Inteligente (IA)', desc: 'Diagnóstico autónomo 24/7. Nuestra IA detecta fallas en clientes y aplica scripts correctivos antes de generar tickets.', icon: CpuChipIcon, grad: 'from-purple-500/15', color: 'text-purple-400', hover: 'hover:border-purple-500/30' },
              { title: 'Control OLT & MikroTik', desc: 'Sincronización en tiempo real. Gestión de túneles SSTP, perfiles de ancho de banda y cortes desde una interfaz unificada.', icon: ShieldCheckIcon, grad: 'from-emerald-500/15', color: 'text-emerald-400', hover: 'hover:border-emerald-500/30' },
            ].map((f, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15 }}
                className={`p-8 rounded-3xl bg-gradient-to-b ${f.grad} to-transparent border border-white/5 ${f.hover} transition-all duration-300 group`}>
                <div className={`h-14 w-14 rounded-2xl bg-slate-900/80 border border-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${f.color}`}>
                  <f.icon className="h-7 w-7" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{f.title}</h3>
                <p className="text-slate-400 leading-relaxed text-sm">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="planes" className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-center mb-16">
            <span className="text-cyan-400 font-bold text-xs uppercase tracking-widest">Planes</span>
            <h2 className="text-4xl lg:text-5xl font-black text-white mt-4 mb-4">Escala sin límites</h2>
            <p className="text-slate-400 max-w-xl mx-auto">Nuestros planes se adaptan al tamaño de tu red. Todos incluyen facturación, soporte IA y control MikroTik.</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {[
              { name: 'Starter', price: '8', features: ['Hasta 300 clientes', '5 Routers MikroTik', 'Facturación Automática', 'Integración WhatsApp'] },
              { name: 'Growth', price: '12', pop: true, features: ['Hasta 800 clientes', '20 Routers MikroTik', 'IA Diagnóstica 24/7', 'Pasarelas de Pago Premium', 'Soporte Prioritario'] },
              { name: 'Pro', price: '15', features: ['Hasta 2000 clientes', '60 Routers MikroTik', 'Módulos OLT Avanzados', 'Túneles SSTP', 'SLA 99.9%'] },
            ].map((p, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                className={`relative rounded-3xl p-8 border transition-all duration-300 flex flex-col h-full ${p.pop ? 'bg-gradient-to-b from-cyan-500/10 to-blue-600/5 border-cyan-500/30 shadow-2xl shadow-cyan-500/10 md:scale-[1.05] z-10' : 'bg-white/[0.02] border-white/5 hover:border-white/15'}`}>
                {p.pop && (
                  <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-bold uppercase tracking-wider shadow-lg">Más popular</span>
                )}
                <h3 className="text-xl font-bold text-white mb-2">{p.name}</h3>
                <p className="text-4xl font-black text-white mb-6">${p.price}<span className="text-lg text-slate-400 font-medium">/mes</span></p>
                <ul className="space-y-3 mb-8">
                  {p.features.map((f, fi) => (
                    <li key={fi} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <CheckIcon className="h-4 w-4 mt-0.5 text-cyan-400 flex-shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <button onClick={() => navigate('/login')} className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all active:scale-95 ${p.pop ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:shadow-[0_0_30px_-6px_rgba(6,182,212,0.5)]' : 'bg-white/5 border border-white/10 text-white hover:bg-white/10'}`}>
                    Iniciar Prueba Gratis
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── AI Section ─── */}
      <section id="soporte-ia" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-gradient-to-br from-indigo-900/30 to-slate-900/30 rounded-[2.5rem] border border-white/10 p-8 lg:p-16 overflow-hidden relative">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <div>
                <span className="text-cyan-400 font-bold tracking-widest text-xs uppercase mb-6 block">Operaciones Automatizadas</span>
                <h2 className="text-4xl lg:text-5xl font-black text-white mb-6 leading-tight">
                  Técnico Virtual 24/7<br />con Gemini AI
                </h2>
                <p className="text-lg text-slate-300 leading-relaxed mb-8">
                  Reduce tus tickets de soporte en un 40%. Nuestra inteligencia artificial identifica anomalías en tu red y aplica scripts correctivos directamente en tus routers MikroTik sin intervención humana.
                </p>
                <ul className="space-y-4 mb-8">
                  {[
                    'Auto-reparación y diagnóstico de CPEs',
                    'Aislamiento de tormentas de broadcast',
                    'Sugerencias operativas en tiempo real',
                    'Detección de puertos y antenas saturadas',
                  ].map((text, i) => (
                    <li key={i} className="flex items-center gap-3 text-slate-300 text-sm">
                      <div className="h-5 w-5 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                        <div className="h-2 w-2 rounded-full bg-cyan-400" />
                      </div>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-cyan-500/15 blur-[60px] rounded-full" />
                <div className="relative bg-slate-950 border border-white/10 rounded-2xl p-6 shadow-2xl">
                  <div className="flex items-center gap-4 mb-6 pb-4 border-b border-white/5">
                    <div className="h-11 w-11 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
                      <CpuChipIcon className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">ISPFAST AI Bot</p>
                      <p className="text-xs text-cyan-400">Analizando red en tiempo real...</p>
                    </div>
                    <div className="ml-auto flex gap-1">
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: '0.3s' }} />
                      <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" style={{ animationDelay: '0.6s' }} />
                    </div>
                  </div>
                  <div className="space-y-3 font-mono text-[11px] lg:text-xs">
                    <div className="p-3 bg-white/5 rounded-xl text-slate-300">
                      {'>'} Iniciando diagnóstico de nodo NAP-12...
                    </div>
                    <div className="p-3 bg-amber-500/10 rounded-xl text-amber-300 border border-amber-500/10">
                      {'>'} Anomalía detectada en puerto 4. Aplicando script correctivo.
                    </div>
                    <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-300 border border-emerald-500/10">
                      {'>'} ✓ Servicio restaurado. Latencia: 4ms. Packet Loss: 0%.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section id="testimonios" className="py-24 bg-gradient-to-b from-slate-950 to-slate-900/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-center mb-16">
            <span className="text-cyan-400 font-bold text-xs uppercase tracking-widest">Testimonios</span>
            <h2 className="text-4xl lg:text-5xl font-black text-white mt-4 mb-4">Lo que dicen nuestros clientes</h2>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { name: 'Carlos M.', role: 'Dueño WISP - 1500 Clientes', text: 'ISPFAST redujo nuestras llamadas de soporte drásticamente. La IA soluciona problemas de CPEs sola y los cortes automáticos por mora ya no son un dolor de cabeza.', stars: 5 },
              { name: 'María L.', role: 'Admin ISP de Fibra', text: 'Migrar de nuestro viejo sistema a ISPFAST tomó solo un día. La integración con MikroTik, OLT y la pasarela de pagos nos cambió la vida por completo.', stars: 5 },
              { name: 'Roberto S.', role: 'Gerente de Operaciones', text: 'Manejar 60 routers antes era un caos total. Con el panel unificado y los túneles SSTP ahora tenemos visibilidad completa de cada nodo 24/7.', stars: 5 },
            ].map((t, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.12 }}
                className="p-8 rounded-3xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.stars }).map((_, si) => (
                    <StarIcon key={si} className="h-4 w-4 text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-slate-300 text-sm leading-relaxed mb-6">"{t.text}"</p>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center text-white font-bold text-sm">{t.name[0]}</div>
                  <div>
                    <p className="text-sm font-semibold text-white">{t.name}</p>
                    <p className="text-xs text-slate-500">{t.role}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className="rounded-[2.5rem] bg-gradient-to-br from-cyan-500/15 via-blue-600/10 to-indigo-600/15 border border-cyan-500/20 p-12 lg:p-16 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-[100px]" />
            <h2 className="text-3xl lg:text-5xl font-black text-white mb-4 relative">¿Listo para escalar tu ISP?</h2>
            <p className="text-lg text-slate-300 mb-8 max-w-xl mx-auto relative">Moderniza la administración de tu empresa hoy y experimenta el poder de la automatización con IA.</p>
            <button onClick={() => navigate('/login')} className="px-10 py-5 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold text-lg hover:shadow-[0_0_50px_-10px_rgba(6,182,212,0.6)] transition-all active:scale-95 relative group">
              Inicia tu prueba gratis <ChevronRightIcon className="inline h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </button>
          </motion.div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="py-16 border-t border-white/5 bg-slate-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <div className="md:col-span-1">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center">
                  <span className="text-sm font-black text-white">I</span>
                </div>
                <span className="text-xl font-black text-white">ISPFAST</span>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed">Plataforma de gestión SaaS de nueva generación para proveedores de internet e infraestructura (ISPs).</p>
            </div>
            {[
              { title: 'Producto', links: ['Planes', 'Cobertura', 'Empresas', 'API'] },
              { title: 'Soporte', links: ['Centro de Ayuda', 'Estado del Servicio', 'Contacto', 'WhatsApp'] },
              { title: 'Legal', links: ['Términos', 'Privacidad', 'SLA', 'Cookies'] },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="text-sm font-bold text-white mb-4">{col.title}</h4>
                <ul className="space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link}><a href="#" className="text-sm text-slate-500 hover:text-white transition-colors">{link}</a></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="border-t border-white/5 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-slate-600 text-xs">© 2026 ISPFAST Infrastructure. Potenciado por Gemini 1.5 Flash.</p>
            <div className="flex gap-6">
              {['Facebook', 'Instagram', 'X', 'LinkedIn'].map((s) => (
                <a key={s} href="#" className="text-slate-600 hover:text-white transition-colors text-xs">{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default LandingPage
