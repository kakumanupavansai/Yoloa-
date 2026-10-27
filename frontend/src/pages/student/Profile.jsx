import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { authApi, profileApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../../components/ui/Avatar'
import { Async } from '../../components/ui/States'
import { useToast } from '../../components/ui/Feedback'
import { PageHeader } from '../../components/ui/Primitives'
import { CheckCircleIcon, GoogleIcon, LockIcon, UploadIcon } from '../../components/ui/Icons'
import { FormAlert, PasswordField, Spinner } from '../../components/auth/AuthUI'

const FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email address', 'email'], ['username', 'Username'],
  ['address', 'Address'], ['city', 'City'], ['country', 'Country'], ['postalCode', 'Postal code'],
]

const EMPTY_PASSWORDS = { currentPassword: '', newPassword: '', newPasswordConfirmation: '' }

// Changes the signed-in account's own password. The server verifies the current password and applies Django's
// password validators; this session stays signed in and other signed-in devices are signed out.
export function ChangePassword({ hasPassword }) {
  const [form, setForm] = useState(EMPTY_PASSWORDS)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const set = (key) => (event) => { setForm({ ...form, [key]: event.target.value }); setErrors({ ...errors, [key]: undefined }) }
  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    const problems = {}
    if (!form.currentPassword) problems.currentPassword = 'Enter your current password.'
    if (!form.newPassword) problems.newPassword = 'Enter a new password.'
    else if (form.newPassword.length < 8) problems.newPassword = 'Use at least 8 characters.'
    if (form.newPassword && form.newPasswordConfirmation !== form.newPassword) problems.newPasswordConfirmation = 'The new passwords do not match.'
    setErrors(problems); setMessage(null)
    if (Object.keys(problems).length) return
    inFlight.current = true; setBusy(true)
    try {
      const result = await authApi.changePassword(form)
      setForm(EMPTY_PASSWORDS)
      setMessage({ tone: 'success', text: `${result.message} You stay signed in here; other devices will need to sign in again.` })
    } catch (error) {
      const fields = error.data?.errors || {}
      setErrors(Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, Array.isArray(value) ? value.join(' ') : String(value)])))
      setMessage({ tone: 'error', text: error.status === 403 ? 'Your session expired. Refresh the page and try again.' : error.message || 'Your password could not be changed.' })
    } finally { inFlight.current = false; setBusy(false) }
  }
  return (
    <section className="card card-pad" aria-labelledby="change-password-heading">
      <h2 id="change-password-heading" className="flex items-center gap-2 text-lg font-bold"><LockIcon className="h-5 w-5 text-brand" />Change Password</h2>
      {!hasPassword ? (
        <p className="mt-2 text-sm text-ink-muted">You sign in with Google, so this account has no password yet. To add one, use <Link to="/forgot-password" className="link">Forgot password</Link> with your email address.</p>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-4" noValidate>
          {message && <FormAlert tone={message.tone}>{message.text}</FormAlert>}
          <PasswordField label="Current Password" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} error={errors.currentPassword} disabled={busy} />
          <div className="grid gap-4 sm:grid-cols-2">
            <PasswordField label="New Password" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="At least 8 characters; avoid common or all-number passwords." disabled={busy} />
            <PasswordField label="Confirm New Password" autoComplete="new-password" value={form.newPasswordConfirmation} onChange={set('newPasswordConfirmation')} error={errors.newPasswordConfirmation} disabled={busy} />
          </div>
          <div className="flex justify-end"><button type="submit" className="btn-primary" disabled={busy} aria-busy={busy || undefined}>{busy ? <><Spinner />Changing password…</> : 'Change Password'}</button></div>
        </form>
      )}
    </section>
  )
}

// Account details for students and administrators. Role cannot be changed here.
export default function Profile() {
  const state = useApi(() => profileApi.get(), [])
  const { user, setUser } = useAuth()
  const toast = useToast()
  const fileRef = useRef()
  const [form, setForm] = useState({})
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (state.data) setForm(state.data) }, [state.data])

  const save = async (event) => {
    event.preventDefault()
    setBusy(true); setErrors({})
    try {
      const payload = Object.fromEntries(FIELDS.map(([key]) => [key, form[key] ?? '']))
      const saved = await profileApi.update(payload)
      setUser({ ...user, ...saved })
      toast('Profile saved.')
    } catch (error) {
      setErrors(Object.fromEntries(Object.entries(error.data?.errors || {}).map(([key, value]) => [key, Array.isArray(value) ? value.join(' ') : String(value)])))
      toast(error.message, 'error')
    } finally { setBusy(false) }
  }
  const upload = async (event) => {
    const file = event.target.files[0]
    if (!file) return
    const body = new FormData()
    body.append('avatar', file)
    try { const { url } = await profileApi.uploadAvatar(body); setForm((current) => ({ ...current, avatar: url })); setUser({ ...user, avatar: url }); toast('Photo updated.') }
    catch (error) { toast(error.message, 'error') } finally { event.target.value = '' }
  }

  return (
    <>
      <PageHeader title="Profile" subtitle="Keep your account details up to date." />
      <Async state={state} label="Loading profile…">{() => (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-6">
          <form onSubmit={save} className="card card-pad" noValidate>
            <h2 className="text-lg font-bold">Account information</h2>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {FIELDS.map(([key, label, type]) => (
                <div key={key} className={key === 'address' ? 'sm:col-span-2' : ''}>
                  <label className="label" htmlFor={`profile-${key}`}>{label}</label>
                  <input id={`profile-${key}`} type={type || 'text'} className="input" value={form[key] ?? ''} aria-invalid={errors[key] ? true : undefined}
                    onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
                  {errors[key] && <p className="mt-1 text-xs text-danger">{errors[key]}</p>}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end"><button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
          </form>
          <ChangePassword hasPassword={form.hasPassword !== false} />
          </div>
          <aside className="space-y-6">
            <section className="card card-pad flex flex-col items-center text-center">
              <Avatar src={form.avatar} name={form.name || form.firstName || ''} size={112} />
              <p className="mt-3 font-semibold">{form.name}</p>
              <p className="text-sm capitalize text-ink-muted">{form.role}</p>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} aria-label="Upload a profile photo" />
              <button type="button" onClick={() => fileRef.current.click()} className="btn-ghost mt-4"><UploadIcon className="h-4 w-4" />Change photo</button>
            </section>
            {form.role === 'student' && (
              <section className="card card-pad">
                <h2 className="flex items-center gap-2 text-base font-bold"><GoogleIcon />Google sign-in</h2>
                {form.googleLinked
                  ? <p className="mt-2 flex items-center gap-2 text-sm text-success"><CheckCircleIcon className="h-4 w-4" />Your Google account is linked.</p>
                  : <>
                      <p className="mt-2 text-sm text-ink-muted">Link a verified Google account that uses this same email address to sign in with Google.</p>
                      <a href={authApi.googleLinkUrl()} className="btn-ghost mt-4 w-full">Link Google account</a>
                    </>}
              </section>
            )}
          </aside>
        </div>
      )}</Async>
    </>
  )
}
