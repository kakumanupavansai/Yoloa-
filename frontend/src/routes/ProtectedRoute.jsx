import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { homeFor, useAuth } from '../context/AuthContext'
import { ErrorBox } from '../components/ui/States'
import { Spinner } from '../components/auth/AuthUI'

export function AuthLoading({ label = 'Checking your session…' }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-ink-soft" role="status">
      <Spinner className="h-5 w-5 text-brand" />{label}
    </div>
  )
}

// <ProtectedRoute role="student" /> wraps routes. Anonymous visitors go to that portal's sign-in;
// a signed-in user of the other role goes to their own dashboard. The API enforces the same rules.
export default function ProtectedRoute({ role }) {
  const { user, loading, authError, retryAuth } = useAuth()
  const loc = useLocation()
  if (loading) return <AuthLoading />
  if (!user && authError) return <div className="flex min-h-screen items-center justify-center"><ErrorBox error={authError} onRetry={retryAuth} /></div>
  if (!user) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} state={{ from: loc }} replace />
  if (role && user.role !== role) return <Navigate to={homeFor(user)} replace />
  return <Outlet />
}

// Sign-in, registration and the portal choice are only for visitors who are not signed in.
export function PublicOnlyRoute() {
  const { user, loading } = useAuth()
  if (loading) return <AuthLoading />
  if (user) return <Navigate to={homeFor(user)} replace />
  return <Outlet />
}
