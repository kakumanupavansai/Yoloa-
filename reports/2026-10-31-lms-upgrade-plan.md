# YOLOA LMS upgrade — inspection and implementation plan (2026-10-31)

## What already exists (inspected, not assumed)

| Area | Where | Finding |
|---|---|---|
| Private 1:1 chat | `backend/messaging` (Conversation, ConversationMember, Message, MessageAttachment), `/api/messages/*`, WebSocket `/ws/messages/`, `frontend/src/pages/student/Messages.jsx`, `components/messaging/ChatThread.jsx`, `context/MessagingContext.jsx` | Complete: searchable student list, start conversation, text + images + PDF/Office/TXT/CSV files (content-checked, 10 MB), timestamps, history paging, read receipts, typing, offline sync, per-member authorization, Redis broadcast after commit. **Missing: clickable links in message text.** |
| Public feed | — | Does not exist. |
| Quiz model | `lms.Exam` (module_quiz / final_exam / legacy_quiz), `lms.Question` (choices JSON, correct_answers…), `lms.Attempt` (question_snapshot JSON) | `save_exam()` **deletes and re-creates every Question on each save**, so images cannot live on Question rows alone. No explanation field exists. Attempts snapshot questions, so history survives edits. |
| Quiz delete | `DELETE /api/exams/<id>` | Exists; refuses (409) when attempts exist, because `Attempt.exam` is `on_delete=PROTECT`. No UI uses it from the quiz editor. Does not refresh enrollment percentages. |
| Assessments page | `pages/admin/Exams.jsx`, route `/admin/exams`, nav "Assessments" | Only consumer of `GET /api/exams` list besides the Question Import page. `QuizEditor` (routes `/admin/exams/new`, `/admin/exams/:id`) and `/api/exams/<id>` are shared and must stay. Database has 0 legacy quizzes, so nothing becomes unreachable. |
| Question import | `pages/admin/QuestionImport.jsx`, `components/admin/QuestionImportPanel.jsx`, `/api/admin/question-imports/*` | Import needs a saved exam id. In the editor the button is `disabled={!existing}`, so a brand-new quiz (always the case for a new module's first quiz) cannot import. |
| Sign-in log | `pages/admin/Analytics.jsx` (nav "Analytics") + `/api/admin/analytics/logins`, `/exams` | Page is a sign-in table plus final-exam counters. Per-student history already in `GET /api/admin/students/<id>` (`loginHistory`). |
| Student details | `pages/admin/StudentDetail.jsx` | Two-column grid (320 px profile column + content); attempt table sits in the right column. |
| Student progress | `GET /api/student/progress`, `pages/student/Progress.jsx` | Per-course module table only; no charts. Data is derived from the session user only. |
| Theme | `tailwind.config.js` hex colours, `index.css` component classes | 24 `bg-white` + a few `gray-*` usages; no dark mode. |
| Charts | — | No chart library installed. |

## Decisions where the request meets the architecture

1. **Deleting a quiz with attempts.** `Attempt.exam` is `PROTECT` and attempts are student records. Deleting would require deleting those records. Safe implementation: the delete button is always shown; quizzes **without** attempts are deleted (questions and import staging go with them, the module and course are untouched, enrollment percentages are recalculated); quizzes **with** attempts are refused by the server with a clear explanation, and the dialog offers "Move to draft" instead. No student history is destroyed.
2. **Quiz images.** New `QuizImage` table (private storage, Pillow-verified JPEG/PNG/GIF/WEBP, 5 MB). Questions reference images by id (`image`, `choice_images`, `explanation_image`), so the editor's delete-and-recreate save keeps them. Attempt snapshots copy the ids, so history keeps its images. Images are streamed only after a permission check (admin; or a student who can see that quiz or has it in an attempt; explanation images only after the attempt is finalized). A new optional `explanation` text is added and shown in the post-submit review.
3. **Assessments removal.** Remove the page, nav entry and list route only; `/admin/exams` redirects to Courses. All backend endpoints stay (shared with the quiz editor and tests).
4. **Sign-in Log removal.** The page is replaced by an analytics dashboard backed by a new `GET /api/admin/analytics/overview`; the old endpoints stay (API compatibility, tests).
5. **Charts.** Small SVG chart components in-house (line, bar, donut, histogram) themed by CSS variables, instead of adding a charting dependency.
6. **Theme persistence.** Stored per browser (localStorage) and applied before first paint; respects the OS preference until the user chooses.
7. **Public feed access.** Students only (same rule as messaging). Authors can delete their own posts. Admin moderation is not in scope.

## Database migrations (additive only, reviewed before applying)

- `lms 0008`: `QuizImage` table; `Question.image` (FK, nullable, SET_NULL), `Question.choice_images` (JSON list, default `[]`), `Question.explanation` (text, blank), `Question.explanation_image` (FK, nullable). Existing questions get defaults; grading untouched.
- `messaging 0002`: `FeedPost` (author, body, link_url, created_at), `FeedAttachment` (post, private file, name, type, size, kind).

## Phase order and files

1. Phase 3 + 6 (removals, delete quiz, import for new quizzes): `App.jsx`, `Sidebar.jsx`, `QuizEditor.jsx`, `lms/views.py` (exam delete refresh), delete `Exams.jsx`, `QuestionImport.jsx`.
2. Phase 2 (quiz images): `lms/models.py`, migration, `lms/views.py`, `lms/urls.py`, `services/api.js`, `QuizEditor.jsx`, `AssessmentPreview.jsx`, `QuizTake.jsx`, `StudentDetail.jsx` review dialog.
3. Phase 1 (feed + link support): `messaging/models.py`, migration, `messaging/services.py`, `messaging/views.py`, `messaging/urls.py`, `messaging/consumers.py`, `MessagingContext.jsx`, new `pages/student/Community.jsx`, `ChatThread.jsx` (links), nav.
4. Phase 4: `StudentDetail.jsx`, `attempt_history_row` (module, correct count, duration).
5. Phase 5: new overview endpoint, rewrite `pages/admin/Analytics.jsx`, chart components.
6. Phase 8: `student_progress` adds a timeline + summary, `Progress.jsx` charts.
7. Phase 7: `tailwind.config.js`, `index.css`, theme context + toggle, replace hard-coded colours.
8. Phase 9: consistent headers, cards, tables, empty/loading states across touched pages.
9. Tests: Django tests for each new rule, Vitest updates, production build, browser checks against `yoloa_e2e` only.
