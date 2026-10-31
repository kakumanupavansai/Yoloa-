// Plain text with web links made clickable. Only http(s) URLs become links; everything else stays text (React escapes it).
const URL_PATTERN = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}])/gi

export function splitLinks(text = '') {
  const parts = []
  let last = 0
  for (const match of String(text).matchAll(URL_PATTERN)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: match[0], href: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

export default function RichText({ text, className = '', linkClassName = 'font-semibold underline underline-offset-2 break-all' }) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {splitLinks(text).map((part, index) => (part.href
        ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer nofollow" className={linkClassName}>{part.text}</a>
        : <span key={index}>{part.text}</span>))}
    </p>
  )
}
