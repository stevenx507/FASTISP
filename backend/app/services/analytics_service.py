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
                'generated_at': datetime.now(timezone.utc).isoformat() + 'Z',
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
            'generated_at': datetime.now(timezone.utc).isoformat() + 'Z',
            'routers_total': len(router_snapshots),
            'routers_healthy': routers_healthy,
            'avg_health_score': round(mean(health_scores), 2),
            'avg_cpu_load': round(mean(cpu_loads), 2),
            'critical_alerts': critical_alerts,
        }

    @staticmethod
    def build_business_metrics(tenant_id: int | None = None) -> Dict[str, Any]:
        from app.models import Client, Subscription, Invoice, db
        from sqlalchemy import func
        from datetime import timedelta

        # MRR (Monthly Recurring Revenue)
        mrr_query = db.session.query(func.sum(Subscription.amount)).filter(Subscription.status == 'active')
        if tenant_id:
            mrr_query = mrr_query.filter(Subscription.tenant_id == tenant_id)
        mrr = float(mrr_query.scalar() or 0)

        # ARPU (Average Revenue Per User)
        active_clients_count = Client.query.filter_by(tenant_id=tenant_id).count() if tenant_id else Client.query.count()
        arpu = mrr / active_clients_count if active_clients_count > 0 else 0

        # Churn Rate (simplificado: clientes que pasaron a suspended en los últimos 30 días)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        churned_query = Subscription.query.filter(Subscription.status == 'suspended', Subscription.updated_at >= thirty_days_ago)
        if tenant_id:
            churned_query = churned_query.filter(Subscription.tenant_id == tenant_id)
        churned_count = churned_query.count()
        churn_rate = (churned_count / active_clients_count * 100) if active_clients_count > 0 else 0

        # LTV (Lifetime Value) = ARPU / Churn Rate (mensual)
        ltv = arpu / (churn_rate / 100) if churn_rate > 0 else (arpu * 24) # Fallback a 24 meses

        return {
            "mrr": round(mrr, 2),
            "arpu": round(arpu, 2),
            "churn_rate": round(churn_rate, 2),
            "ltv": round(ltv, 2),
            "active_clients": active_clients_count,
            "timestamp": datetime.now(timezone.utc).isoformat() + "Z"
        }


analytics_service = AnalyticsService()
