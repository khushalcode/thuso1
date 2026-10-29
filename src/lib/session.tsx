'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

export type UserRole = 'admin' | 'staff' | 'kitchen'

export interface SessionUser {
  id: string
  name: string
  email: string
  role: UserRole
  shopId: string | null
}

export interface Shop {
  id: string
  name: string
  code: string
  color: string
  address?: string | null
  phone?: string | null
  gstin?: string | null
  taxRate: number
  serviceRate?: number
  currency: string
}

interface SessionState {
  user: SessionUser | null
  shops: Shop[]
  currentShop: Shop | null
  theme: 'orange' | 'emerald' | 'violet'
  login: (user: SessionUser, shops: Shop[]) => void
  selectShop: (shop: Shop) => void
  logout: () => void
  setTheme: (t: 'orange' | 'emerald' | 'violet') => void
  loading: boolean
}

const SessionContext = createContext<SessionState | undefined>(undefined)

const STORAGE_KEY = 'thuso-session'
const THEME_KEY = 'thuso-theme'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [shops, setShops] = useState<Shop[]>([])
  const [currentShop, setCurrentShop] = useState<Shop | null>(null)
  const [theme, setThemeState] = useState<'orange' | 'emerald' | 'violet'>('orange')
  const [loading, setLoading] = useState(true)

  // Load session from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        setUser(data.user)
        setShops(data.shops || [])
        setCurrentShop(data.currentShop || data.shops?.[0] || null)
      }
      const t = (localStorage.getItem(THEME_KEY) as any) || 'orange'
      setThemeState(t)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  // Apply theme to document
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const login = useCallback((u: SessionUser, s: Shop[]) => {
    setUser(u)
    setShops(s)
    // Auto-select first shop if user has only one, else null (will show picker)
    const initialShop = s.length === 1 ? s[0] : (u.shopId ? s.find((x) => x.id === u.shopId) || s[0] : null)
    setCurrentShop(initialShop)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ user: u, shops: s, currentShop: initialShop }))
  }, [])

  const selectShop = useCallback((shop: Shop) => {
    setCurrentShop(shop)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const data = JSON.parse(raw)
        data.currentShop = shop
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // ignore
      }
    }
    // Sync theme with shop's preferred color
    if (shop.color && ['orange', 'emerald', 'violet'].includes(shop.color)) {
      setThemeState(shop.color as any)
      localStorage.setItem(THEME_KEY, shop.color)
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    setShops([])
    setCurrentShop(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const setTheme = useCallback((t: 'orange' | 'emerald' | 'violet') => {
    setThemeState(t)
    localStorage.setItem(THEME_KEY, t)
  }, [])

  return (
    <SessionContext.Provider
      value={{ user, shops, currentShop, theme, login, selectShop, logout, setTheme, loading }}
    >
      {children}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}

// Apply CSS variables for the active theme.
//
// The app uses a unified 3-color scheme (light blue + light green + black)
// across all themes. The three "theme" keys below are kept for backward
// compat with existing Shop.color values ('orange' | 'emerald' | 'violet')
// but they now all render the SAME 3-color palette - orange maps to
// light-blue-primary, emerald maps to light-green-primary, violet maps to
// black-primary - so the visual identity stays consistent no matter which
// theme a shop was originally created with.
function applyTheme(theme: 'orange' | 'emerald' | 'violet') {
  const root = document.documentElement
  const themes = {
    // 'orange' theme -> LIGHT BLUE primary (default)
    orange: {
      '--brand-from': '#38BDF8',
      '--brand-to': '#4ADE80',
      '--brand-solid': '#0EA5E9',
      '--brand-soft': '#ECFEFF',
      '--brand-text': '#0369A1',
      '--brand-ring': 'rgba(14, 165, 233, 0.35)',
      '--brand-secondary': '#22C55E',
      '--brand-secondary-soft': '#F0FDF4',
      '--brand-dark': '#000000',
    },
    // 'emerald' theme -> LIGHT GREEN primary
    emerald: {
      '--brand-from': '#4ADE80',
      '--brand-to': '#38BDF8',
      '--brand-solid': '#22C55E',
      '--brand-soft': '#F0FDF4',
      '--brand-text': '#15803D',
      '--brand-ring': 'rgba(34, 197, 94, 0.35)',
      '--brand-secondary': '#0EA5E9',
      '--brand-secondary-soft': '#ECFEFF',
      '--brand-dark': '#000000',
    },
    // 'violet' theme -> BLACK primary (dark accent variant)
    violet: {
      '--brand-from': '#0f172a',
      '--brand-to': '#0EA5E9',
      '--brand-solid': '#000000',
      '--brand-soft': '#F1F5F9',
      '--brand-text': '#000000',
      '--brand-ring': 'rgba(15, 23, 42, 0.35)',
      '--brand-secondary': '#22C55E',
      '--brand-secondary-soft': '#F0FDF4',
      '--brand-dark': '#000000',
    },
  }
  const vars = themes[theme]
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v))
  root.setAttribute('data-theme', theme)
}

// Helper hook to get the X-Shop-Id header value for fetch calls
export function useShopHeader() {
  const { currentShop } = useSession()
  return currentShop?.id || ''
}
