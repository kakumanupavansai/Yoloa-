"""Tests for the LMS learning workflow: module unlocking, resources, course management,
final-exam timing, dashboards and the administrator student directory.

These run against PostgreSQL (Django creates and destroys `test_<DB_NAME>`); there is no SQLite path.
"""
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from lms import models as m
from lms.test_support import RateLimitIsolationMixin


def drain(response):
    """Read a streamed FileResponse and release its file handle (Windows cannot delete open files).

    response.close() is avoided because it fires request_finished, which closes the test DB connection.
    """
    body = b''.join(response.streaming_content)
    for closer in response._resource_closers:
        closer()
    return body


class PostgresConnectionTests(TestCase):
    def test_database_is_a_real_postgresql_connection(self):
        connection.ensure_connection()
        self.assertEqual(connection.vendor, 'postgresql')
        with connection.cursor() as cursor:
            cursor.execute('select version()')
            self.assertIn('PostgreSQL', cursor.fetchone()[0])


class LearningBase(RateLimitIsolationMixin, APITestCase):
    def setUp(self):
        self._start_rate_limit_isolation()
        self.media = tempfile.mkdtemp()
        self.media_override = override_settings(PRIVATE_MEDIA_ROOT=self.media)
        self.media_override.enable()
        self.admin = m.User.objects.create_user('admin', email='admin@example.com', password='admin-pass-123', role='admin', is_staff=True)
        self.student = m.User.objects.create_user('ada', email='ada@example.com', password='student-pass-123', role='student',
                                                  first_name='Ada', last_name='Lovelace')
        self.other = m.User.objects.create_user('bob', email='bob@example.com', password='student-pass-123', role='student')
        self.course = m.Course.objects.create(title='Python basics', category='Programming')
        self.m1 = m.Chapter.objects.create(course=self.course, title='Module one', order=0, required=True)
        self.m2 = m.Chapter.objects.create(course=self.course, title='Module two', order=1, required=True)
        self.m3 = m.Chapter.objects.create(course=self.course, title='Reading only', order=2, required=True)
        self.q1 = self.quiz(self.m1, pass_percent=50)
        self.q2 = self.quiz(self.m2, pass_percent=50)
        self.final = m.Exam.objects.create(title='Final', course=self.course, assessment_type='final_exam', status='published',
                                           duration_seconds=600, pass_percent=60)
        for index in range(5):
            m.Question.objects.create(exam=self.final, text=f'F{index}?', question_type='single', choices=['Yes', 'No'],
                                      correct=0, correct_answers=[0], points=1, order=index)
        self.r1 = m.CourseContent.objects.create(course=self.course, chapter=self.m1, title='Intro video', resource_type='video',
                                                 url='https://www.youtube.com/watch?v=rfscVS0vtbw')
        self.r2 = m.CourseContent.objects.create(course=self.course, chapter=self.m2, title='Notes', resource_type='document',
                                                 original_name='notes.pdf')
        self.r2.file.save('notes.pdf', SimpleUploadedFile('notes.pdf', b'%PDF-1.4 test'), save=True)

    def tearDown(self):
        self.media_override.disable()
        shutil.rmtree(self.media, ignore_errors=True)

    def quiz(self, module, pass_percent=50):
        exam = m.Exam.objects.create(title=f'{module.title} quiz', course=self.course, module=module, assessment_type='module_quiz',
                                     status='published', pass_percent=pass_percent)
        exam.q_a = m.Question.objects.create(exam=exam, text='A?', question_type='single', choices=['x', 'y'], correct=0, correct_answers=[0], points=1, order=0)
        exam.q_b = m.Question.objects.create(exam=exam, text='B?', question_type='true_false', choices=['True', 'False'], correct_answers=[True], points=1, order=1)
        return exam

    def login(self, user, password=None, role=None):
        self.client.logout()
        self.client.force_authenticate(user=None)
        password = password or ('admin-pass-123' if user.role == 'admin' else 'student-pass-123')
        response = self.client.post('/api/auth/login', {'email': user.email, 'password': password, 'role': role or user.role}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def enroll(self):
        response = self.client.post(f'/api/courses/{self.course.id}/enroll', {}, format='json')
        self.assertIn(response.status_code, (200, 201), response.data)

    def take(self, exam, answers):
        response = self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': answers}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def pass_quiz(self, exam):
        return self.take(exam, {str(exam.q_a.id): 0, str(exam.q_b.id): True})


class ModuleUnlockingTests(LearningBase):
    def test_modules_unlock_in_order_only_after_passing_the_quiz(self):
        self.login(self.student)
        self.enroll()
        outline = self.client.get(f'/api/courses/{self.course.id}').data['chapters']
        self.assertEqual([(c['title'], c['unlocked']) for c in outline], [('Module one', True), ('Module two', False), ('Reading only', False)])
        # Direct API calls cannot bypass the lock.
        self.assertEqual(self.client.get(f'/api/modules/{self.m2.id}').status_code, 403)
        self.assertEqual(self.client.get(f'/api/quizzes/{self.q2.id}').status_code, 403)
        self.assertEqual(self.client.post(f'/api/assessments/{self.q2.id}/start', {}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/quizzes/{self.q2.id}/attempts', {'answers': {}}, format='json').status_code, 403)
        self.assertEqual(self.client.get(f'/api/resources/{self.r2.id}/file').status_code, 403)
        self.assertEqual(self.client.get(f'/api/modules/{self.m2.id}/resources').status_code, 403)
        # Opening the module page does not complete it.
        self.assertEqual(self.client.get(f'/api/modules/{self.m1.id}').status_code, 200)
        self.assertFalse(self.client.get(f'/api/courses/{self.course.id}').data['chapters'][0]['completed'])
        # A failing attempt keeps the next module locked.
        failed = self.take(self.q1, {str(self.q1.q_a.id): 1, str(self.q1.q_b.id): False})
        self.assertFalse(failed['passed'])
        self.assertEqual(self.client.get(f'/api/modules/{self.m2.id}').status_code, 403)
        passed = self.pass_quiz(self.q1)
        self.assertTrue(passed['passed'])
        detail = self.client.get(f'/api/courses/{self.course.id}').data
        self.assertEqual([c['unlocked'] for c in detail['chapters']], [True, True, False])
        self.assertTrue(detail['chapters'][0]['completed'])
        self.assertEqual(detail['percent'], 33)
        self.assertEqual(self.client.get(f'/api/modules/{self.m2.id}').status_code, 200)
        file_response = self.client.get(f'/api/resources/{self.r2.id}/file')
        self.assertEqual(file_response.status_code, 200)
        self.assertEqual(drain(file_response), b'%PDF-1.4 test')
        self.assertEqual(file_response['X-Content-Type-Options'], 'nosniff')
        # Progress is persisted, not just computed in the browser.
        self.assertTrue(m.ChapterProgress.objects.get(student=self.student, chapter=self.m1).completed)
        self.assertEqual(m.Enrollment.objects.get(student=self.student, course=self.course).percent, 33)

    def test_failed_retake_never_relocks_a_passed_module(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        retake = self.take(self.q1, {str(self.q1.q_a.id): 1, str(self.q1.q_b.id): False})
        self.assertFalse(retake['passed'])
        self.assertTrue(retake['everPassed'])
        self.assertEqual(retake['attempts'], 2)
        summary = self.client.get(f'/api/courses/{self.course.id}').data['chapters'][0]['quiz']
        self.assertTrue(summary['passed'])
        self.assertEqual(summary['latestPercent'], 0.0)
        self.assertEqual(summary['bestPercent'], 100.0)
        self.assertEqual(self.client.get(f'/api/modules/{self.m2.id}').status_code, 200)

    def test_quiz_modules_cannot_be_marked_complete_and_reading_modules_can_only_when_unlocked(self):
        self.login(self.student)
        self.enroll()
        self.assertEqual(self.client.put(f'/api/chapters/{self.m1.id}/progress', {'completed': True}, format='json').status_code, 409)
        self.assertEqual(self.client.put(f'/api/chapters/{self.m3.id}/progress', {'completed': True}, format='json').status_code, 403)
        self.pass_quiz(self.q1)
        self.pass_quiz(self.q2)
        response = self.client.put(f'/api/chapters/{self.m3.id}/progress', {'completed': True}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['percent'], 100)

    def test_configurable_pass_mark_defaults_to_fifty_percent(self):
        self.login(self.student)
        self.enroll()
        half = self.take(self.q1, {str(self.q1.q_a.id): 0, str(self.q1.q_b.id): False})
        self.assertEqual(half['percent'], 50.0)
        self.assertTrue(half['passed'])
        self.q2.pass_percent = 80
        self.q2.save()
        half_again = self.take(self.q2, {str(self.q2.q_a.id): 0, str(self.q2.q_b.id): False})
        self.assertFalse(half_again['passed'])

    def test_answer_keys_are_not_sent_before_submission(self):
        self.login(self.student)
        self.enroll()
        detail = self.client.get(f'/api/quizzes/{self.q1.id}').data
        started = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').data
        for payload in (detail['questions'], started['questions']):
            for question in payload:
                self.assertFalse({'correct', 'correctAnswers', 'expectedAnswer', 'acceptedAlternatives'} & set(question))

    def test_unenrolled_students_cannot_open_modules_or_resources(self):
        self.login(self.other)
        self.assertEqual(self.client.get(f'/api/modules/{self.m1.id}').status_code, 403)
        self.assertEqual(self.client.get(f'/api/resources/{self.r2.id}/file').status_code, 403)
        detail = self.client.get(f'/api/courses/{self.course.id}').data
        self.assertEqual(detail['content'], [])
        self.assertTrue(all(not chapter['unlocked'] for chapter in detail['chapters']))


class FinalExamTests(LearningBase):
    def setUp(self):
        super().setUp()
        m.Chapter.objects.filter(pk=self.m3.pk).update(required=False)

    def finish_modules(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        self.pass_quiz(self.q2)

    def test_final_is_gated_timed_by_server_and_resumes_the_same_attempt(self):
        self.login(self.student)
        self.enroll()
        self.assertEqual(self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json').status_code, 403)
        self.pass_quiz(self.q1)
        self.pass_quiz(self.q2)
        started = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json')
        self.assertEqual(started.status_code, 201)
        attempt = m.Attempt.objects.get(pk=started.data['attemptId'])
        self.assertEqual((attempt.deadline_at - attempt.started_at).total_seconds(), 600)
        resumed = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json')
        self.assertEqual(resumed.status_code, 200)
        self.assertEqual(resumed.data['attemptId'], attempt.id)
        self.assertEqual(resumed.data['deadline'], started.data['deadline'])
        detail = self.client.get(f'/api/assessments/{self.final.id}').data
        self.assertEqual(detail['activeAttemptId'], attempt.id)
        self.assertEqual(detail['passPercent'], 60)

    def test_expired_attempts_are_finalized_and_reject_late_answers(self):
        self.finish_modules()
        started = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json').data
        questions = started['questions']
        saved = self.client.put(f'/api/attempts/{started["attemptId"]}/answers',
                                {'answers': {str(questions[0]['id']): 0}, 'version': started['answerVersion']}, format='json')
        self.assertEqual(saved.status_code, 200)
        later = timezone.now() + timedelta(seconds=601)
        with patch('django.utils.timezone.now', return_value=later):
            late = self.client.put(f'/api/attempts/{started["attemptId"]}/answers',
                                   {'answers': {str(q['id']): 0 for q in questions}, 'version': saved.data['answerVersion']}, format='json')
            self.assertEqual(late.status_code, 409)
            submitted = self.client.post(f'/api/attempts/{started["attemptId"]}/submit', {}, format='json').data
        self.assertEqual(submitted['status'], 'expired')
        self.assertEqual(submitted['score'], 1.0)          # only the answer saved before the deadline counts
        self.assertFalse(submitted['passed'])
        # Duplicate finalization returns the same stored result.
        again = self.client.post(f'/api/attempts/{started["attemptId"]}/submit', {}, format='json').data
        self.assertEqual((again['status'], again['score']), ('expired', 1.0))
        self.assertEqual(m.Attempt.objects.filter(student=self.student, exam=self.final).count(), 1)

    def test_pass_then_failed_retake_keeps_completion_and_best_score(self):
        self.finish_modules()
        first = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json').data
        answers = {str(q['id']): 0 for q in first['questions']}
        self.client.put(f'/api/attempts/{first["attemptId"]}/answers', {'answers': answers, 'version': 0}, format='json')
        result = self.client.post(f'/api/attempts/{first["attemptId"]}/submit', {}, format='json').data
        self.assertTrue(result['passed'])
        self.assertIn('review', result)
        retake = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json').data
        self.assertNotEqual(retake['attemptId'], first['attemptId'])
        failed = self.client.post(f'/api/attempts/{retake["attemptId"]}/submit', {}, format='json').data
        self.assertFalse(failed['passed'])
        enrollment = m.Enrollment.objects.get(student=self.student, course=self.course)
        self.assertEqual((enrollment.status, enrollment.completion_source), ('completed', 'final_exam'))
        summary = self.client.get(f'/api/courses/{self.course.id}').data['assessment']['finalExam']
        self.assertEqual((summary['attempts'], summary['passed'], summary['bestPercent'], summary['latestPercent']), (2, True, 100.0, 0.0))
        history = self.client.get(f'/api/assessments/{self.final.id}/history').data
        self.assertEqual([row['passed'] for row in history], [False, True])

    def test_students_cannot_read_or_submit_another_students_attempt(self):
        self.finish_modules()
        started = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json').data
        self.login(self.other)
        self.assertEqual(self.client.get(f'/api/attempts/{started["attemptId"]}').status_code, 403)
        self.assertEqual(self.client.post(f'/api/attempts/{started["attemptId"]}/submit', {}, format='json').status_code, 403)


class CourseManagementTests(LearningBase):
    def test_admin_creates_edits_publishes_and_structures_a_course(self):
        self.login(self.admin)
        created = self.client.post('/api/courses', {'title': 'Cloud 101', 'category': 'Cloud', 'level': 'Beginner', 'isPublished': 'false',
                                                     'chapters': '[{"title": "Intro"}]'}, format='multipart')
        self.assertEqual(created.status_code, 201, created.data)
        course_id = created.data['id']
        self.assertEqual(self.client.post('/api/courses', {'title': 'x'}, format='json').status_code, 400)
        module = self.client.post(f'/api/courses/{course_id}/modules', {'title': 'Deep dive', 'required': True}, format='json')
        self.assertEqual(module.status_code, 201)
        detail = self.client.get(f'/api/admin/courses/{course_id}').data
        ids = [row['id'] for row in detail['modules']]
        self.assertEqual(len(ids), 2)
        self.assertEqual(self.client.post(f'/api/courses/{course_id}/modules/order', {'moduleIds': ids[:1]}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/courses/{course_id}/modules/order', {'moduleIds': ids[::-1]}, format='json').status_code, 200)
        self.assertEqual([row['id'] for row in self.client.get(f'/api/admin/courses/{course_id}').data['modules']], ids[::-1])
        # Resources are validated on the server.
        bad_video = self.client.post(f'/api/modules/{ids[0]}/resources', {'type': 'video', 'title': 'v', 'url': 'https://example.com/v'}, format='json')
        self.assertEqual(bad_video.status_code, 400)
        bad_file = self.client.post(f'/api/modules/{ids[0]}/resources', {'type': 'document', 'title': 'exe',
                                    'file': SimpleUploadedFile('run.exe', b'MZ')}, format='multipart')
        self.assertEqual(bad_file.status_code, 400)
        good = self.client.post(f'/api/modules/{ids[0]}/resources', {'type': 'presentation', 'title': 'Slides',
                                'file': SimpleUploadedFile('deck.pptx', b'PK\x03\x04')}, format='multipart')
        self.assertEqual(good.status_code, 201, good.data)
        self.assertEqual(good.data['fileName'], 'deck.pptx')
        self.assertNotIn(self.media, str(good.data))
        download = self.client.get(f'/api/resources/{good.data["id"]}/file')
        self.assertEqual(download.status_code, 200)
        self.assertIn('attachment', download['Content-Disposition'])
        self.assertEqual(drain(download), b'PK')
        edited = self.client.patch(f'/api/courses/{course_id}', {'title': 'Cloud 101 (2nd edition)', 'isPublished': True}, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertTrue(m.Course.objects.get(pk=course_id).is_published)
        self.assertEqual(self.client.delete(f'/api/resources/{good.data["id"]}').status_code, 204)

    def test_students_cannot_manage_courses_or_see_unpublished_courses(self):
        hidden = m.Course.objects.create(title='Hidden draft', is_published=False)
        self.login(self.student)
        self.assertNotIn('Hidden draft', [row['title'] for row in self.client.get('/api/courses').data])
        self.assertEqual(self.client.get(f'/api/courses/{hidden.id}').status_code, 404)
        self.assertEqual(self.client.post(f'/api/courses/{hidden.id}/enroll', {}, format='json').status_code, 404)
        self.assertEqual(self.client.patch(f'/api/courses/{self.course.id}', {'title': 'Hacked'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/courses/{self.course.id}/modules', {'title': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/modules/{self.m1.id}/resources', {'type': 'link', 'title': 'x', 'url': 'https://a.b'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/modules/{self.m1.id}').status_code, 403)
        self.assertEqual(self.client.get(f'/api/admin/courses/{self.course.id}').status_code, 403)
        self.assertEqual(self.client.get('/api/exams').status_code, 403)

    def test_modules_with_attempt_history_cannot_be_deleted(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        self.login(self.admin)
        self.assertEqual(self.client.delete(f'/api/modules/{self.m1.id}').status_code, 409)
        self.assertEqual(self.client.delete(f'/api/courses/{self.course.id}').status_code, 409)

    def test_a_module_cannot_get_a_second_quiz(self):
        self.login(self.admin)
        response = self.client.post('/api/exams', {'title': 'Duplicate', 'assessmentType': 'module_quiz', 'courseId': self.course.id,
                                                   'moduleId': self.m1.id, 'status': 'draft'}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(m.Exam.objects.filter(module=self.m1).count(), 1)

    def test_quiz_pass_mark_is_validated_and_final_mark_is_fixed(self):
        m.Chapter.objects.filter(pk=self.m3.pk).update(required=False)
        self.login(self.admin)
        response = self.client.put(f'/api/exams/{self.q1.id}', {'passPercent': 0}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.put(f'/api/exams/{self.q1.id}', {'passPercent': 70}, format='json').data['passPercent'], 70)
        self.assertEqual(self.client.put(f'/api/exams/{self.final.id}', {'passPercent': 10}, format='json').data['passPercent'], 60)


class DashboardAndDirectoryTests(LearningBase):
    def test_new_student_dashboard_contains_no_invented_activity(self):
        self.login(self.other)
        data = self.client.get('/api/student/dashboard').data
        self.assertEqual(data['courses'], [])
        self.assertEqual(data['recentActivity'], [])
        self.assertEqual(data['stats'], {'enrolled': 0, 'completed': 0, 'inProgress': 0, 'averageQuizPercent': None,
                                         'quizAttempts': 0, 'quizzesPassed': 0})
        self.assertIsNone(data['next'])

    def test_dashboard_and_progress_reflect_stored_attempts(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        data = self.client.get('/api/student/dashboard').data
        self.assertEqual(data['stats']['quizAttempts'], 1)
        self.assertEqual(data['stats']['averageQuizPercent'], 100)
        self.assertEqual(data['next']['moduleTitle'], 'Module two')
        self.assertEqual(data['recentActivity'][0]['title'], 'Module one quiz')
        progress = self.client.get('/api/student/progress').data['courses'][0]
        self.assertEqual(progress['completedModules'], 1)
        self.assertFalse(progress['finalExam']['eligible'])

    def test_admin_dashboard_counts_come_from_the_database(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        self.login(self.admin)
        stats = self.client.get('/api/admin/dashboard').data['stats']
        self.assertEqual((stats['total'], stats['courses'], stats['enrollments'], stats['quizAttempts'], stats['modules']), (2, 1, 1, 1, 3))
        self.login(self.student)
        self.assertEqual(self.client.get('/api/admin/dashboard').status_code, 403)

    def test_directory_filters_sorts_paginates_and_never_exposes_credentials(self):
        self.login(self.student)
        self.enroll()
        self.pass_quiz(self.q1)
        self.login(self.admin)
        page = self.client.get('/api/admin/students?sort=-progress&pageSize=1').data
        self.assertEqual((page['total'], page['pages'], page['results'][0]['name']), (2, 2, 'Ada Lovelace'))
        self.assertEqual(page['summary']['total'], 2)
        never = self.client.get('/api/admin/students?login=never').data['results']
        self.assertEqual([row['email'] for row in never], ['bob@example.com'])
        enrolled = self.client.get('/api/admin/students?enrollment=enrolled&q=ada').data['results']
        self.assertEqual(enrolled[0]['enrollmentCount'], 1)
        self.assertEqual(self.client.get('/api/admin/students?sort=password').status_code, 400)
        detail = self.client.get(f'/api/admin/students/{self.student.id}').data
        text = str(detail).lower()
        for secret in ('pbkdf2', 'google_sub', 'googlesub', 'sessionid', 'token'):
            self.assertNotIn(secret, text)
        self.assertFalse([key for key in detail if 'password' in key.lower()])
        self.assertEqual(detail['metrics']['quizAttempts'], 1)
        self.assertEqual(detail['attempts'][0]['title'], 'Module one quiz')
        self.assertEqual(detail['enrollments'][0]['modules'][0]['quiz']['bestPercent'], 100.0)
        self.assertEqual([event['authMethod'] for event in detail['loginHistory']], ['email_password'])
        self.assertEqual(self.client.get(f'/api/admin/students/{self.admin.id}').status_code, 404)

    def test_failed_logins_and_token_refresh_do_not_create_login_events(self):
        self.client.get('/api/auth/csrf')
        self.client.post('/api/auth/login', {'email': self.student.email, 'password': 'wrong-password'}, format='json')
        self.assertEqual(m.LoginEvent.objects.filter(user=self.student).count(), 0)
        token_response = self.client.post('/api/auth/token', {'email': self.student.email, 'password': 'student-pass-123'}, format='json')
        self.assertEqual(token_response.status_code, 200, token_response.data)
        self.assertIn('refresh', token_response.data)
        token = token_response.data
        self.client.post('/api/auth/refresh', {'refresh': token['refresh']}, format='json')
        self.login(self.admin)
        detail = self.client.get(f'/api/admin/students/{self.student.id}').data
        self.assertEqual([event['authMethod'] for event in detail['loginHistory']], ['legacy_jwt'])

    def test_profile_rejects_duplicate_email_and_cannot_change_role(self):
        self.login(self.student)
        self.assertEqual(self.client.put('/api/profile', {'email': 'bob@example.com'}, format='json').status_code, 400)
        response = self.client.put('/api/profile', {'firstName': 'Augusta', 'role': 'admin'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual((self.student.first_name, self.student.role), ('Augusta', 'student'))
        self.assertIn('googleLinked', response.data)
