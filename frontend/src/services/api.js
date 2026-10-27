// One function per backend endpoint. API failures are always propagated to the screen.
// Fixture data (data/mock.js) is reachable only in Vitest fixture mode (USE_MOCK), for the
// authentication and dashboard screens; every other call always goes to the Django API.
import * as m from '../data/mock'
import { BASE, del, get, patch, post, put, withMock, withMockFn } from './http'

const query = (params = {}) => {
  const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null))
  const text = new URLSearchParams(clean).toString()
  return text ? `?${text}` : ''
}

export const authApi = {
  csrf: () => get('/auth/csrf'),
  // `role` names the portal being used; the server decides the account's real role.
  login: ({ email, username, password, role }) =>
    withMock({ user: m.mockUsers[role || 'student'] }, () => post('/auth/login', { email: email || username, password, role })),
  me: () => withMock(m.mockUsers[localStorage.getItem('yoloa_role') || 'student'], () => get('/auth/me')),
  logout: () => withMock({ ok: true }, () => post('/auth/logout', {})),
  // Only the fields the server accepts are sent; role/staff flags can never be submitted from the form.
  register: ({ fullName, email, password, passwordConfirmation }) =>
    withMockFn(() => ({ user: { ...m.mockUsers.student, id: `s-${email}`, name: fullName, email, username: email.split('@')[0] } }),
      () => post('/auth/register', { fullName, email, password, passwordConfirmation })),
  requestPasswordReset: (email) => withMock({ message: 'If an account exists for that email, a password reset link has been sent. Check your inbox.', delivery: 'smtp' }, () => post('/auth/password-reset', { email })),
  validateResetLink: ({ uid, token }) => withMock({ valid: true }, () => post('/auth/password-reset/validate', { uid, token })),
  resetPassword: ({ uid, token, password, passwordConfirmation }) =>
    withMock({ message: 'Password updated. Please sign in with your new password.' }, () => post('/auth/password-reset/confirm', { uid, token, password, passwordConfirmation })),
  // Always changes the signed-in account's own password; no user id is sent.
  changePassword: ({ currentPassword, newPassword, newPasswordConfirmation }) =>
    post('/auth/password/change', { currentPassword, newPassword, newPasswordConfirmation }),
  googleStatus: () => withMock({ configured: true }, () => get('/auth/google/status')),
  googleStartUrl: () => `${BASE}/auth/google`,
  googleLinkUrl: () => `${BASE}/auth/google?mode=link`,
}

export const dashboardApi = {
  student: () => withMock(m.mockStudentDashboard, () => get('/student/dashboard')),
  admin: () => withMock(m.mockAdminDashboard, () => get('/admin/dashboard')),
}

export const progressApi = { mine: () => get('/student/progress') }

export const coursesApi = {
  list: () => get('/courses'),
  get: (id) => get(`/courses/${id}`),
  enroll: (id) => post(`/courses/${id}/enroll`, {}),
  unenroll: (id) => del(`/courses/${id}/enroll`),
  // Administrator course management
  create: (formData) => post('/courses', formData),
  update: (id, data) => patch(`/courses/${id}`, data),
  remove: (id) => del(`/courses/${id}`),
  manage: (id) => get(`/admin/courses/${id}`),
  addModule: (id, data) => post(`/courses/${id}/modules`, data),
  // Course-level material that does not belong to a single module.
  addResource: (id, formData) => post(`/courses/${id}/resources`, formData),
  reorderModules: (id, moduleIds) => post(`/courses/${id}/modules/order`, { moduleIds }),
}

export const modulesApi = {
  get: (id) => get(`/modules/${id}`),
  update: (id, data) => patch(`/modules/${id}`, data),
  remove: (id) => del(`/modules/${id}`),
  // Only modules without a quiz can be completed this way; the server enforces it.
  setComplete: (id, completed) => put(`/chapters/${id}/progress`, { completed }),
  addResource: (id, formData) => post(`/modules/${id}/resources`, formData),
}

export const resourcesApi = {
  update: (id, data) => patch(`/resources/${id}`, data),
  remove: (id) => del(`/resources/${id}`),
  // Files are streamed by Django after an enrollment/unlock check; this is never a public media URL.
  fileUrl: (resource, { download = false } = {}) => `${BASE}${resource.filePath}${download ? '?download=1' : ''}`,
}

// Module quizzes and final exams share one server-controlled attempt lifecycle.
export const assessmentsApi = {
  get: (id) => get(`/assessments/${id}`),
  start: (id) => post(`/assessments/${id}/start`, {}),
  save: (attemptId, answers, version) => put(`/attempts/${attemptId}/answers`, { answers, version }),
  submit: (attemptId) => post(`/attempts/${attemptId}/submit`, {}),
  attempt: (attemptId) => get(`/attempts/${attemptId}`),
  history: (id) => get(`/assessments/${id}/history`),
}

export const examsApi = {
  // Administrator assessment builder (responses include answer keys, so the endpoints are admin-only).
  list: () => get('/exams'),
  get: (id) => get(`/exams/${id}`),
  create: (exam) => post('/exams', exam),
  update: (id, changes) => put(`/exams/${id}`, changes),
  remove: (id) => del(`/exams/${id}`),
}

export const adminApi = {
  students: (params = {}) => get(`/admin/students${query(params)}`),
  student: (id) => get(`/admin/students/${id}`),
  attempt: (id) => get(`/admin/attempts/${id}`),
  reviewAttempt: (id, data) => post(`/admin/attempts/${id}/review`, data),
  loginAnalytics: (params = {}) => get(`/admin/analytics/logins${query(params)}`),
  examAnalytics: (params = {}) => get(`/admin/analytics/exams${query(params)}`),
  uploadQuestions: (formData) => post('/admin/question-imports/upload', formData),
  previewQuestions: (batchId, payload) => post(`/admin/question-imports/${batchId}/preview`, payload),
  confirmQuestions: (batchId, idempotencyKey) => post(`/admin/question-imports/${batchId}/confirm`, { idempotencyKey }),
}

export const announcementsApi = { create: (data) => post('/announcements', data) }

export const profileApi = {
  get: () => get('/profile'),
  update: (data) => put('/profile', data),
  uploadAvatar: (formData) => post('/profile/avatar', formData),
}

// Student messaging. Django stores every message before it is pushed over the WebSocket, so these endpoints are the
// source of truth for history, attachments and catching up after being offline.
export const messagesApi = {
  searchStudents: (q) => get(`/messages/students${query({ q })}`),
  conversations: () => get('/messages/conversations'),
  conversation: (id) => get(`/messages/conversations/${id}`),
  open: (userId) => post('/messages/conversations', { userId }),
  history: (id, { before, after, limit } = {}) => get(`/messages/conversations/${id}/messages${query({ before, after, limit })}`),
  // `clientId` makes retries safe: the server stores a message with a given clientId only once.
  send: (id, { body = '', clientId, files = [] }) => {
    if (!files.length) return post(`/messages/conversations/${id}/messages`, { body, clientId })
    const form = new FormData()
    form.append('body', body)
    form.append('clientId', clientId)
    files.forEach((file) => form.append('files', file))
    return post(`/messages/conversations/${id}/messages`, form)
  },
  markRead: (id, messageId) => post(`/messages/conversations/${id}/read`, { messageId }),
  sync: (after) => get(`/messages/sync${query({ after })}`),
  unread: () => get('/messages/unread'),
  attachmentUrl: (attachment, { download = false } = {}) => `${BASE}${attachment.url}${download ? '?download=1' : ''}`,
}
