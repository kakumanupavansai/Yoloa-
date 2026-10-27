from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class BrowserSessionAuthentication(SessionAuthentication):
    """Keep unauthenticated API responses as 401 while retaining DRF CSRF checks."""
    def authenticate_header(self, request):
        return 'Session'


class VersionedJWTAuthentication(JWTAuthentication):
    """Keep legacy bearer clients compatible while revoking tokens per account."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None
        user, token = result
        try:
            version = int(token.get('av', 0))
        except (TypeError, ValueError):
            raise AuthenticationFailed('Invalid token.')
        if version != user.auth_token_version:
            raise AuthenticationFailed('Token has been revoked.')
        return user, token
