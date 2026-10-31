import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useApi } from '../../hooks'
import { coursesApi, examsApi } from '../../services/api'
import { Async, Loading } from '../../components/ui/States'
import { Modal, useConfirm, useToast } from '../../components/ui/Feedback'
import { PageHeader } from '../../components/ui/Primitives'
import { ArrowDownIcon, ArrowUpIcon, ImportIcon, PlusIcon, TrashIcon } from '../../components/ui/Icons'
import QuestionImportPanel from '../../components/admin/QuestionImportPanel'
import AssessmentPreview from '../../components/admin/AssessmentPreview'
import QuizImageField from '../../components/admin/QuizImageField'

const TYPES = [['single', 'Single choice'], ['multiple', 'Multiple correct answers'], ['true_false', 'True / false'], ['short', 'Short answer']]
const LETTERS = 'ABCDEFGH'
let seq = 0
const blank = (questionType = 'single') => ({ key: `q${seq++}`, questionType, text: '', points: 1, choices: ['', '', '', ''], choiceImages: [null, null, null, null],
  correct: 0, correctAnswers: [], tf: 'true', expectedAnswer: '', alternatives: '', imageId: null, explanation: '', explanationImageId: null })
const isChoiceType = (type) => type === 'single' || type === 'multiple'

const fromServer = (question) => ({
  ...blank(question.questionType), text: question.text, points: question.points,
  choices: isChoiceType(question.questionType) ? [...question.choices] : ['', '', '', ''],
  choiceImages: isChoiceType(question.questionType) ? question.choices.map((_, k) => question.choiceImages?.[k] ?? null) : [null, null, null, null],
  imageId: question.imageId ?? null, explanation: question.explanation || '', explanationImageId: question.explanationImageId ?? null,
  correct: question.questionType === 'single' ? (question.correctAnswers?.[0] ?? question.correct ?? 0) : 0,
  correctAnswers: question.questionType === 'multiple' ? [...(question.correctAnswers || [])] : [],
  tf: question.questionType === 'true_false' ? (question.correctAnswers?.[0] ? 'true' : 'false') : 'true',
  expectedAnswer: question.expectedAnswer || '', alternatives: (question.acceptedAlternatives || []).join(', '),
})

const toServer = (question) => {
  const base = { questionType: question.questionType, text: question.text.trim(), points: Number(question.points) || 1,
    imageId: question.imageId || null, explanation: question.explanation.trim(), explanationImageId: question.explanationImageId || null }
  const choices = question.choices.map((choice) => choice.trim())
  const choiceImages = question.choiceImages.map((id) => id || null)
  if (question.questionType === 'single') return { ...base, choices, choiceImages, correct: question.correct }
  if (question.questionType === 'multiple') return { ...base, choices, choiceImages, correctAnswers: question.correctAnswers }
  if (question.questionType === 'true_false') return { ...base, correct: question.tf }
  return { ...base, expectedAnswer: question.expectedAnswer.trim(), acceptedAlternatives: question.alternatives.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
    normalization: { caseInsensitive: true, ignorePunctuation: true } }
}

// Client-side checks mirror the server so mistakes are reported before saving; the server re-validates everything.
function validate(questions) {
  for (const [index, question] of questions.entries()) {
    const n = index + 1
    if (!question.text.trim()) return `Question ${n} needs text.`
    if (isChoiceType(question.questionType)) {
      // A choice can be text, an image, or both.
      const filled = question.choices.filter((choice, k) => choice.trim() || question.choiceImages[k])
      if (filled.length < 2 || filled.length !== question.choices.length) return `Question ${n}: fill in every choice with text or an image (at least two), or remove empty ones.`
      if (question.questionType === 'multiple' && !question.correctAnswers.length) return `Question ${n}: mark at least one correct answer.`
    }
    if (question.questionType === 'short' && !question.expectedAnswer.trim()) return `Question ${n} needs an expected answer.`
  }
  return ''
}

function QuestionCard({ question, index, count, onChange, onRemove, onMove }) {
  const set = (patch) => onChange({ ...question, ...patch })
  const choiceType = isChoiceType(question.questionType)
  const toggleCorrect = (k) => set({ correctAnswers: question.correctAnswers.includes(k) ? question.correctAnswers.filter((value) => value !== k) : [...question.correctAnswers, k].sort() })
  const removeChoice = (k) => set({
    choices: question.choices.filter((_, i) => i !== k),
    choiceImages: question.choiceImages.filter((_, i) => i !== k),
    correct: question.correct === k ? 0 : question.correct > k ? question.correct - 1 : question.correct,
    correctAnswers: question.correctAnswers.filter((value) => value !== k).map((value) => (value > k ? value - 1 : value)),
  })
  return (
    <fieldset className="rounded-2xl border border-line p-4 sm:p-5">
      <legend className="px-1 text-sm font-bold">Question {index + 1}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[200px] flex-1"><span className="label">Type</span>
          <select className="input" value={question.questionType} onChange={(event) => set({ questionType: event.target.value })}>{TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="w-24"><span className="label">Points</span><input type="number" min={1} className="input" value={question.points} onChange={(event) => set({ points: event.target.value })} /></label>
        <div className="flex gap-1">
          <button type="button" className="btn-ghost btn-sm" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move question ${index + 1} up`}><ArrowUpIcon className="h-4 w-4" /></button>
          <button type="button" className="btn-ghost btn-sm" disabled={index === count - 1} onClick={() => onMove(index, 1)} aria-label={`Move question ${index + 1} down`}><ArrowDownIcon className="h-4 w-4" /></button>
          <button type="button" className="btn-danger btn-sm" onClick={onRemove} aria-label={`Remove question ${index + 1}`}><TrashIcon className="h-4 w-4" /></button>
        </div>
      </div>
      <label className="mt-3 block"><span className="label">Question text</span><textarea rows={2} className="input" value={question.text} onChange={(event) => set({ text: event.target.value })} /></label>
      <QuizImageField label={`image for question ${index + 1}`} value={question.imageId} onChange={(imageId) => set({ imageId })} />
      {choiceType && (
        <div className="mt-3 space-y-2" role="group" aria-label={`Choices for question ${index + 1}`}>
          <p className="text-xs text-ink-muted">{question.questionType === 'single' ? 'Select the one correct answer.' : 'Tick every correct answer (all must be chosen to score).'}</p>
          {question.choices.map((choice, k) => (
            <div key={k} className="flex items-center gap-2">
              {question.questionType === 'single'
                ? <input type="radio" name={`${question.key}-correct`} className="h-4 w-4 accent-brand" checked={question.correct === k} onChange={() => set({ correct: k })} aria-label={`Choice ${LETTERS[k]} is correct`} />
                : <input type="checkbox" className="h-4 w-4 accent-brand" checked={question.correctAnswers.includes(k)} onChange={() => toggleCorrect(k)} aria-label={`Choice ${LETTERS[k]} is correct`} />}
              <span className="w-5 text-sm font-bold text-ink-muted">{LETTERS[k]}</span>
              <input className="input" value={choice} onChange={(event) => set({ choices: question.choices.map((item, i) => (i === k ? event.target.value : item)) })} aria-label={`Choice ${LETTERS[k]}`}
                placeholder={question.choiceImages[k] ? 'Optional text for the image' : ''} />
              <QuizImageField compact label={`image for choice ${LETTERS[k]}`} value={question.choiceImages[k]}
                onChange={(imageId) => set({ choiceImages: question.choiceImages.map((item, i) => (i === k ? imageId : item)) })} />
              <button type="button" className="rounded-lg p-2 text-ink-muted hover:bg-ground disabled:opacity-30" disabled={question.choices.length <= 2} onClick={() => removeChoice(k)} aria-label={`Remove choice ${LETTERS[k]}`}><TrashIcon className="h-4 w-4" /></button>
            </div>
          ))}
          {question.choices.length < 8 && <button type="button" className="btn-ghost btn-sm" onClick={() => set({ choices: [...question.choices, ''], choiceImages: [...question.choiceImages, null] })}><PlusIcon className="h-3.5 w-3.5" />Add choice</button>}
        </div>
      )}
      {question.questionType === 'true_false' && (
        <fieldset className="mt-3 flex gap-4 text-sm"><legend className="label">Correct answer</legend>
          {['true', 'false'].map((value) => <label key={value} className="flex items-center gap-2"><input type="radio" name={`${question.key}-tf`} className="h-4 w-4 accent-brand" checked={question.tf === value} onChange={() => set({ tf: value })} />{value === 'true' ? 'True' : 'False'}</label>)}
        </fieldset>
      )}
      {question.questionType === 'short' && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label><span className="label">Expected answer</span><input className="input" value={question.expectedAnswer} onChange={(event) => set({ expectedAnswer: event.target.value })} /></label>
          <label><span className="label">Also accept (comma-separated)</span><input className="input" value={question.alternatives} onChange={(event) => set({ alternatives: event.target.value })} /></label>
          <p className="hint sm:col-span-2">Graded automatically, ignoring case and punctuation. Administrators can adjust a score later from the student’s attempt.</p>
        </div>
      )}
      <details className="mt-4 rounded-xl bg-ground px-3 py-2" open={Boolean(question.explanation || question.explanationImageId)}>
        <summary className="cursor-pointer text-sm font-semibold text-ink-soft">Answer explanation <span className="font-normal text-ink-muted">(optional, shown to students after they submit)</span></summary>
        <label className="mt-2 block"><span className="sr-only">Explanation for question {index + 1}</span>
          <textarea rows={2} className="input" value={question.explanation} onChange={(event) => set({ explanation: event.target.value })} placeholder="Why the correct answer is correct" /></label>
        <QuizImageField label={`explanation image for question ${index + 1}`} value={question.explanationImageId} onChange={(explanationImageId) => set({ explanationImageId })} />
      </details>
    </fieldset>
  )
}

export default function QuizEditor() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const editing = Boolean(id)
  const exam = useApi(() => (editing ? examsApi.get(id) : Promise.resolve(null)), [id])
  // Bumped after an Excel import so the editor restarts from the questions now stored on the server.
  const [revision, setRevision] = useState(0)
  const reloadQuestions = async () => { await exam.reload(); setRevision((value) => value + 1) }
  // Going from "new" to a saved quiz reuses this component, so wait for the saved quiz before mounting its editor:
  // the editor's state is initialised once, from the data it is first given.
  if (editing && !exam.data && !exam.error) return <Loading label="Loading assessment…" />
  return <Async state={exam} label="Loading assessment…">{(existing) => <Editor key={`${id || 'new'}-${revision}`} existing={existing} params={params} onReloadQuestions={reloadQuestions} />}</Async>
}

function Editor({ existing, params, onReloadQuestions }) {
  const nav = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const courses = useApi(() => coursesApi.list(), [])
  const [meta, setMeta] = useState(() => existing ? {
    title: existing.title, assessmentType: existing.assessmentType, courseId: existing.courseId ? String(existing.courseId) : '',
    moduleId: existing.moduleId ? String(existing.moduleId) : '', passPercent: existing.passPercent || 50,
  } : { title: '', assessmentType: params.get('type') || 'module_quiz', courseId: params.get('courseId') || '', moduleId: params.get('moduleId') || '', passPercent: 50 })
  const [questions, setQuestions] = useState(() => (existing?.questions?.length ? existing.questions.map(fromServer) : [blank()]))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importOpen, setImportOpen] = useState(() => Boolean(existing) && params.get('import') === '1')
  const [previewing, setPreviewing] = useState(false)
  const initialQuestions = useRef(JSON.stringify(questions.map(toServer)))
  const course = useApi(() => (meta.courseId ? coursesApi.manage(meta.courseId) : Promise.resolve(null)), [meta.courseId])
  const final = meta.assessmentType === 'final_exam'
  const modules = course.data?.modules || []
  useEffect(() => {
    if (!meta.title && !existing && course.data) {
      const module = modules.find((item) => String(item.id) === meta.moduleId)
      setMeta((current) => ({ ...current, title: final ? `${course.data.title} — final examination` : module ? `${module.title} quiz` : current.title }))
    }
  }, [course.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const totalPoints = useMemo(() => questions.reduce((sum, question) => sum + (Number(question.points) || 0), 0), [questions])

  const nonBlank = () => questions.filter((question) => question.text.trim() || question.imageId || question.choices.some((choice) => choice.trim()))
  const payloadFor = (status, list) => ({ title: meta.title.trim(), subject: course.data?.category || '', assessmentType: meta.assessmentType, courseId: Number(meta.courseId),
    moduleId: final ? null : Number(meta.moduleId), status, questions: list.map(toServer), ...(final ? {} : { passPercent: Number(meta.passPercent) }) })
  const checkMeta = () => {
    if (!meta.title.trim()) return 'Give the assessment a title.'
    if (!meta.courseId) return 'Choose the course this assessment belongs to.'
    if (!final && !meta.moduleId) return 'Choose the module this quiz belongs to.'
    return ''
  }
  // A new quiz has no id yet, and imports are attached to a saved quiz: save it as a draft first, then open the import.
  const importIntoNew = async () => {
    setError('')
    const filled = nonBlank()
    const problem = checkMeta() || validate(filled)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const saved = await examsApi.create(payloadFor('draft', filled))
      toast('Draft saved. You can now import questions from Excel.')
      nav(`/admin/exams/${saved.id}?import=1`, { replace: true })
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const openImport = async () => {
    if (!existing) return importIntoNew()
    const dirty = JSON.stringify(questions.map(toServer)) !== initialQuestions.current
    if (dirty && !await confirm({ title: 'Discard unsaved question changes?', message: 'Importing reloads this assessment’s questions from the server, so edits you have not saved yet will be lost. Save first to keep them.', confirmLabel: 'Continue to import' })) return
    setImportOpen(true)
  }
  const imported = async (result) => {
    setImportOpen(false)
    toast(`Imported ${result.imported} question${result.imported === 1 ? '' : 's'} from Excel.`)
    await onReloadQuestions()
  }
  const update = (index, value) => setQuestions((list) => list.map((item, i) => (i === index ? value : item)))
  const move = (index, delta) => setQuestions((list) => { const next = [...list]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next })
  const save = async (status) => {
    setError('')
    const problem = checkMeta() || validate(questions)
    if (problem) return setError(problem)
    if (existing?.attempts > 0 && !await confirm({ title: 'Update questions?', message: 'Students have attempts on this assessment. Their past results keep the questions they answered; new attempts use the updated questions.', confirmLabel: 'Save changes' })) return
    setBusy(true)
    const payload = payloadFor(status, questions)
    try {
      const saved = existing ? await examsApi.update(existing.id, payload) : await examsApi.create(payload)
      toast(status === 'published' ? 'Assessment published.' : 'Draft saved.')
      nav(`/admin/courses/${saved.courseId || meta.courseId}`)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const backTo = meta.courseId ? `/admin/courses/${meta.courseId}` : '/admin/courses'
  const kind = final ? 'final exam' : 'quiz'
  const removeQuiz = async () => {
    const where = [existing.courseTitle, existing.moduleTitle].filter(Boolean).join(' › ')
    if (!await confirm({ title: `Delete ${kind} “${existing.title}”?`, tone: 'danger', confirmLabel: `Delete ${kind}`,
      message: `This permanently deletes the ${kind} “${existing.title}”${where ? ` (${where})` : ''} and its ${existing.questions?.length || 0} question${existing.questions?.length === 1 ? '' : 's'}. The course and module are not deleted. ${kind === 'quiz' ? 'Students then complete the module by marking it done.' : ''} ${existing.attempts > 0 ? 'Students have attempts on it, so the server will keep it and offer to move it to draft instead.' : ''}` })) return
    setBusy(true); setError('')
    try {
      await examsApi.remove(existing.id)
      toast(`Deleted “${existing.title}”.`)
      nav(backTo, { replace: true })
    } catch (err) {
      setBusy(false)
      if (err.status === 409 && await confirm({ title: 'Keep the student history', message: `${err.message} Move “${existing.title}” to draft now?`, confirmLabel: 'Move to draft' })) {
        try { await examsApi.update(existing.id, { status: 'draft' }); toast('Moved to draft — hidden from students.'); nav(backTo, { replace: true }) }
        catch (inner) { setError(inner.message) }
      } else if (err.status !== 409) setError(err.message)
    }
  }
  return (
    <>
      <PageHeader back={{ to: backTo, label: meta.courseId ? 'Back to course' : 'All courses' }} eyebrow={final ? 'Final examination' : 'Module quiz'}
        title={existing ? `Edit: ${existing.title}` : final ? 'New final examination' : 'New module quiz'}
        subtitle={final ? 'Final exams are always 10 minutes with a 60% pass mark. Students can take them once every required module quiz is passed.' : 'Passing this quiz completes the module and unlocks the next one.'} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <div className="card card-pad flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold">Questions</h2>
              <p className="text-sm text-ink-muted">{existing ? 'Write questions below, or add many at once from an Excel workbook.' : 'Write questions below, or import them from Excel (the quiz is saved as a draft first).'}</p>
            </div>
            {existing && <button type="button" className="btn-ghost btn-sm" onClick={() => setPreviewing(true)}>Preview</button>}
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={openImport}><ImportIcon className="h-3.5 w-3.5" />Import Questions from Excel</button>
          </div>
          {questions.map((question, index) => (
            <QuestionCard key={question.key} question={question} index={index} count={questions.length} onChange={(value) => update(index, value)}
              onRemove={() => setQuestions((list) => list.filter((_, i) => i !== index))} onMove={move} />
          ))}
          <button type="button" className="btn-secondary w-full" onClick={() => setQuestions((list) => [...list, blank()])}><PlusIcon className="h-4 w-4" />Add question</button>
        </div>
        <aside className="space-y-4">
          <section className="card card-pad space-y-4">
            <h2 className="text-base font-bold">Settings</h2>
            <label className="block"><span className="label">Title</span><input className="input" value={meta.title} onChange={(event) => setMeta({ ...meta, title: event.target.value })} /></label>
            <label className="block"><span className="label">Type</span>
              <select className="input" value={meta.assessmentType} disabled={Boolean(existing)} onChange={(event) => setMeta({ ...meta, assessmentType: event.target.value, moduleId: '' })}>
                <option value="module_quiz">Module quiz</option><option value="final_exam">Final examination</option>
                {existing?.assessmentType === 'legacy_quiz' && <option value="legacy_quiz">Legacy quiz</option>}
              </select></label>
            <Async state={courses}>{(rows) => (
              <label className="block"><span className="label">Course</span>
                <select className="input" value={meta.courseId} onChange={(event) => setMeta({ ...meta, courseId: event.target.value, moduleId: '' })}>
                  <option value="">Select a course</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}
                </select></label>
            )}</Async>
            {!final && (
              <label className="block"><span className="label">Module</span>
                <select className="input" value={meta.moduleId} disabled={!meta.courseId} onChange={(event) => setMeta({ ...meta, moduleId: event.target.value })}>
                  <option value="">Select a module</option>{modules.map((module) => <option key={module.id} value={module.id} disabled={Boolean(module.quiz) && module.quiz.id !== existing?.id}>{module.title}{module.quiz && module.quiz.id !== existing?.id ? ' (has a quiz)' : ''}</option>)}
                </select></label>
            )}
            {!final && <label className="block"><span className="label">Pass mark (%)</span><input type="number" min={1} max={100} className="input" value={meta.passPercent} onChange={(event) => setMeta({ ...meta, passPercent: event.target.value })} /></label>}
            <p className="text-sm text-ink-muted">{questions.length} question{questions.length === 1 ? '' : 's'} · {totalPoints} points{existing ? ` · currently ${existing.status.toLowerCase()}` : ''}</p>
            {error && <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}
            <div className="flex flex-col gap-2">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => save('published')}>{busy ? 'Saving…' : 'Save & publish'}</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => save('draft')}>Save as draft</button>
              <Link to={backTo} className="btn-ghost">Cancel</Link>
            </div>
          </section>
          {existing && (
            <section className="card card-pad space-y-3 border-danger/30" aria-label={`Delete ${kind}`}>
              <h2 className="text-base font-bold text-danger">Delete {kind}</h2>
              <p className="text-sm text-ink-muted">Removes “{existing.title}” and its questions only. {existing.attempts > 0 ? `It has ${existing.attempts} student attempt${existing.attempts === 1 ? '' : 's'}, which are kept, so it can only be moved to draft.` : 'No student has attempted it.'}</p>
              <button type="button" className="btn-danger w-full" disabled={busy} onClick={removeQuiz}><TrashIcon className="h-4 w-4" />Delete {kind}</button>
            </section>
          )}
        </aside>
      </div>
      {existing && (
        <Modal open={importOpen} onClose={() => setImportOpen(false)} wide title="Import Questions from Excel" subtitle={`Questions are added to “${existing.title}” after you confirm the preview.`}>
          <QuestionImportPanel exam={existing} onImported={imported} onCancel={() => setImportOpen(false)} />
        </Modal>
      )}
      <AssessmentPreview exam={previewing ? existing : null} onClose={() => setPreviewing(false)} />
    </>
  )
}
