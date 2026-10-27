"""ASGI entry point: Django's HTTP application plus the session-authenticated messaging WebSocket.

`python manage.py runserver` uses this through Daphne (see INSTALLED_APPS); in deployment run
`daphne config.asgi:application` (or another ASGI server) instead of a WSGI server.
"""
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
# Django must be set up before anything imports models (consumers, auth middleware).
django_asgi_app = get_asgi_application()

from channels.auth import AuthMiddlewareStack  # noqa: E402
from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from channels.security.websocket import OriginValidator  # noqa: E402
from django.conf import settings  # noqa: E402

from messaging.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # Origin check first (cross-site WebSocket hijacking), then the Django session cookie -> scope['user'].
    'websocket': OriginValidator(AuthMiddlewareStack(URLRouter(websocket_urlpatterns)), settings.WEBSOCKET_ALLOWED_ORIGINS),
})
