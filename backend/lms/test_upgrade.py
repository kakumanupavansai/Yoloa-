"""Quiz images, quiz deletion, admin analytics overview and the student progress dashboard.

Runs against PostgreSQL like the rest of the suite (Django creates and destroys `test_<DB_NAME>`).
"""
import io
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase

from lms import models as m
from lms.test_support import RateLimitIsolationMixin


def png(name='diagram.png', size=(8, 6)):
    out = io.BytesIO()
    Image.new('RGB', size, (20, 120, 200)).save(out, 'PNG')
    return SimpleUploadedFile(name, out.getvalue(), content_type='image/png')


class UpgradeBase(RateLimitIsolationMixin, APITestCase):
    def setUp(self):
        super().setUp()
        self.assertEqual(connection.vendor, 'postgresql')
        self.media_dir = tempfile.mkdtemp(prefix='yoloa-quiz-image-test-')
        self.media = override_settings(PRIVATE_MEDIA_ROOT=self.media_dir)
        self.media.enable()
        self.admin = m.User.objects.create_user('boss', email='boss@example.com', password='Admin-pass-91', role='admin')
        self.student = m.User.objects.create_user('learner', email='learner@example.com', password='Learner-pass-91', role='student')
        self.other = m.User.objects.create_user('outsider', email='outsider@example.com', password='Other-pass-91', role='student')
        self.course = m.Course.objects.create(title='Biology')
        self.module = m.Chapter.objects.create(course=self.course, title='Cells', order=0)
        self.module2 = m.Chapter.objects.create(course=self.course, title='Organs', order=1)
        m.Enrollment.objects.create(student=self.student, course=self.course)

    def tearDown(self):
        self.media.disable()
        shutil.rmtree(self.media_dir, ignore_errors=True)
        super().tearDown()

    def upload(self, file=None):
        self.client.force_authenticate(self.admin)
        return self.client.post('/api/admin/quiz-images', {'file': file or png()}, format='multipart')

    def make_quiz(self, questions, status='published'):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/exams', {'title': 'Cell quiz', 'assessmentType': 'module_quiz', 'courseId': self.course.id,
                                                   'moduleId': self.module.id, 'status': status, 'questions': questions}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return m.Exam.objects.get(pk=response.data['id'])


class QuizImageTests(UpgradeBase):
    def test_upload_validates_real_image_content_size_and_role(self):
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.post('/api/admin/quiz-images', {'file': png()}, format='multipart').status_code, 403)
        fake = SimpleUploadedFile('photo.png', b'<script>alert(1)</script>', content_type='image/png')
        self.assertEqual(self.upload(fake).status_code, 400)
        self.assertEqual(self.upload(SimpleUploadedFile('notes.txt', b'hello', content_type='text/plain')).status_code, 400)
        with patch('lms.views.MAX_QUIZ_IMAGE_BYTES', 10):
            self.assertEqual(self.upload().status_code, 400)
        ok = self.upload()
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual((ok.data['width'], ok.data['height']), (8, 6))
        self.assertEqual(ok.data['url'], f"/quiz-images/{ok.data['id']}")

    def test_images_on_question_choices_and_explanation_survive_save_and_snapshot(self):
        q_img, a_img, b_img, e_img = (self.upload().data['id'] for _ in range(4))
        exam = self.make_quiz([
            {'questionType': 'single', 'text': 'Which is a cell?', 'imageId': q_img, 'choices': ['', 'Rock'],
             'choiceImages': [a_img, None], 'correct': 0, 'explanation': 'Cells have membranes.', 'explanationImageId': e_img, 'points': 1},
            {'questionType': 'true_false', 'text': 'Plain text question', 'correct': 'true', 'points': 1},
        ])
        first, second = exam.questions.order_by('order')
        self.assertEqual((first.image_id, first.choice_images, first.explanation_image_id), (q_img, [a_img, None], e_img))
        self.assertEqual(first.choices, ['', 'Rock'])  # an image-only choice keeps its slot
        self.assertEqual((second.image_id, second.choice_images, second.explanation), (None, [], ''))
        detail = self.client.get(f'/api/exams/{exam.id}').data['questions'][0]
        self.assertEqual((detail['imageId'], detail['choiceImages'], detail['explanationImageId']), (q_img, [a_img, None], e_img))
        # Re-saving (questions are re-created) keeps image references.
        put = self.client.put(f'/api/exams/{exam.id}', {'questions': [{**{'questionType': 'single', 'text': 'Which is a cell?', 'choices': ['Cell', 'Rock'],
                                                                         'choiceImages': [a_img, b_img], 'correct': 0, 'imageId': q_img}}]}, format='json')
        self.assertEqual(put.status_code, 200, put.data)
        self.assertEqual(exam.questions.get().choice_images, [a_img, b_img])
        bad = self.client.put(f'/api/exams/{exam.id}', {'questions': [{'questionType': 'single', 'text': 'x', 'choices': ['a', 'b'], 'correct': 0, 'imageId': 99999}]}, format='json')
        self.assertEqual(bad.status_code, 400)

    def test_student_sees_images_but_not_explanation_until_finalized(self):
        q_img, e_img, unused = self.upload().data['id'], self.upload().data['id'], self.upload().data['id']
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'imageId': q_img, 'choices': ['A', 'B'], 'correct': 0,
                                'explanation': 'Because A.', 'explanationImageId': e_img}])
        self.client.force_authenticate(self.student)
        before = self.client.get(f'/api/assessments/{exam.id}').data['questions'][0]
        self.assertEqual(before['imageId'], q_img)
        self.assertNotIn('explanation', before)
        self.assertEqual(self.client.get(f'/api/quiz-images/{q_img}').status_code, 200)
        self.assertEqual(self.client.get(f'/api/quiz-images/{e_img}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/quiz-images/{unused}').status_code, 404)
        started = self.client.post(f'/api/assessments/{exam.id}/start', {}, format='json').data
        self.assertNotIn('explanationImageId', started['questions'][0])
        self.assertEqual(self.client.get(f'/api/quiz-images/{e_img}').status_code, 404)
        result = self.client.post(f"/api/attempts/{started['attemptId']}/submit", {}, format='json').data
        self.assertEqual(result['review'][0]['explanation'], 'Because A.')
        self.assertEqual(result['review'][0]['imageId'], q_img)
        image = self.client.get(f'/api/quiz-images/{e_img}')
        self.assertEqual(image.status_code, 200)
        self.assertEqual(image['Content-Type'], 'image/png')
        self.assertEqual(image['X-Content-Type-Options'], 'nosniff')
        # A student who is not enrolled and has no attempt cannot load any of the images.
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/quiz-images/{q_img}').status_code, 404)
        self.assertEqual(self.client.get(f'/api/quiz-images/{e_img}').status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/quiz-images/{q_img}').status_code, 401)

    def test_draft_quiz_images_are_hidden_from_students(self):
        q_img = self.upload().data['id']
        self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'imageId': q_img, 'choices': ['A', 'B'], 'correct': 0}], status='draft')
        self.client.force_authenticate(self.student)
        self.assertEqual(self.client.get(f'/api/quiz-images/{q_img}').status_code, 404)

    def test_text_only_quiz_grading_is_unchanged(self):
        exam = self.make_quiz([{'questionType': 'single', 'text': '2+2?', 'choices': ['4', '5'], 'correct': 0, 'points': 2},
                               {'questionType': 'short', 'text': 'Capital of France?', 'expectedAnswer': 'Paris', 'points': 1}])
        self.client.force_authenticate(self.student)
        ids = [q['id'] for q in self.client.get(f'/api/quizzes/{exam.id}').data['questions']]
        result = self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(ids[0]): 0, str(ids[1]): 'paris'}}, format='json').data
        self.assertEqual((result['score'], result['total'], result['percent'], result['passed']), (3, 3, 100, True))


class DeleteQuizTests(UpgradeBase):
    def test_delete_quiz_without_attempts_keeps_course_and_module_and_refreshes_progress(self):
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'choices': ['A', 'B'], 'correct': 0}])
        # A manual completion recorded for module 1 does not count while the module has a quiz…
        m.ChapterProgress.objects.create(student=self.student, chapter=self.module, completed=True, completed_at=timezone.now())
        self.assertEqual(m.Enrollment.objects.get(student=self.student).percent, 0)
        response = self.client.delete(f'/api/exams/{exam.id}')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(m.Exam.objects.filter(pk=exam.id).exists())
        self.assertFalse(m.Question.objects.filter(exam_id=exam.id).exists())
        self.assertTrue(m.Course.objects.filter(pk=self.course.id).exists())
        self.assertEqual(m.Chapter.objects.filter(course=self.course).count(), 2)
        # …but once the quiz is gone it does, and the stored percent is recalculated (1 of 2 modules).
        self.assertEqual(m.Enrollment.objects.get(student=self.student).percent, 50)

    def test_delete_quiz_with_attempts_is_refused_and_history_kept(self):
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'choices': ['A', 'B'], 'correct': 0}])
        self.client.force_authenticate(self.student)
        qid = self.client.get(f'/api/quizzes/{exam.id}').data['questions'][0]['id']
        self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): 0}}, format='json')
        self.assertEqual(self.client.delete(f'/api/exams/{exam.id}').status_code, 403)
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f'/api/exams/{exam.id}')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'has_attempts')
        self.assertEqual(response.data['attempts'], 1)
        self.assertTrue(m.Exam.objects.filter(pk=exam.id).exists())
        self.assertEqual(m.Attempt.objects.filter(exam=exam).count(), 1)


class AnalyticsOverviewTests(UpgradeBase):
    def test_overview_counts_real_records_in_range(self):
        m.User.objects.create_user('sleeper', email='s@example.com', password='Sleep-pass-91', role='student', is_active=False)
        m.LoginEvent.objects.create(user=self.student, event_type='login', auth_method='email_password')
        m.LoginEvent.objects.create(user=self.student, event_type='login', auth_method='google')
        m.LoginEvent.objects.create(user=self.student, event_type='refresh')
        old = m.LoginEvent.objects.create(user=self.other, event_type='login', auth_method='email_password')
        m.LoginEvent.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=90))
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'choices': ['A', 'B'], 'correct': 0}])
        self.client.force_authenticate(self.student)
        qid = self.client.get(f'/api/quizzes/{exam.id}').data['questions'][0]['id']
        self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): 1}}, format='json')  # 0%
        self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): 0}}, format='json')  # 100%
        self.assertEqual(self.client.get('/api/admin/analytics/overview').status_code, 403)
        self.client.force_authenticate(self.admin)
        data = self.client.get('/api/admin/analytics/overview').data
        self.assertEqual(data['range']['days'], 30)
        self.assertEqual(data['students']['total'], 3)
        self.assertEqual((data['students']['accountActive'], data['students']['accountDisabled']), (2, 1))
        self.assertEqual((data['students']['activeInRange'], data['students']['inactiveInRange']), (1, 2))
        self.assertEqual(sum(day['value'] for day in data['logins']), 2)  # refreshes and the 90-day-old login excluded
        self.assertEqual(len(data['logins']), 30)
        self.assertEqual(sum(day['value'] for day in data['registrations']), 3)
        self.assertEqual({row['method']: row['value'] for row in data['loginMethods']}, {'email_password': 1, 'google': 1})
        self.assertEqual(data['courses'][0]['enrolled'], 1)
        self.assertEqual(data['quizzes']['attempts'], 2)
        self.assertEqual(data['quizzes']['passRate'], 50)
        self.assertEqual(data['quizzes']['distribution'][0]['quiz'], 1)
        self.assertEqual(data['quizzes']['distribution'][9]['quiz'], 1)
        wide = self.client.get('/api/admin/analytics/overview', {'start': (timezone.localdate() - timedelta(days=120)).isoformat()}).data
        self.assertEqual(sum(day['value'] for day in wide['logins']), 3)

    def test_overview_rejects_bad_ranges(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/admin/analytics/overview', {'start': 'yesterday'}).status_code, 400)
        self.assertEqual(self.client.get('/api/admin/analytics/overview', {'start': '2026-05-02', 'end': '2026-05-01'}).status_code, 400)
        self.assertEqual(self.client.get('/api/admin/analytics/overview', {'start': '2024-01-01', 'end': '2026-01-01'}).status_code, 400)


class StudentProgressDashboardTests(UpgradeBase):
    def test_progress_summary_and_timeline_are_the_session_students_own(self):
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'choices': ['A', 'B'], 'correct': 0}])
        self.client.force_authenticate(self.student)
        qid = self.client.get(f'/api/quizzes/{exam.id}').data['questions'][0]['id']
        self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): 1}}, format='json')
        self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): 0}}, format='json')
        # Another student's records never appear, even if an id is supplied.
        m.Enrollment.objects.create(student=self.other, course=self.course)
        data = self.client.get('/api/student/progress', {'student': self.other.id}).data
        self.assertEqual([item['percent'] for item in data['timeline']], [0, 100])
        self.assertEqual(data['summary']['completedModules'], 1)
        self.assertEqual(data['summary']['pendingModules'], 1)
        self.assertEqual(data['summary']['overallPercent'], 50)
        self.assertEqual(data['summary']['bestPercent'], 100)
        self.assertEqual(data['summary']['latest']['percent'], 100)
        self.assertEqual(len(data['moduleCompletions']), 1)
        self.client.force_authenticate(self.other)
        theirs = self.client.get('/api/student/progress').data
        self.assertEqual(theirs['timeline'], [])
        self.assertEqual(theirs['summary']['completedModules'], 0)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/student/progress').status_code, 403)

    def test_admin_attempt_history_includes_number_duration_and_question_count(self):
        exam = self.make_quiz([{'questionType': 'single', 'text': 'Pick', 'choices': ['A', 'B'], 'correct': 0}])
        self.client.force_authenticate(self.student)
        qid = self.client.get(f'/api/quizzes/{exam.id}').data['questions'][0]['id']
        for answer in (1, 0):
            self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': {str(qid): answer}}, format='json')
        self.client.force_authenticate(self.admin)
        rows = self.client.get(f'/api/admin/students/{self.student.id}').data['attempts']
        self.assertEqual(sorted(row['attemptNumber'] for row in rows), [1, 2])
        self.assertEqual(rows[0]['questionCount'], 1)
        self.assertEqual(rows[0]['moduleTitle'], 'Cells')
        self.assertIsNotNone(rows[0]['durationSeconds'])
