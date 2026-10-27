# YOLOA frontend stability and security hardening — 2026-10-25

## Frontend test stability

The prior integration audit reported 13 nondeterministic five-second timeouts in parallel, a different set on each run, with about 1.2 GB free RAM; running a file alone passed. That pattern points to worker contention, though the old failures did not reproduce in this session. The first unrestricted run here passed. `frontend/vite.config.js` now caps Vitest at two workers (minimum one), based on the prior resource observation and the page-heavy jsdom suites. No per-test timeout was raised. `frontend/TESTING.md` explains the existing live-integration skips and why they require an explicit disposable E2E setup.

Three consecutive full runs with the final worker configuration each reported **87 passed, 6 skipped, 0 failed**; durations were 37.59 s, 38.33 s, and 38.30 s. The six skips are the pre-existing live PostgreSQL integration cases, gated on an explicit disposable database and running API. The production build succeeded.

## Security changes

- **Legacy JWT revocation:** a new `auth_token_version` field is included as the `av` claim in newly issued legacy JWTs. Logout, password change, and password reset increment the account version. Access authentication and refresh reject mismatched versions. Tokens issued before deployment have no claim and remain valid at version zero until that account's next logout/password update; then that account's old access and refresh credentials stop working. Browser sessions and CSRF checks remain in place. Migration `lms/migrations/0007_user_auth_token_version.py` was created and **not applied**.
- **Distributed limits:** atomic Redis Lua counters are shared across processes and scoped by database name. Defaults are configurable for account/source login attempts, message sends, typing, password changes, and password reset requests. Account identifiers are hashed before becoming Redis keys. Forwarded source IPs are trusted only when the socket peer belongs to configured proxy CIDRs and hop count. Redis errors fail closed with a generic `503`; no process-local fallback is used. Message sends therefore return `503` while the rate-limit Redis endpoint is unreachable.
- **Production settings:** `DEBUG=False` now requires a non-default 32+ character secret, explicit non-wildcard hosts, explicit HTTPS CORS/CSRF/WebSocket origins, authenticated TLS Redis, secure cookies, HTTPS redirect, and HSTS. Private storage is rejected if configured under public `MEDIA_ROOT`. See `backend/DEPLOYMENT_SECURITY.md` for deployment variables and proxy setup.
- **Attachments:** inspected the existing content sniffing/size validation, extension allowlist, generated UUID storage paths, private storage outside `MEDIA_ROOT`, member-only download authorization, and response headers. Storage-open failures now return generic not-found responses and log only the exception class.

## Verification performed

- `npm test`: three consecutive final-config passes, each 87 passed / 6 skipped.
- `npm run build`: passed.
- `python manage.py check`: passed.
- `python manage.py makemigrations --check --dry-run`: no changes detected after the generated migration.
- `python -m compileall -q config lms messaging`: passed.
- `python manage.py test lms.test_rate_limits --noinput`: 3 unit tests passed (atomic threshold contract, expiry, concurrent calls, fail-closed recovery using a thread-safe test double).
- A focused backend test run was started against the verified disposable `test_yoloa` database, but the Windows process could not reach Redis at the configured `127.0.0.1:6379`. Redis answered `PONG` inside WSL but is bound to WSL loopback (`127.0.0.1`, port 6379); Windows connection attempts timed out. The run was interrupted after confirming the fail-closed `503` behavior; no complete backend pass is claimed. The interrupted `test_yoloa` database had no active connections and was removed. Do not change Redis binding or proxy configuration without coordinating the deployment setup.
- The effective Django database names were verified as `yoloa` (main) and `test_yoloa` (test). No migration or application data writes were run against `yoloa`. The SQLite backup and `backend/db.sqlite3` both had SHA-256 `67BFD01568EC674ADDB5AE22EC3FCE70AD2EEC07888AAB537873E45F86DC0A00` before and after.

## Not verified in this session

The new token/logout/password-change regression tests, login endpoint thresholds against live Redis, full backend suite, live WebSocket reconnect behavior, attachment integration, admin/Excel, course/quiz/exam workflows, and live E2E database were not run to completion because Redis was unreachable from Windows. Redis-backed rate limiting and those integration paths need a rerun after the configured Windows application endpoint can reach the approved Redis instance. This work should not be described as fully security-verified until then.

## Commands

```powershell
# Frontend
cd frontend
npm test
npm run build

# Backend checks
cd ..\backend
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test lms messaging --noinput
```

The backend test runner creates/destroys `test_<DB_NAME>`; verify `DB_NAME` first and never set it to `yoloa` for destructive testing. Local backend startup still requires PostgreSQL and reachable Redis before Django, then Vite on port 5173.
