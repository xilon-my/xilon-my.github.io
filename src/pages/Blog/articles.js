import ragSelfTrain from './articles/rag-self-train.js'
import osCourseReflection from './articles/os-course-reflection.js'

const articles = [ragSelfTrain, osCourseReflection].sort((a, b) => b.date.localeCompare(a.date))

export default articles
