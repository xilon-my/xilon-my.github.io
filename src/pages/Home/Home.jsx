import { useState, useEffect } from 'react'
import Terminal from '../../components/Terminal.jsx'
import LiveTerminal from './LiveTerminal.jsx'
import './Home.css'

const taglines = [
  'six-dimensional force sensors',
  'CLI agents & LLMs',
  'half marathon runner (1:56:08)',
  'open source & building things',
]

export default function Home() {
  const [tagIndex, setTagIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setTagIndex(i => (i + 1) % taglines.length)
    }, 3000)
    return () => clearInterval(timer)
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
            <div className="rotating-tags">
              <span className="prompt-sign">❯</span> Currently into{' '}
              <span className="tag-rotator">{taglines[tagIndex]}</span>
            </div>
          </div>

          {/* ─── Contact ─── */}
          <div className="about-section">
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

          {/* ─── Interactive Terminal ─── */}
          <div className="term-divider">
            <p className="prompt">
              <span className="prompt-sign">❯</span> ./interactive.sh
            </p>
          </div>
          <LiveTerminal compact />
        </Terminal>
      </div>
    </div>
  )
}
