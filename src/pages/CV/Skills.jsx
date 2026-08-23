import './Skills.css'

const skillGroups = [
  { label: 'programming', items: ['Python', 'TypeScript', 'C/C++', 'Node.js'] },
  { label: 'ai / ml', items: ['PyTorch', 'Transformers', 'RAG', 'agent systems', 'RL post-training'] },
  { label: 'software', items: ['Linux', 'Git', 'Docker', 'React'] },
  { label: 'hardware', items: ['Altium Designer', 'circuit design', 'signal acquisition', 'sensor systems'] },
]

export default function Skills() {
  return (
    <div className="skills">
      {skillGroups.map(g => (
        <div key={g.label} className="skill-group">
          <h3>{g.label}</h3>
          <ul className="skill-list">
            {g.items.map(s => <li key={s}>{s}</li>)}
          </ul>
        </div>
      ))}
    </div>
  )
}
