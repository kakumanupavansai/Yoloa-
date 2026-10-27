import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { announcementsApi, dashboardApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { useToast } from '../../components/ui/Feedback'
import { CardHeading, PageHeader, StatCard, fmtDateTime, pct } from '../../components/ui/Primitives'
import { PlusIcon } from '../../components/ui/Icons'

const methodLabel = { email_password: 'Email & password', google: 'Google', legacy_jwt: 'API client' }

function Announcements({ items, onPosted }) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const post = async (event) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try { await announcementsApi.create({ text: text.trim() }); setText(''); toast('Announcement posted to student dashboards.'); onPosted() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }
  return (
    <section className="card card-pad">
      <CardHeading title="Announcements" />
      <form onSubmit={post} className="mt-4 space-y-2">
        <label htmlFor="announcement" className="sr-only">New announcement</label>
        <textarea id="announcement" rows={3} className="input" placeholder="Share an update with all students…" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} />
        <div className="flex justify-end"><button type="submit" className="btn-primary btn-sm" disabled={busy || !text.trim()}>{busy ? 'Posting…' : 'Post announcement'}</button></div>
      </form>
      <ul className="mt-4 space-y-3">
        {items.map((item) => <li key={item.id} className="rounded-xl bg-ground p-3 text-sm"><p>{item.text}</p><p className="mt-1 text-xs text-ink-muted">{item.author} · {fmtDateTime(item.createdAt)}</p></li>)}
        {!items.length && <li className="text-sm text-ink-muted">No announcements yet.</li>}
      </ul>
    </section>
  )
}

// Every number is computed by Django from stored users, enrollments, attempts and login events.
export default function AdminDashboard() {
  const state = useApi(() => dashboardApi.admin(), [])
  return (
    <>
      <PageHeader eyebrow="Administration" title="Dashboard" subtitle="Courses, learners and assessment activity at a glance."
        actions={<Link to="/admin/courses?new=1" className="btn-primary"><PlusIcon className="h-4 w-4" />New course</Link>} />
      <Async state={state} label="Loading dashboard…">{(d) => (
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Platform summary">
            <StatCard label="Students registered" value={d.stats.total} testId="students-registered" hint={`${d.stats.newThisWeek} new this week · ${d.stats.activeLast7Days} active in 7 days`} />
            <StatCard label="Courses" value={d.stats.courses} tone="purple" hint={`${d.stats.publishedCourses} published · ${d.stats.modules} modules`} />
            <StatCard label="Enrollments" value={d.stats.enrollments} tone="success" hint={`${d.stats.completedEnrollments} completed · avg progress ${pct(d.stats.averageProgress)}`} />
            <StatCard label="Assessment attempts" value={d.stats.quizAttempts + d.stats.finalAttempts} tone="warning" hint={`${d.stats.quizAttempts} quiz · ${d.stats.finalAttempts} final (${d.stats.finalPassed} passed)`} />
          </section>

          <section className="card">
            <div className="p-5 sm:p-6"><CardHeading title="Courses" action={<Link to="/admin/courses" className="link text-sm">Manage courses</Link>} /></div>
            <div className="overflow-x-auto">
              <table className="table min-w-[640px]">
                <thead><tr><th>Course</th><th>Status</th><th>Modules</th><th>Students</th><th>Completed</th><th>Avg. progress</th></tr></thead>
                <tbody>
                  {d.courses.map((course) => (
                    <tr key={course.id}>
                      <td><Link to={`/admin/courses/${course.id}`} className="font-semibold hover:text-brand">{course.title}</Link><span className="block text-xs text-ink-muted">{course.category}</span></td>
                      <td>{course.isPublished ? <span className="badge-success">Published</span> : <span className="badge">Draft</span>}</td>
                      <td>{course.modules}</td><td>{course.students}</td><td>{course.completions}</td><td>{pct(course.averageProgress)}</td>
                    </tr>
                  ))}
                  {!d.courses.length && <tr><td colSpan={6} className="py-8 text-center text-ink-muted">No courses yet. Create the first one to start building the catalogue.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-3">
            <section className="card card-pad">
              <CardHeading title="Recent sign-ins" action={<Link to="/admin/analytics" className="link text-sm">Analytics</Link>} />
              <ul className="mt-4 space-y-3">
                {d.recentLogins.map((event) => <li key={event.id} className="flex items-center justify-between gap-3 text-sm"><Link to={`/admin/students/${event.userId}`} className="truncate font-semibold hover:text-brand">{event.name}</Link><span className="shrink-0 text-xs text-ink-muted">{methodLabel[event.authMethod] || 'Other'} · {fmtDateTime(event.createdAt)}</span></li>)}
                {!d.recentLogins.length && <li className="text-sm text-ink-muted">No student sign-ins recorded yet.</li>}
              </ul>
            </section>
            <section className="card card-pad">
              <CardHeading title="Latest attempts" action={<Link to="/admin/students" className="link text-sm">Students</Link>} />
              <ul className="mt-4 space-y-3">
                {d.recentAttempts.map((attempt) => (
                  <li key={attempt.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2"><Link to={`/admin/students/${attempt.studentId}`} className="truncate font-semibold hover:text-brand">{attempt.student}</Link>{attempt.passed ? <span className="badge-success">{pct(attempt.percent)}</span> : <span className="badge-danger">{pct(attempt.percent)}</span>}</div>
                    <p className="truncate text-xs text-ink-muted">{attempt.title} · {fmtDateTime(attempt.submittedAt)}</p>
                  </li>
                ))}
                {!d.recentAttempts.length && <li className="text-sm text-ink-muted">No quiz or exam attempts yet.</li>}
              </ul>
            </section>
            <Announcements items={d.announcements} onPosted={state.reload} />
          </div>
        </div>
      )}</Async>
    </>
  )
}
