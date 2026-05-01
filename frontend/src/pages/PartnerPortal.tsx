import React, { useState, useEffect } from 'react';
import { 
  ArrowTrendingUpIcon as TrendingUp, 
  UserPlusIcon as UserPlus, 
  CurrencyDollarIcon as Wallet, 
  ClockIcon as History, 
  ChevronRightIcon as ChevronRight,
  StarIcon as Award,
  XMarkIcon as X,
  HandRaisedIcon as Handshake
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { apiClient } from '../lib/apiClient';

const PartnerPortal: React.FC = () => {
  const [partnerData, setPartnerData] = useState<any>(null);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newProspect, setNewProspect] = useState({ name: '', phone: '', address: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const stats = await apiClient.get('/partner/stats');
      setPartnerData(stats);

      const comms = await apiClient.get('/partner/commissions');
      setCommissions(comms);
    } catch (error) {
      console.error('Error fetching partner data:', error);
      toast.error('Error al cargar datos del portal');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterProspect = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiClient.post('/partner/prospects', newProspect);
      toast.success('Prospecto registrado exitosamente');
      setShowModal(false);
      setNewProspect({ name: '', phone: '', address: '' });
      fetchData();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al registrar';
      toast.error(message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDF5E6] flex items-center justify-center">
        <Handshake className="w-12 h-12 text-coral-500 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDF5E6] text-slate-800 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-coral-500 rounded-2xl shadow-lg shadow-coral-500/25">
              <Award className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Portal de Aliados</h1>
              <p className="text-slate-500">Bienvenido, {partnerData?.name}</p>
            </div>
          </div>
          <div className="flex gap-3 w-full md:w-auto">
            <button 
              onClick={() => setShowModal(true)}
              className="flex-1 md:flex-none px-6 py-2.5 bg-coral-500 hover:bg-coral-600 rounded-xl transition-all font-semibold flex items-center justify-center gap-2 text-white shadow-sm"
            >
              <UserPlus className="w-5 h-5" /> Registrar Prospecto
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <Wallet className="w-6 h-6 text-emerald-400" />
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-full">DISPONIBLE</span>
            </div>
            <p className="text-slate-500 text-sm mb-1">Comisiones por Cobrar</p>
            <p className="text-3xl font-bold text-slate-900">${partnerData?.balance?.toFixed(2) || '0.00'}</p>
          </div>

          <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <TrendingUp className="w-6 h-6 text-blue-400" />
            </div>
            <p className="text-slate-500 text-sm mb-1">Ventas Totales</p>
            <p className="text-3xl font-bold text-slate-900">{partnerData?.totalSales || 0}</p>
          </div>

          <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <Award className="w-6 h-6 text-indigo-400" />
              <span className="text-xs font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-full">{partnerData?.rank || 'Bronze'}</span>
            </div>
            <p className="text-slate-500 text-sm mb-1">Nivel de Aliado</p>
            <p className="text-3xl font-bold text-slate-900">{partnerData?.commission_rate || 0}%</p>
            <p className="text-xs text-slate-500 mt-2">Comisión actual por venta</p>
          </div>
        </div>

        <div className="bg-gray-100 border border-gray-200 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-gray-200 flex justify-between items-center">
            <h3 className="font-bold flex items-center gap-2">
              <History className="w-5 h-5 text-slate-500" /> Historial de Comisiones
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {commissions.length > 0 ? commissions.map((comm: any) => (
              <div key={comm.id} className="p-4 flex justify-between items-center hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`w-2 h-2 rounded-full ${comm.status === 'paid' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <div>
                    <p className="font-medium text-slate-800">{comm.client_name || 'Desconocido'}</p>
                    <p className="text-xs text-slate-500">{comm.created_at ? new Date(comm.created_at).toLocaleDateString() : '---'}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-emerald-400">+${comm.amount?.toFixed(2) || '0.00'}</p>
                  <p className={`text-[10px] font-bold uppercase tracking-wider ${comm.status === 'paid' ? 'text-emerald-500' : 'text-amber-500'}`}>
                    {comm.status === 'paid' ? 'Pagado' : 'Pendiente'}
                  </p>
                </div>
              </div>
            )) : (
              <div className="p-12 text-center text-slate-500">
                Aún no tienes comisiones registradas.
              </div>
            )}
          </div>
        </div>

        {/* Modal Registro */}
        {showModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white border border-gray-200 rounded-3xl w-full max-w-md overflow-hidden">
              <div className="p-6 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-xl font-bold">Nuevo Prospecto</h3>
                <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-50 rounded-full transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={handleRegisterProspect} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm text-slate-600 font-medium mb-1">Nombre Completo</label>
                  <input 
                    type="text" required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 outline-none text-slate-800 placeholder-slate-400"
                    value={newProspect.name}
                    onChange={e => setNewProspect({...newProspect, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 font-medium mb-1">Teléfono</label>
                  <input 
                    type="text" required
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 outline-none text-slate-800 placeholder-slate-400"
                    value={newProspect.phone}
                    onChange={e => setNewProspect({...newProspect, phone: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-600 font-medium mb-1">Dirección</label>
                  <textarea 
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 focus:border-coral-400 focus:ring-2 focus:ring-coral-500/10 outline-none h-24 text-slate-800 placeholder-slate-400"
                    value={newProspect.address}
                    onChange={e => setNewProspect({...newProspect, address: e.target.value})}
                  />
                </div>
                <button type="submit" className="w-full py-4 bg-coral-500 text-white rounded-2xl font-bold hover:bg-coral-600 transition-all shadow-lg shadow-coral-500/20">
                  Registrar Prospecto
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PartnerPortal;
