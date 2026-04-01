# Acceso por Roles (Admin Total, Admin ISP, Cliente)

Esta guia describe como entrar a cada panel despues de los bloques implementados.

## 1) Admin Total (`platform_admin`)

### Produccion (flujo recomendado)
1. Configura en backend `PLATFORM_BOOTSTRAP_TOKEN` y define host master:
   - `TENANCY_MASTER_HOST` (ej: `master.fastisp.cloud`)
   - `TENANCY_ROOT_DOMAIN` (ej: `fastisp.cloud`)
2. Abre `https://master.fastisp.cloud/platform/bootstrap`.
3. Crea el primer `platform_admin`.
4. Inicia sesion y entra a `/platform`.
5. Elimina el token bootstrap del entorno para cerrar ese flujo.

### Desarrollo / demo con seed
- Si usas `seed_data()`, se crea un `platform_admin` por defecto:
  - email: `platform@ispfast.local` (configurable con `SEED_PLATFORM_ADMIN_EMAIL`)
  - password: se imprime en consola al ejecutar seed.

## 2) Admin ISP (`admin`)

### Opcion A: creado por Admin Total
1. Inicia sesion como `platform_admin`.
2. Ve a `/platform`.
3. Crea tenant (si aun no existe).
4. En la tarjeta del tenant pulsa `Crear admin` para crear cuenta `admin`.
5. Para operar ese tenant:
   - pulsa `Entrar panel ISP` desde `/platform` (modo tenant), o
   - inicia sesion directo en el host del tenant (ej: `isp-a.fastisp.cloud`).
6. En `/admin` ya tienes modulo `Auditoria` para revisar `quien hizo que`, con fecha/hora, IP y entidad afectada.

### Opcion B: seed de desarrollo
- Usuario seed:
  - email: `admin@ispfast.local`
  - password: se imprime en consola del seed.

## 3) Cliente (`client`)

### Opcion A: alta desde panel Admin ISP
1. Inicia sesion como `admin` (tenant ISP).
2. Abre `/admin` > modulo `Clientes` > `Nuevo Cliente`.
3. Deja activo `Crear acceso al portal cliente`.
4. Ingresa email del cliente.
5. Guarda:
   - si no envias password, el backend genera una.
   - credenciales quedan en el toast de confirmacion.
6. El cliente inicia sesion en `/login` y entra a `/dashboard`.

### Opcion B: seed de desarrollo
- Usuarios seed cliente:
  - `cliente@ispfast.local`
  - `ana.gomez@example.com`
- Passwords: se imprimen en consola del seed.

## 4) Staff operativo (`tech`, `support`, `billing`, `noc`, `operator`)

- Cuando estos roles inician sesion, ahora entran por defecto a `/tech` (no al dashboard cliente).
- El rol `admin` sigue entrando a `/admin`.

## Notas de contexto tenant

- `platform_admin` solo usa `/platform` en contexto master/global.
- Para entrar a `/admin` como `platform_admin`, debes seleccionar tenant con `Entrar panel ISP`.
- `admin` y `client` operan dentro de su tenant.

## Modulos enterprise nuevos (admin ISP)

- `Auditoria`: `/admin` -> `Auditoria`
  - Lista eventos con filtros por accion, entidad, actor y fecha.
- `Permisos`: `/admin` -> `Permisos`
  - RBAC granular por rol (`allow/deny`) para permisos especificos.
- `Promesas de Pago`: `/admin` -> `Promesas de Pago`
  - Registro y seguimiento de compromisos para evitar cortes.
- `Mantenimientos NOC`: `/admin` -> `Mantenimientos NOC`
  - Ventanas activas que silencian alertas por alcance (`all/router/billing/network`).

## Persistencia

- Instalaciones, avisos, servicios adicionales, vouchers hotspot, ajustes de sistema y jobs ahora se guardan en BD (no solo cache).
- Ejecuta migraciones antes de usar en VPS:
  - `docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T backend python -m flask --app wsgi.py db upgrade`
