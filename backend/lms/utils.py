from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.views import exception_handler


class IsAdminRole(BasePermission):
    message = 'Admin access required.'
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == 'admin')


class IsStudentRole(BasePermission):
    message = 'Student access required.'
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and u.role == 'student')


def first_error(data):
    """Pull one human-readable sentence out of DRF's nested error structure."""
    if isinstance(data, dict):
        for key, val in data.items():
            msg = first_error(val)
            if msg:
                return msg if key in ('message', 'detail', 'non_field_errors') else f'{key}: {msg}'
    elif isinstance(data, (list, tuple)):
        for item in data:
            msg = first_error(item)
            if msg:
                return msg
    elif data:
        return str(data)
    return ''


def api_exception_handler(exc, context):
    """Frontend reads `message` from error JSON."""
    resp = exception_handler(exc, context)
    if resp is not None:
        data = resp.data
        if isinstance(data, dict) and 'detail' in data:
            resp.data = {'message': str(data['detail'])}
        else:
            resp.data = {'message': first_error(data) or 'Validation error', 'errors': data}
    return resp


def abs_url(request, f):
    return request.build_absolute_uri(f.url) if f else ''


def user_json(u, request):
    return {
        'id': u.id, 'name': u.display_name, 'role': u.role, 'email': u.email, 'username': u.username,
        'firstName': u.first_name, 'lastName': u.last_name, 'avatar': abs_url(request, u.avatar),
        'address': u.address, 'city': u.city, 'country': u.country, 'postalCode': u.postal_code,
        # Only whether Google is linked; the Google subject identifier itself is never exposed.
        'googleLinked': bool(u.google_sub),
        # Google-only accounts have no usable password, so the profile offers a reset instead of a change form.
        'hasPassword': u.has_usable_password(),
    }


def to_int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default
