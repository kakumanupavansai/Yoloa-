"""One WebSocket per signed-in student at /ws/messages/.

A socket only ever joins its own user's group, so it can receive events for that student's conversations and nothing
else; there is no client-chosen subscription. Every message operation is re-authorised against the database.
"""
import json
import time
from importlib import import_module

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from django.contrib.auth import BACKEND_SESSION_KEY, HASH_SESSION_KEY, SESSION_KEY
from django.utils.crypto import constant_time_compare

from lms.models import User

from . import services
from .services import MessagingError, is_student, user_group

MAX_FRAME_BYTES = 32 * 1024
REVALIDATE_SECONDS = 15
CLOSE_UNAUTHENTICATED = 4401
CLOSE_FORBIDDEN = 4403


def reject_constant(name):
    raise ValueError(f'{name} is not valid JSON')


@database_sync_to_async
def session_is_valid(session_key, user_id):
    """Re-read the session from the store (not the cached copy in the scope) and check it still belongs to this
    active student. Signing out, changing the password and deactivation all make this false."""
    if not session_key:
        return False
    store = import_module(settings.SESSION_ENGINE).SessionStore(session_key)
    if str(store.get(SESSION_KEY)) != str(user_id) or not store.get(BACKEND_SESSION_KEY):
        return False
    user = User.objects.filter(pk=user_id).first()
    if not is_student(user):
        return False
    stored_hash = store.get(HASH_SESSION_KEY)
    return bool(stored_hash) and constant_time_compare(stored_hash, user.get_session_auth_hash())


class MessagingConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        self.user_id = None
        if not user or not user.is_authenticated:
            await self.close(code=CLOSE_UNAUTHENTICATED)  # rejected during the handshake
            return
        if not is_student(user):
            await self.close(code=CLOSE_FORBIDDEN)
            return
        session = self.scope.get('session')
        self.session_key = session.session_key if session is not None else None
        if not await session_is_valid(self.session_key, user.pk):
            await self.close(code=CLOSE_UNAUTHENTICATED)
            return
        self.user_id = user.pk
        self.checked_at = time.monotonic()
        await self.channel_layer.group_add(user_group(self.user_id), self.channel_name)
        await self.accept()
        latest = await database_sync_to_async(services.latest_message_id)(user)
        try:
            await self.send_json({'type': 'ready', 'userId': self.user_id, 'lastMessageId': latest})
        except Exception:  # noqa: BLE001 - the browser left mid-handshake (the error type depends on the ASGI server)
            # Returning normally lets the pending disconnect run, which removes this socket from the user's group.
            return

    async def disconnect(self, code):
        if self.user_id is not None:
            await self.channel_layer.group_discard(user_group(self.user_id), self.channel_name)

    async def still_valid(self, force=False):
        if not force and time.monotonic() - self.checked_at < REVALIDATE_SECONDS:
            return True
        if await session_is_valid(self.session_key, self.user_id):
            self.checked_at = time.monotonic()
            return True
        await self.close(code=CLOSE_UNAUTHENTICATED)
        return False

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if text_data is None or len(text_data) > MAX_FRAME_BYTES:
            await self.send_json({'type': 'error', 'code': 'invalid', 'message': 'Unsupported frame.'})
            return
        try:
            # Standard JSON only: Python would otherwise accept NaN/Infinity, which no id or count may be.
            content = json.loads(text_data, parse_constant=reject_constant)
        except ValueError:
            await self.send_json({'type': 'error', 'code': 'invalid', 'message': 'Malformed JSON.'})
            return
        if not isinstance(content, dict):
            await self.send_json({'type': 'error', 'code': 'invalid', 'message': 'Malformed message.'})
            return
        await self.receive_json(content)

    async def receive_json(self, content, **kwargs):
        kind = content.get('type')
        if kind == 'ping':
            await self.send_json({'type': 'pong'})
            return
        # Writes always check the live session; typing indicators use the periodic check.
        if not await self.still_valid(force=kind in ('message.send', 'conversation.read')):
            return
        user = await database_sync_to_async(User.objects.get)(pk=self.user_id)
        client_id = content.get('clientId')
        try:
            if kind == 'message.send':
                # The sender is always the session's user; any sender field in the payload is ignored.
                message, _ = await database_sync_to_async(services.send_message)(
                    user, content.get('conversationId'), content.get('body', ''), client_id)
                await self.send_json({'type': 'message.ack', 'clientId': client_id, 'message': message})
            elif kind == 'conversation.read':
                result = await database_sync_to_async(services.mark_read)(user, content.get('conversationId'), content.get('messageId'))
                await self.send_json({'type': 'read.ack', **result})
            elif kind == 'typing':
                await database_sync_to_async(services.check_typing_rate)(user)
                conversation_id, other_id = await database_sync_to_async(services.typing_targets)(user, content.get('conversationId'))
                await self.channel_layer.group_send(user_group(other_id), {
                    'type': 'chat.typing', 'conversationId': conversation_id, 'userId': self.user_id})
            else:
                await self.send_json({'type': 'error', 'code': 'invalid', 'message': 'Unknown action.'})
        except MessagingError as error:
            await self.send_json({'type': 'error', 'clientId': client_id, 'code': error.code, 'message': error.message})

    # ───── events from the channel layer (sent only to this user's own group) ─────
    async def chat_message(self, event):
        if await self.still_valid():
            await self.send_json({'type': 'message.new', 'message': event['message']})

    async def chat_read(self, event):
        if await self.still_valid():
            await self.send_json({'type': 'conversation.read', 'conversationId': event['conversationId'],
                                  'userId': event['userId'], 'lastReadId': event['lastReadId']})

    async def chat_typing(self, event):
        if await self.still_valid():
            await self.send_json({'type': 'typing', 'conversationId': event['conversationId'], 'userId': event['userId']})

    async def chat_revalidate(self, event):
        await self.still_valid(force=True)
