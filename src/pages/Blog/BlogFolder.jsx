import { Link } from 'react-router-dom'
import Terminal from '../../components/Terminal.jsx'
import BlogList from './BlogList.jsx'
import articles, { folders } from './articles.js'
import '../Discover/Discover.css'
import './Blog.css'

export default function BlogFolder({ folderSlug }) {
  const folder = folders[folderSlug]
  if (!folder) return null

  const files = articles.filter(a => a.folder === folderSlug).map(a => ({
    kind: 'file',
    slug: a.slug,
    title: a.name,
    tag: a.tags[0],
    date: a.date,
    to: `/blog/${a.slug}`,
  })).sort((a, b) => b.date.localeCompare(a.date))

  return (
    <div className="blog-page">
      <div className="container">
        <Terminal title={`shannon@shannon.zone ~/blog/${folderSlug} %`}>
          <Link to="/blog" className="discover-detail-back">&larr; cd ..</Link>
          <div className="blog-header">
            <p className="blog-prompt">
              <span className="prompt-cv">❯</span> <span className="typewriter">ls</span>
            </p>
          </div>
          <BlogList entries={files} />
          <p className="blog-stats">{files.length} files · {folder.desc}</p>
        </Terminal>
      </div>
    </div>
  )
}
