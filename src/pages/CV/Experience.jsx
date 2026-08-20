import { useEffect, useRef, useState } from 'react'
import './Experience.css'

const experiences = [
  {
    date: '2026.06 — Present',
    title: 'Agent Development Intern',
    company: 'Huawei',
    description: 'Quality & Process IT department. Developing intelligent agents for lights-out factory automation within legacy systems.',
    logo: '/images/huawei-color.svg',
  },
  {
    date: '2025.09 — Present',
    title: 'M.S. in Electronic Information',
    company: 'Tsinghua University',
    description: 'Researching six-dimensional force sensors. GPA: 3.93/4.0. Member of the Graduate Student Union Sports Department.',
    logo: '/images/tsinghua.webp',
  },
  {
    date: '2021.09 — 2025.06',
    title: 'B.S. in Measurement & Control Technology',
    company: 'Xiamen University',
    description: 'School of Aeronautics & Astronautics. Ranked 1/35. Also served as an Academic Peer Tutor, providing advanced mathematics tutoring for underclassmen.',
    logo: '/images/xiamen.webp',
  },
  {
    date: '2024.09 — 2024.11',
    title: 'Hardware Engineer Intern',
    company: 'Xiamen Kebi Detection Technology',
    description: 'Designed eddy current NDT hardware modules: excitation signal generation, sensing signal acquisition, and signal conditioning circuits.',
  },
  {
    date: '2023.01',
    title: 'Electrical Engineering Intern',
    company: 'Beijing Lingkong Tianxing',
    description: "Participated in a rocket R&D program. Honestly didn't do much — mainly observed.",
  },
]

function FadeInItem({ children }) {
  const ref = useRef(null)
  const [vis, setVis] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVis(true); obs.disconnect() }
    }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`fade-item ${vis ? 'fade-in' : ''}`}>{children}</div>
}

export default function Experience() {
  return (
    <div className="timeline">
      {experiences.map((j, i) => (
        <FadeInItem key={i}>
          <div className="timeline-item">
            <div className="date">{j.date}</div>
            <h3>
              <span className="title-line">{j.title}</span>
              <span className="company-line">
                {j.logo && <img src={j.logo} alt="" className="school-logo" />}
                @ {j.company}
              </span>
            </h3>
            <p className="exp-desc">{j.description}</p>
          </div>
        </FadeInItem>
      ))}
    </div>
  )
}
