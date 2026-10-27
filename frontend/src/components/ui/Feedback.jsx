// Modal dialog, toast notifications and promise-based confirmation, shared across the app.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon } from './Icons'

export function Modal({ open, title, subtitle, onClose, children, footer, wide = false }) {
  const titleId = useId()
  const panel = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const onKey = (event) => { if (event.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = panel.current?.querySelector('input, select, textarea, button:not([data-close])')
    ;(first || panel.current)?.focus()
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; opener?.focus?.() }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-pop outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}>
        <header className="flex items-start gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
          </div>
          <button type="button" data-close onClick={onClose} aria-label="Close dialog" className="-mr-2 rounded-lg p-2 text-ink-muted hover:bg-ground"><CloseIcon /></button>
        </header>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">{footer}</footer>}
      </section>
    </div>
  )
}

const FeedbackContext = createContext(null)
// Outside the provider (isolated component tests) fall back to no-op toasts and native confirm.
const fallback = { toast: () => {}, confirm: ({ message }) => Promise.resolve(window.confirm(message)) }
export const useToast = () => (useContext(FeedbackContext) || fallback).toast
export const useConfirm = () => (useContext(FeedbackContext) || fallback).confirm

const toastTone = {
  success: ['border-success/30 bg-success-soft text-success', CheckCircleIcon],
  error: ['border-danger/30 bg-danger-soft text-danger', AlertIcon],
  info: ['border-brand/20 bg-brand-soft text-brand-dark', InfoIcon],
}

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const toast = useCallback((message, tone = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((items) => [...items, { id, message, tone }])
    setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4000)
  }, [])
  const confirm = useCallback((options) => new Promise((resolve) => setDialog({ ...options, resolve })), [])
  const close = (answer) => { dialog?.resolve(answer); setDialog(null) }
  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:items-end" aria-live="polite">
        {toasts.map(({ id, message, tone }) => {
          const [style, Icon] = toastTone[tone] || toastTone.info
          return <div key={id} role={tone === 'error' ? 'alert' : 'status'} className={`pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border px-4 py-3 text-sm font-medium shadow-pop ${style}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" />{message}</div>
        })}
      </div>
      <Modal open={Boolean(dialog)} title={dialog?.title || 'Are you sure?'} onClose={() => close(false)}
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => close(false)}>{dialog?.cancelLabel || 'Cancel'}</button>
          <button type="button" className={dialog?.tone === 'danger' ? 'btn bg-danger text-white hover:opacity-90' : 'btn-primary'} onClick={() => close(true)}>{dialog?.confirmLabel || 'Confirm'}</button>
        </>}>
        <p className="text-sm leading-relaxed text-ink-soft">{dialog?.message}</p>
      </Modal>
    </FeedbackContext.Provider>
  )
}
