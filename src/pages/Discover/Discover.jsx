import { useState } from 'react'
import { Link } from 'react-router-dom'
import Terminal from '../../components/Terminal.jsx'
import projects from './projects.js'
import './Discover.css'

export default function Discover() {
  const [activeTag, setActiveTag] = useState(null)
  const allTags = [...new Set(projects.flatMap(p => p.tags))].sort()
  const filtered = activeTag ? projects.filter(p => p.tags.includes(activeTag)) : projects

  return (
    <div className="discover-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/discover %">
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
                <span className="filter-cmd">cat projects-i-like.md</span>
                {activeTag && <span className="filter-pipe">|</span>}
                {activeTag && <span className="filter-grep">grep</span>}
                <span className={`filter-tag ${activeTag === null ? 'active' : ''}`} onClick={() => setActiveTag(null)}>
                  --all
                </span>
                {allTags.map(t => (
                  <span
                    key={t}
                    className={`filter-tag ${activeTag === t ? 'active' : ''}`}
                    onClick={() => setActiveTag(t)}
                  >
                    --{t.toLowerCase()}
                  </span>
                ))}
              </p>
              <p className="discover-count">{filtered.length} items</p>
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="discover-empty">
              <p>No projects with tag &lsquo;{activeTag}&rsquo;.</p>
            </div>
          ) : (
            <div className="discover-list" key={activeTag || 'all'}>
              {filtered.map(p => (
                <Link key={p.slug} to={`/discover/${p.slug}`} className="discover-row">
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
