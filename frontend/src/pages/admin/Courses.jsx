import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { Modal, useConfirm, useToast } from '../../components/ui/Feedback'
import { CourseEmblem, PageHeader } from '../../components/ui/Primitives'
import { BookIcon, PencilIcon, PlusIcon, SearchIcon, TrashIcon } from '../../components/ui/Icons'

export const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

// Course details form shared by "New course" (modal) and the course editor.
export function CourseFields({ value, onChange, errors = {} }) {
  const set = (key) => (event) => onChange({ ...value, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="course-title">Course title</label>
        <input id="course-title" className="input" value={value.title} onChange={set('title')} required minLength={3} maxLength={200} placeholder="e.g. Python Programming Fundamentals" aria-invalid={errors.title ? true : undefined} />
        {errors.title && <p className="mt-1 text-xs text-danger">{errors.title}</p>}</div>
      <div className="sm:col-span-2"><label className="label" htmlFor="course-description">Description</label>
        <textarea id="course-description" rows={4} className="input" value={value.description} onChange={set('description')} placeholder="What will learners gain from this course?" /></div>
      <div><label className="label" htmlFor="course-category">Category</label><input id="course-category" className="input" value={value.category} onChange={set('category')} placeholder="e.g. Programming" /></div>
      <div><label className="label" htmlFor="course-level">Level</label><select id="course-level" className="input" value={value.level} onChange={set('level')}>{LEVELS.map((level) => <option key={level}>{level}</option>)}</select></div>
      <label className="flex items-center gap-3 sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-brand" checked={value.isPublished} onChange={set('isPublished')} />
        <span className="text-sm"><span className="font-semibold">Published</span> — visible in the student course library</span></label>
    </div>
  )
}

export const fieldErrors = (error) => Object.fromEntries(Object.entries(error?.data?.errors || {}).map(([key, val]) => [key, Array.isArray(val) ? val.join(' ') : String(val)]))

function NewCourse({ open, onClose }) {
  const nav = useNavigate()
  const toast = useToast()
  const [value, setValue] = useState({ title: '', description: '', category: '', level: 'Beginner', isPublished: false })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const submit = async (event) => {
    event.preventDefault()
    setBusy(true); setErrors({})
    const body = new FormData()
    Object.entries(value).forEach(([key, val]) => body.append(key, String(val)))
    try { const created = await coursesApi.create(body); toast('Course created. Add its modules next.'); nav(`/admin/courses/${created.id}`) }
    catch (error) { setErrors(fieldErrors(error)); toast(error.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose} title="New course" subtitle="You can add modules, resources and quizzes after creating it."
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="new-course-form" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create course'}</button></>}>
      <form id="new-course-form" onSubmit={submit} noValidate><CourseFields value={value} onChange={setValue} errors={errors} /></form>
    </Modal>
  )
}

export default function AdminCourses() {
  const state = useApi(() => coursesApi.list(), [])
  const [params, setParams] = useSearchParams()
  const confirm = useConfirm()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const creating = params.get('new') === '1'

  const remove = async (course) => {
    const ok = await confirm({ title: `Delete “${course.title}”?`, message: `This permanently removes its modules, resources and ${course.students} enrollment(s). Courses with quiz or exam history cannot be deleted — unpublish them instead.`, confirmLabel: 'Delete course', tone: 'danger' })
    if (!ok) return
    try { await coursesApi.remove(course.id); toast('Course deleted.'); state.reload() } catch (error) { toast(error.message, 'error') }
  }
  const togglePublish = async (course) => {
    try { await coursesApi.update(course.id, { isPublished: !course.isPublished }); toast(course.isPublished ? 'Course unpublished.' : 'Course published.'); state.reload() }
    catch (error) { toast(error.message, 'error') }
  }

  return (
    <>
      <PageHeader eyebrow="Administration" title="Courses" subtitle="Create courses, organise modules and resources, and attach module quizzes and final exams."
        actions={<button type="button" className="btn-primary" onClick={() => setParams({ new: '1' })}><PlusIcon className="h-4 w-4" />New course</button>} />
      <label className="relative mb-4 block max-w-md"><span className="sr-only">Search courses</span>
        <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input type="search" className="input pl-10" placeholder="Search courses" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <Async state={state} label="Loading courses…">{(rows) => {
        const visible = rows.filter((course) => `${course.title} ${course.category}`.toLowerCase().includes(search.trim().toLowerCase()))
        if (!rows.length) return <div className="card"><EmptyState title="No courses yet" icon={BookIcon} action={<button className="btn-primary" onClick={() => setParams({ new: '1' })}>Create course</button>}>Create your first course to start building the learning catalogue.</EmptyState></div>
        return (
          <div className="card overflow-x-auto">
            <table className="table min-w-[760px]">
              <thead><tr><th>Course</th><th>Category</th><th>Modules</th><th>Students</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {visible.map((course) => (
                  <tr key={course.id}>
                    <td><div className="flex items-center gap-3"><CourseEmblem course={course} size="sm" /><Link to={`/admin/courses/${course.id}`} className="font-semibold hover:text-brand">{course.title}</Link></div></td>
                    <td>{course.category}<span className="block text-xs text-ink-muted">{course.level}</span></td>
                    <td>{course.modules}</td><td>{course.students}</td>
                    <td><button type="button" onClick={() => togglePublish(course)} className={course.isPublished ? 'badge-success' : 'badge'} title="Toggle publication">{course.isPublished ? 'Published' : 'Draft'}</button></td>
                    <td><div className="flex justify-end gap-2">
                      <Link to={`/admin/courses/${course.id}`} className="btn-ghost btn-sm" aria-label={`Manage ${course.title}`}><PencilIcon className="h-3.5 w-3.5" />Manage</Link>
                      <button type="button" onClick={() => remove(course)} className="btn-danger btn-sm" aria-label={`Delete ${course.title}`}><TrashIcon className="h-3.5 w-3.5" /></button>
                    </div></td>
                  </tr>
                ))}
                {!visible.length && <tr><td colSpan={6} className="py-8 text-center text-ink-muted">No courses match this search.</td></tr>}
              </tbody>
            </table>
          </div>
        )
      }}</Async>
      <NewCourse open={creating} onClose={() => setParams({})} />
    </>
  )
}
