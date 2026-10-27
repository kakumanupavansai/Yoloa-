# YOLOA LMS – Django REST backend (PostgreSQL)

Backend for the YOLOA React frontend. Endpoints/JSON shapes match `frontend/src/services/api.js`.

## 1. Setup
```bash
pip install -r requirements.txt
cp .env.example .env          # set DB_*, DJANGO_SECRET_KEY, DEMO_ADMIN_PASSWORD, DEMO_STUDENT_PASSWORD (+ Google / SMTP if used)
```
### PostgreSQL (required)
PostgreSQL is the only supported database; `config/settings.py` has no SQLite fallback, so a wrong or missing credential fails
loudly. Create the database once (`CREATE DATABASE yoloa;`), then:
```bash
python manage.py migrate
python manage.py seed            # fresh demo catalogue + demo admin/student; idempotent, refuses to run on non-PostgreSQL
python manage.py runserver       # http://localhost:8000
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print(connection.vendor)"  # -> postgresql
```
The seed never prints passwords; the demo accounts use `DEMO_ADMIN_EMAIL`/`DEMO_ADMIN_PASSWORD` and
`DEMO_STUDENT_EMAIL`/`DEMO_STUDENT_PASSWORD` from `.env` (re-apply them with `python manage.py seed --reset-passwords`).
Tests: `python manage.py test lms --noinput` — Django creates and destroys `test_<DB_NAME>` on the same PostgreSQL server
(override the name with `DB_TEST_NAME`; `--noinput` replaces a test database left behind by an interrupted run instead of
waiting at a prompt).

Driver and connection pool: `requirements.txt` installs psycopg 3 with `psycopg_pool`. Opening a PostgreSQL connection costs
roughly 100 ms on Windows and `runserver` uses a new thread per request, so without a pool every signed-in request paid that
cost. `settings.py` therefore enables Django's built-in pool (`DB_POOL=1` by default; `DB_POOL_MIN`/`DB_POOL_MAX`, default
2/10). `DB_POOL=0`, or an install with only psycopg2, falls back to per-thread persistent connections (`CONN_MAX_AGE=60`).

Uploaded course resources are stored in `PRIVATE_MEDIA_ROOT` (default `backend/private_media/`, git-ignored), which is never
served as static files; `/api/resources/<id>/file` streams them only to administrators and to enrolled students who have
unlocked that module. Avatars and course covers stay in `media/`.

## 2. Test with Postman
Import `postman/YOLOA-LMS.postman_collection.json` and `postman/YOLOA-Local.postman_environment.json`, select *YOLOA Local*,
and fill in the `studentPassword` / `adminPassword` environment values (secret type; nothing is stored in the collection).

## 3. Connect the React frontend
`frontend/.env` uses `VITE_API_URL=/api`; `vite.config.js` proxies `/api` → `http://localhost:8000`.
`CORS_ALLOWED_ORIGINS` / `CSRF_TRUSTED_ORIGINS` cover production-style cross-origin setups.

## 4. API summary
The browser uses Django database-backed sessions in an HTTP-only cookie. Mutating requests send Django's CSRF token. SimpleJWT remains available only for the maintained Postman/non-browser integration at `/api/auth/token` and `/api/auth/refresh`; the browser never stores or sends those tokens. Errors are `{ "message": "...", "errors": {...} }`.

| Endpoint | Who | Notes |
|---|---|---|
| GET `/api/auth/csrf` | public | sets the CSRF cookie used by browser sign-in and writes |
| POST `/api/auth/login` | public | `{email,password,role}` → `{user}`; creates a session; 403 if role mismatches |
| POST `/api/auth/register` | public | `{fullName,email,password,passwordConfirmation}` → student session |
| POST `/api/auth/logout` | signed in | destroys the current session |
| GET `/api/auth/me` | signed in | current session user |
| POST `/api/auth/password-reset` | public | generic response (same for unknown emails) with `delivery`: `smtp` or `development` (console); 503 when SMTP is selected but `EMAIL_HOST` is blank |
| POST `/api/auth/password-reset/validate` | public | `{uid,token}`; lets the reset page reject invalid, expired, or used links before showing the form |
| POST `/api/auth/password-reset/confirm` | public | `{uid,token,password,passwordConfirmation}`; reset tokens expire in one hour and are single-use |
| GET `/api/auth/google/status` | public | `{configured}` only; never exposes the client ID or secret |
| GET `/api/auth/google` · callback | public | student-only server-side OAuth code flow with state, nonce, and PKCE |
| POST `/api/auth/token` · `/api/auth/refresh` | legacy clients | non-browser SimpleJWT compatibility for Postman |
| GET `/api/student/dashboard` | any | leaderboard = top 4 by total quiz score |
| GET `/api/admin/dashboard` | admin | `stats.total` = students registered, `newThisWeek`, `enrolled` (joined ≥1 course); no schedule |
| POST `/api/announcements` | admin | `{text}` |
| GET `/api/courses` · POST `/api/courses` | any · admin | POST is multipart (`cover` file, `chapters` JSON string) |
| DELETE `/api/courses/:id` | admin | deletes the course + chapters, lesson content, enrollments, progress; linked exams are kept |
| GET `/api/courses/:id` | any | includes `enrolled`, `percent`, and `chapters[{id,title,duration,completed}]` |
| POST / DELETE `/api/courses/:id/enroll` | student | enroll is idempotent (201 first time, then 200); unenroll keeps chapter progress |
| GET `/api/courses/:id/player` | enrolled student / admin | 403 `Enroll in this course to start learning.` if not enrolled; modules carry `completed` + `videoUrl` |
| PUT `/api/chapters/:id/progress` (quiz-less modules only) | enrolled student | `{completed: true or false}` → `{percent,status,currentChapter,courseCompleted}`; 100% flips the course to *completed* |
| PATCH `/api/courses/:id` | admin | edit title/description/category/level/`isPublished`/dates/cover (JSON or multipart) |
| GET `/api/admin/courses/:id` | admin | full management view: ordered modules with resources and quiz summary, final exam, enrollments |
| POST `/api/courses/:id/modules` · POST `/api/courses/:id/modules/order` | admin | add a module · reorder with `{moduleIds:[…]}` (every id exactly once) |
| GET / PATCH / DELETE `/api/modules/:id` | student (unlocked) / admin | module page with resources, quiz stats and prev/next; DELETE is 409 when its quiz has attempts |
| GET / POST `/api/modules/:id/resources` | student (unlocked) / admin | POST multipart: `type` video\|document\|presentation\|link\|text, `title`, `url`, `text`, `file` (≤ 25 MB, extension allow-list) |
| PATCH / DELETE `/api/resources/:id` · GET `/api/resources/:id/file` | admin · enrolled+unlocked | private file stream (`?download=1` forces download; PDFs open inline) |
| GET `/api/student/progress` | student | per course: module states, latest/best/attempts per quiz, final exam summary |
| GET `/api/admin/attempts/:id` | admin | finalized attempt with review and manual-review audit trail |
| GET `/api/quizzes` · `/api/quizzes/:id` · POST `/api/quizzes/:id/attempts` | any | list/detail include `attempts` + `bestScore`; detail has `durationMinutes`; POST answers `{questionId: choiceIndex}` → `{score,total,percent,review[]}` (review reveals correct answers *after* submitting); unanswered = skipped |
| GET/POST `/api/exams` · GET/PUT/DELETE `/api/exams/:id` | **admin only** | the exam builder (responses include correct answers). `status`: `draft` or `published` |
| GET `/api/library` · GET `/api/notes/apps` | any | |
| GET `/api/calendar?year=&month=` · POST `/api/calendar` | any | |
| GET/PUT `/api/profile` · POST `/api/profile/avatar` | any | avatar is multipart field `avatar` |

## 5. Module progression – how it works
- `lms.views.course_progress()` is the single source of truth used by every response **and** every guard.
- A module with a published module quiz is complete only when that quiz has a passing finalized attempt (stored in `Attempt`;
  passing also writes a `ChapterProgress` row). A module without a quiz is completed explicitly via `PUT /api/chapters/:id/progress`.
  Opening a module never completes it.
- Module *N+1* unlocks only when every earlier **required** module is complete. Optional modules never block progress.
  Locked modules, their quizzes, resources and files return **403** — the browser cannot unlock anything.
- Module quiz pass mark: `Exam.pass_percent` (default **50 %**, configurable 1–100). Final exams are fixed at **60 %** and
  **600 seconds**. Every attempt is kept; latest and best are reported separately; a failed retake never removes an earlier pass
  or a completed course.
- `GET /courses` shows students only published courses (plus ones they are already enrolled in); unpublished courses cannot be
  newly enrolled.

## 6. Exams = Quizzes (one table)
Admin **Exams** and student **Quizzes** are the *same* `Exam` records:
- **Published** → shows up in the student *Quizzes* list (same id, title, subject, questions, points, duration).
- **Draft** → admin only. **Unpublish** (PUT `{status:"draft"}`) hides it again; attempt history is kept.
- **Delete** an exam with no history → it disappears for students too. Assessments with attempts are retained and must be archived/unpublished to preserve the audit trail.
- Publishing is validated: at least one question, every question needs text + 2 choices, and the correct choice can't be empty (otherwise 400 with a readable `message`).
- Students never receive correct answers until after they submit; `/api/exams*` is admin-only for that reason.
- Upgrading an existing database: just run `python manage.py migrate` (migration `0003` drops the old `kind` column; no data is lost – old quizzes and exams simply appear in both places).

## 7. Models (lms/models.py)
User(role) · Course · Chapter · CourseContent · Enrollment · Exam(assessment_type) · Question · Attempt · GradingReview · LoginEvent · QuestionImportBatch · LibraryItem · Announcement · CalendarEvent · ScheduleItem · Assignment.
Manage everything in `/admin/` (upload covers, library files, add students and enrollments).

## 8. Assessment 2.0 and administration
- A course can have unlimited published module quizzes and one published final exam. Required chapters must have a passed module quiz before the final can start.
- Final attempts always use a server-side 600-second deadline and a 60% pass mark. Refresh/reconnect resumes the same in-progress attempt; answer saves are versioned, expiry is finalized server-side, and submission is idempotent.
- Every attempt is retained. Students may retake module quizzes and finals without losing the latest or best result. Passing a final marks the enrollment complete; later failed retakes never remove that completion.
- `GET /api/assessments`, `/api/assessments/:id`, `/api/assessments/:id/history`, `POST /api/assessments/:id/start`, `PUT /api/attempts/:id/answers`, and `POST /api/attempts/:id/submit` are the student assessment API. Answers are never returned before finalization.
- Admin-only `/api/admin/students`, `/api/admin/students/:id`, `/api/admin/analytics/logins`, and `/api/admin/analytics/exams` provide directory and aggregate reporting without passwords, private answers, or personal countdowns.
- Excel imports use `/api/admin/question-imports/upload`, `/preview`, and `/confirm`. Uploads are staged, worksheet/column mapping is explicit, validation happens before confirmation, and confirmation is transactional/idempotent. `.xlsx` files are limited to 5 MB and parsed with `openpyxl` in read-only/data-only mode.
- Run `python manage.py finalize_expired_attempts` from cron, Celery, or a task scheduler at least once per minute as a backstop for attempts whose browser has disconnected.

Question types are `single`, `multiple`, `true_false`, and `short`. Multiple-answer questions are all-or-nothing. Short answers use configured accepted answers for automatic scoring and can be changed through the admin review endpoint with an audit record.

## 9. Real-time messaging (app `messaging`)
One-to-one private conversations between active students. Django Channels runs on the ASGI app in `config/asgi.py`;
Daphne is first in `INSTALLED_APPS`, so `manage.py runserver` serves HTTP and WebSockets. Redis is the channel layer
(`CHANNEL_REDIS_URL`, default `redis://127.0.0.1:6379/0`, key prefix `CHANNEL_REDIS_PREFIX`, default `yoloa` for the
`yoloa` database and `yoloa-<DB_NAME>` for any other, so servers for different databases sharing one Redis never deliver
one database's messages to another's users).

- **Storage first:** every message is committed to PostgreSQL, then pushed (`transaction.on_commit`). If Redis is down the
  message is still stored and delivered when the other browser reconnects (`GET /api/messages/sync?after=<last id>`).
- **WebSocket** `ws(s)://<host>/ws/messages/`: Origin must be listed in `WEBSOCKET_ALLOWED_ORIGINS` (default
  `CSRF_TRUSTED_ORIGINS`); the Django session cookie authenticates it; anonymous users, admins and invalid sessions are
  rejected at the handshake. Each socket joins only its own user's group, so a client can never subscribe to someone
  else's conversation. Frames: `message.send {conversationId, body, clientId}`, `conversation.read {conversationId, messageId}`,
  `typing {conversationId}`, `ping`. Every write re-checks the live session and conversation membership; the sender is
  always the session user. Signing out closes the user's sockets; password changes/deactivation close them within 15 s.
- **HTTP** (student only, CSRF-protected writes): `GET messages/students?q=`, `GET|POST messages/conversations`
  (`{userId}` opens or reuses the pair's conversation), `GET messages/conversations/<id>`,
  `GET messages/conversations/<id>/messages?before=|after=|limit=`, `POST …/messages` (JSON or multipart `body`, `clientId`,
  `files`), `POST …/read {messageId}`, `GET messages/sync?after=`, `GET messages/unread`, `GET messages/attachments/<id>`.
  Non-members get 404. `clientId` (UUID) makes sends idempotent across WebSocket and HTTP retries.
- **Attachments:** up to 5 per message, 10 MB each (`MAX_CHAT_ATTACHMENT_BYTES`); jpg/png/gif/webp (verified with Pillow),
  pdf, doc/xls/ppt, docx/xlsx/pptx and UTF-8 txt/csv, checked by content, not by extension or browser type. Stored under
  `PRIVATE_MEDIA_ROOT/chat_attachments/` with random names and streamed only to the two members (`nosniff`, sandbox CSP;
  only images are inline).
- **Startup check:** `python manage.py check_redis` (PING + one throwaway channel-layer round trip; read-only).

Production: run an ASGI server (`daphne config.asgi:application` or uvicorn) behind a proxy that forwards WebSocket upgrades;
use Redis with a password and TLS, set via the environment only (`CHANNEL_REDIS_URL=rediss://:<password>@host:6380/0`),
never in source; keep Redis off the public network; serve over HTTPS so the socket is `wss://`.

## Before production
Set a real `DJANGO_SECRET_KEY`, `DJANGO_DEBUG=False`, proper `ALLOWED_HOSTS`, serve media via S3/nginx, and add pagination if lists grow.

Settings are read from `backend/.env` (loaded explicitly from the backend folder; variables already set in the shell win). Copy `.env.example` to `.env` and put real credentials only in `.env`, which is gitignored. Restart `runserver` after editing it; Vite only needs a restart when `frontend/.env` changes.

`POST /api/auth/login` takes an optional `role` naming the portal (`student` or `admin`). It never grants privileges: a mismatch with the stored account role returns 403 without creating a session.

For Google sign-in, the authorised redirect URI registered on the Google OAuth web client must exactly match `GOOGLE_OAUTH_REDIRECT_URI` (scheme, host, port, and path), otherwise Google shows `Error 400: redirect_uri_mismatch`. Open the frontend on `localhost` (not `127.0.0.1`) so the session cookie that carries the OAuth state is sent to the callback. For Google sign-in, create a Google OAuth web client and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and the registered redirect URI (`GOOGLE_OAUTH_REDIRECT_URI`). The default local callback is `http://localhost:8000/api/auth/google/callback`. For password reset delivery, configure an SMTP `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, and TLS/SSL settings. Without SMTP, Django prints reset messages to the backend terminal for local development. Production should set both session and CSRF cookie secure flags, use HTTPS, and set `SameSite=None` only when the frontend and API are truly cross-site.
