from django.urls import path

from .consumers import MessagingConsumer

websocket_urlpatterns = [path('ws/messages/', MessagingConsumer.as_asgi())]
