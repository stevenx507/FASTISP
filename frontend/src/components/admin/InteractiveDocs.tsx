import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AcademicCapIcon,
  ArrowTopRightOnSquareIcon,
  BellAlertIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  CogIcon,
  CreditCardIcon,
  MapIcon,
  MagnifyingGlassIcon,
  ServerIcon,
  UserGroupIcon,
  WifiIcon,
} from '@heroicons/react/24/outline'
import { safeStorage } from '../../lib/storage'

type SectionId = 'mikrotik' | 'olt' | 'functions'

interface GuideChecklistItem {
  id: string
  label: string
}

interface GuideStep {
  id: string
  section: SectionId
  title: string
  summary: string
  why: string
  checklist: GuideChecklistItem[]
  moduleId?: string
  moduleLabel?: string
}

interface FunctionReferenceItem {
  id: string
  name: string
  summary: string
  useCase: string
  moduleId: string
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

interface StepProgress {
  done: boolean
  checks: Record<string, boolean>
}

type ProgressState = Record<string, StepProgress>

interface InteractiveDocsProps {
  onNavigateToModule?: (moduleId: string) => void
}

const PROGRESS_STORAGE_KEY = 'interactive_docs_progress_v1'
const GUIDED_MODE_STORAGE_KEY = 'interactive_docs_guided_mode_v1'

const SECTION_META: Array<{ id: SectionId; label: string; description: string }> = [
  {
    id: 'mikrotik',
    label: 'Guia MikroTik',
    description: 'Conexion inicial, acceso remoto y operacion segura.',
  },
  {
    id: 'olt',
    label: 'Guia OLT',
    description: 'Alta de OLT, validacion previa y flujo ONU.',
  },
  {
    id: 'functions',
    label: 'Funciones del panel',
    description: 'Que hace cada modulo y cuando usarlo.',
  },
]

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'mk-01',
    section: 'mikrotik',
    title: '1) Registrar router MikroTik',
    summary: 'Crea el router con IP, usuario API, password y puerto API.',
    why: 'Sin inventario correcto no hay provisioning ni monitoreo.',
    moduleId: 'network',
    moduleLabel: 'Abrir Gestion MikroTik',
    checklist: [
      { id: 'name', label: 'Completar nombre y sitio del router' },
      { id: 'address', label: 'Confirmar IP o DNS de gestion' },
      { id: 'api', label: 'Validar usuario/password API y puerto' },
    ],
  },
  {
    id: 'mk-02',
    section: 'mikrotik',
    title: '2) Probar conectividad y estado',
    summary: 'Ejecuta prueba de conexion y valida health, colas y sesiones.',
    why: 'Detecta errores de acceso antes de operar clientes.',
    moduleId: 'network',
    moduleLabel: 'Ir a panel MikroTik',
    checklist: [
      { id: 'probe', label: 'Ejecutar Probar Conexion' },
      { id: 'health', label: 'Revisar health score y recursos' },
      { id: 'queues', label: 'Verificar queues y conexiones activas' },
    ],
  },
  {
    id: 'mk-03',
    section: 'mikrotik',
    title: '3) Activar acceso remoto (BTH o WireGuard)',
    summary: 'Usa scripts guiados para habilitar Back To Home y acceso del VPS.',
    why: 'Permite gestion centralizada sin depender de IP publica fija.',
    moduleId: 'network',
    moduleLabel: 'Abrir Configuracion MikroTik',
    checklist: [
      { id: 'bth-enable', label: 'Habilitar DDNS y Back To Home' },
      { id: 'bth-user', label: 'Crear usuario BTH para VPS' },
      { id: 'probe-vps', label: 'Probar reachability desde VPS al router' },
    ],
  },
  {
    id: 'mk-04',
    section: 'mikrotik',
    title: '4) Ejecutar cambios live con control',
    summary: 'Para reinicios y scripts, usa ticket de cambio y preflight.',
    why: 'Reduce errores operativos y deja trazabilidad.',
    moduleId: 'network',
    moduleLabel: 'Abrir Seguridad MikroTik',
    checklist: [
      { id: 'ticket', label: 'Ingresar change ticket en el panel' },
      { id: 'preflight', label: 'Marcar preflight_ack antes de cambios live' },
      { id: 'rollback', label: 'Guardar ruta de rollback en change log' },
    ],
  },
  {
    id: 'olt-01',
    section: 'olt',
    title: '1) Registrar equipo OLT',
    summary: 'Define vendor, host, transporte (ssh/telnet), puerto y credenciales.',
    why: 'La normalizacion de inventario evita comandos incorrectos por vendor.',
    moduleId: 'olt',
    moduleLabel: 'Abrir Gestion OLT',
    checklist: [
      { id: 'vendor', label: 'Seleccionar vendor correcto (ZTE/Huawei/VSOL)' },
      { id: 'transport', label: 'Configurar host, puerto y transporte' },
      { id: 'auth', label: 'Validar usuario/password y enable password' },
    ],
  },
  {
    id: 'olt-02',
    section: 'olt',
    title: '2) Correr readiness antes de live',
    summary: 'Ejecuta preflight para validar conectividad, ACS y salud base.',
    why: 'Evita abrir ventanas live con condiciones incompletas.',
    moduleId: 'olt',
    moduleLabel: 'Ir a readiness OLT',
    checklist: [
      { id: 'tcp', label: 'Confirmar reachability TCP al host OLT' },
      { id: 'cred', label: 'Validar autenticacion de dispositivo' },
      { id: 'acs', label: 'Revisar estado ACS/TR-069 si aplica' },
    ],
  },
  {
    id: 'olt-03',
    section: 'olt',
    title: '3) Flujo ONU: discover, authorize, activate',
    summary: 'Usa plantillas de servicio para provision consistente.',
    why: 'Estandariza altas y evita perfiles manuales inconsistentes.',
    moduleId: 'olt',
    moduleLabel: 'Ir a operaciones ONU',
    checklist: [
      { id: 'discover', label: 'Descubrir ONU por serial/puerto PON' },
      { id: 'template', label: 'Aplicar line profile y srv profile' },
      { id: 'activate', label: 'Autorizar y activar en modo controlado' },
    ],
  },
  {
    id: 'olt-04',
    section: 'olt',
    title: '4) Ejecutar modo live con guardrails',
    summary: 'Live requiere confirmacion, change ticket y preflight_ack.',
    why: 'Mantiene seguridad operacional en cambios de produccion.',
    moduleId: 'olt',
    moduleLabel: 'Abrir panel live',
    checklist: [
      { id: 'live-confirm', label: 'Configurar run_mode=live + live_confirm=true' },
      { id: 'live-ticket', label: 'Registrar change_ticket valido' },
      { id: 'live-preflight', label: 'Confirmar preflight_ack=true' },
    ],
  },
  {
    id: 'fn-01',
    section: 'functions',
    title: 'Dashboard y Clientes',
    summary: 'Dashboard muestra KPIs y Clientes centraliza altas/ediciones.',
    why: 'Es la base diaria para operacion comercial y tecnica.',
    moduleId: 'clients',
    moduleLabel: 'Abrir Clientes',
    checklist: [
      { id: 'dash-read', label: 'Revisar KPIs al iniciar turno' },
      { id: 'client-create', label: 'Registrar cliente con plan y router' },
      { id: 'client-portal', label: 'Habilitar portal cliente si corresponde' },
    ],
  },
  {
    id: 'fn-02',
    section: 'functions',
    title: 'Facturacion, Cobranza y Finanzas',
    summary: 'Controla facturas, pagos, promesas y estado de cartera.',
    why: 'Alinea caja, suspensiones y recuperacion de mora.',
    moduleId: 'billing',
    moduleLabel: 'Abrir Facturacion',
    checklist: [
      { id: 'invoice-review', label: 'Validar facturas pendientes y vencidas' },
      { id: 'payments', label: 'Registrar pagos y reconciliacion' },
      { id: 'promises', label: 'Gestionar promesas de pago activas' },
    ],
  },
  {
    id: 'fn-03',
    section: 'functions',
    title: 'Monitoreo, NOC, Alertas y Tickets',
    summary: 'Consolida incidentes, salud de red y SLA de soporte.',
    why: 'Mejora tiempo de respuesta y disponibilidad del servicio.',
    moduleId: 'noc',
    moduleLabel: 'Abrir NOC',
    checklist: [
      { id: 'monitoring', label: 'Monitorear disponibilidad y consumo' },
      { id: 'alerts', label: 'Atender alertas por severidad' },
      { id: 'tickets', label: 'Cerrar tickets con trazabilidad' },
    ],
  },
]

const FUNCTION_REFERENCE: FunctionReferenceItem[] = [
  {
    id: 'dashboard',
    name: 'Dashboard',
    summary: 'Vista ejecutiva de KPIs operativos y comerciales.',
    useCase: 'Inicio de turno y comite diario.',
    moduleId: 'dashboard',
    icon: ChartBarIcon,
  },
  {
    id: 'clients',
    name: 'Clientes',
    summary: 'Alta de clientes, planes, router y portal.',
    useCase: 'Provision y cambios de suscripcion.',
    moduleId: 'clients',
    icon: UserGroupIcon,
  },
  {
    id: 'network',
    name: 'Gestion MikroTik',
    summary: 'Routers, colas, scripts, BTH y hardening.',
    useCase: 'Operacion de acceso y control CPE/PPPoE.',
    moduleId: 'network',
    icon: WifiIcon,
  },
  {
    id: 'olt',
    name: 'Gestion OLT',
    summary: 'Inventario OLT, flujos ONU y acciones live.',
    useCase: 'Altas FTTH y cambios sobre PON.',
    moduleId: 'olt',
    icon: ServerIcon,
  },
  {
    id: 'billing',
    name: 'Facturacion',
    summary: 'Facturas, pagos y estados de cuenta.',
    useCase: 'Ciclo de cobro y suspension por mora.',
    moduleId: 'billing',
    icon: CreditCardIcon,
  },
  {
    id: 'maps',
    name: 'Mapa de Red',
    summary: 'Visualiza topologia y nodos de red.',
    useCase: 'Planificacion y troubleshooting.',
    moduleId: 'maps',
    icon: MapIcon,
  },
  {
    id: 'alerts',
    name: 'Alertas',
    summary: 'Eventos por severidad con seguimiento.',
    useCase: 'Respuesta rapida ante incidencias.',
    moduleId: 'alerts',
    icon: BellAlertIcon,
  },
  {
    id: 'settings',
    name: 'Configuracion',
    summary: 'Politicas globales, seguridad y preferencias.',
    useCase: 'Gobierno del tenant y estandares operativos.',
    moduleId: 'settings',
    icon: CogIcon,
  },
]

const buildDefaultProgress = (): ProgressState => {
  return GUIDE_STEPS.reduce<ProgressState>((acc, step) => {
    acc[step.id] = { done: false, checks: {} }
    return acc
  }, {})
}

const parseStoredProgress = (raw: string | null): ProgressState => {
  if (!raw) return buildDefaultProgress()
  try {
    const parsed = JSON.parse(raw) as ProgressState
    const base = buildDefaultProgress()
    for (const step of GUIDE_STEPS) {
      if (!parsed[step.id]) continue
      base[step.id] = {
        done: Boolean(parsed[step.id].done),
        checks: { ...(parsed[step.id].checks || {}) },
      }
    }
    return base
  } catch {
    return buildDefaultProgress()
  }
}

const InteractiveDocs: React.FC<InteractiveDocsProps> = ({ onNavigateToModule }) => {
  const [activeSection, setActiveSection] = useState<SectionId>('mikrotik')
  const [search, setSearch] = useState('')
  const [selectedStepId, setSelectedStepId] = useState('')
  const [guidedMode, setGuidedMode] = useState(() => safeStorage.getItem(GUIDED_MODE_STORAGE_KEY) === 'true')
  const [progress, setProgress] = useState<ProgressState>(() => parseStoredProgress(safeStorage.getItem(PROGRESS_STORAGE_KEY)))

  const stepsById = useMemo(() => {
    return GUIDE_STEPS.reduce<Record<string, GuideStep>>((acc, step) => {
      acc[step.id] = step
      return acc
    }, {})
  }, [])

  useEffect(() => {
    safeStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    safeStorage.setItem(GUIDED_MODE_STORAGE_KEY, guidedMode ? 'true' : 'false')
  }, [guidedMode])

  const sectionSteps = useMemo(() => {
    return GUIDE_STEPS.filter((step) => step.section === activeSection)
  }, [activeSection])

  const filteredSteps = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sectionSteps
    return sectionSteps.filter((step) => {
      return (
        step.title.toLowerCase().includes(q) ||
        step.summary.toLowerCase().includes(q) ||
        step.why.toLowerCase().includes(q) ||
        step.checklist.some((item) => item.label.toLowerCase().includes(q))
      )
    })
  }, [search, sectionSteps])

  useEffect(() => {
    if (!filteredSteps.length) {
      setSelectedStepId('')
      return
    }
    const selectedStillVisible = filteredSteps.some((step) => step.id === selectedStepId)
    if (!selectedStillVisible) {
      setSelectedStepId(filteredSteps[0].id)
    }
  }, [filteredSteps, selectedStepId])

  const selectedStep = useMemo(() => {
    return filteredSteps.find((step) => step.id === selectedStepId) || filteredSteps[0] || null
  }, [filteredSteps, selectedStepId])

  const firstPendingStep = useMemo(() => {
    return sectionSteps.find((step) => !progress[step.id]?.done) || sectionSteps[0] || null
  }, [progress, sectionSteps])

  useEffect(() => {
    if (!guidedMode) return
    setSearch('')
    const inCurrentSection = sectionSteps.some((step) => step.id === selectedStepId)
    if (inCurrentSection) return
    if (firstPendingStep) setSelectedStepId(firstPendingStep.id)
  }, [activeSection, firstPendingStep, guidedMode, sectionSteps, selectedStepId])

  const sectionProgress = useMemo(() => {
    const total = sectionSteps.length
    const completed = sectionSteps.filter((step) => progress[step.id]?.done).length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, percent }
  }, [progress, sectionSteps])

  const totalProgress = useMemo(() => {
    const total = GUIDE_STEPS.length
    const completed = GUIDE_STEPS.filter((step) => progress[step.id]?.done).length
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0
    return { total, completed, percent }
  }, [progress])

  const getStepCheckProgress = useCallback(
    (step: GuideStep) => {
      const checks = progress[step.id]?.checks || {}
      const completedChecks = step.checklist.filter((item) => Boolean(checks[item.id])).length
      return { completedChecks, totalChecks: step.checklist.length }
    },
    [progress]
  )

  const toggleChecklistItem = useCallback(
    (stepId: string, checkId: string) => {
      setProgress((prev) => {
        const step = stepsById[stepId]
        if (!step) return prev
        const current = prev[stepId] || { done: false, checks: {} }
        const nextChecks = { ...current.checks, [checkId]: !current.checks[checkId] }
        const allChecked = step.checklist.length > 0 && step.checklist.every((item) => Boolean(nextChecks[item.id]))
        return {
          ...prev,
          [stepId]: {
            done: allChecked ? true : current.done,
            checks: nextChecks,
          },
        }
      })
    },
    [stepsById]
  )

  const toggleStepDone = useCallback(
    (stepId: string) => {
      setProgress((prev) => {
        const step = stepsById[stepId]
        if (!step) return prev
        const current = prev[stepId] || { done: false, checks: {} }
        if (current.done) {
          return {
            ...prev,
            [stepId]: {
              done: false,
              checks: current.checks,
            },
          }
        }
        const checks = { ...current.checks }
        for (const item of step.checklist) checks[item.id] = true
        return {
          ...prev,
          [stepId]: {
            done: true,
            checks,
          },
        }
      })
    },
    [stepsById]
  )

  const markStepDone = useCallback(
    (stepId: string) => {
      setProgress((prev) => {
        const step = stepsById[stepId]
        if (!step) return prev
        const current = prev[stepId] || { done: false, checks: {} }
        const checks = { ...current.checks }
        for (const item of step.checklist) checks[item.id] = true
        return {
          ...prev,
          [stepId]: {
            done: true,
            checks,
          },
        }
      })
    },
    [stepsById]
  )

  const resetCurrentSection = useCallback(() => {
    setProgress((prev) => {
      const next = { ...prev }
      for (const step of sectionSteps) {
        next[step.id] = { done: false, checks: {} }
      }
      return next
    })
    toast.success('Se reinicio el avance de esta guia.')
  }, [sectionSteps])

  const openModule = useCallback(
    (moduleId?: string) => {
      if (!moduleId) return
      if (!onNavigateToModule) {
        toast('El acceso directo esta disponible dentro del panel admin.')
        return
      }
      onNavigateToModule(moduleId)
      toast.success('Abriendo modulo relacionado.')
    },
    [onNavigateToModule]
  )

  const startGuidedMode = useCallback(() => {
    if (!firstPendingStep) {
      toast('No hay pasos disponibles en esta seccion.')
      return
    }
    setGuidedMode(true)
    setSearch('')
    setSelectedStepId(firstPendingStep.id)
    toast.success('Asistente guiado iniciado.')
  }, [firstPendingStep])

  const stopGuidedMode = useCallback(() => {
    setGuidedMode(false)
    toast('Asistente guiado detenido.')
  }, [])

  const goToNextGuidedStep = useCallback(() => {
    if (!sectionSteps.length) return
    if (!selectedStep) {
      const nextFromStart = sectionSteps.find((step) => !progress[step.id]?.done) || sectionSteps[0]
      setSelectedStepId(nextFromStart.id)
      return
    }
    const currentIndex = sectionSteps.findIndex((step) => step.id === selectedStep.id)
    const next = currentIndex >= 0 ? sectionSteps[currentIndex + 1] : null
    if (next) {
      setSelectedStepId(next.id)
      return
    }
    setGuidedMode(false)
    toast.success('Completaste esta guia.')
  }, [progress, sectionSteps, selectedStep])

  const completeAndContinue = useCallback(() => {
    if (!selectedStep) return
    markStepDone(selectedStep.id)
    goToNextGuidedStep()
  }, [goToNextGuidedStep, markStepDone, selectedStep])

  const copyStepGuide = useCallback(async () => {
    if (!selectedStep) return
    const lines = [
      selectedStep.title,
      '',
      `Resumen: ${selectedStep.summary}`,
      `Objetivo: ${selectedStep.why}`,
      '',
      'Checklist:',
      ...selectedStep.checklist.map((item) => `- ${item.label}`),
    ]
    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Checklist copiado al portapapeles.')
    } catch {
      toast.error('No se pudo copiar el checklist.')
    }
  }, [selectedStep])

  const stepIndex = selectedStep ? filteredSteps.findIndex((step) => step.id === selectedStep.id) : -1
  const prevStep = stepIndex > 0 ? filteredSteps[stepIndex - 1] : null
  const nextStep = stepIndex >= 0 && stepIndex < filteredSteps.length - 1 ? filteredSteps[stepIndex + 1] : null

  const filteredReferences = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return FUNCTION_REFERENCE
    return FUNCTION_REFERENCE.filter((item) => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.useCase.toLowerCase().includes(q)
      )
    })
  }, [search])

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-cyan-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AcademicCapIcon className="mt-0.5 h-8 w-8 text-indigo-700" />
            <div>
              <h2 className="text-2xl font-bold text-indigo-950">Centro de Documentacion Interactiva</h2>
              <p className="text-sm text-indigo-900">
                Entrena al cliente paso a paso para conectar MikroTik, OLT y entender cada funcion del sistema.
              </p>
            </div>
          </div>
          <div className="min-w-[220px] rounded-lg border border-indigo-300 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Progreso total</p>
            <p className="mt-1 text-2xl font-bold text-indigo-900">
              {totalProgress.completed}/{totalProgress.total}
            </p>
            <div className="mt-2 h-2 rounded-full bg-indigo-100">
              <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${totalProgress.percent}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {SECTION_META.map((section) => {
          const isActive = section.id === activeSection
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`rounded-xl border p-4 text-left transition ${
                isActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <p className={`text-sm font-semibold ${isActive ? 'text-indigo-800' : 'text-gray-900'}`}>{section.label}</p>
              <p className={`mt-1 text-xs ${isActive ? 'text-indigo-700' : 'text-gray-600'}`}>{section.description}</p>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-emerald-900">Asistente guiado de implementacion</p>
            <p className="text-xs text-emerald-800">
              Te lleva paso a paso: abre modulo, marca checklist y avanza al siguiente.
            </p>
          </div>
          {!guidedMode ? (
            <button
              onClick={startGuidedMode}
              className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Iniciar guia de esta seccion
            </button>
          ) : (
            <button
              onClick={stopGuidedMode}
              className="rounded-lg border border-emerald-400 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
            >
              Detener guia
            </button>
          )}
        </div>

        {guidedMode && selectedStep && (
          <div className="mt-3 rounded-lg border border-emerald-300 bg-white p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Paso actual</p>
            <p className="mt-1 text-sm font-semibold text-gray-900">{selectedStep.title}</p>
            <p className="mt-1 text-xs text-gray-700">{selectedStep.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {selectedStep.moduleId && (
                <button
                  onClick={() => openModule(selectedStep.moduleId)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  {selectedStep.moduleLabel || 'Abrir modulo'}
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={completeAndContinue}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                Marcar completado y continuar
              </button>
              <button
                onClick={goToNextGuidedStep}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
              >
                Saltar al siguiente paso
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar pasos, funciones o checklist..."
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm text-gray-900"
            />
          </div>
          <div className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
            Avance de seccion: <strong>{sectionProgress.completed}</strong>/{sectionProgress.total}
          </div>
          <button
            onClick={resetCurrentSection}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            <ClipboardDocumentCheckIcon className="h-4 w-4" />
            Reiniciar esta seccion
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white xl:col-span-1">
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Pasos guiados</p>
            <p className="text-xs text-gray-500">Selecciona un paso para abrir el detalle operativo.</p>
          </div>
          <div className="max-h-[560px] space-y-2 overflow-y-auto p-3">
            {filteredSteps.map((step) => {
              const isActive = selectedStep?.id === step.id
              const done = Boolean(progress[step.id]?.done)
              const checks = getStepCheckProgress(step)
              return (
                <button
                  key={step.id}
                  onClick={() => setSelectedStepId(step.id)}
                  className={`w-full rounded-lg border p-3 text-left transition ${
                    isActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm font-semibold ${isActive ? 'text-indigo-900' : 'text-gray-900'}`}>{step.title}</p>
                    {done && <CheckCircleIcon className="h-5 w-5 text-emerald-600" />}
                  </div>
                  <p className={`mt-1 text-xs ${isActive ? 'text-indigo-800' : 'text-gray-600'}`}>{step.summary}</p>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Checklist: {checks.completedChecks}/{checks.totalChecks}
                  </p>
                </button>
              )
            })}
            {!filteredSteps.length && (
              <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                No hay resultados para esta busqueda.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4 xl:col-span-2">
          {selectedStep ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">{selectedStep.title}</h3>
                  <p className="mt-1 text-sm text-gray-700">{selectedStep.summary}</p>
                  <p className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                    Por que importa: {selectedStep.why}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={copyStepGuide}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Copiar checklist
                  </button>
                  {selectedStep.moduleId && (
                    <button
                      onClick={() => openModule(selectedStep.moduleId)}
                      className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700"
                    >
                      {selectedStep.moduleLabel || 'Abrir modulo'}
                      <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-700">Checklist interactivo</p>
                  <button
                    onClick={() => toggleStepDone(selectedStep.id)}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold ${
                      progress[selectedStep.id]?.done
                        ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {progress[selectedStep.id]?.done ? 'Marcar pendiente' : 'Marcar paso completo'}
                  </button>
                </div>
                <div className="space-y-2">
                  {selectedStep.checklist.map((item) => (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(progress[selectedStep.id]?.checks?.[item.id])}
                        onChange={() => toggleChecklistItem(selectedStep.id, item.id)}
                        className="rounded border-gray-300"
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => prevStep && setSelectedStepId(prevStep.id)}
                  disabled={!prevStep}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Paso anterior
                </button>
                <button
                  onClick={() => nextStep && setSelectedStepId(nextStep.id)}
                  disabled={!nextStep}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Siguiente paso
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
              No hay pasos disponibles para esta vista.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardDocumentCheckIcon className="h-5 w-5 text-gray-700" />
          <h3 className="text-lg font-semibold text-gray-900">Para que sirve cada funcion</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {filteredReferences.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <item.icon className="h-6 w-6 text-indigo-700" />
                <button
                  onClick={() => openModule(item.moduleId)}
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-100"
                >
                  Abrir
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{item.name}</p>
              <p className="mt-1 text-xs text-gray-700">{item.summary}</p>
              <p className="mt-2 text-[11px] text-gray-500">Uso recomendado: {item.useCase}</p>
            </div>
          ))}
          {!filteredReferences.length && (
            <div className="md:col-span-2 xl:col-span-4 rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
              No hay funciones para este filtro.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default InteractiveDocs
