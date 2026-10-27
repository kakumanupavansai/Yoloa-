"""Read-only startup check for the Redis channel layer used by real-time messaging.

    python manage.py check_redis

It sends PING to the configured Redis server and passes one event through the channel layer on a throwaway channel
(which Redis expires on its own). It never writes application data, flushes keys, or changes Redis configuration.
"""
import asyncio
import time
from urllib.parse import urlsplit

from channels.layers import get_channel_layer
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


def safe_url(url):
    """The Redis URL without any password, for printing."""
    parts = urlsplit(url)
    host = parts.hostname or ''
    port = f':{parts.port}' if parts.port else ''
    return f'{parts.scheme}://{"***@" if parts.password else ""}{host}{port}{parts.path}'


class Command(BaseCommand):
    help = 'Check that the Redis server behind the Channels layer answers PING and can relay a message.'

    def handle(self, *args, **options):
        backend = settings.CHANNEL_LAYERS['default']['BACKEND']
        if not backend.startswith('channels_redis'):
            raise CommandError(f'The channel layer is {backend}, not Redis (CHANNEL_LAYER=memory is set?).')
        self.stdout.write(f'Redis URL: {safe_url(settings.CHANNEL_REDIS_URL)}')
        try:
            import redis
            started = time.perf_counter()
            client = redis.Redis.from_url(settings.CHANNEL_REDIS_URL, socket_connect_timeout=3, socket_timeout=3)
            client.ping()
            ping_ms = (time.perf_counter() - started) * 1000
            version = client.info('server').get('redis_version', '?')
            client.close()
        except Exception as error:  # noqa: BLE001
            raise CommandError(f'Redis did not answer PING: {error}. Start it in Ubuntu (WSL2): sudo service redis-server start')
        self.stdout.write(f'PING ok ({ping_ms:.1f} ms), Redis {version}')
        try:
            elapsed = asyncio.run(self.round_trip())
        except Exception as error:  # noqa: BLE001
            raise CommandError(f'Redis answered PING, but the channel layer round trip failed: {error}')
        self.stdout.write(self.style.SUCCESS(f'Channel layer round trip ok ({elapsed:.1f} ms). Real-time messaging can use Redis.'))

    async def round_trip(self):
        layer = get_channel_layer()
        channel = await layer.new_channel('healthcheck.')
        started = time.perf_counter()
        await layer.send(channel, {'type': 'healthcheck', 'ok': True})
        message = await asyncio.wait_for(layer.receive(channel), timeout=5)
        if message.get('ok') is not True:
            raise RuntimeError('unexpected message')
        return (time.perf_counter() - started) * 1000
