/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching'

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: any
  WonderPush?: Array<unknown>
}

const WONDERPUSH_WEB_KEY = import.meta.env.VITE_WONDERPUSH_WEBKEY as string | undefined

// WonderPush SDK inside our custom SW (remote notifications)
if (WONDERPUSH_WEB_KEY) {
  try {
    importScripts('https://cdn.by.wonderpush.com/sdk/1.1/wonderpush-loader.min.js')
    self.WonderPush = self.WonderPush || []
    self.WonderPush.push(['init', { webKey: WONDERPUSH_WEB_KEY }])
  } catch (err) {
    console.error('[sw] WonderPush init failed', err)
  }
}

precacheAndRoute(self.__WB_MANIFEST || [])

self.addEventListener('push', (event) => {
  const data = (() => {
    try { return event.data?.json() } catch { return { title: 'FASTISP', body: event.data?.text() || 'Notificación' } }
  })()

  const title = data?.title || 'FASTISP'
  const body = data?.body || 'Tienes una nueva alerta de servicio.'
  const url = data?.url || '/dashboard'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/dashboard'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      const match = clientList.find((client) => (client as WindowClient).url.includes(self.origin || '') && 'focus' in client)
      if (match && 'focus' in match) return match.focus()
      return self.clients.openWindow(url)
    })
  )
})

// Keep the service worker up to date
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})
