const palette = ['bg-amber-400', 'bg-pink-400', 'bg-sky-400', 'bg-emerald-400', 'bg-violet-400']
export default function Avatar({ src, name = '', size = 48, className = '' }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const color = palette[(name.charCodeAt(0) || 0) % palette.length]
  const style = { width: size, height: size, fontSize: size / 2.6 }
  return src
    ? <img src={src} alt={name} style={style} className={`rounded-full object-cover ${className}`} />
    : <div style={style} className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${color} ${className}`}>{initials || '?'}</div>
}
