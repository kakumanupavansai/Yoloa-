"""Student messaging tests.

HTTP and WebSocket tests use Channels' in-memory layer (CHAT_MEMORY_LAYER), so they never touch Redis.
RedisChannelLayerTests uses the real Redis server from CHANNEL_REDIS_URL with a throwaway key prefix; it is skipped,
and says so, when Redis does not answer PING.
"""
import asyncio
import io
import shutil
import tempfile
import uuid
from unittest import mock

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.layers import get_channel_layer
from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, TransactionTestCase, override_settings
from PIL import Image

from config.asgi import application
from lms.models import User
from lms.test_support import RateLimitIsolationMixin

from .models import Conversation, ConversationMember, Message, MessageAttachment

CHAT_MEMORY_LAYER = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}
ORIGIN = b'http://localhost:5173'
PASSWORD = 'Str0ng-test-pass!'


def png_bytes():
    out = io.BytesIO()
    Image.new('RGB', (4, 4), (40, 90, 200)).save(out, 'PNG')
    return out.getvalue()


def make_user(username, role='student', **extra):
    return User.objects.create_user(username=username, email=f'{username}@example.test', password=PASSWORD, role=role,
                                    first_name=extra.pop('first_name', username.title()), last_name=extra.pop('last_name', 'Tester'), **extra)


class PrivateMediaMixin:
    def setUp(self):
        super().setUp()
        self.media_dir = tempfile.mkdtemp(prefix='yoloa-chat-test-')
        self.media_override = override_settings(PRIVATE_MEDIA_ROOT=self.media_dir)
        self.media_override.enable()

    def tearDown(self):
        self.media_override.disable()
        shutil.rmtree(self.media_dir, ignore_errors=True)
        super().tearDown()


@override_settings(CHANNEL_LAYERS=CHAT_MEMORY_LAYER)
class MessagingHttpTests(RateLimitIsolationMixin, PrivateMediaMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.alice = make_user('alice', first_name='Alice', last_name='Anand')
        self.bob = make_user('bob', first_name='Bob', last_name='Bose')
        self.carol = make_user('carol', first_name='Carol', last_name='Cruz')
        self.admin = make_user('admin1', role='admin', first_name='Ada', last_name='Admin')
        self.client.force_login(self.alice)

    def open_with(self, other):
        return self.client.post('/api/messages/conversations', {'userId': other.id}, content_type='application/json')

    def send(self, conv_id, body='hello', **extra):
        return self.client.post(f'/api/messages/conversations/{conv_id}/messages', {'body': body, **extra}, content_type='application/json')

    def test_requires_signed_in_student(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/messages/conversations').status_code, 401)
        self.client.force_login(self.admin)
        for url in ('/api/messages/conversations', '/api/messages/students?q=al', '/api/messages/unread', '/api/messages/sync'):
            self.assertEqual(self.client.get(url).status_code, 403, url)
        self.assertEqual(self.open_with(self.bob).status_code, 403)

    def test_search_finds_active_students_only_without_emails(self):
        make_user('alfred', is_active=False)
        make_user('al-admin', role='admin')
        rows = self.client.get('/api/messages/students?q=bo').json()['results']
        self.assertEqual([r['id'] for r in rows], [self.bob.id])
        self.assertNotIn('email', rows[0])
        self.assertEqual(self.client.get('/api/messages/students?q=Bob Bose').json()['results'][0]['id'], self.bob.id)
        self.assertEqual(self.client.get('/api/messages/students?q=bob@example.test').json()['results'][0]['id'], self.bob.id)
        self.assertEqual(self.client.get('/api/messages/students?q=al').json()['results'], [])  # self, admin, inactive excluded
        self.assertEqual(self.client.get('/api/messages/students?q=b').json()['results'], [])  # too short

    def test_open_conversation_is_idempotent_and_student_only(self):
        first = self.open_with(self.bob)
        self.assertEqual(first.status_code, 201)
        again = self.open_with(self.bob)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.json()['id'], again.json()['id'])
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(ConversationMember.objects.filter(conversation_id=first.json()['id']).count(), 2)
        self.assertEqual(self.open_with(self.alice).status_code, 400)
        self.assertEqual(self.open_with(self.admin).status_code, 404)
        self.client.force_login(self.bob)
        self.assertEqual(self.open_with(self.alice).json()['id'], first.json()['id'])

    def test_send_persists_with_session_sender_and_client_id_is_idempotent(self):
        conv = self.open_with(self.bob).json()['id']
        client_id = str(uuid.uuid4())
        sent = self.send(conv, 'Hi Bob', clientId=client_id, sender=self.bob.id, senderId=self.bob.id)
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(sent.json()['sender']['id'], self.alice.id)
        retry = self.send(conv, 'Hi Bob', clientId=client_id)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['id'], sent.json()['id'])
        self.assertEqual(Message.objects.count(), 1)
        self.assertEqual(Message.objects.get().sender, self.alice)
        self.assertEqual(self.send(conv, '   ').status_code, 400)
        self.assertEqual(self.send(conv, 'x' * 4001).status_code, 400)

    def test_redis_outage_still_stores_the_message_and_tries_redis_only_once(self):
        conv = self.open_with(self.bob).json()['id']
        calls = []

        async def failing_group_send(group, event):
            calls.append(group)
            raise ConnectionError('Redis is down')
        layer = mock.Mock(group_send=failing_group_send)
        with mock.patch('messaging.services.get_channel_layer', return_value=layer), \
                self.assertLogs('messaging.services', 'ERROR'), self.captureOnCommitCallbacks(execute=True):
            sent = self.send(conv, 'stored anyway')
        self.assertEqual(sent.status_code, 201)
        self.assertEqual(Message.objects.get().body, 'stored anyway')
        self.assertEqual(len(calls), 1, 'a failed Redis call is not repeated for every recipient')

    def test_non_members_cannot_see_or_use_a_conversation(self):
        conv = self.open_with(self.bob).json()['id']
        self.send(conv, 'private')
        self.client.force_login(self.carol)
        base = f'/api/messages/conversations/{conv}'
        self.assertEqual(self.client.get(base).status_code, 404)
        self.assertEqual(self.client.get(f'{base}/messages').status_code, 404)
        self.assertEqual(self.send(conv, 'intrusion').status_code, 404)
        self.assertEqual(self.client.post(f'{base}/read', {}, content_type='application/json').status_code, 404)
        self.assertEqual(self.client.get('/api/messages/sync?after=0').json()['results'], [])
        self.assertEqual(self.client.get('/api/messages/conversations').json()['results'], [])
        self.assertEqual(Message.objects.count(), 1)

    def test_unread_counts_and_read_state(self):
        conv = self.open_with(self.bob).json()['id']
        self.client.force_login(self.bob)
        ids = [self.send(conv, f'm{i}').json()['id'] for i in range(3)]
        self.client.force_login(self.alice)
        self.assertEqual(self.client.get('/api/messages/unread').json()['unread'], 3)
        row = self.client.get('/api/messages/conversations').json()['results'][0]
        self.assertEqual((row['unreadCount'], row['otherUser']['id'], row['lastMessage']['body']), (3, self.bob.id, 'm2'))
        read = self.client.post(f'/api/messages/conversations/{conv}/read', {'messageId': ids[1]}, content_type='application/json')
        self.assertEqual(read.json()['lastReadId'], ids[1])
        self.assertEqual(self.client.get('/api/messages/unread').json()['unread'], 1)
        # Read state never moves backwards, and a too-large id is clamped to the newest message.
        self.client.post(f'/api/messages/conversations/{conv}/read', {'messageId': ids[0]}, content_type='application/json')
        self.client.post(f'/api/messages/conversations/{conv}/read', {'messageId': 10 ** 9}, content_type='application/json')
        self.assertEqual(ConversationMember.objects.get(conversation_id=conv, user=self.alice).last_read_message_id, ids[2])
        self.assertEqual(self.client.get('/api/messages/unread').json()['unread'], 0)
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get(f'/api/messages/conversations/{conv}').json()['otherLastReadId'], ids[2])

    def test_sending_is_rate_limited(self):
        conv = self.open_with(self.bob).json()['id']
        codes = [self.send(conv, f'm{i}').status_code for i in range(25)]
        self.assertIn(429, codes)
        self.assertLessEqual(Message.objects.count(), 20)

    @mock.patch('messaging.services.SEND_RATE', (1000, 10))
    def test_history_pagination_and_sync(self):
        conv = self.open_with(self.bob).json()['id']
        ids = [self.send(conv, f'm{i}').json()['id'] for i in range(35)]
        page = self.client.get(f'/api/messages/conversations/{conv}/messages').json()
        self.assertEqual([m['id'] for m in page['results']], ids[-30:])
        self.assertTrue(page['hasMore'])
        older = self.client.get(f'/api/messages/conversations/{conv}/messages?before={ids[-30]}').json()
        self.assertEqual([m['id'] for m in older['results']], ids[:5])
        self.assertFalse(older['hasMore'])
        newer = self.client.get(f'/api/messages/conversations/{conv}/messages?after={ids[30]}').json()
        self.assertEqual([m['id'] for m in newer['results']], ids[31:])
        synced = self.client.get(f'/api/messages/sync?after={ids[32]}').json()
        self.assertEqual([m['id'] for m in synced['results']], ids[33:])
        self.assertEqual(self.client.get(f'/api/messages/conversations/{conv}/messages?before=abc').status_code, 400)

    def upload(self, conv, *files, body=''):
        return self.client.post(f'/api/messages/conversations/{conv}/messages',
                                {'body': body, 'clientId': str(uuid.uuid4()), 'files': list(files)})

    def test_attachments_are_validated_by_content(self):
        conv = self.open_with(self.bob).json()['id']
        ok = self.upload(conv, SimpleUploadedFile('photo.PNG', png_bytes(), 'image/png'),
                         SimpleUploadedFile('notes.pdf', b'%PDF-1.4\n%test\n', 'application/pdf'), body='files')
        self.assertEqual(ok.status_code, 201, ok.content)
        kinds = sorted((a['name'], a['kind'], a['contentType']) for a in ok.json()['attachments'])
        self.assertEqual(kinds, [('notes.pdf', 'document', 'application/pdf'), ('photo.PNG', 'image', 'image/png')])
        rejected = [
            SimpleUploadedFile('fake.png', b'<script>alert(1)</script>', 'image/png'),
            SimpleUploadedFile('virus.exe', b'MZ\x90\x00', 'application/octet-stream'),
            SimpleUploadedFile('page.svg', b'<svg onload="alert(1)"/>', 'image/svg+xml'),
            SimpleUploadedFile('fake.pdf', b'not a pdf', 'application/pdf'),
            SimpleUploadedFile('fake.docx', b'PK\x03\x04garbage', 'application/octet-stream'),
            SimpleUploadedFile('binary.txt', b'abc\x00def', 'text/plain'),
            SimpleUploadedFile('empty.pdf', b'', 'application/pdf'),
        ]
        for upload in rejected:
            self.assertEqual(self.upload(conv, upload).status_code, 400, upload.name)
        with override_settings(MAX_CHAT_ATTACHMENT_BYTES=1024):
            self.assertEqual(self.upload(conv, SimpleUploadedFile('big.txt', b'a' * 2048, 'text/plain')).status_code, 400)
        too_many = [SimpleUploadedFile(f'n{i}.txt', b'hi', 'text/plain') for i in range(settings.MAX_CHAT_ATTACHMENTS + 1)]
        self.assertEqual(self.upload(conv, *too_many).status_code, 400)
        self.assertEqual(MessageAttachment.objects.count(), 2)
        stored = MessageAttachment.objects.get(kind='image').file.name
        self.assertTrue(stored.startswith('chat_attachments/') and 'photo' not in stored)

    def test_attachment_download_is_members_only(self):
        conv = self.open_with(self.bob).json()['id']
        message = self.upload(conv, SimpleUploadedFile('photo.png', png_bytes(), 'image/png'),
                              SimpleUploadedFile('list.csv', b'a,b\n1,2\n', 'text/csv')).json()
        image, doc = sorted(message['attachments'], key=lambda a: a['kind'], reverse=True)
        res = self.client.get(f"/api{image['url']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'image/png')
        self.assertEqual(res['X-Content-Type-Options'], 'nosniff')
        self.assertNotIn('attachment', res.get('Content-Disposition', ''))
        self.assertIn('attachment', self.client.get(f"/api{doc['url']}")['Content-Disposition'])
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get(f"/api{doc['url']}").status_code, 200)
        self.client.force_login(self.carol)
        self.assertEqual(self.client.get(f"/api{image['url']}").status_code, 404)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get(f"/api{image['url']}").status_code, 403)
        self.client.logout()
        self.assertEqual(self.client.get(f"/api{image['url']}").status_code, 401)

    def test_cannot_message_a_student_who_is_no_longer_available(self):
        conv = self.open_with(self.bob).json()['id']
        User.objects.filter(pk=self.bob.pk).update(is_active=False)
        self.assertEqual(self.send(conv).status_code, 403)
        self.assertEqual(self.client.get(f'/api/messages/conversations/{conv}/messages').status_code, 200)

    def test_send_requires_csrf_token_for_browser_sessions(self):
        conv = self.open_with(self.bob).json()['id']
        strict = self.client_class(enforce_csrf_checks=True)
        strict.force_login(self.alice)
        res = strict.post(f'/api/messages/conversations/{conv}/messages', {'body': 'x'}, content_type='application/json')
        self.assertEqual(res.status_code, 403)


class SocketTestMixin(PrivateMediaMixin):
    def login_cookie(self, user):
        # A separate client per user: logging a second user into the same client would end the first session.
        client = Client()
        client.force_login(user)
        return client.cookies[settings.SESSION_COOKIE_NAME].value

    async def connect(self, session_key=None, origin=ORIGIN):
        headers = [(b'origin', origin)] if origin else []
        if session_key:
            headers.append((b'cookie', f'{settings.SESSION_COOKIE_NAME}={session_key}'.encode()))
        communicator = WebsocketCommunicator(application, '/ws/messages/', headers=headers)
        connected, code = await communicator.connect(timeout=5)
        return communicator, connected, code

    async def receive_type(self, communicator, kind, timeout=5):
        while True:
            event = await communicator.receive_json_from(timeout=timeout)
            if event['type'] == kind:
                return event


@override_settings(CHANNEL_LAYERS=CHAT_MEMORY_LAYER)
class MessagingWebSocketTests(RateLimitIsolationMixin, SocketTestMixin, TransactionTestCase):
    """WebSocket behaviour over the in-memory channel layer (single process; no Redis involved)."""

    def setUp(self):
        super().setUp()
        self.alice = make_user('alice')
        self.bob = make_user('bob')
        self.carol = make_user('carol')
        self.admin = make_user('admin1', role='admin')
        low, high = sorted([self.alice.id, self.bob.id])
        self.conv = Conversation.objects.create(user_low_id=low, user_high_id=high)
        ConversationMember.objects.bulk_create([ConversationMember(conversation=self.conv, user=self.alice),
                                                ConversationMember(conversation=self.conv, user=self.bob)])
        self.alice_key = self.login_cookie(self.alice)
        self.bob_key = self.login_cookie(self.bob)
        self.carol_key = self.login_cookie(self.carol)
        self.admin_key = self.login_cookie(self.admin)

    async def test_rejects_anonymous_admin_forged_and_cross_origin_connections(self):
        for key, origin in ((None, ORIGIN), (self.admin_key, ORIGIN), ('forged-session-key', ORIGIN),
                            (self.alice_key, b'http://evil.example'), (self.alice_key, b'http://localhost:3000'),
                            (self.alice_key, None)):
            communicator, connected, _ = await self.connect(key, origin)
            self.assertFalse(connected, (key, origin))
            await communicator.disconnect()

    async def test_real_time_delivery_between_two_students(self):
        alice, ok_a, _ = await self.connect(self.alice_key)
        bob, ok_b, _ = await self.connect(self.bob_key)
        self.assertTrue(ok_a and ok_b)
        await self.receive_type(alice, 'ready')
        await self.receive_type(bob, 'ready')
        client_id = str(uuid.uuid4())
        await alice.send_json_to({'type': 'message.send', 'conversationId': self.conv.id, 'body': 'Hello Bob',
                                  'clientId': client_id, 'sender': self.bob.id, 'senderId': self.bob.id})
        ack = await self.receive_type(alice, 'message.ack')
        pushed = await self.receive_type(bob, 'message.new')
        self.assertEqual(pushed['message']['id'], ack['message']['id'])
        self.assertEqual(pushed['message']['sender']['id'], self.alice.id)  # payload sender ignored
        self.assertEqual(pushed['message']['body'], 'Hello Bob')
        stored = await database_sync_to_async(Message.objects.get)(pk=ack['message']['id'])
        self.assertEqual((stored.sender_id, stored.body, str(stored.client_id)), (self.alice.id, 'Hello Bob', client_id))
        # Bob reads it; Alice gets the read receipt.
        await bob.send_json_to({'type': 'conversation.read', 'conversationId': self.conv.id, 'messageId': stored.id})
        receipt = await self.receive_type(alice, 'conversation.read')
        self.assertEqual((receipt['userId'], receipt['lastReadId']), (self.bob.id, stored.id))
        # Typing indicators reach only the other member.
        await alice.send_json_to({'type': 'typing', 'conversationId': self.conv.id})
        self.assertEqual((await self.receive_type(bob, 'typing'))['userId'], self.alice.id)
        await alice.disconnect()
        await bob.disconnect()

    async def test_outsider_cannot_send_or_subscribe(self):
        carol, ok, _ = await self.connect(self.carol_key)
        bob, _, _ = await self.connect(self.bob_key)
        self.assertTrue(ok)
        await self.receive_type(carol, 'ready')
        await self.receive_type(bob, 'ready')
        for action in ({'type': 'message.send', 'conversationId': self.conv.id, 'body': 'intrusion', 'clientId': str(uuid.uuid4())},
                       {'type': 'conversation.read', 'conversationId': self.conv.id},
                       {'type': 'typing', 'conversationId': self.conv.id}):
            await carol.send_json_to(action)
            error = await self.receive_type(carol, 'error')
            self.assertEqual(error['code'], 'not_found')
        self.assertEqual(await database_sync_to_async(Message.objects.count)(), 0)
        self.assertTrue(await bob.receive_nothing(timeout=0.3))
        # A message between Alice and Bob is never delivered to Carol's socket.
        await database_sync_to_async(self.http_send)(self.alice, 'just for bob')
        self.assertEqual((await self.receive_type(bob, 'message.new'))['message']['body'], 'just for bob')
        self.assertTrue(await carol.receive_nothing(timeout=0.3))
        await carol.disconnect()
        await bob.disconnect()

    def http_send(self, user, body):
        self.client.force_login(user)
        res = self.client.post(f'/api/messages/conversations/{self.conv.id}/messages', {'body': body}, content_type='application/json')
        assert res.status_code == 201, res.content
        return res.json()

    async def test_messages_sent_while_offline_are_recovered_after_reconnect(self):
        bob, _, _ = await self.connect(self.bob_key)
        ready = await self.receive_type(bob, 'ready')
        last_seen = ready['lastMessageId']
        await bob.disconnect()
        missed = [await database_sync_to_async(self.http_send)(self.alice, f'while offline {i}') for i in range(3)]
        bob, _, _ = await self.connect(self.bob_key)
        ready = await self.receive_type(bob, 'ready')
        self.assertEqual(ready['lastMessageId'], missed[-1]['id'])
        await sync_to_async(self.client.force_login)(self.bob)
        synced = await sync_to_async(self.client.get)(f'/api/messages/sync?after={last_seen}')
        self.assertEqual([m['id'] for m in synced.json()['results']], [m['id'] for m in missed])
        await bob.disconnect()

    async def test_signing_out_closes_the_socket(self):
        alice, _, _ = await self.connect(self.alice_key)
        await self.receive_type(alice, 'ready')
        await database_sync_to_async(self.logout_session)(self.alice_key)
        closed = await alice.receive_output(timeout=5)
        self.assertEqual(closed['type'], 'websocket.close')
        self.assertEqual(closed.get('code'), 4401)

    def logout_session(self, key):
        from django.contrib.sessions.backends.db import SessionStore
        from django.contrib.auth.signals import user_logged_out
        SessionStore(key).delete()
        user_logged_out.send(sender=User, request=None, user=self.alice)

    async def test_malformed_frames_are_rejected(self):
        alice, _, _ = await self.connect(self.alice_key)
        await self.receive_type(alice, 'ready')
        await alice.send_to(text_data='not json')
        self.assertEqual((await self.receive_type(alice, 'error'))['code'], 'invalid')
        await alice.send_to(text_data='x' * (33 * 1024))
        self.assertEqual((await self.receive_type(alice, 'error'))['code'], 'invalid')
        await alice.send_json_to({'type': 'ping'})
        await self.receive_type(alice, 'pong')
        await alice.disconnect()

    async def test_non_integer_ids_and_bodies_get_errors_without_closing_the_socket(self):
        alice, _, _ = await self.connect(self.alice_key)
        await self.receive_type(alice, 'ready')
        conv = self.conv.id
        # Python's json accepts Infinity/NaN, and int(Infinity) raised OverflowError, which closed the socket with 1011.
        for frame, code in (('{"type": "message.send", "conversationId": Infinity, "body": "x"}', 'invalid'),
                            ('{"type": "conversation.read", "conversationId": %d, "messageId": NaN}' % conv, 'invalid')):
            await alice.send_to(text_data=frame)
            self.assertEqual((await self.receive_type(alice, 'error'))['code'], code, frame)
        for payload, code in (({'conversationId': conv + 0.5}, 'not_found'), ({'conversationId': True}, 'not_found'),
                              ({'conversationId': [conv]}, 'not_found'), ({'conversationId': 10 ** 30}, 'not_found'),
                              ({'conversationId': conv, 'body': ['list']}, 'invalid')):
            await alice.send_json_to({'type': 'message.send', 'body': 'x', 'clientId': str(uuid.uuid4()), **payload})
            self.assertEqual((await self.receive_type(alice, 'error'))['code'], code, payload)
        await alice.send_json_to({'type': 'conversation.read', 'conversationId': conv, 'messageId': 1.5})
        self.assertEqual((await self.receive_type(alice, 'error'))['code'], 'invalid')
        await alice.send_json_to({'type': 'ping'})
        await self.receive_type(alice, 'pong')
        self.assertEqual(await database_sync_to_async(Message.objects.count)(), 0)
        await alice.disconnect()


def redis_reachable():
    try:
        import redis
        client = redis.Redis.from_url(settings.CHANNEL_REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        client.close()
        return True
    except Exception:  # noqa: BLE001
        return False


def redis_layer():
    """The project's Redis layer settings (same hosts and timeouts), with a throwaway key prefix."""
    base = settings.CHANNEL_LAYERS['default']
    if not base['BACKEND'].startswith('channels_redis'):
        base = {'BACKEND': 'channels_redis.core.RedisChannelLayer', 'CONFIG': {'hosts': [settings.CHANNEL_REDIS_URL]}}
    return {'default': {**base, 'CONFIG': {**base['CONFIG'], 'prefix': f'yoloa-test-{uuid.uuid4().hex[:8]}'}}}


REDIS_LAYER = redis_layer()


@override_settings(CHANNEL_LAYERS=REDIS_LAYER)
class RedisChannelLayerTests(RateLimitIsolationMixin, SocketTestMixin, TransactionTestCase):
    """End-to-end delivery through the real Redis server (CHANNEL_REDIS_URL), using an isolated key prefix."""

    @classmethod
    def setUpClass(cls):
        if not redis_reachable():
            raise __import__('unittest').SkipTest(f'Redis is not answering at {settings.CHANNEL_REDIS_URL}; Redis-backed tests NOT run.')
        super().setUpClass()

    async def test_redis_layer_round_trip(self):
        layer = get_channel_layer()
        self.assertEqual(type(layer).__name__, 'RedisChannelLayer')
        channel = await layer.new_channel()
        await layer.send(channel, {'type': 'test.message', 'value': 42})
        self.assertEqual((await asyncio.wait_for(layer.receive(channel), 5))['value'], 42)

    async def test_two_students_exchange_messages_through_redis(self):
        alice_user, bob_user = await database_sync_to_async(lambda: (make_user('ralice'), make_user('rbob')))()
        low, high = sorted([alice_user.id, bob_user.id])

        def setup():
            conv = Conversation.objects.create(user_low_id=low, user_high_id=high)
            ConversationMember.objects.bulk_create([ConversationMember(conversation=conv, user_id=low),
                                                    ConversationMember(conversation=conv, user_id=high)])
            return conv, self.login_cookie(alice_user), self.login_cookie(bob_user)
        conv, alice_key, bob_key = await database_sync_to_async(setup)()
        alice, ok_a, _ = await self.connect(alice_key)
        bob, ok_b, _ = await self.connect(bob_key)
        self.assertTrue(ok_a and ok_b)
        await self.receive_type(alice, 'ready')
        await self.receive_type(bob, 'ready')
        await alice.send_json_to({'type': 'message.send', 'conversationId': conv.id, 'body': 'via redis', 'clientId': str(uuid.uuid4())})
        pushed = await self.receive_type(bob, 'message.new')
        self.assertEqual(pushed['message']['body'], 'via redis')
        self.assertTrue(await database_sync_to_async(Message.objects.filter(pk=pushed['message']['id'], body='via redis').exists)())
        # The sender's own sockets get the message too (other tabs stay in sync).
        self.assertEqual((await self.receive_type(alice, 'message.new'))['message']['body'], 'via redis')
        await bob.send_json_to({'type': 'message.send', 'conversationId': conv.id, 'body': 'reply', 'clientId': str(uuid.uuid4())})
        self.assertEqual((await self.receive_type(alice, 'message.new'))['message']['body'], 'reply')
        await alice.disconnect()
        await bob.disconnect()
