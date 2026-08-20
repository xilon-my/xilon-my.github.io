import { NavLink } from 'react-router-dom'
import projects from '../pages/Discover/projects.js'
import articles from '../pages/Blog/articles.js'
import './Nav.css'

const links = [
  { to: '/', label: 'home' },
  { to: '/cv', label: 'cv' },
  { to: '/discover', label: 'discover', count: projects.length },
  { to: '/blog', label: 'blog', count: articles.length },
]

export default function Nav({ theme, onToggleTheme }) {
  return (
    <nav>
      <div className="container">
        <NavLink to="/" className="logo">shannon</NavLink>
        <div className="nav-right">
          <ul>
            {links.map(l => (
              <li key={l.to}>
                <NavLink to={l.to} end={l.to === '/'}>
                  <span className="nav-arrow">❯</span>{l.label}
                  {l.count != null && <span className="nav-count">({l.count})</span>}
                </NavLink>
              </li>
            ))}
          </ul>
          <span className="nav-sep">|</span>
          <button className="theme-toggle" onClick={onToggleTheme} title="Toggle theme">
            [{theme === 'dark' ? 'light' : 'dark'}]
          </button>
        </div>
      </div>
    </nav>
  )
}
