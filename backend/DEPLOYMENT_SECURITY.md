# Production deployment security checklist

The local `.env` defaults are for HTTP development. Do not copy them unchanged into a public deployment.

## Required environment

- Set `DJANGO_DEBUG=False`.
- Provide a unique `DJANGO_SECRET_KEY` of at least 32 characters through the deployment secret store.
- Set `DJANGO_ALLOWED_HOSTS` to explicit hostnames. `*` is rejected in production.
- Set `CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `WEBSOCKET_ALLOWED_ORIGINS`, `FRONTEND_URL`, and `GOOGLE_OAUTH_REDIRECT_URI` to the deployed HTTPS origins.
- Set `CHANNEL_REDIS_URL` to `rediss://` with Redis authentication. The same Redis supports the Channels layer and atomic distributed rate limits. Set a deployment-specific `RATE_LIMIT_REDIS_PREFIX` if multiple independent deployments share the Redis service. Database names are appended to rate-limit keys; the existing `CHANNEL_REDIS_PREFIX` remains independently database-scoped.
- Source limits use the socket peer address by default. Behind a reverse proxy, set `RATE_LIMIT_TRUSTED_PROXY_HOPS` and `RATE_LIMIT_TRUSTED_PROXY_CIDRS` to the exact trusted proxy chain; forwarded headers are ignored unless the peer is in those CIDRs.
- Set `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`, and `DB_PORT` for the production PostgreSQL instance. Never point deployment or destructive tests at the production database.
- Keep `PRIVATE_MEDIA_ROOT` on private storage outside the static/media web root. Grant access only to the application identity; backups must cover this directory separately.
- Configure SMTP credentials through the secret store if password reset email is enabled. Never use the development console mail backend as a production delivery configuration.

## HTTPS, cookies, and proxy

With `DEBUG=False`, secure session and CSRF cookies, HTTPS redirect, and one-year HSTS default on. Ensure HTTPS is working before enabling HSTS. If a trusted TLS terminator forwards traffic to Django, set `TRUST_PROXY_SSL_HEADER=1` only when that proxy strips client-supplied forwarding headers and writes its own `X-Forwarded-Proto`. Terminate WebSockets with WSS and forward the correct `Origin` header. Do not add broad wildcard origins.

## Operations and rollout

- Run Django behind an ASGI server (Daphne or equivalent) for WebSockets. Keep the Redis channel layer; production startup rejects an unauthenticated or non-TLS Redis URL.
- Redis is required for login, message-send, and typing limits. Redis failure returns HTTP 503 for those operations; it never falls back to per-process memory. Monitor Redis availability and the application logs for `Shared rate limiter unavailable`; logs include the operation scope but not user identifiers or credentials.
- Apply migrations using the deployment's reviewed database target. Migration `0007_user_auth_token_version` adds a per-account integer only; it does not rewrite existing user records. The first logout or password update for an account increments its version and revokes that account's earlier legacy JWT access and refresh tokens. Existing JWT clients can continue using tokens until that account-level event, then must sign in again. Session authentication and CSRF behavior remain unchanged.
- Verify `private_media/` is not mapped by a reverse proxy or object-store public policy. Attachment routes authenticate and check conversation membership before streaming.
- Configure rotating, access-controlled logs. Do not log request authorization headers, passwords, reset links, session cookies, attachment paths, or raw Redis URLs.
- Before release, run `python manage.py check --deploy` with the production environment and review each finding. This repository's Django defaults also enforce secret key, host, cookie, HTTPS, and authenticated TLS Redis requirements at settings load.

## Suggested production environment template

```text
DJANGO_DEBUG=False
DJANGO_SECRET_KEY=<secret-store value, 32+ characters>
DJANGO_ALLOWED_HOSTS=lms.example.com
CHANNEL_REDIS_URL=rediss://:<secret-store password>@redis.example.com:6380/0
RATE_LIMIT_REDIS_PREFIX=yoloa-prod-rate
SESSION_COOKIE_SECURE=1
CSRF_COOKIE_SECURE=1
SECURE_SSL_REDIRECT=1
```

Do not commit actual values. `DB_*`, origin, email, OAuth, and private storage settings must also be set for the deployment.
