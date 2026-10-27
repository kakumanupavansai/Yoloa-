# YOLOA LMS — You Only Learn Once

A full-stack, self-paced Learning Management System (LMS) with separate student and administrator portals. YOLOA enables administrators to create and manage courses, modules, learning resources, quizzes, and final examinations while students learn at their own pace and track their progress.

## Technology Stack

| Component           | Technology                                 | Location           |
| ------------------- | ------------------------------------------ | ------------------ |
| Frontend            | React 18, Vite, Tailwind CSS, React Router | `frontend/`        |
| Backend             | Django 5, Django REST Framework            | `backend/`         |
| Authentication      | Django sessions and CSRF protection        | `backend/`         |
| Database            | PostgreSQL                                 | Database: `yoloa`  |
| Real-time messaging | Django Channels, WebSockets, Redis         | Backend            |
| API testing         | Postman collection and environment         | `backend/postman/` |

**Database requirement:** PostgreSQL is the intended database for this project. Configure the database connection using environment variables before starting the backend.

## Table of Contents

* [Features](#features)
* [Learning Workflow](#learning-workflow)
* [Student Portal](#student-portal)
* [Administrator Portal](#administrator-portal)
* [Authentication and Security](#authentication-and-security)
* [Question Import from Excel](#question-import-from-excel)
* [Technology Requirements](#technology-requirements)
* [Installation and Setup](#installation-and-setup)
* [Real-Time Messaging Setup](#real-time-messaging-setup)
* [Demo Accounts](#demo-accounts)
* [Running Tests](#running-tests)
* [End-to-End Testing](#end-to-end-testing)
* [Scheduled Tasks](#scheduled-tasks)
* [Deployment Checklist](#deployment-checklist)
* [Additional Documentation](#additional-documentation)

## Features

### Student Portal

* Student registration and sign-in.
* Student dashboard with enrolled courses, next modules, quiz performance, examination status, and recent activity.
* Course library with search, category filtering, and enrollment options.
* Course outlines showing locked and unlocked modules.
* Learning resources, including YouTube videos, PDF documents, downloadable files, and external links.
* Module quizzes supporting single-choice, multiple-correct-answer, true/false, and short-answer questions.
* Quiz attempt history with latest and best scores.
* Server-timed final examinations.
* Examination answer autosaving and attempt resumption.
* Learning progress tracking.
* Profile management and Google account linking.
* Password change with current-password verification.
* Private student-to-student messaging with message history, attachments, unread counts, seen receipts, typing indicators, and WebSocket-based real-time delivery.

### Administrator Portal

* Administrator dashboard with activity and learning statistics.
* Course creation, editing, publishing, and deletion.
* Module creation, editing, reordering, and deletion.
* Learning resource management, including uploads and external links.
* Quiz creation and management for individual modules.
* Final examination creation and management.
* Assessment preview and question import from Excel.
* Student enrollment and course-progress tracking.
* Searchable, filterable, sortable, and paginated student directory.
* Student detail pages showing module progress, examination attempts, scores, and sign-in history.
* Audited manual score review.
* Sign-in and examination analytics.
* Announcements.
* Aggregate final-examination monitoring and statistics.

## Learning Workflow

The typical learning workflow is:

1. An administrator creates and publishes a course.
2. The administrator adds ordered modules and learning resources.
3. The administrator creates a quiz for each required module.
4. The administrator creates a final examination for the course.
5. A student registers or signs in and browses the course library.
6. The student enrolls in a course.
7. The student studies the available module resources.
8. The student completes the module quiz.
9. Passing a module quiz unlocks the next module according to the course rules.
10. After all required module quizzes have been passed, the final examination becomes available.
11. The student takes the final examination.
12. The application records the result and updates the student's progress.

### Assessment Rules

* Module quizzes have configurable passing marks, with a default of 50%.
* All required module quizzes must be passed before the final examination unlocks.
* The final examination has a 10-minute time limit (600 seconds).
* The final examination passing threshold is 60%.
* Module quizzes and final examinations allow unlimited attempts.
* Attempt history preserves previous results and displays latest and best scores.
* Final-examination deadlines are controlled by the server.
* Refreshing or reconnecting resumes the existing examination attempt using its original deadline.
* Saved answers are autosaved, and expired attempts are finalized automatically.
* Course completion depends on the configured completion rules and successful final-examination completion.

Assessment eligibility, module unlocking, scoring, deadlines, and completion are enforced by the backend rather than relying solely on frontend checks.

Answer keys are not exposed to students before an attempt has been finalized.

## Student Messaging

YOLOA includes private, one-to-one messaging between students.

Features include:

* Student search.
* Private conversations.
* Real-time message delivery through WebSockets.
* Image and document attachments.
* Unread-message counts.
* Seen receipts.
* Typing indicators.
* Paginated conversation history.
* Recovery of messages sent while the browser was offline.

Messages are stored in PostgreSQL before delivery. Administrators do not have access to student conversations through the application's messaging interface.

**Redis requirement:** Redis supports the Django Channels layer used for real-time delivery. If Redis is unavailable, HTTP messaging may remain available, but immediate delivery to another browser may not work until it reconnects or reloads.

## Authentication and Security

YOLOA uses Django session-based authentication and CSRF protection for browser sessions.

Implemented authentication features include:

* Email-and-password authentication.
* Student registration.
* Google OAuth sign-in for students.
* Google account linking.
* OAuth state, nonce, PKCE, and verified-email checks.
* Password reset with expiring, single-use tokens.
* Password change requiring the current password.
* Separate administrator sign-in.
* Server-side permission checks for protected functionality.

Administrators cannot register themselves through the student registration flow.

Environment variables are used for secrets and configuration. Real credentials must never be committed to the repository.

## Question Import from Excel

Administrators can import assessment questions using an Excel workbook.

### Supported Question Types

* Single-choice questions.
* Multiple-correct-answer questions.
* True/false questions.
* Short-answer questions.

### Import Workflow

1. Open the relevant assessment's editing page.
2. Select the question-import option.
3. Upload an `.xlsx` workbook.
4. Map spreadsheet columns to the corresponding question fields.
5. Review the imported questions and validation errors.
6. Confirm the import only after the preview is valid.

### Validation Rules

* Maximum workbook size: 5 MB.
* The first row contains column headings.
* Column mapping supports common question-field names.
* Options can be separated by `|`, `;`, or `,`.
* Correct answers can be represented by option letters, one-based option numbers, option text, true/false values, or the expected short answer, as appropriate to the question type.
* The server validates every row.
* The preview identifies invalid rows.
* Nothing is imported while validation errors remain.
* Repeated imports are designed to be idempotent.
* Duplicate questions in an assessment are rejected.

The administrator should review the preview and resolve validation errors before confirming an import.

## Technology Requirements

Install the following software before setting up the application:

* Python compatible with the project's backend dependencies.
* Node.js and npm.
* PostgreSQL.
* Redis for real-time messaging.
* Git.
* A supported web browser.

The backend dependencies are listed in `backend/requirements.txt`, and frontend dependencies are defined in `frontend/package.json`.

Check the installed versions:

```powershell
python --version
node --version
npm --version
git --version
```

Also verify that PostgreSQL is running and that the configured database credentials are valid.

## Installation and Setup

The following commands are for Windows PowerShell.

### 1. Clone the Repository

```powershell
git clone https://github.com/kakumanupavansai/Yoloa-.git
cd Yoloa-
```

If you already have the project locally, navigate to its existing directory instead.

### 2. Configure the Backend

Open a PowerShell terminal:

```powershell
cd backend
```

Install the Python dependencies:

```powershell
python -m pip install -r requirements.txt
```

Create your local environment file from the example:

```powershell
Copy-Item .env.example .env
```

Edit `backend/.env` and configure the appropriate values for your local environment, including:

* `DB_NAME`
* `DB_USER`
* `DB_PASSWORD`
* `DB_HOST`
* `DB_PORT`
* `DJANGO_SECRET_KEY`
* Demo-account email and password settings, if used.
* Google OAuth settings, if Google sign-in is enabled.
* SMTP settings, if email functionality is enabled.
* `CHANNEL_REDIS_URL`, if a non-default Redis address is required.

Use the actual variable names expected by the project's settings and `.env.example`. Do not commit the populated `.env` file.

### 3. Create the PostgreSQL Database

Make sure PostgreSQL is running and create the application database if it does not already exist.

For example, connect to PostgreSQL using an authorized account and execute:

```sql
CREATE DATABASE yoloa;
```

If the database already exists, do not create it again.

Configure the backend environment variables to match your PostgreSQL installation.

**Important:** Do not run destructive database commands against a database containing data you need to preserve. Use a separate disposable database for end-to-end tests.

### 4. Apply Backend Migrations

From the `backend/` directory:

```powershell
python manage.py check
python manage.py migrate
```

If you want to populate a fresh development database with the project's demo data, run:

```powershell
python manage.py seed
```

The seed command is intended for demo-data initialization. Review its implementation before using it against an existing database containing important data.

### 5. Start the Backend

From the `backend/` directory:

```powershell
python manage.py runserver 127.0.0.1:8000
```

The backend development server is available at:

`http://127.0.0.1:8000`

Keep this terminal open.

### 6. Configure the Frontend

Open a second PowerShell terminal:

```powershell
cd frontend
```

Install frontend dependencies:

```powershell
npm install
```

Check the normal development environment configuration in `frontend/.env`.

The project uses these frontend settings for local development:

```dotenv
VITE_API_URL=/api
VITE_USE_MOCK=false
```

The Vite configuration proxies `/api` requests and `/ws` WebSocket connections to the backend at `http://127.0.0.1:8000`, unless overridden by `VITE_PROXY_TARGET`.

Do not put private server-side secrets in frontend environment variables. Variables prefixed with `VITE_` can be exposed to browser code.

### 7. Start the Frontend

From the `frontend/` directory:

```powershell
npm run dev
```

Open:

`http://localhost:5173`

**Use `localhost` rather than `127.0.0.1` when accessing the frontend**, because the application uses browser session cookies and Google OAuth state cookies.

Keep both the backend and frontend terminals running while using the application.

## Real-Time Messaging Setup

Real-time messaging requires a working Redis service and a functioning Django Channels configuration.

### 1. Start Redis

Start your existing Redis service using the method appropriate to your installation.

If Redis is running through Docker, verify the existing container rather than creating a duplicate container unnecessarily.

### 2. Check the Redis Connection

From the `backend/` directory:

```powershell
python manage.py check_redis
```

This command checks Redis connectivity and the Channels layer.

If the check fails, verify the Redis service, `CHANNEL_REDIS_URL`, and the backend's Redis configuration.

### 3. Start Django

If the project is configured to use Daphne through its Django development-server integration, start it using:

```powershell
python manage.py runserver 127.0.0.1:8000
```

Otherwise, if the project is configured for direct Daphne startup, use:

```powershell
daphne -b 127.0.0.1 -p 8000 config.asgi:application
```

Use the startup method supported by the installed project configuration.

### 4. Start Vite

In the frontend terminal:

```powershell
npm run dev
```

### 5. Test Messaging

1. Sign in as one student in a normal browser window.
2. Sign in as a different student in a private browser window.
3. Open the messaging interface.
4. Search for the other student.
5. Send messages and attachments in both directions.
6. Verify that messages, unread counts, and seen receipts behave as expected.

## Demo Accounts

The project includes a backend seed command intended to initialize demonstration data:

```powershell
python manage.py seed
```

The configured demonstration administrator and student accounts use the email and password settings specified in the backend environment.

Set the demo-account variables expected by the project's settings and seed implementation, such as:

* `DEMO_ADMIN_EMAIL`
* `DEMO_ADMIN_PASSWORD`
* `DEMO_STUDENT_EMAIL`
* `DEMO_STUDENT_PASSWORD`

Use the exact variable names and requirements defined by the current backend implementation.

The documented demo course catalogue includes:

* Python Programming Fundamentals.
* Web Development with HTML & CSS.
* Data Structures Essentials.
* Cloud Computing Basics as an unpublished draft example.

The seeded catalogue is intended to demonstrate course publishing, module quizzes, and final examinations. The actual data available depends on the seed implementation and the current database contents.

Do not assume that a particular demo password works unless it has been configured in your local environment.

## Running Tests

Run tests from the appropriate project directories.

### Backend Tests

From `backend/`:

```powershell
python manage.py check
python manage.py test --verbosity 2
```

The backend test suite covers application behavior, including authentication, assessments, rate limiting, and learning workflows.

The tests may create and destroy a separate Django test database. Confirm the database configuration and test settings before running them against an environment containing important data.

### Frontend Tests

From `frontend/`:

```powershell
npm test
```

The test command uses Vitest.

The test environment can use mock or fixture configuration from `.env.test`. Ensure that test-mode settings do not accidentally affect normal application development.

### Production Build

From `frontend/`:

```powershell
npm run build
```

The production build output is generated in `frontend/dist/`.

To preview the build locally:

```powershell
npm run preview
```

The preview command is for local inspection and is not, by itself, a complete production deployment.

## End-to-End Testing

End-to-end tests may create users, enrollments, assessment attempts, and other database records. Run them only against a database explicitly designated for disposable test data.

**Never use your primary development database or a database containing important user data as an end-to-end test database.**

Before executing the end-to-end suite:

1. Create or select a dedicated disposable PostgreSQL database.
2. Verify the active database connection.
3. Confirm that the test configuration uses that database.
4. Set the test environment variables required by the integration suite.
5. Run the tests.
6. Verify that the test configuration has not affected another database.

The documented integration suite is located at:

`frontend/src/__tests__/integration.test.jsx`

Review the current integration-test configuration and required environment variables before executing it. Do not copy commands that point to a database unless you have verified that the database is disposable.

## Scheduled Tasks

The backend provides a management command for finalizing expired examination attempts:

```powershell
python manage.py finalize_expired_attempts
```

In environments where the command is required as a periodic backstop, schedule it using Windows Task Scheduler or an equivalent scheduling service.

The command should run with the correct backend environment and database configuration. Review the command's behavior before scheduling it in production.

Expired attempts may also be finalized automatically when a related request is processed, according to the backend implementation.

## Deployment Checklist

Before deploying YOLOA to a production environment, verify the following.

### Application Configuration

* Use a strong, unique `DJANGO_SECRET_KEY`.
* Set `DJANGO_DEBUG=False`.
* Configure `DJANGO_ALLOWED_HOSTS` for the deployment.
* Configure the production PostgreSQL connection.
* Store secrets securely outside the repository.
* Configure real email delivery if password reset and email notifications require it.
* Configure the production Google OAuth client and redirect URI if Google sign-in is enabled.

### Network and Browser Security

* Serve the application over HTTPS.
* Configure secure session cookies.
* Configure secure CSRF cookies.
* Verify trusted origins and CSRF settings.
* Restrict database and Redis access to authorized services.
* Confirm that authentication and authorization checks are enforced by the backend.

### Storage and Media

* Configure persistent storage for uploaded media.
* Review access controls for `backend/media/`.
* Keep private course resources in `backend/private_media/` protected from direct public access.
* Verify that private files are delivered only after the appropriate authorization checks.

### Production Operations

* Apply database migrations through a controlled deployment process.
* Build and serve the production frontend.
* Configure the ASGI server and WebSocket routing.
* Configure Redis and Django Channels where real-time messaging is required.
* Configure scheduled examination-cleanup tasks if needed.
* Establish database backups and test restoration procedures.
* Monitor application errors, database health, and service availability.

## Additional Documentation

For more implementation and configuration details, consult:

* `backend/README.md` — backend setup and implementation notes.
* `backend/requirements.txt` — Python dependencies.
* `frontend/package.json` — frontend dependencies and scripts.
* `frontend/vite.config.js` — development server and proxy configuration.
* `backend/lms/migrations/` — database migrations.
* `frontend/src/__tests__/` — frontend tests, including integration tests.

## Project Status

YOLOA is a full-stack learning management application designed to support course administration, student learning, assessments, progress tracking, and private messaging.

For the most accurate setup instructions, use the configuration files and implementation present in the current repository. Features that depend on external services, credentials, or deployment configuration must be configured and verified in the target environment before use.
