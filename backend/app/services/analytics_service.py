"""Service for daily KPI aggregation to support capacity planning."""

from __future__ import annotations

from datetime import datetime
from statistics import mean
from typing import Any, Dict, List


class AnalyticsService:
    @staticmethod
    def build_daily_network_kpis(router_snapshots: List[Dict[str, Any]]) -> Dict[str, Any]:
        if not router_snapshots:
            return {
                'generated_at': datetime.utcnow().isoformat() + 'Z',
                'routers_total': 0,
                'routers_healthy': 0,
                'avg_health_score': 0.0,
                'avg_cpu_load': 0.0,
                'critical_alerts': 0,
            }

        health_scores: List[float] = []
        cpu_loads: List[float] = []
        routers_healthy = 0
        critical_alerts = 0

        for snapshot in router_snapshots:
            score = float(snapshot.get('health_score', 0) or 0)
            health_scores.append(score)
            if score >= 80:
                routers_healthy += 1

            router = snapshot.get('router', {}) if isinstance(snapshot, dict) else {}
            cpu_raw = str(router.get('cpu_load', '0')).replace('%', '').strip()
            try:
                cpu_loads.append(float(cpu_raw))
            except (TypeError, ValueError):
                cpu_loads.append(0.0)

            for alert in snapshot.get('alerts', []) if isinstance(snapshot.get('alerts', []), list) else []:
                if str(alert.get('severity', '')).lower() == 'critical':
                    critical_alerts += 1

        return {
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'routers_total': len(router_snapshots),
            'routers_healthy': routers_healthy,
            'avg_health_score': round(mean(health_scores), 2),
            'avg_cpu_load': round(mean(cpu_loads), 2),
            'critical_alerts': critical_alerts,
        }


analytics_service = AnalyticsService()
