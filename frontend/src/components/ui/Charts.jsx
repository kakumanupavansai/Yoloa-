// Small, dependency-free SVG charts. Colours come from the theme's --chart-* variables, so charts follow light/dark mode.
// Every chart has a text alternative (aria-label + an sr-only table) and a hover/focus tooltip.
import { useEffect, useId, useMemo, useRef, useState } from 'react'

export const SERIES = ['rgb(var(--chart-1))', 'rgb(var(--chart-2))', 'rgb(var(--chart-3))', 'rgb(var(--chart-4))', 'rgb(var(--chart-5))']
const GRID = 'rgb(var(--chart-grid))'
const shortDate = (iso) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${iso}T00:00:00`))

// Rounds the axis maximum up so the four grid steps are 1, 2, 2.5 or 5 × a power of ten.
function niceMax(value) {
  if (value <= 4) return 4
  const raw = value / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= raw) * magnitude
  return step * 4
}

// The drawing width follows the rendered width, so axis text stays a readable 10px on phones and wide screens alike.
function useChartWidth(fallback) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => { const next = Math.round(entry.contentRect.width); if (next > 0) setWidth(Math.max(280, next)) })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function Legend({ items, hidden = [], onToggle }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" aria-label="Legend">
      {items.map((item, index) => {
        const off = hidden.includes(item.key)
        const swatch = <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color || SERIES[index % SERIES.length], opacity: off ? 0.3 : 1 }} />
        return (
          <li key={item.key}>
            {onToggle
              ? <button type="button" onClick={() => onToggle(item.key)} aria-pressed={!off} className={`flex items-center gap-1.5 rounded px-1 hover:text-ink ${off ? 'line-through opacity-60' : ''}`}>{swatch}{item.label}</button>
              : <span className="flex items-center gap-1.5">{swatch}{item.label}</span>}
          </li>
        )
      })}
    </ul>
  )
}

function SrTable({ caption, columns, rows }) {
  return (
    <table className="sr-only"><caption>{caption}</caption>
      <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, k) => <td key={k}>{cell}</td>)}</tr>)}</tbody>
    </table>
  )
}

/** Time series: `labels` are ISO dates, `series` = [{ key, label, values: number[] }]. Lines with points; hover shows all values. */
export function LineChart({ labels, series, height = 220, title, formatValue = (v) => v, area = true, pointLabel, yMax }) {
  const [hidden, setHidden] = useState([])
  const [hover, setHover] = useState(null)
  const gradientId = useId().replace(/:/g, '')
  const visible = series.filter((item) => !hidden.includes(item.key))
  const max = yMax || niceMax(Math.max(1, ...visible.flatMap((item) => item.values)))
  const [box, width] = useChartWidth(640)
  const pad = { l: 36, r: 12, t: 12, b: 26 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const x = (index) => pad.l + (labels.length <= 1 ? innerW / 2 : (index * innerW) / (labels.length - 1))
  const y = (value) => pad.t + innerH - (value / max) * innerH
  const tickEvery = Math.max(1, Math.ceil(labels.length / Math.max(2, Math.floor(innerW / 70))))
  const toggle = (key) => setHidden((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  const pick = (target, clientX) => {
    const box = target.getBoundingClientRect()
    const px = ((clientX - box.left) / box.width) * width
    const index = Math.round(((px - pad.l) / innerW) * (labels.length - 1))
    setHover(Math.max(0, Math.min(labels.length - 1, index)))
  }
  return (
    <figure className="space-y-3">
      {series.length > 1 && <Legend items={series.map((item, index) => ({ ...item, color: SERIES[index % SERIES.length] }))} hidden={hidden} onToggle={toggle} />}
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full touch-none" role="img" aria-label={title}
          onMouseMove={(event) => pick(event.currentTarget, event.clientX)} onMouseLeave={() => setHover(null)}
          onTouchStart={(event) => event.touches[0] && pick(event.currentTarget, event.touches[0].clientX)}>
          <defs>
            {series.map((item, index) => (
              <linearGradient key={item.key} id={`${gradientId}-${index}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={SERIES[index % SERIES.length]} stopOpacity="0.22" />
                <stop offset="100%" stopColor={SERIES[index % SERIES.length]} stopOpacity="0" />
              </linearGradient>))}
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line x1={pad.l} x2={width - pad.r} y1={y(max * fraction)} y2={y(max * fraction)} stroke={GRID} strokeDasharray={fraction ? '3 4' : undefined} />
              <text x={pad.l - 6} y={y(max * fraction) + 4} textAnchor="end" className="fill-ink-muted text-[10px]">{formatValue(Math.round(max * fraction))}</text>
            </g>))}
          {labels.map((label, index) => {
            const last = index === labels.length - 1
            // One tick per few points, never the same day twice in a row, and the end labels kept inside the chart.
            if (!(index % tickEvery === 0 || last) || (index > 0 && labels[index - 1] === label)) return null
            return <text key={`${label}-${index}`} x={x(index)} y={height - 8} textAnchor={labels.length > 1 && last ? 'end' : labels.length > 1 && index === 0 ? 'start' : 'middle'}
              className="fill-ink-muted text-[10px]">{shortDate(label)}</text>
          })}
          {series.map((item, index) => {
            if (hidden.includes(item.key)) return null
            const color = SERIES[index % SERIES.length]
            const points = item.values.map((value, k) => `${x(k)},${y(value)}`).join(' ')
            return (
              <g key={item.key}>
                {area && <polygon points={`${x(0)},${y(0)} ${points} ${x(item.values.length - 1)},${y(0)}`} fill={`url(#${gradientId}-${index})`} />}
                <polyline points={points} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
                {labels.length <= 45 && item.values.map((value, k) => <circle key={k} cx={x(k)} cy={y(value)} r={hover === k ? 4.5 : 2.5} fill={color} />)}
              </g>)
          })}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + innerH} stroke={GRID} strokeWidth="1.5" />}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-[120px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"
            style={{ left: `${Math.min(88, Math.max(12, (x(hover) / width) * 100))}%` }} role="status">
            <p className="font-semibold">{pointLabel ? pointLabel(hover) : shortDate(labels[hover])}</p>
            {visible.map((item) => (
              <p key={item.key} className="mt-0.5 flex items-center justify-between gap-3 text-ink-soft">
                <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[series.indexOf(item) % SERIES.length] }} />{item.label}</span>
                <span className="font-semibold tabular-nums text-ink">{formatValue(item.values[hover])}</span>
              </p>))}
          </div>)}
      </div>
      <SrTable caption={title} columns={['Date', ...series.map((item) => item.label)]} rows={labels.map((label, k) => [label, ...series.map((item) => item.values[k])])} />
    </figure>
  )
}

/** Vertical bars. `data` = [{ label, values: { key: number } }], `keys` = [{ key, label }]; stacked when there are several keys. */
export function BarChart({ data, keys, height = 220, title, formatValue = (v) => v }) {
  const [box, width] = useChartWidth(640)
  const [hover, setHover] = useState(null)
  const [hidden, setHidden] = useState([])
  const shown = keys.filter((item) => !hidden.includes(item.key))
  const totals = data.map((row) => shown.reduce((sum, item) => sum + (row.values[item.key] || 0), 0))
  const max = niceMax(Math.max(1, ...totals))
  const pad = { l: 36, r: 8, t: 12, b: 34 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const slot = innerW / Math.max(1, data.length)
  const barW = Math.min(48, slot * 0.66)
  // Labels need about 60 units each; skip some when there are many bars (every bar still has a tooltip).
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.floor(innerW / 60)))
  const y = (value) => pad.t + innerH - (value / max) * innerH
  const toggle = (key) => setHidden((list) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]))
  return (
    <figure className="space-y-3">
      {keys.length > 1 && <Legend items={keys.map((item, index) => ({ ...item, color: SERIES[index % SERIES.length] }))} hidden={hidden} onToggle={toggle} />}
      <div className="relative" ref={box}>
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <g key={fraction}>
              <line x1={pad.l} x2={width - pad.r} y1={y(max * fraction)} y2={y(max * fraction)} stroke={GRID} strokeDasharray={fraction ? '3 4' : undefined} />
              <text x={pad.l - 6} y={y(max * fraction) + 4} textAnchor="end" className="fill-ink-muted text-[10px]">{formatValue(Math.round(max * fraction))}</text>
            </g>))}
          {data.map((row, index) => {
            let base = 0
            const cx = pad.l + slot * index + slot / 2
            return (
              <g key={`${row.label}-${index}`} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} tabIndex={0}
                aria-label={`${row.label}: ${shown.map((item) => `${item.label} ${row.values[item.key] || 0}`).join(', ')}`} className="outline-none">
                <rect x={pad.l + slot * index} y={pad.t} width={slot} height={innerH} fill={hover === index ? GRID : 'transparent'} opacity="0.35" />
                {keys.map((item, k) => {
                  if (hidden.includes(item.key)) return null
                  const value = row.values[item.key] || 0
                  const top = y(base + value)
                  const h = y(base) - top
                  base += value
                  return value ? <rect key={item.key} x={cx - barW / 2} y={top} width={barW} height={Math.max(h, 0)} rx="4" fill={SERIES[k % SERIES.length]} /> : null
                })}
                {(index % labelEvery === 0 || index === data.length - 1) && (
                  <text x={cx} y={height - 14} textAnchor="middle" className="fill-ink-muted text-[10px]">{row.label.length > 12 ? `${row.label.slice(0, 11)}…` : row.label}</text>)}
              </g>)
          })}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 z-10 min-w-[130px] -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-pop"
            style={{ left: `${Math.min(88, Math.max(12, ((pad.l + slot * hover + slot / 2) / width) * 100))}%` }} role="status">
            <p className="font-semibold">{data[hover].label}</p>
            {shown.map((item) => (
              <p key={item.key} className="mt-0.5 flex justify-between gap-3 text-ink-soft"><span>{item.label}</span><span className="font-semibold tabular-nums text-ink">{formatValue(data[hover].values[item.key] || 0)}</span></p>))}
          </div>)}
      </div>
      <SrTable caption={title} columns={['Group', ...keys.map((item) => item.label)]} rows={data.map((row) => [row.label, ...keys.map((item) => row.values[item.key] || 0)])} />
    </figure>
  )
}

/** Proportions of a whole: `data` = [{ key, label, value }]. */
export function DonutChart({ data, title, centerLabel, size = 168 }) {
  const [hover, setHover] = useState(null)
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const arcs = useMemo(() => {
    let start = 0
    return data.map((item, index) => {
      const fraction = total ? item.value / total : 0
      const arc = { ...item, color: item.color || SERIES[index % SERIES.length], start, end: start + fraction }
      start += fraction
      return arc
    })
  }, [data, total])
  const r = 42
  const c = 2 * Math.PI * r
  const active = hover !== null ? arcs[hover] : null
  return (
    <figure className="flex min-w-0 flex-col items-center gap-4">
      <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title} className="shrink-0">
        <circle cx="60" cy="60" r={r} fill="none" stroke={GRID} strokeWidth="16" />
        {total > 0 && arcs.map((arc, index) => arc.value > 0 && (
          <circle key={arc.key} cx="60" cy="60" r={r} fill="none" stroke={arc.color} strokeWidth={hover === index ? 19 : 16}
            strokeDasharray={`${(arc.end - arc.start) * c} ${c}`} strokeDashoffset={-arc.start * c} transform="rotate(-90 60 60)"
            onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)} className="cursor-pointer transition-all" />))}
        <text x="60" y="58" textAnchor="middle" className="fill-ink font-display text-[18px] font-extrabold">{active ? active.value : total}</text>
        <text x="60" y="74" textAnchor="middle" className="fill-ink-muted text-[8.5px]">{active ? active.label : centerLabel}</text>
      </svg>
      <ul className="w-full min-w-0 space-y-1.5 text-sm">
        {arcs.map((arc, index) => (
          <li key={arc.key} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(null)}
            className={`flex items-center gap-2 rounded-lg px-2 py-1 ${hover === index ? 'bg-ground' : ''}`}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: arc.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-soft">{arc.label}</span>
            <span className="font-semibold tabular-nums">{arc.value}</span>
            <span className="w-11 text-right text-xs tabular-nums text-ink-muted">{total ? Math.round((arc.value / total) * 100) : 0}%</span>
          </li>))}
      </ul>
      <SrTable caption={title} columns={['Category', 'Count']} rows={arcs.map((arc) => [arc.label, arc.value])} />
    </figure>
  )
}

/** Ranked horizontal bars with a value label, e.g. enrollments per course. */
export function HBarList({ rows, max, formatValue = (v) => v, title, tone = 0 }) {
  const top = max ?? Math.max(1, ...rows.map((row) => row.value))
  return (
    <ul className="space-y-3" aria-label={title}>
      {rows.map((row) => (
        <li key={row.key} title={row.hint}>
          <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{formatValue(row.value)}{row.suffix && <span className="ml-1 text-xs font-normal text-ink-muted">{row.suffix}</span>}</span></div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(row.value / top) * 100}%`, background: SERIES[(row.tone ?? tone) % SERIES.length] }} />
          </div>
        </li>))}
    </ul>
  )
}

export const chartDate = shortDate
