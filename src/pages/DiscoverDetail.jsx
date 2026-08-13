import { useParams, Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import hljs from 'highlight.js'
import Terminal from '../components/Terminal.jsx'
import projects from '../data/discover-projects.js'
import './Discover.css'

function CodeBlock({ className, children }) {
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')

  if (lang === 'markdown') {
    const fm = code.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
    if (fm) {
      const yamlHtml = hljs.highlight(fm[1], { language: 'yaml' }).value
      const mdHtml = hljs.highlight(fm[2], { language: 'markdown' }).value
      return <code className={className} dangerouslySetInnerHTML={{
        __html: `---\n${yamlHtml}\n---\n\n${mdHtml}`
      }} />
    }
  }

  if (lang && hljs.getLanguage(lang)) {
    return <code className={className} dangerouslySetInnerHTML={{
      __html: hljs.highlight(code, { language: lang }).value
    }} />
  }

  return <code className={className}>{children}</code>
}

export default function DiscoverDetail() {
  const { slug } = useParams()
  const project = projects.find(p => p.slug === slug)

  if (!project) {
    return (
      <div className="discover-page">
        <div className="container">
          <Terminal title="shannon@shannon.zone ~/discover %">
            <div className="discover-empty">
              <p className="discover-prompt" style={{ marginBottom: 12 }}>
                <span className="prompt-cv">❯</span> cat projects-i-like/{slug}.md
              </p>
              <p style={{ color: 'var(--red)' }}>project not found: {slug}</p>
              <p style={{ marginTop: 16 }}>
                <Link to="/discover" className="discover-back-link">← back to list</Link>
              </p>
            </div>
          </Terminal>
        </div>
      </div>
    )
  }

  return (
    <div className="discover-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/discover %">
          {/* ── Back link ── */}
          <Link to="/discover" className="discover-detail-back">← cd ..</Link>

          {/* ── Header ── */}
          <div className="discover-detail-header">
            <p className="discover-prompt">
              <span className="prompt-cv">❯</span> cat projects-i-like/{project.slug}.md
            </p>
          </div>

          {/* ── Project meta ── */}
          <div className="discover-detail-meta">
            <h1 className="discover-detail-name">{project.name}</h1>
            <div className="discover-card-tags" style={{ marginTop: 8 }}>
              {project.tags.map(t => <span key={t}>{t}</span>)}
            </div>
            <div className="discover-detail-info">
              {project.date && <span><span className="detail-label">date</span> {project.date}</span>}
              {project.author && <span><span className="detail-label">author</span> {project.author}</span>}
              {project.stars && <span><span className="detail-label">stars</span> {project.stars}</span>}
            </div>
          </div>

          {/* ── Project link ── */}
          <div className="discover-detail-links">
            <a
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              className="discover-detail-gh-link"
            >
              <span className="prompt-cv">❯</span> {project.url.startsWith('https://github.com/') ? 'github.com/' + project.url.replace('https://github.com/', '') : project.url}
              <span className="discover-card-arrow"> ↗</span>
            </a>
            {project.url2 && (
              <a
                href={project.url2}
                target="_blank"
                rel="noopener noreferrer"
                className="discover-detail-gh-link"
              >
                <span className="prompt-cv">❯</span> {project.url2.startsWith('https://github.com/') ? 'github.com/' + project.url2.replace('https://github.com/', '') : project.url2}
                <span className="discover-card-arrow"> ↗</span>
              </a>
            )}
          </div>

          {/* ── Description ── */}
          <div className="discover-detail-body">
            <p className="discover-detail-desc">{project.description}</p>

            <div className="discover-detail-content">
              <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock }}>{project.detail}</Markdown>
            </div>

            {project.takeaway && (
              <div className="discover-takeaway">
                <p className="discover-prompt">
                  <span className="prompt-cv">❯</span> Takeaway
                </p>
                <p className="discover-takeaway-text">{project.takeaway}</p>
              </div>
            )}

            {project.images && project.images.length > 0 && (
              <div className="discover-detail-images">
                {project.images.map((img, i) => (
                  <img key={i} src={img} alt={`${project.name} screenshot ${i + 1}`} className="discover-detail-img" loading="lazy" />
                ))}
              </div>
            )}
          </div>
        </Terminal>
      </div>
    </div>
  )
}
