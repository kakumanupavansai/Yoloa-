from django.urls import path

from . import views as v

urlpatterns = [
    path('messages/students', v.student_search),
    path('messages/conversations', v.conversations),
    path('messages/conversations/<int:pk>', v.conversation_detail),
    path('messages/conversations/<int:pk>/messages', v.conversation_messages),
    path('messages/conversations/<int:pk>/read', v.conversation_read),
    path('messages/sync', v.message_sync),
    path('messages/unread', v.unread),
    path('messages/attachments/<int:pk>', v.attachment_file),
]
