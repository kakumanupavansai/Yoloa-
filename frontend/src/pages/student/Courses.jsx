import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { useToast } from '../../components/ui/Feedback'
import { CourseEmblem, PageHeader, ProgressBar } from '../../components/ui/Primitives'
import { ArrowRightIcon, BookIcon, SearchIcon } from '../../components/ui/Icons'

export function CourseCard({ course, onEnroll, busy }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <CourseEmblem course={course} />
        <span className="badge">{course.level}</span>
      </div>
      <h2 className="mt-4 text-lg font-bold leading-snug"><Link to={`/student/courses/${course.id}`} className="hover:text-brand">{course.title}</Link></h2>
      <p className="mt-1 line-clamp-3 text-sm text-ink-muted">{course.description || 'No description yet.'}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-ink-muted">
        <span className="badge">{course.modules} module{course.modules === 1 ? '' : 's'}</span>
        <span className="badge">{course.category}</span>
        {course.status === 'completed' && <span className="badge-success">Completed</span>}
      </div>
      {course.enrolled && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-xs font-semibold"><span>Progress</span><span>{course.percent}%</span></div>
          <ProgressBar percent={course.percent} label={`${course.title} progress`} tone={course.status === 'completed' ? 'success' : 'brand'} />
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
        <span className="truncate text-xs text-ink-muted">{course.professor ? `Instructor: ${course.professor}` : ''}</span>
        {course.enrolled
          ? <Link to={`/student/courses/${course.id}`} className="btn-secondary btn-sm">{course.status === 'completed' ? 'Review' : 'Continue'} <ArrowRightIcon className="h-3.5 w-3.5" /></Link>
          : <div className="flex gap-2">
              <Link to={`/student/courses/${course.id}`} className="btn-ghost btn-sm" aria-label={`View details of ${course.title}`}>Details</Link>
              {onEnroll && <button type="button" disabled={busy} onClick={() => onEnroll(course)} className="btn-primary btn-sm" aria-label={`Enroll in ${course.title}`}>{busy ? 'Enrolling…' : 'Enroll'}</button>}
            </div>}
      </div>
    </article>
  )
}

const STATUS_FILTERS = [['all', 'All courses'], ['available', 'Not enrolled'], ['ongoing', 'In progress'], ['completed', 'Completed']]

// Course library: every published course, with search, category and enrollment filters.
export default function Courses() {
  const state = useApi(() => coursesApi.list(), [])
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [status, setStatus] = useState('all')
  const [busy, setBusy] = useState(null)

  const enroll = async (course) => {
    setBusy(course.id)
    try { await coursesApi.enroll(course.id); toast(`Enrolled in ${course.title}.`); await state.reload() }
    catch (error) { toast(error.message, 'error') } finally { setBusy(null) }
  }

  const categories = useMemo(() => ['All', ...new Set((state.data || []).map((course) => course.category).filter(Boolean))], [state.data])
  return (
    <>
      <PageHeader title="Course library" subtitle="Choose a structured path and learn at your own pace. Each module unlocks after you pass the previous module's quiz." />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search courses</span>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search courses" className="input pl-10" />
        </label>
        <label className="sm:w-48"><span className="sr-only">Filter by category</span>
          <select className="input" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        </label>
        <label className="sm:w-48"><span className="sr-only">Filter by enrollment</span>
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
      </div>
      <Async state={state} label="Loading courses…">{(rows) => {
        const text = search.trim().toLowerCase()
        const visible = rows.filter((course) => (category === 'All' || course.category === category)
          && (status === 'all' || course.status === status)
          && `${course.title} ${course.description} ${course.category}`.toLowerCase().includes(text))
        if (!rows.length) return <div className="card"><EmptyState title="No courses are available yet." icon={BookIcon}>New courses will appear here once an administrator publishes them.</EmptyState></div>
        if (!visible.length) return <div className="card"><EmptyState title="No matching courses" action={<button className="btn-secondary" onClick={() => { setSearch(''); setCategory('All'); setStatus('all') }}>Clear filters</button>}>Try a different search or filter.</EmptyState></div>
        return <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Courses">{visible.map((course) => <CourseCard key={course.id} course={course} onEnroll={enroll} busy={busy === course.id} />)}</section>
      }}</Async>
    </>
  )
}
