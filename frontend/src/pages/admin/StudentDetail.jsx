import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { adminApi } from '../../services/api'
import Avatar from '../../components/ui/Avatar'
import { Async } from '../../components/ui/States'
import { Modal, useToast } from '../../components/ui/Feedback'
import { PageHeader, ProgressBar, StatCard, fmtDate, fmtDateTime, pct } from '../../components/ui/Primitives'
import { ModuleTable } from '../student/Progress'

const typeLabel = { module_quiz: 'Module quiz', final_exam: 'Final exam', legacy_quiz: 'Quiz' }

// Manual score adjustment (e.g. a short answer phrased differently). Every change is audited on the server.
function ReviewDialog({ attempt, onClose, onSaved }) {
  const toast = useToast()
  const detail = useApi(() => (attempt ? adminApi.attempt(attempt.id) : Promise.resolve(null)), [attempt?.id])
  const [score, setScore] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    try { await adminApi.reviewAttempt(attempt.id, { revisedScore: score, reason }); toast('Score updated and audit record saved.'); onSaved() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={Boolean(attempt)} onClose={onClose} wide title="Attempt review" subtitle={attempt ? `${attempt.title} · ${attempt.score}/${attempt.total}` : ''}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Close</button><button type="submit" form="review-form" className="btn-primary" disabled={busy || score === '' || !reason.trim()}>Save revised score</button></>}>
      <Async state={detail}>{(data) => data && (
        <div className="space-y-4">
          <ol className="space-y-2">{(data.review || []).map((item, index) => (
            <li key={item.id} className={`rounded-xl border-l-4 bg-ground p-3 text-sm ${item.isCorrect ? 'border-success' : 'border-danger'}`}>
              <p className="font-semibold">{index + 1}. {item.text}</p>
              <p className="mt-1 text-xs text-ink-muted">Answer: {item.chosen === undefined || item.chosen === null || item.chosen === '' ? 'Skipped' : Array.isArray(item.chosen) ? item.chosen.map((k) => item.choices[k]).join(', ') : item.questionType === 'short' ? item.chosen : item.questionType === 'true_false' ? String(item.chosen) : item.choices[item.chosen]} · {item.earned}/{item.points} pts</p>
            </li>
          ))}</ol>
          {data.reviews?.length > 0 && <div className="text-xs text-ink-muted">{data.reviews.map((review) => <p key={review.id}>{fmtDateTime(review.createdAt)} — {review.reviewer}: {review.originalScore} → {review.revisedScore} ({review.reason})</p>)}</div>}
          <form id="review-form" onSubmit={submit} className="grid gap-3 sm:grid-cols-[140px_1fr]">
            <label><span className="label">Revised score</span><input type="number" min={0} max={attempt.total} step="0.5" className="input" value={score} onChange={(event) => setScore(event.target.value)} /></label>
            <label><span className="label">Reason (recorded)</span><input className="input" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          </form>
        </div>
      )}</Async>
    </Modal>
  )
}

const fmtDuration = (seconds) => {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}
const ATTEMPT_FILTERS = [['all', 'All attempts'], ['quiz', 'Module quizzes'], ['final_exam', 'Final exams']]

// Full-width attempt table: quiz, course and module, date, time taken, score against the pass mark, and result.
function AttemptHistory({ attempts, onReview }) {
  const [filter, setFilter] = useState('all')
  const rows = attempts.filter((attempt) => filter === 'all' || (filter === 'final_exam' ? attempt.type === 'final_exam' : attempt.type !== 'final_exam'))
  return (
    <section className="card" aria-labelledby="attempt-history">
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id="attempt-history" className="text-lg font-bold">Quiz attempt history</h2>
          <p className="text-sm text-ink-muted">{attempts.length} submitted attempt{attempts.length === 1 ? '' : 's'}, newest first.</p>
        </div>
        <div className="flex rounded-xl border border-line bg-ground p-1" role="group" aria-label="Filter attempts">
          {ATTEMPT_FILTERS.map(([key, label]) => (
            <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filter === key ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}>{label}</button>))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="table min-w-[920px]">
          <thead><tr><th>Quiz / exam</th><th>Course · module</th><th>Attempt date</th><th>Time taken</th><th className="w-56">Score</th><th>Result</th><th className="sr-only">Review</th></tr></thead>
          <tbody>
            {rows.map((attempt) => (
              <tr key={attempt.id}>
                <td>
                  <span className="font-semibold">{attempt.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                    <span className={attempt.type === 'final_exam' ? 'badge-warning' : 'badge'}>{typeLabel[attempt.type]}</span>
                    {attempt.attemptNumber && <span>Attempt {attempt.attemptNumber}</span>}
                    {attempt.questionCount > 0 && <span>· {attempt.questionCount} question{attempt.questionCount === 1 ? '' : 's'}</span>}
                    {attempt.status === 'expired' && <span className="text-warning">· time expired</span>}
                    {attempt.reviewed && <span>· manually reviewed</span>}
                  </span>
                </td>
                <td className="text-sm"><span className="font-medium">{attempt.course || '—'}</span>{attempt.moduleTitle && <span className="block text-xs text-ink-muted">{attempt.moduleTitle}</span>}</td>
                <td className="whitespace-nowrap text-sm">{fmtDateTime(attempt.submittedAt)}</td>
                <td className="whitespace-nowrap text-sm tabular-nums">{fmtDuration(attempt.durationSeconds)}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <ProgressBar percent={attempt.percent} tone={attempt.passed ? 'success' : 'danger'} label={`Score ${pct(attempt.percent)}`} />
                    <span className="w-14 shrink-0 text-right text-sm font-semibold tabular-nums">{pct(attempt.percent)}</span>
                  </div>
                  <span className="text-xs text-ink-muted">{attempt.score}/{attempt.total} points{attempt.passPercent ? ` · pass ${attempt.passPercent}%` : ''}</span>
                </td>
                <td>{attempt.passed ? <span className="badge-success">Passed</span> : <span className="badge-danger">Not passed</span>}</td>
                <td className="text-right"><button type="button" className="btn-ghost btn-sm" onClick={() => onReview(attempt)}>Review</button></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="py-10 text-center text-ink-muted">{attempts.length ? 'No attempts of this type.' : 'No quiz or exam attempts yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SignIns({ s }) {
  const methods = s.loginHistory.reduce((counts, event) => ({ ...counts, [event.authMethodLabel]: (counts[event.authMethodLabel] || 0) + 1 }), {})
  return (
    <section className="card card-pad h-fit" aria-labelledby="recent-sign-ins">
      <h2 id="recent-sign-ins" className="text-lg font-bold">Recent sign-ins</h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-ground p-3"><dt className="text-xs text-ink-muted">Total sign-ins</dt><dd className="mt-0.5 font-display text-xl font-extrabold">{s.loginCount}</dd></div>
        <div className="rounded-xl bg-ground p-3"><dt className="text-xs text-ink-muted">Last sign-in</dt><dd className="mt-0.5 font-semibold">{s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : 'Never'}</dd></div>
      </dl>
      {Object.keys(methods).length > 0 && (
        <p className="mt-3 flex flex-wrap gap-1.5 text-xs">{Object.entries(methods).map(([label, count]) => <span key={label} className="badge">{label} · {count}</span>)}</p>)}
      <ol className="mt-4 divide-y divide-line" aria-label="Sign-in history">
        {s.loginHistory.map((event) => (
          <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />{fmtDateTime(event.createdAt)}</span>
            <span className="text-xs text-ink-muted">{event.authMethodLabel}</span>
          </li>))}
        {!s.loginHistory.length && <li className="py-3 text-sm text-ink-muted">No successful sign-ins recorded.</li>}
      </ol>
      {s.loginHistory.length > 0 && <p className="mt-2 text-xs text-ink-muted">Showing the latest {s.loginHistory.length} sign-in{s.loginHistory.length === 1 ? '' : 's'}.</p>}
    </section>
  )
}

export default function StudentDetail() {
  const { id } = useParams()
  const state = useApi(() => adminApi.student(id), [id])
  const [reviewing, setReviewing] = useState(null)
  return (
    <Async state={state} label="Loading student…">{(s) => (
      <>
        <PageHeader back={{ to: '/admin/students', label: 'All students' }} eyebrow="Student" title={s.name} subtitle={s.email} />
        <div className="space-y-6">
          <section className="card card-pad flex flex-col gap-5 md:flex-row md:items-center" aria-label="Profile">
            <div className="flex min-w-0 items-center gap-4 md:w-72 md:shrink-0">
              <Avatar name={s.name} size={56} />
              <div className="min-w-0"><p className="truncate text-lg font-bold">{s.name}</p><p className="truncate text-sm text-ink-muted">@{s.username}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">{s.isActive ? <span className="badge-success">Active account</span> : <span className="badge-danger">Disabled</span>}{s.googleLinked && <span className="badge-brand">Google linked</span>}</p></div>
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-3 text-sm lg:grid-cols-4">
              {[['Email', s.email], ['Registered', fmtDate(s.registeredAt)], ['Location', [s.city, s.country].filter(Boolean).join(', ') || 'Not provided'],
                ['Google sign-in', s.googleLinked ? 'Linked' : 'Not linked']].map(([label, value]) => (
                <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="truncate font-medium" title={value}>{value}</dd></div>
              ))}
            </dl>
          </section>

          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Performance">
            <StatCard label="Courses enrolled" value={s.enrollmentCount} hint={`${s.completedCount} completed`} />
            <StatCard label="Average quiz score" value={pct(s.metrics.averageQuizPercent)} tone="warning" hint={`${s.metrics.quizAttempts} quiz attempts · ${s.metrics.quizzesPassed} quizzes passed`} />
            <StatCard label="Final exams" value={s.metrics.finalAttempts} tone="purple" hint={`${s.metrics.finalsPassed} passed`} />
            <StatCard label="Successful sign-ins" value={s.loginCount} tone="success" hint={s.lastLoginAt ? `Last ${fmtDateTime(s.lastLoginAt)}` : 'Never signed in'} />
          </section>

          <AttemptHistory attempts={s.attempts} onReview={setReviewing} />

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              {s.enrollments.map((course) => (
                <section key={course.courseId} className="card card-pad space-y-4" aria-label={course.course}>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="flex-1 text-lg font-bold">{course.course}</h2>
                    {course.status === 'completed' ? <span className="badge-success">Completed {fmtDate(course.completedAt)}</span> : <span className="badge-brand">In progress</span>}
                  </div>
                  <div className="flex items-center gap-3"><ProgressBar percent={course.percent} /><span className="text-sm font-semibold">{course.percent}%</span><span className="whitespace-nowrap text-xs text-ink-muted">{course.completedModules}/{course.totalModules} modules</span></div>
                  <ModuleTable modules={course.modules} linkQuizzes={false} />
                  {course.finalExam && <p className="text-sm">Final exam: {course.finalExam.attempts ? <>latest <strong>{pct(course.finalExam.latestPercent)}</strong> · best <strong>{pct(course.finalExam.bestPercent)}</strong> · {course.finalExam.attempts} attempts · {course.finalExam.passed ? <span className="badge-success">Passed</span> : <span className="badge-danger">Not passed</span>}</> : course.finalExam.eligible ? 'eligible, not attempted' : 'locked until required modules are passed'}</p>}
                </section>
              ))}
              {!s.enrollments.length && <section className="card card-pad text-sm text-ink-muted">This student has not enrolled in any courses.</section>}
            </div>
            <SignIns s={s} />
          </div>
        </div>
        <ReviewDialog attempt={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); state.reload() }} />
      </>
    )}</Async>
  )
}
