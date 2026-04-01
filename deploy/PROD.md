# Despliegue rápido a dominio (producción)

## Requisitos
- Docker + Docker Compose v2
- Dominio apuntando a la IP del servidor (A/AAAA)
- Puertos 80 y 443 abiertos
- Certificados gestionados automáticamente por Traefik (Let’s Encrypt)

## Variables de entorno
Crea un archivo `.env.prod` en la raíz con al menos:

```
# Core
SECRET_KEY=***
JWT_SECRET_KEY=***
ENCRYPTION_KEY=***
LOG_LEVEL=INFO

# DB y Redis
DATABASE_URL=postgresql://ispmax:STRONGPASS@postgres:5432/ispmax
REDIS_URL=redis://:REDISPASS@redis:6379/0
DB_PASSWORD=STRONGPASS
REDIS_PASSWORD=REDISPASS

# Dominios
FRONTEND_HOST=panel.midominio.com
API_URL=https://api.midominio.com
CORS_ORIGINS=https://panel.midominio.com
TRAEFIK_ACME_EMAIL=admin@midominio.com

# MikroTik / OLT (credenciales por defecto solo para pruebas)
MIKROTIK_DEFAULT_USERNAME=admin
MIKROTIK_DEFAULT_PASSWORD=cambialo
OLT_DEFAULT_PASSWORD=cambialo

# Influx / Monitoring (opcional si usas métrica real)
INFLUXDB_URL=https://influx.midominio.com
INFLUXDB_TOKEN=***
INFLUXDB_ORG=ispmax
INFLUXDB_BUCKET=network

# Stripe / Pasarela (reemplaza por la tuya)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Mail / Notificaciones
MAIL_USERNAME=notificaciones@midominio.com
MAIL_PASSWORD=***

# Grafana admin
GRAFANA_PASSWORD=SuperSegura123

# Workers
GUNICORN_WORKERS=4

# OpenAI (solo si usas AI Diagnosis)
OPENAI_API_KEY=sk-...
```

## Despliegue
```
# 1) Copia .env.prod -> .env
cp .env.prod .env

# 2) Levanta stack prod con Traefik
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# 3) Ejecuta migraciones DB
docker compose --env-file .env run --rm backend flask db upgrade

# 4) Semillas mínimas (opcional demo)
docker compose --env-file .env run --rm backend python -m app.seed
```

## Salud y verificación
- API: https://api.midominio.com/health
- Frontend: https://panel.midominio.com
- TLS: Traefik renueva automáticamente (acme.json en ./letsencrypt)

## Logs y monitoreo
- Backend: `docker compose logs -f backend`
- Traefik: `docker compose logs -f traefik`
- Prometheus/Grafana (si habilitas docker-compose.yml): puertos 9090/3001

## Backup rápido
- Postgres: `docker exec -t <postgres-container> pg_dump -U ispmax ispmax > backups/ispmax_$(date +%F).sql`
- Influx: usa `influx backup` o snapshots del volumen

## Seguridad mínima
- Cambia todas las claves por defecto
- Restringe acceso SSH con keypair y firewall
- Coloca cabeceras de seguridad (ya cubiertas en Traefik + app) y fuerza HTTPS

## Rollback
```
docker compose --env-file .env down
```
