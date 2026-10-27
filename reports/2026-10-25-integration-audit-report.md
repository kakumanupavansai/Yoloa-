# YOLOA end-to-end integration audit — 2026-10-25

Scope: admin tools (Excel import, quiz/final controls, resources, assessment search), profile password change, frontend
loading performance, and real-time student messaging (Django Channels + Redis). Every result below is from a run on the
final code unless stated otherwise.

## 1. Issues found and fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | High (privacy) | Servers for different databases sharing one Redis used the same channel prefix (`yoloa`). Groups are `chat.user.<id>` and ids overlap across databases, so a message on a `yoloa_e2e` server was pushed to the socket of a *different person* signed in on a `yoloa` server. | `config/settings.py`: default `CHANNEL_REDIS_PREFIX` is `yoloa` for the `yoloa` database (unchanged) and `yoloa-<DB_NAME>` otherwise. |
| 2 | Medium | A WebSocket frame with `Infinity`/`NaN` (accepted by Python's `json`) made `int()` raise `OverflowError` and closed the socket with 1011. Floats/booleans were silently truncated (`1.5`/`true` → conversation 1); a list body was stored as its Python repr. | `consumers.py` rejects non-standard JSON constants; `services.parse_id` accepts only integers/digit strings in range; `send_message` requires a string body. |
| 3 | Medium | After any Excel upload for an assessment, deleting that assessment, its module or its course returned **500** (`QuestionImportBatch.exam` is `PROTECT`). | `lms/views.py`: the three delete handlers remove the assessment's import (staging) batches in the same transaction. Attempt history still blocks deletion with 409 as before. No migration. |
| 4 | Medium | Offline recovery could miss messages: the provider inferred "reconnected" from `lastSeen > 0` (false for a student with no messages, or when the socket dropped before `ready`), and `ChatThread.fetchNewer` used the newest message in the thread as its cursor — including the student's own message sent over HTTP while offline, which is newer than the missed ones. Seen once in the real browser. | `MessagingContext.jsx`: explicit `synced` flag. `ChatThread.jsx`: separate server-stream cursor (`syncedUpTo`) that own sends never advance. |
| 5 | Low | With Redis down, every HTTP send waited for one failed Redis attempt **per recipient** (4.1 s) and logged once per recipient. | `services.broadcast` sends to all recipients in one loop and stops at the first failure: 2.1 s (the rest is redis-py's built-in connect retry). |
| 6 | Low | A browser leaving mid-handshake made `connect()` raise while sending `ready` (error traceback; consumer died before `disconnect()`, leaving its channel in the Redis group until expiry). | `consumers.py`: a failed `ready` send returns normally so the disconnect runs and cleans up. |

Regression tests added: `lms.test_admin_enhancements…test_assessment_module_and_course_can_be_deleted_after_an_import`,
`messaging.tests…test_non_integer_ids_and_bodies_get_errors_without_closing_the_socket`,
`messaging.tests…test_redis_outage_still_stores_the_message_and_tries_redis_only_once`, and two Vitest cases in
`messaging.test.jsx` (drop-before-ready + own HTTP send; zero-message student). The delete test and both Vitest tests
were run and failed before their fixes; the two messaging backend tests were written after their fixes (the failures they
cover were first observed in the live runs) and were not run against the old code. Docs: `backend/README.md` prefix note.

## 2. Test results

| Suite | Database | Result |
|---|---|---|
| Backend `manage.py test lms messaging` (baseline, before changes) | `test_yoloa` (created/destroyed by Django) + real Redis | 95 / 95 passed |
| Backend `manage.py test lms messaging` (final) | `test_yoloa` + real Redis (Redis tests ran, not skipped) | **98 / 98 passed** |
| Frontend Vitest (baseline) | none (fixtures/spies) | 85 passed, 6 skipped |
| Frontend Vitest, `--fileParallelism=false` (final) | none | **87 passed, 6 skipped, 0 failed** |
| Frontend Vitest, default parallel (final) | none | 74 passed, **13 failed**, 6 skipped — all 5 s timeouts, a different set each run; machine had ~1.2 GB free RAM. A failing file run alone passes (auth: 26/26). Not a code regression, but not a green parallel run either. |
| Live `integration.test.jsx` (registration, enrollment, module unlocking, quiz pass, protected PDF, final exam deadline/resume, admin student view) | `yoloa_e2e` via ASGI server :8002 | **7 / 7 passed** |
| Live messaging HTTP + WebSocket E2E (115 checks) | `yoloa_e2e`, real Redis | **115 / 115 passed** |
| Live Redis outage (relay cut mid-session) | `yoloa_e2e`, real Redis behind a relay | **12 / 12 passed** |
| Live admin tools (Excel import, quiz/final, resources, deletes) | `yoloa_e2e` | **29 / 29 passed** |
| Real browser (headless Chrome, two isolated sessions), dev server | `yoloa_e2e` | 36 / 36 passed (×2) |
| Real browser, **production build** (`vite preview`) | `yoloa_e2e` | **36 / 36 passed** |
| `npm run build` | — | **succeeded** (Messages 18.8 kB and MessagingContext 4.2 kB are separate lazy chunks) |

Messaging coverage (live): registration-based students find each other; self/admin/unknown targets refused; CSRF required;
WS rejects anonymous, forged cookie, admin, foreign and other-local-port origins; delivery without refresh; payload
`sender` ignored; persistence verified in PostgreSQL; clientId de-duplication; disconnect → reconnect → `sync` returns
exactly the missed messages in order; unread counts, partial read, monotonic read pointer, real-time "Seen"; ascending ids
and tz-aware timestamps; backward pagination covers history exactly once, page size capped; outsiders/admins/anonymous get
404/403/401 on detail, history, send, read, sync, typing, attachments and guessed ids; 15 malformed WS frames keep the
socket alive; valid image/PDF/text attachments download intact to both members only; fake image, .exe, .html, .svg,
empty, fake PDF, fake docx, binary .txt, 6 files and 10 MB + 1 byte are rejected with nothing stored; password change
signs out other sessions and closes their socket on the next write (4401); logout closes the socket; burst sending → 429.
Redis outage: open sockets close (1011) and reconnect with backoff, new handshakes refused, HTTP sends are stored (201)
and recovered exactly once after Redis returns; no in-memory fallback. Browser: live sidebar/mobile-menu unread badges,
list/thread switching and back button at 390 px with no horizontal scroll, one socket per tab in production.

## 3. Database and file safety

- `yoloa`: per-table row count + content hash taken before and after — **identical** (32 tables). No migrations run on it;
  `makemigrations --check` reports no changes and `showmigrations` shows none pending. No schema change was needed.
- Destructive/data-writing tests used only `test_yoloa` (Django) and `yoloa_e2e` (verified by name and vendor first).
- `yoloa-sqlite-backup-20261024-194258.sqlite3` and `backend/db.sqlite3`: SHA-256 identical before/after.
- LearnSpace project and `learnspace_staging`: not accessed.
- Project has no Git repository, so there was no Git status to preserve; no files were reset or deleted.
- Note: `yoloa_e2e` and `yoloa` share `backend/private_media/`, so e2e attachment uploads land in the same folder (random
  names, never served publicly).

## 4. Performance and reliability

- Login form rendered in 0.5 s, DOMContentLoaded 250–530 ms; sign-in to dashboard 0.7–0.8 s (warm dev server).
- Messaging code is not loaded on the login screen; the Messages page is not loaded until opened.
- Exactly one messaging WebSocket per tab in production (dev shows 2 created / 1 open: React StrictMode's intentional
  double mount); in-app navigation opens no extra sockets.
- Query counts are constant regardless of page size: conversation list 3, history page 3, sync 2, unread 1, search 2.
- History pages are capped at 100, sync pages at 200; the conversation list is not paginated (fine for classmates, not
  for thousands of conversations).

## 5. Local startup order

```bash
# 1. PostgreSQL 18 service (Windows service postgresql-x64-18) must be running.
# 2. Redis in WSL2:
wsl -d Ubuntu -e true                     # or open an Ubuntu terminal; inside: sudo service redis-server start if needed
cd backend && python manage.py check_redis
# 3. Django ASGI (Daphne) — same command as before:
python manage.py runserver                # http://127.0.0.1:8000
# 4. Vite:
cd frontend && npm run dev                # http://localhost:5173 (use localhost, not 127.0.0.1)
```
Tests: `cd backend && python manage.py test lms messaging --noinput`; `cd frontend && npx vitest run --fileParallelism=false`
(or plain `npm test` when the machine has free memory); `npm run build`.

## 6. Remaining risks / manual checks before deployment

- `DJANGO_DEBUG`, secret key, `ALLOWED_HOSTS`, HTTPS with secure cookies, SMTP, Google redirect URI — as in README.
- Legacy JWT endpoints (`/api/auth/token`, `/auth/refresh`) remain enabled: JWTs stay valid up to 12 h after a password
  change or sign-out, and messaging HTTP APIs accept them. Remove or shorten before deployment.
- No rate limiting on `/api/auth/login` or `/api/auth/token` (password change is throttled; login is not).
- Message rate limit and password-change throttle use the default per-process cache; with several server processes use a
  shared cache (e.g. Redis).
- Redis in production needs TLS + password (`rediss://…`) and a dedicated prefix per environment.
- `private_media/` must stay off any public web root; e2e and main databases currently share it locally.
- Not covered by automated runs: real phones/touch, Safari/Firefox, screen readers, Google OAuth, real SMTP delivery.
