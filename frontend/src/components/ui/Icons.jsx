// Inline stroke icons (24px grid). Decorative by default: pass aria-label + role="img" when meaningful.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
const icon = (children) => function Icon({ className = 'h-5 w-5', ...props }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" className={className} aria-hidden="true" focusable="false" {...S} {...props}>{children}</svg>
}

export const HomeIcon = icon(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></>)
export const DashboardIcon = icon(<><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>)
export const BookIcon = icon(<><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 19.5V4.5" /><path d="M8 7h8M8 11h6" /></>)
export const LayersIcon = icon(<><path d="m12 2 10 5-10 5L2 7z" /><path d="m2 12 10 5 10-5" /><path d="m2 17 10 5 10-5" /></>)
export const ChartIcon = icon(<><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>)
export const UserIcon = icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>)
export const UsersIcon = icon(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a5.5 5.5 0 0 1 3.5 6" /></>)
export const ClipboardIcon = icon(<><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1" /><path d="m9 12 2 2 4-4" /><path d="M9 17h6" /></>)
export const ImportIcon = icon(<><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>)
export const LockIcon = icon(<><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>)
export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7.5" />)
export const CheckCircleIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.3 2.3 2.3 4.7-4.8" /></>)
export const AlertIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>)
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>)
export const PlayIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="m10 8.5 6 3.5-6 3.5z" fill="currentColor" /></>)
export const FileIcon = icon(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>)
export const PresentationIcon = icon(<><rect x="3" y="3" width="18" height="12" rx="1.5" /><path d="M12 15v4M8 21l4-2 4 2" /><path d="M8 11l3-3 2 2 3-3" /></>)
export const LinkIcon = icon(<><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></>)
export const NoteIcon = icon(<><path d="M4 4h16v12l-4 4H4z" /><path d="M16 20v-4h4M8 9h8M8 13h5" /></>)
export const ExternalIcon = icon(<><path d="M14 4h6v6" /><path d="M10 14 20 4" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>)
export const DownloadIcon = icon(<><path d="M12 4v11" /><path d="m7 10 5 5 5-5" /><path d="M5 20h14" /></>)
export const UploadIcon = icon(<><path d="M12 20V9" /><path d="m7 14 5-5 5 5" /><path d="M5 4h14" /></>)
export const ClockIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>)
export const TrophyIcon = icon(<><path d="M8 21h8M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></>)
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />)
export const PencilIcon = icon(<><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>)
export const TrashIcon = icon(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>)
export const ArrowUpIcon = icon(<path d="M12 19V5m-6 6 6-6 6 6" />)
export const ArrowDownIcon = icon(<path d="M12 5v14m6-6-6 6-6-6" />)
export const ArrowLeftIcon = icon(<path d="M19 12H5m0 0 6-6m-6 6 6 6" />)
export const ArrowRightIcon = icon(<path d="M5 12h14m0 0-6-6m6 6-6 6" />)
export const ChevronDown = icon(<path d="m6 9 6 6 6-6" />)
export const ChevronRight = icon(<path d="m9 6 6 6-6 6" />)
export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>)
export const LogoutIcon = icon(<><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>)
export const MegaphoneIcon = icon(<><path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z" /><path d="M17 8a5 5 0 0 1 0 8" /></>)
export const RefreshIcon = icon(<><path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" /><path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16" /><path d="M20 20v-4h-4" /></>)
export const MenuLinesIcon = icon(<path d="M4 6h16M4 12h16M4 18h16" />)
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />)
export const StudentIcon = icon(<><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11.2V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.8M22 9v5" /></>)
export const ShieldIcon = icon(<><path d="M12 3l8 3v6c0 4.5-3.3 8.2-8 9-4.7-.8-8-4.5-8-9V6z" /><path d="m8.8 12.2 2.2 2.2 4.3-4.4" /></>)
export const EyeIcon = icon(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>)
export const ChatIcon = icon(<><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" /><path d="M8.5 10.5h7M8.5 14h4.5" /></>)
export const PaperclipIcon = icon(<path d="m21 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6l8.2-8.2" />)
export const SendIcon = icon(<><path d="M21 3 10 14" /><path d="m21 3-7 18-4-7-7-4z" /></>)
export const EyeOffIcon = icon(<><path d="M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.7 17.7 0 0 1-3.2 4.2M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></>)

export const SunIcon = icon(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>)
export const MoonIcon = icon(<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />)
export const ImageIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-9 9" /></>)
export const GlobeIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>)

// Google "G" mark, shown only on the student Google sign-in button.
export const GoogleIcon = (props) => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" {...props}>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
)
