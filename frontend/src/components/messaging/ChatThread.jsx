import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { messagesApi } from '../../services/api'
import { newClientId, useMessaging } from '../../context/MessagingContext'
import Avatar from '../ui/Avatar'
import RichText from '../ui/RichText'
import { ErrorBox, Loading, Spinner } from '../ui/States'
import { AlertIcon, ArrowLeftIcon, CloseIcon, DownloadIcon, FileIcon, PaperclipIcon, SendIcon } from '../ui/Icons'

// Mirrors the server's limits (messaging/services.py); the server re-checks every file's real content.
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 5
export const MAX_BODY = 4000
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
const TYPING_SEND_MS = 3000
const TYPING_SHOW_MS = 4500

export const fmtSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const fmtTime = (value) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
const fmtDay = (value) => {
  const day = new Date(value)
  const today = new Date()
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1)
  if (day.toDateString() === today.toDateString()) return 'Today'
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(day)
}

// Adds messages by id (ignoring duplicates from the WebSocket, the HTTP response and offline recovery), kept in id order.
export function mergeMessages(current, incoming) {
  const byId = new Map(current.map((message) => [message.id, message]))
  incoming.forEach((message) => byId.set(message.id, message))
  return [...byId.values()].sort((a, b) => a.id - b.id)
}

export function checkFiles(files, already = 0) {
  const allowed = ACCEPT.split(',')
  if (files.length + already > MAX_FILES) return `Attach at most ${MAX_FILES} files per message.`
  for (const file of files) {
    const ext = `.${file.name.split('.').pop()}`.toLowerCase()
    if (!allowed.includes(ext)) return `"${file.name}" is not a supported file type.`
    if (file.size > MAX_FILE_BYTES) return `"${file.name}" is larger than 10 MB.`
    if (file.size === 0) return `"${file.name}" is empty.`
  }
  return ''
}

function Attachment({ item, mine }) {
  if (item.kind === 'image') {
    return (
      <a href={messagesApi.attachmentUrl(item)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl">
        <img src={messagesApi.attachmentUrl(item)} alt={item.name} loading="lazy" className="max-h-60 w-auto max-w-full rounded-xl object-cover" />
      </a>
    )
  }
  return (
    <a href={messagesApi.attachmentUrl(item, { download: true })}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${mine ? 'border-white/30 bg-white/10 hover:bg-white/20' : 'border-line bg-surface hover:bg-ground'}`}>
      <FileIcon className="h-5 w-5 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{item.name}</span><span className={`text-xs ${mine ? 'text-white/80' : 'text-ink-muted'}`}>{fmtSize(item.size)}</span></span>
      <DownloadIcon className="h-4 w-4 shrink-0" aria-label="Download" />
    </a>
  )
}

function Bubble({ message, mine, seen, pending, onRetry, onDiscard }) {
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[85%] flex-col sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
        <div className={`space-y-2 rounded-2xl px-3.5 py-2.5 text-sm ${mine ? 'rounded-br-md bg-brand text-white' : 'rounded-bl-md bg-ground text-ink'} ${pending?.status === 'sending' ? 'opacity-70' : ''}`}>
          {message.attachments?.map((item) => <Attachment key={item.id} item={item} mine={mine} />)}
          {pending?.files?.map((file) => <p key={file.name} className="flex items-center gap-1.5 text-xs"><PaperclipIcon className="h-3.5 w-3.5" />{file.name}</p>)}
          {message.body && <RichText text={message.body} />}
        </div>
        <p className="mt-1 flex items-center gap-2 px-1 text-[11px] text-ink-muted">
          {pending?.status === 'sending' && <>Sending…</>}
          {pending?.status === 'failed' && (
            <span className="flex items-center gap-1 text-danger" role="alert">
              <AlertIcon className="h-3.5 w-3.5" />{pending.error || 'Not sent.'}
              <button type="button" className="font-semibold underline" onClick={onRetry}>Retry</button>
              <button type="button" className="font-semibold underline" onClick={onDiscard}>Discard</button>
            </span>)}
          {!pending && <time dateTime={message.createdAt}>{fmtTime(message.createdAt)}</time>}
          {!pending && seen && <span className="font-semibold text-brand">Seen</span>}
        </p>
      </div>
    </div>
  )
}

export default function ChatThread({ conversationId, me }) {
  const messaging = useMessaging()
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [state, setState] = useState({ loading: true, error: null })
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [pending, setPending] = useState([])
  const [typingUntil, setTypingUntil] = useState(0)
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const scroller = useRef(null)
  const fileInput = useRef(null)
  const stickToBottom = useRef(true)
  const keepOffset = useRef(null)
  const lastReadSent = useRef(0)
  const lastTypingSent = useRef(0)
  // Newest id received from the server's history or push stream. The student's own sends (HTTP response or socket ack)
  // never move it: a message sent over HTTP while offline is newer than the messages missed meanwhile.
  const syncedUpTo = useRef(0)
  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const load = useCallback(async () => {
    setState({ loading: true, error: null })
    try {
      const [detail, page] = await Promise.all([messagesApi.conversation(conversationId), messagesApi.history(conversationId)])
      setConversation(detail)
      setMessages(page.results)
      syncedUpTo.current = page.results.length ? page.results[page.results.length - 1].id : 0
      setHasMore(page.hasMore)
      lastReadSent.current = detail.lastReadId
      stickToBottom.current = true
      setState({ loading: false, error: null })
    } catch (error) {
      setState({ loading: false, error })
    }
  }, [conversationId])
  useEffect(() => { load() }, [load])

  // Messages stored while the socket was down, for this conversation (also covers the gap before the first connect).
  const fetchNewer = useCallback(async () => {
    let after = syncedUpTo.current
    for (;;) {
      const page = await messagesApi.history(conversationId, { after, limit: 100 })
      if (page.results.length) setMessages((current) => mergeMessages(current, page.results))
      if (!page.hasMore || !page.results.length) break
      after = page.results[page.results.length - 1].id
    }
    syncedUpTo.current = Math.max(syncedUpTo.current, after)
    const detail = await messagesApi.conversation(conversationId)
    setConversation((current) => ({ ...detail, otherLastReadId: Math.max(detail.otherLastReadId, current?.otherLastReadId || 0) }))
  }, [conversationId])

  useEffect(() => messaging.subscribe((event) => {
    if (event.type === 'ready') { if (!state.loading) fetchNewer().catch(() => {}); return }
    if (event.type === 'message.new' && event.message.conversationId === conversationId) {
      const { message } = event
      syncedUpTo.current = Math.max(syncedUpTo.current, message.id)
      setMessages((current) => mergeMessages(current, [message]))
      if (message.clientId) setPending((current) => current.filter((item) => item.clientId !== message.clientId))
      if (message.sender.id !== me.id) setTypingUntil(0)
    }
    if (event.type === 'conversation.read' && event.conversationId === conversationId && event.userId !== me.id) {
      setConversation((current) => current && { ...current, otherLastReadId: Math.max(current.otherLastReadId, event.lastReadId) })
    }
    if (event.type === 'typing' && event.conversationId === conversationId && event.userId !== me.id) {
      setTypingUntil(Date.now() + TYPING_SHOW_MS)
    }
  }), [messaging, conversationId, me.id, fetchNewer, state.loading])

  useEffect(() => {
    if (!typingUntil) return undefined
    const timer = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()))
    return () => clearTimeout(timer)
  }, [typingUntil])

  // Mark the conversation read while it is on screen.
  useEffect(() => {
    const markIfVisible = () => {
      if (document.visibilityState !== 'visible') return
      const latestFromOther = [...messagesRef.current].reverse().find((message) => message.sender.id !== me.id)
      if (latestFromOther && latestFromOther.id > lastReadSent.current) {
        lastReadSent.current = latestFromOther.id
        messaging.markRead(conversationId, latestFromOther.id).catch(() => { lastReadSent.current = 0 })
      }
    }
    markIfVisible()
    document.addEventListener('visibilitychange', markIfVisible)
    return () => document.removeEventListener('visibilitychange', markIfVisible)
  }, [messages, conversationId, me.id, messaging])

  // Scrolling: follow new messages when already at the bottom; keep the position when older ones are prepended.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (keepOffset.current !== null) { el.scrollTop = el.scrollHeight - keepOffset.current; keepOffset.current = null; return }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [messages, pending, typingUntil, state.loading])
  const onScroll = () => {
    const el = scroller.current
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const loadOlder = async () => {
    if (!messages.length) return
    setLoadingOlder(true)
    try {
      const page = await messagesApi.history(conversationId, { before: messages[0].id })
      keepOffset.current = scroller.current.scrollHeight - scroller.current.scrollTop
      setMessages((current) => mergeMessages(current, page.results))
      setHasMore(page.hasMore)
    } catch (error) {
      setFileError(error.message || 'Could not load earlier messages.')
    } finally {
      setLoadingOlder(false)
    }
  }

  const deliver = async (item) => {
    setPending((current) => current.map((entry) => (entry.clientId === item.clientId ? { ...entry, status: 'sending', error: '' } : entry)))
    try {
      const message = item.files.length
        ? await messagesApi.send(conversationId, { body: item.body, clientId: item.clientId, files: item.files })
        : await messaging.sendMessage(conversationId, item.body, item.clientId)
      setMessages((current) => mergeMessages(current, [message]))
      setPending((current) => current.filter((entry) => entry.clientId !== item.clientId))
    } catch (error) {
      const offline = error instanceof TypeError
      setPending((current) => current.map((entry) => (entry.clientId === item.clientId
        ? { ...entry, status: 'failed', error: offline ? 'You are offline.' : error.message } : entry)))
    }
  }

  const submit = (event) => {
    event?.preventDefault()
    const body = text.trim()
    if ((!body && !files.length) || !conversation?.otherUser.available) return
    if (body.length > MAX_BODY) { setFileError(`Messages can be at most ${MAX_BODY} characters.`); return }
    const item = { clientId: newClientId(), body, files, status: 'sending', createdAt: new Date().toISOString() }
    setPending((current) => [...current, item])
    setText('')
    setFiles([])
    setFileError('')
    stickToBottom.current = true
    deliver(item)
  }

  const onPick = (event) => {
    const picked = [...event.target.files]
    event.target.value = ''
    const problem = checkFiles(picked, files.length)
    setFileError(problem)
    if (!problem) setFiles((current) => [...current, ...picked])
  }

  const onType = (event) => {
    setText(event.target.value)
    if (event.target.value && Date.now() - lastTypingSent.current > TYPING_SEND_MS) {
      lastTypingSent.current = Date.now()
      messaging.sendTyping(conversationId)
    }
  }

  if (state.loading && !conversation) return <Loading label="Loading conversation…" />
  if (state.error) {
    return (
      <div className="p-4">
        <Link to="/student/messages" className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-brand lg:hidden"><ArrowLeftIcon className="h-4 w-4" />All conversations</Link>
        <ErrorBox error={state.error} onRetry={state.error.status === 404 ? undefined : load} title={state.error.status === 404 ? 'Conversation not found' : 'Could not load this conversation'} />
      </div>
    )
  }

  const other = conversation.otherUser
  const myLastId = [...messages].reverse().find((message) => message.sender.id === me.id)?.id
  const typing = typingUntil > Date.now()
  let lastDay = ''

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-5">
        <Link to="/student/messages" aria-label="All conversations" className="flex h-10 w-10 items-center justify-center rounded-xl text-brand hover:bg-brand-soft lg:hidden"><ArrowLeftIcon className="h-5 w-5" /></Link>
        <Avatar src={other.avatar} name={other.name} size={40} />
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{other.name}</h2>
          <p className="truncate text-xs text-ink-muted" aria-live="polite">{typing ? 'typing…' : `@${other.username}`}</p>
        </div>
      </header>

      {messaging.enabled && messaging.status !== 'open' && (
        <p className="border-b border-line bg-warning-soft px-4 py-2 text-xs font-semibold text-warning" role="status">
          {messaging.status === 'connecting' ? 'Connecting…' : 'Reconnecting… new messages will appear as soon as the connection is back. You can still send.'}
        </p>)}

      <div ref={scroller} onScroll={onScroll} className="scroll-thin flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-5" aria-label={`Messages with ${other.name}`} role="log">
        {hasMore && (
          <div className="text-center">
            <button type="button" className="btn-ghost btn-sm" onClick={loadOlder} disabled={loadingOlder}>{loadingOlder ? <Spinner /> : null}Load earlier messages</button>
          </div>)}
        {!messages.length && !pending.length && <p className="py-10 text-center text-sm text-ink-muted">No messages yet. Say hello to {other.name}!</p>}
        {messages.map((message) => {
          const day = fmtDay(message.createdAt)
          const divider = day !== lastDay
          lastDay = day
          const mine = message.sender.id === me.id
          return (
            <div key={message.id}>
              {divider && <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{day}</p>}
              <Bubble message={message} mine={mine} seen={mine && message.id === myLastId && conversation.otherLastReadId >= message.id} />
            </div>
          )
        })}
        {pending.map((item) => (
          <Bubble key={item.clientId} message={{ body: item.body, attachments: [] }} mine pending={item}
            onRetry={() => deliver(item)} onDiscard={() => setPending((current) => current.filter((entry) => entry.clientId !== item.clientId))} />
        ))}
        {typing && <p className="px-1 text-xs italic text-ink-muted">{other.name} is typing…</p>}
      </div>

      {other.available ? (
        <form onSubmit={submit} className="border-t border-line p-3 sm:p-4">
          {files.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-2" aria-label="Attachments to send">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`} className="badge-brand gap-1.5 py-1">
                  <PaperclipIcon className="h-3.5 w-3.5" /><span className="max-w-[160px] truncate">{file.name}</span><span className="font-normal">{fmtSize(file.size)}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}><CloseIcon className="h-3.5 w-3.5" /></button>
                </li>))}
            </ul>)}
          {fileError && <p className="mb-2 text-xs font-semibold text-danger" role="alert">{fileError}</p>}
          <div className="flex items-end gap-2">
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={onPick} data-testid="attachment-input" />
            <button type="button" onClick={() => fileInput.current?.click()} aria-label="Attach files" title="Attach images or documents (max 10 MB each)"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-soft hover:bg-ground"><PaperclipIcon className="h-5 w-5" /></button>
            <label htmlFor="message-input" className="sr-only">Message {other.name}</label>
            <textarea id="message-input" rows={1} value={text} onChange={onType} maxLength={MAX_BODY} placeholder={`Message ${other.name}`}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event) }}
              className="input max-h-36 min-h-[44px] resize-none" />
            <button type="submit" aria-label="Send message" disabled={!text.trim() && !files.length}
              className="btn-primary h-11 w-11 shrink-0 px-0"><SendIcon className="h-5 w-5" /></button>
          </div>
        </form>
      ) : (
        <p className="border-t border-line p-4 text-sm text-ink-muted">{other.name} can no longer receive messages. The conversation history stays available.</p>
      )}
    </>
  )
}
