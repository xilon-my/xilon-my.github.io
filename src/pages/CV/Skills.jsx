import './Skills.css'

const skillGroups = [
  { label: 'Languages', items: ['Python', 'TypeScript', 'Node.js', 'C/C++'] },
  { label: 'AI/ML', items: ['PyTorch', 'Transformer', 'LLM', 'RAG', 'Embedding'] },
  { label: 'Engineering', items: ['Altium Designer', 'Linux', 'Git', 'Docker'] },
  { label: 'Tools', items: ['Origin', 'Visio', 'Adobe Illustrator', 'React'] },
]

export default function Skills() {
  return (
    <div className="skills">
      {skillGroups.map(g => (
        <div key={g.label} className="skill-group">
          <h3>{g.label}</h3>
          <div className="skill-tags">
            {g.items.map(s => <span key={s}>{s}</span>)}
          </div>
        </div>
      ))}
    </div>
  )
}
