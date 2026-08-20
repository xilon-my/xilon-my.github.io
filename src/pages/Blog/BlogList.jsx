import { Link } from 'react-router-dom'
import articles from './articles.js'
import './Blog.css'

const categories = ['all', ...new Set(articles.map(p => p.category).filter(Boolean))]

// ── category → accent color (left bar on each card) ──
const CAT_COLORS = {
  'Project': 'var(--green)',
  'Course Review': 'var(--yellow)',
}

export default function BlogList({ limit, category: activeCategory }) {
  const filtered = activeCategory && activeCategory !== 'all'
    ? articles.filter(p => p.category === activeCategory)
    : articles
  const shown = limit ? filtered.slice(0, limit) : filtered

  if (shown.length === 0) {
    return (
      <div className="blog-empty">
        <div className="icon">&#128221;</div>
        <h3>Coming soon</h3>
        <p>No posts yet in this category.</p>
      </div>
    )
  }

  return (
    <div className="blog-grid">
      {shown.map(post => {
        const num = String(articles.indexOf(post) + 1).padStart(2, '0')
        return (
          <Link
            key={post.slug}
            to={`/blog/${post.slug}`}
            className="blog-card"
            style={{ '--cat-color': CAT_COLORS[post.category] || 'var(--border)' }}
          >
            <div className="blog-card-top">
              <span className="blog-card-num">{num}</span>
              <span className="blog-card-arrow">→</span>
              <time className="blog-card-date">{post.date.slice(0, 10)}</time>
            </div>
            <h2>{post.name}</h2>
            <p className="blog-card-desc">{post.description}</p>
            {post.tags?.length > 0 && (
              <div className="blog-card-tags">
                {post.tags.map(t => <span key={t}>{t}</span>)}
              </div>
            )}
          </Link>
        )
      })}
    </div>
  )
}

export function BlogFilter({ current, onChange }) {
  return (
    <div className="blog-filter">
      {categories.map(cat => {
        const n = cat === 'all' ? articles.length : articles.filter(a => a.category === cat).length
        return (
          <button
            key={cat}
            className={`blog-filter-btn ${cat === current ? 'active' : ''}`}
            onClick={() => onChange(cat)}
          >
            {cat === 'all' ? 'All' : cat} <span className="blog-filter-count">{n}</span>
          </button>
        )
      })}
    </div>
  )
}
