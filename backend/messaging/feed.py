"""Public student feed: posts with text, a link and files/images, visible to every active student.

Uses the same student check, upload validation and Redis broadcast as private messaging, but its own tables and its own
channel group, so feed endpoints can never return private conversation data.
"""
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.db import transaction

from lms.rate_limits import RateLimitUnavailable, hit as hit_rate_limit

from .models import FeedAttachment, FeedPost
from .services import MessagingError, broadcast_groups, person_json, require_student, validate_upload

FEED_GROUP = 'feed.students'
MAX_POST_LENGTH = 5000
FEED_PAGE = 20
POST_RATE = (10, 60)  # posts per window (seconds) per student


def attachment_json(item):
    return {'id': item.id, 'name': item.original_name, 'size': item.size, 'kind': item.kind,
            'contentType': item.content_type, 'url': f'/feed/attachments/{item.id}'}


def post_json(post):
    return {'id': post.id, 'author': person_json(post.author), 'body': post.body, 'link': post.link_url,
            'createdAt': post.created_at.isoformat(), 'attachments': [attachment_json(a) for a in post.attachments.all()]}


def post_queryset():
    return FeedPost.objects.select_related('author').prefetch_related('attachments')


def list_posts(user, before=None, author=None, limit=FEED_PAGE):
    require_student(user)
    limit = max(1, min(int(limit or FEED_PAGE), 50))
    # Posts by students who were later deactivated or changed role stay hidden from the feed.
    qs = post_queryset().filter(author__role='student', author__is_active=True)
    if before is not None:
        qs = qs.filter(id__lt=before)
    if author is not None:
        qs = qs.filter(author_id=author)
    rows = list(qs.order_by('-id')[:limit + 1])
    return {'results': [post_json(post) for post in rows[:limit]], 'hasMore': len(rows) > limit}


def clean_link(raw):
    link = str(raw or '').strip()
    if not link:
        return ''
    if len(link) > 500:
        raise MessagingError('Links can be at most 500 characters.', 400)
    try:
        URLValidator(schemes=['http', 'https'])(link)
    except DjangoValidationError:
        raise MessagingError('Enter a full link starting with http:// or https://.', 400)
    return link


def create_post(user, body='', link='', files=()):
    require_student(user)
    if body is not None and not isinstance(body, str):
        raise MessagingError('Post text must be a string.', 400)
    body = (body or '').strip()
    if len(body) > MAX_POST_LENGTH:
        raise MessagingError(f'Posts can be at most {MAX_POST_LENGTH} characters.', 400)
    link = clean_link(link)
    files = list(files or [])
    if len(files) > settings.MAX_CHAT_ATTACHMENTS:
        raise MessagingError(f'Attach at most {settings.MAX_CHAT_ATTACHMENTS} files per post.', 400)
    if not body and not link and not files:
        raise MessagingError('Write something, add a link or attach a file.', 400)
    checked = [validate_upload(upload) for upload in files]
    try:
        retry_after = hit_rate_limit('feed-post', user.pk, *POST_RATE)
    except RateLimitUnavailable as error:
        raise MessagingError('Posting is temporarily unavailable. Please retry shortly.', 503, 'rate_limiter_unavailable') from error
    if retry_after:
        raise MessagingError('You are posting too quickly. Please wait a moment.', 429, 'rate_limited')
    with transaction.atomic():
        post = FeedPost.objects.create(author=user, body=body, link_url=link)
        for upload, meta in zip(files, checked):
            upload.seek(0)
            FeedAttachment.objects.create(post=post, file=upload, **meta)
        payload = post_json(post_queryset().get(pk=post.pk))
        transaction.on_commit(lambda: broadcast_groups([FEED_GROUP], 'feed.post', {'post': payload}))
    return payload


def delete_post(user, post_id):
    """Students can delete only their own posts; someone else's post answers 404, like a missing one."""
    require_student(user)
    post = FeedPost.objects.filter(pk=post_id, author=user).first()
    if not post:
        raise MessagingError('Post not found.', 404, 'not_found')
    files = [item.file for item in post.attachments.all()]
    with transaction.atomic():
        post.delete()
        transaction.on_commit(lambda: broadcast_groups([FEED_GROUP], 'feed.delete', {'postId': post_id}))
    for stored in files:
        stored.delete(save=False)


def attachment_for(user, attachment_id):
    require_student(user)
    item = (FeedAttachment.objects.select_related('post__author')
            .filter(pk=attachment_id, post__author__role='student', post__author__is_active=True).first())
    if not item:
        raise MessagingError('Attachment not found.', 404, 'not_found')
    return item

