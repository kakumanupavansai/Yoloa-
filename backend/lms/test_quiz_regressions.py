"""Regression tests for quiz scoring and for opening/starting quizzes (PostgreSQL only).

* Scoring: the denominator is the points of the questions snapshotted for the attempt, each counted once.
* Opening: a quiz start that loses a race against a concurrent start (double click, React StrictMode
  remount, a second tab) used to hit the one-active-attempt constraint and then fail with
  TransactionManagementError (HTTP 500) because PostgreSQL had aborted the transaction.
"""
import threading
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase
from rest_framework.test import APIClient

from lms import models as m
from lms import views
from lms.test_learning import LearningBase

ANSWER_KEY_FIELDS = {'correct', 'correctAnswers', 'expectedAnswer', 'acceptedAlternatives', 'normalization'}


class QuizScoringTests(LearningBase):
    def setUp(self):
        super().setUp()
        # Module one's quiz gets a third equally weighted question: three questions, three points.
        self.q1.q_c = m.Question.objects.create(exam=self.q1, text='C?', question_type='single', choices=['p', 'q', 'r'],
                                                correct=2, correct_answers=[2], points=1, order=2)
        self.login(self.student)
        self.enroll()

    def submit(self, exam, answers, raw=None):
        if raw is not None:
            return self.client.post(f'/api/quizzes/{exam.id}/attempts', raw, content_type='application/json')
        return self.client.post(f'/api/quizzes/{exam.id}/attempts', {'answers': answers}, format='json')

    def answers(self, correct):
        right = {str(self.q1.q_a.id): 0, str(self.q1.q_b.id): True, str(self.q1.q_c.id): 2}
        wrong = {str(self.q1.q_a.id): 1, str(self.q1.q_b.id): False, str(self.q1.q_c.id): 0}
        keys = list(right)
        return {key: (right if index < correct else wrong)[key] for index, key in enumerate(keys)}

    def test_three_equal_questions_score_in_thirds(self):
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        self.assertEqual(detail['questionCount'], 3)
        self.assertEqual(len(detail['questions']), 3)
        self.assertEqual(detail['totalPoints'], 3)
        for correct, percent in ((0, 0), (1, 33.33), (2, 66.67), (3, 100)):
            response = self.submit(self.q1, self.answers(correct))
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(response.data['questionCount'], 3)
            self.assertEqual(response.data['correctCount'], correct)
            self.assertEqual(response.data['total'], 3)
            self.assertEqual(response.data['score'], correct)
            self.assertAlmostEqual(response.data['percent'], percent)
            self.assertEqual(response.data['passed'], percent >= 50)
            self.assertEqual(len(response.data['review']), 3)

    def test_missing_answers_score_zero_and_keep_the_denominator(self):
        response = self.submit(self.q1, {str(self.q1.q_a.id): 0})
        self.assertEqual((response.data['score'], response.data['total'], response.data['correctCount']), (1, 3, 1))
        self.assertAlmostEqual(response.data['percent'], 33.33)
        empty = self.submit(self.q1, {})
        self.assertEqual((empty.data['score'], empty.data['total'], empty.data['percent']), (0, 3, 0))

    def test_weighted_questions_use_points_not_question_count(self):
        # The model supports per-question points (as in the seeded catalogue: 1, 1 and 2 points).
        self.q1.q_c.points = 2
        self.q1.q_c.save()
        response = self.submit(self.q1, self.answers(1))
        self.assertEqual((response.data['questionCount'], response.data['correctCount']), (3, 1))
        self.assertEqual((response.data['score'], response.data['total']), (1, 4))
        self.assertAlmostEqual(response.data['percent'], 25.0)
        self.assertEqual(self.client.get(f'/api/assessments/{self.q1.id}').data['totalPoints'], 4)

    def test_questions_from_other_quizzes_and_unknown_ids_are_rejected(self):
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        self.assertEqual({q['id'] for q in detail['questions']}, {self.q1.q_a.id, self.q1.q_b.id, self.q1.q_c.id})
        foreign = {**self.answers(3), str(self.q2.q_a.id): 0}
        self.assertEqual(self.submit(self.q1, foreign).status_code, 400)
        self.assertEqual(self.submit(self.q1, {**self.answers(3), '999999': 0}).status_code, 400)
        self.assertFalse(m.Attempt.objects.filter(exam=self.q1).exclude(status='in_progress').exists())

    def test_duplicate_answer_keys_cannot_inflate_the_score(self):
        key = str(self.q1.q_a.id)
        raw = '{"answers": {"%s": 0, "%s": 0, "%s": 0}}' % (key, key, key)
        response = self.submit(self.q1, None, raw=raw)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data['score'], response.data['total']), (1, 3))
        self.assertAlmostEqual(response.data['percent'], 33.33)

    def test_answer_keys_stay_hidden_until_the_attempt_is_finalized(self):
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        started = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').data
        for question in detail['questions'] + started['questions']:
            self.assertFalse(ANSWER_KEY_FIELDS & set(question))
        self.assertNotIn('review', started)
        self.assertNotIn('correctCount', started)
        self.assertNotIn('review', self.client.get(f"/api/attempts/{started['attemptId']}").data)

    def test_latest_best_history_and_pass_status_stay_consistent(self):
        self.submit(self.q1, self.answers(2))
        self.submit(self.q1, self.answers(1))
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        self.assertAlmostEqual(detail['latestPercent'], 33.33)
        self.assertAlmostEqual(detail['bestPercent'], 66.67)
        self.assertTrue(detail['passed'])
        self.assertEqual(detail['attempts'], 2)
        history = self.client.get(f'/api/assessments/{self.q1.id}/history').data
        self.assertEqual([(row['score'], row['total'], row['passed']) for row in history], [(1, 3, False), (2, 3, True)])
        self.assertTrue(m.ChapterProgress.objects.get(student=self.student, chapter=self.m1).completed)

    def test_adding_a_question_later_does_not_change_an_attempt_already_started(self):
        started = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').data
        m.Question.objects.create(exam=self.q1, text='Late?', question_type='single', choices=['a', 'b'], correct=0,
                                  correct_answers=[0], points=1, order=3)
        self.client.put(f"/api/attempts/{started['attemptId']}/answers", {'answers': self.answers(1), 'version': 0}, format='json')
        result = self.client.post(f"/api/attempts/{started['attemptId']}/submit", {}, format='json').data
        self.assertEqual((result['questionCount'], result['total']), (3, 3))
        self.assertAlmostEqual(result['percent'], 33.33)


class QuizOpeningTests(LearningBase):
    def setUp(self):
        super().setUp()
        self.login(self.student)

    def test_valid_quiz_opens_with_no_previous_attempts(self):
        self.enroll()
        detail = self.client.get(f'/api/assessments/{self.q1.id}')
        self.assertEqual(detail.status_code, 200)
        self.assertEqual((detail.data['attempts'], detail.data['activeAttemptId'], detail.data['questionCount']), (0, None, 2))
        self.assertEqual(self.client.get(f'/api/assessments/{self.q1.id}/history').data, [])
        start = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json')
        self.assertEqual(start.status_code, 201)
        self.assertFalse(start.data['resumed'])

    def test_nonexistent_and_unpublished_quizzes_are_404_not_500(self):
        self.enroll()
        for path in ('/api/assessments/999999', '/api/quizzes/999999'):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.client.post('/api/assessments/999999/start', {}, format='json').status_code, 404)
        self.assertEqual(self.client.get('/api/assessments/999999/history').status_code, 404)
        self.q1.status = 'draft'
        self.q1.save()
        self.assertEqual(self.client.get(f'/api/assessments/{self.q1.id}').status_code, 404)
        self.assertEqual(self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').status_code, 403)

    def test_quiz_without_enrollment_is_forbidden(self):
        self.assertEqual(self.client.get(f'/api/assessments/{self.q1.id}').status_code, 403)
        self.assertEqual(self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').status_code, 403)
        self.assertFalse(m.Attempt.objects.exists())

    def test_locked_module_quiz_is_forbidden(self):
        self.enroll()
        self.assertEqual(self.client.get(f'/api/assessments/{self.q2.id}').status_code, 403)
        self.assertEqual(self.client.post(f'/api/assessments/{self.q2.id}/start', {}, format='json').status_code, 403)
        self.assertFalse(m.Attempt.objects.filter(exam=self.q2).exists())

    def test_quiz_opens_after_previous_attempts(self):
        self.enroll()
        self.take(self.q1, {str(self.q1.q_a.id): 1})
        self.take(self.q1, {str(self.q1.q_a.id): 0})
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        self.assertEqual((detail['attempts'], detail['activeAttemptId']), (2, None))
        self.assertEqual(len(self.client.get(f'/api/assessments/{self.q1.id}/history').data), 2)
        start = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json')
        self.assertEqual(start.status_code, 201)

    def test_repeated_start_clicks_resume_one_attempt(self):
        self.enroll()
        responses = [self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json') for _ in range(4)]
        self.assertEqual([r.status_code for r in responses], [201, 200, 200, 200])
        self.assertEqual(len({r.data['attemptId'] for r in responses}), 1)
        self.assertEqual(m.Attempt.objects.filter(student=self.student, exam=self.q1, status='in_progress').count(), 1)

    def test_lost_insert_race_resumes_the_existing_attempt_instead_of_500(self):
        """Simulates the request that loses the race: its lookup saw no active attempt, but another
        request committed one before its insert. Before the fix this raised TransactionManagementError."""
        self.enroll()
        winner = views.create_or_resume_attempt(self.student, self.q1)[0]

        class NoActiveAttemptVisible:
            def __init__(self, *args, **kwargs): pass
            def filter(self, *args, **kwargs): return self
            def first(self): return None

        with patch.object(m.Attempt.objects, 'select_for_update', NoActiveAttemptVisible):
            response = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['attemptId'], winner.id)
        self.assertTrue(response.data['resumed'])

    def test_refresh_and_reopen_resume_the_same_attempt_and_answers(self):
        self.enroll()
        first = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').data
        self.client.put(f"/api/attempts/{first['attemptId']}/answers", {'answers': {str(self.q1.q_a.id): 0}, 'version': 0}, format='json')
        detail = self.client.get(f'/api/assessments/{self.q1.id}').data
        self.assertEqual(detail['activeAttemptId'], first['attemptId'])
        again = self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json')
        self.assertEqual((again.status_code, again.data['attemptId']), (200, first['attemptId']))
        self.assertEqual(again.data['answers'], {str(self.q1.q_a.id): 0})

    def test_expired_session_gets_401_and_creates_nothing(self):
        self.enroll()
        self.client.logout()
        self.assertEqual(self.client.get(f'/api/assessments/{self.q1.id}').status_code, 401)
        self.assertEqual(self.client.post(f'/api/assessments/{self.q1.id}/start', {}, format='json').status_code, 401)
        self.assertFalse(m.Attempt.objects.exists())

    def test_final_exam_double_start_resumes_one_attempt_with_one_deadline(self):
        self.enroll()
        self.take(self.q1, {str(self.q1.q_a.id): 0, str(self.q1.q_b.id): True})
        self.take(self.q2, {str(self.q2.q_a.id): 0, str(self.q2.q_b.id): True})
        self.m3.required = False  # a reading-only module without a quiz must be optional for the final to publish
        self.m3.save()
        first = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json')
        second = self.client.post(f'/api/assessments/{self.final.id}/start', {}, format='json')
        self.assertEqual((first.status_code, second.status_code), (201, 200), first.data)
        self.assertEqual((first.data['attemptId'], first.data['deadline']), (second.data['attemptId'], second.data['deadline']))


class ConcurrentQuizStartTests(TransactionTestCase):
    """Two real concurrent requests on separate PostgreSQL connections (not wrapped in a test transaction)."""

    def setUp(self):
        self.student = m.User.objects.create_user('racer', email='racer@example.com', password='student-pass-123', role='student')
        course = m.Course.objects.create(title='Race course')
        module = m.Chapter.objects.create(course=course, title='Only module', order=0, required=True)
        self.exam = m.Exam.objects.create(title='Race quiz', course=course, module=module, assessment_type='module_quiz', status='published')
        m.Question.objects.create(exam=self.exam, text='Q?', question_type='single', choices=['a', 'b'], correct=0, correct_answers=[0], points=1)
        m.Enrollment.objects.create(student=self.student, course=course)

    def test_simultaneous_starts_return_one_attempt_and_no_server_error(self):
        self.assertEqual(connection.vendor, 'postgresql')
        barrier = threading.Barrier(2, timeout=10)
        local = threading.local()
        real_snapshot = views.snapshot_question

        def snapshot_after_both_checked(question):
            # Runs after the "is there an active attempt?" lookup and before the insert: hold both
            # requests here so both have seen no attempt, which is exactly the losing-race situation.
            if not getattr(local, 'waited', False):
                local.waited = True
                barrier.wait()
            return real_snapshot(question)

        results = []

        def start():
            client = APIClient()
            client.force_authenticate(self.student)
            try:
                response = client.post(f'/api/assessments/{self.exam.id}/start', {}, format='json')
                results.append((response.status_code, response.data.get('attemptId') if hasattr(response, 'data') else None))
            except Exception as error:  # surfaced in the assertion below
                results.append(('error', repr(error)))
            finally:
                connection.close()

        with patch.object(views, 'snapshot_question', snapshot_after_both_checked):
            threads = [threading.Thread(target=start) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(30)
        self.assertEqual(sorted(str(code) for code, _ in results), ['200', '201'], results)
        self.assertEqual(len({attempt for _, attempt in results}), 1, results)
        self.assertEqual(m.Attempt.objects.filter(student=self.student, exam=self.exam).count(), 1)
