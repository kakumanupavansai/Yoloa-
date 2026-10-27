# YOLOA LMS – Frontend (React + Vite + Tailwind)

## Run
```bash
npm install
npm run dev        # http://localhost:5173 – /api is proxied to Django on :8000
npm run build      # production bundle in dist/
npm test           # Vitest UI flows (fixture/spy mode, see .env.test)
```
Open the app on `localhost` so the Django session cookie (and the Google OAuth state) is shared with the API.

## Screens → routes
| Screen | Route | File |
|---|---|---|
| Portal choice · sign-in · register · password reset | `/` · `/login` · `/admin/login` · `/register` · `/forgot-password` · `/reset-password` | `pages/*.jsx` |
| Student dashboard | `/student/dashboard` | `pages/student/Dashboard.jsx` |
| Course library | `/student/courses` | `pages/student/Courses.jsx` |
| My courses | `/student/my-courses` | `pages/student/MyCourses.jsx` |
| Course outline (lock states, final exam card) | `/student/courses/:id` | `pages/student/CourseDetail.jsx` |
| Module page (YouTube, PDF viewer, downloads, quiz entry) | `/student/courses/:courseId/modules/:moduleId` | `pages/student/ModuleView.jsx` |
| Module quiz · final exam | `/student/quizzes/:id` · `/student/exams/:id` | `pages/student/QuizTake.jsx` |
| Learning progress | `/student/progress` | `pages/student/Progress.jsx` |
| Profile (both roles) | `/student/profile` · `/admin/profile` | `pages/student/Profile.jsx` |
| Admin dashboard | `/admin/dashboard` | `pages/admin/Dashboard.jsx` |
| Courses · course editor (modules, resources, quizzes, enrollments) | `/admin/courses` · `/admin/courses/:id` | `pages/admin/Courses.jsx` · `CourseEditor.jsx` |
| Assessments · quiz / final-exam builder | `/admin/exams` · `/admin/exams/new` · `/admin/exams/:id` | `pages/admin/Exams.jsx` · `QuizEditor.jsx` |
| Student directory · student detail | `/admin/students` · `/admin/students/:id` | `pages/admin/Students.jsx` · `StudentDetail.jsx` |
| Analytics · question import | `/admin/analytics` · `/admin/question-import` | `pages/admin/Analytics.jsx` · `QuestionImport.jsx` |

Route guards (`routes/ProtectedRoute.jsx`) only choose screens; every permission is enforced again by Django.

## Data and errors
- `services/http.js` sends the session cookie and the CSRF token on every write; `services/api.js` has one function per endpoint.
- API failures are shown with a retry button (`components/ui/States.jsx`); the app never substitutes sample data.
- Identical GET requests that overlap in time share one network request (`get()` in `services/http.js`), so React
  StrictMode's double mount in development does not double the API traffic. Nothing is cached: the entry is removed when
  the response arrives, and any POST/PUT/PATCH/DELETE clears all entries. `useApi` applies only the newest response.
- Starting a quiz/exam goes through one shared request per assessment (`startAttempt` in `QuizTake.jsx`); the server also
  resumes the existing attempt if two starts race.
- `VITE_PROXY_TARGET` (default `http://localhost:8000`) points the dev-server `/api` proxy at another Django instance.
- `src/data/mock.js` holds neutral Vitest fixtures for the auth and dashboard screens only. `USE_MOCK` is true only when Vitest runs
  in `test` mode with `.env.test`; a dev server or production build cannot switch to fixtures.
- Module/quiz lock states, scores, deadlines and progress are rendered from server responses. The final-exam countdown is computed
  from the server's `deadline` and `serverTime` (correcting for a wrong browser clock); the server decides expiry.

## Design
LearnSpace-style layout (sidebar + top bar on desktop, slide-in menu below 1024 px) with the YOLOA logo and brand blues.
Tokens live in `tailwind.config.js` (DM Sans / Plus Jakarta Sans, `brand`, `ink`, `line`, `ground`, `success`, `warning`, `danger`);
shared classes (`.card`, `.btn-*`, `.input`, `.badge-*`, `.table`) in `src/index.css`; shared components in `components/ui/`
(`Primitives.jsx`, `States.jsx`, `Feedback.jsx` for modal/toast/confirm, `Icons.jsx`).

## Tests
- `src/__tests__/auth.test.jsx` – portals, sign-in, registration, password reset, route boundaries.
- `src/__tests__/flows.test.jsx` – dashboard, library, course outline, module page, quiz/exam runner (autosave, confirm,
  server-clock countdown, auto-submit), progress, admin course/module/quiz management, student directory/detail, mobile menu.
- `src/__tests__/quiz-regressions.test.jsx` – score/question-count display, weighted points, start de-duplication under
  StrictMode and rapid clicks, start retry, resume, expired session, GET de-duplication and stale-response handling.
- `src/__tests__/integration.test.jsx` – live end-to-end checks against Django + PostgreSQL (skipped unless
  `VITE_USE_MOCK=false VITE_TEST_DB_IS_DISPOSABLE=true`; see the root README).
