import { Link, useParams } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import hljs from 'highlight.js'
import articles from '../data/blog-articles.js'
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
  const post = articles.find(a => a.slug === slug)

  if (!post) {
    return (
      <div className="blog-post-page">
        <Link to="/blog" className="blog-post-back">&larr; cd ..</Link>
        <div className="blog-empty">
          <div className="icon">&#128533;</div>
          <h3>Post not found</h3>
          <p>The article you&apos;re looking for doesn&apos;t exist.</p>
        </div>
      </div>
    )
  }

  return (
    <article className="blog-post-page">
      <Link to="/blog" className="blog-post-back">&larr; cd ..</Link>
      <header className="blog-post-header">
        <h1>{post.name}</h1>
        <div className="blog-post-meta">
          <time>{post.date}</time>
          {post.tags?.length > 0 && (
            <div className="blog-card-tags">
              {post.tags.map(t => <span key={t}>{t}</span>)}
            </div>
          )}
        </div>
      </header>
      <div className="blog-post-content">
        <p className="blog-post-desc">{post.description}</p>

        <Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={{ code: CodeBlock }}>{post.detail}</Markdown>

        {post.takeaway && (
          <div className="blog-post-takeaway">
            <p className="blog-takeaway-prompt">
              <span className="prompt-cv">❯</span> Takeaway
            </p>
            <p className="blog-takeaway-text">{post.takeaway}</p>
          </div>
        )}

        {post.images && post.images.length > 0 && (
          <div className="blog-post-images">
            {post.images.map((img, i) => (
              <img key={i} src={img} alt={`${post.name} screenshot ${i + 1}`} className="blog-post-img" loading="lazy" />
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
