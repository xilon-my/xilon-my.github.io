import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import yaml from 'highlight.js/lib/languages/yaml'
import 'katex/dist/katex.min.css'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('yaml', yaml)

const IMAGE_DIMENSIONS = {
  '/discover/db-pareto.png': [1840, 1200],
  '/discover/langgraph-graph.png': [198, 471],
  '/discover/linear.png': [2934, 1762],
  '/discover/pi-agent.png': [3072, 1856],
  '/discover/symphony_tui.png': [3072, 1856],
  '/images/cartpole-demo.gif': [320, 213],
  '/images/colbert-arch-8bit.png': [789, 473],
  '/images/colbert-paradigms-8bit.png': [830, 220],
  '/images/diffusion-policy-arch-8bit.png': [830, 227],
  '/images/diffusion-policy-blockpush-kitchen-8bit.png': [747, 329],
  '/images/diffusion-policy-pusht-8bit.png': [830, 393],
  '/images/gpt2-moe/gelu-swiglu-figure-1.png': [875, 600],
  '/images/gpt2-moe/gqa-figure-2.png': [1185, 555],
  '/images/gpt2-moe/mixtral-figure-1.png': [1020, 430],
  '/images/gpt2-moe/transformer-figure-1.png': [1085, 1010],
  '/images/gridworld-map.png': [799, 549],
  '/images/grpo-principle.png': [1880, 1012],
  '/images/mc-3x3-map.png': [868, 834],
  '/images/mc-episode-decomp.png': [1510, 547],
  '/images/mc-eps-soft.png': [1616, 544],
  '/images/mc-eps-value-trend.png': [1141, 624],
  '/images/mc-q-s1.png': [943, 518],
  '/images/mc-sample-mean.png': [1004, 550],
  '/images/mrl-nested-8bit.png': [1248, 740],
  '/images/pi0-arch-8bit.png': [996, 278],
  '/images/pi0-hero-8bit.png': [1200, 164],
  '/images/pi0-results-8bit.png': [996, 570],
  '/images/pusht-baseline.gif': [320, 320],
  '/images/pusht-trained-1.gif': [320, 320],
  '/images/qstar-argmax.png': [1350, 550],
  '/images/rag-arch-8bit.png': [831, 239],
  '/images/ragchecker-framework-8bit.png': [899, 900],
  '/images/reacher-demo.gif': [480, 448],
  '/images/sbert-arch-8bit.png': [666, 671],
  '/images/sft-flow.jpg': [1080, 468],
  '/images/simcse-8bit.png': [814, 270],
  '/images/smolvla-arch-8bit.png': [1200, 675],
  '/images/smolvla-libero-8bit.png': [1560, 1092],
  '/images/smolvla-real-8bit.png': [1380, 808],
  '/images/td-qlearn-behavior.png': [1030, 582],
  '/images/vla-rollout.gif': [360, 360],
  '/images/vpi-heatmap.png': [998, 394],
  '/images/vstar-policy.png': [956, 537],
}

const cleanHeading = value => value
  .replace(/\s+#+\s*$/, '')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/[\\*_~]/g, '')
  .trim()

const createSlugger = () => {
  const seen = new Map()
  return value => {
    const base = cleanHeading(value)
      .toLocaleLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\p{Letter}\p{Number}_-]/gu, '') || 'section'
    const count = seen.get(base) || 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count + 1}`
  }
}

export function extractHeadings(source) {
  const slug = createSlugger()
  const headings = []
  let fence = null

  source.split('\n').forEach(line => {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      fence = fence === marker ? null : (fence || marker)
      return
    }
    if (fence) return

    const match = line.match(/^(#{2,3})\s+(.+)$/)
    if (!match) return
    const text = cleanHeading(match[2])
    headings.push({ level: match[1].length, text, id: slug(text) })
  })

  return headings
}

function useActiveHeading(headings, enabled) {
  const [activeId, setActiveId] = useState(headings[0]?.id || '')

  useEffect(() => {
    if (!enabled || headings.length === 0) return undefined

    let frame = 0
    const update = () => {
      frame = 0
      const threshold = Math.min(window.innerHeight * 0.28, 220)
      let nextId = headings[0].id

      headings.forEach(heading => {
        const element = document.getElementById(heading.id)
        if (element && element.getBoundingClientRect().top <= threshold) nextId = heading.id
      })

      const pageBottom = window.scrollY + window.innerHeight
      if (pageBottom >= document.documentElement.scrollHeight - 4) {
        nextId = headings[headings.length - 1].id
      }

      setActiveId(current => current === nextId ? current : nextId)
    }
    const scheduleUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update)
    }

    setActiveId(headings[0].id)
    scheduleUpdate()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [enabled, headings])

  return activeId
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)

  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])

  return matches
}

const TocItems = ({ headings, activeId = '', onNavigate }) => {
  return (
  <ol>
    {headings.map(heading => (
      <li key={heading.id} className={`toc-level-${heading.level}`}>
        <Link
          to={`#${heading.id}`}
          aria-current={heading.id === activeId ? 'location' : undefined}
          title={heading.text}
          onClick={onNavigate}
        >
          <span>{heading.text}</span>
        </Link>
      </li>
    ))}
  </ol>
  )
}

const scrollTocItemIntoView = (wheel, item, behavior = 'auto') => {
  const wheelRect = wheel.getBoundingClientRect()
  const itemRect = item.getBoundingClientRect()
  const itemTop = wheel.scrollTop + itemRect.top - wheelRect.top
  const itemBottom = itemTop + itemRect.height
  const viewTop = wheel.scrollTop
  const viewBottom = viewTop + wheel.clientHeight

  if (itemTop < viewTop) {
    wheel.scrollTo({ top: itemTop, behavior })
  } else if (itemBottom > viewBottom) {
    wheel.scrollTo({ top: itemBottom - wheel.clientHeight, behavior })
  }
}

export function ContentToc({ headings, variant = 'inline' }) {
  const wheelRef = useRef(null)
  const detailsRef = useRef(null)
  const wideOutline = useMediaQuery('(min-width: 1360px)')
  const activeId = useActiveHeading(headings, variant === 'rail' ? wideOutline : !wideOutline)
  const activeIndex = Math.max(0, headings.findIndex(heading => heading.id === activeId))
  const activeHeading = headings[activeIndex]

  useEffect(() => {
    if (variant === 'inline' && wideOutline) detailsRef.current?.removeAttribute('open')
  }, [variant, wideOutline])

  useEffect(() => {
    const wheel = wheelRef.current
    const isVisible = variant === 'rail' ? wheel?.clientHeight > 0 : detailsRef.current?.open
    if (!wheel || !isVisible) return
    const item = wheel.querySelector("a[aria-current='location']")?.closest('li')
    if (!item) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scrollTocItemIntoView(wheel, item, reduceMotion ? 'auto' : 'smooth')
  }, [activeIndex, variant])

  const revealFocusedItem = event => {
    const wheel = wheelRef.current
    const item = event.target.closest?.('li')
    if (!wheel || !item) return
    scrollTocItemIntoView(wheel, item)
  }

  const revealCurrentItem = event => {
    if (!event.currentTarget.open) return
    window.requestAnimationFrame(() => {
      const wheel = wheelRef.current
      const item = wheel?.querySelector("a[aria-current='location']")?.closest('li')
      if (wheel && item) scrollTocItemIntoView(wheel, item)
    })
  }

  const closeInlineToc = () => {
    detailsRef.current?.removeAttribute('open')
  }

  if (headings.length < 2) return null

  if (variant === 'rail') {
    return (
      <nav className="article-toc article-toc-sidebar" aria-label="正文目录">
        <p className="article-toc-label">
          <span>toc</span>
          <span className="article-toc-position" aria-hidden="true">
            {String(activeIndex + 1).padStart(2, '0')} / {String(headings.length).padStart(2, '0')}
          </span>
        </p>
        <div className="article-toc-wheel" ref={wheelRef} onFocusCapture={revealFocusedItem}>
          <TocItems headings={headings} activeId={activeId} />
        </div>
      </nav>
    )
  }

  return (
    <details className="article-toc" ref={detailsRef} onToggle={revealCurrentItem}>
      <summary>
        <span className="article-toc-summary-label">toc</span>
        <span className="article-toc-summary-current">
          <span className="article-toc-summary-position" aria-hidden="true">
            {String(activeIndex + 1).padStart(2, '0')} / {String(headings.length).padStart(2, '0')}
          </span>
          <span className="article-toc-summary-title">{activeHeading?.text}</span>
        </span>
      </summary>
      <nav ref={wheelRef} onFocusCapture={revealFocusedItem} aria-label="正文目录">
        <TocItems headings={headings} activeId={activeId} onNavigate={closeInlineToc} />
      </nav>
    </details>
  )
}

const walkTree = (node, visit) => {
  visit(node)
  node.children?.forEach(child => walkTree(child, visit))
}

const headingIds = source => () => tree => {
  const slug = createSlugger()
  walkTree(tree, node => {
    if (node.type !== 'heading' || node.depth < 2 || node.depth > 3) return
    const raw = source.slice(node.position?.start?.offset ?? 0, node.position?.end?.offset ?? 0)
    const match = raw.match(/^#{2,3}\s+([\s\S]+)$/)
    const text = cleanHeading(match?.[1] || '')
    const id = slug(text)
    node.data = {
      ...node.data,
      hProperties: { ...node.data?.hProperties, id },
    }
  })
}

function CodeBlock({ className, children }) {
  const lang = className?.replace('language-', '') || ''
  const code = String(children).replace(/\n$/, '')

  if (!lang || !hljs.getLanguage(lang)) {
    return <code className={className}>{children}</code>
  }

  return (
    <code
      className={className}
      dangerouslySetInnerHTML={{ __html: hljs.highlight(code, { language: lang }).value }}
    />
  )
}

export function ContentImage({ node: _node, src = '', alt = '', ...props }) {
  const [width, height] = IMAGE_DIMENSIONS[src] || []
  return (
    <img
      {...props}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
    />
  )
}

export default function MarkdownContent({ source }) {
  const headingPlugin = useMemo(() => headingIds(source), [source])
  const components = useMemo(() => {
    const heading = (Tag, className) => ({ node: _node, ...props }) => (
      <Tag className={className} tabIndex="-1" {...props} />
    )

    return {
      code: CodeBlock,
      img: ContentImage,
      h2: heading('h2', 'article-heading'),
      h3: heading('h3', 'article-subheading'),
    }
  }, [])

  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath, headingPlugin]}
      rehypePlugins={[rehypeKatex]}
      components={components}
    >
      {source}
    </Markdown>
  )
}
