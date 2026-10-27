import os

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.files.storage import FileSystemStorage
from django.db import models
from django.db.models import Q


class PrivateFileStorage(FileSystemStorage):
    """Stores files under PRIVATE_MEDIA_ROOT, which is never exposed as a public URL.

    The location is read at access time so tests can redirect uploads with override_settings.
    """
    @property
    def base_location(self):
        return str(settings.PRIVATE_MEDIA_ROOT)

    @property
    def location(self):
        return os.path.abspath(self.base_location)


def private_storage():
    """Resource files are stored outside MEDIA_ROOT and only streamed after a permission check."""
    return PrivateFileStorage()


class User(AbstractUser):
    ROLES = [('student', 'Student'), ('admin', 'Admin')]
    role = models.CharField(max_length=10, choices=ROLES, default='student')
    auth_token_version = models.PositiveIntegerField(default=0, editable=False)
    google_sub = models.CharField(max_length=255, blank=True, default='')
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)
    address = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    country = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)

    class Meta(AbstractUser.Meta):
        constraints = [models.UniqueConstraint(fields=['google_sub'], condition=~Q(google_sub=''), name='unique_google_subject')]

    @property
    def display_name(self):
        return f'{self.first_name} {self.last_name}'.strip() or self.username


class Course(models.Model):
    LEVELS = [('Beginner', 'Beginner'), ('Intermediate', 'Intermediate'), ('Advanced', 'Advanced')]
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=80, blank=True, default='General')
    level = models.CharField(max_length=20, choices=LEVELS, default='Beginner')
    # Unpublished courses are hidden from the student catalogue; enrolled students keep access.
    is_published = models.BooleanField(default=True)
    cover = models.ImageField(upload_to='courses/', blank=True, null=True)
    enrollment_label = models.CharField(max_length=100, default='Continous enrollement')
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    professor = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='taught_courses')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL, related_name='created_courses')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return self.title


class Chapter(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='chapters')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.PositiveIntegerField(default=0)
    video_url = models.URLField(blank=True)
    duration = models.CharField(max_length=50, blank=True, default='')
    # Required modules gate the next module and the final exam through their module quiz.
    # Optional modules never become hidden prerequisites.
    required = models.BooleanField(default=True)

    class Meta:
        ordering = ['order', 'id']


class CourseContent(models.Model):
    """A learning resource. `chapter` set = module resource; blank = course-level material."""
    COLORS = [('green', 'green'), ('pink', 'pink'), ('blue', 'blue'), ('yellow', 'yellow')]
    RESOURCE_TYPES = [('document', 'PDF / document'), ('presentation', 'Presentation'), ('video', 'YouTube video'),
                      ('link', 'External link'), ('text', 'Text note')]
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='contents')
    chapter = models.ForeignKey(Chapter, null=True, blank=True, on_delete=models.CASCADE, related_name='resources')
    resource_type = models.CharField(max_length=20, choices=RESOURCE_TYPES, default='text')
    title = models.CharField(max_length=200)
    text = models.TextField(blank=True)
    url = models.URLField(blank=True, max_length=500)
    color = models.CharField(max_length=10, choices=COLORS, default='blue')
    file = models.FileField(upload_to='course_files/', storage=private_storage, blank=True, null=True)
    original_name = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    class Meta:
        ordering = ['order', 'id']


class Enrollment(models.Model):
    STATUS = [('ongoing', 'Ongoing'), ('completed', 'Completed')]
    COMPLETION_SOURCES = [('final_exam', 'Final exam'), ('legacy', 'Legacy completion')]
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='enrollments')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='enrollments')
    status = models.CharField(max_length=10, choices=STATUS, default='ongoing')
    percent = models.PositiveIntegerField(default=0)
    current_chapter = models.CharField(max_length=100, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completion_source = models.CharField(max_length=20, choices=COMPLETION_SOURCES, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['student', 'course'], name='unique_student_course_enrollment')]


class ChapterProgress(models.Model):
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='chapter_progress')
    chapter = models.ForeignKey(Chapter, on_delete=models.CASCADE, related_name='progress')
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['student', 'chapter'], name='unique_student_chapter_progress')]


class Exam(models.Model):
    """A reusable assessment definition. Questions and attempts remain separate records."""
    STATUS = [('draft', 'Draft'), ('published', 'Published')]
    ASSESSMENT_TYPES = [('legacy_quiz', 'Legacy quiz'), ('module_quiz', 'Module quiz'), ('final_exam', 'Final exam')]
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100, blank=True)
    term = models.CharField(max_length=50, blank=True, default='1st Term')
    duration = models.CharField(max_length=50, blank=True)
    # The final-exam value is enforced to 600 by the API, rather than trusting duration text.
    duration_seconds = models.PositiveIntegerField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS, default='draft')
    # Module quizzes default to a 50% pass mark (configurable per quiz); finals are always 60%.
    pass_percent = models.PositiveSmallIntegerField(default=50)
    assessment_type = models.CharField(max_length=20, choices=ASSESSMENT_TYPES, default='legacy_quiz')
    course = models.ForeignKey(Course, null=True, blank=True, on_delete=models.SET_NULL, related_name='exams')
    module = models.ForeignKey(Chapter, null=True, blank=True, on_delete=models.SET_NULL, related_name='assessments')
    created_by = models.ForeignKey(User, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['id']
        constraints = [
            models.UniqueConstraint(fields=['course', 'module'], condition=Q(assessment_type='module_quiz'), name='one_module_quiz_per_module'),
            models.UniqueConstraint(fields=['course'], condition=Q(assessment_type='final_exam'), name='one_final_exam_per_course'),
        ]


class Question(models.Model):
    QUESTION_TYPES = [('single', 'Single-answer MCQ'), ('multiple', 'Multiple-correct MCQ'), ('true_false', 'True / false'), ('short', 'Short answer')]
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='questions')
    text = models.TextField()
    question_type = models.CharField(max_length=20, choices=QUESTION_TYPES, default='single')
    choices = models.JSONField(default=list)
    # `correct` is retained for legacy single-choice data; all new types use these fields.
    correct = models.PositiveSmallIntegerField(default=0)
    correct_answers = models.JSONField(default=list)
    expected_answer = models.TextField(blank=True)
    accepted_answers = models.JSONField(default=list)
    normalization = models.JSONField(default=dict)
    score = models.PositiveIntegerField(default=0)
    points = models.PositiveIntegerField(default=1)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['order', 'id']


class Attempt(models.Model):
    STATUS = [('in_progress', 'In progress'), ('submitted', 'Submitted'), ('expired', 'Expired')]
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='attempts')
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name='attempts')
    answers = models.JSONField(default=dict)
    # Snapshots preserve review/history if an administrator later edits questions.
    question_snapshot = models.JSONField(default=list)
    course_snapshot = models.JSONField(default=dict)
    score = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    auto_score = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    total_points = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    percentage = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    passed = models.BooleanField(default=False)
    status = models.CharField(max_length=20, choices=STATUS, default='in_progress')
    started_at = models.DateTimeField(null=True, blank=True)
    deadline_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    answer_version = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.UniqueConstraint(fields=['student', 'exam'], condition=Q(status='in_progress'), name='one_active_attempt_per_assessment')]


class GradingReview(models.Model):
    attempt = models.ForeignKey(Attempt, on_delete=models.PROTECT, related_name='grading_reviews')
    reviewer = models.ForeignKey(User, on_delete=models.PROTECT, related_name='grading_reviews')
    original_score = models.DecimalField(max_digits=8, decimal_places=2)
    revised_score = models.DecimalField(max_digits=8, decimal_places=2)
    reason = models.TextField()
    adjustments = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class LoginEvent(models.Model):
    EVENT_TYPES = [('login', 'Credential login'), ('refresh', 'Token refresh')]
    AUTH_METHODS = [('email_password', 'Email and password'), ('google', 'Google'),
                    ('legacy_jwt', 'Legacy JWT client'), ('', 'Legacy / unspecified')]
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='login_events')
    event_type = models.CharField(max_length=10, choices=EVENT_TYPES)
    auth_method = models.CharField(max_length=20, choices=AUTH_METHODS, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['event_type', 'created_at']), models.Index(fields=['user', 'created_at'])]


class QuestionImportBatch(models.Model):
    """Admin-only staging data. Preview never creates Question rows."""
    STATUS = [('uploaded', 'Uploaded'), ('previewed', 'Previewed'), ('imported', 'Imported')]
    public_id = models.CharField(max_length=64, unique=True)
    admin = models.ForeignKey(User, on_delete=models.PROTECT, related_name='question_imports')
    exam = models.ForeignKey(Exam, on_delete=models.PROTECT, related_name='import_batches')
    workbook = models.JSONField(default=dict)
    mapping = models.JSONField(default=dict)
    validation = models.JSONField(default=dict)
    status = models.CharField(max_length=12, choices=STATUS, default='uploaded')
    idempotency_key = models.CharField(max_length=128, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class LibraryItem(models.Model):
    title = models.CharField(max_length=200)
    subject = models.CharField(max_length=100)
    cover = models.ImageField(upload_to='library/covers/', blank=True, null=True)
    file = models.FileField(upload_to='library/files/', blank=True, null=True)

    class Meta:
        ordering = ['id']


class Announcement(models.Model):
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='announcements')
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class CalendarEvent(models.Model):
    TYPES = [('event', 'Event'), ('deadline', 'Deadline')]
    user = models.ForeignKey(User, null=True, blank=True, on_delete=models.CASCADE, help_text='null = visible to everyone')
    date = models.DateField()
    time = models.CharField(max_length=20, blank=True)
    title = models.CharField(max_length=200)
    type = models.CharField(max_length=10, choices=TYPES, default='event')

    class Meta:
        ordering = ['date', 'id']


class ScheduleItem(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='schedule')
    subject = models.CharField(max_length=100)
    done = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField(default=20)
    time = models.CharField(max_length=30)

    class Meta:
        ordering = ['id']


class Assignment(models.Model):
    student = models.ForeignKey(User, on_delete=models.CASCADE, related_name='assignments')
    subject = models.CharField(max_length=100)
    chapter = models.CharField(max_length=100, blank=True)
    title = models.CharField(max_length=200)
    page = models.CharField(max_length=50, blank=True)
    due_time = models.CharField(max_length=20, blank=True)
    status = models.CharField(max_length=20, default='Pending')
