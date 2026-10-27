import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi, useDebounced } from '../../hooks'
import { adminApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { PageHeader, StatCard, fmtDate, fmtDateTime, pct } from '../../components/ui/Primitives'
import { SearchIcon, UsersIcon } from '../../components/ui/Icons'

const SORTS = [['name', 'Name A–Z'], ['-name', 'Name Z–A'], ['-registered', 'Newest registrations'], ['registered', 'Oldest registrations'],
  ['-lastLogin', 'Recent sign-in'], ['-courses', 'Most courses'], ['-progress', 'Highest progress'], ['progress', 'Lowest progress']]

// Administrator student directory backed by /api/admin/students (search, filters, sorting, pagination).
export default function Students() {
  const [filters, setFilters] = useState({ q: '', enrollment: '', status: '', login: '', sort: 'name', page: 1 })
  const q = useDebounced(filters.q, 300)
  const params = { ...filters, q, pageSize: 20 }
  const state = useApi(() => adminApi.students(params), [q, filters.enrollment, filters.status, filters.login, filters.sort, filters.page])
  const set = (key) => (event) => setFilters({ ...filters, [key]: event.target.value, page: 1 })

  return (
    <>
      <PageHeader eyebrow="Administration" title="Students" subtitle="Registered learners, their course activity and learning progress." />
      {state.data?.summary && (
        <section className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Student summary">
          <StatCard label="Registered students" value={state.data.summary.total} />
          <StatCard label="Enrolled in a course" value={state.data.summary.enrolled} tone="success" />
          <StatCard label="Active in the last 7 days" value={state.data.summary.activeLast7Days} tone="purple" />
          <StatCard label="Never signed in" value={state.data.summary.neverLoggedIn} tone="warning" />
        </section>
      )}
      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
        <label className="relative"><span className="sr-only">Search students by name or email</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input type="search" className="input pl-10" placeholder="Search by name or email" value={filters.q} onChange={set('q')} />
        </label>
        <label><span className="sr-only">Enrollment</span><select className="input" value={filters.enrollment} onChange={set('enrollment')}><option value="">All enrollment</option><option value="enrolled">Enrolled</option><option value="not_enrolled">Not enrolled</option></select></label>
        <label><span className="sr-only">Course status</span><select className="input" value={filters.status} onChange={set('status')}><option value="">Any course status</option><option value="ongoing">Has a course in progress</option><option value="completed">Completed a course</option></select></label>
        <label><span className="sr-only">Sign-in history</span><select className="input" value={filters.login} onChange={set('login')}><option value="">Any sign-in history</option><option value="logged_in">Has signed in</option><option value="never">Never signed in</option></select></label>
        <label><span className="sr-only">Sort students</span><select className="input" value={filters.sort} onChange={set('sort')}>{SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <Async state={state} label="Loading students…">{(data) => (
        <section className="card" aria-live="polite">
          {data.results.length ? (
            <>
              <div className="overflow-x-auto">
                <table className="table min-w-[860px]">
                  <thead><tr><th>Student</th><th>Registered</th><th>Last sign-in</th><th>Courses</th><th>Completed</th><th>Avg. progress</th><th className="sr-only">Actions</th></tr></thead>
                  <tbody>{data.results.map((student) => (
                    <tr key={student.id}>
                      <td><Link to={`/admin/students/${student.id}`} className="font-semibold hover:text-brand">{student.name}</Link><span className="block text-xs text-ink-muted">{student.email}</span></td>
                      <td className="text-sm">{fmtDate(student.registeredAt)}</td>
                      <td className="text-sm">{student.lastLoginAt ? fmtDateTime(student.lastLoginAt) : <span className="badge-warning">Never</span>}</td>
                      <td>{student.enrollmentCount}</td><td>{student.completedCount}</td><td>{pct(student.averageProgress)}</td>
                      <td className="text-right"><Link to={`/admin/students/${student.id}`} className="btn-ghost btn-sm">View details</Link></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm">
                <span className="text-ink-muted">Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total}</span>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={data.page <= 1} onClick={() => setFilters({ ...filters, page: data.page - 1 })}>← Previous</button>
                  <span>Page {data.page} of {data.pages}</span>
                  <button type="button" className="btn-ghost btn-sm" disabled={data.page >= data.pages} onClick={() => setFilters({ ...filters, page: data.page + 1 })}>Next →</button>
                </div>
              </div>
            </>
          ) : <EmptyState title={data.summary.total ? 'No matching students' : 'No registered students yet'} icon={UsersIcon}>{data.summary.total ? 'Try a different search or filter.' : 'Student accounts appear here after they register.'}</EmptyState>}
        </section>
      )}</Async>
    </>
  )
}
