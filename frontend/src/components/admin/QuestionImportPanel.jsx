import { useRef, useState } from 'react'
import { adminApi } from '../../services/api'
import { Spinner } from '../ui/States'
import { AlertIcon, CheckCircleIcon } from '../ui/Icons'

export const IMPORT_FIELDS = [
  ['questionType', 'Question type', 'single, multiple, true_false or short', true],
  ['questionText', 'Question text', '', true],
  ['options', 'Options', 'separated by | ; or ,', false],
  ['correctAnswer', 'Correct answer', 'A–H, 1-based number, option text, true/false, or the expected short answer', false],
  ['marks', 'Marks', 'points for the question', true],
  ['acceptedAlternatives', 'Accepted alternatives', 'short answers only', false],
]
const ALIASES = {
  questionType: ['type', 'questiontype', 'qtype'],
  questionText: ['question', 'questiontext', 'text', 'prompt'],
  options: ['options', 'choices', 'answers'],
  correctAnswer: ['answer', 'correct', 'correctanswer', 'correctanswers', 'key'],
  marks: ['marks', 'mark', 'points', 'score'],
  acceptedAlternatives: ['alsoaccept', 'acceptedalternatives', 'alternatives', 'accepted', 'acceptedanswers'],
}
const TYPE_LABELS = { single: 'Single choice', multiple: 'Multiple correct', true_false: 'True / false', short: 'Short answer' }
const LETTERS = 'ABCDEFGH'
const squash = (text) => String(text).toLowerCase().replace(/[^a-z0-9]/g, '')

// Pre-select columns whose header matches a known name; the administrator can change every choice.
export function guessMapping(headers) {
  return Object.fromEntries(IMPORT_FIELDS.map(([field]) => [field, headers.find((header) => ALIASES[field].includes(squash(header))) || '']))
}

function answerText(question) {
  if (question.questionType === 'short') return [question.expectedAnswer, ...(question.acceptedAlternatives || [])].join(' / ')
  if (question.questionType === 'true_false') return question.correctAnswers?.[0] ? 'True' : 'False'
  return (question.correctAnswers || []).map((index) => `${LETTERS[index]}. ${question.choices[index]}`).join(', ')
}

/**
 * Staged Excel import: upload → map columns → server-side validation preview → explicit, idempotent confirmation.
 * With `exam` the target assessment is fixed (assessment edit page); otherwise `exams` provides a selector.
 */
export default function QuestionImportPanel({ exam, exams, onImported, onCancel }) {
  const [examId, setExamId] = useState(exam ? String(exam.id) : '')
  const [file, setFile] = useState(null)
  const [batch, setBatch] = useState(null)
  const [mapping, setMapping] = useState({})
  const [sheet, setSheet] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const fileInput = useRef(null)
  // One key per uploaded batch, so retrying a confirmation that timed out can never import twice.
  const idempotencyKey = useRef('')

  const headers = batch?.sheets.find((item) => item.name === sheet)?.headers.filter(Boolean) || []
  // A ref, not state, guards against a second click that lands before React re-renders the disabled button.
  const inFlight = useRef(false)
  const run = async (label, fn) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(label); setError(null)
    try { await fn() } catch (err) { setError(err) } finally { inFlight.current = false; setBusy('') }
  }
  const reset = () => {
    setBatch(null); setPreview(null); setFile(null); setMapping({}); setSheet(''); setError(null)
    if (fileInput.current) fileInput.current.value = ''
  }
  const chooseFile = (event) => {
    const selected = event.target.files[0] || null
    setBatch(null); setPreview(null); setDone(null); setError(null)
    if (selected && !selected.name.toLowerCase().endsWith('.xlsx')) { setFile(null); setError({ message: 'Choose an Excel workbook saved as .xlsx.' }); return }
    if (selected && selected.size > 5 * 1024 * 1024) { setFile(null); setError({ message: 'The workbook must be 5 MB or smaller.' }); return }
    setFile(selected)
  }
  const upload = (event) => {
    event.preventDefault()
    run('upload', async () => {
      const body = new FormData()
      body.append('file', file)
      body.append('examId', examId)
      const value = await adminApi.uploadQuestions(body)
      const first = value.sheets.find((item) => item.rows > 0) || value.sheets[0]
      idempotencyKey.current = crypto.randomUUID()
      setBatch(value); setSheet(first?.name || ''); setMapping(guessMapping(first?.headers || [])); setPreview(null)
    })
  }
  const selectSheet = (name) => {
    setSheet(name); setPreview(null)
    setMapping(guessMapping(batch.sheets.find((item) => item.name === name)?.headers || []))
  }
  const missing = IMPORT_FIELDS.filter(([field, , , required]) => required && !mapping[field]).map(([, label]) => label)
  const validate = () => run('preview', async () => { setPreview(await adminApi.previewQuestions(batch.batchId, { sheet, mapping })) })
  const confirm = () => run('confirm', async () => {
    const value = await adminApi.confirmQuestions(batch.batchId, idempotencyKey.current)
    setDone({ imported: value.imported, title: batch.exam?.title }); reset()
    onImported?.(value)
  })

  // DRF field errors arrive as "file: …"; show just the sentence.
  const errorText = (error?.message || '').replace(/^(file|mapping|examId|courseId|idempotencyKey|message): /, '')
  return (
    <div className="space-y-5">
      {done && (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success">
          <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />Imported {done.imported} question{done.imported === 1 ? '' : 's'}{done.title ? ` into “${done.title}”` : ''}.
        </p>
      )}
      <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2" aria-label="Upload a question workbook">
        {exam ? (
          <div><span className="label">Target assessment</span><p className="rounded-xl bg-ground px-3.5 py-2.5 text-sm font-semibold">{exam.title}</p></div>
        ) : (
          <label><span className="label">Target assessment</span>
            <select className="input" value={examId} onChange={(event) => { setExamId(event.target.value); setBatch(null); setPreview(null) }} required>
              <option value="">Select an assessment</option>
              {(exams || []).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.assessmentTypeLabel}{item.courseTitle ? ` · ${item.courseTitle}` : ''}</option>)}
            </select></label>
        )}
        <label><span className="label">Excel workbook (.xlsx, up to 5 MB)</span>
          <input ref={fileInput} className="input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={chooseFile} /></label>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <button className="btn-primary" type="submit" disabled={Boolean(busy) || !file || !examId}>{busy === 'upload' ? <><Spinner />Reading workbook…</> : batch ? 'Upload again' : 'Upload workbook'}</button>
          {onCancel && <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy === 'confirm'}>Close</button>}
          <p className="hint mt-0">The first row of the worksheet must contain column headings. Nothing is saved until you confirm the preview.</p>
        </div>
      </form>

      {errorText && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"><AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />{errorText}</p>
      )}

      {batch && (
        <section className="space-y-4 rounded-2xl border border-line p-4" aria-label="Map columns">
          <div className="flex flex-wrap items-end gap-4">
            <label className="min-w-[220px] flex-1"><span className="label">Worksheet</span>
              <select className="input" value={sheet} onChange={(event) => selectSheet(event.target.value)}>
                {batch.sheets.map((item) => <option key={item.name} value={item.name}>{item.name} ({item.rows} rows)</option>)}
              </select></label>
            {batch.exam && <p className="text-sm text-ink-muted">“{batch.exam.title}” currently has {batch.exam.questionCount} question{batch.exam.questionCount === 1 ? '' : 's'}.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map(([field, label, hint, required]) => (
              <label key={field}><span className="label">{label}{required ? ' *' : ''}{hint && <span className="ml-1 font-normal text-ink-muted">({hint})</span>}</span>
                <select className="input" value={mapping[field] || ''} onChange={(event) => { setMapping({ ...mapping, [field]: event.target.value }); setPreview(null) }}>
                  <option value="">Not mapped</option>{headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select></label>
            ))}
          </div>
          {missing.length > 0 && <p className="text-sm text-warning">Map the required columns: {missing.join(', ')}.</p>}
          <button type="button" className="btn-secondary" disabled={Boolean(busy) || missing.length > 0} onClick={validate}>{busy === 'preview' ? <><Spinner />Validating…</> : 'Validate and preview'}</button>
        </section>
      )}

      {batch && preview && (
        <section className="space-y-4 rounded-2xl bg-ground p-4" aria-label="Import preview">
          <p className="text-sm font-semibold">{preview.validCount} valid · {preview.invalidCount} with errors{preview.blankRows?.length ? ` · ${preview.blankRows.length} blank row${preview.blankRows.length === 1 ? '' : 's'} ignored (${preview.blankRows.join(', ')})` : ''}</p>
          {preview.errors.length > 0 && (
            <div role="alert">
              <p className="text-sm text-danger">Fix these rows in the workbook and upload it again. Nothing is imported while any row has an error.</p>
              <ul className="mt-2 max-h-48 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-danger">{preview.errors.map((item) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}</ul>
            </div>
          )}
          {preview.preview.length > 0 && (
            <div className="max-h-80 overflow-auto rounded-xl border border-line bg-white">
              <table className="table min-w-[640px]">
                <thead><tr><th>#</th><th>Type</th><th>Question</th><th>Correct answer</th><th>Points</th></tr></thead>
                <tbody>{preview.preview.map((question, index) => (
                  <tr key={`${index}-${question.text}`}>
                    <td className="text-ink-muted">{index + 1}</td>
                    <td><span className="badge">{TYPE_LABELS[question.questionType] || question.questionType}</span></td>
                    <td><span className="font-medium">{question.text}</span>{question.choices.length > 0 && question.questionType !== 'true_false' && <span className="block text-xs text-ink-muted">{question.choices.map((choice, k) => `${LETTERS[k]}. ${choice}`).join('   ')}</span>}</td>
                    <td className="text-sm">{answerText(question)}</td>
                    <td>{question.points}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <button type="button" className="btn-primary" disabled={Boolean(busy) || preview.invalidCount > 0 || preview.validCount === 0} onClick={confirm}>
            {busy === 'confirm' ? <><Spinner />Importing…</> : `Confirm import of ${preview.validCount} question${preview.validCount === 1 ? '' : 's'}`}
          </button>
        </section>
      )}
    </div>
  )
}
