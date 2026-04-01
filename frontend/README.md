# ISPMAX Frontend

Frontend React + TypeScript para el sistema de gestión de ISP ISPMAX.

## Requisitos

- **Node.js**: v16+ (LTS recomendado)
- **npm**: v7+
- **Backend**: API ISPMAX ejecutándose en `http://localhost:5000`

## Instalación Rápida

### 1. Instala dependencias

```bash
cd frontend
npm install
```

### 2. Configura variables de entorno (opcional)

Copia `.env.example` a `.env.local` para personalizar:

```bash
cp .env.example .env.local
```

Por defecto, el frontend proxea `/api` a `http://localhost:5000` (configurable en `vite.config.ts`).

## Ejecución

### Modo Desarrollo

Inicia el servidor de desarrollo en `http://localhost:3000`:

```bash
npm run dev
```

La app:
- Proxea `/api/*` requests a `http://localhost:5000`
- Recarga automática al guardar cambios (Hot Module Reload)
- Abre el navegador automáticamente

### Build para Producción

```bash
npm run build
```

Genera la carpeta `dist/` lista para servir.

### Preview de Build Producción

```bash
npm run preview
```

### Lint & Format

```bash
npm run lint
```

## Estructura del Proyecto

```
frontend/
├── src/
│   ├── pages/           # Páginas principales (Login, Dashboard, AdminPanel)
│   ├── components/      # Componentes reutilizables
│   ├── contexts/        # Context API (ThemeContext)
│   ├── store/           # Zustand stores (authStore)
│   ├── lib/
│   │   ├── apiClient.ts # Cliente HTTP centralizado
│   │   └── config.ts    # Configuración global
│   ├── App.tsx          # Enrutador principal
│   ├── main.tsx         # Entry point
│   └── index.css        # Estilos globales (Tailwind)
├── public/              # Assets estáticos
├── vite.config.ts       # Configuración de Vite y proxy
├── tsconfig.json        # Configuración TypeScript
├── tailwind.config.js   # Configuración Tailwind CSS
├── package.json         # Dependencias y scripts
└── .env.example         # Template de variables de entorno
```

## Stack Tecnológico

- **React 18**: UI library
- **TypeScript**: Type safety
- **Vite**: Build tool moderno y rápido
- **React Router v6**: Enrutamiento
- **Zustand**: State management
- **Tailwind CSS**: Utility-first CSS
- **Framer Motion**: Animaciones
- **React Hook Form**: Manejo de formularios
- **Axios/Fetch**: HTTP client (via apiClient.ts)
- **Chart.js**: Gráficos de datos
- **Leaflet**: Mapas interactivos
- **Socket.io**: WebSockets (tiempo real)

## Flujo de Autenticación

1. Usuario ingresa credentials en `/login`
2. `authStore` (Zustand) gestiona el token JWT
3. Token se persiste en `localStorage`
4. `ProtectedRoute` valida autenticación antes de mostrar páginas
5. `apiClient` agrega el token a todos los requests automáticamente

## API Endpoints Esperados

El backend debe exponer:

- `POST /api/auth/login` → `{ token, user }`
- `GET /api/dashboard/stats` → stats del cliente
- `GET /api/clients/usage-history` → histórico de uso
- `POST /api/clients/{id}/reboot-cpe` → reinicia CPE
- `GET /api/mikrotik/routers` → lista de routers (admin)
- ... (ver `src/lib/config.ts` para la lista completa)

## Troubleshooting

### CORS errors
Verifica que el backend esté ejecutándose en `http://localhost:5000` y que `CORS_ORIGINS` incluya `http://localhost:3000`.

### "Cannot find module" errors
Asegúrate de que ejecutaste `npm install` y que la ruta del import es correcta (relativa a `src/`).

### Changes no se reflejan
- Limpia caché: `Ctrl+Shift+R` (Chrome) o `Cmd+Shift+R` (Mac)
- Reinicia servidor: `Ctrl+C` en terminal y `npm run dev` nuevamente

### Variable de entorno no reconocida
Debe empezar con `VITE_` para que Vite la injerte (ej: `VITE_API_URL`).

## Próximos Pasos

1. Instala Node.js (https://nodejs.org/)
2. Ejecuta `npm install && npm run dev`
3. Abre http://localhost:3000
4. Login con credenciales del backend (test: admin/admin o usuario/password)

## Soporte

Para problemas, revisa:
- Logs del navegador (F12 → Console)
- Logs del backend en terminal
- `vite.config.ts` para la configuración de proxy

Happy coding! 🚀
