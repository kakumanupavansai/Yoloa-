from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from . import models as m

admin.site.register(m.User, UserAdmin)
UserAdmin.fieldsets += (('LMS', {'fields': ('role', 'avatar', 'address', 'city', 'country', 'postal_code')}),)
for model in (m.Course, m.Chapter, m.CourseContent, m.Enrollment, m.ChapterProgress, m.Exam, m.Question, m.Attempt,
              m.GradingReview, m.LoginEvent, m.QuestionImportBatch, m.LibraryItem, m.Announcement, m.CalendarEvent,
              m.ScheduleItem, m.Assignment):
    admin.site.register(model)
