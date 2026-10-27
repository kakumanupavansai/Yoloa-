import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useMessaging } from '../../context/MessagingContext'
import { useDebounced } from '../../hooks'
import { messagesApi } from '../../services/api'
import ChatThread from '../../components/messaging/ChatThread'
import Avatar from '../../components/ui/Avatar'
import { ErrorBox, EmptyState, Loading, Spinner } from '../../components/ui/States'
import { ChatIcon, PaperclipIcon, SearchIcon } from '../../components/ui/Icons'

const fmtWhen = (value) => {
  if (!value) return ''
  const date = new Date(value)
  return date.toDateString() === new Date().toDateString()
    ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

const preview = (message, meId) => {
  if (!message) return 'No messages yet'
  const who = message.sender.id === meId ? 'You: ' : ''
  if (message.body) return `${who}${message.body}`
  return `${who}${message.attachments.length === 1 ? message.attachments[0].name : `${message.attachments.length} attachments`}`
}

// Applies a pushed message to the conversation list: newest conversation first, unread counted for the others.
export function applyMessage(rows, message, { meId, activeId }) {
  const index = rows.findIndex((row) => row.id === message.conversationId)
  if (index < 0) return null
  const row = rows[index]
  if (row.lastMessage && row.lastMessage.id >= message.id) return rows
  const counts = message.sender.id !== meId && message.conversationId !== activeId && message.id > row.lastReadId
  const updated = { ...row, lastMessage: message, lastMessageAt: message.createdAt, unreadCount: row.unreadCount + (counts ? 1 : 0) }
  return [updated, ...rows.slice(0, index), ...rows.slice(index + 1)]
}

function StudentSearch({ onPick, busyId }) {
  const [q, setQ] = useState('')
  const term = useDebounced(q.trim(), 250)
  const [result, setResult] = useState({ loading: false, error: null, rows: [] })
  useEffect(() => {
    if (term.length < 2) { setResult({ loading: false, error: null, rows: [] }); return undefined }
    let live = true
    setResult((current) => ({ ...current, loading: true, error: null }))
    messagesApi.searchStudents(term)
      .then((data) => { if (live) setResult({ loading: false, error: null, rows: data.results }) })
      .catch((error) => { if (live) setResult({ loading: false, error, rows: [] }) })
    return () => { live = false }
  }, [term])
  const searching = q.trim().length >= 2
  return (
    <div className="border-b border-line p-3">
      <label className="relative block">
        <span className="sr-only">Search students</span>
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search students by name or username"
          className="input pl-9" aria-label="Search students" />
      </label>
      {searching && (
        <div className="mt-2" aria-live="polite">
          {result.loading && <p className="flex items-center gap-2 px-1 py-2 text-xs text-ink-muted"><Spinner />Searching…</p>}
          {result.error && <p className="px-1 py-2 text-xs text-danger" role="alert">{result.error.message || 'Search failed.'}</p>}
          {!result.loading && !result.error && term.length >= 2 && !result.rows.length && <p className="px-1 py-2 text-xs text-ink-muted">No students match “{term}”.</p>}
          <ul aria-label="Students">
            {result.rows.map((person) => (
              <li key={person.id}>
                <button type="button" onClick={() => { onPick(person); setQ('') }} disabled={busyId === person.id}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-ground disabled:opacity-60">
                  <Avatar src={person.avatar} name={person.name} size={36} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{person.name}</span><span className="block truncate text-xs text-ink-muted">@{person.username}</span></span>
                  <span className="text-xs font-semibold text-brand">{person.conversationId ? 'Open' : 'Message'}</span>
                </button>
              </li>))}
          </ul>
        </div>)}
    </div>
  )
}

export default function Messages() {
  const { conversationId } = useParams()
  const activeId = conversationId ? Number(conversationId) : null
  const { user } = useAuth()
  const messaging = useMessaging()
  const navigate = useNavigate()
  const [list, setList] = useState({ loading: true, error: null, rows: [] })
  const [opening, setOpening] = useState(null)
  const [openError, setOpenError] = useState('')
  const rowsRef = useRef(list.rows)
  rowsRef.current = list.rows

  const load = useCallback(() => messagesApi.conversations()
    .then((data) => setList({ loading: false, error: null, rows: data.results }))
    .catch((error) => setList((current) => ({ ...current, loading: false, error }))), [])
  useEffect(() => { load() }, [load])

  useEffect(() => messaging.subscribe((event) => {
    if (event.type === 'ready') { load(); return }
    if (event.type === 'message.new') {
      // A message in a conversation this list has not loaded yet (a new conversation): reload the list.
      if (!rowsRef.current.some((row) => row.id === event.message.conversationId)) { load(); return }
      setList((current) => ({ ...current, rows: applyMessage(current.rows, event.message, { meId: user.id, activeId }) || current.rows }))
    }
    if (event.type === 'conversation.read') {
      setList((current) => ({ ...current, rows: current.rows.map((row) => {
        if (row.id !== event.conversationId) return row
        return event.userId === user.id
          ? { ...row, lastReadId: Math.max(row.lastReadId, event.lastReadId), unreadCount: 0 }
          : { ...row, otherLastReadId: Math.max(row.otherLastReadId, event.lastReadId) }
      }) }))
    }
  }), [messaging, load, user.id, activeId])

  // Opening a conversation clears its badge immediately; the server confirms through the read event.
  useEffect(() => {
    if (activeId) setList((current) => ({ ...current, rows: current.rows.map((row) => (row.id === activeId ? { ...row, unreadCount: 0 } : row)) }))
  }, [activeId])

  const pick = async (person) => {
    setOpenError('')
    if (person.conversationId) { navigate(`/student/messages/${person.conversationId}`); return }
    setOpening(person.id)
    try {
      const conversation = await messagesApi.open(person.id)
      navigate(`/student/messages/${conversation.id}`)
    } catch (error) {
      setOpenError(error.message || 'Could not start the conversation.')
    } finally {
      setOpening(null)
    }
  }

  return (
    <div className="card flex h-[calc(100dvh-7.5rem)] min-h-[460px] overflow-hidden lg:h-[calc(100dvh-6.5rem)]">
      <aside className={`${activeId ? 'hidden lg:flex' : 'flex'} w-full shrink-0 flex-col border-line lg:w-80 lg:border-r xl:w-96`} aria-label="Conversations">
        <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-4">
          <h1 className="text-xl font-extrabold tracking-tight">Messages</h1>
          {messaging.enabled && (
            <span className={`badge ${messaging.status === 'open' ? 'badge-success' : 'badge-warning'}`} role="status">
              {messaging.status === 'open' ? 'Live' : messaging.status === 'connecting' ? 'Connecting…' : 'Offline'}
            </span>)}
        </div>
        <StudentSearch onPick={pick} busyId={opening} />
        {openError && <p className="px-4 pt-2 text-xs text-danger" role="alert">{openError}</p>}
        <div className="scroll-thin flex-1 overflow-y-auto p-2">
          {list.loading && !list.rows.length && <Loading label="Loading conversations…" />}
          {list.error && <ErrorBox error={list.error} onRetry={load} title="Could not load conversations" />}
          {!list.loading && !list.error && !list.rows.length && (
            <EmptyState title="No conversations yet" icon={ChatIcon}>Search for a classmate above to send your first message.</EmptyState>)}
          <ul>
            {list.rows.map((row) => {
              const active = row.id === activeId
              return (
                <li key={row.id}>
                  <button type="button" onClick={() => navigate(`/student/messages/${row.id}`)} aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition ${active ? 'bg-brand-soft' : 'hover:bg-ground'}`}>
                    <Avatar src={row.otherUser.avatar} name={row.otherUser.name} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${row.unreadCount ? 'font-extrabold' : 'font-semibold'}`}>{row.otherUser.name}</span>
                        <span className="shrink-0 text-[11px] text-ink-muted">{fmtWhen(row.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`flex min-w-0 items-center gap-1 truncate text-xs ${row.unreadCount ? 'font-semibold text-ink' : 'text-ink-muted'}`}>
                          {row.lastMessage && !row.lastMessage.body && <PaperclipIcon className="h-3 w-3 shrink-0" />}
                          <span className="truncate">{preview(row.lastMessage, user.id)}</span>
                        </span>
                        {row.unreadCount > 0 && <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white" aria-label={`${row.unreadCount} unread`}>{row.unreadCount}</span>}
                      </span>
                    </span>
                  </button>
                </li>)
            })}
          </ul>
        </div>
      </aside>
      <section className={`${activeId ? 'flex' : 'hidden lg:flex'} min-w-0 flex-1 flex-col`} aria-label="Conversation">
        {activeId
          ? <ChatThread key={activeId} conversationId={activeId} me={user} />
          : <div className="m-auto"><EmptyState title="Select a conversation" icon={ChatIcon}>Choose a conversation on the left, or search for a student to start a new one.</EmptyState></div>}
      </section>
    </div>
  )
}
