// Small presentational building blocks shared by every authenticated screen.
import { Link } from 'react-router-dom'
import { ArrowLeftIcon } from './Icons'

export function PageHeader({ title, subtitle, eyebrow, actions, back }) {
  return (
    <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && <Link to={back.to} className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"><ArrowLeftIcon className="h-4 w-4" />{back.label}</Link>}
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="mt-1 break-words text-2xl font-extrabold tracking-tight sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-ink-muted sm:text-[15px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

const tones = { brand: 'bg-brand', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', purple: 'bg-accent-purple' }

export function StatCard({ label, value, hint, tone = 'brand', testId }) {
  return (
    <article className="card relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${tones[tone]}`} aria-hidden="true" />
      <p className="text-sm font-medium text-ink-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-extrabold tracking-tight" data-testid={testId}>{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </article>
  )
}

export function ProgressBar({ percent = 0, label, className = '', tone = 'brand' }) {
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)))
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-line ${className}`} role="progressbar" aria-valuenow={value}
      aria-valuemin={0} aria-valuemax={100} aria-label={label || `${value}% complete`}>
      <div className={`h-full rounded-full ${tones[tone]} transition-[width] duration-500`} style={{ width: `${value}%` }} />
    </div>
  )
}

export function CardHeading({ title, action, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {action}
      {children}
    </div>
  )
}

const palette = ['#2b59ce', '#0f9d75', '#d97706', '#db2777', '#7b70ee', '#0891b2']
export const accentFor = (text = '') => palette[[...String(text)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % palette.length]

// Course emblem: cover image when the admin uploaded one, otherwise a colour-coded monogram.
export function CourseEmblem({ course, size = 'md' }) {
  const dims = size === 'sm' ? 'h-9 w-9 text-xs rounded-lg' : size === 'lg' ? 'h-16 w-16 text-xl rounded-2xl' : 'h-12 w-12 text-base rounded-xl'
  if (course.cover) return <img src={course.cover} alt="" className={`${dims} shrink-0 object-cover`} />
  const accent = accentFor(course.category || course.title)
  const initials = String(course.title || '?').split(/\s+/).filter((word) => /^[A-Za-z0-9]/.test(word)).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  return <span aria-hidden="true" className={`${dims} flex shrink-0 items-center justify-center font-display font-extrabold`}
    style={{ background: `${accent}1f`, color: accent }}>{initials}</span>
}

export const fmtDate = (value) => (value ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '—')
export const fmtDateTime = (value) => (value ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—')
// The server rounds percentages to two decimals (1 of 3 points = 33.33); show them as given, without trailing zeros.
export const pct = (value) => (value === null || value === undefined || value === '' ? '—' : `${Number(Number(value).toFixed(2))}%`)
