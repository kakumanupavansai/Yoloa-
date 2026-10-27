import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { PageHeader } from '../../components/ui/Primitives'
import { LayersIcon } from '../../components/ui/Icons'
import { CourseCard } from './Courses'

export default function MyCourses() {
  const state = useApi(() => coursesApi.list(), [])
  return (
    <>
      <PageHeader title="My courses" subtitle="The courses you are enrolled in, with your current progress." />
      <Async state={state} label="Loading your courses…">{(rows) => {
        const mine = rows.filter((course) => course.enrolled)
        const ongoing = mine.filter((course) => course.status !== 'completed')
        const done = mine.filter((course) => course.status === 'completed')
        if (!mine.length) return <div className="card"><EmptyState title="You are not enrolled in any courses yet." icon={LayersIcon} action={<Link className="btn-primary" to="/student/courses">Browse the library</Link>}>Enroll in a course to start learning.</EmptyState></div>
        return (
          <div className="space-y-8">
            {[['In progress', ongoing], ['Completed', done]].map(([title, list]) => list.length > 0 && (
              <section key={title} aria-label={title}>
                <h2 className="mb-3 text-lg font-bold">{title} <span className="text-sm font-medium text-ink-muted">({list.length})</span></h2>
                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{list.map((course) => <CourseCard key={course.id} course={course} />)}</div>
              </section>
            ))}
          </div>
        )
      }}</Async>
    </>
  )
}
