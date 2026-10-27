import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useMessaging } from '../../context/MessagingContext'
import Avatar from '../ui/Avatar'
import Logo from '../ui/Logo'
import { CloseIcon, MenuLinesIcon } from '../ui/Icons'
import { NavLinks } from './Sidebar'

// Sticky top bar (hamburger · logo · avatar) + slide-in menu. Visible below 1024px only.
export default function MobileNav() {
  const { user } = useAuth()
  const { unread } = useMessaging()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const menuBtn = useRef(null)
  const closeBtn = useRef(null)

  useEffect(() => { setOpen(false) }, [pathname])            // close after navigating

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'                   // don't scroll the page behind the menu
    closeBtn.current?.focus()
    const opener = menuBtn.current
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow; opener?.focus() }
  }, [open])

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white/95 px-3 pb-2 backdrop-blur lg:hidden"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}>
        <button ref={menuBtn} onClick={() => setOpen(true)} aria-label={unread ? `Open menu (${unread} unread messages)` : 'Open menu'} aria-haspopup="dialog" aria-expanded={open}
          className="relative flex h-11 w-11 items-center justify-center rounded-xl text-brand hover:bg-brand-soft"><MenuLinesIcon className="h-6 w-6" />
          {unread > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-white" aria-hidden="true" />}</button>
        <Logo className="text-[10px]" />
        {user && <Link to={user.role === 'admin' ? '/admin/profile' : '/student/profile'} aria-label="My profile" className="ml-auto"><Avatar src={user.avatar} name={user.name} size={36} /></Link>}
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Main menu">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto bg-white py-4 shadow-pop"
            style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
            <div className="flex items-center justify-between px-5">
              <Logo className="text-[11px]" />
              <button ref={closeBtn} onClick={() => setOpen(false)} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-ground"><CloseIcon className="h-6 w-6" /></button>
            </div>
            <NavLinks />
          </div>
        </div>)}
    </>
  )
}
