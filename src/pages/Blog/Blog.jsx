import { useState } from 'react'
import BlogList, { BlogFilter } from './BlogList.jsx'
import Terminal from '../../components/Terminal.jsx'
import './Blog.css'

export default function BlogPage() {
  const [category, setCategory] = useState('all')

  return (
    <div className="blog-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/blog %">
          <div className="blog-header">
            <p className="blog-prompt"><span className="prompt-cv">❯</span> <span className="typewriter">ls posts/</span></p>
            <p className="blog-sub">Projects, notes, and things I've learned.</p>
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
