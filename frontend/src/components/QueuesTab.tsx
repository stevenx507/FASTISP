// frontend/src/components/QueuesTab.tsx
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  XMarkIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon
} from '@heroicons/react/24/outline';
import { QueueItem, RouterStats, Toast, RouterItem } from './types';

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
        queue.name.toLowerCase().includes(queueSearchTerm.toLowerCase()) ||
        queue.target?.toLowerCase().includes(queueSearchTerm.toLowerCase())
    ) || [];

  const indexOfLastQueue = queuesCurrentPage * queuesItemsPerPage;
  const indexOfFirstQueue = indexOfLastQueue - queuesItemsPerPage;
  const currentQueues = filteredQueues.slice(indexOfFirstQueue, indexOfLastQueue);
  const totalQueuePages = Math.ceil(filteredQueues.length / queuesItemsPerPage);
  const paginateQueues = (pageNumber: number) => setQueuesCurrentPage(pageNumber);

  return (
    <div>
      {/* Edit Queue Modal */}
      {editingQueue && (
         <div className="fixed inset-0 z-50 flex items-center justify-center">
         <div className="absolute inset-0 bg-black/40" onClick={() => setEditingQueue(null)}></div>
         <motion.div
           initial={{ opacity: 0, y: 20 }}
           animate={{ opacity: 1, y: 0 }}
           className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
         >
           <div className="flex justify-between items-center mb-4">
             <h4 className="text-lg font-semibold text-gray-900">
               Editar Límite de Cola: <span className="font-mono">{editingQueue.name}</span>
             </h4>
             <button onClick={() => setEditingQueue(null)} className="p-1 rounded-full hover:bg-gray-200">
               <XMarkIcon className="w-6 h-6 text-gray-600" />
             </button>
           </div>
           <form onSubmit={handleUpdateQueueLimit}>
             <p className="text-sm text-gray-600 mb-4">
               Introduce los nuevos límites de velocidad en Megabits por segundo (Mbps).
             </p>
             <div className="grid grid-cols-2 gap-4">
               <div>
                 <label htmlFor="upload" className="block text-sm font-medium text-gray-700">
                   Subida (Upload)
                 </label>
                 <div className="mt-1 relative rounded-md shadow-sm">
                   <input
                     type="number"
                     name="upload"
                     id="upload"
                     defaultValue={parseMaxLimit(editingQueue.max_limit).upload}
                     className="focus:ring-blue-500 focus:border-blue-500 block w-full pr-12 sm:text-sm border-gray-300 rounded-md"
                     placeholder="10"
                     required
                   />
                   <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                     <span className="text-gray-500 sm:text-sm">Mbps</span>
                   </div>
                 </div>
               </div>
               <div>
                 <label htmlFor="download" className="block text-sm font-medium text-gray-700">
                   Bajada (Download)
                 </label>
                 <div className="mt-1 relative rounded-md shadow-sm">
                   <input
                     type="number"
                     name="download"
                     id="download"
                     defaultValue={parseMaxLimit(editingQueue.max_limit).download}
                     className="focus:ring-blue-500 focus:border-blue-500 block w-full pr-12 sm:text-sm border-gray-300 rounded-md"
                     placeholder="50"
                     required
                   />
                   <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                     <span className="text-gray-500 sm:text-sm">Mbps</span>
                   </div>
                 </div>
               </div>
             </div>
             <div className="mt-6 flex justify-end gap-3">
               <button type="button" className="px-4 py-2 rounded bg-gray-200 text-gray-800 hover:bg-gray-300" onClick={() => setEditingQueue(null)}>
                 Cancelar
               </button>
               <button type="submit" disabled={isSavingQueue} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 flex items-center">
                 {isSavingQueue && <ArrowPathIcon className="w-4 h-4 animate-spin mr-2" />}
                 {isSavingQueue ? 'Guardando...' : 'Guardar Cambios'}
               </button>
             </div>
           </form>
         </motion.div>
       </div>
      )}

      {/* Create Queue Modal */}
      {isCreateQueueModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/40" onClick={() => setCreateQueueModalOpen(false)}></div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6"
        >
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-lg font-semibold text-gray-900">Crear Nueva Cola Simple</h4>
            <button onClick={() => setCreateQueueModalOpen(false)} className="p-1 rounded-full hover:bg-gray-200">
              <XMarkIcon className="w-6 h-6 text-gray-600" />
            </button>
          </div>
          <form onSubmit={handleCreateQueue}>
            <div className="space-y-4">
              <div>
                <label htmlFor="create-name" className="block text-sm font-medium text-gray-700">Nombre de la Cola</label>
                <input
                  type="text"
                  name="name"
                  id="create-name"
                  className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                  placeholder="client_123"
                  required
                />
              </div>
              <div>
                <label htmlFor="create-target" className="block text-sm font-medium text-gray-700">Target (IP)</label>
                <input
                  type="text"
                  name="target"
                  id="create-target"
                  className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                  placeholder="192.168.88.100"
                  pattern="^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:[0-9]|[1-2][0-9]|3[0-2]))?$"
                  title="Introduce una dirección IP válida (ej. 192.168.1.10) o un rango CIDR (ej. 192.168.1.0/24)."
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="create-upload" className="block text-sm font-medium text-gray-700">Subida (Mbps)</label>
                  <input
                    type="number"
                    name="upload"
                    id="create-upload"
                    className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                    placeholder="10"
                    min="0.1"
                    step="any"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="create-download" className="block text-sm font-medium text-gray-700">Bajada (Mbps)</label>
                  <input
                    type="number"
                    name="download"
                    id="create-download"
                    className="mt-1 focus:ring-blue-500 focus:border-blue-500 block w-full shadow-sm sm:text-sm border-gray-300 rounded-md"
                    placeholder="50"
                    min="0.1"
                    step="any"
                    required
                  />
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="px-4 py-2 rounded bg-gray-200 text-gray-800 hover:bg-gray-300" onClick={() => setCreateQueueModalOpen(false)}>
                Cancelar
              </button>
              <button type="submit" disabled={isCreatingQueue} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300 flex items-center">
                {isCreatingQueue && <ArrowPathIcon className="w-4 h-4 animate-spin mr-2" />}
                {isCreatingQueue ? 'Creando...' : 'Crear Cola'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
      )}

      {/* Main Content */}
      <div className="flex justify-between items-center mb-4">
        <h4 className="font-semibold text-gray-900">
          Colas de Clientes ({filteredQueues.length} de {routerStats?.queues.length || 0} total)
        </h4>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Buscar por nombre o target..."
            value={queueSearchTerm}
            onChange={(e) => {
              setQueueSearchTerm(e.target.value);
              setQueuesCurrentPage(1);
            }}
            className="block w-full max-w-xs border-gray-300 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
          />
          <button
            onClick={() => setCreateQueueModalOpen(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Crear Nueva Cola
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Target</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Límite</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Uso Actual</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comentario</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {currentQueues?.map((queue) => (
              <tr key={queue.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{queue.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{queue.target}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{queue.max_limit || 'Sin límite'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{queue.rate || '0/0'}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {editingCommentId === queue.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={commentInputValue}
                        onChange={(e) => setCommentInputValue(e.target.value)}
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        autoFocus
                      />
                      <button onClick={() => handleUpdateQueueComment(queue)} className="p-1 text-green-600 hover:bg-green-100 rounded-full">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      </button>
                      <button onClick={() => setEditingCommentId(null)} className="p-1 text-red-600 hover:bg-red-100 rounded-full">
                        <XMarkIcon className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <div
                      className="group flex items-center gap-2 cursor-pointer"
                      onClick={() => {
                        setEditingCommentId(queue.id!);
                        setCommentInputValue(queue.comment || '');
                      }}
                    >
                      <span>{queue.comment || <span className="italic text-gray-400">Sin comentario</span>}</span>
                      <PencilIcon className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    queue.disabled ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'
                  }`}>
                    {queue.disabled ? 'Desactivada' : 'Activa'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-2">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => toggleQueueStatus(queue)}
                      disabled={togglingQueueId === queue.id}
                      className={`flex items-center justify-center w-24 px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                        queue.disabled
                          ? 'bg-green-100 text-green-700 hover:bg-green-200'
                          : 'bg-red-100 text-red-700 hover:bg-red-200'
                      } disabled:opacity-50`}
                    >
                      {togglingQueueId === queue.id ? (
                        <ArrowPathIcon className="w-4 h-4 animate-spin" />
                      ) : (
                        <span>{queue.disabled ? 'Activar' : 'Desactivar'}</span>
                      )}
                    </button>
                    <button onClick={() => setEditingQueue(queue)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-md" title="Editar Límite">
                      <PencilIcon className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => openConfirm(`¿Eliminar la cola "${queue.name}"? Esta acción no se puede deshacer.`, () => deleteQueue(queue))}
                      className="p-2 text-red-500 hover:bg-red-100 rounded-md" title="Eliminar Cola">
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
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => paginateQueues(queuesCurrentPage - 1)}
            disabled={queuesCurrentPage === 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          <span className="text-sm text-gray-700">
            Página {queuesCurrentPage} de {totalQueuePages}
          </span>
          <button
            onClick={() => paginateQueues(queuesCurrentPage + 1)}
            disabled={queuesCurrentPage === totalQueuePages}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
};

export default QueuesTab;
