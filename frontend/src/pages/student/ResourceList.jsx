import { useState } from 'react'
import { resourcesApi } from '../../services/api'
import { toEmbedUrl } from '../../utils'
import { DownloadIcon, ExternalIcon, FileIcon, LinkIcon, NoteIcon, PlayIcon, PresentationIcon } from '../../components/ui/Icons'

const meta = {
  video: { icon: PlayIcon, label: 'Video', tone: 'bg-danger-soft text-danger' },
  document: { icon: FileIcon, label: 'Document', tone: 'bg-brand-soft text-brand-dark' },
  presentation: { icon: PresentationIcon, label: 'Presentation', tone: 'bg-warning-soft text-warning' },
  link: { icon: LinkIcon, label: 'Link', tone: 'bg-success-soft text-success' },
  text: { icon: NoteIcon, label: 'Note', tone: 'bg-ground text-ink-soft' },
}
const isPdf = (resource) => /\.pdf$/i.test(resource.fileName || '')

function Resource({ resource }) {
  const [viewing, setViewing] = useState(false)
  const info = meta[resource.type] || meta.link
  const Icon = info.icon
  const embed = resource.type === 'video' ? toEmbedUrl(resource.url) : ''
  return (
    <li className="rounded-2xl border border-line p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${info.tone}`}><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{resource.title}</p>
          <p className="text-xs text-ink-muted">{info.label}{resource.fileName ? ` · ${resource.fileName}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {resource.hasFile && isPdf(resource) && <button type="button" className="btn-secondary btn-sm" onClick={() => setViewing((value) => !value)} aria-expanded={viewing}>{viewing ? 'Hide viewer' : 'View PDF'}</button>}
          {resource.hasFile && <a className="btn-ghost btn-sm" href={resourcesApi.fileUrl(resource, { download: true })}><DownloadIcon className="h-3.5 w-3.5" />Download</a>}
          {resource.url && resource.type !== 'video' && <a className="btn-ghost btn-sm" href={resource.url} target="_blank" rel="noopener noreferrer">Open <ExternalIcon className="h-3.5 w-3.5" /><span className="sr-only">(opens in a new tab)</span></a>}
          {resource.type === 'video' && <a className="btn-ghost btn-sm" href={resource.url} target="_blank" rel="noopener noreferrer">YouTube <ExternalIcon className="h-3.5 w-3.5" /><span className="sr-only">(opens in a new tab)</span></a>}
        </div>
      </div>
      {resource.text && <p className="mt-3 whitespace-pre-line rounded-xl bg-ground p-3 text-sm leading-relaxed text-ink-soft">{resource.text}</p>}
      {embed && (
        <div className="mt-4 aspect-video overflow-hidden rounded-xl bg-ink">
          <iframe className="h-full w-full" src={embed} title={resource.title} loading="lazy" referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
        </div>
      )}
      {viewing && <iframe className="mt-4 h-[70vh] w-full rounded-xl border border-line" src={resourcesApi.fileUrl(resource)} title={`${resource.title} (PDF viewer)`} />}
    </li>
  )
}

export default function ResourceList({ resources }) {
  if (!resources.length) return <p className="text-sm text-ink-muted">No learning resources have been added to this module yet.</p>
  return <ul className="space-y-3">{resources.map((resource) => <Resource key={resource.id} resource={resource} />)}</ul>
}
