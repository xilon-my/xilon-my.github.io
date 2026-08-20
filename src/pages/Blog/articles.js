import ragSelfTrain from './articles/rag-self-train.js'
import osCourseReflection from './articles/os-course-reflection.js'
import blackFactoryQa from './articles/black-factory-qa.js'
import ondeviceFc from './articles/ondevice-fc.js'
import bellmanGridworld from './articles/bellman-gridworld.js'
import monteCarloGridworld from './articles/monte-carlo-gridworld.js'
import temporalDifferenceGridworld from './articles/temporal-difference-gridworld.js'

const articles = [ragSelfTrain, osCourseReflection, blackFactoryQa, ondeviceFc, bellmanGridworld, monteCarloGridworld, temporalDifferenceGridworld].sort((a, b) => b.date.localeCompare(a.date))

export default articles
