from django.core.management.base import BaseCommand

from lms.views import finalize_expired_attempts


class Command(BaseCommand):
    help = 'Finalize final-exam attempts whose server-controlled deadline has elapsed.'

    def handle(self, *args, **options):
        attempt_ids = finalize_expired_attempts()
        self.stdout.write(self.style.SUCCESS(f'Finalized {len(attempt_ids)} expired attempt(s).'))
