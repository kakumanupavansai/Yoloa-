"""Create fresh, repeatable YOLOA demonstration data.

Safe to re-run: every record is looked up by a natural key first, so running the command twice
never duplicates users, courses, modules, resources, quizzes or questions, and it never touches
student attempts or progress. Passwords come from DEMO_ADMIN_PASSWORD / DEMO_STUDENT_PASSWORD in
backend/.env (git-ignored); nothing secret is stored in this file and passwords are never printed.
"""
import os

from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from lms import models as m
from lms.views import question_data, recalc_enrollment

YT_PYTHON = 'https://www.youtube.com/watch?v=rfscVS0vtbw'
YT_WEB = 'https://www.youtube.com/watch?v=mU6anWqZJcc'
YT_DSA = 'https://www.youtube.com/watch?v=RBSGKlAvoiM'


def single(text, choices, correct, points=1):
    return {'questionType': 'single', 'text': text, 'choices': choices, 'correct': correct, 'points': points}


def multiple(text, choices, correct, points=2):
    return {'questionType': 'multiple', 'text': text, 'choices': choices, 'correctAnswers': correct, 'points': points}


def true_false(text, answer, points=1):
    return {'questionType': 'true_false', 'text': text, 'correct': 'true' if answer else 'false', 'points': points}


def short(text, expected, alternatives=(), points=2):
    return {'questionType': 'short', 'text': text, 'expectedAnswer': expected, 'acceptedAlternatives': list(alternatives),
            'points': points, 'normalization': {'caseInsensitive': True, 'ignorePunctuation': True}}


def simple_pdf(title, lines):
    """A small, valid single-page PDF so the document viewer can be demonstrated without external files."""
    def esc(value):
        return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')
    text = ['BT', '/F1 20 Tf', '72 740 Td', f'({esc(title)}) Tj', '/F1 12 Tf', '0 -34 Td']
    for line in lines:
        text += [f'({esc(line)}) Tj', '0 -18 Td']
    text.append('ET')
    stream = '\n'.join(text).encode('latin-1')
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    output = bytearray(b'%PDF-1.4\n')
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output += f'{number} 0 obj\n'.encode() + body + b'\nendobj\n'
    xref = len(output)
    output += f'xref\n0 {len(objects) + 1}\n0000000000 65535 f \n'.encode()
    for offset in offsets:
        output += f'{offset:010d} 00000 n \n'.encode()
    output += f'trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return bytes(output)


CATALOGUE = [
    {
        'title': 'Python Programming Fundamentals', 'category': 'Programming', 'level': 'Beginner', 'published': True,
        'description': 'Learn to write clear Python programs: values and variables, decisions and loops, and reusable functions. '
                       'Each module ends with a short quiz; pass them all to unlock the final examination.',
        'modules': [
            {'title': 'Getting started with Python', 'duration': '45 mins',
             'description': 'Install Python, run your first script and understand values, variables and types.',
             'resources': [
                 {'type': 'video', 'title': 'Python for beginners (video course)', 'url': YT_PYTHON},
                 {'type': 'document', 'title': 'Module 1 study notes (PDF)', 'pdf': ('Getting started with Python', [
                     'Python is an interpreted, general-purpose language.', 'Variables name values: count = 3',
                     'Core types: int, float, str, bool, list, dict.', 'Use print() to show output and type() to inspect values.'])},
                 {'type': 'link', 'title': 'Official Python tutorial', 'url': 'https://docs.python.org/3/tutorial/'},
             ],
             'quiz': [
                 single('Which function displays output in Python?', ['echo()', 'print()', 'write()', 'show()'], 1),
                 true_false('Python variables must declare their type before use.', False),
                 multiple('Which of these are built-in Python types?', ['int', 'char', 'list', 'dict'], [0, 2, 3]),
                 short('Which built-in function returns the type of a value?', 'type', ['type()']),
             ]},
            {'title': 'Control flow', 'duration': '1 hr',
             'description': 'Make decisions with if/elif/else and repeat work with for and while loops.',
             'resources': [
                 {'type': 'link', 'title': 'More control flow tools', 'url': 'https://docs.python.org/3/tutorial/controlflow.html'},
                 {'type': 'text', 'title': 'Key idea', 'text': 'Indentation defines blocks in Python. A for loop iterates over any iterable, '
                                                               'and range(n) produces 0 … n-1.'},
             ],
             'quiz': [
                 single('What does range(3) produce?', ['1, 2, 3', '0, 1, 2', '0, 1, 2, 3', '3'], 1),
                 true_false('An elif branch runs only when every earlier condition is false.', True),
                 single('Which keyword exits a loop immediately?', ['stop', 'exit', 'break', 'return'], 2),
                 multiple('Which statements create a loop?', ['for', 'while', 'if', 'loop'], [0, 1]),
             ]},
            {'title': 'Functions', 'duration': '1 hr',
             'description': 'Package logic into functions with parameters, return values and default arguments.',
             'resources': [
                 {'type': 'link', 'title': 'Defining functions', 'url': 'https://docs.python.org/3/tutorial/controlflow.html#defining-functions'},
             ],
             'quiz': [
                 single('Which keyword defines a function?', ['func', 'def', 'function', 'lambda'], 1),
                 true_false('A function without a return statement returns None.', True),
                 short('What keyword sends a value back from a function?', 'return'),
             ]},
        ],
        'final': [
            single('What is the result of 7 // 2 in Python 3?', ['3.5', '3', '4', '2'], 1, 2),
            single('Which collection type is immutable?', ['list', 'dict', 'tuple', 'set'], 2, 2),
            true_false('Strings in Python can be indexed like lists.', True, 2),
            multiple('Which are valid ways to loop over a list `items`?', ['for x in items:', 'for (x in items)', 'while items:', 'foreach x in items'], [0, 2], 2),
            short('Which built-in returns the number of items in a list?', 'len', ['len()'], 2),
            single('What does a function return when it has no return statement?', ['0', 'False', 'None', 'An error'], 2, 2),
        ],
    },
    {
        'title': 'Web Development with HTML & CSS', 'category': 'Web Development', 'level': 'Beginner', 'published': True,
        'description': 'Build and style accessible web pages: semantic HTML, the box model and responsive layouts with Flexbox.',
        'modules': [
            {'title': 'Semantic HTML', 'duration': '50 mins',
             'description': 'Structure documents with headings, landmarks, lists, links and forms.',
             'resources': [
                 {'type': 'video', 'title': 'HTML & CSS full course (video)', 'url': YT_WEB},
                 {'type': 'link', 'title': 'MDN: HTML basics', 'url': 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Getting_started/Your_first_website/Creating_the_content'},
             ],
             'quiz': [
                 single('Which element marks the main content of a page?', ['<section>', '<main>', '<body>', '<content>'], 1),
                 true_false('Every <img> should have an alt attribute.', True),
                 multiple('Which elements are landmarks?', ['<nav>', '<header>', '<span>', '<footer>'], [0, 1, 3]),
             ]},
            {'title': 'CSS fundamentals', 'duration': '1 hr',
             'description': 'Selectors, the cascade, specificity and the box model.',
             'resources': [
                 {'type': 'link', 'title': 'MDN: CSS styling basics', 'url': 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics'},
                 {'type': 'document', 'title': 'Box model cheat sheet (PDF)', 'pdf': ('The CSS box model', [
                     'Every element is a box: content, padding, border, margin.', 'box-sizing: border-box includes padding and border in width.',
                     'Margins collapse vertically between block elements.'])},
             ],
             'quiz': [
                 single('Which property adds space inside an element\'s border?', ['margin', 'padding', 'gap', 'outline'], 1),
                 true_false('An ID selector is more specific than a class selector.', True),
                 short('Which CSS property changes text colour?', 'color'),
             ]},
            {'title': 'Responsive layouts', 'duration': '1 hr 15 mins', 'required': False,
             'description': 'Optional extension: Flexbox and media queries for layouts that work on every screen.',
             'resources': [
                 {'type': 'link', 'title': 'MDN: Flexbox', 'url': 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/CSS_layout/Flexbox'},
             ]},
        ],
        'final': [
            single('Which HTML element is used for the largest heading?', ['<h6>', '<head>', '<h1>', '<header>'], 2, 2),
            true_false('CSS stands for Cascading Style Sheets.', True, 2),
            multiple('Which values are valid for display?', ['flex', 'grid', 'center', 'block'], [0, 1, 3], 2),
            single('Which unit is relative to the root font size?', ['em', 'px', 'rem', 'vh'], 2, 2),
            short('Which property makes a flex container wrap its items? (property name)', 'flex-wrap', points=2),
        ],
    },
    {
        'title': 'Data Structures Essentials', 'category': 'Computer Science', 'level': 'Intermediate', 'published': True,
        'description': 'Understand arrays, linked lists, stacks and queues, and how to reason about their performance.',
        'modules': [
            {'title': 'Arrays and complexity', 'duration': '1 hr',
             'description': 'Big-O notation and the cost of common array operations.',
             'resources': [{'type': 'video', 'title': 'Data structures course (video)', 'url': YT_DSA}],
             'quiz': [
                 single('What is the time complexity of reading array[i]?', ['O(1)', 'O(log n)', 'O(n)', 'O(n²)'], 0),
                 true_false('Inserting at the start of an array is O(1).', False),
             ]},
            {'title': 'Stacks and queues', 'duration': '1 hr',
             'description': 'LIFO and FIFO structures and where they are used.',
             'resources': [{'type': 'text', 'title': 'Remember', 'text': 'Stack = last in, first out (push/pop). Queue = first in, first out (enqueue/dequeue).'}],
             'quiz': [
                 single('Which structure is LIFO?', ['Queue', 'Stack', 'Heap', 'Tree'], 1),
                 multiple('Which operations belong to a queue?', ['enqueue', 'dequeue', 'push', 'peek'], [0, 1, 3]),
             ]},
        ],
        'final': [
            single('Which structure gives O(1) average lookup by key?', ['Array', 'Hash table', 'Linked list', 'Stack'], 1, 2),
            true_false('A queue processes items in first-in, first-out order.', True, 2),
            single('Binary search requires the data to be…', ['Hashed', 'Sorted', 'Unique', 'Linked'], 1, 2),
        ],
    },
    {
        'title': 'Cloud Computing Basics', 'category': 'Cloud', 'level': 'Beginner', 'published': False,
        'description': 'Draft course (unpublished): service models, regions and shared responsibility.',
        'modules': [{'title': 'What is the cloud?', 'duration': '30 mins', 'description': 'IaaS, PaaS and SaaS explained.',
                     'resources': [{'type': 'text', 'title': 'Draft notes', 'text': 'Outline in progress.'}]}],
    },
]


class Command(BaseCommand):
    help = 'Create fresh YOLOA demo data on the configured PostgreSQL database. Safe to re-run.'

    def add_arguments(self, parser):
        parser.add_argument('--reset-passwords', action='store_true', help='Re-apply the demo passwords from .env to existing demo accounts.')

    def handle(self, *args, **options):
        if connection.vendor != 'postgresql':
            raise CommandError(f'Refusing to seed: the configured database is {connection.vendor}, not PostgreSQL.')
        admin_email = os.getenv('DEMO_ADMIN_EMAIL', 'admin@yoloa.local').strip().lower()
        student_email = os.getenv('DEMO_STUDENT_EMAIL', 'student@yoloa.local').strip().lower()
        admin_password, student_password = os.getenv('DEMO_ADMIN_PASSWORD', ''), os.getenv('DEMO_STUDENT_PASSWORD', '')
        if len(admin_password) < 10 or len(student_password) < 10:
            raise CommandError('Set DEMO_ADMIN_PASSWORD and DEMO_STUDENT_PASSWORD (10+ characters) in backend/.env before seeding.')
        with transaction.atomic():
            admin = self.user(admin_email, 'admin', 'YOLOA', 'Administrator', 'admin', admin_password, options['reset_passwords'])
            self.user(student_email, 'demo.student', 'Demo', 'Student', 'student', student_password, options['reset_passwords'])
            counts = {'courses': 0, 'modules': 0, 'resources': 0, 'quizzes': 0, 'questions': 0}
            for spec in CATALOGUE:
                self.course(spec, admin, counts)
        for enrollment in m.Enrollment.objects.select_related('student', 'course'):
            recalc_enrollment(enrollment)
        self.stdout.write(self.style.SUCCESS(
            'Seed complete on PostgreSQL database "{db}". New records: {courses} courses, {modules} modules, {resources} resources, '
            '{quizzes} assessments, {questions} questions.'.format(db=connection.settings_dict['NAME'], **counts)))
        self.stdout.write(f'Demo sign-in emails: {admin_email} (admin portal) and {student_email} (student portal). '
                          'Passwords are the DEMO_* values in backend/.env.')

    def user(self, email, username, first, last, role, password, reset):
        user = m.User.objects.filter(email__iexact=email).first()
        created = user is None
        if created:
            user = m.User(email=email, username=username, first_name=first, last_name=last, role=role,
                          is_staff=role == 'admin', is_superuser=role == 'admin')
        elif user.role != role:
            raise CommandError(f'{email} already exists with role {user.role}; refusing to change it.')
        if created or reset:
            user.set_password(password)
            user.save()
        return user

    def course(self, spec, admin, counts):
        course, created = m.Course.objects.get_or_create(title=spec['title'], defaults={
            'description': spec['description'], 'category': spec['category'], 'level': spec['level'],
            'is_published': spec['published'], 'professor': admin, 'created_by': admin})
        counts['courses'] += created
        for index, module_spec in enumerate(spec['modules']):
            chapter, created = m.Chapter.objects.get_or_create(course=course, title=module_spec['title'], defaults={
                'description': module_spec.get('description', ''), 'duration': module_spec.get('duration', ''),
                'order': index, 'required': module_spec.get('required', True)})
            counts['modules'] += created
            for order, resource in enumerate(module_spec.get('resources', [])):
                if m.CourseContent.objects.filter(chapter=chapter, title=resource['title']).exists():
                    continue
                item = m.CourseContent(course=course, chapter=chapter, title=resource['title'], resource_type=resource['type'],
                                       url=resource.get('url', ''), text=resource.get('text', ''), order=order)
                if 'pdf' in resource:
                    name = f"{chapter.title.lower().replace(' ', '-')}-notes.pdf"
                    item.original_name = name
                    item.file.save(name, ContentFile(simple_pdf(*resource['pdf'])), save=False)
                item.save()
                counts['resources'] += 1
            if module_spec.get('quiz'):
                self.assessment(course, chapter, f'{chapter.title} quiz', 'module_quiz', module_spec['quiz'], admin, counts)
        if spec.get('final'):
            self.assessment(course, None, f'{course.title} — final examination', 'final_exam', spec['final'], admin, counts)

    def assessment(self, course, chapter, title, kind, questions, admin, counts):
        lookup = {'course': course, 'assessment_type': kind}
        if chapter:
            lookup['module'] = chapter
        exam = m.Exam.objects.filter(**lookup).first()
        if not exam:
            exam = m.Exam.objects.create(title=title, subject=course.category, status='draft', created_by=admin,
                                         duration='10 mins' if kind == 'final_exam' else '', pass_percent=60 if kind == 'final_exam' else 50,
                                         duration_seconds=600 if kind == 'final_exam' else None, **lookup)
            counts['quizzes'] += 1
        if not exam.questions.exists() and not exam.attempts.exists():
            validated = [question_data(question, index) for index, question in enumerate(questions)]
            m.Question.objects.bulk_create([m.Question(exam=exam, **question) for question in validated])
            counts['questions'] += len(validated)
        if exam.status != 'published':
            exam.status = 'published'
            exam.save(update_fields=['status'])
