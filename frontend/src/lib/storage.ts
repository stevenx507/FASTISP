/**
 * Safe localStorage wrapper that gracefully handles browser restrictions
 * (e.g., Firefox Enhanced Tracking Protection, private browsing mode)
 */

export const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      console.warn(`[Storage] Failed to read "${key}":`, e)
      return null
    }
  },

  setItem: (key: string, value: string): void => {
    try {
      localStorage.setItem(key, value)
    } catch (e) {
      console.warn(`[Storage] Failed to write "${key}":`, e)
    }
  },

  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key)
    } catch (e) {
      console.warn(`[Storage] Failed to remove "${key}":`, e)
    }
  },

  clear: (): void => {
    try {
      localStorage.clear()
    } catch (e) {
      console.warn('[Storage] Failed to clear storage:', e)
    }
  }
}
