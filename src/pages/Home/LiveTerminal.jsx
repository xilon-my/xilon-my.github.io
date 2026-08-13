import { useState, useRef, useEffect } from 'react'
import './LiveTerminal.css'

const neofetch = `
  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡠⣤⣤⣦⣶⣶⣶⣠⣤⣄⡀⠀⠀⠀⠀⠀⠀⠀⠀
  ⠀⠀⠀⠀⠀⢀⣄⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⣄⠀⠀⠀⠀⠀   shannon@shannon.zone
  ⠀⠀⠀⢀⣐⣿⣿⢿⣟⣻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⣭⣿⣻⣷⡄⠀⠀⠀
  ⠀⠀⣠⣿⣿⣿⡿⣫⣷⣶⣯⣻⣿⣿⣿⣿⣿⣿⣿⣻⣾⣿⣷⡽⣿⣿⣆⢀⠀   ─────────────────────
  ⠀⡶⣽⣿⣿⣿⡿⣿⣿⣽⣿⡷⣿⣿⣿⣿⡿⣿⣿⣿⣿⣾⣿⣏⣿⣿⣿⠵⠀   OS         human
  ⠀⠉⠹⣿⣿⣿⣿⣽⣿⣿⣿⣿⣿⣿⢿⣿⣯⢿⣿⣿⣿⣭⣷⣿⣿⣿⠃⠀⠀   Host       Tsinghua University
  ⠀⠀⠀⠈⠻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀   Uptime     22 years
  ⠀⠀⠀⠀⠀⠈⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠛⠁⠀⠀⠀⠀⠀   CPU        brain (2 cores)
  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢹⣭⣽⡟⠛⣿⣿⡉⢹⣅⠀⠀⠀⠀⠀⠀⠀⠀⠀   Memory     16 bits
  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣽⣗⣭⣿⡶⣻⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀   Status     doing interesting things
  ⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠛⠯⠻⣿⣿⡿⠟⠿⠿⠟⠁⠀⠀⠀⠀⠀⠀⠀⠀   Location   Shenzhen, China
`

const CMD = {
  help: `available commands:
  /help      show this message
  /whoami    about me
  /neofetch  system info
  /projects  what i've built
  /skills    things i work with
  /awards    achievements
  /github    github profile
  /email     email address
  /clear     clear terminal
  /banner    show the banner`,

  whoami: `Shannon Zhang
M.S. @ Tsinghua University
B.S. @ Xiamen University
Intern @ Huawei
Born 2003.08.24 · ISTP · fitness enthusiast
My wish is to do interesting things.`,

  neofetch: neofetch,

  projects: `- MiniMind LLM: 26M param Transformer from scratch
- CLI Agent: ReAct-pattern agent with tool calling
- Multimodal RAG: PDF parsing + reranking pipeline
- CFRP Bolt Sensor: smart sensing for aerospace composites`,

  skills: `Languages:  Python, TypeScript, C/C++, Node.js
AI/ML:      PyTorch, LLM, RAG, Embedding, Transformer
Hardware:   Altium Designer, NDT, Sensor Design
Tools:      Git, Linux, Docker, React, Figma`,

  awards: `National Scholarship  ·  Luyan Scholarship
BYD Scholarship  ·  Academic Excellence
Outstanding Graduate  ·  Outstanding Merit Student
RoboCup China Open — Basketball Champion`,

  banner: `╔══════════════════════════════╗
║    shannon@shannon.zone      ║
║  ❯ type /help for commands   ║
╚══════════════════════════════╝`,
}

const CMD_NAMES = Object.keys(CMD).filter(k => k !== 'banner').sort()

function StreamText({ text, speed = 8, onDone }) {
  const [pos, setPos] = useState(0)
  useEffect(() => {
    if (pos >= text.length) { onDone?.(); return }
    const t = setTimeout(() => setPos(p => p + Math.min(3, text.length - p)), speed)
    return () => clearTimeout(t)
  }, [pos, text, speed, onDone])
  return <>{text.slice(0, pos)}<span className="str-cursor" /></>
}

export default function LiveTerminal({ compact }) {
  const [history, setHistory] = useState([
    { type: 'out', text: CMD.banner },
    { type: 'out', text: 'Type /help to see available commands.' },
  ])
  const [streamId, setStreamId] = useState(null)
  const [input, setInput] = useState('')
  const [cmdHist, setCmdHist] = useState([])
  const [histIdx, setHistIdx] = useState(-1)
  const [showHint, setShowHint] = useState(false)
  const [hintIdx, setHintIdx] = useState(0)
  const inputRef = useRef(null)
  const scrollRef = useRef(null)

  const matches = input.startsWith('/')
    ? CMD_NAMES.filter(c => c.startsWith(input.slice(1)))
    : []

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [history, streamId])

  useEffect(() => {
    if (!showHint || !scrollRef.current) return
    const el = scrollRef.current.querySelector('.hint-on')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [hintIdx, showHint])

  function exec(cmd) {
    const key = cmd.trim().toLowerCase().replace(/^\//, '')
    if (!key) return
    setCmdHist(h => [...h, key])
    setHistIdx(-1)
    if (key === 'clear') { setHistory([]); setInput(''); return }
    const output = CMD[key] || `command not found: ${key}`
    const id = Date.now()
    setStreamId(id)
    setHistory(h => [...h, { type: 'cmd', text: cmd }, { type: 'stream', id, text: output, done: false }])
    setInput('')
  }

  function onStreamDone(id) {
    setHistory(h => h.map(e => e.type === 'stream' && e.id === id ? { ...e, done: true } : e))
    setStreamId(s => s === id ? null : s)
  }

  function onKey(e) {
    if (showHint && matches.length) {
      switch (e.key) {
        case 'Enter': e.preventDefault(); exec('/' + matches[hintIdx]); setShowHint(false); return
        case 'Tab': e.preventDefault(); setInput('/' + matches[hintIdx] + ' '); setShowHint(false); return
        case 'ArrowDown': e.preventDefault(); setHintIdx(i => Math.min(i + 1, matches.length - 1)); return
        case 'ArrowUp': e.preventDefault(); setHintIdx(i => Math.max(i - 1, 0)); return
        case 'Escape': e.preventDefault(); setShowHint(false); return
      }
    }
    switch (e.key) {
      case 'Tab': e.preventDefault(); break
      case 'Enter': exec(input); break
      case 'ArrowUp':
        if (showHint) break
        e.preventDefault()
        if (!cmdHist.length) return
        setHistIdx(i => i === -1 ? cmdHist.length - 1 : Math.max(0, i - 1))
        setInput(cmdHist[histIdx === -1 ? cmdHist.length - 1 : Math.max(0, histIdx - 1)])
        break
      case 'ArrowDown':
        if (showHint) break
        e.preventDefault()
        if (histIdx === -1) break
        if (histIdx + 1 >= cmdHist.length) { setHistIdx(-1); setInput('') }
        else { setHistIdx(histIdx + 1); setInput(cmdHist[histIdx + 1]) }
        break
    }
  }

  return (
    <div className={"live-terminal" + (compact ? " compact" : "")} onClick={() => inputRef.current?.focus()}>
      <div className="term-out" ref={scrollRef}>
        {history.map((entry, i) => (
          <div key={i} className={entry.type === 'cmd' ? 'l-cmd' : 'l-out'}>
            {entry.type === 'cmd' && <span className="p-green">❯ </span>}
            {entry.type === 'stream' ? (
              <pre className="p-out">
                {entry.done ? entry.text : <StreamText text={entry.text} speed={6} onDone={() => onStreamDone(entry.id)} />}
              </pre>
            ) : (
              <pre className={entry.type === 'cmd' ? 'p-cmd' : 'p-out'}>{entry.text}</pre>
            )}
          </div>
        ))}
        {showHint && matches.length > 0 && (
          <div className="hints">
            {matches.map((c, i) => (
              <div key={c} className={"hint" + (i === hintIdx ? " hint-on" : "")}
                onMouseDown={() => { setShowHint(false); exec('/' + c) }}>
                <span className="p-green">❯ </span><span className="hint-cmd">/{c}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="inp-line">
        <span className="p-green">❯ </span>
        <input ref={inputRef} type="text" className="inp"
          value={input} onChange={e => { setInput(e.target.value); setShowHint(e.target.value.startsWith('/')); setHintIdx(0) }}
          onKeyDown={onKey} placeholder="type /help..." spellCheck={false} autoComplete="off" />
      </div>
    </div>
  )
}
