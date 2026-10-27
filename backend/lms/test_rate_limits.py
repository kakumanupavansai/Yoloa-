"""Unit coverage for the shared Redis limiter's atomic counter contract."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from unittest import mock

from django.test import SimpleTestCase, override_settings

from lms import rate_limits


class UnitRedis:
    """Small, thread-safe fake for unit coverage; not used by application settings."""
    def __init__(self):
        self.values = {}
        self.lock = Lock()

    def eval(self, script, key_count, key, window):
        with self.lock:
            now = time.monotonic()
            count, expires = self.values.get(key, (0, now))
            if expires <= now:
                count, expires = 0, now + int(window)
            count += 1
            self.values[key] = (count, expires)
            return [count, max(int(expires - now), 1)]

    def delete(self, key):
        with self.lock:
            self.values.pop(key, None)


@override_settings(RATE_LIMIT_REDIS_PREFIX='yoloa-rate-unit-tests')
class SharedRateLimitUnitTests(SimpleTestCase):
    def setUp(self):
        # Unique subjects isolate these tests without flushing shared Redis data.
        self.subject = f'test-{uuid.uuid4()}'
        self.previous_client = rate_limits._client
        rate_limits._client = UnitRedis()

    def tearDown(self):
        rate_limits._client = self.previous_client

    def test_threshold_and_window_expiration(self):
        self.assertEqual(rate_limits.hit('test-window', self.subject, 2, 2), 0)
        self.assertEqual(rate_limits.hit('test-window', self.subject, 2, 2), 0)
        self.assertGreater(rate_limits.hit('test-window', self.subject, 2, 2), 0)
        time.sleep(2.1)
        self.assertEqual(rate_limits.hit('test-window', self.subject, 2, 2), 0)

    def test_concurrent_hits_enforce_one_shared_threshold(self):
        limit = 12
        with ThreadPoolExecutor(max_workers=24) as pool:
            results = list(pool.map(
                lambda _: rate_limits.hit('test-concurrent', self.subject, limit, 30), range(48)))
        self.assertEqual(sum(retry == 0 for retry in results), limit)
        self.assertEqual(sum(retry > 0 for retry in results), 48 - limit)

    def test_redis_failure_is_explicit_and_recovers(self):
        class BrokenRedis:
            def eval(self, *args, **kwargs):
                raise OSError('redis unavailable')

        with mock.patch.object(rate_limits, '_client', BrokenRedis()):
            with self.assertRaises(rate_limits.RateLimitUnavailable):
                rate_limits.hit('test-recovery', self.subject, 1, 10)
        rate_limits._client = UnitRedis()
        self.assertEqual(rate_limits.hit('test-recovery', self.subject, 1, 10), 0)
