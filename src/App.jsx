import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import Footer from './components/Footer.jsx'
import Home from './pages/Home/Home.jsx'
import BlogPage from './pages/Blog/Blog.jsx'
import BlogPost from './pages/Blog/BlogPost.jsx'
import CV from './pages/CV/CV.jsx'
import Discover from './pages/Discover/Discover.jsx'
import DiscoverDetail from './pages/Discover/DiscoverDetail.jsx'

export default function App() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(t => t === 'dark' ? 'light' : 'dark')
  }

  return (
    <>
      <Nav theme={theme} onToggleTheme={toggleTheme} />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cv" element={<CV />} />
          <Route path="/blog" element={<BlogPage />} />
          <Route path="/blog/:slug" element={<BlogPost />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/discover/:slug" element={<DiscoverDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}

function NotFound() {
  return (
    <section className="section">
      <div className="container" style={{ textAlign: 'center', padding: '80px 0' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: 12 }}>404</h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Page not found. <a href="/">Go home</a>
        </p>
      </div>
    </section>
  )
}
