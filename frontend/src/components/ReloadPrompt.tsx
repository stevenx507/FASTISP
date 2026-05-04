import { useRegisterSW } from 'virtual:pwa-register/react';
import { motion, AnimatePresence } from 'framer-motion';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered() {
      console.log(`Service Worker registrado.`);
    },
    onRegisterError(error) {
      console.log('Error en el registro del Service Worker:', error);
    },
  });

  const handleClose = () => {
    setNeedRefresh(false);
  };

  const handleReload = () => {
    updateServiceWorker(true);
  };

  return (
    <AnimatePresence>
      {needRefresh && (
        <motion.div
          key="reload-prompt"
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.95 }}
          role="alert"
          className="fixed bottom-4 right-4 z-[10000] p-4 bg-white backdrop-blur-md rounded-lg shadow-2xl border border-gray-200 w-full max-w-sm"
        >
          <div className="flex items-start">
            <div className="flex-shrink-0 pt-0.5">
              <InformationCircleIcon className="w-6 h-6 text-blue-500" />
            </div>
            <div className="ml-3 flex-1">
              <p className="text-sm font-medium text-white">Nueva versión disponible</p>
              <p className="mt-1 text-sm text-slate-500">Recarga la aplicación para obtener las últimas mejoras y correcciones.</p>
              <div className="mt-3 flex space-x-3">
                <button
                  onClick={handleReload}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                >
                  Recargar
                </button>
                <button onClick={handleClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white/10 border border-white/20 rounded-md hover:bg-white/15">
                  Más tarde
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ReloadPrompt;
