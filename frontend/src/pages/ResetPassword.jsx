import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../services/api'
import { USE_MOCK } from '../services/http'
import { AuthCard, AuthShell, FormAlert, PasswordField, Spinner, SubmitButton, errorMessage, textLink } from '../components/auth/AuthUI'

// Landing page for the emailed /reset-password?uid=…&token=… link. Django validates the token
// (expired, forged and already-used links are rejected) both on load and again on submit.
export default function ResetPassword() {
  const [params] = useSearchParams()
  const uid = params.get('uid') || ''
  const token = params.get('token') || ''
  const [link, setLink] = useState({ checking: Boolean(uid && token), valid: false, error: uid && token ? '' : 'This password reset link is incomplete. Request a new one.' })
  const [form, setForm] = useState({ password: '', passwordConfirmation: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState('')

  useEffect(() => {
    if (!uid || !token) return undefined
    let active = true
    ;(async () => {
      try {
        if (!USE_MOCK) await authApi.csrf()
        await authApi.validateResetLink({ uid, token })
        if (active) setLink({ checking: false, valid: true, error: '' })
      } catch (err) {
        if (active) setLink({ checking: false, valid: false, error: errorMessage(err, 'This password reset link is invalid or has expired.') })
      }
    })()
    return () => { active = false }
  }, [uid, token])

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const found = {}
    if (!form.password) found.password = 'Choose a new password.'
    else if (form.password.length < 8) found.password = 'Use at least 8 characters.'
    if (!form.passwordConfirmation) found.passwordConfirmation = 'Confirm your new password.'
    else if (form.password && form.password !== form.passwordConfirmation) found.passwordConfirmation = 'Passwords do not match.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      if (!USE_MOCK) await authApi.csrf()
      const result = await authApi.resetPassword({ uid, token, ...form })
      setDone(result.message || 'Password updated. Please sign in with your new password.')
    } catch (err) {
      const problems = err?.data?.errors?.password
      if (problems?.length) setErrors({ password: problems.join(' ') })
      else if (err?.status === 400 && /link/i.test(err.message || '')) setLink({ checking: false, valid: false, error: err.message })
      setError(errorMessage(err, 'Your password could not be updated. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  let body
  if (done) {
    body = (
      <div className="space-y-5">
        <FormAlert tone="success">{done}</FormAlert>
        <Link to="/" className="flex w-full items-center justify-center rounded-xl bg-brand-dark px-4 py-3.5 text-sm font-bold text-white hover:bg-brand focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40">Return to sign in</Link>
      </div>
    )
  } else if (link.checking) {
    body = <p role="status" className="flex items-center gap-3 text-sm text-gray-600"><Spinner className="h-5 w-5 text-brand" />Checking your reset link…</p>
  } else if (!link.valid) {
    body = (
      <div className="space-y-5">
        <FormAlert>{link.error}</FormAlert>
        <p className="text-sm text-gray-600">Reset links work once and expire after one hour.</p>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link to="/forgot-password" className={textLink}>Request a new link</Link>
          <Link to="/" className={textLink}>Return to sign in</Link>
        </div>
      </div>
    )
  } else {
    body = (
      <form onSubmit={submit} noValidate className="space-y-4">
        <PasswordField label="New password" name="password" autoComplete="new-password" value={form.password} onChange={update('password')}
          error={errors.password} hint="At least 8 characters. Avoid common or all-number passwords." disabled={busy} autoFocus />
        <PasswordField label="Confirm new password" name="passwordConfirmation" autoComplete="new-password" value={form.passwordConfirmation}
          onChange={update('passwordConfirmation')} error={errors.passwordConfirmation} disabled={busy} />
        <FormAlert>{error}</FormAlert>
        <SubmitButton busy={busy} busyLabel="Saving…">Update password</SubmitButton>
        <p className="text-center text-sm text-gray-600"><Link to="/" className={textLink}>Return to sign in</Link></p>
      </form>
    )
  }

  return (
    <AuthShell aside="Choose a strong password to keep your account safe.">
      <AuthCard back={{ to: '/', label: 'Back to sign in' }} title={done ? 'Password updated' : 'Choose a new password'}
        subtitle={done || link.checking || !link.valid ? undefined : 'Enter a new password for your account.'}>
        {body}
      </AuthCard>
    </AuthShell>
  )
}
