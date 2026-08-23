import './Footer.css'

export default function Footer() {
  const year = new Date().getFullYear()
  return (
    <footer className="terminal-footer">
      <p>&copy; {year} Shannon. Built with curiosity.</p>
      <p className="build-time">site built: {__BUILD_TIME__}</p>
    </footer>
  )
}
