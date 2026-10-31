from datetime import timedelta
from io import BytesIO
from urllib.parse import parse_qs, urlparse
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core import mail
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from openpyxl import Workbook
from rest_framework.test import APITestCase
from rest_framework.test import APIClient

from lms import models as m
from lms.test_support import RateLimitIsolationMixin
from lms.views import finalize_expired_attempts
from config.settings import _env_bool


class EnvironmentBooleanTests(SimpleTestCase):
    def test_environment_boolean_values(self):
        from unittest.mock import patch

        for value in ('True', 'true', '1'):
            with self.subTest(value=value), patch.dict('os.environ', {'TEST_BOOLEAN': value}):
                self.assertIs(_env_bool('TEST_BOOLEAN'), True)
        for value in ('False', 'false', '0'):
            with self.subTest(value=value), patch.dict('os.environ', {'TEST_BOOLEAN': value}):
                self.assertIs(_env_bool('TEST_BOOLEAN'), False)
        with patch.dict('os.environ', {}, clear=True):
            self.assertIs(_env_bool('TEST_BOOLEAN', True), True)


class AssessmentApiTests(RateLimitIsolationMixin, APITestCase):
    """End-to-end tests for the security-sensitive assessment workflow."""

    def setUp(self):
        self._start_rate_limit_isolation()
        self.admin = m.User.objects.create_user('admin', email='admin@example.com', password='admin123', role='admin', is_staff=True)
        self.student = m.User.objects.create_user('student', email='ada@example.com', password='student123', role='student', first_name='Ada', last_name='Lovelace')
        self.other = m.User.objects.create_user('other', email='other@example.com', password='student123', role='student')
        self.course = m.Course.objects.create(title='Secure learning')
        self.module = m.Chapter.objects.create(course=self.course, title='Required module', required=True)
        m.Chapter.objects.create(course=self.course, title='Optional module', required=False)
        m.Enrollment.objects.create(student=self.student, course=self.course)
        m.Enrollment.objects.create(student=self.other, course=self.course)

        self.module_exam = m.Exam.objects.create(
            title='Module quiz', course=self.course, module=self.module, assessment_type='module_quiz', status='published')
        self.single = m.Question.objects.create(
            exam=self.module_exam, text='One?', question_type='single', choices=['A', 'B'], correct=0,
            correct_answers=[0], points=2, order=0)
        self.multiple = m.Question.objects.create(
            exam=self.module_exam, text='Many?', question_type='multiple', choices=['A', 'B', 'C'],
            correct_answers=[0, 2], points=3, order=1)
        self.boolean = m.Question.objects.create(
            exam=self.module_exam, text='True?', question_type='true_false', choices=['True', 'False'],
            correct_answers=[True], points=1, order=2)
        self.short = m.Question.objects.create(
            exam=self.module_exam, text='Framework?', question_type='short', expected_answer='Django',
            accepted_answers=['Django framework'], normalization={'caseInsensitive': True}, points=4, order=3)

        self.final_exam = m.Exam.objects.create(
            title='Final', course=self.course, assessment_type='final_exam', status='published',
            duration='10 mins', duration_seconds=600)
        self.final_question = m.Question.objects.create(
            exam=self.final_exam, text='Final?', question_type='single', choices=['Yes', 'No'], correct=0,
            correct_answers=[0], points=5)

    def login(self, username='student', password='student123', role='student'):
        user = m.User.objects.get(username=username)
        response = self.client.post('/api/auth/login', {'email': user.email, 'password': password, 'role': role}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def start(self, exam):
        return self.client.post(f'/api/assessments/{exam.id}/start', {}, format='json')

    def save(self, attempt, answers, version=None):
        return self.client.put(f'/api/attempts/{attempt["attemptId"]}/answers', {
            'answers': answers, 'version': attempt['answerVersion'] if version is None else version}, format='json')

    def submit(self, attempt):
        return self.client.post(f'/api/attempts/{attempt["attemptId"]}/submit', {}, format='json')

    def pass_module(self):
        started = self.start(self.module_exam)
        self.assertEqual(started.status_code, 201, started.data)
        saved = self.save(started.data, {
            str(self.single.id): 0,
            str(self.multiple.id): [0, 2],
            str(self.boolean.id): True,
            str(self.short.id): ' django framework ',
        })
        self.assertEqual(saved.status_code, 200, saved.data)
        return self.submit({**started.data, **saved.data})

    def test_email_login_uses_session_and_legacy_jwt_refresh_stays_separate(self):
        response = self.client.post('/api/auth/login', {'email': self.student.email, 'password': 'student123', 'role': 'student'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('token', response.data)
        self.assertIn('sessionid', self.client.cookies)
        self.assertEqual(self.client.get('/api/auth/me').data['email'], self.student.email)
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student, event_type='login').count(), 1)
        tokens = self.client.post('/api/auth/token', {'username': 'student', 'password': 'student123'}, format='json').data
        response = self.client.post('/api/auth/refresh', {'refresh': tokens['refresh']}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student, event_type='login').count(), 2)
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student, auth_method='legacy_jwt').count(), 1)
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student, event_type='refresh').count(), 1)
        bad = self.client.post('/api/auth/login', {'username': 'student', 'password': 'wrong', 'role': 'student'}, format='json')
        self.assertEqual(bad.status_code, 401)
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student, event_type='login').count(), 2)

    def test_login_requires_csrf_and_admin_role_is_preserved(self):
        client = APIClient(enforce_csrf_checks=True)
        client.get('/api/auth/csrf')
        denied = client.post('/api/auth/login', {'email': self.admin.email, 'password': 'admin123', 'role': 'admin'}, format='json')
        self.assertEqual(denied.status_code, 403)
        client.credentials(HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
        accepted = client.post('/api/auth/login', {'email': self.admin.email, 'password': 'admin123', 'role': 'admin'}, format='json')
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(client.get('/api/admin/dashboard').status_code, 200)
        self.assertEqual(client.get('/api/student/dashboard').status_code, 403)

    def test_registration_is_student_only_and_rejects_duplicate_email(self):
        self.client.get('/api/auth/csrf')
        payload = {'fullName': 'New Student', 'email': 'new@example.com', 'password': 'Portal-pass-92!',
                   'passwordConfirmation': 'Portal-pass-92!', 'role': 'admin', 'is_staff': True, 'is_superuser': True}
        created = self.client.post('/api/auth/register', payload, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        user = m.User.objects.get(email='new@example.com')
        self.assertEqual(user.role, 'student')
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.check_password(payload['password']))
        self.assertNotIn('password', created.data['user'])
        self.assertEqual(created.data['user']['id'], user.id)
        self.assertEqual(created.data['user']['email'], user.email)
        self.assertEqual(self.client.get('/api/auth/me').data['id'], user.id)
        self.assertEqual(self.client.get('/api/auth/me').data['email'], user.email)
        duplicate = self.client.post('/api/auth/register', payload, format='json')
        self.assertEqual(duplicate.status_code, 409)

    def test_portal_role_comes_from_the_stored_user_not_the_request(self):
        student_on_admin = self.client.post('/api/auth/login', {'email': self.student.email, 'password': 'student123', 'role': 'admin'}, format='json')
        self.assertEqual(student_on_admin.status_code, 403)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        self.assertEqual(self.client.get('/api/admin/dashboard').status_code, 401)
        admin_on_student = self.client.post('/api/auth/login', {'email': self.admin.email, 'password': 'admin123', 'role': 'student'}, format='json')
        self.assertEqual(admin_on_student.status_code, 403)
        self.assertIn('administrator sign-in', admin_on_student.data['message'])
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)
        missing = self.client.post('/api/auth/login', {'email': self.student.email, 'role': 'student'}, format='json')
        self.assertEqual(missing.status_code, 400)
        self.login()
        for path in ('/api/admin/dashboard', '/api/admin/students', '/api/admin/analytics/logins'):
            self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_registration_validates_input_and_signs_in_only_the_new_user(self):
        self.login()
        self.client.get('/api/auth/csrf')
        mismatch = self.client.post('/api/auth/register', {'fullName': 'X Y', 'email': 'xy@example.com', 'password': 'Portal-pass-92!',
                                                           'passwordConfirmation': 'different'}, format='json')
        self.assertEqual(mismatch.status_code, 400)
        weak = self.client.post('/api/auth/register', {'fullName': 'X Y', 'email': 'xy@example.com', 'password': '123',
                                                       'passwordConfirmation': '123'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertIn('password', weak.data['errors'])
        duplicate = self.client.post('/api/auth/register', {'fullName': 'Ada', 'email': 'ADA@example.com', 'password': 'Portal-pass-92!',
                                                            'passwordConfirmation': 'Portal-pass-92!'}, format='json')
        self.assertEqual(duplicate.status_code, 409)
        self.assertFalse(m.User.objects.filter(email='xy@example.com').exists())
        created = self.client.post('/api/auth/register', {'fullName': 'Grace Hopper', 'email': 'grace@example.com', 'password': 'Portal-pass-92!',
                                                          'passwordConfirmation': 'Portal-pass-92!'}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        me = self.client.get('/api/auth/me').data
        self.assertEqual(me['email'], 'grace@example.com')
        self.assertNotEqual(me['id'], self.student.id)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_password_reset_link_can_be_validated_and_rejects_bad_tokens(self):
        self.client.get('/api/auth/csrf')
        sent = self.client.post('/api/auth/password-reset', {'email': self.student.email}, format='json')
        self.assertEqual(sent.data['delivery'], 'development')
        query = parse_qs(urlparse(mail.outbox[0].body.splitlines()[2]).query)
        uid, token = query['uid'][0], query['token'][0]
        self.assertEqual(self.client.post('/api/auth/password-reset/validate', {'uid': uid, 'token': token}, format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/auth/password-reset/validate', {'uid': uid, 'token': 'forged'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/password-reset/validate', {'uid': '!!', 'token': token}, format='json').status_code, 400)
        mismatch = self.client.post('/api/auth/password-reset/confirm', {'uid': uid, 'token': token, 'password': 'New-portal-pass-93!',
                                                                         'passwordConfirmation': 'other'}, format='json')
        self.assertEqual(mismatch.status_code, 400)
        weak = self.client.post('/api/auth/password-reset/confirm', {'uid': uid, 'token': token, 'password': 'short'}, format='json')
        self.assertEqual(weak.status_code, 400)
        self.assertTrue(m.User.objects.get(pk=self.student.pk).check_password('student123'))
        done = self.client.post('/api/auth/password-reset/confirm', {'uid': uid, 'token': token, 'password': 'New-portal-pass-93!',
                                                                     'passwordConfirmation': 'New-portal-pass-93!'}, format='json')
        self.assertEqual(done.status_code, 200, done.data)
        self.assertEqual(self.client.post('/api/auth/password-reset/validate', {'uid': uid, 'token': token}, format='json').status_code, 400)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend', EMAIL_HOST='')
    def test_password_reset_does_not_claim_delivery_when_email_is_unconfigured(self):
        self.client.get('/api/auth/csrf')
        known = self.client.post('/api/auth/password-reset', {'email': self.student.email}, format='json')
        unknown = self.client.post('/api/auth/password-reset', {'email': 'missing@example.com'}, format='json')
        self.assertEqual(known.status_code, 503)
        self.assertEqual(known.data, unknown.data)
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
                       FRONTEND_URL='https://learn.example.test')
    def test_password_reset_email_uses_configured_frontend_url(self):
        self.client.get('/api/auth/csrf')
        response = self.client.post('/api/auth/password-reset', {'email': self.student.email}, format='json')
        self.assertEqual(response.status_code, 200)
        link = mail.outbox[0].body.splitlines()[2]
        parsed = urlparse(link)
        self.assertEqual(f'{parsed.scheme}://{parsed.netloc}{parsed.path}', 'https://learn.example.test/reset-password')
        self.assertIn('uid', parse_qs(parsed.query))
        self.assertIn('token', parse_qs(parsed.query))

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend', EMAIL_HOST='smtp.gmail.com')
    def test_password_reset_smtp_failure_is_logged_without_leaking_link_or_token(self):
        self.client.get('/api/auth/csrf')
        with patch('lms.views.send_mail', side_effect=OSError('private smtp detail')), \
                self.assertLogs('lms.views', level='ERROR') as captured:
            response = self.client.post('/api/auth/password-reset', {'email': self.student.email}, format='json')
        unknown = self.client.post('/api/auth/password-reset', {'email': 'missing@example.com'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, unknown.data)
        self.assertIn('OSError', captured.output[0])
        self.assertNotIn('private smtp detail', captured.output[0])
        self.assertNotIn('token', captured.output[0])

    def test_google_status_reports_configuration_without_secrets(self):
        with override_settings(GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET=''):
            self.assertEqual(self.client.get('/api/auth/google/status').data, {'configured': False})
        with override_settings(GOOGLE_OAUTH_CLIENT_ID='cid', GOOGLE_OAUTH_CLIENT_SECRET='do-not-leak'):
            response = self.client.get('/api/auth/google/status')
            self.assertEqual(response.data, {'configured': True})
            self.assertNotIn(b'do-not-leak', response.content)

    def test_logout_invalidates_session_and_restores_anonymous_state(self):
        self.login()
        self.assertEqual(self.client.get('/api/student/dashboard').status_code, 200)
        result = self.client.post('/api/auth/logout', {}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_password_reset_is_generic_single_use_and_invalidates_old_password(self):
        self.client.get('/api/auth/csrf')
        self.client.post('/api/auth/password-reset', {'email': 'missing@example.com'}, format='json')
        unknown_message = self.client.post('/api/auth/password-reset', {'email': 'missing@example.com'}, format='json').data['message']
        known = self.client.post('/api/auth/password-reset', {'email': self.student.email}, format='json')
        self.assertEqual(known.data['message'], unknown_message)
        self.assertEqual(len(mail.outbox), 1)
        link = mail.outbox[0].body.splitlines()[2]
        query = parse_qs(urlparse(link).query)
        payload = {'uid': query['uid'][0], 'token': query['token'][0], 'password': 'New-portal-pass-93!'}
        done = self.client.post('/api/auth/password-reset/confirm', payload, format='json')
        self.assertEqual(done.status_code, 200, done.data)
        self.assertTrue(m.User.objects.get(pk=self.student.pk).check_password(payload['password']))
        self.assertEqual(self.client.post('/api/auth/password-reset/confirm', payload, format='json').status_code, 400)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID='test-client', GOOGLE_OAUTH_CLIENT_SECRET='test-secret',
                       GOOGLE_OAUTH_REDIRECT_URI='http://localhost:8000/api/auth/google/callback')
    def test_google_oauth_validates_state_nonce_and_records_verified_login(self):
        start = self.client.get('/api/auth/google')
        params = parse_qs(urlparse(start['Location']).query)
        self.assertEqual(params['code_challenge_method'], ['S256'])
        callback = self.client.session['google_oauth']
        identity = {'sub': 'google-sub-123', 'email': 'google.student@example.com', 'email_verified': True,
                    'name': 'Google Student', 'nonce': callback['nonce']}
        mocked_exchange = type('Response', (), {'raise_for_status': lambda self: None, 'json': lambda self: {'id_token': 'verified-token'}})()
        with patch('lms.views.requests.post', return_value=mocked_exchange), patch('lms.views.verify_google_id_token', return_value=identity):
            result = self.client.get(f"/api/auth/google/callback?code=one-time-code&state={callback['state']}")
        self.assertEqual(result.status_code, 302)
        user = m.User.objects.get(email='google.student@example.com')
        self.assertEqual(user.role, 'student')
        self.assertEqual(m.LoginEvent.objects.filter(user=user, auth_method='google').count(), 1)
        self.assertEqual(self.client.get('/api/auth/me').data['id'], user.id)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID='', GOOGLE_OAUTH_CLIENT_SECRET='')
    def test_google_cancel_and_missing_configuration_fail_safely(self):
        unavailable = self.client.get('/api/auth/google')
        self.assertIn('google_not_configured', unavailable['Location'])
        cancelled = self.client.get('/api/auth/google/callback?error=access_denied&state=untrusted')
        self.assertIn('google_cancelled_or_invalid', cancelled['Location'])

    @override_settings(GOOGLE_OAUTH_CLIENT_ID='test-client', GOOGLE_OAUTH_CLIENT_SECRET='test-secret',
                       GOOGLE_OAUTH_REDIRECT_URI='http://localhost:8000/api/auth/google/callback')
    def test_google_will_not_silently_link_to_an_existing_email_account(self):
        start = self.client.get('/api/auth/google')
        callback = self.client.session['google_oauth']
        identity = {'sub': 'unlinked-google-sub', 'email': self.student.email, 'email_verified': True,
                    'name': 'Ada Lovelace', 'nonce': callback['nonce']}
        mocked_exchange = type('Response', (), {'raise_for_status': lambda self: None, 'json': lambda self: {'id_token': 'verified-token'}})()
        with patch('lms.views.requests.post', return_value=mocked_exchange), patch('lms.views.verify_google_id_token', return_value=identity):
            result = self.client.get(f"/api/auth/google/callback?code=one-time-code&state={callback['state']}")
        self.assertIn('google_account_link_required', result['Location'])
        self.student.refresh_from_db()
        self.assertEqual(self.student.google_sub, '')
        self.assertEqual(m.User.objects.filter(email=self.student.email).count(), 1)

    @override_settings(GOOGLE_OAUTH_CLIENT_ID='test-client', GOOGLE_OAUTH_CLIENT_SECRET='test-secret',
                       GOOGLE_OAUTH_REDIRECT_URI='http://localhost:8000/api/auth/google/callback')
    def test_google_cannot_create_an_administrator_session_or_link_admin_account(self):
        self.admin.google_sub = 'linked-admin-sub'
        self.admin.save(update_fields=['google_sub'])
        self.client.get('/api/auth/google')
        oauth = self.client.session['google_oauth']
        identity = {'sub': self.admin.google_sub, 'email': self.admin.email, 'email_verified': True,
                    'name': 'Portal Admin', 'nonce': oauth['nonce']}
        mocked_exchange = type('Response', (), {'raise_for_status': lambda self: None, 'json': lambda self: {'id_token': 'verified-token'}})()
        with patch('lms.views.requests.post', return_value=mocked_exchange), patch('lms.views.verify_google_id_token', return_value=identity):
            result = self.client.get(f"/api/auth/google/callback?code=one-time-code&state={oauth['state']}")
        self.assertIn('google_student_only', result['Location'])
        self.assertEqual(self.client.get('/api/auth/me').status_code, 401)

        self.client.force_login(self.admin)
        link_start = self.client.get('/api/auth/google?mode=link')
        self.assertIn('google_student_only', link_start['Location'])

    def test_module_types_grade_and_unlock_final(self):
        self.login()
        self.assertEqual(self.start(self.final_exam).status_code, 403)
        result = self.pass_module()
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual((result.data['score'], result.data['total'], result.data['percent']), (10.0, 10.0, 100.0))
        self.assertTrue(result.data['passed'])
        public = self.client.get(f'/api/assessments/{self.module_exam.id}')
        self.assertNotIn('correctAnswers', public.data['questions'][0])
        final = self.start(self.final_exam)
        self.assertEqual(final.status_code, 201, final.data)
        self.assertEqual((final.data['deadline'] - final.data['startedAt']).total_seconds(), 600)

    def test_resume_autosave_expiry_and_completion_are_server_controlled(self):
        self.login()
        self.assertTrue(self.pass_module().data['passed'])
        started = self.start(self.final_exam)
        resumed = self.start(self.final_exam)
        self.assertEqual((resumed.status_code, resumed.data['attemptId']), (200, started.data['attemptId']))

        saved = self.save(started.data, {str(self.final_question.id): 0})
        self.assertEqual(saved.status_code, 200)
        stale = self.save({**started.data, **saved.data}, {str(self.final_question.id): 1}, version=0)
        self.assertEqual(stale.status_code, 409)
        final = self.submit({**started.data, **saved.data})
        self.assertEqual(final.data['status'], 'submitted')
        enrollment = m.Enrollment.objects.get(student=self.student, course=self.course)
        self.assertEqual((enrollment.status, enrollment.completion_source), ('completed', 'final_exam'))

        retake = self.start(self.final_exam)
        bad_save = self.save(retake.data, {str(self.final_question.id): 1})
        self.assertFalse(self.submit({**retake.data, **bad_save.data}).data['passed'])
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, 'completed')

        expired = self.start(self.final_exam)
        m.Attempt.objects.filter(pk=expired.data['attemptId']).update(deadline_at=timezone.now() - timedelta(seconds=1))
        finalize_expired_attempts()
        self.assertEqual(m.Attempt.objects.get(pk=expired.data['attemptId']).status, 'expired')
        self.assertEqual(self.save(expired.data, {str(self.final_question.id): 0}).status_code, 409)

    def test_permissions_manual_review_directory_and_analytics(self):
        self.login()
        started = self.start(self.module_exam)
        saved = self.save(started.data, {str(self.short.id): 'wrong'})
        failed = self.submit({**started.data, **saved.data})
        self.assertFalse(failed.data['passed'])

        self.login('other')
        self.assertEqual(self.client.get('/api/admin/students').status_code, 403)
        self.assertEqual(self.client.get(f'/api/attempts/{failed.data["attemptId"]}').status_code, 403)

        self.login('admin', 'admin123', 'admin')
        review = self.client.post(
            f'/api/admin/attempts/{failed.data["attemptId"]}/review',
            {'revisedScore': 10, 'reason': 'Verified written response'}, format='json')
        self.assertEqual(review.status_code, 200, review.data)
        self.assertEqual(m.GradingReview.objects.filter(attempt_id=failed.data['attemptId']).count(), 1)
        directory = self.client.get('/api/admin/students?q=Ada')
        self.assertEqual(directory.data['total'], 1)
        self.assertNotIn('password', directory.data['results'][0])
        self.assertEqual(self.client.get('/api/admin/analytics/exams').data['finalExamDurationSeconds'], 600)
        metrics = self.client.get('/api/admin/analytics/logins').data['metrics']
        self.assertIn('emailPasswordLogins', metrics)
        self.assertNotIn('tokenRefreshes', metrics)

        self.login()
        self.assertEqual(self.start(self.final_exam).status_code, 201)

    def test_excel_preview_and_idempotent_confirmation(self):
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = 'Questions'
        sheet.append(['Type', 'Question', 'Options', 'Answer', 'Marks'])
        sheet.append(['single', 'Choose A', 'A|B', 'A', 2])
        stream = BytesIO()
        workbook.save(stream)

        self.login('admin', 'admin123', 'admin')
        upload = SimpleUploadedFile(
            'questions.xlsx', stream.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response = self.client.post('/api/admin/question-imports/upload', {
            'file': upload, 'examId': self.module_exam.id, 'courseId': self.course.id}, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        batch = response.data['batchId']
        preview = self.client.post(f'/api/admin/question-imports/{batch}/preview', {
            'sheet': 'Questions',
            'mapping': {'questionType': 'Type', 'questionText': 'Question', 'options': 'Options',
                        'correctAnswer': 'Answer', 'marks': 'Marks'},
        }, format='json')
        self.assertEqual((preview.status_code, preview.data['validCount'], preview.data['invalidCount']), (200, 1, 0))
        confirmation = self.client.post(
            f'/api/admin/question-imports/{batch}/confirm', {'idempotencyKey': 'retry-safe-key'}, format='json')
        self.assertEqual((confirmation.status_code, confirmation.data['imported']), (201, 1))
        retry = self.client.post(
            f'/api/admin/question-imports/{batch}/confirm', {'idempotencyKey': 'retry-safe-key'}, format='json')
        self.assertTrue(retry.data['alreadyImported'])
