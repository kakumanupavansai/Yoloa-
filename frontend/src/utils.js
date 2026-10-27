// Turn a YouTube watch/share/playlist URL into an embeddable one; non-YouTube URLs return ''.
export function toEmbedUrl(url = '') {
  if (!url) return ''
  const list = url.match(/[?&]list=([\w-]+)/)
  const video = url.match(/(?:youtube\.com\/watch\?(?:.*&)?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]{11})/)
  if (video) return `https://www.youtube-nocookie.com/embed/${video[1]}${list ? `?list=${list[1]}` : ''}`
  if (list) return `https://www.youtube-nocookie.com/embed/videoseries?list=${list[1]}`
  return ''
}
export const fmtTime = (secs) => `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
