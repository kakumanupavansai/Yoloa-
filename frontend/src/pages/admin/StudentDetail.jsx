import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { adminApi } from '../../services/api'
import Avatar from '../../components/ui/Avatar'
import { Async } from '../../components/ui/States'
import { Modal, useToast } from '../../components/ui/Feedback'
import { CardHeading, PageHeader, ProgressBar, StatCard, fmtDate, fmtDateTime, pct } from '../../components/ui/Primitives'
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

export default function StudentDetail() {
  const { id } = useParams()
  const state = useApi(() => adminApi.student(id), [id])
  const [reviewing, setReviewing] = useState(null)
  return (
    <Async state={state} label="Loading student…">{(s) => (
      <>
        <PageHeader back={{ to: '/admin/students', label: 'All students' }} eyebrow="Student" title={s.name} subtitle={s.email} />
        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Performance">
            <StatCard label="Courses enrolled" value={s.enrollmentCount} hint={`${s.completedCount} completed`} />
            <StatCard label="Average quiz score" value={pct(s.metrics.averageQuizPercent)} tone="warning" hint={`${s.metrics.quizAttempts} quiz attempts · ${s.metrics.quizzesPassed} quizzes passed`} />
            <StatCard label="Final exams" value={s.metrics.finalAttempts} tone="purple" hint={`${s.metrics.finalsPassed} passed`} />
            <StatCard label="Successful sign-ins" value={s.loginCount} tone="success" hint={s.lastLoginAt ? `Last ${fmtDateTime(s.lastLoginAt)}` : 'Never signed in'} />
          </section>

          <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <section className="card card-pad h-fit">
              <div className="flex items-center gap-3"><Avatar name={s.name} size={48} /><div><p className="font-semibold">{s.name}</p><p className="text-sm text-ink-muted">@{s.username}</p></div></div>
              <dl className="mt-5 space-y-3 text-sm">
                {[['Email', s.email], ['Registered', fmtDate(s.registeredAt)], ['Account', s.isActive ? 'Active' : 'Disabled'], ['Google sign-in', s.googleLinked ? 'Linked' : 'Not linked'],
                  ['Location', [s.city, s.country].filter(Boolean).join(', ') || 'Not provided']].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="text-right font-medium">{value}</dd></div>
                ))}
              </dl>
              <h3 className="mt-6 text-sm font-bold">Recent sign-ins</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {s.loginHistory.map((event) => <li key={event.id} className="flex justify-between gap-2"><span>{fmtDateTime(event.createdAt)}</span><span className="text-ink-muted">{event.authMethodLabel}</span></li>)}
                {!s.loginHistory.length && <li className="text-ink-muted">No successful sign-ins recorded.</li>}
              </ul>
            </section>

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

              <section className="card">
                <div className="p-5 sm:p-6"><CardHeading title="Attempt history" /></div>
                <div className="overflow-x-auto">
                  <table className="table min-w-[720px]">
                    <thead><tr><th>Assessment</th><th>Course</th><th>Submitted</th><th>Score</th><th>Result</th><th className="sr-only">Review</th></tr></thead>
                    <tbody>
                      {s.attempts.map((attempt) => (
                        <tr key={attempt.id}>
                          <td><span className="font-semibold">{attempt.title}</span><span className="block text-xs text-ink-muted">{typeLabel[attempt.type]}{attempt.status === 'expired' ? ' · time expired' : ''}{attempt.reviewed ? ' · manually reviewed' : ''}</span></td>
                          <td className="text-sm">{attempt.course || '—'}</td>
                          <td className="text-sm">{fmtDateTime(attempt.submittedAt)}</td>
                          <td>{attempt.score}/{attempt.total} ({pct(attempt.percent)})</td>
                          <td>{attempt.passed ? <span className="badge-success">Passed</span> : <span className="badge-danger">Not passed</span>}</td>
                          <td className="text-right"><button type="button" className="btn-ghost btn-sm" onClick={() => setReviewing(attempt)}>Review</button></td>
                        </tr>
                      ))}
                      {!s.attempts.length && <tr><td colSpan={6} className="py-8 text-center text-ink-muted">No quiz or exam attempts yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
        <ReviewDialog attempt={reviewing} onClose={() => setReviewing(null)} onSaved={() => { setReviewing(null); state.reload() }} />
      </>
    )}</Async>
  )
}
