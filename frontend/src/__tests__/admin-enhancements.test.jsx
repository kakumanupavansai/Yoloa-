// Assessment search, Excel import on the assessment edit page, course-page resource/quiz/exam controls and the
// profile password change (Vitest fixture mode; the API layer is spied on with the Django response shapes).
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { AuthProvider } from '../context/AuthContext'
import { adminApi, authApi, coursesApi, examsApi, modulesApi, profileApi, resourcesApi } from '../services/api'
import { ApiError } from '../services/http'
import { guessMapping } from '../components/admin/QuestionImportPanel'

const MOCK = String(import.meta.env.VITE_USE_MOCK) === 'true'
const open = (path, role = 'admin') => {
  localStorage.setItem('yoloa_role', role)
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>)
}
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

const exam = (id, over = {}) => ({ id, title: `Quiz ${id}`, subject: '', questions: 3, points: 3, status: 'Draft', assessmentType: 'module_quiz',
  assessmentTypeLabel: 'Module quiz', passPercent: 50, courseId: 1, courseTitle: 'Python Programming', moduleId: id, moduleTitle: `Module ${id}`, ...over })

describe.skipIf(!MOCK)('removed assessments list', () => {
  it('sends the old Assessments and Question import addresses to Courses', async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([])
    for (const path of ['/admin/exams', '/admin/question-import']) {
      const view = open(path)
      expect(await screen.findByRole('heading', { name: 'Courses' })).toBeInTheDocument()
      view.unmount()
    }
  })
})

describe('Excel column guessing', () => {
  it('maps common header names and leaves unknown ones unmapped', () => {
    expect(guessMapping(['Question Type', 'Question', 'Choices', 'Correct Answer', 'Points', 'Notes'])).toEqual({
      questionType: 'Question Type', questionText: 'Question', options: 'Choices', correctAnswer: 'Correct Answer', marks: 'Points', acceptedAlternatives: '',
    })
  })
})

const editable = (questions = []) => ({ ...exam(7, { title: 'Sorting quiz', status: 'Draft' }), courseId: 5, moduleId: 50, attempts: 0, questions })
const managed = { id: 5, title: 'Algorithms', description: '', category: 'CS', level: 'Beginner', isPublished: true, enrollments: [], stats: { students: 0, completed: 0 },
  resources: [], finalExam: null, modules: [{ id: 50, title: 'Sorting', description: '', duration: '', required: true, resources: [], quiz: null }] }

describe.skipIf(!MOCK)('Excel import on the assessment edit page', () => {
  const preview = { validCount: 2, invalidCount: 0, blankRows: [], errors: [], preview: [
    { text: 'Capital of France?', questionType: 'single', choices: ['Paris', 'Rome'], correctAnswers: [0], points: 2, expectedAnswer: '', acceptedAlternatives: [] },
    { text: 'Language of Django?', questionType: 'short', choices: [], correctAnswers: [], points: 1, expectedAnswer: 'Python', acceptedAlternatives: [] },
  ] }
  const setup = () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([{ id: 5, title: 'Algorithms' }])
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(managed)
    const get = vi.spyOn(examsApi, 'get').mockResolvedValueOnce(editable([{ id: 1, text: 'Existing?', questionType: 'true_false', choices: ['True', 'False'], correctAnswers: [true], points: 1 }]))
      .mockResolvedValue(editable([{ id: 1, text: 'Existing?', questionType: 'true_false', choices: ['True', 'False'], correctAnswers: [true], points: 1 },
        { id: 2, text: 'Capital of France?', questionType: 'single', choices: ['Paris', 'Rome'], correctAnswers: [0], points: 2 },
        { id: 3, text: 'Language of Django?', questionType: 'short', choices: [], correctAnswers: [], expectedAnswer: 'Python', acceptedAlternatives: [], points: 1 }]))
    const upload = vi.spyOn(adminApi, 'uploadQuestions').mockResolvedValue({ batchId: 'b1', exam: { id: 7, title: 'Sorting quiz', questionCount: 1 },
      sheets: [{ name: 'Questions', headers: ['Type', 'Question', 'Options', 'Answer', 'Marks'], rows: 2 }] })
    return { get, upload }
  }
  const workbook = () => new File(['PK'], 'questions.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

  it('validates, previews and imports into this assessment, then shows the stored questions', async () => {
    const { get, upload } = setup()
    const previewCall = vi.spyOn(adminApi, 'previewQuestions').mockResolvedValue(preview)
    let release
    const confirm = vi.spyOn(adminApi, 'confirmQuestions').mockImplementation(() => new Promise((resolve) => { release = () => resolve({ imported: 2, rejected: 0, alreadyImported: false }) }))
    const user = userEvent.setup()
    open('/admin/exams/7')
    await user.click(await screen.findByRole('button', { name: 'Import Questions from Excel' }))
    const dialog = await screen.findByRole('dialog', { name: 'Import Questions from Excel' })
    expect(within(dialog).getByText('Sorting quiz')).toBeInTheDocument()
    await user.upload(within(dialog).getByLabelText(/excel workbook/i), workbook())
    await user.click(within(dialog).getByRole('button', { name: 'Upload workbook' }))
    expect(upload.mock.calls[0][0].get('examId')).toBe('7')
    await user.click(await within(dialog).findByRole('button', { name: 'Validate and preview' }))
    expect(previewCall).toHaveBeenCalledWith('b1', { sheet: 'Questions', mapping: { questionType: 'Type', questionText: 'Question', options: 'Options', correctAnswer: 'Answer', marks: 'Marks', acceptedAlternatives: '' } })
    expect(await within(dialog).findByText('Capital of France?')).toBeInTheDocument()
    expect(within(dialog).getByText('A. Paris')).toBeInTheDocument()
    const confirmButton = within(dialog).getByRole('button', { name: 'Confirm import of 2 questions' })
    confirmButton.click(); confirmButton.click()  // two clicks in the same tick, before React re-renders
    expect(confirm).toHaveBeenCalledTimes(1)
    const importing = await within(dialog).findByRole('button', { name: /importing/i })
    expect(importing).toBeDisabled()
    await user.click(importing)
    expect(confirm).toHaveBeenCalledTimes(1)
    release()
    expect(await screen.findByText('Imported 2 questions from Excel.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByLabelText('Question text')).toHaveLength(3))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('lists row errors and does not allow confirming an invalid workbook', async () => {
    setup()
    vi.spyOn(adminApi, 'previewQuestions').mockResolvedValue({ validCount: 1, invalidCount: 1, blankRows: [4], preview: preview.preview.slice(0, 1),
      errors: [{ row: 3, message: 'Question 3: unsupported question type.' }] })
    const confirm = vi.spyOn(adminApi, 'confirmQuestions')
    const user = userEvent.setup()
    open('/admin/exams/7?import=1')
    const dialog = await screen.findByRole('dialog', { name: 'Import Questions from Excel' })
    await user.upload(within(dialog).getByLabelText(/excel workbook/i), workbook())
    await user.click(within(dialog).getByRole('button', { name: 'Upload workbook' }))
    await user.click(await within(dialog).findByRole('button', { name: 'Validate and preview' }))
    expect(await within(dialog).findByText('Row 3: Question 3: unsupported question type.')).toBeInTheDocument()
    expect(within(dialog).getByText(/1 blank row ignored \(4\)/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /confirm import/i })).toBeDisabled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('rejects non-.xlsx files before uploading and shows server workbook errors', async () => {
    const { upload } = setup()
    upload.mockRejectedValueOnce(new ApiError('file: This file is not a valid .xlsx workbook.', 400))
    const user = userEvent.setup({ applyAccept: false })
    open('/admin/exams/7?import=1')
    const dialog = await screen.findByRole('dialog', { name: 'Import Questions from Excel' })
    await user.upload(within(dialog).getByLabelText(/excel workbook/i), new File(['a,b'], 'questions.csv', { type: 'text/csv' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose an Excel workbook saved as .xlsx.')
    expect(within(dialog).getByRole('button', { name: 'Upload workbook' })).toBeDisabled()
    await user.upload(within(dialog).getByLabelText(/excel workbook/i), workbook())
    await user.click(within(dialog).getByRole('button', { name: 'Upload workbook' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^This file is not a valid .xlsx workbook.$/)
  })

  it('saves a brand-new quiz as a draft and then opens the import, so the first quiz of a module can import too', { timeout: 20000 }, async () => {
    vi.spyOn(coursesApi, 'list').mockResolvedValue([{ id: 5, title: 'Algorithms' }])
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(managed)
    const create = vi.spyOn(examsApi, 'create').mockResolvedValue({ id: 7, courseId: 5 })
    vi.spyOn(examsApi, 'get').mockResolvedValue(editable([]))
    const user = userEvent.setup()
    open('/admin/exams/new?type=module_quiz&courseId=5&moduleId=50')
    const button = await screen.findByRole('button', { name: 'Import Questions from Excel' })
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Sorting quiz'))
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create.mock.calls[0][0]).toMatchObject({ status: 'draft', courseId: 5, moduleId: 50, questions: [] })
    expect(await screen.findByRole('dialog', { name: 'Import Questions from Excel' })).toBeInTheDocument()
  })
})

describe.skipIf(!MOCK)('course page resource, quiz and final exam controls', () => {
  const withQuiz = { ...managed, resources: [{ id: 90, moduleId: null, type: 'link', title: 'Syllabus', url: 'https://example.com', text: '', hasFile: false, fileName: '' }],
    finalExam: { id: 80, title: 'Algorithms final', status: 'published', questionCount: 4, attempts: 1, passPercent: 60, durationSeconds: 600 },
    modules: [{ ...managed.modules[0], resources: [{ id: 91, moduleId: 50, type: 'video', title: 'Intro video', url: 'https://youtu.be/abcdefghijk', text: '', hasFile: false, fileName: '' }],
      quiz: { id: 7, title: 'Sorting quiz', status: 'draft', passPercent: 50, questionCount: 3, attempts: 0 } },
    { id: 51, title: 'Graphs', description: '', duration: '', required: true, resources: [], quiz: null }] }

  it('adds course-level and module-level resources from the course page', async () => {
    const manage = vi.spyOn(coursesApi, 'manage').mockResolvedValue(withQuiz)
    const courseAdd = vi.spyOn(coursesApi, 'addResource').mockResolvedValue({ id: 92 })
    const moduleAdd = vi.spyOn(modulesApi, 'addResource').mockResolvedValue({ id: 93 })
    const user = userEvent.setup()
    open('/admin/courses/5')
    await user.click(await screen.findByRole('button', { name: 'Add Resource' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add resource' })
    expect(within(dialog).getByLabelText('Belongs to')).toHaveValue('course')
    await user.selectOptions(within(dialog).getByLabelText('Type'), 'link')
    await user.type(within(dialog).getByLabelText('Title'), 'Reading list')
    await user.type(within(dialog).getByLabelText('Link'), 'https://example.com/reading')
    await user.click(within(dialog).getByRole('button', { name: 'Add resource' }))
    await waitFor(() => expect(courseAdd).toHaveBeenCalledTimes(1))
    expect(courseAdd.mock.calls[0][0]).toBe(5)
    expect(courseAdd.mock.calls[0][1].get('title')).toBe('Reading list')

    await user.click(await screen.findByRole('button', { name: 'Add resource to Graphs' }))
    dialog = await screen.findByRole('dialog', { name: 'Add resource' })
    expect(within(dialog).getByLabelText('Belongs to')).toHaveValue('51')
    await user.type(within(dialog).getByLabelText('Title'), 'Graph video')
    await user.type(within(dialog).getByLabelText('YouTube link'), 'https://youtu.be/abcdefghijk')
    await user.click(within(dialog).getByRole('button', { name: 'Add resource' }))
    await waitFor(() => expect(moduleAdd).toHaveBeenCalledWith(51, expect.any(FormData)))
    expect(manage.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('edits and deletes existing resources', async () => {
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(withQuiz)
    const update = vi.spyOn(resourcesApi, 'update').mockResolvedValue({ id: 91 })
    const remove = vi.spyOn(resourcesApi, 'remove').mockResolvedValue(null)
    const user = userEvent.setup()
    open('/admin/courses/5')
    await user.click(await screen.findByRole('button', { name: 'Manage resources (1)' }))
    await user.click(screen.getByRole('button', { name: 'Edit resource Intro video' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit resource' })
    expect(within(dialog).queryByLabelText('Belongs to')).not.toBeInTheDocument()
    await user.clear(within(dialog).getByLabelText('Title')); await user.type(within(dialog).getByLabelText('Title'), 'Sorting intro')
    await user.click(within(dialog).getByRole('button', { name: 'Save resource' }))
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update.mock.calls[0][0]).toBe(91)
    expect(update.mock.calls[0][1].get('title')).toBe('Sorting intro')
    await user.click(screen.getByRole('button', { name: 'Delete resource Syllabus' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete resource?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(90))
  })

  it('offers Edit quiz for a module with a quiz, Add quiz otherwise, and final exam actions', async () => {
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(withQuiz)
    vi.spyOn(examsApi, 'get').mockResolvedValue({ ...editable([{ id: 1, text: 'Fastest average sort?', questionType: 'single', choices: ['Bubble', 'Quick'], correctAnswers: [1], points: 1 }]), status: 'Draft' })
    const user = userEvent.setup()
    open('/admin/courses/5')
    expect(await screen.findByRole('link', { name: 'Edit quiz Sorting quiz' })).toHaveAttribute('href', '/admin/exams/7')
    expect(screen.queryByRole('link', { name: 'Add quiz to Sorting' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add quiz to Graphs' })).toHaveAttribute('href', '/admin/exams/new?type=module_quiz&courseId=5&moduleId=51')
    expect(screen.getByRole('link', { name: 'Edit final exam' })).toHaveAttribute('href', '/admin/exams/80')
    expect(screen.getByRole('link', { name: /import questions from excel/i })).toHaveAttribute('href', '/admin/exams/80?import=1')
    expect(screen.queryByRole('link', { name: 'Add final exam' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview quiz Sorting quiz' }))
    const dialog = await screen.findByRole('dialog', { name: 'Preview: Sorting quiz' })
    expect(await within(dialog).findByText('Fastest average sort?')).toBeInTheDocument()
    expect(within(dialog).getByText('(correct)').closest('li')).toHaveTextContent('Quick')
  })

  it('offers Add final exam when the course has none', async () => {
    vi.spyOn(coursesApi, 'manage').mockResolvedValue(managed)
    open('/admin/courses/5')
    expect(await screen.findByRole('link', { name: 'Add final exam' })).toHaveAttribute('href', '/admin/exams/new?type=final_exam&courseId=5')
  })

  it('keeps students out of the course management page', async () => {
    const manage = vi.spyOn(coursesApi, 'manage')
    open('/admin/courses/5', 'student')
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(manage).not.toHaveBeenCalled()
  })
})

describe.skipIf(!MOCK)('student password change', () => {
  const profile = (over = {}) => ({ id: 's1', name: 'Test Learner', role: 'student', email: 'learner@example.test', username: 'learner', firstName: 'Test', lastName: 'Learner',
    address: '', city: '', country: '', postalCode: '', avatar: '', googleLinked: false, hasPassword: true, ...over })
  const fill = async (user, current, next, confirm) => {
    if (current) await user.type(screen.getByLabelText('Current Password'), current)
    if (next) await user.type(screen.getByLabelText('New Password'), next)
    if (confirm) await user.type(screen.getByLabelText('Confirm New Password'), confirm)
    await user.click(screen.getByRole('button', { name: 'Change Password' }))
  }

  it('checks the confirmation before calling the server', async () => {
    vi.spyOn(profileApi, 'get').mockResolvedValue(profile())
    const change = vi.spyOn(authApi, 'changePassword')
    const user = userEvent.setup()
    open('/student/profile', 'student')
    await screen.findByRole('heading', { name: 'Change Password' })
    await fill(user, 'old-password', 'Fresh-horse-482', 'Fresh-horse-483')
    expect(screen.getByText('The new passwords do not match.')).toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
  })

  it('submits once, shows success and clears every password field', async () => {
    vi.spyOn(profileApi, 'get').mockResolvedValue(profile())
    let release
    const change = vi.spyOn(authApi, 'changePassword').mockImplementation(() => new Promise((resolve) => { release = () => resolve({ message: 'Your password has been changed.' }) }))
    const user = userEvent.setup()
    open('/student/profile', 'student')
    await screen.findByRole('heading', { name: 'Change Password' })
    await fill(user, 'old-password', 'Fresh-horse-482', 'Fresh-horse-482')
    expect(screen.getByRole('button', { name: /changing password/i })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: /changing password/i }))
    expect(change).toHaveBeenCalledTimes(1)
    expect(change).toHaveBeenCalledWith({ currentPassword: 'old-password', newPassword: 'Fresh-horse-482', newPasswordConfirmation: 'Fresh-horse-482' })
    expect(Object.keys(change.mock.calls[0][0])).not.toContain('userId')
    release()
    expect(await screen.findByText(/Your password has been changed\./)).toBeInTheDocument()
    for (const label of ['Current Password', 'New Password', 'Confirm New Password']) expect(screen.getByLabelText(label)).toHaveValue('')
  })

  it('shows the server’s field errors for a wrong current password or weak new password', async () => {
    vi.spyOn(profileApi, 'get').mockResolvedValue(profile())
    vi.spyOn(authApi, 'changePassword')
      .mockRejectedValueOnce(new ApiError('Your current password is incorrect.', 400, { errors: { currentPassword: ['Your current password is incorrect.'] } }))
      .mockRejectedValueOnce(new ApiError('Please choose a stronger password.', 400, { errors: { newPassword: ['This password is too common.'] } }))
    const user = userEvent.setup()
    open('/student/profile', 'student')
    await screen.findByRole('heading', { name: 'Change Password' })
    await fill(user, 'wrong-password', 'Fresh-horse-482', 'Fresh-horse-482')
    expect(await screen.findAllByText('Your current password is incorrect.')).toHaveLength(2)
    expect(screen.getByLabelText('Current Password')).toHaveValue('wrong-password')
    await user.click(screen.getByRole('button', { name: 'Change Password' }))
    expect(await screen.findByText('This password is too common.')).toBeInTheDocument()
  })

  it('points Google-only accounts to password reset instead', async () => {
    vi.spyOn(profileApi, 'get').mockResolvedValue(profile({ hasPassword: false, googleLinked: true }))
    open('/student/profile', 'student')
    expect(await screen.findByRole('link', { name: 'Forgot password' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument()
  })
})
