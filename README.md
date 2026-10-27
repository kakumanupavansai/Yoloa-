# YOLOA LMS – "You Only Learn Once"

A full-stack learning management system with separate **student** and **administrator** portals.

| Part | Stack | Folder |
|---|---|---|
| Frontend | React 18 · Vite · Tailwind CSS · React Router | `frontend/` |
| Backend | Django 5 · Django REST Framework · session + CSRF auth | `backend/` |
| Database | **PostgreSQL** (required — there is no SQLite fallback) | database `yoloa` |
| API testing | Postman collection + environment (credentials are environment variables) | `backend/postman/` |

## Learning workflow
Administrator creates a course → adds ordered modules → attaches resources (YouTube, PDF/documents, PowerPoint, links, notes)
→ creates a quiz per required module → creates the final exam → student registers/signs in → browses the library → enrolls
→ studies module resources → takes the module quiz → **passing unlocks the next module** → after every required module quiz is
passed the **final exam** (600 s server deadline, 60 % pass mark, unlimited attempts) unlocks → results appear on the student
dashboard/progress page and in the administrator's student detail.

All rules are enforced by Django, not the browser: module unlocking, resource access, quiz/exam eligibility, scoring, deadlines and
completion. Answer keys are never sent before an attempt is finalized.

## Quick start (two terminals)

**1. Backend** (http://localhost:8000)
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env          # fill in DB_PASSWORD, DJANGO_SECRET_KEY, DEMO_* passwords, optional Google/SMTP settings
# PostgreSQL must be running and the database must exist:  CREATE DATABASE yoloa;
python manage.py migrate
python manage.py seed          # fresh demo data; safe to re-run (idempotent)
python manage.py runserver
```
**2. Frontend** (http://localhost:5173)
```bash
cd frontend
npm install
npm run dev
```
`/api` and the messaging WebSocket `/ws` are proxied to `127.0.0.1:8000` (`frontend/vite.config.js`). Open the app on
**localhost** (not 127.0.0.1) so the session cookie and Google OAuth state cookie are shared with the API.

### Real-time messaging: local startup order
Student messaging needs Redis (the Django Channels layer) and an ASGI server. With Daphne in `INSTALLED_APPS`,
`python manage.py runserver` already *is* the ASGI server (the startup banner says
"Starting ASGI/Daphne … development server"), so the commands stay the same:

1. **Start Ubuntu (WSL2)** so its Redis service is running: open an Ubuntu terminal, or run `wsl -e true` from Windows.
2. **Check Redis** (read-only: PING plus one throwaway channel-layer round trip; never writes data or changes Redis):
   ```bash
   cd backend
   python manage.py check_redis
   ```
   If it fails, start Redis inside Ubuntu: `sudo service redis-server start`.
3. **Start Django (ASGI/Daphne):** `python manage.py runserver` (or, without the dev server, `daphne -b 127.0.0.1 -p 8000 config.asgi:application`).
4. **Start Vite:** `cd frontend && npm run dev`.
5. **Test:** sign in as two different students (for example one in a normal window and one in a private window), open
   **Messages**, search for the other student and send messages and attachments both ways.

If Redis is down, messages are still stored and can be sent (over HTTP); they appear in the other browser when it reconnects
or reloads, not instantly. Redis URL: `CHANNEL_REDIS_URL` (default `redis://127.0.0.1:6379/0`). Details:
`backend/README.md` → *Real-time messaging*.

### Demo accounts
`python manage.py seed` creates `DEMO_ADMIN_EMAIL` (administrator portal, `/admin/login`) and `DEMO_STUDENT_EMAIL` (student portal,
`/login`) with the passwords set in `backend/.env` (`DEMO_ADMIN_PASSWORD`, `DEMO_STUDENT_PASSWORD`). Passwords are never printed or
stored in source. New students can also register at `/register`. Administrators cannot self-register.

Seeded catalogue: *Python Programming Fundamentals*, *Web Development with HTML & CSS* (one optional module) and
*Data Structures Essentials* — each with module quizzes and a final exam — plus an unpublished draft course
(*Cloud Computing Basics*) to demonstrate publishing. No student progress or attempts are invented.

If the first page load after `npm run dev` is slow, check free memory first: Vite pre-bundles dependencies on a cold start and
that step slows down sharply when Windows is paging (for example with many idle Gradle daemons running; `gradle --stop` ends them).
Keep `node_modules/.vite` between runs; deleting it forces the slow pre-bundling step again.

## Features
**Student:** dashboard (enrolled courses, next module, quiz performance, final-exam status, recent activity), course library
(search, category and enrollment filters), My courses, course outline with locked/unlocked modules, module page with embedded
YouTube, in-browser PDF viewer and downloads, module quizzes (single choice, multiple correct, true/false, short answer) with
attempt history and latest/best scores, server-timed final exam with resume/autosave, learning-progress page, profile with
Google account linking and **Change Password** (current password required; this session stays signed in, other sessions are
signed out; Google-only accounts are pointed to "Forgot password"), and **Messages**: one-to-one private conversations with
other students (student search, real-time delivery over a WebSocket, image and document attachments, unread counts and "Seen"
receipts, typing indicator, history paging, and automatic recovery of messages sent while the browser was offline). Messages
are stored in PostgreSQL before they are delivered; administrators have no access to student conversations.

**Administrator:** dashboard with real metrics, course management (create/edit/publish/delete), module add/edit/reorder/delete,
resource upload and links, quiz builder for every question type with configurable pass marks (default 50 %), final-exam builder,
course page actions (**Add Resource** to the whole course or a module, edit/delete resources, Add/Edit/Preview quiz per module,
Add/Edit/Preview/import for the final exam), assessment list with **search** (title, course, module, type) and paging,
**Import Questions from Excel** on each assessment's edit page, enrollment/progress per course, student directory (search, filters, sorting, pagination), student detail
(module progress, every attempt, latest/best results, final exams, sign-in history) with audited manual score review,
sign-in/exam analytics, staged Excel question import, announcements.

Excel import format: an `.xlsx` workbook (max 5 MB) whose first row holds column headings. Map the columns (common names such as
*Question Type, Question, Options, Correct Answer, Points, Also accept* are pre-selected): type `single` / `multiple` /
`true_false` / `short`; options separated by `|`, `;` or `,`; correct answer as a letter (A–H), 1-based number, option text,
`true`/`false`, or the expected short answer. Every row is validated on the server and the preview lists row errors; nothing is
imported while any row is invalid, retries are idempotent, and questions already in the assessment are rejected as duplicates.

**Auth:** Django sessions + CSRF for browsers, student registration, email/password, Google OAuth (state, nonce, PKCE,
verified-email, no silent account linking, students only), password reset with expiring single-use tokens, separate
administrator sign-in without Google.

Postponed (not shown in navigation): personal notes, personal library/bookmarks and the AI chatbot. The older
calendar/notes/library endpoints remain on the backend but are not part of the student UI.

## Tests
```bash
cd backend  && python manage.py test lms messaging --noinput  # PostgreSQL: Django creates/destroys test_yoloa
# messaging.tests.RedisChannelLayerTests uses the real Redis (isolated key prefix) and is reported as skipped when Redis is down
cd frontend && npm test                           # UI flows (Vitest; fixture/spy mode from .env.test)
cd frontend && npm run build                      # production build
```
Live end-to-end suite (destructive — use a disposable database such as `yoloa_e2e`):
```bash
# backend terminal
DB_NAME=yoloa_e2e python manage.py migrate && DB_NAME=yoloa_e2e python manage.py seed && DB_NAME=yoloa_e2e python manage.py runserver
# frontend terminal
VITE_USE_MOCK=false VITE_TEST_DB_IS_DISPOSABLE=true VITE_API_URL=http://localhost:8000/api \
VITE_E2E_ADMIN_EMAIL=admin@yoloa.local VITE_E2E_ADMIN_PASSWORD=<admin password of that database> npx vitest run src/__tests__/integration.test.jsx
```

Run `python manage.py finalize_expired_attempts` once a minute (cron/Task Scheduler) as a backstop for final-exam attempts whose
browser disconnected; expired attempts are also finalized automatically on the next related request.

## Before deploying
Real `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, `DJANGO_ALLOWED_HOSTS`, HTTPS with `SESSION_COOKIE_SECURE=1` and
`CSRF_COOKIE_SECURE=1`, an SMTP `EMAIL_BACKEND`, the production Google redirect URI, `npm run build`, and storage for
`backend/media/` (avatars, covers) and `backend/private_media/` (course resource files — must **not** be served publicly).
More detail: `backend/README.md`.
