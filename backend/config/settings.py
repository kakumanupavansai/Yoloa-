import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import urlparse

from django.core.exceptions import ImproperlyConfigured


def _env_bool(name, default=False):
    """Read common boolean spellings from environment variables."""
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().casefold()
    if value in {'1', 'true'}:
        return True
    if value in {'0', 'false'}:
        return False
    raise ImproperlyConfigured(f'{name} must be set to True, False, 1, or 0.')


BASE_DIR = Path(__file__).resolve().parent.parent
try:
    from dotenv import load_dotenv
    # Load backend/.env explicitly so settings do not depend on the shell's working directory.
    # Variables already present in the environment (for example USE_SQLITE=1) take precedence.
    load_dotenv(BASE_DIR / '.env')
except ImportError:
    pass
DEBUG = os.getenv('DJANGO_DEBUG', 'True') == 'True'
SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'dev-insecure-key')
ALLOWED_HOSTS = [host.strip() for host in os.getenv('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if host.strip()]
if not DEBUG:
    if 'DJANGO_ALLOWED_HOSTS' not in os.environ:
        raise ImproperlyConfigured('Production requires DJANGO_ALLOWED_HOSTS to be set explicitly.')
    if SECRET_KEY == 'dev-insecure-key' or len(SECRET_KEY) < 32:
        raise ImproperlyConfigured('Production requires DJANGO_SECRET_KEY with at least 32 characters.')
    if not ALLOWED_HOSTS or '*' in ALLOWED_HOSTS:
        raise ImproperlyConfigured('Production requires explicit DJANGO_ALLOWED_HOSTS entries.')

INSTALLED_APPS = [
    # Daphne first: its `runserver` replaces Django's, so the development server speaks ASGI (HTTP + WebSockets).
    'daphne',
    'django.contrib.admin', 'django.contrib.auth', 'django.contrib.contenttypes',
    'django.contrib.sessions', 'django.contrib.messages', 'django.contrib.staticfiles',
    'rest_framework', 'corsheaders', 'channels', 'lms', 'messaging',
]
MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
ROOT_URLCONF = 'config.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates', 'DIRS': [], 'APP_DIRS': True,
    'OPTIONS': {'context_processors': [
        'django.template.context_processors.debug', 'django.template.context_processors.request',
        'django.contrib.auth.context_processors.auth', 'django.contrib.messages.context_processors.messages']},
}]
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Real-time messaging (Django Channels). Redis carries events between server processes; PostgreSQL stays the
# source of truth for every message. Credentials belong in the environment, never in source, e.g.
#   CHANNEL_REDIS_URL=rediss://:<password>@redis.example.com:6380/0
# CHANNEL_LAYER=memory selects the single-process in-memory layer (no Redis), meant only for isolated tests.
CHANNEL_REDIS_URL = os.getenv('CHANNEL_REDIS_URL', 'redis://127.0.0.1:6379/0')
RATE_LIMIT_REDIS_TIMEOUT = float(os.getenv('RATE_LIMIT_REDIS_TIMEOUT', '1'))
RATE_LIMIT_REDIS_PREFIX = os.getenv('RATE_LIMIT_REDIS_PREFIX', 'yoloa-rate')
RATE_LIMIT_TRUSTED_PROXY_HOPS = int(os.getenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '0'))
RATE_LIMIT_TRUSTED_PROXY_CIDRS = [cidr.strip() for cidr in os.getenv('RATE_LIMIT_TRUSTED_PROXY_CIDRS', '').split(',') if cidr.strip()]
LOGIN_RATE_WINDOW_SECONDS = int(os.getenv('LOGIN_RATE_WINDOW_SECONDS', '900'))
LOGIN_RATE_ACCOUNT_LIMIT = int(os.getenv('LOGIN_RATE_ACCOUNT_LIMIT', '10'))
LOGIN_RATE_SOURCE_LIMIT = int(os.getenv('LOGIN_RATE_SOURCE_LIMIT', '60'))
PASSWORD_CHANGE_RATE_LIMIT = int(os.getenv('PASSWORD_CHANGE_RATE_LIMIT', '5'))
PASSWORD_CHANGE_RATE_WINDOW_SECONDS = int(os.getenv('PASSWORD_CHANGE_RATE_WINDOW_SECONDS', '900'))
PASSWORD_RESET_ACCOUNT_LIMIT = int(os.getenv('PASSWORD_RESET_ACCOUNT_LIMIT', '5'))
PASSWORD_RESET_SOURCE_LIMIT = int(os.getenv('PASSWORD_RESET_SOURCE_LIMIT', '30'))
PASSWORD_RESET_RATE_WINDOW_SECONDS = int(os.getenv('PASSWORD_RESET_RATE_WINDOW_SECONDS', '900'))
MESSAGE_RATE_WINDOW_SECONDS = int(os.getenv('MESSAGE_RATE_WINDOW_SECONDS', '10'))
MESSAGE_RATE_LIMIT = int(os.getenv('MESSAGE_RATE_LIMIT', '20'))
TYPING_RATE_WINDOW_SECONDS = int(os.getenv('TYPING_RATE_WINDOW_SECONDS', '60'))
TYPING_RATE_LIMIT = int(os.getenv('TYPING_RATE_LIMIT', '60'))
if min(RATE_LIMIT_REDIS_TIMEOUT, LOGIN_RATE_WINDOW_SECONDS, LOGIN_RATE_ACCOUNT_LIMIT,
       LOGIN_RATE_SOURCE_LIMIT, PASSWORD_CHANGE_RATE_LIMIT, PASSWORD_CHANGE_RATE_WINDOW_SECONDS,
       PASSWORD_RESET_ACCOUNT_LIMIT, PASSWORD_RESET_SOURCE_LIMIT, PASSWORD_RESET_RATE_WINDOW_SECONDS,
       MESSAGE_RATE_WINDOW_SECONDS, MESSAGE_RATE_LIMIT,
       TYPING_RATE_WINDOW_SECONDS, TYPING_RATE_LIMIT) <= 0:
    raise ImproperlyConfigured('Rate-limit windows, limits, and Redis timeout must be positive.')
if not DEBUG:
    _redis_url = urlparse(CHANNEL_REDIS_URL)
    if _redis_url.scheme != 'rediss' or not _redis_url.password:
        raise ImproperlyConfigured('Production CHANNEL_REDIS_URL must use rediss:// with authentication.')
    if RATE_LIMIT_TRUSTED_PROXY_HOPS and not RATE_LIMIT_TRUSTED_PROXY_CIDRS:
        raise ImproperlyConfigured('Configure RATE_LIMIT_TRUSTED_PROXY_CIDRS when trusting forwarded client IPs.')
# Groups are named after user ids, which repeat across databases: servers for different databases (e.g. yoloa and the
# yoloa_e2e test database) sharing one Redis must not share a prefix, or one database's messages reach another's users.
_db_name = os.getenv('DB_NAME', 'yoloa')
CHANNEL_REDIS_PREFIX = os.getenv('CHANNEL_REDIS_PREFIX') or ('yoloa' if _db_name == 'yoloa' else f'yoloa-{_db_name}')
if os.getenv('CHANNEL_LAYER', 'redis') == 'memory':
    CHANNEL_LAYERS = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
else:
    CHANNEL_LAYERS = {'default': {
        'BACKEND': 'channels_redis.core.RedisChannelLayer',
        # redis-py 8 defaults to a 5 s socket timeout, the same as channels-redis' 5 s blocking BZPOPMIN, so an idle
        # socket's receive loop could time out and close the WebSocket. Give reads a margin above the blocking wait.
        'CONFIG': {'hosts': [{'address': CHANNEL_REDIS_URL, 'socket_timeout': 15, 'socket_connect_timeout': 5}],
                   'prefix': CHANNEL_REDIS_PREFIX},
    }}

# PostgreSQL is the only supported database. There is deliberately no SQLite fallback:
# a missing or wrong credential must fail loudly instead of silently using another store.
# `manage.py test` creates and destroys a separate `test_<DB_NAME>` database on the same server.
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.postgresql',
    'NAME': os.getenv('DB_NAME', 'yoloa'), 'USER': os.getenv('DB_USER', 'postgres'),
    'PASSWORD': os.getenv('DB_PASSWORD', ''),
    'HOST': os.getenv('DB_HOST', 'localhost'), 'PORT': os.getenv('DB_PORT', '5432'),
    'CONN_MAX_AGE': 60,
    'TEST': {'NAME': os.getenv('DB_TEST_NAME') or f"test_{os.getenv('DB_NAME', 'yoloa')}"},
}}

# Opening a PostgreSQL connection costs ~100 ms on Windows (one server process per connection), and
# `runserver` handles every request on a new thread, so thread-local CONN_MAX_AGE reuse never happens there.
# With psycopg 3 installed, a process-wide pool keeps connections open across requests and threads.
try:
    from psycopg_pool import ConnectionPool
except ImportError:  # psycopg2-only installs keep per-thread persistent connections.
    ConnectionPool = None
if ConnectionPool and os.getenv('DB_POOL', '1') == '1':
    DATABASES['default']['CONN_MAX_AGE'] = 0  # Django requires 0 when pooling.
    DATABASES['default']['OPTIONS'] = {'pool': {
        'min_size': int(os.getenv('DB_POOL_MIN', '2')), 'max_size': int(os.getenv('DB_POOL_MAX', '10')),
        'timeout': 10,  # Django adds a connection health check (dead connections are replaced)
    }}

AUTH_USER_MODEL = 'lms.User'
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator', 'OPTIONS': {'min_length': 8}},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
PASSWORD_RESET_TIMEOUT = 3600
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = True
USE_TZ = True
STATIC_URL = 'static/'
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
# Course resource uploads live outside MEDIA_ROOT so they are never served as public static files;
# they are streamed only through the permission-checked /api/resources/<id>/file endpoint.
PRIVATE_MEDIA_ROOT = Path(os.getenv('PRIVATE_MEDIA_ROOT') or BASE_DIR / 'private_media')
if PRIVATE_MEDIA_ROOT.resolve().is_relative_to(Path(MEDIA_ROOT).resolve()):
    raise ImproperlyConfigured('PRIVATE_MEDIA_ROOT must be outside the publicly served MEDIA_ROOT.')
MAX_RESOURCE_UPLOAD_BYTES = 25 * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
# Message attachments are private files as well (PRIVATE_MEDIA_ROOT/chat_attachments/), streamed only to conversation members.
MAX_CHAT_ATTACHMENT_BYTES = int(os.getenv('MAX_CHAT_ATTACHMENT_BYTES', str(10 * 1024 * 1024)))
MAX_CHAT_ATTACHMENTS = 5
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Frontend calls /courses (no trailing slash) – don't redirect.
APPEND_SLASH = False

REST_FRAMEWORK = {
    # Browser requests use Django sessions; JWT remains available only for the
    # existing Postman/non-browser integration until that client is migrated.
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'lms.authentication.BrowserSessionAuthentication',
        'lms.authentication.VersionedJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'EXCEPTION_HANDLER': 'lms.utils.api_exception_handler',
}
SIMPLE_JWT = {'ACCESS_TOKEN_LIFETIME': timedelta(hours=12), 'REFRESH_TOKEN_LIFETIME': timedelta(days=7)}

CORS_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv('CORS_ALLOWED_ORIGINS', 'http://localhost:5173').split(',') if origin.strip()]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = [origin.strip() for origin in os.getenv('CSRF_TRUSTED_ORIGINS', 'http://localhost:5173').split(',') if origin.strip()]
# WebSocket handshakes carry the session cookie, so only these exact origins (scheme + host + port) may open one.
# This blocks cross-site WebSocket hijacking from other pages, including other local dev servers on localhost.
WEBSOCKET_ALLOWED_ORIGINS = [origin.strip() for origin in os.getenv('WEBSOCKET_ALLOWED_ORIGINS', '').split(',') if origin.strip()] \
    or CSRF_TRUSTED_ORIGINS
if not DEBUG:
    for _name, _origins in (('CORS_ALLOWED_ORIGINS', CORS_ALLOWED_ORIGINS),
                            ('CSRF_TRUSTED_ORIGINS', CSRF_TRUSTED_ORIGINS),
                            ('WEBSOCKET_ALLOWED_ORIGINS', WEBSOCKET_ALLOWED_ORIGINS)):
        if not os.getenv(_name) or any(not origin.startswith('https://') for origin in _origins):
            raise ImproperlyConfigured(f'Production requires explicit HTTPS {_name}.')
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SECURE = os.getenv('SESSION_COOKIE_SECURE', '0' if DEBUG else '1') == '1'
SESSION_COOKIE_SAMESITE = os.getenv('SESSION_COOKIE_SAMESITE', 'Lax')
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SECURE = os.getenv('CSRF_COOKIE_SECURE', '0' if DEBUG else '1') == '1'
CSRF_COOKIE_SAMESITE = os.getenv('CSRF_COOKIE_SAMESITE', 'Lax')
CSRF_USE_SESSIONS = False
SECURE_SSL_REDIRECT = os.getenv('SECURE_SSL_REDIRECT', '0' if DEBUG else '1') == '1'
SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', '0' if DEBUG else '31536000'))
SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv('SECURE_HSTS_INCLUDE_SUBDOMAINS', '0' if DEBUG else '1') == '1'
SECURE_HSTS_PRELOAD = os.getenv('SECURE_HSTS_PRELOAD', '0' if DEBUG else '1') == '1'
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https') if os.getenv('TRUST_PROXY_SSL_HEADER', '0') == '1' else None
if not DEBUG and (not SESSION_COOKIE_SECURE or not CSRF_COOKIE_SECURE or not SECURE_SSL_REDIRECT or
                  SECURE_HSTS_SECONDS < 1):
    raise ImproperlyConfigured('Production requires secure cookies, HTTPS redirect, and HSTS.')

EMAIL_BACKEND = os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', 'YOLOA Learning Portal <no-reply@localhost>')
EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
EMAIL_USE_TLS = _env_bool('EMAIL_USE_TLS', True)
EMAIL_USE_SSL = _env_bool('EMAIL_USE_SSL', False)
EMAIL_TIMEOUT = 10

GOOGLE_OAUTH_CLIENT_ID = os.getenv('GOOGLE_OAUTH_CLIENT_ID', '')
GOOGLE_OAUTH_CLIENT_SECRET = os.getenv('GOOGLE_OAUTH_CLIENT_SECRET', '')
GOOGLE_OAUTH_REDIRECT_URI = os.getenv('GOOGLE_OAUTH_REDIRECT_URI', 'http://localhost:8000/api/auth/google/callback')
FRONTEND_URL = os.getenv('FRONTEND_URL', 'http://localhost:5173').rstrip('/')
