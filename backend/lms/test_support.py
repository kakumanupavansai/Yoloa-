"""Helpers for isolating tests that use shared infrastructure."""
import uuid

from django.conf import settings
from django.db import connection
from django.test import override_settings

from . import rate_limits


class RateLimitIsolationMixin:
    """Give each database test a private Redis namespace for rate-limit counters.

    The normal limiter deliberately shares counters across processes. Test cases,
    however, reuse subjects and the loopback source address, so they need a
    per-test namespace. The namespace remains shared within a test, preserving
    tests that exercise a real common threshold. Cleanup only scans and deletes
    keys under the unique namespace allocated to this test.
    """

    def setUp(self):
        self._start_rate_limit_isolation()
        super().setUp()

    def _start_rate_limit_isolation(self):
        if getattr(self, '_rate_test_settings', None):
            return
        self._rate_test_prefix = f'{settings.RATE_LIMIT_REDIS_PREFIX}-case-{uuid.uuid4().hex}'
        self._rate_test_settings = override_settings(RATE_LIMIT_REDIS_PREFIX=self._rate_test_prefix)
        self._rate_test_settings.enable()
        self._rate_test_database = connection.settings_dict.get('NAME') or settings.DATABASES['default']['NAME']

    def _post_teardown(self):
        try:
            client = rate_limits._client if hasattr(self, '_rate_test_prefix') else None
            if client is not None and hasattr(client, 'scan_iter'):
                pattern = f'{self._rate_test_prefix}-{self._rate_test_database}:*'
                batch = []
                for key in client.scan_iter(match=pattern, count=100):
                    batch.append(key)
                    if len(batch) == 100:
                        client.delete(*batch)
                        batch.clear()
                if batch:
                    client.delete(*batch)
        finally:
            try:
                super()._post_teardown()
            finally:
                if hasattr(self, '_rate_test_settings'):
                    self._rate_test_settings.disable()
