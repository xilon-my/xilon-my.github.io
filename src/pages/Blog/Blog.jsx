import Terminal from '../../components/Terminal.jsx'
import BlogList from './BlogList.jsx'
import articles, { folders } from './articles.js'
import './Blog.css'

export default function BlogPage() {
  const dirs = Object.entries(folders).map(([slug, f]) => ({
    kind: 'dir',
    name: f.name,
    count: articles.filter(a => a.folder === slug).length,
    to: `/blog/${slug}`,
  })).sort((a, b) => a.name.localeCompare(b.name))

  const files = articles.filter(a => !a.folder).map(a => ({
    kind: 'file',
    slug: a.slug,
    title: a.name,
    tag: a.tags[0],
    date: a.date,
    to: `/blog/${a.slug}`,
  })).sort((a, b) => b.date.localeCompare(a.date))

  const nFile = files.length
  const nDir = dirs.length
  const nTotal = articles.length

  return (
    <div className="blog-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/blog %">
          <div className="blog-header">
            <p className="blog-prompt">
              <span className="prompt-cv">❯</span> <span className="typewriter">ls</span>
            </p>
          </div>
          <BlogList entries={[...dirs, ...files]} />
          <p className="blog-stats">{nFile} files · {nDir} {nDir === 1 ? 'directory' : 'directories'} · {nTotal} posts</p>
        </Terminal>
      </div>
    </div>
  )
}
