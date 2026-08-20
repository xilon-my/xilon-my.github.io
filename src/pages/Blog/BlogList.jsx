import { Link } from 'react-router-dom'
import articles from './articles.js'
import './Blog.css'

const categories = ['all', ...new Set(articles.map(p => p.category).filter(Boolean))]

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
      {shown.map(post => (
        <Link key={post.slug} to={`/blog/${post.slug}`} className="blog-card">
          <div className="blog-card-meta">
            <time>{post.date}</time>
            {post.category && <span className="blog-category">{post.category}</span>}
            {post.tags?.[0] && <span className="blog-card-tag">[{post.tags[0]}]</span>}
          </div>
          <h2>{post.name}</h2>
          <p>{post.description}</p>
        </Link>
      ))}
    </div>
  )
}

export function BlogFilter({ current, onChange }) {
  return (
    <div className="blog-filter">
      {categories.map(cat => (
        <button
          key={cat}
          className={`blog-filter-btn ${cat === current ? 'active' : ''}`}
          onClick={() => onChange(cat)}
        >
          {cat === 'all' ? 'All' : cat}
        </button>
      ))}
    </div>
  )
}
