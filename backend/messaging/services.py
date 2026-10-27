"""Messaging rules shared by the HTTP API and the WebSocket consumer.

Every operation takes the acting user from the authenticated session (never from the payload) and checks that the
user is an active student who belongs to the conversation. Messages are committed to PostgreSQL first; the
real-time event is sent only after the transaction commits.
"""
import logging
import os
import uuid
import zipfile

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Count, F, OuterRef, Q, Subquery, Value
from django.db.models.functions import Coalesce, Concat
from django.utils import timezone
from django.utils.text import get_valid_filename
from PIL import Image, UnidentifiedImageError

from lms.models import User
from lms.rate_limits import RateLimitUnavailable, hit as hit_rate_limit

from .models import Conversation, ConversationMember, Message, MessageAttachment

logger = logging.getLogger(__name__)

MAX_BODY_LENGTH = 4000
HISTORY_PAGE = 30
MAX_PAGE = 100
SYNC_PAGE = 200
SEND_RATE = (settings.MESSAGE_RATE_LIMIT, settings.MESSAGE_RATE_WINDOW_SECONDS)

IMAGE_TYPES = {'JPEG': 'image/jpeg', 'PNG': 'image/png', 'GIF': 'image/gif', 'WEBP': 'image/webp'}
IMAGE_EXTENSIONS = {'.jpg': 'JPEG', '.jpeg': 'JPEG', '.png': 'PNG', '.gif': 'GIF', '.webp': 'WEBP'}
OOXML = {'.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'}
OLE = {'.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint'}
TEXT = {'.txt': 'text/plain', '.csv': 'text/csv'}
ALLOWED_EXTENSIONS = sorted([*IMAGE_EXTENSIONS, '.pdf', *OOXML, *OLE, *TEXT])


class MessagingError(Exception):
    """A rule violation with a message that is safe to show to the user."""
    def __init__(self, message, status=400, code='invalid'):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


def is_student(user):
    return bool(user and user.is_authenticated and user.is_active and user.role == 'student')


def user_group(user_id):
    return f'chat.user.{user_id}'


# ───────────────────────── Serialisation ─────────────────────────
def person_json(user, request=None):
    avatar = ''
    if user.avatar:
        avatar = request.build_absolute_uri(user.avatar.url) if request else user.avatar.url
    return {'id': user.id, 'name': user.display_name, 'username': user.username, 'avatar': avatar}


def attachment_json(item):
    return {'id': item.id, 'name': item.original_name, 'size': item.size, 'kind': item.kind,
            'contentType': item.content_type, 'url': f'/messages/attachments/{item.id}'}


def message_json(msg):
    return {
        'id': msg.id, 'conversationId': msg.conversation_id,
        'sender': {'id': msg.sender_id, 'name': msg.sender.display_name},
        'body': msg.body, 'clientId': str(msg.client_id) if msg.client_id else None,
        'createdAt': msg.created_at.isoformat(),
        'attachments': [attachment_json(a) for a in msg.attachments.all()],
    }


def message_queryset():
    return Message.objects.select_related('sender').prefetch_related('attachments')


# ───────────────────────── Conversations ─────────────────────────
def require_student(user):
    if not is_student(user):
        raise MessagingError('Student access required.', 403, 'forbidden')


def parse_id(raw, minimum=1):
    """A database id from a JSON number or a digit string; None for anything else (floats, booleans, lists, out of range)."""
    if isinstance(raw, int) and not isinstance(raw, bool):
        value = raw
    elif isinstance(raw, str) and raw.isascii() and raw.isdigit():
        value = int(raw)
    else:
        return None
    return value if minimum <= value < 2 ** 63 else None


def conversation_for(user, conversation_id):
    """The conversation if `user` is one of its two members. Non-members get the same 404 as a missing id."""
    require_student(user)
    conversation_id = parse_id(conversation_id)
    if conversation_id is None:
        raise MessagingError('Conversation not found.', 404, 'not_found')
    conv = Conversation.objects.filter(pk=conversation_id).filter(Q(user_low=user) | Q(user_high=user)).first()
    if not conv:
        raise MessagingError('Conversation not found.', 404, 'not_found')
    return conv


def conversations_for(user):
    my_read = ConversationMember.objects.filter(conversation=OuterRef('pk'), user=user).values('last_read_message_id')[:1]
    other_read = ConversationMember.objects.filter(conversation=OuterRef('pk')).exclude(user=user).values('last_read_message_id')[:1]
    last_id = Message.objects.filter(conversation=OuterRef('pk')).order_by('-id').values('id')[:1]
    return (Conversation.objects.filter(Q(user_low=user) | Q(user_high=user))
            .select_related('user_low', 'user_high')
            .annotate(my_read=Coalesce(Subquery(my_read), Value(0)), other_read=Coalesce(Subquery(other_read), Value(0)),
                      last_id=Subquery(last_id))
            .annotate(unread=Count('messages', filter=Q(messages__id__gt=F('my_read')) & ~Q(messages__sender=user))))


def conversation_json(conv, user, request=None, last_message=None):
    other = conv.user_high if conv.user_low_id == user.id else conv.user_low
    return {
        'id': conv.id, 'otherUser': {**person_json(other, request), 'available': is_student(other)},
        'lastMessage': message_json(last_message) if last_message else None,
        'unreadCount': getattr(conv, 'unread', 0), 'lastReadId': getattr(conv, 'my_read', 0),
        'otherLastReadId': getattr(conv, 'other_read', 0),
        'lastMessageAt': conv.last_message_at.isoformat() if conv.last_message_at else None,
        'createdAt': conv.created_at.isoformat(),
    }


def list_conversations(user, request=None):
    require_student(user)
    rows = list(conversations_for(user).filter(last_message_at__isnull=False).order_by('-last_message_at', '-id'))
    last = {m.id: m for m in message_queryset().filter(id__in=[c.last_id for c in rows if c.last_id])}
    return [conversation_json(c, user, request, last.get(c.last_id)) for c in rows]


def conversation_detail(user, conversation_id, request=None):
    conv = conversation_for(user, conversation_id)
    conv = conversations_for(user).get(pk=conv.pk)
    last = message_queryset().filter(pk=conv.last_id).first() if conv.last_id else None
    return conversation_json(conv, user, request, last)


def open_conversation(user, other_id, request=None):
    """Get or create the conversation between `user` and another active student."""
    require_student(user)
    other_id = parse_id(other_id)
    if other_id is None:
        raise MessagingError('Choose a student to message.', 400)
    if other_id == user.id:
        raise MessagingError('You cannot start a conversation with yourself.', 400)
    other = User.objects.filter(pk=other_id, role='student', is_active=True).first()
    if not other:
        raise MessagingError('Student not found.', 404, 'not_found')
    low, high = sorted([user.id, other.id])
    try:
        with transaction.atomic():
            conv, created = Conversation.objects.get_or_create(user_low_id=low, user_high_id=high)
            if created:
                ConversationMember.objects.bulk_create([ConversationMember(conversation=conv, user_id=low),
                                                        ConversationMember(conversation=conv, user_id=high)])
    except IntegrityError:  # two first messages raced; the other request created it
        conv, created = Conversation.objects.get(user_low_id=low, user_high_id=high), False
    return conversation_detail(user, conv.pk, request), created


def search_students(user, query, request=None, limit=20):
    require_student(user)
    query = ' '.join(str(query or '').split())[:100]
    if len(query) < 2:
        return []
    match = Q(first_name__icontains=query) | Q(last_name__icontains=query) | Q(username__icontains=query) | \
        Q(full_name__icontains=query) | Q(email__iexact=query)
    people = (User.objects.filter(role='student', is_active=True).exclude(pk=user.pk)
              .annotate(full_name=Concat('first_name', Value(' '), 'last_name')).filter(match)
              .order_by('first_name', 'last_name', 'username')[:limit])
    people = list(people)
    pairs = {}
    for conv in Conversation.objects.filter(Q(user_low=user, user_high__in=people) | Q(user_high=user, user_low__in=people)):
        pairs[conv.other_id(user.id)] = conv.id
    # Email addresses are matched only exactly and never returned, so search cannot be used to harvest them.
    return [{**person_json(p, request), 'conversationId': pairs.get(p.id)} for p in people]


# ───────────────────────── Messages ─────────────────────────
def history(user, conversation_id, before=None, after=None, limit=HISTORY_PAGE):
    conv = conversation_for(user, conversation_id)
    limit = max(1, min(int(limit or HISTORY_PAGE), MAX_PAGE))
    qs = message_queryset().filter(conversation=conv)
    if after is not None:
        rows = list(qs.filter(id__gt=int(after)).order_by('id')[:limit + 1])
        has_more = len(rows) > limit
        rows = rows[:limit]
    else:
        if before is not None:
            qs = qs.filter(id__lt=int(before))
        rows = list(qs.order_by('-id')[:limit + 1])
        has_more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
    return {'results': [message_json(m) for m in rows], 'hasMore': has_more}


def sync(user, after, limit=SYNC_PAGE):
    """Messages in any of the user's conversations with an id above `after` (offline recovery)."""
    require_student(user)
    limit = max(1, min(int(limit or SYNC_PAGE), SYNC_PAGE))
    rows = list(message_queryset().filter(Q(conversation__user_low=user) | Q(conversation__user_high=user), id__gt=int(after))
                .order_by('id')[:limit + 1])
    return {'results': [message_json(m) for m in rows[:limit]], 'hasMore': len(rows) > limit}


def latest_message_id(user):
    return (Message.objects.filter(Q(conversation__user_low=user) | Q(conversation__user_high=user))
            .order_by('-id').values_list('id', flat=True).first() or 0)


def unread_total(user):
    require_student(user)
    my_read = ConversationMember.objects.filter(conversation=OuterRef('conversation'), user=user).values('last_read_message_id')[:1]
    return (Message.objects.filter(Q(conversation__user_low=user) | Q(conversation__user_high=user)).exclude(sender=user)
            .annotate(my_read=Coalesce(Subquery(my_read), Value(0))).filter(id__gt=F('my_read')).count())


def parse_client_id(raw):
    if raw in (None, ''):
        return None
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise MessagingError('Invalid message id.', 400)


def check_rate(user):
    count, seconds = SEND_RATE
    try:
        retry_after = hit_rate_limit('message-send', user.pk, count, seconds)
    except RateLimitUnavailable as error:
        raise MessagingError('Messaging is temporarily unavailable. Please retry shortly.', 503,
                             'rate_limiter_unavailable') from error
    if retry_after:
        raise MessagingError('You are sending messages too quickly. Please wait a moment.', 429, 'rate_limited')


def check_typing_rate(user):
    try:
        retry_after = hit_rate_limit('typing', user.pk, settings.TYPING_RATE_LIMIT,
                                     settings.TYPING_RATE_WINDOW_SECONDS)
    except RateLimitUnavailable as error:
        raise MessagingError('Messaging is temporarily unavailable. Please retry shortly.', 503,
                             'rate_limiter_unavailable') from error
    if retry_after:
        raise MessagingError('Typing updates are being sent too quickly.', 429, 'rate_limited')


def send_message(user, conversation_id, body='', client_id=None, files=()):
    """Validate, store and then broadcast a message. Returns (message_json, created)."""
    conv = conversation_for(user, conversation_id)
    if body is not None and not isinstance(body, str):
        raise MessagingError('Message text must be a string.', 400)
    body = (body or '').strip()
    if len(body) > MAX_BODY_LENGTH:
        raise MessagingError(f'Messages can be at most {MAX_BODY_LENGTH} characters.', 400)
    files = list(files or [])
    client_id = parse_client_id(client_id)
    if client_id:
        existing = message_queryset().filter(sender=user, client_id=client_id).first()
        if existing:
            if existing.conversation_id != conv.id:
                raise MessagingError('Invalid message id.', 400)
            return message_json(existing), False
    if not body and not files:
        raise MessagingError('Write a message or attach a file.', 400)
    other = User.objects.filter(pk=conv.other_id(user.id)).first()
    if not is_student(other):
        raise MessagingError('This student can no longer receive messages.', 403, 'recipient_unavailable')
    checked = [validate_upload(f) for f in files]
    check_rate(user)
    try:
        with transaction.atomic():
            msg = Message.objects.create(conversation=conv, sender=user, body=body, client_id=client_id)
            for upload, meta in zip(files, checked):
                upload.seek(0)
                MessageAttachment.objects.create(message=msg, file=upload, **meta)
            Conversation.objects.filter(pk=conv.pk).update(last_message_at=msg.created_at)
            # Sending a message means the sender has read the conversation up to it.
            ConversationMember.objects.filter(conversation=conv, user=user, last_read_message_id__lt=msg.id).update(
                last_read_message_id=msg.id, last_read_at=msg.created_at)
            payload = message_json(message_queryset().get(pk=msg.pk))
            transaction.on_commit(lambda: broadcast(conv.member_ids(), 'chat.message', {'message': payload}))
    except IntegrityError:
        existing = message_queryset().filter(sender=user, client_id=client_id).first() if client_id else None
        if not existing:
            raise
        return message_json(existing), False
    return payload, True


def mark_read(user, conversation_id, message_id=None):
    conv = conversation_for(user, conversation_id)
    latest = conv.messages.order_by('-id').values_list('id', flat=True).first() or 0
    if message_id in (None, ''):
        target = latest
    else:
        target = parse_id(message_id, minimum=0)
        if target is None:
            raise MessagingError('Invalid message id.', 400)
        target = min(target, latest)
    now = timezone.now()
    member, _ = ConversationMember.objects.get_or_create(conversation=conv, user=user)
    changed = ConversationMember.objects.filter(pk=member.pk, last_read_message_id__lt=target).update(
        last_read_message_id=target, last_read_at=now)
    last_read = max(member.last_read_message_id, target)
    if changed:
        transaction.on_commit(lambda: broadcast(conv.member_ids(), 'chat.read', {
            'conversationId': conv.id, 'userId': user.id, 'lastReadId': last_read}))
    return {'conversationId': conv.id, 'lastReadId': last_read}


def typing_targets(user, conversation_id):
    conv = conversation_for(user, conversation_id)
    return conv.id, conv.other_id(user.id)


def broadcast(user_ids, event_type, data):
    """Deliver an event to every open socket of the given users. A Redis outage never loses a message:
    it is already stored, and clients fetch it with /messages/sync when they reconnect."""
    layer = get_channel_layer()
    if layer is None:
        return

    # One event-loop round for all recipients, stopping at the first failure: when Redis is down, retrying it once per
    # recipient only delays the HTTP response that confirms the message was stored.
    async def send_all():
        for user_id in set(user_ids):
            await layer.group_send(user_group(user_id), {'type': event_type, **data})
    try:
        async_to_sync(send_all)()
    except Exception:  # noqa: BLE001 - delivery is best effort; storage already succeeded
        logger.exception('Real-time delivery of %s to users %s failed', event_type, sorted(set(user_ids)))


# ───────────────────────── Uploads ─────────────────────────
def validate_upload(upload):
    """Check the attachment's size and its real content (not just its extension or the browser's content type)."""
    name = get_valid_filename(os.path.basename(upload.name or ''))[:200] or 'attachment'
    ext = os.path.splitext(name)[1].lower()
    if upload.size > settings.MAX_CHAT_ATTACHMENT_BYTES:
        raise MessagingError(f'"{name}" is larger than {settings.MAX_CHAT_ATTACHMENT_BYTES // (1024 * 1024)} MB.', 400)
    if upload.size == 0:
        raise MessagingError(f'"{name}" is empty.', 400)
    if ext not in ALLOWED_EXTENSIONS:
        raise MessagingError(f'"{name}" is not a supported file type. Allowed: {", ".join(ALLOWED_EXTENSIONS)}.', 400)
    upload.seek(0)
    head = upload.read(8)
    upload.seek(0)
    meta = {'original_name': name, 'size': upload.size}
    if ext in IMAGE_EXTENSIONS:
        try:
            with Image.open(upload) as img:
                fmt = img.format
                img.verify()
        except (UnidentifiedImageError, OSError, SyntaxError, ValueError, Image.DecompressionBombError):
            raise MessagingError(f'"{name}" is not a valid image.', 400)
        finally:
            upload.seek(0)
        if fmt not in IMAGE_TYPES:
            raise MessagingError(f'"{name}" is not a supported image format.', 400)
        return {**meta, 'kind': 'image', 'content_type': IMAGE_TYPES[fmt]}
    if ext == '.pdf':
        if not head.startswith(b'%PDF-'):
            raise MessagingError(f'"{name}" is not a valid PDF.', 400)
        return {**meta, 'kind': 'document', 'content_type': 'application/pdf'}
    if ext in OOXML:
        try:
            with zipfile.ZipFile(upload) as archive:
                valid = '[Content_Types].xml' in archive.namelist()
        except (zipfile.BadZipFile, OSError):
            valid = False
        finally:
            upload.seek(0)
        if not valid:
            raise MessagingError(f'"{name}" is not a valid Office document.', 400)
        return {**meta, 'kind': 'document', 'content_type': OOXML[ext]}
    if ext in OLE:
        if head != b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
            raise MessagingError(f'"{name}" is not a valid Office document.', 400)
        return {**meta, 'kind': 'document', 'content_type': OLE[ext]}
    data = upload.read()
    upload.seek(0)
    try:
        data.decode('utf-8-sig')
    except UnicodeDecodeError:
        raise MessagingError(f'"{name}" must be UTF-8 text.', 400)
    if b'\x00' in data:
        raise MessagingError(f'"{name}" is not a text file.', 400)
    return {**meta, 'kind': 'document', 'content_type': TEXT[ext]}


def attachment_for(user, attachment_id):
    require_student(user)
    item = (MessageAttachment.objects.select_related('message__conversation')
            .filter(pk=attachment_id).filter(Q(message__conversation__user_low=user) | Q(message__conversation__user_high=user))
            .first())
    if not item:
        raise MessagingError('Attachment not found.', 404, 'not_found')
    return item
