export const BASE = import.meta.env.VITE_API_URL || '/api'
// Demo data is available only to the isolated Vitest flows, never in dev or production builds.
export const USE_MOCK = import.meta.env.MODE === 'test' && String(import.meta.env.VITE_USE_MOCK) === 'true'

function csrfCookie() {
  const entry = document.cookie.split('; ').find((item) => item.startsWith('csrftoken='))
  return entry ? decodeURIComponent(entry.slice('csrftoken='.length)) : ''
}

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data }
}

export async function http(path, { method = 'GET', body, headers = {}, isForm = false } = {}) {
  const verb = method.toUpperCase()
  const csrf = csrfCookie()
  const res = await fetch(`${BASE}${path}`, {
    method: verb,
    credentials: 'include',
    headers: {
      ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(verb) && csrf ? { 'X-CSRFToken': csrf } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('auth:expired'))
    throw new ApiError(data?.message || res.statusText, res.status, data)
  }
  return data
}

// Identical GETs that overlap in time share one network request (React StrictMode runs every mount effect
// twice in development, and the auth bootstrap and pages can ask for the same resource together).
// This is not a cache: the entry is dropped as soon as the response arrives, and any write clears all
// entries so a read that starts after a write can never receive a response from before it.
const inflight = new Map()
export const get = (p) => {
  if (inflight.has(p)) return inflight.get(p)
  const request = http(p).finally(() => { if (inflight.get(p) === request) inflight.delete(p) })
  inflight.set(p, request)
  return request
}
const write = (p, options) => { inflight.clear(); return http(p, options) }
export const post = (p, body) => write(p, { method: 'POST', body, isForm: body instanceof FormData })
export const put = (p, body) => write(p, { method: 'PUT', body })
export const patch = (p, body) => write(p, { method: 'PATCH', body, isForm: body instanceof FormData })
export const del = (p) => write(p, { method: 'DELETE' })

// Mock data is isolated to Vitest; application builds always execute the real request.
export const withMock = (mockValue, realFn) =>
  USE_MOCK ? new Promise((r) => setTimeout(() => r(structuredClone(mockValue)), 150)) : realFn()

// Lazy version for stateful mocks: `fn` runs at call time and may throw an ApiError.
export const withMockFn = (fn, realFn) =>
  USE_MOCK
    ? new Promise((resolve, reject) => setTimeout(() => { try { resolve(structuredClone(fn())) } catch (e) { reject(e) } }, 150))
    : realFn()
