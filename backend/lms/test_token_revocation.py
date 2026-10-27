"""Regression tests for per-account legacy JWT revocation and login limits."""
from django.test import override_settings
from rest_framework.test import APITestCase, APIClient

from lms.models import User
from lms.test_support import RateLimitIsolationMixin


class LegacyTokenRevocationTests(RateLimitIsolationMixin, APITestCase):
    def setUp(self):
        self._start_rate_limit_isolation()
        self.user = User.objects.create_user(
            'revocation-student', email='revocation@example.test', password='Learner-pass-91', role='student')

    def issue(self):
        response = self.client.post('/api/auth/token', {
            'email': self.user.email, 'password': 'Learner-pass-91'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_logout_revokes_prior_access_and_refresh_tokens(self):
        tokens = self.issue()
        bearer = APIClient()
        bearer.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['token']}")
        self.assertEqual(bearer.get('/api/auth/me').status_code, 200)
        self.assertEqual(bearer.post('/api/auth/logout', {}, format='json').status_code, 200)
        self.assertEqual(bearer.get('/api/auth/me').status_code, 401)
        refreshed = self.client.post('/api/auth/refresh', {'refresh': tokens['refresh']}, format='json')
        self.assertEqual(refreshed.status_code, 401)

    def test_password_change_revokes_prior_access_and_refresh_tokens(self):
        tokens = self.issue()
        browser = APIClient()
        self.assertTrue(browser.login(username='revocation-student', password='Learner-pass-91'))
        change = browser.post('/api/auth/password/change', {
            'currentPassword': 'Learner-pass-91',
            'newPassword': 'Fresh-horse-482',
            'newPasswordConfirmation': 'Fresh-horse-482',
        }, format='json')
        self.assertEqual(change.status_code, 200, change.data)
        bearer = APIClient()
        bearer.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['token']}")
        self.assertEqual(bearer.get('/api/auth/me').status_code, 401)
        refreshed = self.client.post('/api/auth/refresh', {'refresh': tokens['refresh']}, format='json')
        self.assertEqual(refreshed.status_code, 401)


@override_settings(LOGIN_RATE_ACCOUNT_LIMIT=1, LOGIN_RATE_SOURCE_LIMIT=100)
class LoginRateLimitTests(RateLimitIsolationMixin, APITestCase):
    def setUp(self):
        self._start_rate_limit_isolation()
        self.user = User.objects.create_user(
            'login-limit-student', email='login-limit@example.test', password='Learner-pass-91', role='student')

    def test_repeated_attempts_are_limited_on_both_login_endpoints(self):
        for path in ('/api/auth/login', '/api/auth/token'):
            identifier = f'{path}-{self.user.email}'
            first = self.client.post(path, {'email': identifier, 'password': 'wrong'}, format='json')
            self.assertEqual(first.status_code, 401)
            blocked = self.client.post(path, {'email': identifier, 'password': 'wrong'}, format='json')
            self.assertEqual(blocked.status_code, 429)
            self.assertIn('Retry-After', blocked)

    def test_unknown_and_known_identifiers_use_the_same_credential_error(self):
        known = self.client.post('/api/auth/login', {
            'email': self.user.email, 'password': 'wrong'}, format='json')
        unknown = self.client.post('/api/auth/login', {
            'email': 'missing-login-limit@example.test', 'password': 'wrong'}, format='json')
        self.assertEqual((known.status_code, known.data['message']), (unknown.status_code, unknown.data['message']))
