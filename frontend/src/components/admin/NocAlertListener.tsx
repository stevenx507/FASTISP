import React, { useEffect } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'react-hot-toast';
import config from '../../lib/config';
import { useAuthStore } from '../../store/authStore';

const NocAlertListener: React.FC = () => {
  const { user } = useAuthStore();

  useEffect(() => {
    // Solo conectar si el usuario es administrador
    if (!user || user.role !== 'admin') return;

    const socketUrl = config.API_BASE_URL.replace('/api', '');
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
    });

    socket.on('connect', () => {
      console.log('NOC Socket connected');
    });

    socket.on('noc_alert', (data) => {
      console.log('NOC Alert received:', data);
      
      toast.custom(
        (t) => (
          <div
            className={`${
              t.visible ? 'animate-enter' : 'animate-leave'
            } max-w-md w-full bg-slate-900 shadow-lg rounded-lg pointer-events-auto flex ring-1 ring-black ring-opacity-5 border-l-4 border-red-500`}
          >
            <div className="flex-1 w-0 p-4">
              <div className="flex items-start">
                <div className="flex-shrink-0 pt-0.5">
                  <div className="h-10 w-10 rounded-full bg-red-500/20 flex items-center justify-center">
                    <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                </div>
                <div className="ml-3 flex-1">
                  <p className="text-sm font-bold text-white">
                    {data.title || 'Alerta de Red'}
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {data.message}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Router: {data.router_name}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex border-l border-white/10">
              <button
                onClick={() => toast.dismiss(t.id)}
                className="w-full border border-transparent rounded-none rounded-r-lg p-4 flex items-center justify-center text-sm font-medium text-red-400 hover:text-red-300 focus:outline-none"
              >
                Cerrar
              </button>
            </div>
          </div>
        ),
        { duration: 8000 }
      );
    });

    return () => {
      socket.disconnect();
    };
  }, [user]);

  return null;
};

export default NocAlertListener;
