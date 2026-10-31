import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useMessaging } from '../../context/MessagingContext'
import { feedApi } from '../../services/api'
import Avatar from '../../components/ui/Avatar'
import RichText from '../../components/ui/RichText'
import { useConfirm, useToast } from '../../components/ui/Feedback'
import { PageHeader } from '../../components/ui/Primitives'
import { EmptyState, ErrorBox, Spinner } from '../../components/ui/States'
import { checkFiles, fmtSize, MAX_FILES } from '../../components/messaging/ChatThread'
import { ChatIcon, CloseIcon, DownloadIcon, ExternalIcon, FileIcon, GlobeIcon, ImageIcon, LinkIcon, LockIcon, TrashIcon } from '../../components/ui/Icons'

const MAX_POST = 5000
const ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv'
const IMAGE = /\.(jpe?g|png|gif|webp)$/i

export const fmtPostTime = (value) => {
  const date = new Date(value)
  const minutes = Math.round((Date.now() - date.getTime()) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24 && date.toDateString() === new Date().toDateString()) return `${Math.round(minutes / 60)} h ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

// Adds posts by id, newest first; duplicates from the WebSocket and the HTTP response collapse into one.
export function mergePosts(current, incoming) {
  const byId = new Map(current.map((post) => [post.id, post]))
  incoming.forEach((post) => byId.set(post.id, post))
  return [...byId.values()].sort((a, b) => b.id - a.id)
}

function Composer({ me, onPosted }) {
  const toast = useToast()
  const [body, setBody] = useState('')
  const [link, setLink] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [files, setFiles] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)
  const previews = useMemo(() => files.map((file) => ({ file, url: IMAGE.test(file.name) ? URL.createObjectURL(file) : '' })), [files])
  useEffect(() => () => previews.forEach((item) => item.url && URL.revokeObjectURL(item.url)), [previews])

  const addFiles = (list) => {
    const chosen = [...list]
    const problem = checkFiles(chosen, files.length)
    if (problem) { setError(problem.replace('per message', 'per post')); return }
    setError(''); setFiles((current) => [...current, ...chosen])
  }
  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    const text = body.trim()
    const url = link.trim()
    if (!text && !url && !files.length) { setError('Write something, add a link or attach a file.'); return }
    if (url && !/^https?:\/\/\S+$/i.test(url)) { setError('Enter a full link starting with http:// or https://.'); return }
    setBusy(true); setError('')
    try {
      const post = await feedApi.create({ body: text, link: url, files })
      setBody(''); setLink(''); setShowLink(false); setFiles([])
      if (input.current) input.current.value = ''
      onPosted(post)
      toast('Shared with all students.')
    } catch (err) { setError(err.message || 'Could not share the post.') } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} noValidate className="card card-pad space-y-3" aria-label="Create a post">
      <div className="flex gap-3">
        <Avatar src={me.avatar} name={me.name} size={44} />
        <label className="min-w-0 flex-1"><span className="sr-only">Post text</span>
          <textarea rows={3} maxLength={MAX_POST} value={body} onChange={(event) => setBody(event.target.value)} className="input resize-y"
            placeholder="Share a note, a question, study material or a useful link with every student…" /></label>
      </div>
      {showLink && (
        <label className="block"><span className="label">Link</span>
          <span className="flex gap-2"><input type="url" inputMode="url" value={link} onChange={(event) => setLink(event.target.value)} className="input" placeholder="https://" />
            <button type="button" className="btn-ghost btn-sm" onClick={() => { setShowLink(false); setLink('') }} aria-label="Remove link"><CloseIcon className="h-4 w-4" /></button></span></label>)}
      {previews.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Attachments to share">
          {previews.map(({ file, url }, index) => (
            <li key={`${file.name}-${index}`} className="relative overflow-hidden rounded-xl border border-line bg-ground">
              {url ? <img src={url} alt={file.name} className="h-28 w-full object-cover" />
                : <span className="flex h-28 flex-col items-center justify-center gap-1 px-2 text-center text-xs text-ink-soft"><FileIcon className="h-6 w-6" /><span className="line-clamp-2 break-all">{file.name}</span>{fmtSize(file.size)}</span>}
              <button type="button" onClick={() => setFiles((list) => list.filter((_, k) => k !== index))} aria-label={`Remove ${file.name}`}
                className="absolute right-1.5 top-1.5 rounded-full bg-scrim/60 p-1 text-white hover:bg-scrim/80"><CloseIcon className="h-3.5 w-3.5" /></button>
            </li>))}
        </ul>)}
      {error && <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="feed-files" onChange={(event) => { addFiles(event.target.files); event.target.value = '' }} />
        <label htmlFor="feed-files" className="btn-ghost btn-sm cursor-pointer"><ImageIcon className="h-4 w-4" />Photo or file</label>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowLink(true)} disabled={showLink}><LinkIcon className="h-4 w-4" />Link</button>
        <span className="hint mt-0 hidden sm:inline">Up to {MAX_FILES} files, 10 MB each</span>
        <span className="ml-auto text-xs text-ink-muted tabular-nums">{body.length > MAX_POST - 500 ? `${MAX_POST - body.length} left` : ''}</span>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? <><Spinner />Posting…</> : 'Post'}</button>
      </div>
    </form>
  )
}

function PostCard({ post, mine, onDelete }) {
  const images = post.attachments.filter((item) => item.kind === 'image')
  const documents = post.attachments.filter((item) => item.kind !== 'image')
  return (
    <article className="card overflow-hidden" aria-label={`Post by ${post.author.name}`}>
      <header className="flex items-start gap-3 px-5 pt-5">
        <Avatar src={post.author.avatar} name={post.author.name} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{post.author.name}{mine && <span className="badge-brand ml-2 align-middle">You</span>}</p>
          <p className="text-xs text-ink-muted">@{post.author.username} · <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>{fmtPostTime(post.createdAt)}</time></p>
        </div>
        {mine && <button type="button" onClick={() => onDelete(post)} className="rounded-lg p-2 text-ink-muted hover:bg-danger-soft hover:text-danger" aria-label="Delete post"><TrashIcon className="h-4 w-4" /></button>}
      </header>
      <div className="space-y-3 px-5 pb-5 pt-3">
        {post.body && <RichText text={post.body} className="text-[15px] leading-relaxed" linkClassName="font-semibold text-brand underline-offset-2 hover:underline break-all" />}
        {post.link && (
          <a href={post.link} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-3 rounded-xl border border-line bg-ground px-4 py-3 hover:border-brand/40">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><LinkIcon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{hostOf(post.link)}</span><span className="block truncate text-xs text-ink-muted">{post.link}</span></span>
            <ExternalIcon className="h-4 w-4 shrink-0 text-ink-muted" />
          </a>)}
        {images.length > 0 && (
          <div className={`grid gap-1.5 overflow-hidden rounded-xl ${images.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {images.map((item) => (
              <a key={item.id} href={feedApi.attachmentUrl(item)} target="_blank" rel="noreferrer" className="block bg-ground">
                <img src={feedApi.attachmentUrl(item)} alt={item.name} loading="lazy" className={`w-full object-cover ${images.length === 1 ? 'max-h-[420px]' : 'h-48'}`} />
              </a>))}
          </div>)}
        {documents.length > 0 && (
          <ul className="space-y-2">{documents.map((item) => (
            <li key={item.id}><a href={feedApi.attachmentUrl(item, { download: true })} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm hover:bg-ground">
              <FileIcon className="h-5 w-5 shrink-0 text-brand" /><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{item.name}</span><span className="text-xs text-ink-muted">{fmtSize(item.size)}</span></span>
              <DownloadIcon className="h-4 w-4 shrink-0" aria-label="Download" /></a></li>))}</ul>)}
      </div>
    </article>
  )
}

function FeedSkeleton() {
  return Array.from({ length: 2 }, (_, index) => (
    <div key={index} className="card card-pad space-y-3" aria-hidden="true">
      <div className="flex items-center gap-3"><span className="skeleton h-11 w-11 rounded-full" /><span className="flex-1 space-y-2"><span className="skeleton block h-3 w-40" /><span className="skeleton block h-3 w-24" /></span></div>
      <span className="skeleton block h-3 w-full" /><span className="skeleton block h-3 w-4/5" />
    </div>))
}

// Public space: every student can read and post. Private one-to-one chat lives on the Messages page.
export default function Community() {
  const { user } = useAuth()
  const messaging = useMessaging()
  const confirm = useConfirm()
  const toast = useToast()
  const [state, setState] = useState({ loading: true, error: null, posts: [], hasMore: false, more: false })

  const load = useCallback(() => {
    setState((current) => ({ ...current, loading: true, error: null }))
    return feedApi.list().then((page) => setState((current) => ({ ...current, loading: false, posts: mergePosts([], page.results), hasMore: page.hasMore })))
      .catch((error) => setState((current) => ({ ...current, loading: false, error })))
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => messaging.subscribe((event) => {
    if (event.type === 'feed.post') setState((current) => ({ ...current, posts: mergePosts(current.posts, [event.post]) }))
    if (event.type === 'feed.delete') setState((current) => ({ ...current, posts: current.posts.filter((post) => post.id !== event.postId) }))
    if (event.type === 'ready' && event.reconnected) load()  // catch up on posts made while offline
  }), [messaging, load])

  const loadMore = async () => {
    const oldest = state.posts[state.posts.length - 1]
    if (!oldest) return
    setState((current) => ({ ...current, more: true }))
    try {
      const page = await feedApi.list({ before: oldest.id })
      setState((current) => ({ ...current, more: false, posts: mergePosts(current.posts, page.results), hasMore: page.hasMore }))
    } catch (error) { setState((current) => ({ ...current, more: false })); toast(error.message || 'Could not load more posts.', 'error') }
  }
  const remove = async (post) => {
    if (!await confirm({ title: 'Delete this post?', message: 'It is removed for every student. This cannot be undone.', confirmLabel: 'Delete post', tone: 'danger' })) return
    try { await feedApi.remove(post.id); setState((current) => ({ ...current, posts: current.posts.filter((item) => item.id !== post.id) })); toast('Post deleted.') }
    catch (error) { toast(error.message || 'Could not delete the post.', 'error') }
  }

  return (
    <>
      <PageHeader eyebrow="Community" title="Student feed" subtitle="A public space for every student: share notes, study material, links and images, and see what classmates are sharing."
        actions={<Link to="/student/messages" className="btn-ghost"><LockIcon className="h-4 w-4" />Private messages</Link>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="mx-auto w-full max-w-2xl space-y-4 lg:mx-0">
          <p className="flex items-center gap-2 rounded-xl border border-brand/20 bg-brand-soft px-4 py-2.5 text-sm text-brand-dark" role="note">
            <GlobeIcon className="h-4 w-4 shrink-0" />Posts here are <strong>public</strong>: every signed-in student can see them.
          </p>
          <Composer me={user} onPosted={(post) => setState((current) => ({ ...current, posts: mergePosts(current.posts, [post]) }))} />
          {state.loading && !state.posts.length && <FeedSkeleton />}
          {state.error && <ErrorBox error={state.error} onRetry={load} title="Could not load the feed" />}
          {!state.loading && !state.error && !state.posts.length && (
            <div className="card"><EmptyState title="No posts yet" icon={GlobeIcon}>Be the first to share something useful with your classmates.</EmptyState></div>)}
          {state.posts.map((post) => <PostCard key={post.id} post={post} mine={post.author.id === user.id} onDelete={remove} />)}
          {state.hasMore && <button type="button" className="btn-ghost w-full" onClick={loadMore} disabled={state.more}>{state.more ? <><Spinner />Loading…</> : 'Show older posts'}</button>}
        </div>
        <aside className="hidden space-y-4 lg:block">
          <section className="card card-pad space-y-3">
            <h2 className="text-base font-bold">Public and private</h2>
            <p className="flex gap-2 text-sm text-ink-soft"><GlobeIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span><strong className="text-ink">Community feed</strong> — visible to all students.</span></p>
            <p className="flex gap-2 text-sm text-ink-soft"><LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span><strong className="text-ink">Private messages</strong> — only you and the student you chat with can read them.</span></p>
            <Link to="/student/messages" className="btn-secondary w-full"><ChatIcon className="h-4 w-4" />Open private messages</Link>
          </section>
          <section className="card card-pad text-sm text-ink-soft">
            <h2 className="mb-2 text-base font-bold text-ink">Sharing tips</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Images (JPG, PNG, GIF, WEBP) appear in the post.</li>
              <li>PDF, Word, Excel, PowerPoint, TXT and CSV files are downloadable.</li>
              <li>Links starting with http:// or https:// become clickable.</li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  )
}
