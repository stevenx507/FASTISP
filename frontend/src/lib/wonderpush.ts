declare global {
  interface Window {
    WonderPush?: any;
  }
}

let initialized = false
let loading = false

export const initWonderPush = () => {
  if (typeof window === 'undefined') return
  const webKey = import.meta.env.VITE_WONDERPUSH_WEBKEY
  if (!webKey || initialized || loading) return
  loading = true
  const script = document.createElement('script')
  script.src = 'https://cdn.by.wonderpush.com/sdk/1.1/wonderpush-loader.min.js'
  script.async = true
  script.onload = () => {
    window.WonderPush = window.WonderPush || []
    window.WonderPush.push(['init', { webKey }])
    initialized = true
  }
  script.onerror = () => { loading = false }
  document.head.appendChild(script)
}

export const trackEvent = (event: string, payload?: Record<string, any>) => {
  if (typeof window === 'undefined' || !window.WonderPush) return
  window.WonderPush.push(['trackEvent', event, payload || {}])
}

export default initWonderPush
