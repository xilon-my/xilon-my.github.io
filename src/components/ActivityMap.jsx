import { useState } from 'react'
import './ActivityMap.css'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const VIEW_WEEKS = 6

const tagKey = tag => tag.toLowerCase().replace(/[^a-z0-9]/g, '')
const parseDay = day => new Date(`${day}T00:00:00Z`)
const isoDay = date => date.toISOString().slice(0, 10)
const addDays = (date, count) => {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + count)
  return next
}
const fmtDate = day => {
  const [year, month, date] = day.split('-').map(Number)
  return `${String(date).padStart(2, '0')} ${MONTHS[month - 1]} ${year}`
}
const fmtWeek = day => {
  const [, month, date] = day.split('-').map(Number)
  return `${MONTHS[month - 1]} ${String(date).padStart(2, '0')}`
}

export default function ActivityMap({ items }) {
  const [hovered, setHovered] = useState(null)
  const [selectedDay, setSelectedDay] = useState(null)

  if (items.length === 0) return null

  const allByDay = {}
  items.forEach(item => {
    const day = item.date.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return
    ;(allByDay[day] = allByDay[day] || []).push(item)
  })

  const allActiveDays = Object.keys(allByDay).sort()
  if (allActiveDays.length === 0) return null

  const last = allActiveDays[allActiveDays.length - 1]
  const lastDate = parseDay(last)
  const sundayOffset = 6 - ((lastDate.getUTCDay() + 6) % 7)
  const calendarEnd = addDays(lastDate, sundayOffset)
  const calendarStart = addDays(calendarEnd, -(VIEW_WEEKS * 7 - 1))
  const first = isoDay(calendarStart)
  const byDay = Object.fromEntries(
    Object.entries(allByDay).filter(([day]) => day >= first && day <= last),
  )
  const activeDays = Object.keys(byDay).sort()
  const visibleItems = Object.values(byDay).flat()
  const weeks = []

  for (let weekStart = calendarStart; weekStart <= calendarEnd; weekStart = addDays(weekStart, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, index) => isoDay(addDays(weekStart, index))))
  }

  const nProjects = visibleItems.filter(item => item.kind === 'project').length
  const nPosts = visibleItems.filter(item => item.kind === 'post').length
  const stats = `latest ${VIEW_WEEKS} weeks · ${nProjects} projects · ${nPosts} posts · ${activeDays.length} active days · ${fmtDate(first)} → ${fmtDate(last)}`
  const selectedItems = selectedDay ? byDay[selectedDay] || [] : []
  const readout = hovered
    ? `${hovered.tags[0]} · ${fmtDate(hovered.date.slice(0, 10))} · ${hovered.name}`
    : selectedItems.length
      ? `${fmtDate(selectedDay)} · ${selectedItems.map(item => `[${item.tags[0]}] ${item.name}`).join(' · ')}`
      : stats
  const activeTags = [...new Set(visibleItems.flatMap(item => item.tags))]

  return (
    <section className="activity-map" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="activity-command">
        <span className="prompt-cv">❯</span>
        <span className="activity-cmd">cat activity.md</span>
      </h2>
      <p className="sr-only">{stats}</p>

      <div className="activity-calendar" aria-label="Activity by week">
        <div className="activity-weekdays" aria-hidden="true">
          <span className="activity-week-axis">week</span>
          {WEEKDAYS.map(day => <span key={day}>{day}</span>)}
        </div>

        <div className="activity-weeks">
          {weeks.map(week => (
            <div key={week[0]} className="activity-week">
              <span className="activity-week-label" aria-hidden="true">{fmtWeek(week[0])}</span>
              {week.map(date => {
                const dayItems = byDay[date]
                  ? [...byDay[date]].sort((a, b) => a.date.localeCompare(b.date))
                  : []
                const outsideRange = date < first || date > last

                const cellContent = (
                  <>
                    <time dateTime={date} className="activity-date" aria-hidden="true">{date.slice(8, 10)}</time>
                    <span className="activity-marks">
                      {dayItems.map(item => (
                        <span
                          key={`${item.kind}-${item.slug}`}
                          className="activity-mark"
                          style={{ background: `var(--tag-${tagKey(item.tags[0])}, var(--accent-dark))` }}
                          title={`${item.tags[0]} · ${item.name}`}
                          onMouseEnter={() => setHovered(item)}
                          onMouseLeave={() => setHovered(null)}
                        />
                      ))}
                    </span>
                  </>
                )

                return dayItems.length ? (
                  <button
                    key={date}
                    type="button"
                    className={`activity-cell has-activity${selectedDay === date ? ' is-selected' : ''}`}
                    aria-label={`${fmtDate(date)}: ${dayItems.map(item => `${item.tags[0]}, ${item.name}`).join('; ')}`}
                    aria-pressed={selectedDay === date}
                    onClick={() => setSelectedDay(date)}
                    onFocus={() => setSelectedDay(date)}
                  >
                    {cellContent}
                  </button>
                ) : (
                  <div
                    key={date}
                    className={`activity-cell${outsideRange ? ' outside-range' : ''}`}
                    aria-hidden="true"
                  >
                    {cellContent}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="activity-meta">
        <div className="activity-legend" aria-hidden="true">
          {activeTags.map(tag => (
            <span key={tag} className="activity-legend-tag">
              <span className="activity-legend-swatch" style={{ background: `var(--tag-${tagKey(tag)}, var(--accent-dark))` }} />
              {tag}
            </span>
          ))}
        </div>
        <p className="activity-readout" aria-live="polite">{readout}</p>
      </div>
    </section>
  )
}
