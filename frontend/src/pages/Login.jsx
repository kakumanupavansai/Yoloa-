import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { homeFor, useAuth } from '../context/AuthContext'
import { authApi } from '../services/api'
import {
  AuthCard, AuthShell, Divider, FormAlert, PasswordField, PortalBadge, Spinner, SubmitButton, TextField, errorMessage, textLink,
} from '../components/auth/AuthUI'
import { GoogleIcon } from '../components/ui/Icons'

// Error codes the Django Google OAuth callback appends as ?auth_error=… when it redirects here.
const oauthMessages = {
  google_not_configured: 'Google sign-in is not configured on the server yet. Use your email and password for now.',
  google_cancelled_or_invalid: 'Google sign-in was cancelled or could not be verified. Please try again.',
  google_verification_failed: 'Google could not verify this sign-in. Please try again.',
  google_account_link_required: 'This email already has a YOLOA account. Sign in with your password, then link Google from your profile.',
  google_link_mismatch: 'Use the same verified Google email as this account to link it.',
  google_account_already_linked: 'That Google account is linked to another YOLOA account.',
  google_student_only: 'Google sign-in is available to student accounts only.',
  sign_in_before_linking: 'Sign in before linking a Google account.',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateSignIn({ email, password }) {
  const errors = {}
  if (!email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL.test(email.trim())) errors.email = 'Enter a valid email address, like name@example.com.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

function GoogleSignIn({ disabled }) {
  const [status, setStatus] = useState({ loading: true, configured: false, error: null })
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    let active = true
    authApi.googleStatus()
      .then(({ configured }) => active && setStatus({ loading: false, configured, error: null }))
      .catch((error) => active && setStatus({ loading: false, configured: false, error }))
    return () => { active = false }
  }, [])

  const start = () => {
    setRedirecting(true)
    // Full-page navigation: Django creates the OAuth state/nonce/PKCE values in the session and redirects to Google.
    window.location.assign(authApi.googleStartUrl())
  }

  const unavailable = !status.loading && !status.configured
  return (
    <div>
      <button type="button" onClick={start} disabled={disabled || status.loading || unavailable || redirecting}
        aria-describedby={unavailable ? 'google-unavailable' : undefined}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm font-bold text-ink shadow-sm transition hover:bg-ground focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 disabled:cursor-not-allowed disabled:opacity-60">
        {redirecting || status.loading ? <Spinner className="h-5 w-5 text-ink-muted" /> : <GoogleIcon />}
        {redirecting ? 'Redirecting to Google…' : 'Continue with Google'}
      </button>
      {unavailable && (
        <p id="google-unavailable" className="mt-2 text-xs text-ink-muted">
          {status.error ? 'Google sign-in status could not be checked.' : 'Google sign-in is not configured on the server yet.'} Use your email and password instead.
        </p>
      )}
    </div>
  )
}

// Student sign-in at /login, administrator sign-in at /admin/login.
export default function Login({ role = 'student' }) {
  const [params] = useSearchParams()
  const { login, logout } = useAuth()
  const nav = useNavigate()
  const admin = role === 'admin'
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState(admin ? '' : oauthMessages[params.get('auth_error')] || '')
  const [busy, setBusy] = useState(false)

  // Older links used /login?role=admin; send them to the dedicated administrator page.
  if (!admin && params.get('role') === 'admin') return <Navigate to="/admin/login" replace />

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const found = validateSignIn(form)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const user = await login({ email: form.email.trim(), password: form.password, role })
      // The server already refuses the wrong portal; this guards the screen if that ever changes.
      if (user.role !== role) {
        await logout()
        setError(admin ? 'This account does not have administrator access.' : 'This is an administrator account. Use administrator sign-in instead.')
        return
      }
      nav(homeFor(user), { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed. Check your email and password.'))
      setForm((current) => ({ ...current, password: '' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell aside={admin ? 'Manage courses, assessments and students from one secure place.' : undefined}>
      <AuthCard
        back={{ to: '/', label: 'Choose a different sign-in type' }}
        badge={<PortalBadge portal={role} />}
        title={admin ? 'Administrator sign in' : 'Student sign in'}
        subtitle={admin ? 'Sign in with your administrator email and password.' : 'Welcome back! Sign in to continue learning.'}>
        {!admin && <><GoogleSignIn disabled={busy} /><Divider>or sign in with email</Divider></>}
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField label="Email address" type="email" name="email" autoComplete={admin ? 'username' : 'email'} inputMode="email"
            value={form.email} onChange={update('email')} error={errors.email} disabled={busy} autoFocus />
          <div>
            <PasswordField label="Password" name="password" autoComplete="current-password"
              value={form.password} onChange={update('password')} error={errors.password} disabled={busy} />
            <div className="mt-2 flex justify-end">
              <Link to={admin ? '/forgot-password?portal=admin' : '/forgot-password'} className={`text-sm ${textLink}`}>Forgot password?</Link>
            </div>
          </div>
          <FormAlert>{error}</FormAlert>
          <SubmitButton busy={busy} busyLabel="Signing in…" variant={admin ? 'admin' : 'primary'}>Sign in</SubmitButton>
        </form>
        {!admin && (
          <p className="mt-6 text-center text-sm text-ink-soft">
            New to YOLOA? <Link to="/register" className={textLink}>Create an account</Link>
          </p>
        )}
        {admin && <p className="mt-6 text-center text-xs text-ink-muted">Administrator accounts are created by the portal owner. Students cannot register here.</p>}
      </AuthCard>
    </AuthShell>
  )
}
