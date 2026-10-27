import { AlertIcon, RefreshIcon, SearchIcon } from './Icons'

export function Spinner({ className = 'h-4 w-4' }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`} aria-hidden="true" />
}

export const Loading = ({ label = 'Loading…' }) => (
  <div className="flex items-center gap-3 p-6 text-sm text-ink-muted" role="status"><Spinner className="h-5 w-5 text-brand" />{label}</div>
)

// API failures are always shown (with retry); the app never substitutes sample data.
export function ErrorBox({ error, onRetry, title = 'Something went wrong' }) {
  const offline = error instanceof TypeError
  return (
    <div role="alert" className="card my-4 flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertIcon /></span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-ink-muted">{offline ? 'Cannot reach the YOLOA server. Check that the backend is running.' : error?.message || 'Please try again.'}</p>
      </div>
      {onRetry && <button type="button" onClick={onRetry} className="btn-ghost btn-sm"><RefreshIcon className="h-4 w-4" />Retry</button>}
    </div>
  )
}

export function EmptyState({ title = 'Nothing here yet', children, action, icon: Icon = SearchIcon }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand"><Icon /></span>
      <h2 className="mt-4 text-lg font-bold">{title}</h2>
      {children && <p className="mt-1 max-w-md text-sm text-ink-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

// Wraps a useApi() result: renders loading/error or children(data).
export function Async({ state, children, label }) {
  if (state.loading && !state.data) return <Loading label={label} />
  if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />
  return children(state.data)
}
