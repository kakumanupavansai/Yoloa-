import { Link } from 'react-router-dom'
import { AuthShell, FormAlert } from '../components/auth/AuthUI'
import { useAuth } from '../context/AuthContext'
import * as I from '../components/ui/Icons'

const portals = [
  {
    to: '/login',
    title: 'Student',
    icon: I.StudentIcon,
    description: 'Learn at your own pace: join courses, watch lessons, track your progress and take quizzes and exams.',
    points: ['Courses and lesson player', 'Quizzes and final exams', 'Progress and calendar'],
    iconTone: 'bg-brand-soft text-brand-dark',
    ring: 'hover:border-brand focus-visible:ring-brand/40',
    cta: 'text-brand-dark',
  },
  {
    to: '/admin/login',
    title: 'Administrator',
    icon: I.ShieldIcon,
    description: 'Manage the learning portal: build courses and assessments, review students and follow analytics.',
    points: ['Course and exam builder', 'Student directory', 'Login and exam analytics'],
    iconTone: 'bg-[#1f1f5c] text-white',
    ring: 'hover:border-[#1f1f5c] focus-visible:ring-[#1f1f5c]/40',
    cta: 'text-[#1f1f5c]',
  },
]

// First screen for visitors who are not signed in: choose the student or administrator portal.
export default function Landing() {
  const { authError, retryAuth } = useAuth()
  return (
    <AuthShell wide showArt={false}>
      <div className="text-center">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-brand">Welcome to YOLOA</p>
        <h1 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">How would you like to sign in?</h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] text-ink-soft">Choose your portal to continue. Students and administrators sign in separately.</p>
      </div>
      {authError && (
        <div className="mx-auto mt-6 max-w-xl">
          <FormAlert>
            We could not check your session: {authError.message || 'the server is unavailable'}.{' '}
            <button type="button" onClick={retryAuth} className="font-bold underline">Retry</button>
          </FormAlert>
        </div>
      )}
      <ul className="mt-8 grid gap-4 sm:mt-10 sm:grid-cols-2 sm:gap-6">
        {portals.map(({ to, title, icon: Icon, description, points, iconTone, ring, cta }) => (
          <li key={to}>
            <Link to={to} aria-label={`Continue as ${title}`}
              className={`group flex h-full flex-col rounded-2xl border-2 border-transparent bg-surface p-6 shadow-[0_10px_40px_-12px_rgba(38,38,174,0.25)] transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-4 sm:p-7 ${ring}`}>
              <span className={`flex h-14 w-14 items-center justify-center rounded-2xl ${iconTone}`}>
                <Icon className="h-8 w-8" aria-hidden="true" />
              </span>
              <h2 className="mt-5 text-xl font-bold text-ink">{title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{description}</p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
                {points.map((point) => (
                  <li key={point} className="flex items-center gap-2"><I.CheckCircleIcon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />{point}</li>
                ))}
              </ul>
              <span className={`mt-6 inline-flex items-center gap-2 pt-1 text-sm font-bold ${cta}`}>
                Continue <I.ArrowRightIcon className="h-4 w-4 transition group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AuthShell>
  )
}
