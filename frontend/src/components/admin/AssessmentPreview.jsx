import { Link } from 'react-router-dom'
import { useApi } from '../../hooks'
import { examsApi } from '../../services/api'
import { Modal } from '../ui/Feedback'
import { Async } from '../ui/States'
import { CheckIcon } from '../ui/Icons'

const LETTERS = 'ABCDEFGH'
const TYPE_LABELS = { single: 'Single choice', multiple: 'Multiple correct', true_false: 'True / false', short: 'Short answer' }

function isCorrect(question, index) {
  if (question.questionType === 'true_false') return (index === 0) === Boolean(question.correctAnswers?.[0])
  return (question.correctAnswers || []).includes(index)
}

// Read-only administrator preview of a quiz or final exam, with the answer key marked. Students never receive this data.
function PreviewBody({ examId }) {
  const state = useApi(() => examsApi.get(examId), [examId])
  return (
    <Async state={state} label="Loading questions…">{(exam) => (
      <div className="space-y-4">
        <p className="text-sm text-ink-muted">
          {exam.assessmentTypeLabel} · {exam.status} · {exam.questions.length} question{exam.questions.length === 1 ? '' : 's'} · {exam.points} points ·
          pass mark {exam.passPercent}%{exam.assessmentType === 'final_exam' ? ' · 10 minutes' : ''}
        </p>
        {!exam.questions.length && <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">No questions yet.</p>}
        <ol className="space-y-3">
          {exam.questions.map((question, number) => {
            const choices = question.questionType === 'true_false' ? ['True', 'False'] : question.choices
            return (
              <li key={question.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"><span className="font-bold text-ink">Question {number + 1}</span><span className="badge">{TYPE_LABELS[question.questionType]}</span>{question.points} pt{question.points === 1 ? '' : 's'}</div>
                <p className="mt-2 font-medium">{question.text}</p>
                {question.questionType === 'short' ? (
                  <p className="mt-2 text-sm"><span className="text-ink-muted">Expected answer:</span> <span className="font-semibold">{question.expectedAnswer}</span>
                    {question.acceptedAlternatives?.length > 0 && <span className="text-ink-muted"> (also accepts {question.acceptedAlternatives.join(', ')})</span>}</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {choices.map((choice, index) => (
                      <li key={index} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${isCorrect(question, index) ? 'bg-success-soft font-semibold text-success' : ''}`}>
                        <span className="w-5 font-bold">{LETTERS[index]}</span>{choice}
                        {isCorrect(question, index) && <><CheckIcon className="h-4 w-4" /><span className="sr-only">(correct)</span></>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    )}</Async>
  )
}

export default function AssessmentPreview({ exam, onClose }) {
  return (
    <Modal open={Boolean(exam)} onClose={onClose} wide title={exam ? `Preview: ${exam.title}` : 'Preview'} subtitle="Read-only view with the answer key. Students never see the correct answers before submitting."
      footer={<>
        <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
        {exam && <Link to={`/admin/exams/${exam.id}`} className="btn-primary">Edit questions</Link>}
      </>}>
      {exam && <PreviewBody examId={exam.id} />}
    </Modal>
  )
}
