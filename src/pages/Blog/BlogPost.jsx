import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Terminal from '../../components/Terminal.jsx'
import MarkdownContent, { ContentImage, ContentToc, extractHeadings } from '../../components/MarkdownContent.jsx'
import articles, { folders } from './articles.js'
import BlogFolder from './BlogFolder.jsx'
import '../Discover/Discover.css'
import './Blog.css'

const articleLoaders = import.meta.glob('./articles/*.js')

function SeriesNavigation({ postMeta, backTo }) {
  const series = postMeta.folder
    ? articles
      .filter(article => article.folder === postMeta.folder)
      .sort((a, b) => a.seriesOrder - b.seriesOrder)
    : []
  const index = series.findIndex(article => article.slug === postMeta.slug)
  const previous = index > 0 ? series[index - 1] : null
  const next = index >= 0 && index < series.length - 1 ? series[index + 1] : null

  return (
    <nav className="article-end-nav" aria-label="文章导航">
      <Link to={backTo} className="article-end-back">← cd ..</Link>
      {previous && (
        <Link to={`/blog/${previous.slug}`} className="article-series-link article-series-previous">
          <span>上一篇</span>
          <strong>{previous.name}</strong>
        </Link>
      )}
      {next && (
        <Link to={`/blog/${next.slug}`} className="article-series-link article-series-next">
          <span>下一篇</span>
          <strong>{next.name}</strong>
        </Link>
      )}
    </nav>
  )
}

function LoadingPost({ title, catPath }) {
  return (
    <div className="blog-page">
      <div className="container detail-container">
        <Terminal title={title} showFooter={false}>
          <p className="discover-prompt" role="status">
            <span className="prompt-cv">❯</span> cat {catPath}
          </p>
          <div className="detail-loading" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </Terminal>
      </div>
    </div>
  )
}

export default function BlogPost() {
  const { slug } = useParams()
  const postMeta = articles.find(article => article.slug === slug)
  const [loadedPost, setLoadedPost] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const post = loadedPost?.slug === slug ? loadedPost.data : null

  useEffect(() => {
    if (folders[slug] || !postMeta) return
    let active = true
    const loader = articleLoaders[`./articles/${slug}.js`]
    setLoadedPost(null)
    setLoadError(false)

    if (!loader) {
      setLoadError(true)
      return
    }

    loader()
      .then(module => { if (active) setLoadedPost({ slug, data: module.default }) })
      .catch(() => { if (active) setLoadError(true) })

    return () => { active = false }
  }, [slug, postMeta])

  useEffect(() => {
    if (post) window.dispatchEvent(new Event('route-content-ready'))
  }, [post])

  const headings = useMemo(() => post?.detail ? extractHeadings(post.detail) : [], [post])

  if (folders[slug]) return <BlogFolder folderSlug={slug} />

  if (!postMeta || loadError) {
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

  const backTo = postMeta.folder ? `/blog/${postMeta.folder}` : '/blog'
  const catPath = postMeta.folder ? `${postMeta.folder}/${postMeta.slug}.md` : `${postMeta.slug}.md`
  const pwd = postMeta.folder ? `~/blog/${postMeta.folder}` : '~/blog'

  if (!post) return <LoadingPost title={`shannon@shannon.zone ${pwd} %`} catPath={catPath} />

  const series = postMeta.folder
    ? articles.filter(article => article.folder === postMeta.folder).sort((a, b) => a.seriesOrder - b.seriesOrder)
    : []
  const seriesIndex = series.findIndex(article => article.slug === postMeta.slug)

  return (
    <div className="blog-page">
      <div className={`container detail-container${headings.length >= 2 ? ' has-outline' : ''}`}>
        {headings.length >= 2 && (
          <aside className="detail-outline" aria-label="文章目录">
            <div className="detail-outline-rail">
              <ContentToc headings={headings} variant="rail" />
            </div>
            <div className="detail-outline-inline">
              <ContentToc headings={headings} />
            </div>
          </aside>
        )}

        <div className="detail-terminal-column">
          <Terminal title={`shannon@shannon.zone ${pwd} %`}>
          <Link to={backTo} className="discover-detail-back">&larr; cd ..</Link>

          <div className="discover-detail-header">
            <p className="discover-prompt">
              <span className="prompt-cv">❯</span> cat {catPath}
            </p>
          </div>

          <div className="discover-detail-meta">
            <h1 className="discover-detail-name" tabIndex="-1">{post.name}</h1>
            <div className="discover-card-tags" style={{ marginTop: 8 }}>
              {post.tags.map(tag => <span key={tag}>{tag}</span>)}
            </div>
            <div className="discover-detail-info">
              <span><span className="detail-label">date</span> {post.date}</span>
              {post.author && <span><span className="detail-label">author</span> {post.author}</span>}
              {post.category && <span><span className="detail-label">category</span> {post.category}</span>}
              {seriesIndex >= 0 && <span><span className="detail-label">series</span> {seriesIndex + 1}/{series.length}</span>}
            </div>
          </div>

          <div className="discover-detail-body">
            <p className="discover-detail-desc">{post.description}</p>

            <div className="discover-detail-content">
              <MarkdownContent source={post.detail} />
            </div>

            {post.takeaway && (
              <div className="discover-takeaway">
                <p className="discover-prompt">
                  <span className="prompt-cv">❯</span> Takeaway
                </p>
                <p className="discover-takeaway-text">{post.takeaway}</p>
              </div>
            )}

            {post.images?.length > 0 && (
              <div className="discover-detail-images">
                {post.images.map((src, index) => (
                  <ContentImage key={src} src={src} alt={`${post.name} screenshot ${index + 1}`} className="discover-detail-img" />
                ))}
              </div>
            )}
          </div>

          <SeriesNavigation postMeta={postMeta} backTo={backTo} />
          </Terminal>
        </div>
      </div>
    </div>
  )
}
