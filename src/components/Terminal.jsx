import './Terminal.css'
import Footer from './Footer.jsx'

export default function Terminal({ title, children, glow, showFooter = true }) {
  const shortTitle = title?.replace('shannon@shannon.zone ', '')

  return (
    <div className={`terminal ${glow ? 'term-glow' : ''}`}>
      <div className="term-bar">
        <span className="term-dot term-dot-close" />
        <span className="term-dot term-dot-minimize" />
        <span className="term-dot term-dot-expand" />
        {title && (
          <span className="term-title" title={title}>
            <span className="term-title-long">{title}</span>
            <span className="term-title-short">{shortTitle}</span>
          </span>
        )}
      </div>
      <div className="term-body">
        {children}
        {showFooter && <Footer />}
      </div>
    </div>
  )
}
