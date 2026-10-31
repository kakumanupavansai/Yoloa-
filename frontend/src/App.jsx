import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { FeedbackProvider } from './components/ui/Feedback'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute, { AuthLoading, PublicOnlyRoute } from './routes/ProtectedRoute'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'

// Signed-in areas load on demand, so the first screen (portal choice and sign-in) only needs the public auth pages.
// This keeps the module graph a cold Vite dev server must transform before first paint small, and splits the production bundle.
const AppLayout = lazy(() => import('./components/layout/AppLayout'))
const StudentDashboard = lazy(() => import('./pages/student/Dashboard'))
const Courses = lazy(() => import('./pages/student/Courses'))
const MyCourses = lazy(() => import('./pages/student/MyCourses'))
const CourseDetail = lazy(() => import('./pages/student/CourseDetail'))
const ModuleView = lazy(() => import('./pages/student/ModuleView'))
const QuizTake = lazy(() => import('./pages/student/QuizTake'))
const Progress = lazy(() => import('./pages/student/Progress'))
const Profile = lazy(() => import('./pages/student/Profile'))
const Messages = lazy(() => import('./pages/student/Messages'))
const Community = lazy(() => import('./pages/student/Community'))
const AdminDashboard = lazy(() => import('./pages/admin/Dashboard'))
const AdminCourses = lazy(() => import('./pages/admin/Courses'))
const CourseEditor = lazy(() => import('./pages/admin/CourseEditor'))
const QuizEditor = lazy(() => import('./pages/admin/QuizEditor'))
const Students = lazy(() => import('./pages/admin/Students'))
const StudentDetail = lazy(() => import('./pages/admin/StudentDetail'))
const Analytics = lazy(() => import('./pages/admin/Analytics'))

// Old lesson-player links now open the course outline, which shows each module's lock state.
function LegacyWatch() {
  const { id } = useParams()
  return <Navigate to={`/student/courses/${id}`} replace />
}

export default function App() {
  return (
    <ThemeProvider>
    <FeedbackProvider>
      <Suspense fallback={<AuthLoading label="Loading…" />}>
      <Routes>
        {/* Public authentication screens; signed-in users are sent to their own dashboard. */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login role="student" />} />
          <Route path="/student/login" element={<Navigate to="/login" replace />} />
          <Route path="/admin/login" element={<Login role="admin" />} />
          <Route path="/register" element={<Register />} />
        </Route>
        {/* Password recovery stays reachable regardless of session state. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        <Route element={<ProtectedRoute role="student" />}>
          <Route path="/student" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<StudentDashboard />} />
            <Route path="courses" element={<Courses />} />
            <Route path="my-courses" element={<MyCourses />} />
            <Route path="courses/:id" element={<CourseDetail />} />
            <Route path="courses/:id/watch" element={<LegacyWatch />} />
            <Route path="courses/:courseId/modules/:moduleId" element={<ModuleView />} />
            <Route path="quizzes/:id" element={<QuizTake />} />
            <Route path="exams/:id" element={<QuizTake final />} />
            <Route path="progress" element={<Progress />} />
            <Route path="community" element={<Community />} />
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:conversationId" element={<Messages />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute role="admin" />}>
          <Route path="/admin" element={<AppLayout />}>
            <Route index element={<Navigate to="dashboard" replace />} />
            <Route path="dashboard" element={<AdminDashboard />} />
            <Route path="courses" element={<AdminCourses />} />
            <Route path="courses/:id" element={<CourseEditor />} />
            <Route path="course-creation" element={<Navigate to="/admin/courses?new=1" replace />} />
            {/* The separate Assessments list was removed: quizzes are managed from their course module. */}
            <Route path="exams" element={<Navigate to="/admin/courses" replace />} />
            <Route path="exams/new" element={<QuizEditor />} />
            <Route path="exams/:id" element={<QuizEditor />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentDetail />} />
            <Route path="analytics" element={<Analytics />} />
            {/* Excel import lives inside Add / Edit Quiz now. */}
            <Route path="question-import" element={<Navigate to="/admin/courses" replace />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </FeedbackProvider>
    </ThemeProvider>
  )
}
