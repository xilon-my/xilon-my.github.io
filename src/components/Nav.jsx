import { NavLink } from 'react-router-dom'
import './Nav.css'

const links = [
  { to: '/', label: 'home' },
  { to: '/cv', label: 'cv' },
  { to: '/discover', label: 'discover' },
  { to: '/blog', label: 'blog' },
]

export default function Nav({ theme, onToggleTheme }) {
  return (
    <nav className="site-nav" aria-label="主要导航">
      <div className="container">
        <NavLink to="/" className="logo" aria-label="Shannon 首页">shannon</NavLink>
        <div className="nav-right">
          <ul>
            {links.map(l => (
              <li key={l.to}>
                <NavLink to={l.to} end={l.to === '/'}>
                  <span className="nav-arrow">❯</span>{l.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <span className="nav-sep">|</span>
          <button
            className="theme-toggle"
            onClick={onToggleTheme}
            title={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`}
            aria-label={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`}
          >
            [{theme === 'dark' ? 'light' : 'dark'}]
          </button>
        </div>
      </div>
    </nav>
  )
}
