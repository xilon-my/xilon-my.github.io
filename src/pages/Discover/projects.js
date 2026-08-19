import multica from './projects/multica.js'
import symphony from './projects/symphony.js'
import okf from './projects/okf.js'
import openaiAgentsPython from './projects/openai-agents-python.js'
import pi from './projects/pi-agent.js'
import mcp from './projects/mcp.js'
import superpowersOpenspec from './projects/superpowers-openspec.js'
import langgraph from './projects/langgraph.js'
import embodiedAi from './projects/embodied-ai.js'
import vla from './projects/vla.js'
import rag from './projects/rag.js'
import embeddingsRerankers from './projects/embeddings-rerankers.js'
import bellmanGridworld from './projects/bellman-gridworld.js'
import monteCarloGridworld from './projects/monte-carlo-gridworld.js'
import findingCodeToChange from './projects/finding-code-to-change.js'
import dddAnd3a from './projects/ddd-and-3a.js'
import mineru from './projects/mineru.js'
import llamaCpp from './projects/llama-cpp.js'

const projects = [multica, symphony, okf, openaiAgentsPython, pi, mcp, superpowersOpenspec, langgraph, embodiedAi, vla, rag, embeddingsRerankers, bellmanGridworld, monteCarloGridworld, findingCodeToChange, dddAnd3a, mineru, llamaCpp].sort((a, b) => b.date.localeCompare(a.date))

export default projects
