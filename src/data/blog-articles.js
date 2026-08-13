import ragSelfTrain from './blog/rag-self-train.js'
import osCourseReflection from './blog/os-course-reflection.js'

const articles = [ragSelfTrain, osCourseReflection].sort((a, b) => b.date.localeCompare(a.date))

export default articles
