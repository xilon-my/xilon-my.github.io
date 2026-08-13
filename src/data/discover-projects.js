import multica from './discover/multica.js'
import symphony from './discover/symphony.js'
import okf from './discover/okf.js'
import openaiAgentsPython from './discover/openai-agents-python.js'
import pi from './discover/pi-agent.js'
import mcp from './discover/mcp.js'
import superpowersOpenspec from './discover/superpowers-openspec.js'
import langgraph from './discover/langgraph.js'
import embodiedAi from './discover/embodied-ai.js'
import vla from './discover/vla.js'
import rag from './discover/rag.js'
import embeddingsRerankers from './discover/embeddings-rerankers.js'
import bellmanGridworld from './discover/bellman-gridworld.js'

const projects = [multica, symphony, okf, openaiAgentsPython, pi, mcp, superpowersOpenspec, langgraph, embodiedAi, vla, rag, embeddingsRerankers, bellmanGridworld].sort((a, b) => b.date.localeCompare(a.date))

export default projects
