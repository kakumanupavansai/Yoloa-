import { useTheme } from '../../context/ThemeContext'
import { MoonIcon, SunIcon } from '../ui/Icons'

// One switch for the whole app (student and admin). `compact` is the icon-only button for top bars.
export default function ThemeToggle({ compact = false, className = '' }) {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode'
  const Icon = dark ? SunIcon : MoonIcon
  if (compact) {
    return (
      <button type="button" onClick={toggle} aria-label={label} title={label}
        className={`flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-soft hover:bg-ground hover:text-ink ${className}`}>
        <Icon className="h-5 w-5" />
      </button>
    )
  }
  return (
    <button type="button" onClick={toggle} role="switch" aria-checked={dark} aria-label="Dark mode"
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink-soft hover:bg-ground hover:text-ink ${className}`}>
      <Icon className="h-5 w-5" /><span className="flex-1">{dark ? 'Dark mode' : 'Light mode'}</span>
      <span aria-hidden="true" className={`relative h-5 w-9 rounded-full transition ${dark ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${dark ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}
