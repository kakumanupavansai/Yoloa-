// YOLOA wordmark recreated in SVG/text. Replace with your exported logo image if desired:
//   <img src="/logo.png" alt="YOLOA" className={className} />
export default function Logo({ className = 'h-10' }) {
  return (
    <div className={`flex items-end font-black leading-none select-none ${className}`} style={{ fontSize: '2.6em' }} aria-label="YOLOA">
      <span className="text-[#0b3a9a] dark:text-[#8fb0ff]">Y</span><span className="text-[#0b3a9a] dark:text-[#8fb0ff]">O</span>
      <span className="bg-gradient-to-b from-[#0b5fd1] to-[#1e90ff] bg-clip-text text-transparent">L</span>
      <span className="text-[#1976e0] dark:text-[#6fa8ff]">O</span>
      <span className="relative text-accent-coral">A
        <svg className="absolute -top-[0.55em] left-[0.05em] w-[0.9em]" viewBox="0 0 40 20"><path d="M20 1L1 8l19 7 19-7z" fill="#0b5fd1" /><path d="M9 11v5c0 2 5 4 11 4s11-2 11-4v-5l-11 4z" fill="#0b3a9a" /></svg>
      </span>
    </div>
  )
}
