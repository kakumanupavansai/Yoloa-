import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { adminApi } from '../../services/api'
import { ErrorBox } from '../../components/ui/States'
import { PageHeader, StatCard, pct } from '../../components/ui/Primitives'
import { BarChart, DonutChart, HBarList, LineChart, chartDate } from '../../components/ui/Charts'
import { ChartIcon } from '../../components/ui/Icons'

const PRESETS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']]
const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
export const presetRange = (days) => ({ start: daysAgo(days - 1), end: iso(new Date()) })

// Long ranges are summed per week (labelled by the week's first day) so the charts stay readable.
export function bucketSeries(points, days) {
  if (days <= 92) return points
  const size = days > 200 ? 14 : 7
  const out = []
  points.forEach((point, index) => {
    if (index % size === 0) out.push({ date: point.date, value: 0 })
    out[out.length - 1].value += point.value
  })
  return out
}

function Panel({ title, subtitle, children, className = '', action }) {
  return (
    <section className={`card card-pad ${className}`} aria-label={title}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="text-base font-bold">{title}</h2>{subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }) => <p className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line px-4 text-center text-sm text-ink-muted">{children}</p>

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">{Array.from({ length: 5 }, (_, k) => <div key={k} className="card h-[108px] p-5"><span className="skeleton block h-3 w-24" /><span className="skeleton mt-4 block h-7 w-16" /></div>)}</div>
      <div className="grid gap-6 xl:grid-cols-3"><div className="card h-72 xl:col-span-2" /><div className="card h-72" /></div>
    </div>
  )
}

function Overview({ data }) {
  const { students, completion, quizzes } = data
  const days = data.range.days
  const logins = bucketSeries(data.logins, days)
  const active = bucketSeries(data.activeStudentsByDay, days)
  const registrations = bucketSeries(data.registrations, days)
  const per = days > 92 ? (days > 200 ? 'per 2 weeks' : 'per week') : 'per day'
  const enrolled = data.courses.filter((course) => course.enrolled > 0)
  const anyLogins = data.logins.some((point) => point.value)
  const anyRegistrations = data.registrations.some((point) => point.value)
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5" aria-label="Key figures">
        <StatCard label="Registered students" value={students.total} hint={`${students.newInRange} new in this period`} testId="kpi-total" />
        <StatCard label="Active students" value={students.activeInRange} tone="success" hint={`signed in during this period · ${students.inactiveInRange} inactive`} testId="kpi-active" />
        <StatCard label="Account status" value={`${students.accountActive} / ${students.accountDisabled}`} tone="purple" hint="enabled / disabled accounts" />
        <StatCard label="Course completion" value={completion.rate === null ? '—' : `${completion.rate}%`} tone="warning" hint={`${completion.completed} of ${completion.enrollments} enrollments`} />
        <StatCard label="Quiz pass rate" value={quizzes.passRate === null ? '—' : `${quizzes.passRate}%`} tone="danger" hint={`${quizzes.attempts} attempts · average ${pct(quizzes.averagePercent)}`} />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Login activity" subtitle={`Successful student sign-ins ${per}. Token refreshes are not counted.`} className="xl:col-span-2">
          {anyLogins ? <LineChart title="Login activity" labels={logins.map((point) => point.date)}
            series={[{ key: 'logins', label: 'Sign-ins', values: logins.map((point) => point.value) }, { key: 'active', label: 'Unique students', values: active.map((point) => point.value) }]} />
            : <Empty>No student sign-ins between {chartDate(data.range.start)} and {chartDate(data.range.end)}.</Empty>}
        </Panel>
        <Panel title="Active and inactive students" subtitle="Active = signed in during the selected period.">
          <DonutChart title="Active and inactive students" centerLabel="students" data={[
            { key: 'active', label: 'Active in period', value: students.activeInRange, color: 'rgb(var(--chart-2))' },
            { key: 'inactive', label: 'No sign-in in period', value: students.inactiveInRange, color: 'rgb(var(--chart-grid))' }]} />
          <p className="mt-4 text-xs text-ink-muted">{students.neverSignedIn} student{students.neverSignedIn === 1 ? ' has' : 's have'} never signed in.</p>
          {data.loginMethods.length > 0 && <p className="mt-2 flex flex-wrap gap-1.5 text-xs">{data.loginMethods.map((row) => <span key={row.method || 'none'} className="badge">{row.label} · {row.value}</span>)}</p>}
        </Panel>
      </div>

      <Panel title="Student registrations" subtitle={`New student accounts ${per}.`}>
        {anyRegistrations ? <BarChart title="Student registrations" keys={[{ key: 'value', label: 'Registrations' }]}
          data={registrations.map((point) => ({ label: chartDate(point.date), values: { value: point.value } }))} height={200} />
          : <Empty>No students registered in this period.</Empty>}
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Course enrollment distribution" subtitle="Students enrolled in each course (all time).">
          {enrolled.length ? <HBarList title="Enrollments per course" rows={enrolled.map((course, index) => ({ key: course.id, label: course.title, value: course.enrolled, tone: index, suffix: course.isPublished ? '' : 'unpublished' }))} />
            : <Empty>No enrollments yet.</Empty>}
        </Panel>
        <Panel title="Course completion" subtitle={`${completion.completedInRange} course${completion.completedInRange === 1 ? '' : 's'} completed in this period · ${completion.ongoing} in progress overall.`}>
          {enrolled.length ? <BarChart title="Completed and in-progress enrollments per course" keys={[{ key: 'completed', label: 'Completed' }, { key: 'ongoing', label: 'In progress' }]}
            data={enrolled.map((course) => ({ label: course.title, values: { completed: course.completed, ongoing: course.ongoing } }))} height={220} />
            : <Empty>Completion statistics appear once students enroll.</Empty>}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <Panel title="Quiz performance distribution" subtitle="Submitted attempts in the period, grouped by score." className="xl:col-span-3">
          {quizzes.attempts ? <BarChart title="Quiz score distribution" keys={[{ key: 'quiz', label: 'Module quizzes' }, { key: 'final', label: 'Final exams' }]}
            data={quizzes.distribution.map((bucket) => ({ label: bucket.label, values: { quiz: bucket.quiz, final: bucket.final } }))} height={220} />
            : <Empty>No quiz attempts were submitted in this period.</Empty>}
        </Panel>
        <Panel title="By quiz" subtitle="Most-attempted quizzes in the period." className="xl:col-span-2">
          {quizzes.byQuiz.length ? (
            <div className="-mx-2 overflow-x-auto">
              <table className="table min-w-[360px]">
                <thead><tr><th>Quiz</th><th className="text-right">Attempts</th><th className="text-right">Pass</th><th className="text-right">Avg</th></tr></thead>
                <tbody>{quizzes.byQuiz.map((row) => (
                  <tr key={row.id}><td><span className="font-medium">{row.title}</span><span className="block text-xs text-ink-muted">{row.course || '—'}{row.type === 'final_exam' ? ' · final exam' : ''}</span></td>
                    <td className="text-right tabular-nums">{row.attempts}</td><td className="text-right tabular-nums">{row.passRate}%</td><td className="text-right tabular-nums">{pct(row.averagePercent)}</td></tr>))}</tbody>
              </table>
            </div>) : <Empty>No attempts yet.</Empty>}
        </Panel>
      </div>
      <p className="text-xs text-ink-muted">All figures are calculated from stored records. Individual sign-in history is on each student’s page under <Link to="/admin/students" className="link">Students</Link>.</p>
    </div>
  )
}

// Admin analytics dashboard (replaces the old sign-in log page).
export default function Analytics() {
  const [preset, setPreset] = useState(30)
  const [range, setRange] = useState(() => presetRange(30))
  const [draft, setDraft] = useState(range)
  const state = useApi(() => adminApi.analyticsOverview(range), [range.start, range.end])
  const custom = preset === null
  const choosePreset = (days) => { const next = presetRange(days); setPreset(days); setRange(next); setDraft(next) }
  const apply = (event) => { event.preventDefault(); if (draft.start && draft.end && draft.start <= draft.end) { setPreset(null); setRange(draft) } }
  const invalid = Boolean(draft.start && draft.end && draft.start > draft.end)
  const label = useMemo(() => `${chartDate(range.start)} – ${chartDate(range.end)}`, [range])
  return (
    <>
      <PageHeader eyebrow="Administration" title="Analytics" subtitle={`Student activity, enrollments and quiz results · ${label}`} />
      <div className="card mb-6 flex flex-col gap-3 p-4 lg:flex-row lg:items-end" role="search" aria-label="Date range">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
          {PRESETS.map(([days, text]) => (
            <button key={days} type="button" onClick={() => choosePreset(days)} aria-pressed={preset === days}
              className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${preset === days ? 'bg-brand text-white' : 'bg-ground text-ink-soft hover:text-ink'}`}>{text}</button>))}
        </div>
        <form onSubmit={apply} className="flex flex-wrap items-end gap-2 lg:ml-auto">
          <label className="text-xs font-semibold text-ink-muted">From<input type="date" className="input mt-1" value={draft.start} max={draft.end || undefined} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
          <label className="text-xs font-semibold text-ink-muted">To<input type="date" className="input mt-1" value={draft.end} min={draft.start || undefined} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
          <button type="submit" className={custom ? 'btn-primary' : 'btn-ghost'} disabled={invalid || !draft.start || !draft.end}>Apply</button>
        </form>
        {invalid && <p className="text-xs text-danger" role="alert">The start date must be before the end date.</p>}
      </div>
      {state.loading && !state.data && <DashboardSkeleton />}
      {state.error && <ErrorBox error={state.error} onRetry={state.reload} title="Could not load analytics" />}
      {state.data && (
        <div className={state.loading ? 'opacity-60 transition-opacity' : ''} aria-busy={state.loading}>
          {state.data.students.total === 0
            ? <div className="card p-10 text-center"><ChartIcon className="mx-auto h-8 w-8 text-brand" /><h2 className="mt-3 text-lg font-bold">No students yet</h2><p className="mt-1 text-sm text-ink-muted">Charts appear once students register and start learning.</p></div>
            : <Overview data={state.data} />}
        </div>
      )}
    </>
  )
}
