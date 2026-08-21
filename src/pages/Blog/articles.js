import ragSelfTrain from './articles/rag-self-train.js'
import osCourseReflection from './articles/os-course-reflection.js'
import blackFactoryQa from './articles/black-factory-qa.js'
import ondeviceFc from './articles/ondevice-fc.js'
import bellmanGridworld from './articles/bellman-gridworld.js'
import monteCarloGridworld from './articles/monte-carlo-gridworld.js'
import temporalDifferenceGridworld from './articles/temporal-difference-gridworld.js'
import valueFunctionApproxGridworld from './articles/value-function-approximation-gridworld.js'
import policyGradientGridworld from './articles/policy-gradient-gridworld.js'
import dddAnd3a from './articles/ddd-and-3a.js'
import embeddingsRerankers from './articles/embeddings-rerankers.js'
import rag from './articles/rag.js'
import vla from './articles/vla.js'
import embodiedAi from './articles/embodied-ai.js'
import mcp from './articles/mcp.js'

const articles = [ragSelfTrain, osCourseReflection, blackFactoryQa, ondeviceFc, bellmanGridworld, monteCarloGridworld, temporalDifferenceGridworld, valueFunctionApproxGridworld, policyGradientGridworld, dddAnd3a, embeddingsRerankers, rag, vla, embodiedAi, mcp].sort((a, b) => b.date.localeCompare(a.date))

// ── blog subdirectories(terminal 文件系统隐喻)──
export const folders = {
  'rl-math': {
    name: 'rl-math',
    desc: '赵世钰《强化学习的数学原理》公开课笔记:Bellman 方程 → 蒙特卡洛 → 时序差分 → 值函数近似 → 策略梯度,从有模型到无模型,从基于价值到基于策略',
  },
}

export default articles
