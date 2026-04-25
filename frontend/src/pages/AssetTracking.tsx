import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  CubeIcon, 
  HashtagIcon, 
  QrCodeIcon, 
  ArrowPathIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  IdentificationIcon,
  TagIcon,
  EllipsisVerticalIcon
} from '@heroicons/react/24/outline';
import { apiClient } from '../lib/apiClient';
import toast from 'react-hot-toast';
import Badge from '../components/Badge';

interface ProductUnit {
  id: number;
  product_id: number;
  serial_number: string;
  mac_address?: string;
  status: 'available' | 'assigned' | 'faulty' | 'maintenance';
  created_at: string;
  notes?: string;
}

interface Product {
  id: number;
  name: string;
  sku: string;
}

const AssetTracking: React.FC = () => {
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUnit, setNewUnit] = useState({
    product_id: '',
    serial_number: '',
    mac_address: '',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [unitsRes, productsRes]: any = await Promise.all([
        apiClient.get('/admin/inventory/units'),
        apiClient.get('/admin/inventory/products')
      ]);
      setUnits(unitsRes.items || []);
      setProducts(productsRes.items || []);
    } catch (error) {
      toast.error('Error al cargar activos');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnit.product_id || !newUnit.serial_number) {
      toast.error('Faltan campos requeridos');
      return;
    }

    try {
      await apiClient.post('/admin/inventory/units', newUnit);
      toast.success('Equipo registrado con éxito');
      setShowAddModal(false);
      setNewUnit({ product_id: '', serial_number: '', mac_address: '', notes: '' });
      fetchData();
    } catch (error) {
      toast.error('Error al registrar serial');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'available': return 'emerald';
      case 'assigned': return 'blue';
      case 'faulty': return 'rose';
      case 'maintenance': return 'amber';
      default: return 'slate';
    }
  };

  const filteredUnits = units.filter(u => 
    u.serial_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.mac_address?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-6 space-y-8 min-h-screen bg-slate-950 text-slate-200">
      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center">
            <QrCodeIcon className="w-8 h-8 mr-3 text-blue-500" />
            Trazabilidad de Seriales
          </h1>
          <p className="text-slate-400 mt-1">Control individual de equipos y activos por número de serie único.</p>
        </div>
        
        <div className="flex items-center space-x-3">
          <button 
            onClick={fetchData}
            className="p-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors"
          >
            <ArrowPathIcon className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95"
          >
            <PlusIcon className="w-5 h-5 mr-2" />
            Nuevo Serial
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[
          { label: 'Total Unidades', value: units.length, icon: CubeIcon, color: 'text-blue-400' },
          { label: 'Disponibles', value: units.filter(u => u.status === 'available').length, icon: TagIcon, color: 'text-emerald-400' },
          { label: 'En Cliente', value: units.filter(u => u.status === 'assigned').length, icon: IdentificationIcon, color: 'text-indigo-400' },
          { label: 'Averías', value: units.filter(u => u.status === 'faulty').length, icon: HashtagIcon, color: 'text-rose-400' },
        ].map((stat, i) => (
          <motion.div 
            key={i}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white/5 backdrop-blur-xl border border-white/10 p-6 rounded-2xl shadow-xl hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center justify-between">
              <stat.icon className={`w-8 h-8 ${stat.color} opacity-80`} />
              <span className="text-2xl font-black text-white">{stat.value}</span>
            </div>
            <p className="mt-4 text-sm font-medium text-slate-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Main Table Area */}
      <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex flex-col md:flex-row gap-4 justify-between bg-white/[0.02]">
          <div className="relative flex-grow max-w-md">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input 
              type="text"
              placeholder="Buscar por serial o MAC..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900/50 border border-white/10 rounded-xl py-2.5 pl-11 pr-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
            />
          </div>
          
          <div className="flex space-x-2">
            <select className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-sm text-slate-300 focus:outline-none">
              <option value="">Todos los Estados</option>
              <option value="available">Disponible</option>
              <option value="assigned">Asignado</option>
              <option value="faulty">Averiado</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-slate-500 text-xs font-bold uppercase tracking-widest border-b border-white/10">
                <th className="px-6 py-4">Equipo / Producto</th>
                <th className="px-6 py-4">Serial #</th>
                <th className="px-6 py-4">MAC Address</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredUnits.length > 0 ? filteredUnits.map((unit) => {
                const product = products.find(p => p.id === unit.product_id);
                return (
                  <motion.tr 
                    layout
                    key={unit.id} 
                    className="hover:bg-white/[0.03] transition-colors group"
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center">
                        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center mr-3">
                          <CubeIcon className="w-6 h-6 text-blue-400" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-white">{product?.name || 'Producto Desconocido'}</p>
                          <p className="text-[10px] text-slate-500 font-mono tracking-tighter uppercase">{product?.sku || 'NO-SKU'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-sm font-mono text-slate-300 bg-white/5 px-2 py-1 rounded border border-white/5">{unit.serial_number}</span>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-sm font-mono text-slate-400">{unit.mac_address || '—'}</span>
                      {(unit as any).total_length && (
                        <p className="text-[10px] text-blue-400 mt-1">
                          Len: {(unit as any).remaining_length}/{(unit as any).total_length}m
                        </p>
                      )}
                    </td>

                    <td className="px-6 py-5">
                      <Badge variant={getStatusColor(unit.status) as any}>
                        {unit.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <button className="p-2 rounded-lg hover:bg-white/10 text-slate-500 group-hover:text-slate-300 transition-all">
                        <EllipsisVerticalIcon className="w-5 h-5" />
                      </button>
                    </td>
                  </motion.tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} className="px-6 py-20 text-center text-slate-500">
                    <div className="flex flex-col items-center">
                      <CubeIcon className="w-12 h-12 mb-3 opacity-20" />
                      <p>No se encontraron equipos registrados</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Serial Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/10 bg-white/[0.02]">
                <h3 className="text-xl font-bold text-white">Registrar Equipo</h3>
                <p className="text-slate-400 text-sm">Añade una unidad única al inventario con su serial.</p>
              </div>

              <form onSubmit={handleAddUnit} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Producto</label>
                  <select 
                    value={newUnit.product_id}
                    onChange={(e) => setNewUnit({...newUnit, product_id: e.target.value})}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  >
                    <option value="">Seleccionar Producto...</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Número de Serie</label>
                    <input 
                      type="text"
                      required
                      value={newUnit.serial_number}
                      onChange={(e) => setNewUnit({...newUnit, serial_number: e.target.value})}
                      placeholder="S/N: XXXXXXXX"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Dirección MAC</label>
                    <input 
                      type="text"
                      value={newUnit.mac_address}
                      onChange={(e) => setNewUnit({...newUnit, mac_address: e.target.value})}
                      placeholder="00:00:00:00:00:00"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Metraje Total (m)</label>
                    <input 
                      type="number"
                      value={(newUnit as any).total_length || ''}
                      onChange={(e) => setNewUnit({...newUnit, total_length: e.target.value} as any)}
                      placeholder="Ej: 1000"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5 ml-1">Notas</label>
                    <input 
                      type="text"
                      value={newUnit.notes}
                      onChange={(e) => setNewUnit({...newUnit, notes: e.target.value})}
                      placeholder="Obs. adicionales"
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 font-bold hover:bg-white/5 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-500 shadow-lg shadow-blue-900/20 transition-all"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default AssetTracking;
