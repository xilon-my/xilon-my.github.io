import { Link, useSearchParams } from 'react-router-dom'
import Terminal from '../../components/Terminal.jsx'
import projects from './projects.js'
import './Discover.css'

export default function Discover() {
  const [searchParams, setSearchParams] = useSearchParams()
  const allTags = [...new Set(projects.flatMap(p => p.tags))].sort()
  const requestedTag = searchParams.get('tag')
  const activeTag = allTags.includes(requestedTag) ? requestedTag : null
  const filtered = activeTag ? projects.filter(p => p.tags.includes(activeTag)) : projects
  const selectTag = tag => {
    const next = new URLSearchParams(searchParams)
    if (tag) next.set('tag', tag)
    else next.delete('tag')
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="discover-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/discover %">
          <h1 className="sr-only" tabIndex="-1">Discover</h1>
          <div className="discover-header">
            <p className="discover-prompt">
              <span className="prompt-cv">❯</span> <span className="typewriter">cat projects-i-like.md</span>
            </p>
            <p className="discover-sub">
              Cool open-source projects I&rsquo;ve come across &mdash; tools, frameworks, and ideas worth sharing.
            </p>
            <div className="discover-tag-filter">
              <p className="discover-prompt">
                <span className="prompt-cv">❯</span>
                <span className="filter-cmd">filter --tag</span>
              </p>
              <div className="filter-options" role="group" aria-label="按标签筛选项目">
                <button
                  type="button"
                  className={`filter-tag ${activeTag === null ? 'active' : ''}`}
                  onClick={() => selectTag(null)}
                  aria-pressed={activeTag === null}
                >
                  --all
                </button>
                {allTags.map(t => (
                  <button
                    type="button"
                    key={t}
                    className={`filter-tag ${activeTag === t ? 'active' : ''}`}
                    onClick={() => selectTag(t)}
                    aria-pressed={activeTag === t}
                  >
                    --{t.toLowerCase()}
                  </button>
                ))}
              </div>
              <p className="discover-count" aria-live="polite">{filtered.length} items</p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="discover-empty">
              <p>No projects with tag &lsquo;{activeTag}&rsquo;.</p>
            </div>
          ) : (
            <div className="discover-list" key={activeTag || 'all'}>
              {filtered.map(p => (
                <Link
                  key={p.slug}
                  id={`discover-entry-${p.slug}`}
                  to={`/discover/${p.slug}`}
                  state={{ fromDiscover: true }}
                  className="discover-row"
                >
                  <div className="discover-row-line">
                    <span className="discover-row-index">❯ {String(projects.indexOf(p) + 1).padStart(2, '0')}</span>
                    <span className="discover-row-name">{p.name}</span>
                    <span className="discover-row-arrow">→</span>
                    <span className="discover-row-tags">{p.tags.map(t => <span key={t}>[{t}]</span>)}</span>
                    <span className="discover-row-date">{p.date.slice(5, 10)}</span>
                  </div>
                  <p className="discover-row-desc">{p.description}</p>
                </Link>
              ))}
            </div>
          )}
        </Terminal>
      </div>
    </div>
  )
}
