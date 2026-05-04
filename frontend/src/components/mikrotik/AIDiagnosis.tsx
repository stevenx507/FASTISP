// frontend/src/components/AIDiagnosis.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SparklesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface AIDiagnosisProps {
  analysis: string | null;
  error: string | null;
  isLoading: boolean;
  onRetry?: () => void;
}

const AIDiagnosis: React.FC<AIDiagnosisProps> = ({ analysis, error, isLoading, onRetry }) => {
  if (isLoading) {
    return (
      <div className="p-12 bg-white/80 backdrop-blur-md border border-gray-100 rounded-3xl shadow-xl flex flex-col items-center justify-center space-y-6 animate-pulse">
        <div className="relative">
          <div className="absolute inset-0 bg-coral-400 rounded-full blur-2xl opacity-20 animate-pulse" />
          <SparklesIcon className="h-16 w-16 text-coral-500 relative z-10 animate-bounce" />
        </div>
        <div className="text-center">
          <h3 className="text-2xl font-black uppercase tracking-[0.2em] text-slate-800">Sintetizando Red</h3>
          <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">Nuestra IA está analizando los flujos del router...</p>
        </div>
        <div className="w-64 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-coral-500 w-1/3 animate-[loading_2s_infinite_ease-in-out]" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-10 bg-rose-50/50 backdrop-blur-md border border-rose-100 text-rose-800 rounded-3xl shadow-lg">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-rose-100 rounded-2xl">
            <ExclamationTriangleIcon className="h-8 w-8 text-rose-500" />
          </div>
          <div>
            <h3 className="text-xl font-black uppercase tracking-widest">Anomalía Detectada</h3>
            <p className="text-xs font-bold text-rose-400 uppercase tracking-tight">El diagnóstico no pudo completarse</p>
          </div>
        </div>
        <div className="bg-white/60 p-4 rounded-2xl border border-rose-200/30 text-sm font-medium leading-relaxed mb-6">
          {error}
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="w-full sm:w-auto px-8 py-3 bg-rose-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-600/20"
          >
            Reintentar Análisis
          </button>
        )}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="p-12 text-center border-2 border-dashed border-gray-100 rounded-3xl">
         <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Inicia un diagnóstico para obtener sugerencias de la IA.</p>
         {onRetry && (
           <button 
             onClick={onRetry}
             className="mt-6 px-10 py-4 bg-indigo-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-2xl shadow-indigo-600/20"
           >
             Generar Diagnóstico Ahora
           </button>
         )}
      </div>
    );
  }

  return (
    <div className="p-10 bg-white border border-gray-100 rounded-3xl shadow-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <SparklesIcon className="h-32 w-32 text-indigo-500" />
      </div>
      
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-gray-50 relative z-10">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-50 rounded-2xl">
            <SparklesIcon className="h-8 w-8 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-2xl font-black uppercase tracking-tight text-slate-800">IA Network Insights</h3>
            <p className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em]">Deep packet & topology analysis</p>
          </div>
        </div>
        {onRetry && (
          <button 
            onClick={onRetry}
            className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
            title="Refrescar diagnóstico"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        )}
      </div>

      <div className="prose prose-slate max-w-none 
        prose-headings:text-slate-800 prose-headings:font-black prose-headings:uppercase prose-headings:tracking-tight
        prose-p:text-slate-600 prose-p:leading-relaxed prose-p:text-sm
        prose-strong:text-indigo-600 prose-strong:font-black
        prose-code:text-coral-500 prose-code:bg-coral-50 prose-code:px-2 prose-code:py-0.5 prose-code:rounded-lg prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-slate-900 prose-pre:text-indigo-100 prose-pre:rounded-2xl prose-pre:p-6
        prose-li:text-slate-600 prose-li:text-sm
        relative z-10"
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {analysis}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default AIDiagnosis;
