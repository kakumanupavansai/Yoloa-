import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi, modulesApi, resourcesApi } from '../../services/api'
import { Async } from '../../components/ui/States'
import { Modal, useConfirm, useToast } from '../../components/ui/Feedback'
import { CardHeading, PageHeader, ProgressBar, fmtDate } from '../../components/ui/Primitives'
import { ArrowDownIcon, ArrowUpIcon, ChevronDown, ClipboardIcon, DownloadIcon, ExternalIcon, ImportIcon, PencilIcon, PlusIcon, TrashIcon, TrophyIcon } from '../../components/ui/Icons'
import AssessmentPreview from '../../components/admin/AssessmentPreview'
import { CourseFields, fieldErrors } from './Courses'

const RESOURCE_TYPES = [
  ['video', 'YouTube video'], ['document', 'PDF / document'], ['presentation', 'Presentation (PowerPoint)'], ['link', 'External link'], ['text', 'Text note'],
]
const typeLabel = Object.fromEntries(RESOURCE_TYPES)

function ModuleForm({ open, module, onClose, onSave }) {
  const [value, setValue] = useState({ title: '', description: '', duration: '', required: true })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) setValue(module ? { title: module.title, description: module.description, duration: module.duration, required: module.required } : { title: '', description: '', duration: '', required: true }) }, [open, module])
  const submit = async (event) => { event.preventDefault(); setBusy(true); try { await onSave(value) } finally { setBusy(false) } }
  const set = (key) => (event) => setValue({ ...value, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value })
  return (
    <Modal open={open} onClose={onClose} title={module ? 'Edit module' : 'Add module'}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="module-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save module'}</button></>}>
      <form id="module-form" onSubmit={submit} className="space-y-4" noValidate>
        <div><label className="label" htmlFor="module-title">Module title</label><input id="module-title" className="input" value={value.title} onChange={set('title')} required /></div>
        <div><label className="label" htmlFor="module-description">Description</label><textarea id="module-description" rows={3} className="input" value={value.description} onChange={set('description')} /></div>
        <div><label className="label" htmlFor="module-duration">Estimated duration</label><input id="module-duration" className="input" value={value.duration} onChange={set('duration')} placeholder="e.g. 45 mins" /></div>
        <label className="flex items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={value.required} onChange={set('required')} />
          <span className="text-sm"><span className="font-semibold">Required module</span><span className="block text-ink-muted">Required modules need a passed quiz before the next module and the final exam unlock.</span></span></label>
      </form>
    </Modal>
  )
}

const blankResource = { type: 'video', title: '', url: '', text: '' }

// Add a resource to the course or one of its modules, or edit an existing one (its course/module stays fixed).
function ResourceForm({ open, course, initialTarget, resource, onClose, onSaved }) {
  const toast = useToast()
  const editing = Boolean(resource)
  const [value, setValue] = useState(blankResource)
  const [target, setTarget] = useState('course')
  const [file, setFile] = useState(null)
  const [removeFile, setRemoveFile] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)   // blocks a second submit that arrives before the button re-renders as disabled
  useEffect(() => {
    if (!open) return
    setValue(resource ? { type: resource.type, title: resource.title, url: resource.url || '', text: resource.text || '' } : blankResource)
    setTarget(initialTarget || 'course'); setFile(null); setRemoveFile(false); setErrors({})
  }, [open, resource, initialTarget])
  const fileType = value.type === 'document' || value.type === 'presentation'
  const modules = course?.modules || []
  const where = (moduleId) => (moduleId ? `Module: ${modules.find((item) => item.id === moduleId)?.title || ''}` : 'Whole course (course materials)')
  const submit = async (event) => {
    event.preventDefault()
    if (inFlight.current) return
    if (!value.title.trim()) { setErrors({ title: 'Give the resource a title.' }); return }
    inFlight.current = true
    setBusy(true); setErrors({})
    const body = new FormData()
    Object.entries(value).forEach(([key, val]) => body.append(key, val))
    if (file && fileType) body.append('file', file)
    if (editing && removeFile && !file) body.append('removeFile', 'true')
    try {
      if (editing) await resourcesApi.update(resource.id, body)
      else if (target === 'course') await coursesApi.addResource(course.id, body)
      else await modulesApi.addResource(Number(target), body)
      toast(editing ? 'Resource updated.' : 'Resource added.'); onSaved()
    } catch (error) { setErrors(fieldErrors(error)); toast(error.message, 'error') } finally { inFlight.current = false; setBusy(false) }
  }
  const set = (key) => (event) => setValue({ ...value, [key]: event.target.value })
  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit resource' : 'Add resource'} subtitle={editing ? where(resource.moduleId) : course?.title}
      footer={<><button type="button" className="btn-ghost" onClick={onClose}>Cancel</button><button type="submit" form="resource-form" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save resource' : 'Add resource'}</button></>}>
      <form id="resource-form" onSubmit={submit} className="space-y-4" noValidate>
        {!editing && (
          <div><label className="label" htmlFor="resource-target">Belongs to</label>
            <select id="resource-target" className="input" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="course">Whole course (course materials)</option>
              {modules.map((module, index) => <option key={module.id} value={String(module.id)}>Module {index + 1}: {module.title}</option>)}
            </select>
            <p className="hint">{target === 'course' ? 'Shown on the course page to every enrolled student.' : 'Available once the student has unlocked this module.'}</p></div>
        )}
        <div><label className="label" htmlFor="resource-type">Type</label><select id="resource-type" className="input" value={value.type} onChange={set('type')}>{RESOURCE_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>{errors.type && <p className="mt-1 text-xs text-danger">{errors.type}</p>}</div>
        <div><label className="label" htmlFor="resource-title">Title</label><input id="resource-title" className="input" value={value.title} onChange={set('title')} required />{errors.title && <p className="mt-1 text-xs text-danger">{errors.title}</p>}</div>
        {value.type !== 'text' && (
          <div><label className="label" htmlFor="resource-url">{value.type === 'video' ? 'YouTube link' : fileType ? 'Link (optional if you upload a file)' : 'Link'}</label>
            <input id="resource-url" type="url" className="input" value={value.url} onChange={set('url')} placeholder={value.type === 'video' ? 'https://www.youtube.com/watch?v=…' : 'https://'} />
            {errors.url && <p className="mt-1 text-xs text-danger">{errors.url}</p>}</div>
        )}
        {fileType && (
          <div><label className="label" htmlFor="resource-file">{editing && resource.hasFile ? 'Replace file' : 'Upload file'}</label>
            {editing && resource.hasFile && <p className="mb-2 text-sm text-ink-muted">Current file: <span className="font-medium text-ink">{resource.fileName}</span></p>}
            <input id="resource-file" type="file" className="input" accept={value.type === 'presentation' ? '.ppt,.pptx,.pps,.ppsx,.odp,.pdf' : '.pdf,.doc,.docx,.odt,.txt,.rtf,.xls,.xlsx,.csv'} onChange={(event) => setFile(event.target.files[0] || null)} />
            <p className="hint">Up to 25 MB. Files stay private: they are only streamed to enrolled students who can access this resource.</p>
            {editing && resource.hasFile && !file && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={removeFile} onChange={(event) => setRemoveFile(event.target.checked)} />Remove the current file</label>}
            {errors.file && <p className="mt-1 text-xs text-danger">{errors.file}</p>}</div>
        )}
        <div><label className="label" htmlFor="resource-text">{value.type === 'text' ? 'Note' : 'Notes for students (optional)'}</label><textarea id="resource-text" rows={3} className="input" value={value.text} onChange={set('text')} />{errors.text && <p className="mt-1 text-xs text-danger">{errors.text}</p>}</div>
      </form>
    </Modal>
  )
}

function ResourceList({ resources, onEdit, onDelete, empty }) {
  return (
    <ul className="space-y-2">
      {resources.map((resource) => (
        <li key={resource.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-ground px-3 py-2 text-sm">
          <span className="badge bg-surface">{typeLabel[resource.type] || resource.type}</span>
          <span className="min-w-0 flex-1 truncate font-medium">{resource.title}{resource.fileName ? ` · ${resource.fileName}` : ''}</span>
          {resource.url && <a href={resource.url} target="_blank" rel="noopener noreferrer" className="rounded-lg p-1.5 text-ink-muted hover:bg-surface" aria-label={`Open link for ${resource.title}`}><ExternalIcon className="h-4 w-4" /></a>}
          {resource.hasFile && <a href={resourcesApi.fileUrl(resource, { download: true })} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface" aria-label={`Download ${resource.title}`}><DownloadIcon className="h-4 w-4" /></a>}
          <button type="button" onClick={() => onEdit(resource)} className="rounded-lg p-1.5 text-ink-muted hover:bg-surface" aria-label={`Edit resource ${resource.title}`}><PencilIcon className="h-4 w-4" /></button>
          <button type="button" onClick={() => onDelete(resource)} className="rounded-lg p-1.5 text-danger hover:bg-surface" aria-label={`Delete resource ${resource.title}`}><TrashIcon className="h-4 w-4" /></button>
        </li>
      ))}
      {!resources.length && <li className="text-sm text-ink-muted">{empty}</li>}
    </ul>
  )
}

const statusBadge = (status) => (status === 'published' ? <span className="badge-success">Published</span> : <span className="badge-warning">Draft</span>)

function ModuleBlock({ module, index, count, onMove, onEdit, onDelete, onAddResource, onEditResource, onDeleteResource, onPreview, courseId }) {
  const quiz = module.quiz
  const [showResources, setShowResources] = useState(false)
  return (
    <section className="rounded-2xl border border-line p-4" aria-label={`Module ${index + 1}: ${module.title}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex items-center gap-1 lg:flex-col">
          <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-ground disabled:opacity-30" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${module.title} up`}><ArrowUpIcon className="h-4 w-4" /></button>
          <button type="button" className="rounded-lg p-1.5 text-ink-muted hover:bg-ground disabled:opacity-30" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${module.title} down`}><ArrowDownIcon className="h-4 w-4" /></button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{index + 1}. {module.title}</h3>{module.required ? <span className="badge-brand">Required</span> : <span className="badge">Optional</span>}</div>
          {module.description && <p className="mt-1 text-sm text-ink-muted">{module.description}</p>}
          <p className="mt-1 text-xs text-ink-muted">{module.duration || 'No duration set'} · {module.resources.length} resource{module.resources.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost btn-sm" onClick={() => onEdit(module)} aria-label={`Edit module ${module.title}`}><PencilIcon className="h-3.5 w-3.5" />Edit module</button>
          <button type="button" className="btn-secondary btn-sm" onClick={() => onAddResource(module)} aria-label={`Add resource to ${module.title}`}><PlusIcon className="h-3.5 w-3.5" />Add resource</button>
          <button type="button" className="btn-danger btn-sm" onClick={() => onDelete(module)} aria-label={`Delete module ${module.title}`}><TrashIcon className="h-3.5 w-3.5" /></button>
        </div>
      </div>
      <div className="mt-3">
        <button type="button" className="inline-flex items-center gap-1 rounded-lg text-sm font-semibold text-brand hover:underline" aria-expanded={showResources} onClick={() => setShowResources((shown) => !shown)}>
          <ChevronDown className={`h-4 w-4 transition-transform ${showResources ? '' : '-rotate-90'}`} />Manage resources ({module.resources.length})
        </button>
        {showResources && <div className="mt-2"><ResourceList resources={module.resources} onEdit={onEditResource} onDelete={onDeleteResource} empty="No resources yet. Add a YouTube video, document, presentation or link." /></div>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2.5 text-sm">
        <ClipboardIcon className="h-4 w-4 text-brand" />
        {quiz ? (
          <>
            <span className="font-semibold">{quiz.title}</span>
            {statusBadge(quiz.status)}
            <span className="text-xs text-ink-muted">{quiz.questionCount} questions · pass {quiz.passPercent}% · {quiz.attempts} attempts</span>
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn-ghost btn-sm" onClick={() => onPreview(quiz)} aria-label={`Preview quiz ${quiz.title}`}>Preview quiz</button>
              <Link to={`/admin/exams/${quiz.id}`} className="btn-primary btn-sm" aria-label={`Edit quiz ${quiz.title}`}>Edit quiz</Link>
            </div>
          </>
        ) : (
          <>
            <span className="text-ink-muted">{module.required ? 'No quiz yet. Required modules need a published quiz.' : 'No quiz (students mark this module complete).'}</span>
            <Link to={`/admin/exams/new?type=module_quiz&courseId=${courseId}&moduleId=${module.id}`} className="btn-primary btn-sm ml-auto" aria-label={`Add quiz to ${module.title}`}>Add quiz</Link>
          </>
        )}
      </div>
    </section>
  )
}

export default function CourseEditor() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const state = useApi(() => coursesApi.manage(id), [id])
  const [details, setDetails] = useState(null)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [moduleDialog, setModuleDialog] = useState(null)   // {module|null}
  const [resourceDialog, setResourceDialog] = useState(null)   // {target} to add, {resource} to edit
  const [previewing, setPreviewing] = useState(null)
  useEffect(() => { if (state.data) setDetails({ title: state.data.title, description: state.data.description, category: state.data.category, level: state.data.level, isPublished: state.data.isPublished }) }, [state.data])

  const saveDetails = async (event) => {
    event.preventDefault()
    setSaving(true); setErrors({})
    try { await coursesApi.update(id, details); toast('Course details saved.'); state.reload() }
    catch (error) { setErrors(fieldErrors(error)); toast(error.message, 'error') } finally { setSaving(false) }
  }
  const saveModule = async (value) => {
    try {
      if (moduleDialog?.module) await modulesApi.update(moduleDialog.module.id, value)
      else await coursesApi.addModule(id, value)
      toast(moduleDialog?.module ? 'Module updated.' : 'Module added.'); setModuleDialog(null); state.reload()
    } catch (error) { toast(error.message, 'error') }
  }
  const move = async (index, delta) => {
    const ids = state.data.modules.map((module) => module.id)
    ;[ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]
    try { await coursesApi.reorderModules(id, ids); state.reload() } catch (error) { toast(error.message, 'error') }
  }
  const deleteModule = async (module) => {
    if (!await confirm({ title: `Delete “${module.title}”?`, message: 'Its resources and quiz are removed too. Modules whose quiz already has attempts cannot be deleted — mark them optional instead.', confirmLabel: 'Delete module', tone: 'danger' })) return
    try { await modulesApi.remove(module.id); toast('Module deleted.'); state.reload() } catch (error) { toast(error.message, 'error') }
  }
  const deleteResource = async (resource) => {
    if (!await confirm({ title: 'Delete resource?', message: `“${resource.title}” will no longer be available to students.`, confirmLabel: 'Delete', tone: 'danger' })) return
    try { await resourcesApi.remove(resource.id); toast('Resource deleted.'); state.reload() } catch (error) { toast(error.message, 'error') }
  }
  const deleteCourse = async (course) => {
    if (!await confirm({ title: `Delete “${course.title}”?`, message: 'This permanently removes the course, its modules, resources and enrollments. Courses with assessment history cannot be deleted.', confirmLabel: 'Delete course', tone: 'danger' })) return
    try { await coursesApi.remove(course.id); toast('Course deleted.'); nav('/admin/courses', { replace: true }) } catch (error) { toast(error.message, 'error') }
  }

  return (
    <Async state={state} label="Loading course…">{(course) => (
      <>
        <PageHeader back={{ to: '/admin/courses', label: 'All courses' }} eyebrow="Course management" title={course.title}
          subtitle={`${course.modules.length} modules · ${course.stats.students} enrolled · ${course.stats.completed} completed`}
          actions={<>
            {course.isPublished ? <span className="badge-success self-center px-3 py-1 text-sm">Published</span> : <span className="badge self-center px-3 py-1 text-sm">Draft — hidden from students</span>}
            <button type="button" className="btn-primary" onClick={() => setResourceDialog({ target: 'course' })}><PlusIcon className="h-4 w-4" />Add Resource</button>
          </>} />
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className="card card-pad">
              <CardHeading title="Modules & resources" action={<button type="button" className="btn-primary btn-sm" onClick={() => setModuleDialog({ module: null })}><PlusIcon className="h-3.5 w-3.5" />Add module</button>} />
              <p className="mt-1 text-sm text-ink-muted">Students progress through modules in this order. Passing a required module’s quiz unlocks the next module.</p>
              <div className="mt-4 space-y-3">
                {course.modules.map((module, index) => (
                  <ModuleBlock key={module.id} module={module} index={index} count={course.modules.length} courseId={course.id} onMove={move}
                    onEdit={(item) => setModuleDialog({ module: item })} onDelete={deleteModule} onAddResource={(item) => setResourceDialog({ target: String(item.id) })}
                    onEditResource={(resource) => setResourceDialog({ resource })} onDeleteResource={deleteResource} onPreview={setPreviewing} />
                ))}
                {!course.modules.length && <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-ink-muted">No modules yet. Add the first one to start structuring this course.</p>}
              </div>
            </section>

            <section className="card card-pad" aria-labelledby="course-materials-heading">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="course-materials-heading" className="text-lg font-bold">Course materials</h2>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setResourceDialog({ target: 'course' })}><PlusIcon className="h-3.5 w-3.5" />Add course resource</button>
              </div>
              <p className="mb-3 mt-1 text-sm text-ink-muted">Resources for the whole course, such as a syllabus or reading list. Enrolled students see them on the course page.</p>
              <ResourceList resources={course.resources} onEdit={(resource) => setResourceDialog({ resource })} onDelete={deleteResource} empty="No course-level resources yet." />
            </section>

            <section className="card card-pad" aria-labelledby="final-exam-heading">
              <h2 id="final-exam-heading" className="text-lg font-bold">Final examination</h2>
              {course.finalExam ? (
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-3">
                    <TrophyIcon className="h-5 w-5 text-brand" /><span className="font-semibold">{course.finalExam.title}</span>{statusBadge(course.finalExam.status)}
                    <span className="text-ink-muted">{course.finalExam.questionCount} questions · 10 minutes · pass mark 60% · {course.finalExam.attempts} attempts</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link className="btn-primary btn-sm" to={`/admin/exams/${course.finalExam.id}`}>Edit final exam</Link>
                    <Link className="btn-ghost btn-sm" to={`/admin/exams/${course.finalExam.id}?import=1`}><ImportIcon className="h-3.5 w-3.5" />Import questions from Excel</Link>
                    <button type="button" className="btn-ghost btn-sm" onClick={() => setPreviewing(course.finalExam)}>Preview final exam</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-ink-muted">No final exam yet. It unlocks for students after every required module quiz is passed (10 minutes, 60% pass mark).</span>
                  <Link className="btn-primary btn-sm ml-auto" to={`/admin/exams/new?type=final_exam&courseId=${course.id}`}>Add final exam</Link>
                </div>
              )}
            </section>

            <section className="card">
              <div className="p-5 sm:p-6"><CardHeading title="Enrolled students" /></div>
              <div className="overflow-x-auto">
                <table className="table min-w-[560px]">
                  <thead><tr><th>Student</th><th>Progress</th><th>Current module</th><th>Status</th></tr></thead>
                  <tbody>
                    {course.enrollments.map((row) => (
                      <tr key={row.studentId}>
                        <td><Link to={`/admin/students/${row.studentId}`} className="font-semibold hover:text-brand">{row.name}</Link><span className="block text-xs text-ink-muted">{row.email}</span></td>
                        <td className="w-44"><div className="flex items-center gap-2"><ProgressBar percent={row.percent} /><span className="text-xs font-semibold">{row.percent}%</span></div></td>
                        <td className="text-sm">{row.currentModule || '—'}</td>
                        <td>{row.status === 'completed' ? <span className="badge-success">Completed {fmtDate(row.completedAt)}</span> : <span className="badge-brand">In progress</span>}</td>
                      </tr>
                    ))}
                    {!course.enrollments.length && <tr><td colSpan={4} className="py-8 text-center text-ink-muted">No students are enrolled yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            {details && (
              <form onSubmit={saveDetails} className="card card-pad" noValidate>
                <h2 className="text-lg font-bold">Course details</h2>
                <div className="mt-4"><CourseFields value={details} onChange={setDetails} errors={errors} /></div>
                <button type="submit" className="btn-primary mt-5 w-full" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button>
              </form>
            )}
            <section className="card card-pad">
              <h2 className="text-base font-bold text-danger">Delete course</h2>
              <p className="mt-1 text-sm text-ink-muted">Only possible while no student has quiz or exam history in it.</p>
              <button type="button" className="btn-danger mt-4" onClick={() => deleteCourse(course)}><TrashIcon className="h-4 w-4" />Delete course</button>
            </section>
          </aside>
        </div>
        <ModuleForm open={Boolean(moduleDialog)} module={moduleDialog?.module} onClose={() => setModuleDialog(null)} onSave={saveModule} />
        <ResourceForm open={Boolean(resourceDialog)} course={course} initialTarget={resourceDialog?.target} resource={resourceDialog?.resource}
          onClose={() => setResourceDialog(null)} onSaved={() => { setResourceDialog(null); state.reload() }} />
        <AssessmentPreview exam={previewing} onClose={() => setPreviewing(null)} />
      </>
    )}</Async>
  )
}
