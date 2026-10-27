"""Regression tests for the administrator enhancements and the student password change.

Like the rest of the suite these run against PostgreSQL (Django creates and destroys `test_<DB_NAME>`).
"""
import shutil
import tempfile
from io import BytesIO

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test import override_settings
from openpyxl import Workbook
from rest_framework.test import APIClient, APITestCase

from lms import models as m
from lms.test_support import RateLimitIsolationMixin

XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
MAPPING = {'questionType': 'Type', 'questionText': 'Question', 'options': 'Options', 'correctAnswer': 'Answer',
           'marks': 'Marks', 'acceptedAlternatives': 'Also accept'}
HEADERS = ['Type', 'Question', 'Options', 'Answer', 'Marks', 'Also accept']


def workbook(rows, headers=HEADERS, title='Questions'):
    book = Workbook()
    sheet = book.active
    sheet.title = title
    sheet.append(headers)
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    book.save(stream)
    return SimpleUploadedFile('questions.xlsx', stream.getvalue(), content_type=XLSX)


VALID_ROWS = [
    ['single', 'Capital of France?', 'Paris|Rome|Madrid', 'A', 2, None],
    ['multiple', 'Prime numbers?', '2|4|5|9', 'A,C', 3, None],
    ['true_false', 'The sky is blue.', None, 'true', 1, None],
    ['short', 'Language of Django?', None, 'Python', 2, 'python 3'],
]


class AdminBase(RateLimitIsolationMixin, APITestCase):
    def setUp(self):
        self._start_rate_limit_isolation()
        self.assertEqual(connection.vendor, 'postgresql')
        cache.clear()  # throttling counters live in the cache
        self.admin = m.User.objects.create_user('admin', email='admin@example.com', password='Admin-pass-91', role='admin')
        self.student = m.User.objects.create_user('learner', email='learner@example.com', password='Learner-pass-91', role='student')
        self.course = m.Course.objects.create(title='Algorithms')
        self.module = m.Chapter.objects.create(course=self.course, title='Sorting', order=0)
        self.module2 = m.Chapter.objects.create(course=self.course, title='Graphs', order=1)
        self.quiz = m.Exam.objects.create(title='Sorting quiz', course=self.course, module=self.module,
                                          assessment_type='module_quiz', status='draft')
        m.Question.objects.create(exam=self.quiz, text='Existing question', question_type='single',
                                  choices=['Yes', 'No'], correct_answers=[0], points=1, order=0)

    def sign_in(self, user, password, role):
        response = self.client.post('/api/auth/login', {'email': user.email, 'password': password, 'role': role}, format='json')
        self.assertEqual(response.status_code, 200, response.data)

    def as_admin(self):
        self.sign_in(self.admin, 'Admin-pass-91', 'admin')

    def as_student(self):
        self.sign_in(self.student, 'Learner-pass-91', 'student')


class ExcelImportTests(AdminBase):
    def upload(self, file, exam=None):
        return self.client.post('/api/admin/question-imports/upload', {'file': file, 'examId': (exam or self.quiz).id}, format='multipart')

    def preview(self, batch, mapping=MAPPING, sheet='Questions'):
        return self.client.post(f'/api/admin/question-imports/{batch}/preview', {'sheet': sheet, 'mapping': mapping}, format='json')

    def confirm(self, batch, key='key-1'):
        return self.client.post(f'/api/admin/question-imports/{batch}/confirm', {'idempotencyKey': key}, format='json')

    def test_valid_import_adds_every_question_type_to_the_selected_assessment_only(self):
        other = m.Exam.objects.create(title='Graphs quiz', course=self.course, module=self.module2, assessment_type='module_quiz')
        self.as_admin()
        uploaded = self.upload(workbook(VALID_ROWS + [[None] * 6]))
        self.assertEqual(uploaded.status_code, 201, uploaded.data)
        self.assertEqual(uploaded.data['exam'], {'id': self.quiz.id, 'title': 'Sorting quiz', 'questionCount': 1})
        preview = self.preview(uploaded.data['batchId'])
        self.assertEqual((preview.status_code, preview.data['validCount'], preview.data['invalidCount']), (200, 4, 0), preview.data)
        self.assertEqual(preview.data['blankRows'], [6])
        self.assertEqual([row['questionType'] for row in preview.data['preview']], ['single', 'multiple', 'true_false', 'short'])
        self.assertEqual(m.Question.objects.filter(exam=self.quiz).count(), 1, 'preview must not create questions')
        confirmed = self.confirm(uploaded.data['batchId'])
        self.assertEqual((confirmed.status_code, confirmed.data['imported']), (201, 4))
        questions = list(self.quiz.questions.order_by('order'))
        self.assertEqual(len(questions), 5)
        self.assertEqual([q.order for q in questions], [0, 1, 2, 3, 4])
        by_text = {q.text: q for q in questions}
        self.assertEqual((by_text['Capital of France?'].correct_answers, by_text['Capital of France?'].points), ([0], 2))
        self.assertEqual(by_text['Prime numbers?'].correct_answers, [0, 2])
        self.assertEqual(by_text['The sky is blue.'].correct_answers, [True])
        self.assertEqual((by_text['Language of Django?'].expected_answer, by_text['Language of Django?'].accepted_answers), ('Python', ['python 3']))
        self.assertEqual(other.questions.count(), 0)

    def test_invalid_workbook_is_rejected(self):
        self.as_admin()
        fake = SimpleUploadedFile('questions.xlsx', b'Type,Question\nsingle,Hi', content_type=XLSX)
        response = self.upload(fake)
        self.assertEqual(response.status_code, 400)
        self.assertIn('not a valid .xlsx', response.data['message'])
        wrong_extension = self.upload(SimpleUploadedFile('questions.csv', b'a,b', content_type='text/csv'))
        self.assertEqual(wrong_extension.status_code, 400)
        empty = self.upload(workbook([], headers=['Type']))
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(m.QuestionImportBatch.objects.count(), 0)

    def test_missing_columns_are_reported_before_any_row_is_read(self):
        self.as_admin()
        batch = self.upload(workbook(VALID_ROWS)).data['batchId']
        missing = self.preview(batch, {**MAPPING, 'marks': ''})
        self.assertEqual(missing.status_code, 400)
        self.assertIn('marks', missing.data['message'])
        unknown = self.preview(batch, {**MAPPING, 'options': 'Choices'})
        self.assertEqual(unknown.status_code, 400)
        self.assertIn('Choices', unknown.data['message'])

    def test_invalid_rows_are_listed_by_row_and_block_the_whole_import(self):
        self.as_admin()
        rows = [
            ['single', 'Good row', 'A|B', 'A', 1, None],
            ['essay', 'Unsupported type', 'A|B', 'A', 1, None],
            ['single', 'Bad answer letter', 'A|B', 'D', 1, None],
            ['multiple', 'No correct answers', 'A|B|C', '', 1, None],
            ['true_false', 'Maybe?', None, 'maybe', 1, None],
            ['single', 'Zero marks', 'A|B', 'A', 0, None],
            ['single', 'Existing question', 'Yes|No', 'A', 1, None],
        ]
        batch = self.upload(workbook(rows)).data['batchId']
        preview = self.preview(batch)
        self.assertEqual((preview.data['validCount'], preview.data['invalidCount']), (1, 6))
        self.assertEqual([error['row'] for error in preview.data['errors']], [3, 4, 5, 6, 7, 8])
        self.assertIn('unsupported question type', preview.data['errors'][0]['message'])
        self.assertIn('duplicate', preview.data['errors'][-1]['message'])
        refused = self.confirm(batch)
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(self.quiz.questions.count(), 1, 'an invalid batch must not import its valid rows')

    def test_retry_is_idempotent_and_a_second_batch_cannot_duplicate_questions(self):
        self.as_admin()
        first = self.upload(workbook(VALID_ROWS[:1])).data['batchId']
        second = self.upload(workbook(VALID_ROWS[:1])).data['batchId']
        self.assertEqual(self.preview(first).data['validCount'], 1)
        self.assertEqual(self.preview(second).data['validCount'], 1)
        self.assertEqual(self.confirm(first).status_code, 201)
        retry = self.confirm(first)
        self.assertEqual((retry.status_code, retry.data['alreadyImported']), (200, True))
        self.assertEqual(self.confirm(first, 'another-key').status_code, 409)
        stale = self.confirm(second, 'key-2')
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.quiz.questions.filter(text='Capital of France?').count(), 1)
        self.assertEqual(self.quiz.questions.count(), 2)

    def test_assessment_module_and_course_can_be_deleted_after_an_import(self):
        # Import batches are staging data: they must not turn a permitted deletion into a server error.
        self.as_admin()
        batch = self.upload(workbook(VALID_ROWS[:1])).data['batchId']
        self.preview(batch)
        self.assertEqual(self.confirm(batch).status_code, 201)
        self.assertEqual(self.client.delete(f'/api/exams/{self.quiz.id}').status_code, 204)
        self.assertFalse(m.QuestionImportBatch.objects.filter(public_id=batch).exists())

        module_quiz = m.Exam.objects.create(title='Graphs quiz', course=self.course, module=self.module2, assessment_type='module_quiz')
        self.upload(workbook(VALID_ROWS[:1]), exam=module_quiz)
        self.assertEqual(self.client.delete(f'/api/modules/{self.module2.id}').status_code, 204)

        final = m.Exam.objects.create(title='Final', course=self.course, assessment_type='final_exam')
        self.upload(workbook(VALID_ROWS[:1]), exam=final)
        self.assertEqual(self.client.delete(f'/api/courses/{self.course.id}').status_code, 204)
        self.assertFalse(m.QuestionImportBatch.objects.exists())

    def test_students_and_anonymous_users_cannot_import(self):
        anonymous = self.upload(workbook(VALID_ROWS))
        self.assertEqual(anonymous.status_code, 401)
        self.as_student()
        self.assertEqual(self.upload(workbook(VALID_ROWS)).status_code, 403)
        self.client.logout()
        self.as_admin()
        batch = self.upload(workbook(VALID_ROWS)).data['batchId']
        self.preview(batch)
        student = APIClient()
        student.force_authenticate(self.student)
        self.assertEqual(student.post(f'/api/admin/question-imports/{batch}/confirm', {'idempotencyKey': 'x'}, format='json').status_code, 403)
        self.assertEqual(self.quiz.questions.count(), 1)


@override_settings(PRIVATE_MEDIA_ROOT=tempfile.mkdtemp(prefix='yoloa-test-media-'))
class CourseManagementTests(AdminBase):
    @classmethod
    def tearDownClass(cls):
        from django.conf import settings
        shutil.rmtree(settings.PRIVATE_MEDIA_ROOT, ignore_errors=True)
        super().tearDownClass()

    def test_course_and_module_resources_keep_their_association(self):
        self.as_admin()
        course_level = self.client.post(f'/api/courses/{self.course.id}/resources',
                                        {'type': 'link', 'title': 'Syllabus', 'url': 'https://example.com/syllabus'}, format='multipart')
        self.assertEqual(course_level.status_code, 201, course_level.data)
        self.assertIsNone(course_level.data['moduleId'])
        pdf = SimpleUploadedFile('notes.pdf', b'%PDF-1.4 test', content_type='application/pdf')
        module_level = self.client.post(f'/api/modules/{self.module.id}/resources',
                                        {'type': 'document', 'title': 'Notes', 'file': pdf}, format='multipart')
        self.assertEqual(module_level.status_code, 201, module_level.data)
        self.assertEqual(module_level.data['moduleId'], self.module.id)
        self.assertEqual(module_level.data['filePath'], f"/resources/{module_level.data['id']}/file")
        bad = self.client.post(f'/api/courses/{self.course.id}/resources', {'type': 'video', 'title': 'Video', 'url': 'https://example.com/v'}, format='multipart')
        self.assertEqual(bad.status_code, 400)
        manage = self.client.get(f'/api/admin/courses/{self.course.id}').data
        self.assertEqual([r['title'] for r in manage['resources']], ['Syllabus'])
        self.assertEqual([r['title'] for r in manage['modules'][0]['resources']], ['Notes'])
        edited = self.client.patch(f"/api/resources/{course_level.data['id']}", {'title': 'Course syllabus'}, format='json')
        self.assertEqual((edited.status_code, edited.data['title'], edited.data['moduleId']), (200, 'Course syllabus', None))
        self.assertEqual(self.client.delete(f"/api/resources/{course_level.data['id']}").status_code, 204)
        self.assertFalse(m.CourseContent.objects.filter(pk=course_level.data['id']).exists())

    def test_students_cannot_add_course_resources_and_need_enrollment_to_read_them(self):
        m.CourseContent.objects.create(course=self.course, title='Syllabus', resource_type='link', url='https://example.com')
        self.as_student()
        self.assertEqual(self.client.post(f'/api/courses/{self.course.id}/resources',
                                          {'type': 'link', 'title': 'X', 'url': 'https://example.com'}, format='multipart').status_code, 403)
        self.assertEqual(self.client.get(f'/api/courses/{self.course.id}/resources').status_code, 403)
        m.Enrollment.objects.create(student=self.student, course=self.course)
        listed = self.client.get(f'/api/courses/{self.course.id}/resources')
        self.assertEqual([r['title'] for r in listed.data], ['Syllabus'])
        self.assertNotIn('createdAt', listed.data[0])

    def test_module_quiz_and_final_exam_create_edit_without_duplicates(self):
        self.as_admin()
        question = {'questionType': 'single', 'text': 'Q?', 'choices': ['A', 'B'], 'correct': 0, 'points': 1}
        created = self.client.post('/api/exams', {'title': 'Graphs quiz', 'assessmentType': 'module_quiz', 'courseId': self.course.id,
                                                  'moduleId': self.module2.id, 'status': 'draft', 'questions': [question]}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        duplicate = self.client.post('/api/exams', {'title': 'Second', 'assessmentType': 'module_quiz', 'courseId': self.course.id,
                                                    'moduleId': self.module2.id, 'questions': [question]}, format='json')
        self.assertEqual(duplicate.status_code, 409)
        other_course = m.Course.objects.create(title='Other')
        foreign = self.client.post('/api/exams', {'title': 'Wrong', 'assessmentType': 'module_quiz', 'courseId': other_course.id,
                                                  'moduleId': self.module2.id, 'questions': [question]}, format='json')
        self.assertEqual(foreign.status_code, 400)
        edited = self.client.put(f"/api/exams/{created.data['id']}", {'title': 'Graphs quiz v2', 'passPercent': 70}, format='json')
        self.assertEqual((edited.status_code, edited.data['title'], edited.data['passPercent'], edited.data['moduleId']),
                         (200, 'Graphs quiz v2', 70, self.module2.id))

        final = self.client.post('/api/exams', {'title': 'Final', 'assessmentType': 'final_exam', 'courseId': self.course.id,
                                                'durationSeconds': 60, 'passPercent': 10, 'questions': [question]}, format='json')
        self.assertEqual(final.status_code, 201, final.data)
        self.assertEqual((final.data['durationSeconds'], final.data['passPercent'], final.data['moduleId']), (600, 60, None))
        second_final = self.client.post('/api/exams', {'title': 'Final 2', 'assessmentType': 'final_exam', 'courseId': self.course.id,
                                                       'questions': [question]}, format='json')
        self.assertEqual(second_final.status_code, 409)
        edited_final = self.client.put(f"/api/exams/{final.data['id']}", {'title': 'Final exam', 'passPercent': 20}, format='json')
        self.assertEqual((edited_final.status_code, edited_final.data['passPercent'], edited_final.data['durationSeconds']), (200, 60, 600))
        manage = self.client.get(f'/api/admin/courses/{self.course.id}').data
        self.assertEqual(manage['modules'][1]['quiz']['id'], created.data['id'])
        self.assertEqual(manage['finalExam']['id'], final.data['id'])

    def test_students_cannot_use_course_management_actions(self):
        self.as_student()
        self.assertEqual(self.client.get(f'/api/admin/courses/{self.course.id}').status_code, 403)
        self.assertEqual(self.client.get('/api/exams').status_code, 403)
        self.assertEqual(self.client.post('/api/exams', {'title': 'X', 'assessmentType': 'final_exam', 'courseId': self.course.id}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/modules/{self.module.id}/resources', {'type': 'link', 'title': 'X', 'url': 'https://e.com'}, format='multipart').status_code, 403)


class PasswordChangeTests(AdminBase):
    URL = '/api/auth/password/change'

    def change(self, current='Learner-pass-91', new='Fresh-horse-482', confirmation=None, client=None):
        return (client or self.client).post(self.URL, {'currentPassword': current, 'newPassword': new,
                                                       'newPasswordConfirmation': new if confirmation is None else confirmation}, format='json')

    def test_successful_change_keeps_this_session_and_rotates_credentials(self):
        self.as_student()
        other_device = APIClient()
        other_device.post('/api/auth/login', {'email': self.student.email, 'password': 'Learner-pass-91', 'role': 'student'}, format='json')
        self.assertEqual(other_device.get('/api/auth/me').status_code, 200)
        response = self.change()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('Fresh-horse-482', str(response.data))
        self.assertEqual(self.client.get('/api/auth/me').status_code, 200, 'the current session stays signed in')
        self.assertEqual(other_device.get('/api/auth/me').status_code, 401, 'other sessions are signed out')
        fresh = APIClient()
        old = fresh.post('/api/auth/login', {'email': self.student.email, 'password': 'Learner-pass-91', 'role': 'student'}, format='json')
        self.assertEqual(old.status_code, 401)
        new = fresh.post('/api/auth/login', {'email': self.student.email, 'password': 'Fresh-horse-482', 'role': 'student'}, format='json')
        self.assertEqual(new.status_code, 200)

    def test_wrong_current_password_mismatch_and_weak_passwords_change_nothing(self):
        self.as_student()
        wrong = self.change(current='not-my-password')
        self.assertEqual((wrong.status_code, list(wrong.data['errors'])), (400, ['currentPassword']))
        mismatch = self.change(confirmation='Fresh-horse-483')
        self.assertEqual((mismatch.status_code, list(mismatch.data['errors'])), (400, ['newPasswordConfirmation']))
        short = self.change(new='Ab1!')
        self.assertEqual(short.status_code, 400)
        self.assertTrue(any('too short' in message for message in short.data['errors']['newPassword']))
        common = self.change(new='password123')
        self.assertEqual(common.status_code, 400)
        same = self.change(new='Learner-pass-91')
        self.assertEqual(same.status_code, 400)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password('Learner-pass-91'))

    def test_repeated_wrong_current_passwords_are_throttled(self):
        self.as_student()
        for _ in range(5):
            self.assertEqual(self.change(current='wrong').status_code, 400)
        self.assertEqual(self.change().status_code, 429)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password('Learner-pass-91'))

    def test_requires_authentication_and_csrf(self):
        self.assertEqual(self.change().status_code, 401)
        csrf_client = APIClient(enforce_csrf_checks=True)
        csrf_client.get('/api/auth/csrf')
        token = csrf_client.cookies['csrftoken'].value
        login = csrf_client.post('/api/auth/login', {'email': self.student.email, 'password': 'Learner-pass-91', 'role': 'student'},
                                 format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login.status_code, 200)
        self.assertEqual(self.change(client=csrf_client).status_code, 403, 'a request without the CSRF header is refused')
        token = csrf_client.cookies['csrftoken'].value
        ok = csrf_client.post(self.URL, {'currentPassword': 'Learner-pass-91', 'newPassword': 'Fresh-horse-482',
                                         'newPasswordConfirmation': 'Fresh-horse-482'}, format='json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(ok.status_code, 200, ok.data)

    def test_submitted_user_ids_are_ignored(self):
        self.as_student()
        response = self.client.post(self.URL, {'currentPassword': 'Learner-pass-91', 'newPassword': 'Fresh-horse-482',
                                               'newPasswordConfirmation': 'Fresh-horse-482', 'userId': self.admin.id,
                                               'id': self.admin.id, 'email': self.admin.email}, format='json')
        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.student.refresh_from_db()
        self.assertTrue(self.admin.check_password('Admin-pass-91'))
        self.assertTrue(self.student.check_password('Fresh-horse-482'))

    def test_google_only_account_is_pointed_to_password_reset(self):
        google = m.User.objects.create_user('g', email='g@example.com', role='student', google_sub='sub-1')
        client = APIClient()
        client.force_login(google)
        self.assertFalse(client.get('/api/auth/me').data['hasPassword'])
        response = self.change(current='anything', client=client)
        self.assertEqual(response.status_code, 400)
        self.assertIn('Forgot password', response.data['message'])
