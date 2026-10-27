import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { adminApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { CardHeading, PageHeader, StatCard, fmtDateTime, pct } from '../../components/ui/Primitives'

const methodLabel = { email_password: 'Email & password', google: 'Google', legacy_jwt: 'API client', '': 'Unspecified' }

// Aggregates from stored login events (successful sign-ins only; token refreshes are excluded) and final-exam attempts.
export default function Analytics() {
  const [range, setRange] = useState({ start: '', end: '' })
  const [page, setPage] = useState(1)
  const logins = useApi(() => adminApi.loginAnalytics({ ...range, page, pageSize: 20 }), [range.start, range.end, page])
  const exams = useApi(() => adminApi.examAnalytics(range), [range.start, range.end])
  const set = (key) => (event) => { setRange({ ...range, [key]: event.target.value }); setPage(1) }
  return (
    <>
      <PageHeader eyebrow="Administration" title="Analytics" subtitle="Sign-in activity and final examination outcomes."
        actions={<div className="flex flex-wrap gap-2">
          <label className="text-xs font-semibold text-ink-muted">From<input type="date" className="input mt-1" value={range.start} onChange={set('start')} /></label>
          <label className="text-xs font-semibold text-ink-muted">To<input type="date" className="input mt-1" value={range.end} onChange={set('end')} /></label>
        </div>} />
      <div className="space-y-6">
        <Async state={exams} label="Loading exam analytics…">{(data) => (
          <section aria-label="Final examinations">
            <h2 className="mb-3 text-lg font-bold">Final examinations <span className="text-sm font-medium text-ink-muted">({Math.round(data.finalExamDurationSeconds / 60)} minutes, server-timed)</span></h2>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <StatCard label="Published final exams" value={data.metrics.publishedFinalExams} />
              <StatCard label="Completed attempts" value={data.metrics.completed} tone="purple" hint={`${data.metrics.inProgress} in progress · ${data.metrics.expired} expired`} />
              <StatCard label="Pass rate" value={pct(data.metrics.passRate)} tone="success" hint={`${data.metrics.passed} passed · ${data.metrics.failed} not passed`} />
              <StatCard label="Average score" value={pct(data.metrics.averagePercent)} tone="warning" />
            </div>
          </section>
        )}</Async>
        <Async state={logins} label="Loading sign-in analytics…">{(data) => (
          <>
            <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Sign-ins">
              <StatCard label="Successful sign-ins" value={data.metrics.successfulLogins} hint={`${data.metrics.uniqueSignedIn} unique users`} />
              <StatCard label="Email & password" value={data.metrics.emailPasswordLogins} tone="purple" />
              <StatCard label="Google" value={data.metrics.googleLogins} tone="success" />
              <StatCard label="New registrations" value={data.metrics.newRegistrations} tone="warning" hint={`${data.metrics.registeredStudents} students in total`} />
            </section>
            <section className="card">
              <div className="p-5 sm:p-6"><CardHeading title="Sign-in log" /></div>
              <div className="overflow-x-auto">
                <table className="table min-w-[520px]">
                  <thead><tr><th>User</th><th>Method</th><th>Time</th></tr></thead>
                  <tbody>
                    {data.events.map((event) => <tr key={event.id}><td><Link to={`/admin/students/${event.userId}`} className="font-semibold hover:text-brand">{event.name}</Link></td><td>{methodLabel[event.authMethod] || event.authMethod}</td><td className="text-sm">{fmtDateTime(event.createdAt)}</td></tr>)}
                    {!data.events.length && <tr><td colSpan={3} className="py-8 text-center text-ink-muted">No sign-ins in this period.</td></tr>}
                  </tbody>
                </table>
              </div>
              {data.total > data.pageSize && (
                <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 text-sm">
                  <button type="button" className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
                  <span>Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
                  <button type="button" className="btn-ghost btn-sm" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next →</button>
                </div>
              )}
            </section>
          </>
        )}</Async>
      </div>
    </>
  )
}
