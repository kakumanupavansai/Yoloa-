// Community feed, quiz images, Delete Quiz, analytics dashboard, student progress dashboard and the theme toggle
// (Vitest fixture mode; the API layer is spied on with the Django response shapes).
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { setSocketFactory } from '../context/MessagingContext'
import { splitLinks } from '../components/ui/RichText'
import { bucketSeries } from '../pages/admin/Analytics'
import { completionSteps } from '../pages/student/Progress'
import { mergePosts } from '../pages/student/Community'
import { adminApi, coursesApi, examsApi, feedApi, progressApi, quizImagesApi } from '../services/api'
import { ApiError } from '../services/http'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
vi.setConfig({ testTimeout: 20000 })
const open = (path, role = 'student') => {
  localStorage.setItem('yoloa_role', role)
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}
beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme })
afterEach(() => { vi.restoreAllMocks(); setSocketFactory(null) })

describe('helpers', () => {
  it('turns only http(s) URLs in text into links', () => {
    expect(splitLinks('See https://example.com/a?b=1, then javascript:alert(1).')).toEqual([
      { text: 'See ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: ', then javascript:alert(1).' }])
    expect(splitLinks('no links')).toEqual([{ text: 'no links' }])
  })
  it('sums long analytics ranges per week and keeps short ones per day', () => {
    const days = Array.from({ length: 14 }, (_, k) => ({ date: `2026-01-${String(k + 1).padStart(2, '0')}`, value: 1 }))
    expect(bucketSeries(days, 14)).toHaveLength(14)
    expect(bucketSeries(days, 120)).toEqual([{ date: '2026-01-01', value: 7 }, { date: '2026-01-08', value: 7 }])
  })
  it('counts modules completed up day by day', () => {
    expect(completionSteps(['2026-03-01T10:00:00', '2026-03-01T12:00:00', '2026-03-04T09:00:00']).map((d) => d.value)).toEqual([2, 3])
  })
  it('merges feed posts newest first without duplicates', () => {
    expect(mergePosts([{ id: 1 }, { id: 3 }], [{ id: 2 }, { id: 3, body: 'x' }]).map((p) => p.id)).toEqual([3, 2, 1])
  })
})

describe.skipIf(!MOCK)('dark and light theme', () => {
  it('toggles the whole app, persists the choice and restores it on the next visit', async () => {
    const user = userEvent.setup()
    const view = open('/student/dashboard')
    const [toggle] = await screen.findAllByRole('button', { name: 'Switch to dark mode' })
    await user.click(toggle)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('yoloa_theme')).toBe('dark')
    expect(screen.getAllByRole('button', { name: 'Switch to light mode' }).length).toBeGreaterThan(0)
    view.unmount()
    open('/admin/dashboard', 'admin')
    await screen.findAllByRole('button', { name: 'Switch to light mode' })
    expect(document.documentElement.dataset.theme).toBe('dark')
    await user.click(screen.getByRole('switch', { name: 'Dark mode' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('yoloa_theme')).toBe('light')
  })
})

const author = { id: 's2', name: 'Bob Bose', username: 'bob', avatar: '' }
const me = { id: 's1', name: 'Demo Student', username: 'student', avatar: '' }
const post = (id, over = {}) => ({ id, author, body: `post ${id}`, link: '', createdAt: new Date().toISOString(), attachments: [], ...over })

describe.skipIf(!MOCK)('community feed', () => {
  it('shows posts with author, time, links and images, and marks the space as public', async () => {
    vi.spyOn(feedApi, 'list').mockResolvedValue({ results: [post(2, { body: 'Read https://docs.example.com today', link: 'https://www.example.com/notes',
      attachments: [{ id: 9, name: 'cell.png', kind: 'image', size: 10, contentType: 'image/png', url: '/feed/attachments/9' },
        { id: 10, name: 'notes.pdf', kind: 'document', size: 2048, contentType: 'application/pdf', url: '/feed/attachments/10' }] })], hasMore: false })
    open('/student/community')
    const card = await screen.findByRole('article', { name: 'Post by Bob Bose' })
    expect(within(card).getByText('@bob', { exact: false })).toBeInTheDocument()
    expect(within(card).getByText('Just now')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'https://docs.example.com' })).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(within(card).getByRole('link', { name: /www\.example\.com\/notes/ })).toHaveAttribute('href', 'https://www.example.com/notes')
    expect(within(card).getByRole('img', { name: 'cell.png' })).toHaveAttribute('src', '/api/feed/attachments/9')
    expect(within(card).getByRole('link', { name: /notes\.pdf/ })).toHaveAttribute('href', '/api/feed/attachments/10?download=1')
    expect(screen.getByRole('note')).toHaveTextContent(/public/i)
    for (const link of screen.getAllByRole('link', { name: /private messages/i })) expect(link).toHaveAttribute('href', '/student/messages')
  })

  it('posts text with a link, shows it, and lets the author delete it', async () => {
    vi.spyOn(feedApi, 'list').mockResolvedValue({ results: [post(1)], hasMore: false })
    const create = vi.spyOn(feedApi, 'create').mockResolvedValue(post(5, { author: me, body: 'My notes', link: 'https://example.com' }))
    const remove = vi.spyOn(feedApi, 'remove').mockResolvedValue(null)
    const user = userEvent.setup()
    open('/student/community')
    await screen.findByRole('article', { name: 'Post by Bob Bose' })
    expect(screen.queryByRole('button', { name: 'Delete post' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Post text'), 'My notes')
    await user.click(screen.getByRole('button', { name: 'Link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'not a link')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/http/)
    expect(create).not.toHaveBeenCalled()
    await user.clear(screen.getByRole('textbox', { name: 'Link' }))
    await user.type(screen.getByRole('textbox', { name: 'Link' }), 'https://example.com')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({ body: 'My notes', link: 'https://example.com', files: [] }))
    const mine = await screen.findByRole('article', { name: 'Post by Demo Student' })
    await user.click(within(mine).getByRole('button', { name: 'Delete post' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete this post?' })).getByRole('button', { name: 'Delete post' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(5))
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Post by Demo Student' })).not.toBeInTheDocument())
  })

  it('adds posts pushed over the WebSocket and removes deleted ones', async () => {
    let socket
    setSocketFactory((url) => {
      socket = { url, readyState: 0, send() {}, close() { this.readyState = 3 } }
      setTimeout(() => { socket.readyState = 1; socket.onopen?.(); act(() => socket.onmessage?.({ data: JSON.stringify({ type: 'ready', lastMessageId: 0 }) })) })
      return socket
    })
    vi.spyOn(feedApi, 'list').mockResolvedValue({ results: [post(1)], hasMore: false })
    open('/student/community')
    await screen.findByRole('article', { name: 'Post by Bob Bose' })
    await waitFor(() => expect(socket?.readyState).toBe(1))
    act(() => socket.onmessage({ data: JSON.stringify({ type: 'feed.post', post: post(2, { body: 'Live post' }) }) }))
    expect(await screen.findByText('Live post')).toBeInTheDocument()
    act(() => socket.onmessage({ data: JSON.stringify({ type: 'feed.delete', postId: 2 }) }))
    await waitFor(() => expect(screen.queryByText('Live post')).not.toBeInTheDocument())
  })

  it('shows loading errors with retry', async () => {
    const list = vi.spyOn(feedApi, 'list').mockRejectedValueOnce(new ApiError('Server unavailable', 500)).mockResolvedValue({ results: [], hasMore: false })
    const user = userEvent.setup()
    open('/student/community')
    expect(await screen.findByText('Server unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText('No posts yet')).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })
})

const managed = { id: 5, title: 'Algorithms', description: '', category: 'CS', level: 'Beginner', isPublished: true, enrollments: [], stats: { students: 0, completed: 0 },
  resources: [], finalExam: null, modules: [{ id: 50, title: 'Sorting', description: '', duration: '', required: true, resources: [], quiz: { id: 7, title: 'Sorting quiz' } }] }
const quiz = (over = {}) => ({ id: 7, title: 'Sorting quiz', status: 'Draft', assessmentType: 'module_quiz', assessmentTypeLabel: 'Module quiz', passPercent: 50,
  courseId: 5, courseTitle: 'Algorithms', moduleId: 50, moduleTitle: 'Sorting', points: 1, attempts: 0,
  questions: [{ id: 1, text: 'Pick one', questionType: 'single', choices: ['A', 'B'], correctAnswers: [0], correct: 0, points: 1, imageId: null, choiceImages: [], explanation: '', explanationImageId: null }], ...over })

describe.skipIf(!MOCK)('quiz editor: images and Delete Quiz', () => {
  beforeEach(() => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([{ id: 5, title: 'Algorithms' }])
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(managed)
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
  })

  it('uploads a question image with a preview and saves its id with the question', async () => {
    vi.spyOn(examsApi, 'get').mockResolvedValue(quiz())
    const upload = vi.spyOn(quizImagesApi, 'upload').mockResolvedValue({ id: 31, url: '/quiz-images/31' })
    const update = vi.spyOn(examsApi, 'update').mockResolvedValue({ id: 7, courseId: 5 })
    const user = userEvent.setup({ applyAccept: false })
    open('/admin/exams/7', 'admin')
    await screen.findByDisplayValue('Pick one')
    await user.upload(screen.getByLabelText('Upload image for question 1'), new File(['x'], 'diagram.png', { type: 'image/png' }))
    expect(upload).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('img', { name: 'image for question 1 preview' })).toHaveAttribute('src', 'blob:preview')
    await user.upload(screen.getByLabelText('Upload image for choice B'), new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(await screen.findByText('Use a JPG, PNG, GIF or WEBP image.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][1].questions[0]).toMatchObject({ imageId: 31, choiceImages: [null, null], text: 'Pick one' })
  })

  it('deletes a quiz after a confirmation that names it, and returns to the course', async () => {
    vi.spyOn(examsApi, 'get').mockResolvedValue(quiz())
    const remove = vi.spyOn(examsApi, 'remove').mockResolvedValue(null)
    const user = userEvent.setup()
    open('/admin/exams/7', 'admin')
    await user.click(await screen.findByRole('button', { name: 'Delete quiz' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete quiz “Sorting quiz”?' })
    expect(dialog).toHaveTextContent('Algorithms › Sorting')
    expect(dialog).toHaveTextContent('The course and module are not deleted')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete quiz' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete quiz' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(7))
    expect(await screen.findByRole('heading', { name: 'Algorithms' })).toBeInTheDocument()
  })

  it('offers Move to draft when the server keeps a quiz that has attempts', async () => {
    vi.spyOn(examsApi, 'get').mockResolvedValue(quiz({ attempts: 2 }))
    vi.spyOn(examsApi, 'remove').mockRejectedValue(new ApiError('“Sorting quiz” has 2 student attempts and cannot be deleted without losing that history.', 409))
    const update = vi.spyOn(examsApi, 'update').mockResolvedValue({ id: 7 })
    const user = userEvent.setup()
    open('/admin/exams/7', 'admin')
    expect(await screen.findByText(/It has 2 student attempts/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete quiz' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete quiz' }))
    const keep = await screen.findByRole('dialog', { name: 'Keep the student history' })
    await user.click(within(keep).getByRole('button', { name: 'Move to draft' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { status: 'draft' }))
  })
})

const series = (values) => values.map((value, k) => ({ date: `2026-10-${String(k + 1).padStart(2, '0')}`, value }))
const overview = {
  range: { start: '2026-10-01', end: '2026-10-05', days: 5 },
  students: { total: 12, accountActive: 11, accountDisabled: 1, activeInRange: 7, inactiveInRange: 5, newInRange: 3, neverSignedIn: 2 },
  registrations: series([1, 0, 2, 0, 0]), logins: series([3, 4, 0, 6, 2]), activeStudentsByDay: series([2, 3, 0, 4, 2]),
  loginMethods: [{ method: 'email_password', label: 'Email and password', value: 15 }],
  courses: [{ id: 1, title: 'Python', isPublished: true, enrolled: 8, completed: 3, ongoing: 5, averageProgress: 60, completionRate: 38 },
    { id: 2, title: 'Empty course', isPublished: false, enrolled: 0, completed: 0, ongoing: 0, averageProgress: null, completionRate: null }],
  completion: { enrollments: 8, completed: 3, ongoing: 5, rate: 38, completedInRange: 1 },
  quizzes: { attempts: 4, passed: 3, passRate: 75, averagePercent: 71.5, byQuiz: [{ id: 3, title: 'Loops quiz', type: 'module_quiz', course: 'Python', attempts: 4, passRate: 75, averagePercent: 71.5 }],
    distribution: Array.from({ length: 10 }, (_, k) => ({ label: `${k * 10}%`, min: k * 10, quiz: k === 9 ? 3 : k === 2 ? 1 : 0, final: 0 })) },
}

describe.skipIf(!MOCK)('admin analytics dashboard', () => {
  it('renders the stored figures and charts, and refetches for another date range', async () => {
    const call = vi.spyOn(adminApi, 'analyticsOverview').mockResolvedValue(overview)
    const user = userEvent.setup()
    open('/admin/analytics', 'admin')
    expect(await screen.findByTestId('kpi-total')).toHaveTextContent('12')
    expect(screen.getByTestId('kpi-active')).toHaveTextContent('7')
    for (const name of ['Login activity', 'Student registrations', 'Course enrollment distribution', 'Course completion', 'Quiz performance distribution'])
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Login activity' })).toBeInTheDocument()
    expect(screen.getByText('Loops quiz')).toBeInTheDocument()
    expect(screen.queryByText('Empty course')).not.toBeInTheDocument()  // no enrollments → not charted
    expect(screen.queryByText(/sign-in log/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Last 7 days' }))
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2))
    const { start, end } = call.mock.calls[1][0]
    expect((new Date(end) - new Date(start)) / 86400000).toBe(6)
  })

  it('shows empty-period messages instead of empty charts, and errors with retry', async () => {
    const empty = { ...overview, logins: series([0, 0, 0, 0, 0]), registrations: series([0, 0, 0, 0, 0]), quizzes: { ...overview.quizzes, attempts: 0, byQuiz: [] } }
    vi.spyOn(adminApi, 'analyticsOverview').mockRejectedValueOnce(new ApiError('Database unavailable', 503)).mockResolvedValue(empty)
    const user = userEvent.setup()
    open('/admin/analytics', 'admin')
    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(await screen.findByText(/No student sign-ins between/)).toBeInTheDocument()
    expect(screen.getByText('No students registered in this period.')).toBeInTheDocument()
    expect(screen.getByText('No quiz attempts were submitted in this period.')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('student progress dashboard', () => {
  it('shows the summary, charts and course details from the student’s own records', async () => {
    const quizStats = { id: 3, title: 'Loops quiz', attempts: 2, latestPercent: 80, bestPercent: 80, passed: true, passPercent: 50, questionCount: 5 }
    vi.spyOn(progressApi, 'mine').mockResolvedValue({
      courses: [{ courseId: 1, course: 'Python', category: 'CS', status: 'ongoing', percent: 50, completedModules: 1, totalModules: 2, nextModule: { id: 2, title: 'Functions' }, finalExam: null,
        modules: [{ id: 1, order: 1, title: 'Loops', required: true, completed: true, unlocked: true, locked: false, quiz: quizStats },
          { id: 2, order: 2, title: 'Functions', required: true, completed: false, unlocked: true, locked: false, quiz: null }] }],
      timeline: [{ id: 1, at: '2026-10-20T10:00:00Z', title: 'Loops quiz', type: 'module_quiz', course: 'Python', percent: 40, passed: false },
        { id: 2, at: '2026-10-22T10:00:00Z', title: 'Loops quiz', type: 'module_quiz', course: 'Python', percent: 80, passed: true }],
      moduleCompletions: ['2026-10-22T10:00:00Z'],
      summary: { courses: 1, completedCourses: 0, totalModules: 2, completedModules: 1, pendingModules: 1, overallPercent: 50, quizAttempts: 2, averageBestPercent: 80, bestPercent: 80,
        latest: { id: 2, at: '2026-10-22T10:00:00Z', title: 'Loops quiz', type: 'module_quiz', course: 'Python', percent: 80, passed: true } } })
    open('/student/progress')
    expect(await screen.findByTestId('overall-percent')).toHaveTextContent('50%')
    expect(screen.getByText('1 pending')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Quiz scores over time' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Completed and pending modules' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Python' })).toBeInTheDocument()
  })
})
