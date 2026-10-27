// Regression tests for quiz scoring display, quiz start reliability and request de-duplication.
import { StrictMode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { useApi } from '../hooks'
import { assessmentsApi } from '../services/api'
import { ApiError, get, post } from '../services/http'
import { pct } from '../components/ui/Primitives'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
const open = (path, { strict = false } = {}) => {
  localStorage.setItem('yoloa_role', 'student')
  const tree = <MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}
beforeEach(() => localStorage.clear())
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

const questions = [
  { id: 18, text: 'Which element marks the main content?', questionType: 'single', choices: ['<div>', '<main>'], points: 1 },
  { id: 19, text: 'Headings should skip levels.', questionType: 'true_false', choices: ['True', 'False'], points: 1 },
  { id: 20, text: 'Pick the sectioning elements.', questionType: 'single', choices: ['<span>', '<section>'], points: 1 },
]
const quiz = (over = {}) => ({ id: 5, title: 'Semantic HTML quiz', assessmentType: 'module_quiz', courseId: 2, courseTitle: 'Web', moduleTitle: 'Semantic HTML',
  questionCount: 3, totalPoints: 3, passPercent: 50, attempts: 0, passed: false, eligibility: { eligible: true, reasons: [] }, activeAttemptId: null, questions, ...over })
const started = { attemptId: 31, status: 'in_progress', answers: {}, answerVersion: 0, deadline: null, questions, questionCount: 3 }
const review = (correct) => questions.map((q, i) => ({ ...q, chosen: 0, correct: 1, correctAnswers: [1], isCorrect: i < correct, earned: i < correct ? 1 : 0 }))

describe('percentage formatting', () => {
  it('shows the server percentage with up to two decimals', () => {
    expect([0, 33.33, 66.67, 100, 25, '50.00', null].map(pct)).toEqual(['0%', '33.33%', '66.67%', '100%', '25%', '50%', '—'])
  })
})

describe.skipIf(!MOCK)('quiz scoring display', () => {
  it('shows the question count and renders the backend score for 1 of 3 correct', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockResolvedValue(started)
    vi.spyOn(assessmentsApi, 'save').mockImplementation((id, answers, version) => Promise.resolve({ answers, answerVersion: version + 1 }))
    vi.spyOn(assessmentsApi, 'submit').mockResolvedValue({ status: 'submitted', score: 1, total: 3, percent: 33.33, passed: false, passPercent: 50,
      questionCount: 3, correctCount: 1, review: review(1) })
    const user = userEvent.setup()
    open('/student/quizzes/5')
    const questionStat = (await screen.findByText('Questions')).parentElement
    expect(questionStat).toHaveTextContent('3')
    await user.click(screen.getByRole('button', { name: 'Start quiz' }))
    expect(await screen.findByText(/Question 1 of 3/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Go to question/ })).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: 'Submit quiz' }))
    await user.click(await screen.findByRole('button', { name: 'Submit anyway' }))
    expect(await screen.findByText('33.33%')).toBeInTheDocument()
    expect(screen.getByTestId('correct-count')).toHaveTextContent('1 of 3 questions correct')
    expect(screen.getByText(/1 \/ 3 points/)).toBeInTheDocument()
    expect(screen.queryByText(/25%/)).not.toBeInTheDocument()
  })

  it('explains weighted questions instead of implying an extra question', async () => {
    const weighted = questions.map((q, i) => ({ ...q, points: i === 2 ? 2 : 1 }))
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz({ totalPoints: 4, questions: weighted }))
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockResolvedValue({ ...started, questions: weighted })
    vi.spyOn(assessmentsApi, 'save').mockResolvedValue({ answerVersion: 1 })
    vi.spyOn(assessmentsApi, 'submit').mockResolvedValue({ status: 'submitted', score: 1, total: 4, percent: 25, passed: false, passPercent: 50,
      questionCount: 3, correctCount: 1, review: review(1).map((item, i) => ({ ...item, points: weighted[i].points })) })
    const user = userEvent.setup()
    open('/student/quizzes/5')
    expect(await screen.findByText(/worth different points; your score is the points earned out of 4/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start quiz' }))
    await user.click(await screen.findByRole('button', { name: 'Submit quiz' }))
    await user.click(await screen.findByRole('button', { name: 'Submit anyway' }))
    expect(await screen.findByText('25%')).toBeInTheDocument()
    expect(screen.getByTestId('correct-count')).toHaveTextContent('1 of 3 questions correct')
    expect(screen.getByText(/points earned ÷ points available/)).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('opening and starting a quiz', () => {
  it('shows a loading state, then an error with retry and never sample questions when loading fails', async () => {
    const load = vi.spyOn(assessmentsApi, 'get').mockRejectedValueOnce(new ApiError('Not found.', 404)).mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    const user = userEvent.setup()
    open('/student/quizzes/5')
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(await screen.findByText('Not found.')).toBeInTheDocument()
    expect(screen.queryByText(questions[0].text)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start quiz' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByRole('button', { name: 'Start quiz' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('sends one start request under React StrictMode', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    const start = vi.spyOn(assessmentsApi, 'start').mockResolvedValue(started)
    const user = userEvent.setup()
    open('/student/quizzes/5', { strict: true })
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    expect(await screen.findByText(/Question 1 of 3/)).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('handles rapid repeated clicks on the start button with a single request', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    let resolve
    const start = vi.spyOn(assessmentsApi, 'start').mockImplementation(() => new Promise((r) => { resolve = r }))
    const user = userEvent.setup()
    open('/student/quizzes/5', { strict: true })
    const button = await screen.findByRole('button', { name: 'Start quiz' })
    await user.tripleClick(button)
    expect(screen.getByText(/restoring your attempt/i)).toBeInTheDocument()
    await act(async () => resolve(started))
    expect(await screen.findByText(/Question 1 of 3/)).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('offers a retry when starting fails and recovers on the next attempt', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    const start = vi.spyOn(assessmentsApi, 'start').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(started)
    const user = userEvent.setup()
    open('/student/quizzes/5')
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    expect(await screen.findByText(/Could not start the attempt: Failed to fetch/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Question 1 of 3/)).toBeInTheDocument()
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('resumes an in-progress attempt with its saved answers after a refresh', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz({ activeAttemptId: 31 }))
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockResolvedValue({ ...started, answers: { 18: 1 }, answerVersion: 1, resumed: true })
    const user = userEvent.setup()
    open('/student/quizzes/5')
    await user.click(await screen.findByRole('button', { name: 'Resume attempt' }))
    expect(await screen.findByText('1/3 answered')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /<main>/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('sends the student to sign in when the session has expired', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quiz())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockImplementation(() => {
      window.dispatchEvent(new Event('auth:expired'))  // what services/http.js does on any 401
      return Promise.reject(new ApiError('Authentication credentials were not provided.', 401))
    })
    const user = userEvent.setup()
    open('/student/quizzes/5')
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    expect(await screen.findByRole('heading', { name: /student sign in/i })).toBeInTheDocument()
  })
})

describe('request de-duplication and stale responses', () => {
  const response = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))

  it('shares overlapping identical GETs, but never across a write', async () => {
    const fetchMock = vi.fn(() => response({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const [a, b] = await Promise.all([get('/student/dashboard'), get('/student/dashboard')])
    expect(a).toEqual({ ok: true })
    expect(b).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const pending = get('/assessments/5')
    await post('/assessments/5/start', {})
    await Promise.all([pending, get('/assessments/5')])
    expect(fetchMock.mock.calls.map(([url, options]) => `${options.method} ${url}`)).toEqual([
      'GET /api/student/dashboard', 'GET /api/assessments/5', 'POST /api/assessments/5/start', 'GET /api/assessments/5'])
    await get('/student/dashboard')
    expect(fetchMock).toHaveBeenCalledTimes(5)  // finished requests are not cached
  })

  it('ignores a slow response for a previous id', async () => {
    const resolvers = {}
    const load = (id) => new Promise((resolve) => { resolvers[id] = resolve })
    const { result, rerender } = renderHook(({ id }) => useApi(() => load(id), [id]), { initialProps: { id: 1 } })
    rerender({ id: 2 })
    await act(async () => resolvers[2]({ id: 2 }))
    await act(async () => resolvers[1]({ id: 1 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toEqual({ id: 2 })
  })
})
