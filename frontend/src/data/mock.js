// Vitest-only fixtures. services/http.js enables them only when MODE === 'test' and VITE_USE_MOCK=true
// (.env.test), so they can never appear in `npm run dev` or a production build.
export const mockUsers = {
  student: { id: 's1', name: 'Test Learner', role: 'student', email: 'learner@example.test', username: 'learner', firstName: 'Test', lastName: 'Learner', address: '', city: '', country: '', postalCode: '', avatar: '', googleLinked: false },
  admin: { id: 'a1', name: 'Test Administrator', role: 'admin', email: 'admin@example.test', username: 'admin', firstName: 'Test', lastName: 'Administrator', avatar: '' },
}

export const mockStudentDashboard = {
  announcement: '',
  stats: { enrolled: 0, completed: 0, inProgress: 0, averageQuizPercent: null, quizAttempts: 0, quizzesPassed: 0 },
  courses: [],
  next: null,
  recentActivity: [],
}

export const mockAdminDashboard = {
  announcements: [],
  courses: [],
  recentLogins: [],
  recentAttempts: [],
  stats: { total: 0, newThisWeek: 0, enrolled: 0, courses: 0, publishedCourses: 0, modules: 0, enrollments: 0, completedEnrollments: 0,
    averageProgress: null, quizAttempts: 0, finalAttempts: 0, finalPassed: 0, activeLast7Days: 0 },
}
