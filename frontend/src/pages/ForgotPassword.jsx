import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../services/api'
import { USE_MOCK } from '../services/http'
import { AuthCard, AuthShell, FormAlert, SubmitButton, TextField, errorMessage, textLink } from '../components/auth/AuthUI'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Shared by both portals; ?portal=admin only changes where "back to sign in" points.
export default function ForgotPassword() {
  const [params] = useSearchParams()
  const signIn = params.get('portal') === 'admin' ? '/admin/login' : '/login'
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    setError(''); setResult(null)
    if (!EMAIL.test(email.trim())) { setFieldError(email.trim() ? 'Enter a valid email address, like name@example.com.' : 'Enter your email address.'); return }
    setBusy(true)
    try {
      if (!USE_MOCK) await authApi.csrf()
      // The server answers the same way whether or not the account exists.
      setResult(await authApi.requestPasswordReset(email.trim()))
    } catch (err) {
      setError(errorMessage(err, 'Could not send the reset request. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell aside="Locked out? We'll help you get back to learning.">
      <AuthCard back={{ to: signIn, label: 'Back to sign in' }} title="Forgot your password?"
        subtitle="Enter the email address for your account. If it matches an account, we'll create a one-time link to choose a new password.">
        {result ? (
          <div className="space-y-5">
            <FormAlert tone={result.delivery === 'development' ? 'info' : 'success'}>{result.message}</FormAlert>
            <p className="text-sm text-ink-soft">The link can be used once and expires after one hour.</p>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <button type="button" onClick={() => setResult(null)} className={textLink}>Use a different email</button>
              <Link to={signIn} className={textLink}>Return to sign in</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <TextField label="Email address" type="email" name="email" autoComplete="email" inputMode="email" value={email}
              onChange={(event) => { setEmail(event.target.value); setFieldError('') }} error={fieldError} disabled={busy} autoFocus />
            <FormAlert>{error}</FormAlert>
            <SubmitButton busy={busy} busyLabel="Sending…">Send reset link</SubmitButton>
            <p className="text-center text-sm text-ink-soft">Remembered it? <Link to={signIn} className={textLink}>Return to sign in</Link></p>
          </form>
        )}
      </AuthCard>
    </AuthShell>
  )
}
