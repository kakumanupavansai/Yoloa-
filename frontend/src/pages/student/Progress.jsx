import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { progressApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { CourseEmblem, PageHeader, ProgressBar, StatCard, fmtDate, pct } from '../../components/ui/Primitives'
import { DonutChart, HBarList, LineChart } from '../../components/ui/Charts'
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

const localDay = (value) => { const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

// Cumulative completed modules per day, from the stored completion times.
export function completionSteps(times) {
  const days = []
  times.forEach((time) => {
    const day = localDay(time)
    if (days.length && days[days.length - 1].date === day) days[days.length - 1].value += 1
    else days.push({ date: day, value: (days.length ? days[days.length - 1].value : 0) + 1 })
  })
  return days
}

function Summary({ summary, timeline, completions, courses }) {
  const quizzes = timeline.filter((item) => item.type !== 'final_exam')
  const steps = completionSteps(completions)
  const latest = summary.latest
  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Summary">
        <StatCard label="Overall completion" value={`${summary.overallPercent}%`} hint={`${summary.completedModules} of ${summary.totalModules} modules`} testId="overall-percent" />
        <StatCard label="Modules" value={`${summary.completedModules} done`} tone="success" hint={`${summary.pendingModules} pending`} />
        <StatCard label="Latest score" value={latest ? pct(latest.percent) : '—'} tone="warning" hint={latest ? `${latest.title} · ${fmtDate(latest.at)}` : 'No attempts yet'} />
        <StatCard label="Best score" value={pct(summary.bestPercent)} tone="purple" hint={summary.averageBestPercent !== null ? `average best ${summary.averageBestPercent}% across quizzes` : 'Take a quiz to see it'} />
      </section>
      <div className="grid gap-6 xl:grid-cols-3">
        <section className="card card-pad xl:col-span-2" aria-label="Quiz scores over time">
          <h2 className="text-base font-bold">Quiz scores over time</h2>
          <p className="mb-4 text-xs text-ink-muted">Every submitted quiz and final-exam attempt, oldest first.</p>
          {timeline.length
            ? <LineChart title="Quiz scores over time" labels={timeline.map((item) => localDay(item.at))} yMax={100} formatValue={(v) => `${v}%`}
                pointLabel={(index) => `${timeline[index].title} · ${fmtDate(timeline[index].at)}`}
                series={[{ key: 'score', label: 'Score', values: timeline.map((item) => Math.round(item.percent)) }]} />
            : <p className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-muted">Your quiz results will appear here.</p>}
        </section>
        <section className="card card-pad" aria-label="Modules completed and pending">
          <h2 className="mb-4 text-base font-bold">Modules</h2>
          <DonutChart title="Completed and pending modules" centerLabel="modules" data={[
            { key: 'done', label: 'Completed', value: summary.completedModules, color: 'rgb(var(--chart-2))' },
            { key: 'pending', label: 'Pending', value: summary.pendingModules, color: 'rgb(var(--chart-grid))' }]} />
        </section>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card card-pad" aria-label="Learning progress over time">
          <h2 className="text-base font-bold">Learning progress over time</h2>
          <p className="mb-4 text-xs text-ink-muted">Modules completed, counted up day by day.</p>
          {steps.length
            ? <LineChart title="Modules completed over time" labels={steps.map((item) => item.date)} series={[{ key: 'modules', label: 'Modules completed', values: steps.map((item) => item.value) }]} />
            : <p className="flex h-40 items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-muted">Complete a module to start your progress line.</p>}
        </section>
        <section className="card card-pad" aria-label="Completion by course">
          <h2 className="mb-4 text-base font-bold">Completion by course</h2>
          <HBarList title="Completion by course" max={100} formatValue={(v) => `${v}%`}
            rows={courses.map((course, index) => ({ key: course.courseId, label: course.course, value: course.percent, tone: index, suffix: `${course.completedModules}/${course.totalModules}` }))} />
          {quizzes.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-bold">Best score per quiz</h3>
              <HBarList title="Best score per quiz" max={100} formatValue={(v) => `${v}%`} tone={3}
                rows={courses.flatMap((course) => course.modules.filter((module) => module.quiz?.attempts).map((module) => ({
                  key: module.quiz.id, label: module.quiz.title, value: Math.round(module.quiz.bestPercent || 0), suffix: `latest ${pct(module.quiz.latestPercent)}` })))} />
            </>)}
        </section>
      </div>
    </div>
  )
}

// The signed-in student's own progress only: the API takes no student id.
export default function Progress() {
  const state = useApi(() => progressApi.mine(), [])
  return (
    <>
      <PageHeader title="Learning progress" subtitle="Your course completion, module progress and quiz results, from your own records." />
      <Async state={state} label="Loading your progress…">{({ courses, summary, timeline = [], moduleCompletions = [] }) => (
        courses.length ? (
          <div className="space-y-6">
            {summary && <Summary summary={summary} timeline={timeline} completions={moduleCompletions} courses={courses} />}
            <h2 className="pt-2 text-lg font-bold">Course details</h2>
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
