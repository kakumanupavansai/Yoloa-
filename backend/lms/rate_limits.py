"""Shared Redis fixed-window counters for abuse-sensitive operations.

The limiter fails closed: Redis errors raise an explicit service-unavailable response
instead of silently removing a security control or switching to process-local state.
"""
import hashlib
import ipaddress
import logging

import redis
from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

_INCREMENT = """
local value = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if value == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = redis.call('TTL', KEYS[1])
end
return {value, ttl}
"""

_client = None


class RateLimitUnavailable(Exception):
    """The configured shared limiter could not make a reliable decision."""


def _redis_client():
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            settings.CHANNEL_REDIS_URL,
            socket_connect_timeout=float(getattr(settings, 'RATE_LIMIT_REDIS_TIMEOUT', 1)),
            socket_timeout=float(getattr(settings, 'RATE_LIMIT_REDIS_TIMEOUT', 1)),
            retry_on_timeout=False,
            decode_responses=True,
        )
    return _client


def _safe_component(value):
    return hashlib.sha256(str(value).encode('utf-8')).hexdigest()


def _key(scope, subject):
    database = connection.settings_dict.get('NAME') or settings.DATABASES['default']['NAME']
    prefix = f"{settings.RATE_LIMIT_REDIS_PREFIX}-{database}"
    return f'{prefix}:{scope}:{_safe_component(subject)}'


def hit(scope, subject, limit, window):
    """Record an event atomically; return remaining seconds when over limit, else 0."""
    try:
        result = _redis_client().eval(_INCREMENT, 1, _key(scope, subject), int(window))
        count, ttl = int(result[0]), int(result[1])
    except Exception as error:  # noqa: BLE001 - fail closed on every Redis/protocol failure
        logger.error('Shared rate limiter unavailable for scope %s (%s)', scope, type(error).__name__)
        raise RateLimitUnavailable from error
    return max(ttl, 1) if count > int(limit) else 0


def clear(scope, subject):
    """Clear a subject's counter after successful verification."""
    try:
        _redis_client().delete(_key(scope, subject))
    except Exception as error:  # noqa: BLE001
        logger.error('Shared rate limiter unavailable while clearing scope %s (%s)', scope, type(error).__name__)
        raise RateLimitUnavailable from error


def request_ip(request):
    """Use forwarded addresses only when the socket peer matches configured trusted proxies."""
    peer = request.META.get('REMOTE_ADDR') or 'unknown'
    hops = settings.RATE_LIMIT_TRUSTED_PROXY_HOPS
    if not hops:
        return peer
    try:
        peer_ip = ipaddress.ip_address(peer)
        if not any(peer_ip in ipaddress.ip_network(cidr) for cidr in settings.RATE_LIMIT_TRUSTED_PROXY_CIDRS):
            return peer
        forwarded = [part.strip() for part in request.META.get('HTTP_X_FORWARDED_FOR', '').split(',') if part.strip()]
        index = len(forwarded) - hops
        if index < 0:
            return peer
        candidate = forwarded[index]
        ipaddress.ip_address(candidate)
        return candidate
    except ValueError:
        return peer


def check_login_attempt(request, identifier):
    """Count attempts by both normalized account identifier and network source."""
    account_retry = hit('login-account', str(identifier).strip().casefold(),
                        settings.LOGIN_RATE_ACCOUNT_LIMIT, settings.LOGIN_RATE_WINDOW_SECONDS)
    source_retry = hit('login-source', request_ip(request),
                       settings.LOGIN_RATE_SOURCE_LIMIT, settings.LOGIN_RATE_WINDOW_SECONDS)
    return max(account_retry, source_retry)
