import { useState } from 'react'
import { Link } from 'react-router-dom'
import './ActivityMap.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const tagKey = t => t.toLowerCase().replace(/[^a-z0-9]/g, '')
const fmtDate = d => {
  const [y, m, dd] = d.split('-').map(Number)
  return `${String(dd).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`
}

export default function ActivityMap({ items }) {
  const [hovered, setHovered] = useState(null)

  // ── bucket by day (skip invalid dates — JS would silently roll them over) ──
  const byDay = {}
  items.forEach(p => {
    const day = p.date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
    ;(byDay[day] = byDay[day] || []).push(p)
  })

  const days = Object.keys(byDay).sort()
  const first = days[0]
  const last = days[days.length - 1]
  const busiest = days.reduce((a, b) => (byDay[b].length > byDay[a].length ? b : a), days[0])

  // ── scoped day range (first activity → last activity, no blank wall) ──
  const dayRange = []
  {
    const cur = new Date(`${first}T00:00:00`)
    const end = new Date(`${last}T00:00:00`)
    while (cur <= end) {
      dayRange.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`)
      cur.setDate(cur.getDate() + 1)
    }
  }

  const nProjects = items.filter(i => i.kind === 'project').length
  const nPosts = items.filter(i => i.kind === 'post').length
  const stats = `${nProjects} projects · ${nPosts} posts · ${fmtDate(first)} → ${fmtDate(last)} · ${days.length} active days`
  const readout = hovered
    ? `${hovered.tags[0]} · ${fmtDate(hovered.date.slice(0, 10))} · ${hovered.name}`
    : stats
  const activeTags = [...new Set(items.flatMap(p => p.tags))]

  return (
    <div className="activity-map">
      <p className="discover-prompt activity-command">
        <span className="prompt-cv">❯</span>
        <span className="activity-cmd">activity --timeline</span>
      </p>

      <div className="activity-timeline">
        <div className="activity-cols">
          {dayRange.map(date => {
            const arts = byDay[date]
            const sorted = arts ? [...arts].sort((a, b) => a.date.localeCompare(b.date)) : null
            return (
              <div key={date} className="activity-day">
                {sorted && sorted.map(a => (
                  <Link
                    key={a.slug}
                    to={a.to}
                    className="activity-dot"
                    style={{ background: `var(--tag-${tagKey(a.tags[0])}, var(--accent-dark))` }}
                    aria-label={`${a.name} · ${fmtDate(a.date.slice(0, 10))} · ${a.tags[0]}`}
                    onMouseEnter={() => setHovered(a)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(a)}
                    onBlur={() => setHovered(null)}
                  />
                ))}
              </div>
            )
          })}
        </div>

        <div className="activity-datelabels">
          {dayRange.map((date, i) => (
            <div key={date} className={`activity-datelabel${byDay[date] ? ' has' : ''}`}>
              <span className="activity-month">
                {i === 0 || date.slice(5, 7) !== dayRange[i - 1].slice(5, 7) ? MONTHS[+date.slice(5, 7) - 1] : ''}
              </span>
              <span className="activity-daynum">{date.slice(8, 10)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="activity-legend">
        {activeTags.map(t => (
          <span key={t} className="activity-legend-tag">
            <span className="activity-legend-swatch" style={{ background: `var(--tag-${tagKey(t)}, var(--accent-dark))` }} />
            {t}
          </span>
        ))}
      </div>

      <p className="activity-readout">{readout}</p>
    </div>
  )
}
