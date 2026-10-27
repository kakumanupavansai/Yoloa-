// End-to-end checks against a running Django API on PostgreSQL. Run only against a disposable database:
//   (backend)  DB_NAME=yoloa_e2e python manage.py migrate && DB_NAME=yoloa_e2e python manage.py seed
//              DB_NAME=yoloa_e2e python manage.py runserver
//   (frontend) VITE_USE_MOCK=false VITE_TEST_DB_IS_DISPOSABLE=true VITE_API_URL=http://localhost:8000/api \
//              VITE_E2E_ADMIN_EMAIL=… VITE_E2E_ADMIN_PASSWORD=… npm test
// A brand-new student is registered for every run, so no student password is stored anywhere.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'

const LIVE = String(import.meta.env.VITE_USE_MOCK) === 'false' && String(import.meta.env.VITE_TEST_DB_IS_DISPOSABLE) === 'true'
const API = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'
const ADMIN = { email: import.meta.env.VITE_E2E_ADMIN_EMAIL, password: import.meta.env.VITE_E2E_ADMIN_PASSWORD }
const STUDENT = { fullName: 'Grace Hopper', email: `grace.${Date.now()}@e2e.test`, password: `Cobol-${Math.random().toString(36).slice(2)}-1959` }
let originalFetch
const cookies = new Map()
const failedPaths = new Set()

const apiFetch = (path, init = {}) => fetch(`${API}${path}`, init)
const json = async (path, init = {}) => {
  const response = await apiFetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const data = await response.json().catch(() => null)
  if (!response.ok) { const error = new Error(data?.message || response.statusText); error.status = response.status; throw error }
  return data
}
const statusOf = async (path, init) => (await apiFetch(path, init)).status
const signIn = async (email, password, role) => {
  cookies.clear()
  await apiFetch('/auth/csrf')
  return json('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, role }) })
}
const open = (path) => render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
const reset = () => { document.body.innerHTML = '' }

// Seed content (lms/management/commands/seed.py): the first Python module quiz's correct answers.
const passAnswers = { 'Which function displays output in Python?': 1, 'Python variables must declare their type before use.': false,
  'Which of these are built-in Python types?': [0, 2, 3], 'Which built-in function returns the type of a value?': 'type' }
const passQuiz = async (quizId) => {
  const attempt = await json(`/assessments/${quizId}/start`, { method: 'POST', body: '{}' })
  const detail = await json(`/exams/${quizId}`).catch(() => null) // admin-only: expected to fail for students
  expect(detail).toBeNull()
  // Students never receive answer keys, so answer from the known seed content by question type.
  const answers = Object.fromEntries(attempt.questions.map((question) => [question.id, passAnswers[question.text] ?? defaultAnswer(question)]))
  await json(`/attempts/${attempt.attemptId}/answers`, { method: 'PUT', body: JSON.stringify({ answers, version: attempt.answerVersion }) })
  return json(`/attempts/${attempt.attemptId}/submit`, { method: 'POST', body: '{}' })
}
const KNOWN = { 'What does range(3) produce?': 1, 'An elif branch runs only when every earlier condition is false.': true, 'Which keyword exits a loop immediately?': 2,
  'Which statements create a loop?': [0, 1], 'Which keyword defines a function?': 1, 'A function without a return statement returns None.': true,
  'What keyword sends a value back from a function?': 'return' }
const defaultAnswer = (question) => KNOWN[question.text]

beforeAll(() => {
  originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init = {}) => {
    const target = typeof input === 'string' && input.startsWith('/api/') ? `${API}${input.slice('/api'.length)}` : input
    const url = new URL(typeof target === 'string' ? target : target.url, window.location.href)
    if (!url.pathname.startsWith('/api/') && !url.href.startsWith(API)) return originalFetch(target, init)
    if (failedPaths.has(url.pathname)) return new Response(JSON.stringify({ message: 'Backend unavailable for this request.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    const headers = new Headers(init.headers || {})
    if (cookies.size) headers.set('Cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '))
    const method = String(init.method || 'GET').toUpperCase()
    if (!['GET', 'HEAD', 'OPTIONS', 'TRACE'].includes(method) && cookies.has('csrftoken')) headers.set('X-CSRFToken', cookies.get('csrftoken'))
    const response = await originalFetch(target, { ...init, headers })
    const setCookies = response.headers.getSetCookie?.() || []
    for (const setCookie of setCookies) {
      const [name, ...value] = setCookie.split(';', 1)[0].split('=')
      if (name && value.length) { if (value.join('=') === '""' || value.join('=') === '') cookies.delete(name); else cookies.set(name, value.join('=')) }
    }
    return response
  }
})
afterAll(() => { if (originalFetch) globalThis.fetch = originalFetch })

describe.skipIf(!LIVE)('live backend on PostgreSQL', () => {
  let python

  beforeAll(async () => {
    await apiFetch('/auth/csrf')
    const created = await json('/auth/register', { method: 'POST', body: JSON.stringify({ ...STUDENT, passwordConfirmation: STUDENT.password }) })
    expect(created.user).toMatchObject({ role: 'student', email: STUDENT.email })
    python = (await json('/courses')).find((course) => course.title === 'Python Programming Fundamentals')
    expect(python).toBeTruthy()
  })

  it('registers a real student session and shows an empty dashboard (no demo data)', async () => {
    expect(cookies.has('sessionid')).toBe(true)
    expect(await json('/auth/me')).toMatchObject({ email: STUDENT.email, role: 'student' })
    open('/student/dashboard')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(await screen.findByText('You are not enrolled in any courses yet.')).toBeInTheDocument()
    reset()
  })

  it('shows real API failures with retry instead of substituting sample data', async () => {
    failedPaths.add('/api/student/dashboard')
    open('/student/dashboard')
    expect(await screen.findByText('Backend unavailable for this request.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
    failedPaths.delete('/api/student/dashboard')
    reset()
  })

  it('hides unpublished courses and blocks student access to administrator APIs', async () => {
    const titles = (await json('/courses')).map((course) => course.title)
    expect(titles).not.toContain('Cloud Computing Basics')
    expect(await statusOf('/admin/students')).toBe(403)
    expect(await statusOf('/admin/dashboard')).toBe(403)
    expect(await statusOf('/exams')).toBe(403)
  })

  it('enrolls from the library; module 2 stays locked on the server until module 1’s quiz is passed in the UI', async () => {
    const user = userEvent.setup()
    open('/student/courses')
    await user.click(await screen.findByRole('button', { name: 'Enroll in Python Programming Fundamentals' }))
    expect(await screen.findByText(/enrolled in python programming fundamentals/i)).toBeInTheDocument()
    reset()

    const outline = await json(`/courses/${python.id}`)
    const [first, second] = outline.chapters
    expect([first.unlocked, second.unlocked]).toEqual([true, false])
    expect(await statusOf(`/modules/${second.id}`)).toBe(403)
    expect(await statusOf(`/assessments/${second.quiz?.id ?? 0}/start`, { method: 'POST', headers: { 'X-CSRFToken': cookies.get('csrftoken') } })).toBe(403)
    expect(await statusOf(`/chapters/${first.id}/progress`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) })).toBe(409)

    // Take module 1's quiz through the real UI; the server scores it.
    open(`/student/quizzes/${first.quiz.id}`)
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    await user.click(await screen.findByRole('radio', { name: /print\(\)/ }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('radio', { name: /False$/ }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    for (const label of [/int$/, /list$/, /dict$/]) await user.click(screen.getByRole('checkbox', { name: label }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.type(screen.getByLabelText('Answer for question 4'), 'type')
    await waitFor(() => expect(screen.getByText('All answers saved')).toBeInTheDocument(), { timeout: 4000 })
    await user.click(screen.getByRole('button', { name: 'Submit quiz' }))
    expect(await screen.findByText('Passed — module complete')).toBeInTheDocument()
    reset()

    const after = await json(`/courses/${python.id}`)
    expect(after.chapters[0].completed).toBe(true)
    expect(after.chapters[1].unlocked).toBe(true)
    expect(after.percent).toBe(33)
    expect(await statusOf(`/modules/${second.id}`)).toBe(200)
  })

  it('serves a protected PDF resource only to an enrolled student with the module unlocked', async () => {
    const module = await json(`/modules/${(await json(`/courses/${python.id}`)).chapters[0].id}`)
    const pdf = module.resources.find((resource) => resource.hasFile)
    const response = await apiFetch(pdf.filePath)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect((await response.text()).startsWith('%PDF')).toBe(true)
  })

  it('gates the final exam, enforces a 600-second server deadline and resumes the same attempt', async () => {
    const outline = await json(`/courses/${python.id}`)
    const final = outline.assessment.finalExam
    expect(final.eligible).toBe(false)
    expect(await statusOf(`/assessments/${final.id}/start`, { method: 'POST', headers: { 'X-CSRFToken': cookies.get('csrftoken') } })).toBe(403)
    for (const chapter of outline.chapters.slice(1)) expect((await passQuiz(chapter.quiz.id)).passed).toBe(true)

    const started = await json(`/assessments/${final.id}/start`, { method: 'POST', body: '{}' })
    expect((new Date(started.deadline) - new Date(started.startedAt)) / 1000).toBe(600)
    const resumed = await json(`/assessments/${final.id}/start`, { method: 'POST', body: '{}' })
    expect(resumed.attemptId).toBe(started.attemptId)
    expect(resumed.deadline).toBe(started.deadline)
    expect(started.questions.some((question) => 'correctAnswers' in question || 'expectedAnswer' in question)).toBe(false)

    const user = userEvent.setup()
    open(`/student/exams/${final.id}`)
    await user.click(await screen.findByRole('button', { name: 'Resume attempt' }))
    const timer = await screen.findByRole('timer')
    const [minutes, seconds] = timer.textContent.match(/(\d\d):(\d\d)/).slice(1).map(Number)
    expect(minutes * 60 + seconds).toBeLessThanOrEqual(600)
    expect(minutes * 60 + seconds).toBeGreaterThan(500)
    reset()

    const result = await json(`/attempts/${started.attemptId}/submit`, { method: 'POST', body: '{}' })
    expect(result.status).toBe('submitted')
    expect(result.passPercent).toBe(60)
    const again = await json(`/attempts/${started.attemptId}/submit`, { method: 'POST', body: '{}' })
    expect(again.score).toBe(result.score)
  })

  describe.skipIf(!ADMIN.email || !ADMIN.password)('administrator', () => {
    it('sees the new student, their attempts and their sign-in history from stored records', async () => {
      await signIn(ADMIN.email, ADMIN.password, 'admin')
      const directory = await json(`/admin/students?q=${encodeURIComponent(STUDENT.email)}`)
      expect(directory.total).toBe(1)
      const record = await json(`/admin/students/${directory.results[0].id}`)
      expect(record.metrics.quizAttempts).toBe(3)
      expect(record.loginHistory.map((event) => event.authMethod)).toEqual(['email_password'])
      expect(Object.keys(record).some((key) => /password/i.test(key))).toBe(false)

      open('/admin/dashboard')
      expect(Number((await screen.findByTestId('students-registered')).textContent)).toBeGreaterThanOrEqual(1)
      reset()
      open(`/admin/students/${record.id}`)
      expect(await screen.findByRole('heading', { name: 'Grace Hopper' })).toBeInTheDocument()
      expect(screen.getAllByText(/Getting started with Python quiz/).length).toBeGreaterThan(0)
      reset()
      const admin = await json('/auth/me')
      expect(admin.role).toBe('admin')
    })
  })
})
