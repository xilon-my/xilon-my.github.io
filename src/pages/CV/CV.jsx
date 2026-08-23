import Experience from './Experience.jsx'
import Skills from './Skills.jsx'
import Terminal from '../../components/Terminal.jsx'
import './CV.css'

export default function CV() {
  return (
    <div className="cv-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/cv %">
          {/* ─── Header ─── */}
          <div className="cv-header">
            <h1 className="cv-name">Shannon Zhang</h1>
            <div className="cv-sub">
              <span className="prompt-cv">❯</span>
              <a href="https://github.com/xilon-my" target="_blank" rel="noopener noreferrer">github.com/xilon-my</a>
              <span aria-hidden="true">·</span>
              <a href="mailto:3422647204@qq.com">3422647204@qq.com</a>
              <button type="button" className="cv-print" onClick={() => window.print()}>[print]</button>
            </div>
          </div>

          {/* ─── Timeline ─── */}
          <section className="cv-section">
            <h2 className="cv-prompt"><span className="prompt-cv">❯</span> cat experience.md</h2>
            <Experience />
          </section>

          {/* ─── Awards ─── */}
          <section className="cv-section">
            <h2 className="cv-prompt"><span className="prompt-cv">❯</span> cat awards.md</h2>
            <div className="cv-awards-block">
              <div className="cv-award-group">
                <h3 className="cv-award-cat">Scholarships</h3>
                <ul className="cv-award-list">
                  <li>National Scholarship</li>
                  <li>Luyan Scholarship</li>
                  <li>BYD Scholarship</li>
                  <li>Academic Excellence Scholarship</li>
                  <li>Academic Innovation Scholarship</li>
                </ul>
              </div>
              <div className="cv-award-group">
                <h3 className="cv-award-cat">Honors</h3>
                <ul className="cv-award-list">
                  <li>Outstanding Merit Student</li>
                  <li>Outstanding Graduate</li>
                  <li>Outstanding Graduation Design</li>
                </ul>
              </div>
              <div className="cv-award-group">
                <h3 className="cv-award-cat">Competitions</h3>
                <ul className="cv-award-list">
                  <li>2024.05 — China Robot Competition &amp; RoboCup China Open — Autonomous Basketball Champion</li>
                  <li>2023.11 — 15th National College Mathematics Competition — Fujian First Prize</li>
                </ul>
              </div>
            </div>
          </section>

          {/* ─── Skills ─── */}
          <section className="cv-section">
            <h2 className="cv-prompt"><span className="prompt-cv">❯</span> cat skills.md</h2>
            <Skills />
          </section>
        </Terminal>
      </div>
    </div>
  )
}
