from django.contrib.auth.signals import user_logged_out
from django.dispatch import receiver


@receiver(user_logged_out)
def close_sockets_of_ended_session(sender, request, user, **kwargs):
    """Ask the user's open sockets to re-check their session right away, so a signed-out browser stops receiving messages.
    (Sockets also re-check periodically, which covers password changes and deactivated accounts.)"""
    if user is None or getattr(user, 'role', None) != 'student':
        return
    from .services import broadcast
    broadcast([user.pk], 'chat.revalidate', {})
