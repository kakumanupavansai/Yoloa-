import { useEffect, useRef, useState } from 'react'
import { quizImagesApi } from '../../services/api'
import { Spinner } from '../ui/States'
import { CloseIcon, ImageIcon } from '../ui/Icons'

// Mirrors the server (lms/views.py validate_quiz_image); the server re-checks the real image content.
export const QUIZ_IMAGE_TYPES = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
export const MAX_QUIZ_IMAGE_BYTES = 5 * 1024 * 1024

export function checkQuizImage(file) {
  const ext = `.${file.name.split('.').pop()}`.toLowerCase()
  if (!QUIZ_IMAGE_TYPES.includes(ext)) return 'Use a JPG, PNG, GIF or WEBP image.'
  if (file.size > MAX_QUIZ_IMAGE_BYTES) return 'Images must be 5 MB or smaller.'
  if (!file.size) return 'The image file is empty.'
  return ''
}

/** A quiz image as students see it. Renders nothing for text-only content. */
export function QuizImage({ id, alt = '', className = 'max-h-72' }) {
  if (!id) return null
  return <img src={quizImagesApi.url(id)} alt={alt} loading="lazy" className={`w-auto max-w-full rounded-xl border border-line bg-surface object-contain ${className}`} />
}

/**
 * Upload / preview / remove one image. The file is uploaded as soon as it is chosen, and a local preview is shown
 * immediately; the question only stores the returned image id when the quiz is saved.
 */
export default function QuizImageField({ value, onChange, label, compact = false }) {
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])
  const choose = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = checkQuizImage(file)
    if (problem) { setError(problem); return }
    setError('')
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    try {
      const image = await quizImagesApi.upload(file)
      onChange(image.id)
    } catch (err) {
      setPreview('')
      setError((err.message || 'Upload failed.').replace(/^file: /, ''))
    } finally { setBusy(false) }
  }
  const remove = () => { setPreview(''); setError(''); onChange(null) }
  const src = preview || (value ? quizImagesApi.url(value) : '')
  return (
    <div className={compact ? 'shrink-0' : ''}>
      <input ref={input} type="file" accept={QUIZ_IMAGE_TYPES.join(',')} className="sr-only" onChange={choose} aria-label={`Upload ${label}`} tabIndex={-1} />
      {src ? (
        <div className={`relative inline-block ${compact ? '' : 'mt-2'}`}>
          <img src={src} alt={`${label} preview`} className={`${compact ? 'h-10 w-14' : 'max-h-44 max-w-full'} rounded-lg border border-line bg-surface object-contain`} />
          {busy && <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-scrim/40 text-white"><Spinner /></span>}
          <button type="button" onClick={remove} disabled={busy} aria-label={`Remove ${label}`}
            className="absolute -right-2 -top-2 rounded-full border border-line bg-surface p-1 text-ink-muted shadow hover:text-danger"><CloseIcon className="h-3 w-3" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          className={compact ? 'rounded-lg p-2 text-ink-muted hover:bg-ground hover:text-brand' : 'btn-ghost btn-sm mt-2'}
          aria-label={`Add ${label}`} title={`Add ${label}`}>
          {busy ? <Spinner /> : <ImageIcon className="h-4 w-4" />}{!compact && `Add ${label}`}
        </button>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}
