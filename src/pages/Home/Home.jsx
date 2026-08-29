import { useState, useEffect } from 'react'
import Terminal from '../../components/Terminal.jsx'
import ActivityMap from '../../components/ActivityMap.jsx'
import projects from '../Discover/projects.js'
import articles from '../Blog/articles.js'
import './Home.css'

const taglines = [
  'six-dimensional force sensing',
  'agents for real software systems',
  'small on-device models that call tools',
  'reinforcement learning from first principles',
]

const activities = [
  ...projects.map(project => ({ ...project, kind: 'project' })),
  ...articles.map(article => ({ ...article, kind: 'post' })),
].sort((a, b) => b.date.localeCompare(a.date))

export default function Home() {
  const [tagIndex, setTagIndex] = useState(0)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timer
    const updateRotation = () => {
      clearInterval(timer)
      if (!media.matches) {
        timer = setInterval(() => {
          setTagIndex(i => (i + 1) % taglines.length)
        }, 3000)
      }
    }

    updateRotation()
    media.addEventListener?.('change', updateRotation)
    return () => {
      clearInterval(timer)
      media.removeEventListener?.('change', updateRotation)
    }
  }, [])

  return (
    <div className="home">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~ %" glow>

          {/* ─── Intro ─── */}
          <div className="intro">
            <p className="prompt">
              <span className="prompt-sign">❯</span> whoami
            </p>
            <h1 className="name">Shannon Zhang</h1>
            <p className="desc">
              M.S. in Electronic Information @ Tsinghua University · B.S. @ Xiamen University
            </p>
            <div className="working-section">
              <p className="prompt">
                <span className="prompt-sign">❯</span> cat working-on.md
              </p>
              <p className="tag-rotator">{taglines[tagIndex]}</p>
            </div>
          </div>

          {/* ─── Contact ─── */}
          <div className="about-section contact-section">
            <p className="prompt">
              <span className="prompt-sign">❯</span> cat contact.md
            </p>
            <div className="contact-block">
              <a href="https://github.com/xilon-my" target="_blank" rel="noopener noreferrer" className="contact-item">
                <span className="contact-icon">❯</span>
                github.com/xilon-my
              </a>
              <a href="mailto:3422647204@qq.com" className="contact-item">
                <span className="contact-icon">❯</span>
                3422647204@qq.com
              </a>
            </div>
          </div>

          {/* ─── About ─── */}
          <div className="about-section">
            <p className="prompt">
              <span className="prompt-sign">❯</span> cat about.md
            </p>
            <div className="about-content">
              <p>Born 2003.08.24 in China · ISTP · fitness enthusiast</p>
              <p>My wish is to do interesting things.</p>
            </div>
          </div>

          <div className="term-divider">
            <ActivityMap items={activities} />
          </div>
        </Terminal>
      </div>
    </div>
  )
}
