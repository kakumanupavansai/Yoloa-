import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { useConfirm, useToast } from '../../components/ui/Feedback'
import { ProgressBar, fmtDateTime, pct } from '../../components/ui/Primitives'
import { ArrowLeftIcon, CheckIcon, ClockIcon, LockIcon, TrophyIcon } from '../../components/ui/Icons'
import ResourceList from './ResourceList'

function ModuleStatus({ chapter, enrolled }) {
  if (!enrolled) return <span className="badge">{chapter.required ? 'Required' : 'Optional'}</span>
  if (chapter.completed) return <span className="badge-success"><CheckIcon className="h-3 w-3" />Completed</span>
  if (!chapter.unlocked) return <span className="badge"><LockIcon className="h-3 w-3" />Locked</span>
  return <span className="badge-brand">{chapter.quiz?.attempts ? 'Quiz not passed yet' : 'Available'}</span>
}

function ModuleCard({ courseId, chapter, index, enrolled }) {
  const quiz = chapter.quiz
  const open = enrolled && chapter.unlocked
  return (
    <article className={`card p-5 ${chapter.completed ? 'border-success/30' : ''}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-display font-extrabold ${chapter.completed ? 'bg-success text-white' : open ? 'bg-brand-soft text-brand-dark' : 'bg-ground text-ink-muted'}`} aria-hidden="true">
          {chapter.completed ? <CheckIcon className="h-5 w-5" /> : !open && enrolled ? <LockIcon className="h-4 w-4" /> : index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{chapter.title}</h3>
            <ModuleStatus chapter={chapter} enrolled={enrolled} />
            {!chapter.required && enrolled && <span className="badge">Optional</span>}
          </div>
          {chapter.description && <p className="mt-1 text-sm text-ink-muted">{chapter.description}</p>}
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {chapter.duration && <span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" />{chapter.duration}</span>}
            <span>{chapter.resourceCount} resource{chapter.resourceCount === 1 ? '' : 's'}</span>
            {quiz && <span>Quiz · pass mark {quiz.passPercent}%</span>}
            {quiz?.attempts > 0 && <span>Latest {pct(quiz.latestPercent)} · Best {pct(quiz.bestPercent)} · {quiz.attempts} attempt{quiz.attempts === 1 ? '' : 's'}</span>}
          </p>
          {enrolled && !open && <p className="mt-2 text-xs font-medium text-ink-muted">Pass the previous required module to unlock this one.</p>}
        </div>
        {enrolled && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {open
              ? <Link to={`/student/courses/${courseId}/modules/${chapter.id}`} className="btn-ghost btn-sm" aria-label={`Open module ${chapter.title}`}>Open module</Link>
              : <button type="button" disabled className="btn-ghost btn-sm" aria-label={`${chapter.title} is locked`}><LockIcon className="h-3.5 w-3.5" />Locked</button>}
            {quiz && open && <Link to={`/student/quizzes/${quiz.id}`} className="btn-primary btn-sm">{quiz.attempts ? 'Retake quiz' : 'Take quiz'}</Link>}
          </div>
        )}
      </div>
    </article>
  )
}

export function FinalExamCard({ final }) {
  if (!final) return null
  const status = final.passed ? 'Passed' : final.inProgress ? 'In progress' : final.eligible ? 'Ready' : 'Locked'
  return (
    <article className={`card p-5 sm:p-6 ${final.eligible ? 'border-brand/30 bg-brand-50' : ''}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${final.passed ? 'bg-success text-white' : 'bg-brand-soft text-brand-dark'}`}><TrophyIcon className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Final examination</p>
          <h3 className="mt-0.5 text-lg font-bold">{final.title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{Math.round(final.durationSeconds / 60)} minutes · pass mark {final.passPercent}% · {final.questionCount} questions · unlimited attempts</p>
          {final.attempts > 0 && <p className="mt-1 text-sm">Latest <strong>{pct(final.latestPercent)}</strong> · Best <strong>{pct(final.bestPercent)}</strong> · {final.attempts} attempt{final.attempts === 1 ? '' : 's'}{final.lastAttemptAt ? ` · last ${fmtDateTime(final.lastAttemptAt)}` : ''}</p>}
          {!final.eligible && final.reasons?.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">{final.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          <span className={final.passed ? 'badge-success' : final.eligible ? 'badge-brand' : 'badge'}>{status}</span>
          {final.eligible
            ? <Link to={`/student/exams/${final.id}`} className="btn-primary">{final.inProgress ? 'Resume exam' : final.attempts ? 'Retake exam' : 'Start final exam'}</Link>
            : <button type="button" disabled className="btn-ghost"><LockIcon className="h-4 w-4" />Locked</button>}
        </div>
      </div>
    </article>
  )
}

// Course outline: ordered modules with locked/unlocked state, quizzes and the final examination.
export default function CourseDetail() {
  const { id } = useParams()
  const state = useApi(() => coursesApi.get(id), [id])
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)

  const enroll = async () => {
    setBusy(true)
    try { await coursesApi.enroll(id); toast('You are enrolled. The first module is unlocked.'); await state.reload() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }
  const leave = async (course) => {
    const ok = await confirm({ title: 'Leave this course?', message: `You will leave "${course.title}". Your quiz attempts and progress are kept if you enroll again later.`, confirmLabel: 'Leave course', tone: 'danger' })
    if (!ok) return
    setBusy(true)
    try { await coursesApi.unenroll(id); toast('You left the course.'); await state.reload() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }

  return (
    <Async state={state} label="Loading course…">{(course) => (
      <div className="space-y-6">
        <section className="overflow-hidden rounded-card bg-learning p-6 text-white shadow-card sm:p-8">
          <Link to={course.enrolled ? '/student/my-courses' : '/student/courses'} className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white"><ArrowLeftIcon className="h-4 w-4" />{course.enrolled ? 'My courses' : 'Course library'}</Link>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{course.category}</span>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold">{course.level}</span>
            {course.status === 'completed' && <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-success">Completed</span>}
          </div>
          <h1 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">{course.title}</h1>
          {course.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-white/85 sm:text-[15px]">{course.description}</p>}
          {course.professor && <p className="mt-3 text-sm text-white/75">Instructor: {course.professor.name}</p>}
          {course.enrolled ? (
            <div className="mt-6 max-w-xl">
              <div className="mb-1.5 flex justify-between text-sm font-semibold"><span>{course.completedModules} of {course.chapters.length} modules complete</span><span>{course.percent}%</span></div>
              <ProgressBar percent={course.percent} className="bg-white/25 [&>div]:bg-white" label="Course progress" />
              <div className="mt-5 flex flex-wrap gap-2">
                {course.nextModule && <Link to={`/student/courses/${course.id}/modules/${course.nextModule.id}`} className="btn bg-white text-brand-dark hover:bg-brand-soft">Continue: {course.nextModule.title}</Link>}
                <button type="button" onClick={() => leave(course)} disabled={busy} className="btn border border-white/40 text-white hover:bg-white/10">Leave course</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={enroll} disabled={busy} className="btn mt-6 bg-white text-brand-dark hover:bg-brand-soft">{busy ? 'Enrolling…' : 'Enroll in this course'}</button>
          )}
        </section>

        <section aria-labelledby="modules-heading" className="space-y-3">
          <div className="flex items-baseline justify-between"><h2 id="modules-heading" className="text-lg font-bold">Modules</h2><span className="text-sm text-ink-muted">{course.chapters.length} in total</span></div>
          {!course.enrolled && <p className="text-sm text-ink-muted">Enroll to open the modules. Modules unlock one at a time as you pass each module quiz.</p>}
          {course.chapters.map((chapter, index) => <ModuleCard key={chapter.id} courseId={course.id} chapter={chapter} index={index} enrolled={course.enrolled} />)}
          {!course.chapters.length && <p className="card p-5 text-sm text-ink-muted">No modules have been added to this course yet.</p>}
        </section>

        {course.enrolled && <FinalExamCard final={course.assessment?.finalExam} />}

        {course.enrolled && course.content.length > 0 && (
          <section className="card card-pad"><h2 className="text-lg font-bold">Course materials</h2><div className="mt-4"><ResourceList resources={course.content} /></div></section>
        )}
      </div>
    )}</Async>
  )
}
