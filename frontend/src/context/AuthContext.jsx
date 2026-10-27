import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authApi } from '../services/api'
import { USE_MOCK } from '../services/http'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

// Where each role lands after signing in. The server decides the role; this only picks the screen.
export const homeFor = (user) => (user?.role === 'admin' ? '/admin/dashboard' : '/student/dashboard')

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)

  // The signed-in identity always comes from the server session (GET /auth/me).
  // Vitest fixtures (USE_MOCK, test mode only) remember the fixture role in localStorage.
  const retryAuth = useCallback(async () => {
    setLoading(true)
    setAuthError(null)
    try {
      if (USE_MOCK) {
        setUser(localStorage.getItem('yoloa_role') ? await authApi.me() : null)
        return
      }
      await authApi.csrf()
      setUser(await authApi.me())
    } catch (error) {
      setUser(null)
      // An anonymous session is expected; connectivity and server errors should be visible.
      if (error?.status !== 401) setAuthError(error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { retryAuth() }, [retryAuth])

  const updateUser = useCallback((nextUser) => {
    setUser(nextUser)
    setAuthError(null)
  }, [])

  const clearLocal = useCallback(() => {
    localStorage.removeItem('yoloa_role')
    setUser(null)
    setAuthError(null)
  }, [])

  // Confirm the identity the new session belongs to instead of trusting a cached or previous profile.
  const confirmIdentity = async (fallback) => {
    if (USE_MOCK) return fallback
    return authApi.me()
  }

  const login = async (creds) => {
    clearLocal()
    if (!USE_MOCK) await authApi.csrf()
    const { user: signedIn } = await authApi.login(creds)
    if (USE_MOCK) localStorage.setItem('yoloa_role', signedIn.role)
    const current = await confirmIdentity(signedIn)
    updateUser(current)
    return current
  }

  const register = async (form) => {
    clearLocal()
    if (!USE_MOCK) await authApi.csrf()
    const { user: created } = await authApi.register(form)
    if (USE_MOCK) localStorage.setItem('yoloa_role', 'student')
    const current = await confirmIdentity(created)
    updateUser(current)
    return current
  }

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // The session may already be gone; local state is cleared either way.
    } finally {
      clearLocal()
      // Django rotates the CSRF token on login/logout; fetch a fresh one for the next form.
      if (!USE_MOCK) authApi.csrf().catch(() => {})
    }
  }, [clearLocal])

  useEffect(() => {
    window.addEventListener('auth:expired', clearLocal)
    return () => window.removeEventListener('auth:expired', clearLocal)
  }, [clearLocal])

  return (
    <AuthContext.Provider value={{ user, loading, authError, retryAuth, login, register, logout, setUser: updateUser, mock: USE_MOCK }}>
      {children}
    </AuthContext.Provider>
  )
}
