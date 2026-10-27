// Student messaging UI (Vitest fixture mode). The HTTP layer is spied on with the Django response shapes and the
// WebSocket is a fake installed through setSocketFactory, so no network or Redis is involved here.
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { setSocketFactory } from '../context/MessagingContext'
import { checkFiles, mergeMessages } from '../components/messaging/ChatThread'
import { applyMessage } from '../pages/student/Messages'
import { messagesApi } from '../services/api'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
const ME = 's1'
const BOB = { id: 's2', name: 'Bob Bose', username: 'bob', avatar: '', available: true }
const msg = (id, over = {}) => ({ id, conversationId: 7, sender: { id: 's2', name: 'Bob Bose' }, body: `message ${id}`, clientId: null,
  createdAt: new Date(2026, 9, 25, 10, id).toISOString(), attachments: [], ...over })
const conversation = (over = {}) => ({ id: 7, otherUser: BOB, lastMessage: msg(5), unreadCount: 0, lastReadId: 4, otherLastReadId: 0,
  lastMessageAt: msg(5).createdAt, createdAt: msg(1).createdAt, ...over })

let sockets = []
class FakeSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.sent = []
    sockets.push(this)
  }
  open(lastMessageId) { this.readyState = 1; this.onopen?.(); this.push({ type: 'ready', userId: ME, lastMessageId }) }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() { this.readyState = 3 }
  push(event) { act(() => { this.onmessage?.({ data: JSON.stringify(event) }) }) }
  drop() { this.readyState = 3; act(() => { this.onclose?.({ code: 1006 }) }) }
}

const open = (path) => {
  localStorage.setItem('yoloa_role', 'student')
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}

beforeEach(() => {
  localStorage.clear()
  sockets = []
  setSocketFactory((url) => new FakeSocket(url))
})
afterEach(() => { setSocketFactory(null); vi.restoreAllMocks() })

describe('messaging helpers', () => {
  it('merges messages by id in order and ignores duplicates', () => {
    const merged = mergeMessages([msg(1), msg(3)], [msg(2), msg(3, { body: 'same id' }), msg(1)])
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3])
  })
  it('checks attachment count, type and size before upload', () => {
    const file = (name, size = 10) => ({ name, size })
    expect(checkFiles([file('a.png'), file('b.PDF')])).toBe('')
    expect(checkFiles([file('run.exe')])).toMatch(/not a supported/)
    expect(checkFiles([file('big.pdf', 11 * 1024 * 1024)])).toMatch(/larger than 10 MB/)
    expect(checkFiles([file('a.txt')], 5)).toMatch(/at most 5/)
  })
  it('moves a conversation to the top and counts unread only for others', () => {
    const rows = [conversation({ id: 1 }), conversation({ id: 7 })]
    const updated = applyMessage(rows, msg(9), { meId: ME, activeId: null })
    expect(updated.map((r) => r.id)).toEqual([7, 1])
    expect(updated[0].unreadCount).toBe(1)
    expect(applyMessage(rows, msg(9), { meId: ME, activeId: 7 })[0].unreadCount).toBe(0)
    expect(applyMessage(rows, msg(9, { sender: { id: ME, name: 'Me' } }), { meId: ME, activeId: null })[0].unreadCount).toBe(0)
    expect(applyMessage(rows, msg(9, { conversationId: 99 }), { meId: ME, activeId: null })).toBeNull()
  })
})

describe.skipIf(!MOCK)('messages page', () => {
  const spies = (history = [msg(4, { sender: { id: ME, name: 'Test Learner' } }), msg(5)]) => {
    vi.spyOn(messagesApi, 'conversations').mockResolvedValue({ results: [conversation()] })
    vi.spyOn(messagesApi, 'conversation').mockResolvedValue(conversation())
    vi.spyOn(messagesApi, 'history').mockImplementation((id, params = {}) => Promise.resolve(params.after ? { results: [], hasMore: false } : { results: history, hasMore: false }))
    vi.spyOn(messagesApi, 'unread').mockResolvedValue({ unread: 2 })
    vi.spyOn(messagesApi, 'markRead').mockResolvedValue({ conversationId: 7, lastReadId: 5 })
    return { sync: vi.spyOn(messagesApi, 'sync').mockResolvedValue({ results: [], hasMore: false }), send: vi.spyOn(messagesApi, 'send') }
  }

  it('shows history, receives messages in real time, marks them read and sends over the socket', async () => {
    spies()
    const user = userEvent.setup()
    open('/student/messages/7')
    const log = await screen.findByRole('log', { name: 'Messages with Bob Bose' })
    expect(within(log).getByText('message 5')).toBeInTheDocument()
    await waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].open(5)
    expect(await screen.findByText('Live')).toBeInTheDocument()
    expect(await screen.findByLabelText('2 unread messages')).toBeInTheDocument()

    sockets[0].push({ type: 'message.new', message: msg(6, { body: 'pushed live' }) })
    expect(await within(log).findByText('pushed live')).toBeInTheDocument()
    await waitFor(() => expect(sockets[0].sent).toContainEqual({ type: 'conversation.read', conversationId: 7, messageId: 6 }))

    await user.type(screen.getByLabelText('Message Bob Bose'), 'Hi Bob{Enter}')
    const outgoing = sockets[0].sent.find((frame) => frame.type === 'message.send')
    expect(outgoing).toMatchObject({ conversationId: 7, body: 'Hi Bob' })
    expect(outgoing.clientId).toMatch(/^[0-9a-f-]{36}$/)
    expect(within(log).getByText('Sending…')).toBeInTheDocument()
    sockets[0].push({ type: 'message.ack', clientId: outgoing.clientId, message: msg(7, { body: 'Hi Bob', clientId: outgoing.clientId, sender: { id: ME, name: 'Test Learner' } }) })
    await waitFor(() => expect(within(log).queryByText('Sending…')).not.toBeInTheDocument())
    expect(within(log).getAllByText('Hi Bob')).toHaveLength(1)
    sockets[0].push({ type: 'conversation.read', conversationId: 7, userId: 's2', lastReadId: 7 })
    expect(await within(log).findByText('Seen')).toBeInTheDocument()
  })

  it('reconnects after a drop and recovers messages stored while offline', async () => {
    const { sync } = spies()
    open('/student/messages/7')
    await screen.findByRole('log', { name: 'Messages with Bob Bose' })
    await waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].open(5)
    sockets[0].drop()
    expect(await screen.findByText('Offline')).toBeInTheDocument()
    sync.mockResolvedValueOnce({ results: [msg(8, { body: 'sent while you were away' })], hasMore: false })
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 })
    sockets[1].open(8)
    await waitFor(() => expect(sync).toHaveBeenCalledWith(5))
    expect(await screen.findByText('sent while you were away')).toBeInTheDocument()
  })

  it('recovers messages missed while offline even after sending one over HTTP, when the socket dropped before ready', async () => {
    const { send } = spies()
    vi.spyOn(messagesApi, 'history').mockImplementation((id, params = {}) => Promise.resolve(
      params.after === undefined ? { results: [msg(4, { sender: { id: ME, name: 'Test Learner' } }), msg(5)], hasMore: false }
        : { results: [msg(6, { body: 'missed six' }), msg(7, { body: 'missed seven' }), msg(9, { body: 'mine', sender: { id: ME, name: 'Test Learner' } })].filter((m) => m.id > params.after), hasMore: false }))
    send.mockImplementation((id, { body, clientId }) => Promise.resolve(msg(9, { body, clientId, sender: { id: ME, name: 'Test Learner' } })))
    const user = userEvent.setup()
    open('/student/messages/7')
    const log = await screen.findByRole('log', { name: 'Messages with Bob Bose' })
    await waitFor(() => expect(sockets).toHaveLength(1))
    act(() => { sockets[0].readyState = 1; sockets[0].onopen?.() })
    sockets[0].drop()  // gone before its "ready" frame arrived
    await user.type(screen.getByLabelText('Message Bob Bose'), 'mine{Enter}')
    expect(await within(log).findByText('mine')).toBeInTheDocument()
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 })
    sockets[1].open(9)
    expect(await within(log).findByText('missed six')).toBeInTheDocument()
    expect(within(log).getByText('missed seven')).toBeInTheDocument()
    expect(within(log).getAllByText('mine')).toHaveLength(1)
  })

  it('catches up after a reconnect for a student who had no messages when first connected', async () => {
    const { sync } = spies()
    open('/student/messages/7')
    await screen.findByRole('log', { name: 'Messages with Bob Bose' })
    await waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].open(0)
    sockets[0].drop()
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 3000 })
    sockets[1].open(3)
    await waitFor(() => expect(sync).toHaveBeenCalledWith(0))
  })

  it('falls back to HTTP with the same client id when the socket is not connected', async () => {
    const { send } = spies()
    send.mockImplementation((id, { body, clientId }) => Promise.resolve(msg(9, { body, clientId, sender: { id: ME, name: 'Test Learner' } })))
    const user = userEvent.setup()
    open('/student/messages/7')
    const log = await screen.findByRole('log', { name: 'Messages with Bob Bose' })
    await user.type(screen.getByLabelText('Message Bob Bose'), 'over http{Enter}')
    await waitFor(() => expect(send).toHaveBeenCalledWith(7, expect.objectContaining({ body: 'over http', clientId: expect.any(String) })))
    expect(await within(log).findByText('over http')).toBeInTheDocument()
    expect(within(log).queryByText('Sending…')).not.toBeInTheDocument()
  })
})
