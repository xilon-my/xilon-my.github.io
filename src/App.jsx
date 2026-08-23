import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import Nav from './components/Nav.jsx'
import Terminal from './components/Terminal.jsx'
import RouteEffects from './components/RouteEffects.jsx'

const Home = lazy(() => import('./pages/Home/Home.jsx'))
const BlogPage = lazy(() => import('./pages/Blog/Blog.jsx'))
const BlogPost = lazy(() => import('./pages/Blog/BlogPost.jsx'))
const CV = lazy(() => import('./pages/CV/CV.jsx'))
const Discover = lazy(() => import('./pages/Discover/Discover.jsx'))
const DiscoverDetail = lazy(() => import('./pages/Discover/DiscoverDetail.jsx'))

function RouteLoading() {
  return (
    <div className="route-loading">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~ %" showFooter={false}>
          <p className="route-loading-line" role="status"><span>❯</span> loading…</p>
        </Terminal>
      </div>
    </div>
  )
}

export default function App() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* storage can be unavailable */ }
  }, [theme])

  return (
    <>
      <Link className="skip-link" to="#main-content">跳到主要内容</Link>
      <RouteEffects />
      <Nav theme={theme} onToggleTheme={() => setTheme(value => value === 'dark' ? 'light' : 'dark')} />
      <main id="main-content" tabIndex="-1">
        <Suspense fallback={<RouteLoading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/cv" element={<CV />} />
            <Route path="/blog" element={<BlogPage />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/discover/:slug" element={<DiscoverDetail />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
    </>
  )
}

function NotFound() {
  return (
    <div className="not-found-page">
      <div className="container">
        <Terminal title="shannon@shannon.zone ~/404 %">
          <p className="not-found-prompt"><span>❯</span> pwd</p>
          <h1 className="not-found-title">404</h1>
          <p className="not-found-copy">Page not found. <Link to="/">Go home</Link></p>
        </Terminal>
      </div>
    </div>
  )
}
