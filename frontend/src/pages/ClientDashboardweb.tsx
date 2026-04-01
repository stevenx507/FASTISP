import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import SpeedTestWidget from '../components/SpeedTestWidget'
import SupportChat from '../components/SupportChat'
import { useAuthStore } from '../store/authStore'
import { ArrowPathIcon, XMarkIcon, WifiIcon, SignalIcon, DevicePhoneMobileIcon, CheckBadgeIcon } from '@heroicons/react/24/outline'

interface DashboardStats {
  currentSpeed: string
  ping: string
  monthlyUsage: string
  nextBillAmount: string
  nextBillDue: string
  deviceCount: number
}

const api = {
  fetchStats: async (token: string) => {
    const response = await fetch('/api/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to fetch stats');
    return response.json();
  },
  rebootMainRouter: async (token: string) => {
    const response = await fetch('/api/mikrotik/routers/main/reboot', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error('Failed to reboot main router');
  },
  rebootCPE: async (token: string, clientId: number) => {
    const response = await fetch(`/api/clients/${clientId}/reboot-cpe`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(errorData?.error || 'Failed to reboot CPE');
    }
  }
};

const useDashboard = () => {
  const { user, token } = useAuthStore()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchStats = async () => {
      if (!token) return;
      setIsLoading(true);
      try {
        const data = await api.fetchStats(token);
        setStats(data)
      } catch (error) {
        console.error(error)
        toast.error('No se pudieron cargar las estadísticas del dashboard.')
      } finally {
        setIsLoading(false)
      }
    }
    fetchStats()
  }, [token]);

  const handleRebootMainRouter = useCallback(async () => {
    if (!token) return;
    const toastId = toast.loading('Enviando señal de reinicio al router...')
    try {
      await api.rebootMainRouter(token);
      toast.success('El router se reiniciará en breve.', { id: toastId })
    } catch (error) {
      toast.error('No se pudo reiniciar el router.', { id: toastId })
    }
  }, [token]);

  const handleRebootCPE = useCallback(async () => {
    if (!user?.client_id) {
      toast.error('No se pudo identificar al cliente para el reinicio.')
      return
    }
    if (!token) return;
    const toastId = toast.loading('Enviando señal de reinicio a tu equipo...')
    try {
      await api.rebootCPE(token, user.client_id);
      toast.success('Tu equipo se reiniciará en breve.', { id: toastId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error desconocido.', { id: toastId })
    }
  }, [token, user?.client_id]);

  return { user, stats, isLoading, handleRebootCPE, handleRebootMainRouter };
};

const RebootModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  rebootActions: { label: string; action: () => Promise<void> }[];
}> = ({ isOpen, onClose, rebootActions }) => {
  const [rebootingAction, setRebootingAction] = useState<string | null>(null);

  const handleReboot = async (label: string, rebootFn: () => Promise<void>) => {
    setRebootingAction(label);
    await rebootFn();
    setRebootingAction(null);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
          <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-200 flex justify-between items-center">
              <h3 className="text-lg font-bold text-gray-900">Confirmar Reinicio</h3>
              <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-100"><XMarkIcon className="w-6 h-6" /></button>
            </div>
            <div className="p-6">
              <p className="text-gray-700 mb-6">¿Qué equipo deseas reiniciar? El reinicio puede tardar unos minutos.</p>
              <div className="space-y-4">
                {rebootActions.map(({ label, action }) => (
                  <button
                    key={label}
                    onClick={() => handleReboot(label, action)}
                    disabled={!!rebootingAction}
                    className="w-full flex items-center justify-center space-x-2 px-4 py-3 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
                  >
                    {rebootingAction === label ? <ArrowPathIcon className="w-5 h-5 animate-spin" /> : <ArrowPathIcon className="w-5 h-5" />}
                    <span>{rebootingAction === label ? 'Reiniciando...' : label}</span>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const WelcomeBanner: React.FC<{ name?: string; speed?: string; ping?: string; isLoading: boolean }> = ({ name, speed, ping, isLoading }) => (
  <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6 text-white">
    <div className="flex flex-col md:flex-row md:items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold mb-2">¡Hola, {name?.split(' ')[0]}!</h2>
        <p className="text-blue-100">Tu servicio está funcionando perfectamente</p>
      </div>
      <div className="mt-4 md:mt-0 flex items-center space-x-4">
        <div className="text-center"><div className="text-3xl font-bold">{isLoading ? '...' : speed || 'N/A'}</div><div className="text-blue-100 text-sm">Mbps Actual</div></div>
        <div className="text-center"><div className="text-3xl font-bold">{isLoading ? '...' : ping || 'N/A'}</div><div className="text-blue-100 text-sm">Ping</div></div>
      </div>
    </div>
  </div>
);

const StatsGrid: React.FC<{ stats: DashboardStats | null; isLoading: boolean }> = ({ stats, isLoading }) => {
  const statItems = [
    { label: 'Uso del Mes', value: stats?.monthlyUsage, icon: WifiIcon },
    { label: 'Próxima Factura', value: stats?.nextBillAmount, sub: stats?.nextBillDue, icon: SignalIcon },
    { label: 'Dispositivos', value: stats?.deviceCount, icon: DevicePhoneMobileIcon },
    { label: 'Estado del Servicio', value: 'Activo', sub: 'Todo operativo', icon: CheckBadgeIcon }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {statItems.map((stat, index) => (
        <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.1 }} className="bg-white rounded-xl p-5 shadow border border-gray-200">
          <p className="text-sm text-gray-600">{stat.label}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{isLoading ? '...' : stat.value ?? '...'}</p>
          {stat.sub && <p className="text-xs text-gray-500 mt-1">{isLoading ? '' : stat.sub}</p>}
        </motion.div>
      ))}
    </div>
  );
};

const QuickActions: React.FC<{ onRebootClick: () => void }> = ({ onRebootClick }) => {
  const navigate = useNavigate();
  const actions = [
    { label: 'Ver Facturas', action: () => navigate('/billing'), icon: '🧾' },
    { label: 'Reiniciar Equipo', action: onRebootClick, icon: '🔄' },
    { label: 'Ver Uso Detallado', action: () => navigate('/dashboard/usage'), icon: '📊' },
    { label: 'Invitar Amigos', action: () => toast.success('¡Gracias por recomendarnos!'), icon: '🎁' }
  ];

  return (
    <div className="bg-white rounded-xl shadow border border-gray-200">
      <div className="px-6 py-4 border-b"><h3 className="text-lg font-semibold">Acciones Rápidas</h3></div>
      <div className="p-4 space-y-2">
        {actions.map((item) => (
          <button key={item.label} onClick={item.action} className="w-full flex items-center space-x-4 p-3 text-left rounded-lg hover:bg-gray-100 transition-colors">
            <span className="text-2xl w-8 text-center">{item.icon}</span>
            <div><p className="font-medium text-gray-800">{item.label}</p></div>
          </button>
        ))}
      </div>
    </div>
  );
};

const DashboardHome: React.FC = () => {
  const { user, stats, isLoading, handleRebootCPE, handleRebootMainRouter } = useDashboard();
  const [isRebootModalOpen, setIsRebootModalOpen] = useState(false);

  const rebootActions = [
    { label: 'Mi Equipo (CPE)', action: handleRebootCPE },
    { label: 'Router Principal', action: handleRebootMainRouter },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <WelcomeBanner name={user?.name} speed={stats?.currentSpeed} ping={stats?.ping} isLoading={isLoading} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <StatsGrid stats={stats} isLoading={isLoading} />
          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200"><h3 className="text-lg font-semibold text-gray-900">Prueba de Velocidad 4K</h3></div>
            <div className="p-6"><SpeedTestWidget /></div>
          </div>
        </div>

        <div className="space-y-6">
          <QuickActions onRebootClick={() => setIsRebootModalOpen(true)} />
          <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200"><h3 className="text-lg font-semibold text-gray-900">Soporte IA 24/7</h3></div>
            <div className="p-4"><SupportChat /></div>
          </div>
        </div>
      </div>

      <RebootModal isOpen={isRebootModalOpen} onClose={() => setIsRebootModalOpen(false)} rebootActions={rebootActions} />
    </motion.div>
  );
};

export default DashboardHome;
