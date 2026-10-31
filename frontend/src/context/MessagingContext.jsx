import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { authApi, messagesApi } from '../services/api'
import { USE_MOCK } from '../services/http'

// One WebSocket per signed-in student (/ws/messages/). The server authenticates it with the Django session cookie and
// only ever sends this student's own events. Messages are stored in PostgreSQL before they are pushed, so after any
// disconnect the provider asks the HTTP API for everything newer than the last message id it saw.
const MessagingContext = createContext(null)

const ACK_TIMEOUT_MS = 8000
const HEARTBEAT_MS = 25000
const MAX_BACKOFF_MS = 30000

// Vitest installs a fake socket here; without one, fixture mode never opens a real connection.
let socketFactory = null
export const setSocketFactory = (factory) => { socketFactory = factory }

export const socketUrl = () => import.meta.env.VITE_WS_URL
  || `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/messages/`

export const newClientId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const disabled = {
  enabled: false, status: 'idle', unread: 0, subscribe: () => () => {}, refreshUnread: () => {},
  sendMessage: (conversationId, body, clientId) => messagesApi.send(conversationId, { body, clientId }),
  markRead: (conversationId, messageId) => messagesApi.markRead(conversationId, messageId),
  sendTyping: () => {},
}
export const useMessaging = () => useContext(MessagingContext) || disabled

export function MessagingProvider({ children }) {
  const { user } = useAuth()
  const enabled = user?.role === 'student' && (!USE_MOCK || Boolean(socketFactory))
  const [status, setStatus] = useState('idle')
  const [unread, setUnread] = useState(0)
  const listeners = useRef(new Set())
  const socket = useRef(null)
  const lastSeen = useRef(0)
  // Whether a socket has said "ready" yet. Not inferred from lastSeen: a student with no messages has lastSeen 0.
  const synced = useRef(false)
  const acks = useRef(new Map())
  const unreadTimer = useRef(null)

  const emit = useCallback((event) => { listeners.current.forEach((listener) => listener(event)) }, [])
  const subscribe = useCallback((listener) => {
    listeners.current.add(listener)
    return () => listeners.current.delete(listener)
  }, [])
  const seen = (message) => { if (message?.id > lastSeen.current) lastSeen.current = message.id }

  const refreshUnread = useCallback(() => {
    clearTimeout(unreadTimer.current)
    unreadTimer.current = setTimeout(() => {
      messagesApi.unread().then((data) => setUnread(data.unread)).catch(() => {})
    }, 250)
  }, [])

  useEffect(() => {
    if (!enabled) { setStatus('idle'); setUnread(0); return undefined }
    let stopped = false
    let attempt = 0
    let retryTimer = null
    let heartbeat = null
    lastSeen.current = 0
    synced.current = false

    const failAcks = () => {
      acks.current.forEach(({ reject, timer }) => { clearTimeout(timer); reject(new Error('Connection lost')) })
      acks.current.clear()
    }

    // Everything stored while this browser was disconnected, oldest first.
    const catchUp = async (after) => {
      let cursor = after
      for (;;) {
        const page = await messagesApi.sync(cursor)
        page.results.forEach((message) => { seen(message); emit({ type: 'message.new', message, recovered: true }) })
        if (!page.hasMore || !page.results.length) break
        cursor = page.results[page.results.length - 1].id
      }
    }

    const handle = (data) => {
      switch (data.type) {
        case 'ready': {
          const reconnected = synced.current
          synced.current = true
          setStatus('open')
          if (reconnected) catchUp(lastSeen.current).catch(() => {})
          else lastSeen.current = data.lastMessageId || 0
          emit({ type: 'ready', reconnected })
          refreshUnread()
          break
        }
        case 'message.new':
          seen(data.message)
          emit(data)
          refreshUnread()
          break
        case 'message.ack': {
          seen(data.message)
          const waiting = acks.current.get(data.clientId)
          if (waiting) { clearTimeout(waiting.timer); acks.current.delete(data.clientId); waiting.resolve(data.message) }
          break
        }
        case 'error': {
          const waiting = data.clientId && acks.current.get(data.clientId)
          if (waiting) {
            clearTimeout(waiting.timer)
            acks.current.delete(data.clientId)
            const error = new Error(data.message)
            error.status = data.code === 'rate_limited' ? 429 : 400
            error.fromServer = true
            waiting.reject(error)
          }
          break
        }
        case 'conversation.read':
          emit(data)
          refreshUnread()
          break
        case 'typing':
        case 'feed.post':
        case 'feed.delete':
          emit(data)
          break
        default:
      }
    }

    const connect = () => {
      if (stopped) return
      clearTimeout(retryTimer)
      setStatus(attempt ? 'reconnecting' : 'connecting')
      let opened = false
      const ws = socketFactory ? socketFactory(socketUrl()) : new WebSocket(socketUrl())
      socket.current = ws
      ws.onopen = () => {
        opened = true
        attempt = 0
        heartbeat = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'ping' })) }, HEARTBEAT_MS)
      }
      ws.onmessage = (event) => {
        try { handle(JSON.parse(event.data)) } catch { /* ignore malformed frames */ }
      }
      ws.onerror = () => {}
      ws.onclose = (event) => {
        clearInterval(heartbeat)
        if (socket.current === ws) socket.current = null
        failAcks()
        if (stopped) return
        setStatus('offline')
        // A refused handshake or an auth close may mean the session ended: /auth/me then reports 401 and the
        // auth context signs the browser out, which stops this provider.
        if (!opened || event.code === 4401 || event.code === 4403) authApi.me().catch(() => {})
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2)
        attempt += 1
        retryTimer = setTimeout(connect, delay)
      }
    }

    const reconnectNow = () => {
      if (stopped || socket.current) return
      attempt = Math.min(attempt, 1)
      connect()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') reconnectNow() }
    window.addEventListener('online', reconnectNow)
    document.addEventListener('visibilitychange', onVisible)
    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearInterval(heartbeat)
      clearTimeout(unreadTimer.current)
      window.removeEventListener('online', reconnectNow)
      document.removeEventListener('visibilitychange', onVisible)
      failAcks()
      const ws = socket.current
      socket.current = null
      if (ws) { ws.onclose = null; ws.close(1000) }
    }
  }, [enabled, user?.id, emit, refreshUnread])

  const sendJson = (payload) => {
    const ws = socket.current
    if (!ws || ws.readyState !== 1) return false
    ws.send(JSON.stringify(payload))
    return true
  }

  // Text messages go over the WebSocket; if it is down or the server does not acknowledge in time, the same
  // clientId is sent over HTTP, which the server de-duplicates, so a message is never stored twice.
  const sendMessage = useCallback((conversationId, body, clientId) => {
    const viaHttp = () => messagesApi.send(conversationId, { body, clientId })
    if (!sendJson({ type: 'message.send', conversationId, body, clientId })) return viaHttp()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { acks.current.delete(clientId); viaHttp().then(resolve, reject) }, ACK_TIMEOUT_MS)
      acks.current.set(clientId, { resolve, reject, timer })
    }).catch((error) => (error.fromServer ? Promise.reject(error) : viaHttp()))
  }, [])

  const markRead = useCallback((conversationId, messageId) => {
    if (sendJson({ type: 'conversation.read', conversationId, messageId })) return Promise.resolve()
    return messagesApi.markRead(conversationId, messageId).then(refreshUnread)
  }, [refreshUnread])

  const sendTyping = useCallback((conversationId) => { sendJson({ type: 'typing', conversationId }) }, [])

  const value = useMemo(() => (enabled
    ? { enabled, status, unread, subscribe, sendMessage, markRead, sendTyping, refreshUnread }
    : disabled), [enabled, status, unread, subscribe, sendMessage, markRead, sendTyping, refreshUnread])
  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>
}
