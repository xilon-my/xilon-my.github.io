import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import hljs from 'highlight.js'
import Terminal from '../../components/Terminal.jsx'
import articles, { folders } from './articles.js'
import BlogFolder from './BlogFolder.jsx'
import '../Discover/Discover.css'
import './Blog.css'

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

export default function BlogPost() {
  const { slug } = useParams()

  // slug 命中子目录 → 渲染目录页(终端 title 变成 ~/blog/rl-math %)
  if (folders[slug]) return <BlogFolder folderSlug={slug} />

  const post = articles.find(a => a.slug === slug)

  if (!post) {
    return (
      <div className="blog-page">
        <div className="container">
          <Terminal title="shannon@shannon.zone ~/blog %">
            <div className="discover-empty">
              <p className="discover-prompt" style={{ marginBottom: 12 }}>
                <span className="prompt-cv">❯</span> cat {slug}.md
              </p>
              <p style={{ color: 'var(--red)' }}>post not found: {slug}</p>
              <p style={{ marginTop: 16 }}>
                <Link to="/blog" className="discover-back-link">← back to list</Link>
              </p>
            </div>
          </Terminal>
        </div>
      </div>
    )
  }

  const backTo = post.folder ? `/blog/${post.folder}` : '/blog'
  const catPath = post.folder ? `${post.folder}/${post.slug}.md` : `${post.slug}.md`
  const pwd = post.folder ? `~/blog/${post.folder}` : '~/blog'

  return (
    <div className="blog-page">
      <div className="container">
        <Terminal title={`shannon@shannon.zone ${pwd} %`}>
          {/* ── Back link ── */}
          <Link to={backTo} className="discover-detail-back">&larr; cd ..</Link>

          {/* ── Header ── */}
          <div className="discover-detail-header">
            <p className="discover-prompt">
              <span className="prompt-cv">❯</span> cat {catPath}
            </p>
          </div>

          {/* ── Post meta ── */}
          <div className="discover-detail-meta">
            <h1 className="discover-detail-name">{post.name}</h1>
            <div className="discover-card-tags" style={{ marginTop: 8 }}>
              {post.tags.map(t => <span key={t}>{t}</span>)}
            </div>
            <div className="discover-detail-info">
              <span><span className="detail-label">date</span> {post.date}</span>
              {post.author && <span><span className="detail-label">author</span> {post.author}</span>}
              {post.category && <span><span className="detail-label">category</span> {post.category}</span>}
            </div>
          </div>

          {/* ── Body ── */}
          <div className="discover-detail-body">
            <p className="discover-detail-desc">{post.description}</p>

            <div className="discover-detail-content">
              <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock }}>{post.detail}</Markdown>
            </div>

            {post.takeaway && (
              <div className="discover-takeaway">
                <p className="discover-prompt">
                  <span className="prompt-cv">❯</span> Takeaway
                </p>
                <p className="discover-takeaway-text">{post.takeaway}</p>
              </div>
            )}

            {post.images && post.images.length > 0 && (
              <div className="discover-detail-images">
                {post.images.map((img, i) => (
                  <img key={i} src={img} alt={`${post.name} screenshot ${i + 1}`} className="discover-detail-img" loading="lazy" />
                ))}
              </div>
            )}
          </div>
        </Terminal>
      </div>
    </div>
  )
}
