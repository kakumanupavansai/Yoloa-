import { NavLink, useNavigate } from 'react-router-dom'
import Logo from '../ui/Logo'
import Avatar from '../ui/Avatar'
import { useAuth } from '../../context/AuthContext'
import { useMessaging } from '../../context/MessagingContext'
import * as I from '../ui/Icons'

// Only destinations that are implemented are listed (notes, library and the AI chatbot are postponed).
export const studentNav = [
  { to: '/student/dashboard', label: 'Dashboard', icon: I.HomeIcon },
  { to: '/student/courses', label: 'Course library', icon: I.BookIcon },
  { to: '/student/my-courses', label: 'My courses', icon: I.LayersIcon },
  { to: '/student/progress', label: 'Learning progress', icon: I.ChartIcon },
  { to: '/student/messages', label: 'Messages', icon: I.ChatIcon, badge: 'unread' },
  { to: '/student/profile', label: 'Profile', icon: I.UserIcon },
]
export const adminNav = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: I.DashboardIcon },
  { to: '/admin/courses', label: 'Courses', icon: I.BookIcon },
  { to: '/admin/exams', label: 'Assessments', icon: I.ClipboardIcon },
  { to: '/admin/students', label: 'Students', icon: I.UsersIcon },
  { to: '/admin/analytics', label: 'Analytics', icon: I.ChartIcon },
  { to: '/admin/question-import', label: 'Question import', icon: I.ImportIcon },
  { to: '/admin/profile', label: 'Profile', icon: I.UserIcon },
]

export function useSignOut() {
  const { logout } = useAuth()
  const nav = useNavigate()
  return async () => { await logout(); nav('/', { replace: true }) }
}

// The menu itself – used by the desktop sidebar and by the mobile/tablet drawer.
export function NavLinks() {
  const { user } = useAuth()
  const { unread } = useMessaging()
  const signOut = useSignOut()
  const admin = user?.role === 'admin'
  const items = admin ? adminNav : studentNav
  return (
    <>
      <p className="mt-8 px-6 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted">{admin ? 'Administration' : 'Learning space'}</p>
      <nav aria-label="Main" className="mt-2 flex flex-1 flex-col gap-1 px-3">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to}
            className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
              isActive ? 'bg-brand-soft text-brand-dark' : 'text-ink-soft hover:bg-ground hover:text-ink'}`}>
            <Icon className="h-5 w-5 shrink-0" /><span>{label}</span>
            {badge === 'unread' && unread > 0 && (
              <span className="ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white"
                aria-label={`${unread} unread messages`}>{unread > 99 ? '99+' : unread}</span>)}
          </NavLink>
        ))}
      </nav>
      <div className="mt-6 border-t border-line px-3 pt-4">
        {user && (
          <div className="flex items-center gap-3 px-3 pb-3">
            <Avatar src={user.avatar} name={user.name} size={36} />
            <div className="min-w-0 leading-tight"><p className="truncate text-sm font-semibold">{user.name}</p><p className="text-xs capitalize text-ink-muted">{user.role}</p></div>
          </div>
        )}
        <button type="button" onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink-soft hover:bg-danger-soft hover:text-danger">
          <I.LogoutIcon className="h-5 w-5" />Log out
        </button>
      </div>
    </>
  )
}

// Desktop sidebar: only from the `lg` breakpoint (>=1024px). Below that the MobileNav drawer is used.
export default function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-white py-6 lg:flex">
      <div className="px-6"><Logo className="text-[13px]" /></div>
      <NavLinks />
    </aside>
  )
}
