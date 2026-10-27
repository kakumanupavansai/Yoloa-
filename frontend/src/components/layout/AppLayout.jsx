import { Suspense, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { MessagingProvider } from '../../context/MessagingContext'
import Avatar from '../ui/Avatar'
import { ChevronDown, LogoutIcon, UserIcon } from '../ui/Icons'
import MobileNav from './MobileNav'
import { Loading } from '../ui/States'
import Sidebar, { useSignOut } from './Sidebar'

// Desktop top bar: today's date and the profile menu (profile + sign out).
function ProfileMenu() {
  const { user } = useAuth()
  const signOut = useSignOut()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => { if (!wrap.current?.contains(event.target)) setOpen(false) }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (!user) return null
  const base = user.role === 'admin' ? '/admin' : '/student'
  return (
    <div className="relative" ref={wrap}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Account menu for ${user.name}`} className="flex items-center gap-2.5 rounded-xl border border-line bg-white py-1.5 pl-1.5 pr-3 hover:bg-ground">
        <Avatar src={user.avatar} name={user.name} size={32} />
        <span className="max-w-[160px] truncate text-sm font-semibold">{user.name}</span>
        <ChevronDown className="h-4 w-4 text-ink-muted" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-line bg-white p-2 shadow-pop">
          <div className="px-3 py-2"><p className="truncate text-sm font-semibold">{user.name}</p><p className="truncate text-xs text-ink-muted">{user.email}</p></div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" to={`${base}/profile`} onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-ground"><UserIcon className="h-4 w-4" />Profile</Link>
          <button role="menuitem" type="button" onClick={signOut} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft"><LogoutIcon className="h-4 w-4" />Sign out</button>
        </div>
      )}
    </div>
  )
}

// Shell for every authenticated page.
//  >= 1024px : fixed sidebar on the left + top bar
//  <  1024px : sticky top bar with a slide-in menu (MobileNav)
export default function AppLayout() {
  const today = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date())
  return (
    // The messaging connection lives here so the unread badge and real-time delivery work on every student page.
    <MessagingProvider>
      <div className="min-h-screen lg:flex">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <MobileNav />
          <div className="hidden items-center justify-end gap-4 px-8 pt-5 lg:flex">
            <span className="text-sm text-ink-muted">{today}</span>
            <ProfileMenu />
          </div>
          <main className="mx-auto w-full max-w-7xl px-4 pb-12 pt-5 sm:px-6 lg:px-8 lg:pt-4">
            {/* Pages load on demand; keep the navigation on screen while the next page's code arrives. */}
            <Suspense fallback={<Loading label="Loading page…" />}><Outlet /></Suspense>
          </main>
        </div>
      </div>
    </MessagingProvider>
  )
}
