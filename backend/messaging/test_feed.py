"""Public student feed: access rules, validation, isolation from private messages and real-time delivery.

Uses the in-memory channel layer, so these tests never touch Redis.
"""
from asgiref.sync import sync_to_async
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, TransactionTestCase, override_settings

from lms.test_support import RateLimitIsolationMixin

from . import feed
from .models import FeedAttachment, FeedPost
from .tests import CHAT_MEMORY_LAYER, PrivateMediaMixin, SocketTestMixin, make_user, png_bytes


@override_settings(CHANNEL_LAYERS=CHAT_MEMORY_LAYER)
class FeedHttpTests(RateLimitIsolationMixin, PrivateMediaMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.alice = make_user('alice')
        self.bob = make_user('bob')
        self.admin = make_user('chief', role='admin')
        self.client.force_login(self.alice)

    def post(self, data):
        return self.client.post('/api/feed/posts', data)

    def test_only_signed_in_students_can_use_the_feed(self):
        self.client.logout()
        self.assertEqual(self.client.get('/api/feed/posts').status_code, 401)
        self.assertEqual(self.post({'body': 'hi'}).status_code, 401)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.get('/api/feed/posts').status_code, 403)
        self.assertEqual(self.post({'body': 'hi'}).status_code, 403)
        self.assertFalse(FeedPost.objects.exists())

    def test_text_link_and_files_are_visible_to_other_students_with_author_and_time(self):
        created = self.post({'body': 'Notes for chapter 2', 'link': 'https://example.com/notes',
                             'files': [SimpleUploadedFile('diagram.png', png_bytes(), content_type='image/png'),
                                       SimpleUploadedFile('notes.txt', b'mitochondria', content_type='text/plain')]})
        self.assertEqual(created.status_code, 201, created.json())
        self.client.force_login(self.bob)
        rows = self.client.get('/api/feed/posts').json()['results']
        self.assertEqual(len(rows), 1)
        post = rows[0]
        self.assertEqual((post['author']['id'], post['author']['name'], post['body'], post['link']),
                         (self.alice.id, self.alice.display_name, 'Notes for chapter 2', 'https://example.com/notes'))
        self.assertNotIn('email', post['author'])
        self.assertTrue(post['createdAt'])
        image, note = post['attachments']
        self.assertEqual((image['kind'], note['kind']), ('image', 'document'))
        shown = self.client.get(f"/api{image['url']}")
        self.assertEqual(shown.status_code, 200)
        self.assertEqual(shown['Content-Type'], 'image/png')
        self.assertNotIn('attachment', shown.get('Content-Disposition', ''))
        self.assertIn('attachment', self.client.get(f"/api{note['url']}")['Content-Disposition'])

    def test_validation_of_links_files_and_empty_posts(self):
        self.assertEqual(self.post({'body': ''}).status_code, 400)
        self.assertEqual(self.post({'body': 'x', 'link': 'javascript:alert(1)'}).status_code, 400)
        self.assertEqual(self.post({'body': 'x', 'link': 'ftp://example.com/file'}).status_code, 400)
        self.assertEqual(self.post({'body': 'x' * 5001}).status_code, 400)
        fake = SimpleUploadedFile('photo.png', b'MZ\x90\x00 not an image', content_type='image/png')
        self.assertEqual(self.post({'body': 'x', 'files': [fake]}).status_code, 400)
        exe = SimpleUploadedFile('tool.exe', b'MZ\x90\x00', content_type='application/octet-stream')
        self.assertEqual(self.post({'body': 'x', 'files': [exe]}).status_code, 400)
        with override_settings(MAX_CHAT_ATTACHMENT_BYTES=10):
            big = SimpleUploadedFile('a.png', png_bytes(), content_type='image/png')
            self.assertEqual(self.post({'body': 'x', 'files': [big]}).status_code, 400)
        self.assertFalse(FeedPost.objects.exists())
        self.assertFalse(FeedAttachment.objects.exists())

    def test_only_the_author_can_delete_a_post(self):
        post_id = self.post({'body': 'mine'}).json()['id']
        self.client.force_login(self.bob)
        self.assertEqual(self.client.delete(f'/api/feed/posts/{post_id}').status_code, 404)
        self.client.force_login(self.alice)
        self.assertEqual(self.client.delete(f'/api/feed/posts/{post_id}').status_code, 204)
        self.assertFalse(FeedPost.objects.exists())

    def test_feed_never_exposes_private_messages_or_their_attachments(self):
        carol = make_user('carol')
        conv = self.client.post('/api/messages/conversations', {'userId': carol.id}, content_type='application/json').json()['id']
        sent = self.client.post(f'/api/messages/conversations/{conv}/messages',
                                {'body': 'secret plan', 'files': [SimpleUploadedFile('p.png', png_bytes(), content_type='image/png')]}).json()
        private_id = sent['attachments'][0]['id']
        self.client.force_login(self.bob)
        listing = self.client.get('/api/feed/posts').json()
        self.assertEqual(listing['results'], [])
        self.assertNotIn('secret plan', str(listing))
        self.assertEqual(self.client.get(f'/api/feed/attachments/{private_id}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/messages/attachments/{private_id}').status_code, 404)

    def test_posts_of_deactivated_students_are_hidden(self):
        self.post({'body': 'before leaving'})
        self.alice.is_active = False
        self.alice.save(update_fields=['is_active'])
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get('/api/feed/posts').json()['results'], [])

    def test_paging_with_before(self):
        ids = [self.post({'body': f'post {n}'}).json()['id'] for n in range(3)]
        page = self.client.get('/api/feed/posts?limit=2').json()
        self.assertEqual([row['id'] for row in page['results']], [ids[2], ids[1]])
        self.assertTrue(page['hasMore'])
        rest = self.client.get(f'/api/feed/posts?limit=2&before={ids[1]}').json()
        self.assertEqual([row['id'] for row in rest['results']], [ids[0]])
        self.assertFalse(rest['hasMore'])


@override_settings(CHANNEL_LAYERS=CHAT_MEMORY_LAYER)
class FeedRealtimeTests(RateLimitIsolationMixin, SocketTestMixin, TransactionTestCase):
    async def test_new_and_deleted_posts_reach_other_students_sockets(self):
        alice = await sync_to_async(make_user)('alice')
        bob = await sync_to_async(make_user)('bob')
        communicator, connected, _ = await self.connect(await sync_to_async(self.login_cookie)(bob))
        self.assertTrue(connected)
        await self.receive_type(communicator, 'ready')
        post = await sync_to_async(feed.create_post)(alice, 'Hello everyone')
        event = await self.receive_type(communicator, 'feed.post')
        self.assertEqual((event['post']['id'], event['post']['body']), (post['id'], 'Hello everyone'))
        await sync_to_async(feed.delete_post)(alice, post['id'])
        self.assertEqual((await self.receive_type(communicator, 'feed.delete'))['postId'], post['id'])
        await communicator.disconnect()
