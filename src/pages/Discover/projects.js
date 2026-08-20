import multica from './projects/multica.js'
import symphony from './projects/symphony.js'
import okf from './projects/okf.js'
import openaiAgentsPython from './projects/openai-agents-python.js'
import pi from './projects/pi-agent.js'
import superpowersOpenspec from './projects/superpowers-openspec.js'
import langgraph from './projects/langgraph.js'
import findingCodeToChange from './projects/finding-code-to-change.js'
import mineru from './projects/mineru.js'
import llamaCpp from './projects/llama-cpp.js'

const projects = [multica, symphony, okf, openaiAgentsPython, pi, superpowersOpenspec, langgraph, findingCodeToChange, mineru, llamaCpp].sort((a, b) => b.date.localeCompare(a.date))

export default projects
