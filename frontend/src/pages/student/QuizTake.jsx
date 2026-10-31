import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { assessmentsApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { useConfirm } from '../../components/ui/Feedback'
import { PageHeader, fmtDateTime, pct } from '../../components/ui/Primitives'
import { ClockIcon, LockIcon } from '../../components/ui/Icons'
import { fmtTime } from '../../utils'
import { QuizImage } from '../../components/admin/QuizImageField'

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// One start request per assessment at a time. React StrictMode mounts the runner twice in development and a
// fast double click can remount it; both now share the same request instead of racing two starts.
const startRequests = new Map()
function startAttempt(id) {
  if (!startRequests.has(id)) startRequests.set(id, assessmentsApi.start(id).finally(() => startRequests.delete(id)))
  return startRequests.get(id)
}

// One assessment UI serves module quizzes and final exams. The server owns the attempt, answers,
// answer version, deadline and score; this component only renders the current server state.
export default function QuizTake({ final = false }) {
  const { id } = useParams()
  const state = useApi(() => assessmentsApi.get(id), [id])
  const [stage, setStage] = useState('intro')
  const [result, setResult] = useState(null)
  const [round, setRound] = useState(0)

  const start = () => { setResult(null); setRound((value) => value + 1); setStage('taking') }
  const finish = (value) => { setResult(value); setStage('result'); state.reload() }

  if (state.error?.status === 403) {
    return (
      <div className="card mx-auto mt-6 max-w-xl p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ground text-ink-muted"><LockIcon /></span>
        <h1 className="mt-4 text-xl font-bold">{final ? 'The final exam is locked' : 'This quiz is locked'}</h1>
        <p className="mt-1 text-sm text-ink-muted">{state.error.message}</p>
        <Link to="/student/my-courses" className="btn-primary mt-5">Back to my courses</Link>
      </div>
    )
  }
  return (
    <Async state={state} label="Loading assessment…">{(assessment) => {
      const back = assessment.courseId ? { to: `/student/courses/${assessment.courseId}`, label: assessment.courseTitle || 'Course' } : { to: '/student/my-courses', label: 'My courses' }
      return (
        <>
          <PageHeader back={back} eyebrow={final ? 'Final examination' : assessment.moduleTitle ? `Module quiz · ${assessment.moduleTitle}` : 'Quiz'} title={assessment.title} />
          <section className="card p-4 sm:p-6">
            {stage === 'intro' && <Intro assessment={assessment} final={final} onStart={start} />}
            {stage === 'taking' && <Runner key={round} assessment={assessment} final={final} onDone={finish} />}
            {stage === 'result' && <Result assessment={assessment} result={result} onRetake={start} final={final} back={back} />}
          </section>
        </>
      )
    }}</Async>
  )
}

function Intro({ assessment, final, onStart }) {
  const history = useApi(() => assessmentsApi.history(assessment.id), [assessment.id, assessment.attempts])
  const eligibility = assessment.eligibility || { eligible: true, reasons: [] }
  const blocked = final && !eligibility.eligible
  const resuming = Boolean(assessment.activeAttemptId)
  return (
    <div className="mx-auto max-w-2xl py-2">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[['Questions', assessment.questionCount], ['Points', assessment.totalPoints], ['Time', final ? '10 min' : assessment.durationSeconds ? `${Math.round(assessment.durationSeconds / 60)} min` : 'Untimed'], ['Pass mark', `${assessment.passPercent}%`]].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-ground p-4 text-center"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 text-xl font-bold">{value}</dd></div>
        ))}
      </dl>
      {weighted(assessment.questions) && <p className="mt-3 text-xs text-ink-muted">Questions are worth different points; your score is the points earned out of {assessment.totalPoints}.</p>}
      {assessment.attempts > 0 && (
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <span className="badge-brand">Latest {pct(assessment.latestPercent)}</span>
          <span className="badge-success">Best {pct(assessment.bestPercent)}</span>
          <span className="badge">{assessment.attempts} attempt{assessment.attempts === 1 ? '' : 's'}</span>
          {assessment.passed && <span className="badge-success">Passed</span>}
        </div>
      )}
      {blocked && <div className="mt-5 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning"><p className="font-bold">Final exam locked</p><ul className="mt-2 list-disc pl-5">{eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div>}
      {resuming && <p className="mt-5 rounded-xl border border-brand/20 bg-brand-soft p-4 text-sm text-brand-dark">You have an attempt in progress. Resuming keeps your saved answers{final ? ' and the original deadline' : ''}.</p>}
      <p className="mt-5 text-sm text-ink-muted">{final
        ? 'The 10-minute timer is kept by the server. Answers save automatically; refreshing the page resumes the same attempt without resetting the clock. When time runs out the attempt is submitted with the answers saved so far.'
        : 'Answers save automatically. You can retake this quiz as often as you like; earlier attempts and a previous pass are never lost.'}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" disabled={blocked} onClick={onStart} className="btn-primary px-8">{resuming ? 'Resume attempt' : assessment.attempts > 0 ? `Retake ${final ? 'exam' : 'quiz'}` : `Start ${final ? 'exam' : 'quiz'}`}</button>
      </div>
      {history.data?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-base font-bold">Attempt history</h2>
          <div className="mt-3 overflow-x-auto rounded-xl border border-line">
            <table className="table min-w-[420px]">
              <thead><tr><th>Submitted</th><th>Score</th><th>Result</th><th>Status</th></tr></thead>
              <tbody>{history.data.map((row) => (
                <tr key={row.id}><td>{fmtDateTime(row.submittedAt)}</td><td>{row.score}/{row.total} ({pct(row.percent)})</td>
                  <td>{row.passed ? <span className="badge-success">Passed</span> : <span className="badge-danger">Not passed</span>}</td>
                  <td className="capitalize text-ink-muted">{row.status === 'expired' ? 'Time expired' : row.status}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function Runner({ assessment, final, onDone }) {
  const confirm = useConfirm()
  const [attempt, setAttempt] = useState(null)
  const [answers, setAnswers] = useState({})
  const [i, setI] = useState(0)
  const [left, setLeft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [saveState, setSaveState] = useState('saved')
  const [error, setError] = useState('')
  const [tries, setTries] = useState(0)
  const sent = useRef(false)
  const answersRef = useRef(answers)
  const submitRef = useRef(() => {})
  const version = useRef(0)
  const offset = useRef(0)          // server clock minus browser clock, in ms
  const saveChain = useRef(Promise.resolve())
  const pending = useRef(null)
  const qs = attempt?.questions?.length ? attempt.questions : assessment.questions || []
  const q = qs[i]
  answersRef.current = answers

  const syncClock = (data) => { if (data?.serverTime) offset.current = new Date(data.serverTime).getTime() - Date.now() }
  const remaining = (deadline) => Math.max(0, Math.ceil((new Date(deadline).getTime() - (Date.now() + offset.current)) / 1000))

  useEffect(() => {
    let alive = true
    setError('')
    startAttempt(assessment.id).then((data) => {
      if (!alive) return
      syncClock(data)
      setAttempt(data)
      setAnswers(data.answers || {})
      version.current = data.answerVersion || 0
      if (data.deadline) setLeft(remaining(data.deadline))
    }).catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false; clearTimeout(pending.current) }
  }, [assessment.id, tries]) // eslint-disable-line react-hooks/exhaustive-deps -- the server resumes by assessment

  useEffect(() => {
    if (!attempt?.deadline) return undefined
    const tick = () => {
      const seconds = remaining(attempt.deadline)
      setLeft(seconds)
      if (seconds === 0) submitRef.current(true)
    }
    tick()
    const timer = setInterval(tick, 500)
    return () => clearInterval(timer)
  }, [attempt?.deadline]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next, nextVersion) => {
    setSaveState('saving')
    return assessmentsApi.save(attempt.attemptId, next, nextVersion).then((data) => {
      syncClock(data)
      version.current = data.answerVersion
      setSaveState('saved')
      setError('')
    }).catch((err) => {
      setSaveState('error')
      // 409 with the server's copy means another tab saved first; adopt the server state.
      if (err.status === 409 && err.data?.answerVersion !== undefined) { version.current = err.data.answerVersion; setAnswers(err.data.answers || {}) }
      setError(err.message)
      throw err
    })
  }

  const choose = (value) => {
    if (!q || sent.current) return
    const next = { ...answersRef.current, [q.id]: value }
    setAnswers(next)
    setSaveState('saving')
    clearTimeout(pending.current)
    pending.current = setTimeout(() => {
      saveChain.current = saveChain.current.then(() => persist(answersRef.current, version.current)).catch(() => {})
    }, 400)
  }

  const answeredCount = Object.values(answers).filter((value) => value !== '' && value !== null && !(Array.isArray(value) && !value.length)).length
  const submit = async (automatic = false) => {
    if (sent.current || !attempt) return
    if (!automatic && answeredCount < qs.length) {
      const ok = await confirm({ title: 'Submit with unanswered questions?', message: `You have ${qs.length - answeredCount} unanswered question(s). Unanswered questions score zero.`, confirmLabel: 'Submit anyway' })
      if (!ok) return
    }
    sent.current = true; setBusy(true); setError('')
    try {
      clearTimeout(pending.current)
      await saveChain.current
      // Flush the latest edit unless time is already up (the server would reject it anyway).
      if (!automatic) await persist(answersRef.current, version.current).catch((err) => { if (err.status !== 409) throw err })
      onDone(await assessmentsApi.submit(attempt.attemptId))
    } catch (err) {
      sent.current = false; setBusy(false); setError(`${err.message || 'Submission failed.'} Your saved answers are safe on the server; try again.`)
    }
  }
  submitRef.current = submit

  if (error && !attempt) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 p-4 text-sm text-danger">
        <span>Could not start the attempt: {error}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setTries((n) => n + 1)}>Retry</button>
      </div>
    )
  }
  if (!attempt || !q) return <p className="p-4 text-sm text-ink-muted" role="status">Connecting to the server and restoring your attempt…</p>
  const multiple = q.questionType === 'multiple'
  const selected = answers[q.id]
  const choices = q.choices?.length ? q.choices : ['True', 'False']
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">{answeredCount}/{qs.length} answered</span>
        <span className={`text-xs ${saveState === 'error' ? 'text-danger' : saveState === 'saving' ? 'text-warning' : 'text-success'}`} aria-live="polite">{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'All answers saved'}</span>
        {left !== null && <span className={`ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-display text-sm font-bold tabular-nums ${left < 60 ? 'bg-danger-soft text-danger' : 'bg-brand-soft text-brand-dark'}`} role="timer" aria-label={`Time remaining ${fmtTime(left)}`}><ClockIcon className="h-4 w-4" />{fmtTime(left)}</span>}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all" style={{ width: `${((i + 1) / qs.length) * 100}%` }} /></div>
      <fieldset className="mt-6 rounded-2xl border border-line p-4 sm:p-6">
        <legend className="px-1 text-xs font-semibold text-ink-muted">Question {i + 1} of {qs.length} · {q.points} point{q.points > 1 ? 's' : ''}{multiple ? ' · select all that apply' : ''}</legend>
        <p className="text-lg font-semibold">{q.text}</p>
        <QuizImage id={q.imageId} alt={`Image for question ${i + 1}`} className="mt-4 max-h-80" />
        {q.questionType === 'short' ? (
          <label className="mt-5 block"><span className="label">Your answer</span><input aria-label={`Answer for question ${i + 1}`} className="input" value={selected || ''} onChange={(event) => choose(event.target.value)} /></label>
        ) : (
          <div role={multiple ? 'group' : 'radiogroup'} aria-label={`Choices for question ${i + 1}`} className="mt-5 grid gap-3 md:grid-cols-2">
            {choices.map((choice, k) => {
              const on = multiple ? Array.isArray(selected) && selected.includes(k) : q.questionType === 'true_false' ? selected === (k === 0) : selected === k
              const value = multiple ? (on ? selected.filter((item) => item !== k) : [...(Array.isArray(selected) ? selected : []), k]) : q.questionType === 'true_false' ? k === 0 : k
              return (
                <button key={k} type="button" role={multiple ? 'checkbox' : 'radio'} aria-checked={on} onClick={() => choose(value)}
                  className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm transition ${on ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:border-brand/40'}`}>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${on ? 'bg-brand text-white' : 'bg-ground'}`}>{q.questionType === 'true_false' ? (k === 0 ? 'T' : 'F') : LETTERS[k]}</span>
                  <span className="flex min-w-0 flex-col gap-2">
                    {q.choiceImages?.[k] && <QuizImage id={q.choiceImages[k]} alt={`Choice ${LETTERS[k]}`} className="max-h-40" />}
                    {choice && <span>{choice}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </fieldset>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Question navigator">
        {qs.map((item, n) => {
          const done = answers[item.id] !== undefined && answers[item.id] !== '' && !(Array.isArray(answers[item.id]) && !answers[item.id].length)
          return <button key={item.id} type="button" onClick={() => setI(n)} aria-label={`Go to question ${n + 1}${done ? ' (answered)' : ''}`} aria-current={n === i ? 'step' : undefined}
            className={`h-9 w-9 rounded-full text-xs font-bold ${n === i ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''} ${done ? 'bg-brand text-white' : 'bg-ground'}`}>{n + 1}</button>
        })}
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error} {saveState === 'error' && !busy && <button type="button" onClick={() => persist(answersRef.current, version.current).catch(() => {})} className="font-semibold underline">Retry save</button>}</p>}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="btn-ghost">← Previous</button>
        <div className="flex flex-wrap gap-3">
          {i < qs.length - 1 && <button type="button" onClick={() => setI(i + 1)} className="btn-ghost">Next →</button>}
          <button type="button" disabled={busy} onClick={() => submit(false)} className="btn-primary px-6">{busy ? 'Submitting…' : final ? 'Submit exam' : 'Submit quiz'}</button>
        </div>
      </div>
    </div>
  )
}

function Result({ assessment, result, onRetake, final, back }) {
  const pass = Boolean(result?.passed)
  return (
    <div>
      <div className="mx-auto max-w-md rounded-2xl bg-ground p-8 text-center">
        <p className="text-sm font-semibold text-ink-muted">{result.status === 'expired' ? 'Time expired — submitted automatically' : 'Attempt submitted'}</p>
        <p className={`mt-3 font-display text-5xl font-extrabold ${pass ? 'text-success' : 'text-warning'}`}>{pct(result.percent)}</p>
        {result.correctCount !== undefined && <p className="mt-1 text-sm font-semibold" data-testid="correct-count">{result.correctCount} of {result.questionCount} question{result.questionCount === 1 ? '' : 's'} correct</p>}
        <p className="mt-1 text-sm">{result.score} / {result.total} points · pass mark {result.passPercent ?? assessment.passPercent}%</p>
        {weighted(result.review) && <p className="mt-1 text-xs text-ink-muted">Questions carry different points, so the percentage is points earned ÷ points available.</p>}
        <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-bold ${pass ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}>
          {pass ? (final ? 'Passed — course completed!' : 'Passed — module complete') : 'Not passed this time'}
        </p>
        <p className="mt-3 text-xs text-ink-muted">Best {pct(assessment.bestPercent)} · {assessment.attempts} attempt{assessment.attempts === 1 ? '' : 's'}{!pass && assessment.passed ? ' · your earlier pass still counts' : ''}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to={back.to} className={pass ? 'btn-primary' : 'btn-ghost'}>{pass && !final ? 'Continue the course' : 'Back to course'}</Link>
          <button type="button" onClick={onRetake} className={pass ? 'btn-ghost' : 'btn-primary'}>Retake</button>
        </div>
      </div>
      {result.review?.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-bold">Review your answers</h2>
          <ol className="mt-3 space-y-3">{result.review.map((item, n) => <ReviewItem key={item.id} item={item} number={n + 1} />)}</ol>
        </>
      )}
    </div>
  )
}

const weighted = (questions) => new Set((questions || []).map((q) => Number(q.points))).size > 1

function ReviewItem({ item, number }) {
  const choices = item.choices || []
  const correct = item.questionType === 'true_false' ? [item.correctAnswers?.[0] ? 0 : 1] : Array.isArray(item.correctAnswers) && item.correctAnswers.length ? item.correctAnswers : [item.correct]
  const chosenRaw = Array.isArray(item.chosen) ? item.chosen : item.chosen === undefined || item.chosen === null ? [] : [item.chosen]
  const chosen = item.questionType === 'true_false' ? chosenRaw.map((value) => (value === true || String(value).toLowerCase() === 'true' ? 0 : 1)) : chosenRaw
  const skipped = item.chosen === undefined || item.chosen === null || item.chosen === '' || (Array.isArray(item.chosen) && !item.chosen.length)
  return (
    <li className={`rounded-2xl border-l-4 bg-ground p-4 ${item.isCorrect ? 'border-success' : 'border-danger'}`}>
      <p className="text-sm font-semibold">{number}. {item.text} <span className={`ml-2 text-xs ${item.isCorrect ? 'text-success' : 'text-danger'}`}>{item.isCorrect ? `+${item.earned ?? item.points}` : skipped ? 'Skipped' : 'Incorrect'}</span></p>
      <QuizImage id={item.imageId} alt={`Image for question ${number}`} className="mt-2 max-h-56" />
      {item.questionType === 'short' ? (
        <p className="mt-2 text-sm">Your answer: {skipped ? '—' : item.chosen}{item.expectedAnswer && <span className="font-semibold text-success"> · Expected: {item.expectedAnswer}</span>}</p>
      ) : (
        <ul className="mt-2 grid gap-2 md:grid-cols-2">{choices.map((choice, k) => (
          <li key={k} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${correct.includes(k) ? 'bg-success-soft' : chosen.includes(k) ? 'bg-danger-soft' : 'bg-surface'}`}>
            <span className="font-bold">{item.questionType === 'true_false' ? '' : `${LETTERS[k]}.`}</span>
            <span className="flex flex-1 flex-wrap items-center gap-2">{item.choiceImages?.[k] && <QuizImage id={item.choiceImages[k]} alt={`Choice ${LETTERS[k]}`} className="max-h-20" />}{choice}</span>
            {correct.includes(k) && <span className="text-xs font-bold text-success">Correct</span>}
            {chosen.includes(k) && !correct.includes(k) && <span className="text-xs font-bold text-danger">Your answer</span>}
          </li>
        ))}</ul>
      )}
      {(item.explanation || item.explanationImageId) && (
        <div className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Explanation</p>
          {item.explanation && <p className="mt-1 whitespace-pre-wrap">{item.explanation}</p>}
          <QuizImage id={item.explanationImageId} alt={`Explanation for question ${number}`} className="mt-2 max-h-60" />
        </div>)}
    </li>
  )
}
