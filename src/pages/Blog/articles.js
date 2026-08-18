import ragSelfTrain from './articles/rag-self-train.js'
import osCourseReflection from './articles/os-course-reflection.js'
import blackFactoryQa from './articles/black-factory-qa.js'
import ondeviceFc from './articles/ondevice-fc.js'

const articles = [ragSelfTrain, osCourseReflection, blackFactoryQa, ondeviceFc].sort((a, b) => b.date.localeCompare(a.date))

export default articles
