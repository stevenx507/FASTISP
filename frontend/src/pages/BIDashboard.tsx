import React, { useState, useEffect } from 'react';
import { 
  ArrowTrendingUpIcon as TrendingUp, 
  UsersIcon as Users, 
  CurrencyDollarIcon as DollarSign, 
  UserMinusIcon as UserMinus, 
  MapIcon, 
  ArrowUpRightIcon as ArrowUpRight, 
  ArrowDownRightIcon as ArrowDownRight,
  ChartBarIcon as Activity
} from '@heroicons/react/24/outline';
import { apiClient } from '../lib/apiClient';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface BIMetrics {
  mrr: number;
  arpu: number;
  churn_rate: number;
  ltv: number;
  active_clients: number;
  timestamp: string;
}

const BIDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<BIMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
  }, []);

  const fetchMetrics = async () => {
    try {
      const data = await apiClient.get('/admin/analytics/business');
      setMetrics(data);
    } catch (error) {
      console.error('Error fetching BI metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  // Mock data for charts (in a real app, this would come from the backend)
  const growthData = [
    { name: 'Ene', mrr: 4200, clients: 120 },
    { name: 'Feb', mrr: 4500, clients: 128 },
    { name: 'Mar', mrr: 4800, clients: 135 },
    { name: 'Abr', mrr: 5100, clients: 142 },
    { name: 'May', mrr: 5400, clients: 151 },
    { name: 'Jun', mrr: 5800, clients: 165 },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FDF5E6] flex items-center justify-center">
        <Activity className="w-12 h-12 text-coral-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDF5E6] text-slate-800 p-6">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-coral-500 to-coral-600 bg-clip-text text-transparent">
              Business Intelligence
            </h1>
            <p className="text-slate-500 mt-1">Métricas de crecimiento y salud financiera</p>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 text-slate-700 font-medium shadow-sm">
              <MapIcon className="w-4 h-4" /> Mapa de Calor
            </button>
            <button className="px-4 py-2 bg-coral-500 text-white rounded-lg hover:bg-coral-600 transition-colors font-medium shadow-sm">
              Exportar Reporte
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard 
            title="MRR" 
            value={`$${metrics?.mrr?.toLocaleString() || '0'}`} 
            change="+12.5%" 
            trend="up"
            icon={<DollarSign className="w-6 h-6 text-emerald-400" />}
            description="Ingresos Mensuales Recurrentes"
          />
          <MetricCard 
            title="Clientes Activos" 
            value={metrics?.active_clients?.toString() || '0'} 
            change="+8.2%" 
            trend="up"
            icon={<Users className="w-6 h-6 text-blue-400" />}
            description="Crecimiento neto este mes"
          />
          <MetricCard 
            title="Churn Rate" 
            value={`${metrics?.churn_rate || 0}%`} 
            change="-1.2%" 
            trend="down"
            icon={<UserMinus className="w-6 h-6 text-rose-400" />}
            description="Tasa de cancelación mensual"
          />
          <MetricCard 
            title="LTV" 
            value={`$${metrics?.ltv?.toLocaleString() || '0'}`} 
            change="+5.4%" 
            trend="up"
            icon={<TrendingUp className="w-6 h-6 text-indigo-400" />}
            description="Valor de vida del cliente"
          />
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm">
            <h3 className="text-lg font-semibold mb-6">Crecimiento de Ingresos (MRR)</h3>
            <div className="h-[300px]">
              <Line 
                data={{
                  labels: growthData.map(d => d.name),
                  datasets: [{
                    label: 'MRR',
                    data: growthData.map(d => d.mrr),
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4
                  }]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' } },
                    x: { grid: { display: false }, ticks: { color: '#64748b' } }
                  }
                }}
              />
            </div>
          </div>

          <div className="bg-white border border-gray-100 p-6 rounded-2xl shadow-sm">
            <h3 className="text-lg font-semibold mb-6">Adquisición de Clientes</h3>
            <div className="h-[300px]">
              <Bar 
                data={{
                  labels: growthData.map(d => d.name),
                  datasets: [{
                    label: 'Clientes',
                    data: growthData.map(d => d.clients),
                    backgroundColor: '#6366f1',
                    borderRadius: 4
                  }]
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  scales: {
                    y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b' } },
                    x: { grid: { display: false }, ticks: { color: '#64748b' } }
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer info */}
        <div className="flex justify-between items-center text-slate-500 text-sm">
          <p className="text-slate-500 text-sm">Última actualización: {metrics ? new Date(metrics.timestamp).toLocaleString() : '---'}</p>
          <p className="text-slate-400 text-sm">ISPFAST Intelligence Engine v5.0</p>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, change, trend, icon, description }: any) => (
  <div className="bg-white border border-gray-100 p-6 rounded-2xl hover:border-coral-200 hover:shadow-md transition-all group shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <div className="p-3 bg-gray-50 rounded-xl group-hover:scale-110 transition-transform border border-gray-100">
        {icon}
      </div>
      <div className={`flex items-center gap-1 text-sm font-medium ${trend === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
        {change}
        {trend === 'up' ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
      </div>
    </div>
    <div className="space-y-1">
      <h3 className="text-slate-500 text-sm font-medium">{title}</h3>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-slate-400 text-xs mt-2">{description}</p>
    </div>
  </div>
);

export default BIDashboard;
