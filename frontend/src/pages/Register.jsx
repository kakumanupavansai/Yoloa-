import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { homeFor, useAuth } from '../context/AuthContext'
import { AuthCard, AuthShell, FormAlert, PasswordField, PortalBadge, SubmitButton, TextField, errorMessage, textLink } from '../components/auth/AuthUI'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateRegistration({ fullName, email, password, passwordConfirmation }) {
  const errors = {}
  if (!fullName.trim()) errors.fullName = 'Enter your full name.'
  if (!email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL.test(email.trim())) errors.email = 'Enter a valid email address, like name@example.com.'
  if (!password) errors.password = 'Choose a password.'
  else if (password.length < 8) errors.password = 'Use at least 8 characters.'
  if (!passwordConfirmation) errors.passwordConfirmation = 'Confirm your password.'
  else if (password && password !== passwordConfirmation) errors.passwordConfirmation = 'Passwords do not match.'
  return errors
}

// Public student registration. The server always creates a student account and signs in that new account only.
export default function Register() {
  const nav = useNavigate()
  const { register } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', password: '', passwordConfirmation: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const found = validateRegistration(form)
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const user = await register({ ...form, fullName: form.fullName.trim(), email: form.email.trim() })
      nav(homeFor(user), { replace: true })
    } catch (err) {
      const passwordProblems = err?.data?.errors?.password
      if (passwordProblems?.length) setErrors({ password: passwordProblems.join(' ') })
      if (err?.status === 409) setErrors({ email: 'An account with this email already exists.' })
      setError(err?.status === 409
        ? <>An account with this email already exists. <Link to="/login" className="font-bold underline">Sign in</Link> or <Link to="/forgot-password" className="font-bold underline">reset your password</Link>.</>
        : errorMessage(err, 'Could not create your account. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell aside="Join YOLOA and start learning today.">
      <AuthCard back={{ to: '/login', label: 'Back to student sign in' }} badge={<PortalBadge portal="student" />}
        title="Create your student account" subtitle="It only takes a minute. You can enrol in courses right after.">
        <form onSubmit={submit} noValidate className="space-y-4">
          <TextField label="Full name" name="fullName" autoComplete="name" value={form.fullName} onChange={update('fullName')}
            error={errors.fullName} disabled={busy} autoFocus />
          <TextField label="Email address" type="email" name="email" autoComplete="email" inputMode="email" value={form.email}
            onChange={update('email')} error={errors.email} disabled={busy} />
          <PasswordField label="Password" name="password" autoComplete="new-password" value={form.password} onChange={update('password')}
            error={errors.password} hint="At least 8 characters. Avoid common or all-number passwords." disabled={busy} />
          <PasswordField label="Confirm password" name="passwordConfirmation" autoComplete="new-password" value={form.passwordConfirmation}
            onChange={update('passwordConfirmation')} error={errors.passwordConfirmation} disabled={busy} />
          <FormAlert>{error}</FormAlert>
          <SubmitButton busy={busy} busyLabel="Creating account…">Create account</SubmitButton>
        </form>
        <p className="mt-6 text-center text-sm text-ink-soft">Already have an account? <Link to="/login" className={textLink}>Sign in</Link></p>
      </AuthCard>
    </AuthShell>
  )
}
