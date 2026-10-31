import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'
import HeroArt from '../ui/HeroArt'
import * as I from '../ui/Icons'

// Shared building blocks for every public authentication screen (portal choice, sign-in,
// registration, password reset) so the screens look and behave the same.

const portalCopy = {
  student: { label: 'Student portal', icon: I.StudentIcon, tone: 'bg-brand-soft text-brand-dark' },
  admin: { label: 'Administrator portal', icon: I.ShieldIcon, tone: 'bg-[#1f1f5c] text-white' },
}

export function PortalBadge({ portal }) {
  const { label, icon: Icon, tone } = portalCopy[portal]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />{label}
    </span>
  )
}

export function AuthShell({ children, wide = false, aside, showArt = true }) {
  return (
    <div className={`min-h-screen bg-gradient-to-br from-surface via-ground to-brand-soft ${showArt ? 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]' : ''}`}>
      <main className="flex min-h-screen flex-col px-4 py-6 sm:px-8 lg:px-14">
        <header className="flex items-center justify-between">
          <Link to="/" className="rounded-md focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/40" aria-label="YOLOA home">
            <Logo className="text-[22px]" />
          </Link>
        </header>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'}`}>{children}</div>
        </div>
        <footer className="text-center text-xs text-ink-muted">YOLOA · You Only Learn Once</footer>
      </main>
      {showArt && <aside className="relative hidden overflow-hidden bg-hero lg:flex lg:flex-col lg:justify-between lg:p-12" aria-hidden="true">
        <p className="max-w-sm text-3xl font-bold leading-tight text-white">
          {aside || <><span className="text-[#ffd5dd]">Y</span>ou Only Learn Once — make every lesson count.</>}
        </p>
        <div className="mx-auto h-[55vh] w-full max-w-lg"><HeroArt /></div>
      </aside>}
    </div>
  )
}

// A card containing the page heading; `back` renders a consistent back link above the title.
export function AuthCard({ title, subtitle, back, badge, children }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-6 shadow-[0_10px_40px_-12px_rgba(38,38,174,0.25)] sm:p-9">
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
      {badge && <div className="mt-4">{badge}</div>}
      <h1 className="mt-3 text-2xl font-bold text-ink sm:text-[28px]">{title}</h1>
      {subtitle && <p className="mt-2 text-sm leading-relaxed text-ink-soft">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </section>
  )
}

export function BackLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1.5 rounded-md text-sm font-semibold text-brand hover:text-brand-dark hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30">
      <I.ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />{children}
    </Link>
  )
}

const inputClass = (invalid) =>
  `block w-full rounded-xl border bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted outline-none transition focus:ring-4 disabled:bg-ground ${
    invalid ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-line focus:border-brand focus:ring-brand/20'}`

function FieldMessage({ id, error, hint }) {
  if (error) return <p id={id} className="mt-1.5 text-xs font-medium text-danger">{error}</p>
  if (hint) return <p id={id} className="mt-1.5 text-xs text-ink-muted">{hint}</p>
  return null
}

export function TextField({ label, error, hint, className = '', ...props }) {
  const id = useId()
  const messageId = `${id}-msg`
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-soft">{label}</label>
      <input id={id} className={inputClass(error)} aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined} {...props} />
      <FieldMessage id={messageId} error={error} hint={hint} />
    </div>
  )
}

export function PasswordField({ label = 'Password', error, hint, className = '', ...props }) {
  const id = useId()
  const messageId = `${id}-msg`
  const [visible, setVisible] = useState(false)
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink-soft">{label}</label>
      <div className="relative">
        <input id={id} type={visible ? 'text' : 'password'} className={`${inputClass(error)} pr-12`}
          aria-invalid={error ? true : undefined} aria-describedby={error || hint ? messageId : undefined} {...props} />
        <button type="button" onClick={() => setVisible((shown) => !shown)} aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'} title={visible ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-1.5 my-auto flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-ground hover:text-ink focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30">
          {visible ? <I.EyeOffIcon className="h-5 w-5" aria-hidden="true" /> : <I.EyeIcon className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>
      <FieldMessage id={messageId} error={error} hint={hint} />
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden="true" />
}

export function SubmitButton({ busy, busyLabel, children, disabled, variant = 'primary', ...props }) {
  const look = variant === 'admin'
    ? 'bg-[#1f1f5c] hover:bg-[#2a2a78] focus-visible:ring-[#1f1f5c]/40'
    : 'bg-brand hover:bg-brand-strong focus-visible:ring-brand/40'
  return (
    <button type="submit" disabled={busy || disabled} aria-busy={busy || undefined}
      className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold text-white shadow-sm transition focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 ${look}`} {...props}>
      {busy && <Spinner />}{busy ? busyLabel : children}
    </button>
  )
}

export function FormAlert({ tone = 'error', children }) {
  if (!children) return null
  const styles = tone === 'success'
    ? 'border-success/30 bg-success-soft text-success'
    : tone === 'info' ? 'border-brand/20 bg-brand-soft/50 text-brand-dark' : 'border-danger/30 bg-danger-soft text-danger'
  const Icon = tone === 'success' ? I.CheckCircleIcon : I.AlertIcon
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div>{children}</div>
    </div>
  )
}

export function Divider({ children }) {
  return <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-ink-muted"><span className="h-px flex-1 bg-line" />{children}<span className="h-px flex-1 bg-line" /></div>
}

export const textLink = 'rounded font-semibold text-brand hover:text-brand-dark hover:underline focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30'

// Human-readable messages for API failures; never reveals more than the server chose to say.
export function errorMessage(error, fallback) {
  if (!error) return fallback
  if (error.status === 429) return error.message || 'Too many attempts. Please wait a few minutes and try again.'
  if (error.status >= 500 && error.status !== 503) return 'The server ran into a problem. Please try again shortly.'
  if (error instanceof TypeError) return 'Cannot reach the YOLOA server. Check your connection and that the backend is running.'
  if (error.status === 403 && /csrf/i.test(error.message || '')) return 'Your session expired. Refresh the page and try again.'
  return error.message || fallback
}
