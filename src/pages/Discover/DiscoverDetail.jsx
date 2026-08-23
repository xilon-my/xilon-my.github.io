import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import Terminal from '../../components/Terminal.jsx'
import MarkdownContent, { ContentImage, ContentToc, extractHeadings } from '../../components/MarkdownContent.jsx'
import projects from './projects.js'
import './Discover.css'

const projectLoaders = import.meta.glob('./projects/*.js')
const projectFiles = { pi: 'pi-agent' }

function LoadingProject({ slug }) {
  return (
    <div className="discover-page">
      <div className="container detail-container">
        <Terminal title="shannon@shannon.zone ~/discover %" showFooter={false}>
          <p className="discover-prompt" role="status">
            <span className="prompt-cv">❯</span> cat projects-i-like/{slug}.md
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

export default function DiscoverDetail() {
  const { slug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const projectMeta = projects.find(project => project.slug === slug)
  const [loadedProject, setLoadedProject] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const project = loadedProject?.slug === slug ? loadedProject.data : null
  const headings = useMemo(() => project?.detail ? extractHeadings(project.detail) : [], [project])
  const returnToDiscover = event => {
    if (!location.state?.fromDiscover || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(-1)
  }

  useEffect(() => {
    if (!projectMeta) return
    let active = true
    const file = projectFiles[slug] || slug
    const loader = projectLoaders[`./projects/${file}.js`]
    setLoadedProject(null)
    setLoadError(false)

    if (!loader) {
      setLoadError(true)
      return
    }

    loader()
      .then(module => { if (active) setLoadedProject({ slug, data: module.default }) })
      .catch(() => { if (active) setLoadError(true) })

    return () => { active = false }
  }, [slug, projectMeta])

  useEffect(() => {
    if (project) window.dispatchEvent(new Event('route-content-ready'))
  }, [project])

  if (!projectMeta || loadError) {
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
                <Link to="/discover" onClick={returnToDiscover} className="discover-back-link">← back to list</Link>
              </p>
            </div>
          </Terminal>
        </div>
      </div>
    )
  }

  if (!project) return <LoadingProject slug={slug} />

  return (
    <div className="discover-page">
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
          <Terminal title="shannon@shannon.zone ~/discover %">
          <Link to="/discover" onClick={returnToDiscover} className="discover-detail-back">← cd ..</Link>

          <div className="discover-detail-header">
            <p className="discover-prompt">
              <span className="prompt-cv">❯</span> cat projects-i-like/{project.slug}.md
            </p>
          </div>

          <div className="discover-detail-meta">
            <h1 className="discover-detail-name" tabIndex="-1">{project.name}</h1>
            <div className="discover-card-tags" style={{ marginTop: 8 }}>
              {project.tags.map(tag => <span key={tag}>{tag}</span>)}
            </div>
            <div className="discover-detail-info">
              {project.date && <span><span className="detail-label">date</span> {project.date}</span>}
              {project.author && <span><span className="detail-label">author</span> {project.author}</span>}
              {project.stars && <span><span className="detail-label">stars</span> {project.stars}</span>}
            </div>
          </div>

          <div className="discover-detail-links">
            {[project.url, project.url2].filter(Boolean).map(url => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="discover-detail-gh-link"
              >
                <span className="prompt-cv">❯</span>{' '}
                {url.startsWith('https://github.com/') ? `github.com/${url.replace('https://github.com/', '')}` : url}
                <span className="discover-card-arrow" aria-hidden="true"> ↗</span>
              </a>
            ))}
          </div>

          <div className="discover-detail-body">
            <p className="discover-detail-desc">{project.description}</p>

            <div className="discover-detail-content">
              <MarkdownContent source={project.detail} />
            </div>

            {project.takeaway && (
              <div className="discover-takeaway">
                <p className="discover-prompt">
                  <span className="prompt-cv">❯</span> Takeaway
                </p>
                <p className="discover-takeaway-text">{project.takeaway}</p>
              </div>
            )}

            {project.images?.length > 0 && (
              <div className="discover-detail-images">
                {project.images.map((src, index) => (
                  <ContentImage key={src} src={src} alt={`${project.name} screenshot ${index + 1}`} className="discover-detail-img" />
                ))}
              </div>
            )}
          </div>

          <nav className="article-end-nav discover-end-nav" aria-label="项目导航">
            <Link to="/discover" onClick={returnToDiscover} className="article-end-back">← cd ..</Link>
          </nav>
          </Terminal>
        </div>
      </div>
    </div>
  )
}
