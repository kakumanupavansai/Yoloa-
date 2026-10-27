# YOLOA: admin enhancements, password change and first-load performance

Date: 2026-10-25. Database: PostgreSQL `yoloa` (checked: `connection.vendor == 'postgresql'`). No migrations were needed
(`makemigrations --check` reports no changes; `showmigrations` all applied). Browser checks that write data ran against the
disposable `yoloa_e2e` database. The `yoloa` record counts were the same before and after the work (see F).

Legend: **Implemented** = code written. **Tested** = automated test. **Verified** = exercised in a real browser against Django + PostgreSQL.

## A. Excel import

- **UI location.** Assessments → Edit (any assessment) → *Import Questions from Excel* button above the question list. It opens
  a dialog with the target assessment fixed. Also linked from each row of the Assessments list (*Import*) and from the course
  page's final-exam section. The standalone *Question import* page now uses the same panel. For a brand-new assessment the button
  is disabled until it is saved as a draft (an import needs an assessment id).
- **Flow.** Choose file → upload → worksheet + column mapping (common header names are pre-selected) → *Validate and preview*
  (server-side) → table of questions with correct answers + row-by-row errors → *Confirm import* → the editor reloads the
  questions from the server and a success message is shown.
- **Formats and types.** `.xlsx` (max 5 MB). Single choice, multiple correct, true/false, short answer (with accepted
  alternatives). Points, options and correct answers are preserved. There is no *explanation* field in the question model, so
  none is imported.
- **Validation (backend, all reused from the existing importer plus additions).** Extension, size, ZIP signature (renamed CSV/XLS
  rejected), readable workbook, a sheet with headings and rows, required mappings, mapped columns must exist in the sheet,
  per-row question type / text / options / correct answer / marks via the same `question_data` rules the editor uses.
  Completely blank rows are listed as "blank rows ignored" (not silently). Any invalid row blocks the whole import.
- **Duplicates and safety.** One idempotency key per uploaded batch, so a retried confirmation returns `alreadyImported` without
  adding rows; a different key on a confirmed batch gets 409. Questions whose text already exists in the assessment are rejected
  in preview, and re-checked at confirmation (a second batch previewed earlier gets 409). Import runs in a transaction with the
  assessment row locked, refuses while a student has an attempt in progress, and appends after the existing question order.
  The client also blocks a double click before React re-renders (found in the browser check, fixed, test added).
- **Files.** `backend/lms/views.py` (import upload/preview/confirm), `frontend/src/components/admin/QuestionImportPanel.jsx` (new),
  `frontend/src/pages/admin/QuizEditor.jsx`, `frontend/src/pages/admin/QuestionImport.jsx`.
- **Tests.** Backend (`lms/test_admin_enhancements.py`, `ExcelImportTests`): valid import of all four types into the selected
  assessment only, question order, invalid workbook / wrong extension / empty sheet, missing and unknown columns, invalid type,
  invalid answer letter, missing multiple answers, invalid true/false, zero marks, duplicate of an existing question, whole import
  blocked by one bad row, idempotent retry, stale second batch, student and anonymous refused. Frontend: preview + confirm flow,
  same-tick double click sends one request, row errors disable confirm, non-.xlsx rejected client-side, server error text shown.
  **Verified** in the browser: 4-question workbook imported into "Stacks and queues quiz" (2 → 6 questions), double confirm
  produced one import on the server.

## B. Course management enhancements

- **Course-level resources.** New endpoint `GET/POST /api/courses/<id>/resources` (admin-only POST; students need an enrollment to
  read). Same validation and private file storage as module resources (shared `create_resource` helper). Course page: *Add Resource*
  button in the header with a *Belongs to* selector (whole course or a module), and a *Course materials* section with edit/delete.
- **Module-level actions.** Each module card: *Edit module*, *Add resource* (pre-selects that module), *Manage resources (n)*
  (expandable list with edit/delete per resource), and a quiz strip: *Preview quiz* + *Edit quiz* when a quiz exists, otherwise
  *Add quiz* (links to the quiz builder with the course and module fixed). Editing a resource can replace or remove its file.
- **Final exam.** *Edit final exam*, *Import questions from Excel*, *Preview final exam* when one exists; *Add final exam* otherwise.
  The 600 s duration and 60 % pass mark remain forced by the server; duplicates still return 409 (existing constraint + check).
- **Preview.** New read-only admin dialog listing questions with the answer key (data from the admin-only `/api/exams/<id>`).
- **Files.** `backend/lms/views.py`, `backend/lms/urls.py`, `frontend/src/pages/admin/CourseEditor.jsx`,
  `frontend/src/components/admin/AssessmentPreview.jsx` (new), `frontend/src/services/api.js`.
- **Tests.** Backend (`CourseManagementTests`): course and module resource creation keep their association, private file path,
  invalid YouTube link rejected, edit and delete, student cannot add, enrollment needed to read, module quiz create / duplicate
  409 / wrong-course module 400 / edit, final exam create (600 s, 60 % forced) / duplicate 409 / edit, students refused on all
  admin actions. Frontend: course and module resource dialogs call the right endpoint, edit/delete, Edit vs Add quiz, final exam
  actions, preview dialog marks the correct answer, students redirected away. **Verified** in the browser: added a course link
  and a module YouTube video to "Data Structures Essentials", saw both in the right place, opened the quiz preview.

## C. Assessment search

- **Search fields.** Title, course, module, assessment type label and subject; every word must match; case- and accent-insensitive.
- **Behaviour.** Works with the type filter; clearing restores the full list; paging (15 per page) resets to page 1 when the search
  or filter changes; "No assessments match “…”" message; loading and error-with-retry states come from the existing `Async`
  wrapper; Edit and Import actions stay on every row.
- **Decision.** Client-side. `GET /api/exams` already returns every assessment in one unpaginated response (10 rows in the seed),
  so no second API or server-side paging was added.
- **Files.** `frontend/src/pages/admin/Exams.jsx`.
- **Tests.** Unit test of the matcher; UI tests for title, course, module, filter combination, clearing, no-result, paging reset,
  error + retry. **Verified** in the browser on 10 real assessments ("data structures" → 3 rows, unknown term → message).

## D. Student password change

- **Frontend.** Profile → *Change Password* card: Current / New / Confirm New Password with show/hide controls, client checks
  (required, 8+ characters, match), disabled button with spinner, ref-based guard against double submit, server field errors
  shown next to the fields, success message, all three fields cleared on success. Google-only accounts (no usable password) see
  a link to *Forgot password* instead. The card also appears for administrators on their profile (same endpoint, own account).
- **Backend.** `POST /api/auth/password/change` with `currentPassword`, `newPassword`, `newPasswordConfirmation`. Requires an
  authenticated session and the CSRF header; always changes `request.user` (submitted ids are ignored); verifies the current
  password; rejects mismatch, unchanged password and anything Django's validators reject; 5 wrong current passwords per 15 min →
  429. Nothing is logged or returned except a message. `/api/auth/me` now also returns `hasPassword`.
- **Sessions.** `update_session_auth_hash` keeps the current session signed in; Django's session hash check signs out every other
  session of that account.
- **Tests.** Backend (`PasswordChangeTests`): success, current session kept, other session gets 401, old password fails and new
  password works at login, wrong current password, mismatch, too short, too common, same as current, throttling, unauthenticated
  401, missing CSRF header 403 with CSRF enforcement on, submitted user ids ignored, Google-only account. Frontend: mismatch
  without a request, one request on double submit, fields cleared, server errors, Google-only message. **Verified** in the
  browser on `yoloa_e2e`: mismatch, wrong current password, too short, success with fields cleared and session kept, old password
  401 / new password 200 at login, change without CSRF header 403.

## E. Initial load performance

Measured in the desktop app's built-in browser with a separate Vite server per run (own port, own cache folder) proxied to
your running Django on port 8000. Each fresh-server run used a new origin, so the browser cache was empty.

| Stage (fresh Vite server, browser cache empty) | Before | After |
|---|---|---|
| `npm run dev` until Vite reports ready | 1.0–2.5 s | 1.1–2.5 s (unchanged) |
| HTML response (TTFB) | ~0.1 s | ~0.1 s |
| Modules requested for the first screen | 56 | 31 |
| Landing page usable (`/api/auth/me` done), 3 runs, dependency cache present | 6.1 / 6.6 / 3.8 s, **median 6.1 s** | 0.96 / 0.58 / 1.20 s, **median 0.96 s** |
| Reload on the same server | ~0.4 s | ~0.18 s |
| Dependency cache missing (first ever start) | 28.8 s (main.jsx waited 19.8 s on pre-bundling) | 8.2 s (one run) |
| Django: first DB connection / `/api/auth/me` | 86 ms / 4–420 ms | same |

- **Measured root cause of the 30–40 s.** Not the backend or PostgreSQL (first connection 86 ms, auth calls tens to a few hundred
  ms). Not auth/session initialisation or a hanging request (the auth bootstrap is two requests that finish quickly). The one
  ~30 s load reproduced was a cold dependency pre-bundle: `/src/main.jsx` waited 19.8 s for Vite to pre-bundle React and the
  router, then 8.5 s for the bundled files. Repeat cold runs on the same machine took 3.5–8 s, so most of that time is the machine,
  not the code: during the session Windows was near its memory commit limit (37.3 GB of 39.1 GB, about 1.1 GB RAM free, CPU 51–85 %)
  with **17 Gradle daemons using ~12 GB** (started by VS Code's Java/Gradle tooling) plus several Electron apps.
  Your dependency cache (`node_modules/.vite`, dated 2026-10-15) is valid, so a normal start does not re-bundle. With the cache
  present I measured 3.8–6.6 s, not 30–40 s; I could not reproduce 30–40 s on a normal start. The likely explanation (inferred,
  not proven) is the same memory pressure: when Windows is paging, or right after a reboot when `node_modules` is not in the file
  cache, every module file Vite reads is slow, and the app was loading all 26 pages eagerly before the first screen could render.
- **Changes.** (1) All signed-in pages are lazy-loaded (`React.lazy` + `Suspense`, with a loading state inside the app layout so
  navigation stays on screen). The first screen now needs 31 modules instead of 56, and the production build is split per page.
  (2) `server.warmup` transforms `main.jsx`, `App.jsx` and the auth pages at startup. (3) The `/api` proxy now targets
  `127.0.0.1:8000` (`localhost` tries IPv6 first, which Django's `runserver` does not listen on; curl showed ~217 ms vs ~5 ms per
  connection). React StrictMode, authentication and the Vite cache were left as they were; no dependency was reinstalled.
- **Remaining limitations.** Measurements were taken while the PC was under the memory pressure described above, so individual
  runs varied (two "after" runs taken immediately after start, before warm-up finished, took 6.9–7.9 s). The authenticated
  dashboard was not timed separately in the browser. **Recommendation:** run `gradle --stop` (or close the Java projects in VS
  Code) before working on YOLOA, and keep `node_modules/.vite`.
- **Files.** `frontend/src/App.jsx`, `frontend/src/components/layout/AppLayout.jsx`, `frontend/vite.config.js`,
  `frontend/src/test-setup.js` (test wait time raised to 5 s because pages now load on demand; no assertion changed).

## F. Overall verification

- **Database.** PostgreSQL `yoloa`; tests use Django's `test_yoloa`; browser writes used `yoloa_e2e`. `yoloa` counts before and
  after the work were identical: 3 users, 4 courses, 35 questions, 10 attempts, 15 resources.
- **Migrations.** None added; `makemigrations --check`: no changes; `manage.py check`: no issues.
- **Backend tests.** Before: 59 passed. After: 75 tests (16 new), **all passed in the final three full runs** on PostgreSQL. Two
  earlier full runs each had the same 2 failures in existing module-unlocking tests (modules came back out of order); those tests
  pass on their own, together with the new tests, and in every later full run. I could not find the cause (the failing code paths are ones I did not
  change), so I am flagging it rather than calling the suite flawless.
- **Frontend tests.** 79 passed, 6 skipped (the live end-to-end file, which only runs against a disposable database with extra
  environment variables). 19 new tests; one existing assertion was renamed from the "Create quiz" link to "Add quiz to Regions"
  (same URL checked).
- **Production build.** `npm run build` succeeded.
- **Existing workflows.** Covered by the unchanged existing suites (registration, login, Google OAuth checks, logout, enrollment,
  module unlocking, quiz scoring/concurrency, final exam timing and eligibility, directory, analytics, protected downloads).
- **Remaining issues.** No explanation field exists for questions. Course resources cannot be moved between course and module
  when editing (delete and re-add). Test accounts `ui-admin@yoloa.test` and `ui-student@yoloa.test` and a few "UI import:" / "UI
  check:" records were left in the disposable `yoloa_e2e` database.
