# YOLOA real-time student messaging: report (2026-10-25)

## Environment and packages
- YOLOA runs on the system Python 3.14 (`C:\Python314`) with packages in the user site-packages; there is no virtualenv.
  The new packages went into that same environment (dry run first: all cp314 wheels, nothing existing upgraded, `pip check` clean).
- Selected: **channels 4.3.2** (`channels[daphne]`), **daphne 4.2.3**, **channels-redis 4.3.0**, which pulled redis-py 8.1.0,
  Twisted 26.4.0, autobahn 26.10.2, msgpack 1.2.3 and others. Compatible with Django 5.2.18 and Python 3.14. Added to `backend/requirements.txt`.
- The folder is not a git repository, so there is no git status. All existing files, including the admin-enhancement work, were preserved.
  A snapshot of the code before any changes was saved in the session scratchpad.

## Django Channels configuration
- `config/asgi.py`: `ProtocolTypeRouter`. HTTP goes to Django. WebSocket goes through `OriginValidator` (exact origins from
  `WEBSOCKET_ALLOWED_ORIGINS`, default `CSRF_TRUSTED_ORIGINS`), then `AuthMiddlewareStack` (Django session cookie), then `/ws/messages/`.
- `daphne` is first in `INSTALLED_APPS`, so `manage.py runserver` now starts the ASGI/Daphne server. `ASGI_APPLICATION = config.asgi.application`.
- Channel layer: `channels_redis.core.RedisChannelLayer` at `CHANNEL_REDIS_URL` (default `redis://127.0.0.1:6379/0`), prefix `yoloa`.
  `socket_timeout` is 15 s. **Bug found in live testing:** redis-py 8 defaults to a 5 s read timeout, the same as channels-redis'
  5 s blocking read, so idle sockets crashed with "Timeout reading from 127.0.0.1:6379". After the fix there were 0 timeouts in a 45 s idle test.
  `CHANNEL_LAYER=memory` selects the in-memory layer. No credentials are in source.
- HTTP CSRF and the authentication system are unchanged.

## Feature
- **Backend app `messaging`:**
  - models `Conversation` (ordered unique student pair), `ConversationMember` (read pointer), `Message` (`client_id` for idempotent sends), `MessageAttachment` (private storage, random names);
  - `services.py` (all rules), HTTP API, WebSocket consumer, logout signal, `check_redis` command.
- **WebSocket security:**
  - anonymous users, admins, forged sessions and cross-origin handshakes are rejected;
  - each socket joins only its own user's group, so there are no client-chosen subscriptions;
  - every write re-checks the live session and membership; the sender is always the session user;
  - sign-out closes the user's sockets, and password changes or deactivation close them within 15 s;
  - frames over 32 KB are refused, and sending is rate-limited to 20 messages per 10 s.
- **Storage first:** a message is committed to PostgreSQL and then broadcast with `on_commit`. If Redis is down the message is still stored,
  and clients recover it through `GET /api/messages/sync?after=<id>` when they reconnect.
- **Attachments:** at most 5 files per message, 10 MB each. Accepted types are images verified with Pillow, PDF magic bytes,
  OOXML zip structure, OLE header, and UTF-8 txt/csv. SVG, executables and fakes are rejected.
  Files are served only to the two members (non-members get 404, admins 403), with `nosniff` and a sandbox CSP; only images display inline.
- **Frontend:**
  - Messages page (`/student/messages[/:id]`): student search, conversation list with unread counts, thread with day dividers;
  - history paging ("Load earlier"), image and document attachments, "Seen" receipts, a typing indicator, a Live/Offline badge, and a mobile one-pane layout;
  - `MessagingContext`: one socket per student, reconnect with backoff, on `online` and on tab-visible, offline catch-up, and HTTP fallback with the same clientId;
  - unread badge in the sidebar and a dot on the mobile menu; `/ws` added to the Vite proxy.

## Database
- Migration `messaging/migrations/0001_initial.py` creates only the 4 `messaging_*` tables, their indexes and constraints, plus FKs to `lms_user`.
  It does not alter any existing table.
- Inspected first: `yoloa` is PostgreSQL 18 and had no messaging tables. Applied to `yoloa_e2e`, then to `yoloa`.
  The row counts of all 17 `lms_*` tables were identical before and after.

## Test results
| Suite | Channel layer | Result |
|---|---|---|
| `python manage.py check_redis` | real Redis 8.0.3 | PING ok (~30 ms), round trip ok |
| `messaging.tests` HTTP (13) | in-memory | pass |
| `messaging.tests` WebSocket (6): auth/origin rejection, live delivery, outsider blocked, offline recovery, sign-out close, malformed frames | **in-memory** | pass |
| `messaging.tests.RedisChannelLayerTests` (2): layer round trip, two students exchanging messages | **real Redis** (isolated prefix) | pass |
| Full backend `test lms messaging` (95) | mixed | **OK** |
| Frontend Vitest (85, 6 skipped: the live-only integration file) | fake socket | pass |
| `npm run build` | — | ok (Messages chunk 18.7 kB) |
| Live browser check on `yoloa_e2e` (Daphne on 8002 → real Redis, two students in separate sessions) | **real Redis** | search, open conversation, live delivery with unread badge, image + CSV attachments, Seen receipt, auth-checked downloads, recovery via `sync` after a server restart, still live after 45 s idle |

Note: when testing started, Ubuntu (WSL) was **stopped**, so Redis refused connections and the Redis tests skipped themselves. I started the
distro (`wsl -d Ubuntu`); Redis itself was not touched. One existing frontend test asserted that Messages was absent from the
navigation; I updated it to expect the link.

## Local startup
1. Start Ubuntu/WSL2 (open an Ubuntu terminal, or `wsl -d Ubuntu`).
2. `cd backend && python manage.py check_redis` (read-only).
3. `python manage.py runserver` (ASGI/Daphne).
4. `cd frontend && npm run dev`.
5. Sign in as two students (one normal window, one private window), open Messages, and chat.

## Remaining considerations
- WSL shuts down when idle, which takes Redis with it; messages still save, but live delivery waits for reconnect. No startup task was created.
- Production: an ASGI server behind a WebSocket-capable proxy, HTTPS/`wss`, Redis with a password and TLS set in `CHANNEL_REDIS_URL` from the environment, and Redis kept off public networks.
- Under ASGI, Django runs sync views on one shared thread. That is fine locally; for production, use several worker processes.
- The rate limit uses the local-memory cache, so it applies per process. Use a shared cache (for example Redis) when running several workers.
- No moderation or reporting tools, and no message edit/delete; administrators cannot see conversations (by design).
- Disposable test students `chat_asha` / `chat_ben` exist only in `yoloa_e2e`.
