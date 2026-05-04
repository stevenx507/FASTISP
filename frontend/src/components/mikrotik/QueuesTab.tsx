// frontend/src/components/QueuesTab.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  XMarkIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { QueueItem, RouterStats, Toast, RouterItem } from '../types';
import { useDebounce } from '../../hooks/useDebounce';

interface QueuesTabProps {
  routerStats: RouterStats | null;
  setRouterStats: React.Dispatch<React.SetStateAction<RouterStats | null>>;
  selectedRouter: RouterItem | null;
  apiFetch: (path: string, options?: RequestInit) => Promise<Response>;
  addToast: (type: Toast['type'], message: string) => void;
  openConfirm: (message: string, onConfirm: () => void) => void;
}

const QueuesTab: React.FC<QueuesTabProps> = ({ 
  routerStats,
  setRouterStats,
  selectedRouter,
  apiFetch,
  addToast,
  openConfirm,
}) => {
  // State for this tab
  const [queuesCurrentPage, setQueuesCurrentPage] = useState(1);
  const queuesItemsPerPage = 10;
  const [queueSearchTerm, setQueueSearchTerm] = useState('');
  const debouncedQueueSearch = useDebounce(queueSearchTerm, 300);
  const [togglingQueueId, setTogglingQueueId] = useState<string | null>(null);

  const [editingQueue, setEditingQueue] = useState<QueueItem | null>(null);
  const [isSavingQueue, setIsSavingQueue] = useState(false);

  const [isCreateQueueModalOpen, setCreateQueueModalOpen] = useState(false);
  const [isCreatingQueue, setIsCreatingQueue] = useState(false);

  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentInputValue, setCommentInputValue] = useState('');

  // Functions moved from parent
  const toggleQueueStatus = async (queue: QueueItem) => {
    if (!selectedRouter || !queue.id) return;
    setTogglingQueueId(queue.id);
    try {
      // This API endpoint seems incorrect based on REST principles. It was in the original component.
      // A better endpoint might be PATCH /api/mikrotik/routers/{routerId}/queues/{queueId}
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/queues/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: queue.id, disable: !queue.disabled }),
      });
      const data = await response.json().catch(() => ({ success: false }));
      if (response.ok && data.success) {
        addToast('success', `Cola ${queue.name} ${!queue.disabled ? 'desactivada' : 'activada'}.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            queues: prev.queues.map((q) =>
              q.id === queue.id ? { ...q, disabled: !q.disabled } : q
            ),
          };
        });
      } else {
        addToast('error', 'No se pudo cambiar el estado de la cola.');
      }
    } catch (error) {
      console.error('Error toggling queue status:', error);
      addToast('error', 'Error de red al cambiar estado de la cola.');
    } finally {
      setTogglingQueueId(null);
    }
  };

  const handleUpdateQueueLimit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRouter || !editingQueue || !editingQueue.id) return;

    const formData = new FormData(event.currentTarget);
    const download = formData.get('download') as string;
    const upload = formData.get('upload') as string;

    if (!download || !upload) {
      addToast('error', 'Las velocidades de subida y bajada son requeridas.');
      return;
    }

    setIsSavingQueue(true);
    try {
        // This API endpoint seems incorrect based on REST principles.
        // A better endpoint might be PUT /api/mikrotik/routers/{routerId}/queues/{queueId}/limit
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/queues/update-limit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingQueue.id, download, upload }),
      });

      const data = await response.json().catch(() => ({ success: false }));

      if (response.ok && data.success) {
        addToast('success', `Límite de la cola ${editingQueue.name} actualizado.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            queues: prev.queues.map((q) =>
              q.id === editingQueue.id ? { ...q, max_limit: `${upload}M/${download}M` } : q
            ),
          };
        });
        setEditingQueue(null);
      } else {
        addToast('error', data.error || 'No se pudo actualizar el límite de la cola.');
      }
    } catch (error) {
      console.error('Error updating queue limit:', error);
      addToast('error', 'Error de red al actualizar el límite.');
    } finally {
      setIsSavingQueue(false);
    }
  };

  const parseMaxLimit = (maxLimit: string | undefined): { upload: string; download: string } => {
    if (!maxLimit) return { upload: '', download: '' };
    const parts = maxLimit.replace(/M/g, '').split('/');
    return parts.length === 2 ? { upload: parts[0], download: parts[1] } : { upload: '', download: '' };
  };

  const handleUpdateQueueComment = async (queue: QueueItem) => {
    if (!selectedRouter || !queue.id || commentInputValue === queue.comment) {
      setEditingCommentId(null);
      return;
    }

    setTogglingQueueId(queue.id); // Reuse loading state
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/queues/update-comment`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: queue.id, comment: commentInputValue }),
      });

      const data = await response.json().catch(() => ({ success: false }));

      if (response.ok && data.success) {
        addToast('success', `Comentario de la cola ${queue.name} actualizado.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            queues: prev.queues.map((q) =>
              q.id === queue.id ? { ...q, comment: commentInputValue } : q
            ),
          };
        });
      } else {
        addToast('error', data.error || 'No se pudo actualizar el comentario.');
      }
    } catch (error) {
      addToast('error', 'Error de red al actualizar el comentario.');
    } finally {
      setEditingCommentId(null);
      setTogglingQueueId(null);
    }
  };

  const isValidIpOrCidr = (ip: string) => {
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$/;
    return ipRegex.test(ip);
  };

  const handleCreateQueue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRouter) return;

    const formData = new FormData(event.currentTarget);
    const name = formData.get('name') as string;
    const target = formData.get('target') as string;
    const download = formData.get('download') as string;
    const upload = formData.get('upload') as string;

    if (!name || !target || !download || !upload) {
      addToast('error', 'Todos los campos son requeridos.');
      return;
    }

    if (!isValidIpOrCidr(target)) {
      addToast('error', 'El campo "Target" debe ser una IP válida o un rango CIDR.');
      return;
    }

    const downloadNum = parseFloat(download);
    const uploadNum = parseFloat(upload);

    if (isNaN(downloadNum) || isNaN(uploadNum) || downloadNum <= 0 || uploadNum <= 0) {
      addToast('error', 'Las velocidades de subida y bajada deben ser números positivos.');
      return;
    }

    setIsCreatingQueue(true);
    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/queues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, target, download, upload }),
      });

      const data = await response.json().catch(() => ({ success: false }));

      if (response.ok && data.success) {
        addToast('success', `Cola "${name}" creada exitosamente.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return { ...prev, queues: [data.queue, ...prev.queues] };
        });
        setCreateQueueModalOpen(false);
      } else {
        addToast('error', data.error || 'No se pudo crear la cola.');
      }
    } catch (error) {
      addToast('error', 'Error de red al crear la cola.');
    } finally {
      setIsCreatingQueue(false);
    }
  };

  const deleteQueue = async (queue: QueueItem) => {
    if (!selectedRouter || !queue.id) return;

    try {
      const response = await apiFetch(`/api/mikrotik/routers/${selectedRouter.id}/queues`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: queue.id }),
      });

      const data = await response.json().catch(() => ({ success: false }));

      if (response.ok && data.success) {
        addToast('success', `Cola "${queue.name}" eliminada.`);
        setRouterStats((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            queues: prev.queues.filter((q) => q.id !== queue.id),
          };
        });
      } else {
        addToast('error', data.error || 'No se pudo eliminar la cola.');
      }
    } catch (error) {
      addToast('error', 'Error de red al eliminar la cola.');
    }
  };

  const filteredQueues =
    routerStats?.queues.filter(
      (queue) =>
        queue.name.toLowerCase().includes(debouncedQueueSearch.toLowerCase()) ||
        queue.target?.toLowerCase().includes(debouncedQueueSearch.toLowerCase())
    ) || [];

  const indexOfLastQueue = queuesCurrentPage * queuesItemsPerPage;
  const indexOfFirstQueue = indexOfLastQueue - queuesItemsPerPage;
  const currentQueues = filteredQueues.slice(indexOfFirstQueue, indexOfLastQueue);
  const totalQueuePages = Math.ceil(filteredQueues.length / queuesItemsPerPage);
  const paginateQueues = (pageNumber: number) => setQueuesCurrentPage(pageNumber);

  return (
    <div className="space-y-6">
      {/* Edit Queue Modal */}
      {editingQueue && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
         <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setEditingQueue(null)}></div>
         <motion.div
           initial={{ opacity: 0, scale: 0.95 }}
           animate={{ opacity: 1, scale: 1 }}
           className="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 border border-gray-100"
         >
           <div className="flex justify-between items-center mb-6">
             <div>
               <h4 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                 Editar Velocidad
               </h4>
               <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Cola: {editingQueue.name}</p>
             </div>
             <button onClick={() => setEditingQueue(null)} className="p-2 rounded-full hover:bg-gray-100 text-slate-400 transition-colors">
               <XMarkIcon className="w-6 h-6" />
             </button>
           </div>
           <form onSubmit={handleUpdateQueueLimit} className="space-y-6">
             <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Subida (Upload)</label>
                 <div className="relative">
                   <input
                     type="number"
                     name="upload"
                     defaultValue={parseMaxLimit(editingQueue.max_limit).upload}
                     className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all"
                     placeholder="10"
                     required
                   />
                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">MBPS</span>
                 </div>
               </div>
               <div className="space-y-2">
                 <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bajada (Download)</label>
                 <div className="relative">
                   <input
                     type="number"
                     name="download"
                     defaultValue={parseMaxLimit(editingQueue.max_limit).download}
                     className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white transition-all"
                     placeholder="50"
                     required
                   />
                   <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">MBPS</span>
                 </div>
               </div>
             </div>
             <div className="flex gap-3 pt-2">
               <button type="button" className="flex-1 py-3 rounded-2xl bg-slate-100 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200 transition-all" onClick={() => setEditingQueue(null)}>
                 Cancelar
               </button>
               <button type="submit" disabled={isSavingQueue} className="flex-1 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-600/20 disabled:opacity-50">
                 {isSavingQueue ? 'Guardando...' : 'Aplicar Cambios'}
               </button>
             </div>
           </form>
         </motion.div>
        </div>
      )}

      {/* Create Queue Modal */}
      {isCreateQueueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setCreateQueueModalOpen(false)}></div>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative bg-white rounded-3xl shadow-2xl max-w-lg w-full p-8 border border-gray-100"
        >
          <div className="flex justify-between items-center mb-6">
            <div>
              <h4 className="text-xl font-black text-slate-800 uppercase tracking-tight">Nueva Cola Simple</h4>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Configuración de ancho de banda</p>
            </div>
            <button onClick={() => setCreateQueueModalOpen(false)} className="p-2 rounded-full hover:bg-gray-100 text-slate-400 transition-colors">
              <XMarkIcon className="w-6 h-6" />
            </button>
          </div>
          <form onSubmit={handleCreateQueue} className="space-y-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Nombre Identificador</label>
              <input
                type="text"
                name="name"
                className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all"
                placeholder="Ej: cliente_residencial_01"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Target (IP o Rango)</label>
              <input
                type="text"
                name="target"
                className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all font-mono"
                placeholder="192.168.88.0/24"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Upload (Mbps)</label>
                <input
                  type="number"
                  name="upload"
                  className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all"
                  placeholder="10"
                  step="any"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Download (Mbps)</label>
                <input
                  type="number"
                  name="download"
                  className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all"
                  placeholder="50"
                  step="any"
                  required
                />
              </div>
            </div>
            <div className="flex gap-3 pt-4">
              <button type="button" className="flex-1 py-3 rounded-2xl bg-slate-100 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-200 transition-all" onClick={() => setCreateQueueModalOpen(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={isCreatingQueue} className="flex-1 py-3 rounded-2xl bg-coral-500 text-white text-xs font-black uppercase tracking-widest hover:bg-coral-600 transition-all shadow-xl shadow-coral-500/20 disabled:opacity-50">
                {isCreatingQueue ? 'Creando...' : 'Crear Cola'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
      )}

      {/* Main Content */}
      <div className="flex flex-wrap justify-between items-center gap-4 mb-2">
        <div>
          <h4 className="text-xl font-black text-slate-800 uppercase tracking-tight">
            Gestión de Ancho de Banda
          </h4>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
            {filteredQueues.length} de {routerStats?.queues.length || 0} colas configuradas
          </p>
        </div>
        <div className="flex items-center gap-3 flex-1 max-w-2xl justify-end">
          <div className="relative flex-1 max-w-sm">
            <input
              type="text"
              placeholder="Buscar por nombre o target..."
              value={queueSearchTerm}
              onChange={(e) => {
                setQueueSearchTerm(e.target.value);
                setQueuesCurrentPage(1);
              }}
              className="w-full bg-slate-50 border border-gray-100 rounded-2xl px-10 py-2.5 text-xs font-bold text-slate-700 outline-none focus:ring-4 focus:ring-indigo-500/10 focus:bg-white transition-all"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <button
            onClick={() => setCreateQueueModalOpen(true)}
            className="px-6 py-2.5 bg-coral-500 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-coral-600 transition-all shadow-lg shadow-coral-500/20 shrink-0"
          >
            Nueva Cola
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-3xl border border-gray-100 shadow-sm bg-white">
        <table className="min-w-full divide-y divide-gray-50">
          <thead className="bg-slate-50/50">
            <tr>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Identificador</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Target / Red</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Plan Contratado</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Uso Tiempo Real</th>
              <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</th>
              <th className="px-6 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {currentQueues.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-sm font-bold text-slate-400 italic">No hay colas que coincidan con la búsqueda.</td>
              </tr>
            )}
            {currentQueues?.map((queue) => (
              <tr key={queue.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-800">{queue.name}</span>
                    {editingCommentId === queue.id ? (
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          type="text"
                          value={commentInputValue}
                          onChange={(e) => setCommentInputValue(e.target.value)}
                          className="px-2 py-1 bg-white border border-indigo-200 rounded text-[10px] font-bold text-slate-700 outline-none"
                          autoFocus
                        />
                        <button onClick={() => handleUpdateQueueComment(queue)} className="text-emerald-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg></button>
                        <button onClick={() => setEditingCommentId(null)} className="text-rose-500"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                      </div>
                    ) : (
                      <span 
                        onClick={() => { setEditingCommentId(queue.id!); setCommentInputValue(queue.comment || ''); }}
                        className="text-[10px] font-bold text-slate-400 cursor-pointer hover:text-indigo-500 flex items-center gap-1 mt-0.5"
                      >
                        {queue.comment || 'Sin comentario'} <PencilIcon className="w-2.5 h-2.5" />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-mono font-bold text-indigo-600">{queue.target}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-black text-slate-700">{queue.max_limit || 'Ilimitado'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-xs font-mono font-bold text-coral-500">{queue.rate || '0/0'}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2.5 py-1 text-[10px] font-black uppercase rounded-lg ${
                    queue.disabled ? 'bg-rose-100 text-rose-600 border border-rose-200' : 'bg-emerald-100 text-emerald-600 border border-emerald-200'
                  }`}>
                    {queue.disabled ? 'Desactivada' : 'Activa'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right space-x-2">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => toggleQueueStatus(queue)}
                      disabled={togglingQueueId === queue.id}
                      className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                        queue.disabled
                          ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                      } disabled:opacity-50`}
                    >
                      {togglingQueueId === queue.id ? '...' : (queue.disabled ? 'Activar' : 'Pausar')}
                    </button>
                    <button onClick={() => setEditingQueue(queue)} className="p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-all" title="Editar Velocidad">
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openConfirm(`¿Eliminar la cola "${queue.name}"? Esta acción no se puede deshacer.`, () => deleteQueue(queue))}
                      className="p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 rounded-xl transition-all" title="Eliminar Cola">
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalQueuePages > 1 && (
        <div className="flex items-center justify-between px-2">
          <button
            onClick={() => paginateQueues(queuesCurrentPage - 1)}
            disabled={queuesCurrentPage === 1}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-50 border border-gray-100 rounded-xl hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Anterior
          </button>
          <span className="text-xs font-bold text-slate-400">
            Página <span className="text-slate-800">{queuesCurrentPage}</span> de <span className="text-slate-800">{totalQueuePages}</span>
          </span>
          <button
            onClick={() => paginateQueues(queuesCurrentPage + 1)}
            disabled={queuesCurrentPage === totalQueuePages}
            className="flex items-center gap-2 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-600 bg-slate-50 border border-gray-100 rounded-xl hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            Siguiente
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default QueuesTab;
