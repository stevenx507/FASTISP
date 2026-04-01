# Data Platform Baseline

## Current state
- Daily KPI aggregation is implemented in `AnalyticsService`.
- KPI task: `app.tasks.compute_daily_network_kpis`.

## KPI set
- `routers_total`
- `routers_healthy`
- `avg_health_score`
- `avg_cpu_load`
- `critical_alerts`

## Recommended next increments
1. Persist KPI snapshots in time-series storage (InfluxDB/PostgreSQL hypertable).
2. Build dimensional model for billing + network + support data.
3. Add anomaly detection for CPU/load and incident frequency.
4. Expose KPI API endpoint for executive dashboarding.
