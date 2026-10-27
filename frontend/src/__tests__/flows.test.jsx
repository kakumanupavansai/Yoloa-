// UI flow tests (Vitest fixture mode). The API layer is spied on, so each screen is exercised against
// the exact response shapes the Django API returns, including its error responses.
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { adminApi, assessmentsApi, coursesApi, dashboardApi, examsApi, modulesApi, progressApi } from '../services/api'
import { ApiError } from '../services/http'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
const open = (path, role = 'student') => {
  localStorage.setItem('yoloa_role', role)
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

const course = (over = {}) => ({ id: 1, title: 'Python Programming Fundamentals', description: 'Learn Python.', category: 'Programming', level: 'Beginner',
  isPublished: true, cover: '', status: 'available', enrolled: false, percent: 0, modules: 3, chapters: 3, students: 4, professor: 'YOLOA Administrator', ...over })
const quizStats = (over = {}) => ({ id: 11, title: 'Module one quiz', passPercent: 50, questionCount: 2, attempts: 0, latestPercent: null, bestPercent: null, passed: false, ...over })
const detail = (over = {}) => ({
  id: 1, title: 'Python Programming Fundamentals', description: 'Learn Python.', category: 'Programming', level: 'Beginner', enrolled: true, percent: 33,
  completedModules: 1, status: 'ongoing', professor: { name: 'YOLOA Administrator' }, content: [], nextModule: { id: 102, title: 'Control flow' },
  chapters: [
    { id: 101, title: 'Getting started', description: '', duration: '45 mins', required: true, completed: true, unlocked: true, resourceCount: 3, quiz: quizStats({ attempts: 2, latestPercent: 100, bestPercent: 100, passed: true }) },
    { id: 102, title: 'Control flow', description: '', duration: '1 hr', required: true, completed: false, unlocked: true, resourceCount: 2, quiz: quizStats({ id: 12, title: 'Control flow quiz' }) },
    { id: 103, title: 'Functions', description: '', duration: '1 hr', required: true, completed: false, unlocked: false, resourceCount: 1, quiz: quizStats({ id: 13 }) },
  ],
  assessment: { finalExam: { id: 20, title: 'Final examination', durationSeconds: 600, passPercent: 60, questionCount: 6, eligible: false, inProgress: false,
    reasons: ['Pass the Control flow module quiz first.'], attempts: 0, passed: false } },
  ...over,
})

describe.skipIf(!MOCK)('student dashboard', () => {
  it('shows honest empty states for a student with no activity', async () => {
    open('/student/dashboard')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(await screen.findByText('You are not enrolled in any courses yet.')).toBeInTheDocument()
    expect(screen.getByText(/quiz results and completed modules will appear here/i)).toBeInTheDocument()
    expect(screen.getByText('Find your first course')).toBeInTheDocument()
  })

  it('renders stored progress and the next module from the API', async () => {
    vi.spyOn(dashboardApi, 'student').mockResolvedValue({
      announcement: 'Welcome to the new term', stats: { enrolled: 1, completed: 0, inProgress: 1, averageQuizPercent: 75, quizAttempts: 3, quizzesPassed: 1 },
      courses: [{ courseId: 1, course: 'Python Programming Fundamentals', category: 'Programming', status: 'ongoing', percent: 33, completedModules: 1, totalModules: 3, nextModule: { id: 102, title: 'Control flow' }, finalExam: { eligible: false } }],
      next: { courseId: 1, courseTitle: 'Python Programming Fundamentals', moduleId: 102, moduleTitle: 'Control flow', percent: 33 },
      recentActivity: [{ id: 'attempt-1', type: 'quiz', title: 'Getting started quiz', courseTitle: 'Python Programming Fundamentals', percent: 100, passed: true, at: '2026-10-24T10:00:00Z' }],
    })
    open('/student/dashboard')
    expect(await screen.findByText('Welcome to the new term')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /continue module/i })).toHaveAttribute('href', '/student/courses/1/modules/102')
    expect(screen.getByText('Getting started quiz')).toBeInTheDocument()
  })

  it('surfaces request errors with retry instead of substituting sample data', async () => {
    const request = vi.spyOn(dashboardApi, 'student').mockRejectedValue(new ApiError('Backend unavailable', 500))
    const user = userEvent.setup()
    open('/student/dashboard')
    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(request).toHaveBeenCalledTimes(2)
  })
})

describe.skipIf(!MOCK)('course library', () => {
  it('lists courses, filters them and enrolls through the API', async () => {
    const list = vi.spyOn(coursesApi, 'list')
      .mockResolvedValueOnce([course(), course({ id: 2, title: 'Web Development', category: 'Web', enrolled: true, status: 'ongoing', percent: 40 })])
      .mockResolvedValue([course({ enrolled: true, status: 'ongoing' }), course({ id: 2, title: 'Web Development', category: 'Web', enrolled: true, status: 'ongoing', percent: 40 })])
    const enroll = vi.spyOn(coursesApi, 'enroll').mockResolvedValue({ enrolled: true })
    const user = userEvent.setup()
    open('/student/courses')
    expect(await screen.findByRole('heading', { name: 'Course library' })).toBeInTheDocument()
    expect(await screen.findByText('Python Programming Fundamentals')).toBeInTheDocument()
    await user.type(screen.getByRole('searchbox', { name: /search courses/i }), 'web')
    expect(screen.queryByText('Python Programming Fundamentals')).not.toBeInTheDocument()
    await user.clear(screen.getByRole('searchbox', { name: /search courses/i }))
    await user.click(screen.getByRole('button', { name: /enroll in python programming fundamentals/i }))
    expect(enroll).toHaveBeenCalledWith(1)
    expect(await screen.findByText(/enrolled in python programming fundamentals/i)).toBeInTheDocument()
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('shows an empty state when no course is published', async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([])
    open('/student/courses')
    expect(await screen.findByText('No courses are available yet.')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('course outline and modules', () => {
  it('shows completed, available and locked modules and the locked final exam', async () => {
    vi.spyOn(coursesApi, 'get').mockResolvedValue(detail())
    open('/student/courses/1')
    expect(await screen.findByRole('heading', { name: 'Python Programming Fundamentals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open module Getting started' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Take quiz' })).toHaveAttribute('href', '/student/quizzes/12')
    expect(screen.getByRole('button', { name: 'Functions is locked' })).toBeDisabled()
    expect(screen.getByText('Pass the Control flow module quiz first.')).toBeInTheDocument()
    expect(screen.getByText(/latest 100% · best 100%/i)).toBeInTheDocument()
  })

  it('offers enrollment before the student joins and hides module actions', async () => {
    vi.spyOn(coursesApi, 'get').mockResolvedValueOnce(detail({ enrolled: false, assessment: null, chapters: detail().chapters.map((c) => ({ ...c, completed: false, unlocked: false, quiz: null })) }))
      .mockResolvedValue(detail())
    const enroll = vi.spyOn(coursesApi, 'enroll').mockResolvedValue({ enrolled: true })
    const user = userEvent.setup()
    open('/student/courses/1')
    await user.click(await screen.findByRole('button', { name: 'Enroll in this course' }))
    expect(enroll).toHaveBeenCalledWith('1')
    expect(await screen.findByRole('link', { name: 'Open module Control flow' })).toBeInTheDocument()
  })

  it('explains a locked module using the server refusal', async () => {
    vi.spyOn(modulesApi, 'get').mockRejectedValue(new ApiError('Complete the previous required module to unlock this one.', 403))
    open('/student/courses/1/modules/103')
    expect(await screen.findByRole('heading', { name: /not available yet/i })).toBeInTheDocument()
    expect(screen.getByText('Complete the previous required module to unlock this one.')).toBeInTheDocument()
  })

  it('renders module resources, a YouTube embed and the quiz entry point', async () => {
    vi.spyOn(modulesApi, 'get').mockResolvedValue({ id: 102, title: 'Control flow', description: 'Loops', order: 2, totalModules: 3, courseId: 1, courseTitle: 'Python',
      completed: false, quiz: quizStats({ id: 12 }), previous: { id: 101, title: 'Getting started' }, next: { id: 103, title: 'Functions', locked: true },
      resources: [
        { id: 1, type: 'video', title: 'Intro video', url: 'https://www.youtube.com/watch?v=rfscVS0vtbw', hasFile: false, text: '' },
        { id: 2, type: 'document', title: 'Notes', url: '', hasFile: true, fileName: 'notes.pdf', filePath: '/resources/2/file', text: '' },
      ] })
    const user = userEvent.setup()
    open('/student/courses/1/modules/102')
    expect(await screen.findByRole('heading', { name: 'Control flow' })).toBeInTheDocument()
    expect(screen.getByTitle('Intro video')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/rfscVS0vtbw')
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute('href', '/api/resources/2/file?download=1')
    await user.click(screen.getByRole('button', { name: 'View PDF' }))
    expect(screen.getByTitle('Notes (PDF viewer)')).toHaveAttribute('src', '/api/resources/2/file')
    expect(screen.getByRole('link', { name: 'Take the quiz' })).toHaveAttribute('href', '/student/quizzes/12')
    expect(screen.getByText(/Functions \(locked\)/)).toBeInTheDocument()
  })
})

const quizPayload = (over = {}) => ({ id: 12, title: 'Control flow quiz', assessmentType: 'module_quiz', courseId: 1, courseTitle: 'Python', moduleTitle: 'Control flow',
  questionCount: 2, totalPoints: 2, passPercent: 50, attempts: 0, passed: false, eligibility: { eligible: true, reasons: [] }, activeAttemptId: null,
  questions: [{ id: 1, text: 'What does range(3) produce?', questionType: 'single', choices: ['1,2,3', '0,1,2'], points: 1 },
    { id: 2, text: 'An elif runs only when earlier conditions are false.', questionType: 'true_false', choices: ['True', 'False'], points: 1 }], ...over })

describe.skipIf(!MOCK)('quizzes and the final exam', () => {
  it('takes a module quiz: answers autosave, the server scores it and the review is shown', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quizPayload())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockResolvedValue({ attemptId: 7, status: 'in_progress', answers: {}, answerVersion: 0, deadline: null, questions: quizPayload().questions })
    const save = vi.spyOn(assessmentsApi, 'save').mockImplementation((id, answers, version) => Promise.resolve({ answers, answerVersion: version + 1 }))
    const submit = vi.spyOn(assessmentsApi, 'submit').mockResolvedValue({ status: 'submitted', score: 2, total: 2, percent: 100, passed: true, passPercent: 50,
      review: [{ id: 1, text: 'What does range(3) produce?', questionType: 'single', choices: ['1,2,3', '0,1,2'], chosen: 1, correct: 1, correctAnswers: [1], isCorrect: true, points: 1, earned: 1 },
        { id: 2, text: 'An elif runs only when earlier conditions are false.', questionType: 'true_false', choices: ['True', 'False'], chosen: true, correctAnswers: [true], isCorrect: true, points: 1, earned: 1 }] })
    const user = userEvent.setup()
    open('/student/quizzes/12')
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    await user.click(await screen.findByRole('radio', { name: /0,1,2/ }))
    await user.click(screen.getByRole('button', { name: /next/i }))
    await user.click(screen.getByRole('radio', { name: /true/i }))
    await user.click(screen.getByRole('button', { name: 'Submit quiz' }))
    expect(await screen.findByText('Passed — module complete')).toBeInTheDocument()
    expect(submit).toHaveBeenCalledWith(7)
    expect(save).toHaveBeenLastCalledWith(7, { 1: 1, 2: true }, expect.any(Number))
    expect(screen.getByRole('heading', { name: 'Review your answers' })).toBeInTheDocument()
  })

  it('asks for confirmation before submitting with unanswered questions', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quizPayload())
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    vi.spyOn(assessmentsApi, 'start').mockResolvedValue({ attemptId: 7, answers: {}, answerVersion: 0, deadline: null, questions: quizPayload().questions })
    vi.spyOn(assessmentsApi, 'save').mockResolvedValue({ answerVersion: 1 })
    const submit = vi.spyOn(assessmentsApi, 'submit').mockResolvedValue({ status: 'submitted', score: 0, total: 2, percent: 0, passed: false, review: [] })
    const user = userEvent.setup()
    open('/student/quizzes/12')
    await user.click(await screen.findByRole('button', { name: 'Start quiz' }))
    await user.click(await screen.findByRole('button', { name: 'Submit quiz' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/2 unanswered question/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows latest, best and the attempt history before a retake', async () => {
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(quizPayload({ attempts: 2, latestPercent: 0, bestPercent: 100, passed: true }))
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([
      { id: 2, status: 'submitted', score: 0, total: 2, percent: 0, passed: false, submittedAt: '2026-10-24T10:00:00Z' },
      { id: 1, status: 'submitted', score: 2, total: 2, percent: 100, passed: true, submittedAt: '2026-10-23T10:00:00Z' }])
    open('/student/quizzes/12')
    expect(await screen.findByText('Latest 0%')).toBeInTheDocument()
    expect(screen.getByText('Best 100%')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Attempt history' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retake quiz' })).toBeInTheDocument()
  })

  it('runs the final exam countdown from the server deadline and clock, then auto-submits at zero', async () => {
    const final = quizPayload({ id: 20, title: 'Final examination', assessmentType: 'final_exam', passPercent: 60, durationSeconds: 600 })
    vi.spyOn(assessmentsApi, 'get').mockResolvedValue(final)
    vi.spyOn(assessmentsApi, 'history').mockResolvedValue([])
    // The browser clock is deliberately wrong by one hour; the countdown must still follow the server.
    const serverNow = Date.now() - 3600 * 1000
    vi.spyOn(assessmentsApi, 'start').mockResolvedValueOnce({ attemptId: 9, answers: {}, answerVersion: 0, questions: final.questions,
      serverTime: new Date(serverNow).toISOString(), deadline: new Date(serverNow + 90 * 1000).toISOString() })
    const user = userEvent.setup()
    const { unmount } = open('/student/exams/20')
    await user.click(await screen.findByRole('button', { name: 'Start exam' }))
    expect(await screen.findByRole('timer')).toHaveTextContent(/01:(29|30)/)
    unmount()

    vi.spyOn(assessmentsApi, 'start').mockResolvedValue({ attemptId: 10, answers: {}, answerVersion: 0, questions: final.questions,
      serverTime: new Date(serverNow).toISOString(), deadline: new Date(serverNow + 1000).toISOString() })
    const submit = vi.spyOn(assessmentsApi, 'submit').mockResolvedValue({ status: 'expired', score: 0, total: 2, percent: 0, passed: false, review: [] })
    open('/student/exams/20')
    await user.click(await screen.findByRole('button', { name: 'Start exam' }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(10), { timeout: 4000 })
    expect(await screen.findByText(/time expired — submitted automatically/i)).toBeInTheDocument()
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps the final exam locked with the server’s reasons', async () => {
    vi.spyOn(assessmentsApi, 'get').mockRejectedValue(new ApiError('Pass the Functions module quiz first.', 403))
    open('/student/exams/20')
    expect(await screen.findByRole('heading', { name: 'The final exam is locked' })).toBeInTheDocument()
    expect(screen.getByText('Pass the Functions module quiz first.')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('learning progress', () => {
  it('shows module status with latest and best quiz scores', async () => {
    vi.spyOn(progressApi, 'mine').mockResolvedValue({ courses: [{ courseId: 1, course: 'Python', category: 'Programming', status: 'ongoing', percent: 33, completedModules: 1, totalModules: 2, nextModule: { id: 2, title: 'Loops' },
      modules: [{ id: 1, order: 1, title: 'Basics', required: true, completed: true, unlocked: true, locked: false, quiz: quizStats({ attempts: 3, latestPercent: 40, bestPercent: 90, passed: true }) },
        { id: 2, order: 2, title: 'Loops', required: true, completed: false, unlocked: true, locked: false, quiz: null }], finalExam: null }] })
    open('/student/progress')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('40%')).toBeInTheDocument()
    expect(within(table).getByText('90%')).toBeInTheDocument()
    expect(within(table).getByText('No quiz')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('administrator workflows', () => {
  it('creates a course from the course list and opens the editor', async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([course()])
    const create = vi.spyOn(coursesApi, 'create').mockResolvedValue({ id: 5, title: 'Cloud 101' })
    vi.spyOn(coursesApi, 'manage').mockResolvedValue({ id: 5, title: 'Cloud 101', description: '', category: 'Cloud', level: 'Beginner', isPublished: false,
      modules: [], resources: [], finalExam: null, enrollments: [], stats: { students: 0, completed: 0 } })
    const user = userEvent.setup()
    open('/admin/courses', 'admin')
    await user.click(await screen.findByRole('button', { name: 'New course' }))
    const dialog = await screen.findByRole('dialog', { name: 'New course' })
    await user.type(within(dialog).getByLabelText('Course title'), 'Cloud 101')
    await user.click(within(dialog).getByRole('button', { name: 'Create course' }))
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].get('title')).toBe('Cloud 101')
    expect(await screen.findByRole('heading', { name: 'Cloud 101' })).toBeInTheDocument()
    expect(screen.getByText(/no modules yet/i)).toBeInTheDocument()
  })

  it('adds a module and links quiz creation to that module', async () => {
    const managed = { id: 5, title: 'Cloud 101', description: '', category: 'Cloud', level: 'Beginner', isPublished: true, resources: [], finalExam: null, enrollments: [], stats: { students: 0, completed: 0 } }
    vi.spyOn(coursesApi, 'manage').mockResolvedValueOnce({ ...managed, modules: [] })
      .mockResolvedValue({ ...managed, modules: [{ id: 50, title: 'Regions', description: '', duration: '', required: true, resources: [], quiz: null }] })
    const add = vi.spyOn(coursesApi, 'addModule').mockResolvedValue({ id: 50 })
    const user = userEvent.setup()
    open('/admin/courses/5', 'admin')
    await user.click(await screen.findByRole('button', { name: 'Add module' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add module' })
    await user.type(within(dialog).getByLabelText('Module title'), 'Regions')
    await user.click(within(dialog).getByRole('button', { name: 'Save module' }))
    expect(add).toHaveBeenCalledWith('5', expect.objectContaining({ title: 'Regions', required: true }))
    expect(await screen.findByRole('link', { name: 'Add quiz to Regions' })).toHaveAttribute('href', '/admin/exams/new?type=module_quiz&courseId=5&moduleId=50')
  })

  it('builds a module quiz with several question types and sends it to the server', async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([course({ id: 5, title: 'Cloud 101' })])
    vi.spyOn(coursesApi, 'manage').mockResolvedValue({ id: 5, title: 'Cloud 101', category: 'Cloud', description: '', level: 'Beginner', isPublished: true, resources: [], finalExam: null, enrollments: [], stats: { students: 0, completed: 0 }, modules: [{ id: 50, title: 'Regions', description: '', duration: '', required: true, quiz: null, resources: [] }] })
    const create = vi.spyOn(examsApi, 'create').mockResolvedValue({ id: 70, courseId: 5 })
    const user = userEvent.setup()
    open('/admin/exams/new?type=module_quiz&courseId=5&moduleId=50', 'admin')
    expect(await screen.findByRole('heading', { name: 'New module quiz' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Regions quiz'))
    await user.type(screen.getByLabelText('Question text'), 'Pick a region')
    for (const [index, text] of ['us-east', 'eu-west', 'ap-south', 'sa-east'].entries()) await user.type(screen.getByLabelText(`Choice ${'ABCD'[index]}`), text)
    await user.click(screen.getByLabelText('Choice B is correct'))
    await user.click(screen.getByRole('button', { name: 'Add question' }))
    const second = screen.getAllByRole('group', { name: /question 2/i })[0].closest('fieldset')
    await user.selectOptions(within(second).getByLabelText('Type'), 'short')
    await user.type(within(second).getByLabelText('Question text'), 'Name the service model for VMs')
    await user.type(within(second).getByLabelText('Expected answer'), 'IaaS')
    await user.click(screen.getByRole('button', { name: 'Save & publish' }))
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Assessment published.')).toBeInTheDocument()
    const payload = create.mock.calls[0][0]
    expect(payload).toMatchObject({ title: 'Regions quiz', assessmentType: 'module_quiz', courseId: 5, moduleId: 50, status: 'published', passPercent: 50 })
    expect(payload.questions[0]).toMatchObject({ questionType: 'single', correct: 1, choices: ['us-east', 'eu-west', 'ap-south', 'sa-east'] })
    expect(payload.questions[1]).toMatchObject({ questionType: 'short', expectedAnswer: 'IaaS' })
  })

  it('reports the server validation message when publishing fails', async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([course({ id: 5 })])
    vi.spyOn(coursesApi, 'manage').mockResolvedValue({ id: 5, title: 'Cloud 101', category: 'Cloud', description: '', level: 'Beginner', isPublished: true, resources: [], finalExam: null, enrollments: [], stats: { students: 0, completed: 0 }, modules: [] })
    vi.spyOn(examsApi, 'create').mockRejectedValue(new ApiError('Required module quizzes are missing for: Regions', 400))
    const user = userEvent.setup()
    open('/admin/exams/new?type=final_exam&courseId=5', 'admin')
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Cloud 101 — final examination'))
    await user.type(screen.getByLabelText('Question text'), 'Q?')
    for (const [index, text] of ['a', 'b', 'c', 'd'].entries()) await user.type(screen.getByLabelText(`Choice ${'ABCD'[index]}`), text)
    await user.click(screen.getByRole('button', { name: 'Save & publish' }))
    expect(await screen.findByText('Required module quizzes are missing for: Regions')).toBeInTheDocument()
  })

  it('searches and filters the student directory through the API and opens a student', async () => {
    const students = vi.spyOn(adminApi, 'students').mockResolvedValue({ results: [{ id: 3, name: 'Ada Lovelace', email: 'ada@example.com', registeredAt: '2026-10-01T00:00:00Z', lastLoginAt: null, enrollmentCount: 1, completedCount: 0, averageProgress: 33 }],
      page: 1, pageSize: 20, total: 1, pages: 1, summary: { total: 1, enrolled: 1, activeLast7Days: 0, neverLoggedIn: 1 } })
    const user = userEvent.setup()
    open('/admin/students', 'admin')
    expect(await screen.findByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute('href', '/admin/students/3')
    await user.selectOptions(screen.getByLabelText('Sign-in history'), 'never')
    await waitFor(() => expect(students).toHaveBeenLastCalledWith(expect.objectContaining({ login: 'never', page: 1 })))
    await user.type(screen.getByRole('searchbox', { name: /search students/i }), 'ada')
    await waitFor(() => expect(students).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'ada' })))
  })

  it('shows a student’s stored progress, attempts and sign-in history', async () => {
    vi.spyOn(adminApi, 'student').mockResolvedValue({ id: 3, name: 'Ada Lovelace', username: 'ada', email: 'ada@example.com', registeredAt: '2026-10-01T00:00:00Z', isActive: true, googleLinked: false,
      lastLoginAt: '2026-10-24T09:00:00Z', loginCount: 2, enrollmentCount: 1, completedCount: 0, city: '', country: '',
      metrics: { quizAttempts: 2, quizzesPassed: 1, averageQuizPercent: 75, finalAttempts: 0, finalsPassed: 0 },
      enrollments: [{ courseId: 1, course: 'Python', status: 'ongoing', percent: 50, completedModules: 1, totalModules: 2, modules: [{ id: 1, order: 1, title: 'Basics', required: true, completed: true, unlocked: true, locked: false, quiz: quizStats({ attempts: 2, latestPercent: 50, bestPercent: 100, passed: true }) }], finalExam: null }],
      attempts: [{ id: 8, title: 'Basics quiz', type: 'module_quiz', course: 'Python', status: 'submitted', score: 1, total: 2, percent: 50, passed: true, submittedAt: '2026-10-24T09:05:00Z' }],
      loginHistory: [{ id: 1, createdAt: '2026-10-24T09:00:00Z', authMethod: 'google', authMethodLabel: 'Google' }] })
    open('/admin/students/3', 'admin')
    expect(await screen.findByRole('heading', { name: 'Ada Lovelace' })).toBeInTheDocument()
    expect(screen.getByText('Basics quiz')).toBeInTheDocument()
    expect(screen.getByText('Google')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('mobile and tablet navigation', () => {
  it('opens from the hamburger, locks scroll, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    open('/student/dashboard')
    const burger = await screen.findByRole('button', { name: /open menu/i })
    await user.click(burger)
    const drawer = screen.getByRole('dialog', { name: /main menu/i })
    expect(within(drawer).getByRole('link', { name: 'Course library' })).toBeInTheDocument()
    // Messaging is implemented; postponed features are not offered as empty navigation items.
    expect(within(drawer).getByRole('link', { name: 'Messages' })).toBeInTheDocument()
    for (const name of [/notes/i, /calendar/i, /chat/i, /^library$/i]) expect(within(drawer).queryByRole('link', { name })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: /main menu/i })).not.toBeInTheDocument()
    expect(burger).toHaveFocus()
  })

  it('shows the administrator links for administrators', async () => {
    const user = userEvent.setup()
    open('/admin/dashboard', 'admin')
    await user.click(await screen.findByRole('button', { name: /open menu/i }))
    const drawer = screen.getByRole('dialog', { name: /main menu/i })
    for (const label of ['Courses', 'Assessments', 'Students', 'Analytics']) expect(within(drawer).getByRole('link', { name: label })).toBeInTheDocument()
  })
})
