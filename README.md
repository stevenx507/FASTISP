# FASTISP – Plataforma ISP lista para producción

Suite integral para operar un ISP (MikroTik/OLT) con facturación, cobranzas locales, soporte con SLA y NOC operativo. Pensado para competir con Wisphub/Wispro pero autocontenida en Docker + Traefik.

## Qué incluye
- Panel admin y portal cliente (React/Vite/PWA) con login Google opcional.
- Provisión MikroTik/OLT: altas, cambios de plan, suspensión/activación, backups de config y scripts rápidos.
- Facturación e impuestos: facturas, pro‑rateo por cambio de plan, multi domicilio fiscal/IVA. Stripe está apagado; se admiten transferencias/Yape/Nequi/manual con conciliación y comprobantes.
- Tickets con SLA, asignación a técnicos, comentarios y alertas (PagerDuty/Telegram).
- Monitoreo/NOC: InfluxDB para métricas reales por cliente (interface_traffic), Grafana embebido, dashboard NOC (uptime, cortes, colas de suspendidos) y alertas push.
- Seguridad: TLS automático, WAF/GeoIP MaxMind en Traefik, allowlist por IP/país, rotación de claves, secretos por entorno.
- Backups programados: base de datos (pg_dump) y configuraciones MikroTik/OLT hacia `BACKUP_DIR`/cloud.
- PWA con avisos push para clientes (corte/pago) y app móvil ligera para técnicos de campo (tickets, SLA, notas rápidas).
- Integración WonderPush opcional (usar `VITE_WONDERPUSH_WEBKEY`, `WONDERPUSH_APPLICATION_ID`, `WONDERPUSH_ACCESS_TOKEN`).

## Requisitos previos
- Docker + Docker Compose.
- Dominios apuntando a tu VPS: `fastisp.cloud`, `api.fastisp.cloud` (DNS en Hostinger: ns1.dns-parking.com / ns2.dns-parking.com). IP: `187.77.47.232`.
- Archivos `.env.prod` completos (ver sección siguiente).

## Variables clave (.env.prod ejemplo)
```
FRONTEND_URL=https://fastisp.cloud
API_URL=https://api.fastisp.cloud/api
CORS_ORIGINS=https://fastisp.cloud,https://api.fastisp.cloud
TRAEFIK_ACME_EMAIL=ssfybergroup@gmail.com
ALLOW_GOOGLE_LOGIN=true
DATABASE_URL=postgresql://ispmax:FjGaVL3VVbTpRYvAAN4tFA@postgres:5432/ispmax
REDIS_URL=redis://:FjGaVL3VVbTpRYvAAN4tFA@redis:6379/0
SECRET_KEY=...
JWT_SECRET_KEY=...
ENCRYPTION_KEY=...
BACKUP_DIR=/app/backups
VITE_GRAFANA_URL=https://grafana.fastisp.cloud/d/ispfast/overview
GRAFANA_URL=https://grafana.fastisp.cloud/d/ispfast/overview
GRAFANA_HEALTHCHECK_PATH=/api/health
GRAFANA_DATASOURCE_UID=
WAF_IP_ALLOWLIST=0.0.0.0/0
GEOIP_ALLOWLIST=   # ej. CO,PE,CL si quieres filtrar países
```

## Despliegue en producción
1. Cargar `.env.prod` con tus claves reales (Stripe puede omitirse si no se usa).
2. Arrancar stack:  
   ```
   docker compose -f docker-compose.prod.yml up --build -d
   ```
3. Aplicar migraciones en la DB real:  
   ```
   cd backend
   FLASK_APP=wsgi.py FLASK_ENV=production DATABASE_URL=postgresql://... flask db upgrade
   ```
4. Verifica Traefik/Grafana:  
   - Frontend: https://fastisp.cloud  
   - API: https://api.fastisp.cloud/api/health  
   - Grafana/NOC: valor en `VITE_GRAFANA_URL`
5. Opcional: despliegue remoto desde GitHub Actions con `Deploy VPS` (`.github/workflows/deploy-vps.yml`) y secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_APP_DIR`.

## Operación diaria
- Panel admin: `/admin` → pestañas NOC, Alertas, Tickets, Facturación, MikroTik/OLT.
- Portal cliente: `/dashboard/billing` para pagar/descargar facturas y ver consumo real.
- Tickets: crea/edita estados, prioridad, SLA y comentarios; notifica a PagerDuty/Telegram.
- Backups: tarea `run_backups` en Celery beat guarda DB y configs de equipos.
- WAF/GeoIP: se activa vía middlewares en Traefik usando GeoLite2 (Account 1301783).
- App técnico: `/tech` muestra tickets asignados en versión mobile-first con acciones rápidas y notas.
- Push WonderPush: define las keys en variables de entorno o en GitHub Secrets (`WONDERPUSH_WEBKEY`, `WONDERPUSH_APPLICATION_ID`, `WONDERPUSH_ACCESS_TOKEN`) y evita guardarlas en el repo.

## Pruebas y calidad
- Backend: `cd backend && pytest -q`
- Frontend build: `cd frontend && npm run build`
- E2E: `cd frontend && npm run test:e2e` (Playwright, arranca `vite preview`).
- Carga: `k6 run tests/load/smoke.js` (base `https://httpbin.org`, cambia `BASE_URL` para tu API).

## Diferenciales frente a Wisphub/Wispro
- Grafana/NOC embebido y listo, con métricas reales por cliente.
- Backups automáticos de DB y equipos (MikroTik/OLT).
- WAF/GeoIP en el proxy sin depender de servicios externos.
- Tickets con SLA y alertas push integradas.
- RBAC granular por permiso (allow/deny por rol en cada tenant).
- Auditoría operativa consultable desde panel admin.
- Ventanas de mantenimiento NOC con silenciamiento de alertas por alcance.
- Promesas de pago y job de cobranza (`enforce_billing`) para cortes/reconexión más controlados.
- Plantillas de servicio OLT custom por vendor (`/api/olt/service-templates`) para estandarizar aprovisionamiento.

## Próximos pasos sugeridos
- Conectar gateway de pago local definitivo (Yape/Nequi/transferencia con comprobante).
- Activar almacenamiento de backups en bucket S3/Backblaze.
- Añadir suite E2E (Playwright) y pruebas de carga (k6) en CI.

## Acceso por roles
- Guia operativa completa: `docs/operations/role-access.md`
- Playbook enterprise de procesos (SOP, cambios, preflight, SLO): `docs/operations/ops-enterprise-playbook.md`
- Roles activos:
  - `platform_admin` (admin total, panel `/platform`)
  - `admin` (admin ISP, panel `/admin`)
  - `client` (panel cliente `/dashboard`)
