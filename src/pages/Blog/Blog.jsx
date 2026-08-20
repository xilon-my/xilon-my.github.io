import { useState } from 'react'
import BlogList, { BlogFilter } from './BlogList.jsx'
import Terminal from '../../components/Terminal.jsx'
import articles from './articles.js'
import './Blog.css'

const fmt = d => `${d.slice(5, 7)}.${d.slice(8, 10)}`

export default function BlogPage() {
  const [category, setCategory] = useState('all')

  const dates = articles.map(a => a.date.slice(0, 10)).sort()
  const nCats = new Set(articles.map(a => a.category).filter(Boolean)).size
  const stats = `${articles.length} posts · ${nCats} categories · ${fmt(dates[0])} → ${fmt(dates[dates.length - 1])}`

  return (
    <div className="blog-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/blog %">
          <div className="blog-header">
            <p className="blog-prompt"><span className="prompt-cv">❯</span> <span className="typewriter">ls posts/</span></p>
            <p className="blog-sub">Projects, notes, and things I've learned.</p>
            <p className="blog-stats">{stats}</p>
          </div>
          <div className="blog-content">
            <BlogFilter current={category} onChange={setCategory} />
            <BlogList category={category} />
          </div>
        </Terminal>
      </div>
    </div>
  )
}
