import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { progressApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { CourseEmblem, PageHeader, ProgressBar, pct } from '../../components/ui/Primitives'
import { ChartIcon, CheckIcon, LockIcon } from '../../components/ui/Icons'
import { FinalExamCard } from './CourseDetail'

export function ModuleTable({ modules, courseId, linkQuizzes = true }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="table min-w-[640px]">
        <thead><tr><th>Module</th><th>Status</th><th>Quiz attempts</th><th>Latest</th><th>Best</th><th className="sr-only">Actions</th></tr></thead>
        <tbody>
          {modules.map((module) => (
            <tr key={module.id}>
              <td><span className="font-semibold">{module.order}. {module.title}</span>{!module.required && <span className="badge ml-2">Optional</span>}</td>
              <td>{module.completed ? <span className="badge-success"><CheckIcon className="h-3 w-3" />Completed</span>
                : module.locked ? <span className="badge"><LockIcon className="h-3 w-3" />Locked</span>
                  : <span className="badge-brand">In progress</span>}</td>
              <td>{module.quiz ? module.quiz.attempts : <span className="text-ink-muted">No quiz</span>}</td>
              <td>{module.quiz ? pct(module.quiz.latestPercent) : '—'}</td>
              <td>{module.quiz ? pct(module.quiz.bestPercent) : '—'}</td>
              <td className="text-right">{linkQuizzes && courseId && module.unlocked && (
                <Link className="link text-sm" to={module.quiz ? `/student/quizzes/${module.quiz.id}` : `/student/courses/${courseId}/modules/${module.id}`}>{module.quiz ? 'Quiz' : 'Open'}</Link>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Per-course module completion, latest/best quiz results and final exam status from stored records.
export default function Progress() {
  const state = useApi(() => progressApi.mine(), [])
  return (
    <>
      <PageHeader title="Learning progress" subtitle="Your module completion, quiz results and final examinations across every enrolled course." />
      <Async state={state} label="Loading your progress…">{({ courses }) => (
        courses.length ? (
          <div className="space-y-6">
            {courses.map((course) => (
              <section key={course.courseId} className="card card-pad space-y-5" aria-label={course.course}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <CourseEmblem course={{ title: course.course, category: course.category }} />
                  <div className="min-w-0 flex-1">
                    <Link to={`/student/courses/${course.courseId}`} className="text-lg font-bold hover:text-brand">{course.course}</Link>
                    <p className="text-sm text-ink-muted">{course.completedModules} of {course.totalModules} modules complete{course.nextModule ? ` · next: ${course.nextModule.title}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 sm:w-72">
                    <ProgressBar percent={course.percent} tone={course.status === 'completed' ? 'success' : 'brand'} label={`${course.course} ${course.percent}% complete`} />
                    <span className="w-10 text-right font-semibold">{course.percent}%</span>
                  </div>
                  {course.status === 'completed' && <span className="badge-success">Course completed</span>}
                </div>
                {course.modules.length ? <ModuleTable modules={course.modules} courseId={course.courseId} /> : <p className="text-sm text-ink-muted">This course has no modules yet.</p>}
                <FinalExamCard final={course.finalExam} />
              </section>
            ))}
          </div>
        ) : <div className="card"><EmptyState title="No progress yet" icon={ChartIcon} action={<Link to="/student/courses" className="btn-primary">Browse courses</Link>}>Enroll in a course and take its module quizzes to see your progress here.</EmptyState></div>
      )}</Async>
    </>
  )
}
