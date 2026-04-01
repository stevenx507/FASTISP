import { useEffect, useState } from 'react'

type PermissionState = NotificationPermission

export const usePushNotifications = () => {
  const [permission, setPermission] = useState<PermissionState>(() => {
    return typeof Notification !== 'undefined' ? Notification.permission : 'default'
  })

  const isSupported =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator

  useEffect(() => {
    if (!isSupported) return
    setPermission(Notification.permission)
  }, [isSupported])

  const requestPermission = async () => {
    if (!isSupported) return 'denied' as PermissionState
    const result = await Notification.requestPermission()
    setPermission(result)
    return result
  }

  const triggerLocalNotification = async (title: string, body: string) => {
    if (!isSupported || permission !== 'granted') return false

    const registration = await navigator.serviceWorker.ready.catch(() => undefined)

    if (registration?.showNotification) {
      await registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        data: { url: '/dashboard' },
      })
      return true
    }

    // Fallback to window Notification
    try {
      new Notification(title, { body, icon: '/pwa-192x192.png' })
      return true
    } catch (err) {
      console.error('[push] Notification fallback failed', err)
      return false
    }
  }

  return {
    isSupported,
    permission,
    requestPermission,
    triggerLocalNotification,
  }
}

export default usePushNotifications
