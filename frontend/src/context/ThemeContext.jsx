// Light / dark theme. The choice is stored per browser; until the user picks one, the operating-system setting is used.
// index.html applies the stored theme before React loads, so the page never flashes the wrong colours.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export const THEME_KEY = 'yoloa_theme'
const ThemeContext = createContext(null)

const systemTheme = () => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

export function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch { return null }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => storedTheme() || systemTheme())
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  // Follow the OS while the user has not chosen explicitly.
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!query?.addEventListener) return undefined
    const onChange = () => { if (!storedTheme()) setThemeState(systemTheme()) }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const setTheme = useCallback((value) => {
    try { localStorage.setItem(THEME_KEY, value) } catch { /* private mode: the choice lasts for this visit */ }
    setThemeState(value)
  }, [])
  const toggle = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme])
  return <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
}

const fallback = { theme: 'light', setTheme: () => {}, toggle: () => {} }
export const useTheme = () => useContext(ThemeContext) || fallback
