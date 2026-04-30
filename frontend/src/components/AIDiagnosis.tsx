// frontend/src/components/AIDiagnosis.tsx
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SparklesIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';

interface AIDiagnosisProps {
  analysis: string | null;
  error: string | null;
  isLoading: boolean;
}

const AIDiagnosis: React.FC<AIDiagnosisProps> = ({ analysis, error, isLoading }) => {
  if (isLoading) {
    return (
      <div className="p-8 bg-white border border-gray-100 rounded-2xl shadow-sm animate-pulse">
        <div className="flex items-center text-coral-500">
          <SparklesIcon className="h-6 w-6 mr-3 animate-bounce" />
          <h3 className="text-xl font-black uppercase tracking-widest">Generando diagnóstico con IA...</h3>
        </div>
        <div className="mt-6 space-y-4">
          <div className="h-3 bg-gray-50 rounded-full w-3/4"></div>
          <div className="h-3 bg-gray-50 rounded-full w-1/2"></div>
          <div className="h-3 bg-gray-50 rounded-full w-5/6"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-coral-50 border border-coral-100 text-coral-800 rounded-2xl shadow-sm">
        <div className="flex items-center">
          <ExclamationTriangleIcon className="h-6 w-6 mr-3 text-coral-500" />
          <h3 className="text-xl font-black uppercase tracking-widest">Error en el Diagnóstico</h3>
        </div>
        <p className="mt-3 text-sm font-medium leading-relaxed opacity-80">{error}</p>
      </div>
    );
  }

  if (!analysis) {
    return null;
  }

  return (
    <div className="p-8 bg-white border border-gray-100 rounded-2xl shadow-sm">
      <div className="flex items-center text-coral-500 mb-6 pb-4 border-b border-gray-50">
        <SparklesIcon className="h-6 w-6 mr-3" />
        <h3 className="text-xl font-black uppercase tracking-widest">Análisis de Red por IA</h3>
      </div>
      <div className="prose prose-slate max-w-none prose-headings:text-slate-800 prose-headings:font-black prose-p:text-slate-600 prose-p:leading-relaxed prose-strong:text-coral-600 prose-code:text-coral-500 prose-code:bg-coral-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-pre:bg-slate-900 prose-pre:text-coral-100">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {analysis}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default AIDiagnosis;
