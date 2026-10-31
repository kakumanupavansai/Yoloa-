"""HTTP API for student messaging: the source of truth for history, attachments and offline recovery.

Sending over HTTP is equivalent to sending over the WebSocket (same validation, same broadcast), and is how
attachments are sent and how the browser retries a message whose WebSocket send was not acknowledged.
"""
import logging

from django.conf import settings
from django.http import FileResponse
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from lms.utils import IsStudentRole

from . import feed, services
from .services import MessagingError

logger = logging.getLogger(__name__)


def handled(view):
    def wrapper(request, *args, **kwargs):
        try:
            return view(request, *args, **kwargs)
        except MessagingError as error:
            return Response({'message': error.message, 'code': error.code}, status=error.status)
    wrapper.__name__ = view.__name__
    wrapper.__doc__ = view.__doc__
    return wrapper


def int_param(request, name):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return None
    try:
        value = int(raw)
    except ValueError:
        raise MessagingError(f'{name} must be a number.', 400)
    if value < 0:
        raise MessagingError(f'{name} must be a number.', 400)
    return value


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def student_search(request):
    return Response({'results': services.search_students(request.user, request.query_params.get('q', ''), request)})


@api_view(['GET', 'POST'])
@permission_classes([IsStudentRole])
@handled
def conversations(request):
    if request.method == 'POST':
        data, created = services.open_conversation(request.user, request.data.get('userId'), request)
        return Response(data, status=201 if created else 200)
    return Response({'results': services.list_conversations(request.user, request)})


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def conversation_detail(request, pk):
    return Response(services.conversation_detail(request.user, pk, request))


@api_view(['GET', 'POST'])
@permission_classes([IsStudentRole])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@handled
def conversation_messages(request, pk):
    if request.method == 'POST':
        files = request.FILES.getlist('files')
        if len(files) > settings.MAX_CHAT_ATTACHMENTS:
            raise MessagingError(f'Attach at most {settings.MAX_CHAT_ATTACHMENTS} files per message.', 400)
        message, created = services.send_message(request.user, pk, request.data.get('body', ''),
                                                 request.data.get('clientId'), files)
        return Response(message, status=201 if created else 200)
    before, after = int_param(request, 'before'), int_param(request, 'after')
    return Response(services.history(request.user, pk, before=before, after=after, limit=int_param(request, 'limit')))


@api_view(['POST'])
@permission_classes([IsStudentRole])
@handled
def conversation_read(request, pk):
    return Response(services.mark_read(request.user, pk, request.data.get('messageId')))


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def message_sync(request):
    return Response(services.sync(request.user, int_param(request, 'after') or 0, int_param(request, 'limit')))


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def unread(request):
    return Response({'unread': services.unread_total(request.user)})


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def attachment_file(request, pk):
    """Stream an attachment to a member of its conversation. Only images are shown inline; everything else downloads."""
    return stream_attachment(services.attachment_for(request.user, pk), request)


# ───────────────────────── Public student feed ─────────────────────────
def stream_attachment(item, request):
    try:
        handle = item.file.open('rb')
    except Exception as error:  # noqa: BLE001 - don't expose storage paths in an API response
        logger.error('Attachment storage open failed (%s)', type(error).__name__)
        raise MessagingError('The file for this attachment is missing on the server.', 404, 'not_found')
    inline = item.kind == 'image' and request.query_params.get('download') != '1'
    response = FileResponse(handle, as_attachment=not inline, filename=item.original_name, content_type=item.content_type)
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, max-age=300'
    response['Content-Security-Policy'] = "default-src 'none'; sandbox"
    response['Cross-Origin-Resource-Policy'] = 'same-origin'
    return response


@api_view(['GET', 'POST'])
@permission_classes([IsStudentRole])
@parser_classes([JSONParser, FormParser, MultiPartParser])
@handled
def feed_posts(request):
    if request.method == 'POST':
        post = feed.create_post(request.user, request.data.get('body', ''), request.data.get('link', ''),
                                request.FILES.getlist('files'))
        return Response(post, status=201)
    return Response(feed.list_posts(request.user, before=int_param(request, 'before'), author=int_param(request, 'author'),
                                    limit=int_param(request, 'limit')))


@api_view(['DELETE'])
@permission_classes([IsStudentRole])
@handled
def feed_post_detail(request, pk):
    feed.delete_post(request.user, pk)
    return Response(status=204)


@api_view(['GET'])
@permission_classes([IsStudentRole])
@handled
def feed_attachment_file(request, pk):
    return stream_attachment(feed.attachment_for(request.user, pk), request)
