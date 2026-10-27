import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { modulesApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { useToast } from '../../components/ui/Feedback'
import { PageHeader, pct } from '../../components/ui/Primitives'
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, ClipboardIcon, LockIcon } from '../../components/ui/Icons'
import ResourceList from './ResourceList'

// One module's learning page. The server refuses locked modules with 403, which is shown as an error.
export default function ModuleView() {
  const { courseId, moduleId } = useParams()
  const state = useApi(() => modulesApi.get(moduleId), [moduleId])
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const toggle = async (completed) => {
    setBusy(true)
    try { await modulesApi.setComplete(moduleId, completed); toast(completed ? 'Module marked complete.' : 'Module marked as not complete.'); await state.reload() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(false) }
  }

  if (state.error?.status === 403) {
    return (
      <div className="card mx-auto mt-6 max-w-xl p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-ground text-ink-muted"><LockIcon /></span>
        <h1 className="mt-4 text-xl font-bold">This module is not available yet</h1>
        <p className="mt-1 text-sm text-ink-muted">{state.error.message}</p>
        <Link to={`/student/courses/${courseId}`} className="btn-primary mt-5">Back to the course</Link>
      </div>
    )
  }

  return (
    <Async state={state} label="Loading module…">{(module) => {
      const quiz = module.quiz
      return (
        <>
          <PageHeader back={{ to: `/student/courses/${module.courseId}`, label: module.courseTitle }} eyebrow={`Module ${module.order} of ${module.totalModules}`}
            title={module.title} subtitle={module.description}
            actions={module.completed ? <span className="badge-success px-3 py-1 text-sm"><CheckCircleIcon className="h-4 w-4" />Completed</span> : null} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <section className="card card-pad" aria-labelledby="resources-heading">
              <h2 id="resources-heading" className="text-lg font-bold">Learning resources</h2>
              <div className="mt-4"><ResourceList resources={module.resources} /></div>
            </section>
            <aside className="space-y-4">
              <section className="card card-pad">
                {quiz ? (
                  <>
                    <div className="flex items-center gap-2"><ClipboardIcon className="h-5 w-5 text-brand" /><h2 className="text-base font-bold">Module quiz</h2></div>
                    <p className="mt-2 text-sm text-ink-muted">{quiz.questionCount} questions · pass mark {quiz.passPercent}%. Passing it completes this module{module.next ? ' and unlocks the next one' : ''}.</p>
                    {quiz.attempts > 0 && (
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="rounded-xl bg-ground p-2"><dt className="text-ink-muted">Latest</dt><dd className="text-base font-bold">{pct(quiz.latestPercent)}</dd></div>
                        <div className="rounded-xl bg-ground p-2"><dt className="text-ink-muted">Best</dt><dd className="text-base font-bold">{pct(quiz.bestPercent)}</dd></div>
                        <div className="rounded-xl bg-ground p-2"><dt className="text-ink-muted">Attempts</dt><dd className="text-base font-bold">{quiz.attempts}</dd></div>
                      </dl>
                    )}
                    <Link to={`/student/quizzes/${quiz.id}`} className="btn-primary mt-4 w-full">{quiz.passed ? 'Retake quiz' : quiz.attempts ? 'Try the quiz again' : 'Take the quiz'}</Link>
                  </>
                ) : (
                  <>
                    <h2 className="text-base font-bold">Module completion</h2>
                    <p className="mt-2 text-sm text-ink-muted">This module has no quiz. Mark it complete once you have studied the resources.</p>
                    <button type="button" disabled={busy} onClick={() => toggle(!module.completed)} className={`${module.completed ? 'btn-ghost' : 'btn-primary'} mt-4 w-full`}>
                      {module.completed ? 'Mark as not complete' : 'Mark as complete'}
                    </button>
                  </>
                )}
              </section>
              <nav className="card card-pad space-y-2" aria-label="Module navigation">
                {module.previous && <Link to={`/student/courses/${module.courseId}/modules/${module.previous.id}`} className="flex items-center gap-2 text-sm font-semibold text-brand hover:underline"><ArrowLeftIcon className="h-4 w-4" />{module.previous.title}</Link>}
                {module.next && (module.next.locked
                  ? <p className="flex items-center gap-2 text-sm text-ink-muted"><LockIcon className="h-4 w-4" />Next: {module.next.title} (locked)</p>
                  : <Link to={`/student/courses/${module.courseId}/modules/${module.next.id}`} className="flex items-center gap-2 text-sm font-semibold text-brand hover:underline">Next: {module.next.title}<ArrowRightIcon className="h-4 w-4" /></Link>)}
                <Link to={`/student/courses/${module.courseId}`} className="block text-sm text-ink-muted hover:text-ink">Course overview</Link>
              </nav>
            </aside>
          </div>
        </>
      )
    }}</Async>
  )
}
