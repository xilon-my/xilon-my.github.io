import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import articles, { folders } from '../pages/Blog/articles.js'
import projects from '../pages/Discover/projects.js'

const scrollPositions = new Map()
const focusPositions = new Map()
const CONTENT_READY_EVENT = 'route-content-ready'

const restorePosition = pending => {
  if (pending.hash) {
    const target = document.getElementById(pending.hash)
    if (!target) return false
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
    return true
  }

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const contentIsTallEnough = pending.top <= maxScroll + 1
  window.scrollTo({ top: pending.top, left: 0, behavior: 'auto' })
  if (!pending.focusId) return contentIsTallEnough
  const target = document.getElementById(pending.focusId)
  if (!target) return false
  target.focus({ preventScroll: true })
  return contentIsTallEnough
}

const routeMeta = pathname => {
  if (pathname === '/') return { title: 'Shannon Zhang · shannon.zone', lang: 'en', description: 'Shannon Zhang 的个人网站，记录 AI、强化学习、RAG、agent 与推理项目。' }
  if (pathname === '/cv') return { title: 'CV · Shannon Zhang', lang: 'en', description: 'Shannon Zhang 的教育、经历、荣誉与技能。' }
  if (pathname === '/blog') return { title: 'Blog · shannon.zone', lang: 'zh-CN', description: '强化学习、RAG、agent、推理与课程笔记。' }
  if (pathname === '/discover') return { title: 'Discover · shannon.zone', lang: 'zh-CN', description: '值得阅读和使用的开源项目。' }

  if (pathname.startsWith('/blog/')) {
    const slug = pathname.slice('/blog/'.length)
    const item = articles.find(article => article.slug === slug)
    const folder = folders[slug]
    return {
      title: `${item?.name || folder?.name || 'Blog'} · shannon.zone`,
      lang: 'zh-CN',
      description: item?.description || folder?.desc || 'Blog · shannon.zone',
    }
  }

  if (pathname.startsWith('/discover/')) {
    const slug = pathname.slice('/discover/'.length)
    const item = projects.find(project => project.slug === slug)
    return {
      title: `${item?.name || 'Discover'} · shannon.zone`,
      lang: 'zh-CN',
      description: item?.description || 'Discover · shannon.zone',
    }
  }

  return { title: 'Page not found · shannon.zone', lang: 'en', description: 'Page not found.' }
}

export default function RouteEffects() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const previousPathname = useRef(location.pathname)
  const pendingRestore = useRef(null)
  const currentKey = useRef(location.key)
  currentKey.current = location.key

  useLayoutEffect(() => {
    const pathnameChanged = previousPathname.current !== location.pathname
    previousPathname.current = location.pathname

    const frame = requestAnimationFrame(() => {
      if (location.hash) {
        pendingRestore.current = {
          key: location.key,
          hash: decodeURIComponent(location.hash.slice(1)),
        }
        if (restorePosition(pendingRestore.current)) pendingRestore.current = null
      } else if (navigationType === 'POP') {
        pendingRestore.current = {
          key: location.key,
          top: scrollPositions.get(location.key) || 0,
          focusId: focusPositions.get(location.key) || null,
        }
        if (restorePosition(pendingRestore.current)) pendingRestore.current = null
      } else if (pathnameChanged) {
        pendingRestore.current = null
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
        document.getElementById('main-content')?.focus({ preventScroll: true })
      }
    })

    return () => {
      cancelAnimationFrame(frame)
      scrollPositions.set(location.key, window.scrollY)
    }
  }, [location.key, location.hash, location.pathname, navigationType])

  useEffect(() => {
    const restoreWhenReady = () => {
      const pending = pendingRestore.current
      if (!pending || pending.key !== currentKey.current) return
      requestAnimationFrame(() => {
        if (restorePosition(pending)) pendingRestore.current = null
      })
    }

    window.addEventListener(CONTENT_READY_EVENT, restoreWhenReady)
    return () => window.removeEventListener(CONTENT_READY_EVENT, restoreWhenReady)
  }, [])

  useEffect(() => {
    let latestFocusId = document.activeElement?.id || null
    const rememberTarget = event => {
      const target = event.target.closest?.('[id]')
      if (target?.id) latestFocusId = target.id
    }

    document.addEventListener('focusin', rememberTarget)
    document.addEventListener('pointerdown', rememberTarget)

    return () => {
      document.removeEventListener('focusin', rememberTarget)
      document.removeEventListener('pointerdown', rememberTarget)
      if (latestFocusId) focusPositions.set(location.key, latestFocusId)
    }
  }, [location.key])

  useEffect(() => {
    const meta = routeMeta(location.pathname)
    document.title = meta.title
    document.documentElement.lang = meta.lang
    document.querySelector('meta[name="description"]')?.setAttribute('content', meta.description)
  }, [location.pathname])

  useEffect(() => {
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => { window.history.scrollRestoration = previous }
  }, [])

  return null
}
