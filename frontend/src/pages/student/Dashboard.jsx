import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { dashboardApi } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { Async, EmptyState } from '../../components/ui/States'
import { CardHeading, CourseEmblem, PageHeader, ProgressBar, StatCard, fmtDateTime, pct } from '../../components/ui/Primitives'
import { ArrowRightIcon, BookIcon, CheckCircleIcon, ClipboardIcon, MegaphoneIcon, TrophyIcon } from '../../components/ui/Icons'

function finalBadge(final) {
  if (!final) return null
  if (final.passed) return <span className="badge-success">Final passed</span>
  if (final.inProgress) return <span className="badge-warning">Final in progress</span>
  if (final.eligible) return <span className="badge-brand">Final exam ready</span>
  return <span className="badge">Final locked</span>
}

const activityIcon = { quiz: ClipboardIcon, final: TrophyIcon, module: CheckCircleIcon }

// Everything shown here comes from the student's stored enrollments, attempts and module progress.
export default function StudentDashboard() {
  const { user } = useAuth()
  const state = useApi(() => dashboardApi.student(), [])
  const first = (user?.name || '').split(' ')[0]
  return (
    <>
      <PageHeader title="Dashboard" subtitle={first ? `Welcome back, ${first}. Here is where your learning stands.` : 'Here is where your learning stands.'} />
      <Async state={state} label="Loading your dashboard…">{(d) => (
        <div className="space-y-6">
          {d.announcement && (
            <div className="flex items-start gap-3 rounded-2xl border border-brand/20 bg-brand-soft px-4 py-3 text-sm text-brand-dark" role="status">
              <MegaphoneIcon className="mt-0.5 h-5 w-5 shrink-0" /><p><span className="font-semibold">Announcement: </span>{d.announcement}</p>
            </div>
          )}
          <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Learning summary">
            <StatCard label="Courses enrolled" value={d.stats.enrolled} hint={`${d.stats.inProgress} in progress`} />
            <StatCard label="Courses completed" value={d.stats.completed} tone="success" hint="Completed by passing the final exam" />
            <StatCard label="Average quiz score" value={pct(d.stats.averageQuizPercent)} tone="warning" hint="Best result per attempted quiz" />
            <StatCard label="Quizzes passed" value={d.stats.quizzesPassed} tone="purple" hint={`${d.stats.quizAttempts} attempt${d.stats.quizAttempts === 1 ? '' : 's'} in total`} />
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              {d.next ? (
                <article className="overflow-hidden rounded-card bg-learning p-6 text-white shadow-card">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-white/70">Continue learning</p>
                  <h2 className="mt-2 text-2xl font-extrabold">{d.next.moduleTitle}</h2>
                  <p className="mt-1 text-sm text-white/80">{d.next.courseTitle} · {d.next.percent}% complete</p>
                  <ProgressBar percent={d.next.percent} className="mt-4 bg-white/25 [&>div]:bg-white" label={`${d.next.courseTitle} progress`} />
                  <Link to={`/student/courses/${d.next.courseId}/modules/${d.next.moduleId}`} className="btn mt-5 bg-white text-brand-dark hover:bg-brand-soft">
                    Continue module <ArrowRightIcon className="h-4 w-4" />
                  </Link>
                </article>
              ) : (
                <article className="card card-pad">
                  <p className="eyebrow">{d.courses.length ? 'All caught up' : 'Get started'}</p>
                  <h2 className="mt-1 text-xl font-bold">{d.courses.length ? 'No open modules right now' : 'Find your first course'}</h2>
                  <p className="mt-1 text-sm text-ink-muted">{d.courses.length ? 'Check your final exams, or browse the library for something new.' : 'Browse the course library and enroll to start learning.'}</p>
                  <Link to="/student/courses" className="btn-primary mt-4">Browse courses <ArrowRightIcon className="h-4 w-4" /></Link>
                </article>
              )}

              <section className="card card-pad">
                <CardHeading title="Your courses" action={<Link to="/student/progress" className="link text-sm">View progress</Link>} />
                {d.courses.length ? (
                  <ul className="mt-4 divide-y divide-line">
                    {d.courses.map((course) => (
                      <li key={course.courseId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CourseEmblem course={{ title: course.course, category: course.category }} />
                          <div className="min-w-0">
                            <Link to={`/student/courses/${course.courseId}`} className="block truncate font-semibold hover:text-brand">{course.course}</Link>
                            <p className="text-xs text-ink-muted">{course.completedModules} of {course.totalModules} modules · {course.nextModule ? `Next: ${course.nextModule.title}` : 'All modules done'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 sm:w-64">
                          <ProgressBar percent={course.percent} label={`${course.course} ${course.percent}% complete`} />
                          <span className="w-10 text-right text-sm font-semibold">{course.percent}%</span>
                        </div>
                        <div className="sm:w-32 sm:text-right">{course.status === 'completed' ? <span className="badge-success">Completed</span> : finalBadge(course.finalExam)}</div>
                      </li>
                    ))}
                  </ul>
                ) : <EmptyState title="You are not enrolled in any courses yet." icon={BookIcon} action={<Link className="btn-secondary" to="/student/courses">Browse courses</Link>}>Enroll in a course to see your progress here.</EmptyState>}
              </section>
            </div>

            <section className="card card-pad h-fit">
              <CardHeading title="Recent activity" />
              {d.recentActivity.length ? (
                <ol className="mt-4 space-y-4">
                  {d.recentActivity.map((item) => {
                    const Icon = activityIcon[item.type] || ClipboardIcon
                    return (
                      <li key={item.id} className="flex gap-3">
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.passed ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'}`}><Icon className="h-4 w-4" /></span>
                        <div className="min-w-0 text-sm">
                          <p className="font-semibold">{item.title}</p>
                          <p className="text-xs text-ink-muted">{item.courseTitle}{item.percent !== null && item.percent !== undefined ? ` · ${pct(item.percent)} · ${item.passed ? 'passed' : 'not passed'}` : ' · marked complete'}</p>
                          <p className="text-xs text-ink-muted">{fmtDateTime(item.at)}</p>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : <p className="mt-4 text-sm text-ink-muted">Your quiz results and completed modules will appear here.</p>}
            </section>
          </div>
        </div>
      )}</Async>
    </>
  )
}
