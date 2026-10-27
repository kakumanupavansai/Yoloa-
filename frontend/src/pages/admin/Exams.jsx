import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { examsApi } from '../../services/api'
import { Async, EmptyState } from '../../components/ui/States'
import { useConfirm, useToast } from '../../components/ui/Feedback'
import { PageHeader } from '../../components/ui/Primitives'
import { ClipboardIcon, ImportIcon, PencilIcon, SearchIcon, TrashIcon } from '../../components/ui/Icons'

const PAGE_SIZE = 15
const fold = (text) => String(text || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')

// The list endpoint returns every assessment definition (a few dozen per course at most), so search and paging run here.
export function matchesSearch(exam, term) {
  const words = fold(term).split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const haystack = fold([exam.title, exam.courseTitle, exam.moduleTitle, exam.assessmentTypeLabel, exam.subject].join(' '))
  return words.every((word) => haystack.includes(word))
}

const FILTERS = [['all', 'All types'], ['module_quiz', 'Module quizzes'], ['final_exam', 'Final exams'], ['legacy_quiz', 'Legacy quizzes']]

// Every assessment definition. New quizzes are created from a course module so they are always linked correctly.
export default function Exams() {
  const state = useApi(() => examsApi.list(), [])
  const confirm = useConfirm()
  const toast = useToast()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const changeSearch = (value) => { setSearch(value); setPage(1) }
  const changeFilter = (value) => { setFilter(value); setPage(1) }
  const visible = useMemo(() => (state.data || []).filter((exam) => (filter === 'all' || exam.assessmentType === filter) && matchesSearch(exam, search)), [state.data, filter, search])
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const current = Math.min(page, pages)
  const pageRows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  const setStatus = async (exam, status) => {
    try { await examsApi.update(exam.id, { status }); toast(status === 'published' ? 'Published.' : 'Moved to draft — hidden from students.'); state.reload() }
    catch (error) { toast(error.message, 'error') }
  }
  const remove = async (exam) => {
    if (!await confirm({ title: `Delete “${exam.title}”?`, message: 'Assessments with student attempts cannot be deleted; unpublish them instead to keep the history.', confirmLabel: 'Delete', tone: 'danger' })) return
    try { await examsApi.remove(exam.id); toast('Assessment deleted.'); state.reload() } catch (error) { toast(error.message, 'error') }
  }

  return (
    <>
      <PageHeader eyebrow="Administration" title="Assessments" subtitle="Module quizzes and final examinations. Create a quiz from the module it belongs to in the course editor."
        actions={<Link to="/admin/courses" className="btn-primary">Open course editor</Link>} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <label className="relative block flex-1 sm:max-w-md"><span className="sr-only">Search assessments</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
          <input type="search" className="input pl-9" placeholder="Search assessments by title, course or module…" value={search} onChange={(event) => changeSearch(event.target.value)} />
        </label>
        <label className="block sm:w-56"><span className="sr-only">Filter by type</span>
          <select className="input" value={filter} onChange={(event) => changeFilter(event.target.value)}>{FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </label>
      </div>
      <Async state={state} label="Loading assessments…">{(rows) => {
        if (!rows.length) return <div className="card"><EmptyState title="No assessments yet" icon={ClipboardIcon} action={<Link to="/admin/courses" className="btn-primary">Go to courses</Link>}>Add a quiz to a course module, or create a course final exam.</EmptyState></div>
        return (
          <div className="card overflow-x-auto">
            <table className="table min-w-[820px]">
              <thead><tr><th>Assessment</th><th>Type</th><th>Course / module</th><th>Questions</th><th>Pass mark</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
              <tbody>
                {pageRows.map((exam) => {
                  const published = exam.status === 'Published'
                  return (
                    <tr key={exam.id}>
                      <td className="font-semibold">{exam.title}</td>
                      <td><span className={exam.assessmentType === 'final_exam' ? 'badge-brand' : 'badge'}>{exam.assessmentTypeLabel}</span></td>
                      <td className="text-sm">{exam.courseTitle || '—'}{exam.moduleTitle && <span className="block text-xs text-ink-muted">{exam.moduleTitle}</span>}</td>
                      <td>{exam.questions} <span className="text-xs text-ink-muted">({exam.points} pts)</span></td>
                      <td>{exam.passPercent}%</td>
                      <td>{published ? <span className="badge-success">Published</span> : <span className="badge-warning">Draft</span>}</td>
                      <td><div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost btn-sm" onClick={() => setStatus(exam, published ? 'draft' : 'published')}>{published ? 'Unpublish' : 'Publish'}</button>
                        <Link to={`/admin/exams/${exam.id}`} className="btn-ghost btn-sm" aria-label={`Edit ${exam.title}`}><PencilIcon className="h-3.5 w-3.5" />Edit</Link>
                        <Link to={`/admin/exams/${exam.id}?import=1`} className="btn-ghost btn-sm" aria-label={`Import questions into ${exam.title}`} title="Import Questions from Excel"><ImportIcon className="h-3.5 w-3.5" />Import</Link>
                        <button type="button" className="btn-danger btn-sm" onClick={() => remove(exam)} aria-label={`Delete ${exam.title}`}><TrashIcon className="h-3.5 w-3.5" /></button>
                      </div></td>
                    </tr>
                  )
                })}
                {!visible.length && <tr><td colSpan={7} className="py-8 text-center text-ink-muted">{search.trim() ? `No assessments match “${search.trim()}”${filter === 'all' ? '' : ' with this type filter'}.` : 'No assessments of this type.'}</td></tr>}
              </tbody>
            </table>
            {visible.length > 0 && (
              <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm" aria-label="Assessment pages">
                <p className="text-ink-muted" aria-live="polite">Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, visible.length)} of {visible.length}{visible.length !== rows.length ? ` (filtered from ${rows.length})` : ''}</p>
                {pages > 1 && <div className="flex items-center gap-2">
                  <button type="button" className="btn-ghost btn-sm" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button>
                  <span>Page {current} of {pages}</span>
                  <button type="button" className="btn-ghost btn-sm" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button>
                </div>}
              </nav>
            )}
          </div>
        )
      }}</Async>
    </>
  )
}
