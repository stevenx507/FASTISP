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
      <div className="p-6 bg-gray-800 border border-gray-700 rounded-lg shadow-lg animate-pulse">
        <div className="flex items-center text-gray-400">
          <SparklesIcon className="h-6 w-6 mr-3 animate-spin" />
          <h3 className="text-xl font-semibold">Generando diagnóstico con IA...</h3>
        </div>
        <div className="mt-4 space-y-3">
          <div className="h-4 bg-gray-700 rounded w-3/4"></div>
          <div className="h-4 bg-gray-700 rounded w-1/2"></div>
          <div className="h-4 bg-gray-700 rounded w-5/6"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-700 text-red-300 rounded-lg shadow-lg">
        <div className="flex items-center">
          <ExclamationTriangleIcon className="h-6 w-6 mr-3" />
          <h3 className="text-xl font-semibold">Error en el Diagnóstico</h3>
        </div>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (!analysis) {
    return null; // No mostrar nada si no hay análisis ni error
  }

  return (
    <div className="p-6 bg-gray-800 border border-gray-700 rounded-lg shadow-lg">
      <div className="flex items-center text-cyan-400">
        <SparklesIcon className="h-6 w-6 mr-3" />
        <h3 className="text-2xl font-semibold">Análisis de Red por IA</h3>
      </div>
      <div className="mt-4 prose prose-invert max-w-none prose-pre:bg-gray-900 prose-pre:rounded-md prose-pre:p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {analysis}
        </ReactMarkdown>
      </div>
    </div>
  );
};

export default AIDiagnosis;
