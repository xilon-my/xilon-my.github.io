import { Link } from 'react-router-dom'
import './Blog.css'

const MODE_DIR = 'drwxr-xr-x'
const MODE_FILE = '-rw-r--r--'

// entries: file → { kind:'file', slug, title, tag, date, desc, to }
//          dir  → { kind:'dir', name, count, desc, to }
export default function BlogList({ entries }) {
  if (entries.length === 0) {
    return (
      <div className="blog-empty">
        <div className="icon">&#128221;</div>
        <h3>Coming soon</h3>
        <p>No posts yet here.</p>
      </div>
    )
  }

  return (
    <div className="blog-ls">
      {entries.map(e => (
        <Link key={e.kind === 'dir' ? e.name : e.slug} to={e.to} className="blog-ls-row">
          <div className="blog-ls-line">
            <span className="blog-ls-mode">{e.kind === 'dir' ? MODE_DIR : MODE_FILE}</span>
            <span className={`blog-ls-name${e.kind === 'dir' ? ' dir' : ''}`}>
              {e.kind === 'dir' ? `${e.name}/` : e.title}
            </span>
            {e.kind === 'file' && e.tag && <span className="blog-card-tag">[{e.tag}]</span>}
            {e.kind === 'dir'
              ? <span className="blog-ls-count">{e.count} items</span>
              : <time className="blog-ls-date">{e.date.slice(5, 10)}</time>}
          </div>
          <p className="blog-ls-desc">{e.desc}</p>
        </Link>
      ))}
    </div>
  )
}
