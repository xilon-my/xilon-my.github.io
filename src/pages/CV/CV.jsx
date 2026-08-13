import Experience from './Experience.jsx'
import Skills from './Skills.jsx'
import './CV.css'

export default function CV() {
  return (
    <div className="cv-page">
      <div className="container">

        {/* ─── Header ─── */}
        <div className="cv-header">
          <div className="term-dots">
            <span className="t-dot" style={{ background: '#F38BA8' }} />
            <span className="t-dot" style={{ background: '#F9E2AF' }} />
            <span className="t-dot" style={{ background: '#A6E3A1' }} />
            <span className="t-title">shannon@shannon.zone ~/cv %</span>
          </div>
          <h1 className="cv-name">Shannon Zhang</h1>
          <p className="cv-sub">
            <span className="prompt-cv">❯</span> github.com/xilon-my · 3422647204@qq.com
          </p>
        </div>

        {/* ─── Timeline ─── */}
        <section className="cv-section">
          <p className="cv-prompt"><span className="prompt-cv">❯</span> cat experience.md</p>
          <Experience />
        </section>

        {/* ─── Awards ─── */}
        <section className="cv-section">
          <p className="cv-prompt"><span className="prompt-cv">❯</span> cat awards.md</p>
          <div className="cv-awards-block">
            <div className="cv-award-group">
              <h4 className="cv-award-cat">Scholarships</h4>
              <ul className="cv-award-list">
                <li>National Scholarship</li>
                <li>Luyan Scholarship</li>
                <li>BYD Scholarship</li>
                <li>Academic Excellence Scholarship</li>
                <li>Academic Innovation Scholarship</li>
              </ul>
            </div>
            <div className="cv-award-group">
              <h4 className="cv-award-cat">Honors</h4>
              <ul className="cv-award-list">
                <li>Outstanding Merit Student</li>
                <li>Outstanding Graduate</li>
                <li>Outstanding Graduation Design</li>
              </ul>
            </div>
            <div className="cv-award-group">
              <h4 className="cv-award-cat">Competitions</h4>
              <ul className="cv-award-list">
                <li>2024.05 — China Robot Competition &amp; RoboCup China Open — Autonomous Basketball Champion</li>
                  <li>2023.11 — 15th National College Mathematics Competition — Fujian First Prize</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ─── Skills ─── */}
        <section className="cv-section">
          <p className="cv-prompt"><span className="prompt-cv">❯</span> cat skills.md</p>
          <Skills />
        </section>
      </div>
    </div>
  )
}
