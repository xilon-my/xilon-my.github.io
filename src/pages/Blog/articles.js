import ragSelfTrain from './articles/rag-self-train.js'
import osCourseReflection from './articles/os-course-reflection.js'
import ondeviceFc from './articles/ondevice-fc.js'

const articles = [ragSelfTrain, osCourseReflection, ondeviceFc].sort((a, b) => b.date.localeCompare(a.date))

export default articles
