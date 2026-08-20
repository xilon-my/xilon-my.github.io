const project = {
  slug: 'langgraph',
  date: '2026-07-31 20:30',
  name: 'LangGraph',
  url: 'https://github.com/langchain-ai/langgraph',
  description: '用图定义 Agent 行为的框架。节点就是函数，边就是逻辑，编译后是确定性的执行拓扑——不是"建议"Agent 怎么走，是它只能这么走。',
  tags: ['agent'],
  stars: '60k+',
  author: 'LangChain',
  detail:
`本系列之前讨论了 Superpowers 对 Agent 行为的流程约束，和 OpenSpec 对 Agent 目标的 spec 约束。LangGraph 从完全不同的方向解决同一个问题——从拓扑结构上约束。

Agent 框架大多默认 Agent 应该线性地"想 → 做 → 看结果 → 再做"。ReAct 循环、plan-then-execute、tool calling loop——走完一步下一步，没有分支、没有并行、没有循环。但你试过在 prompt 里写十遍"必须按这个顺序执行"，Agent 还是跳过了步骤吗？

LangGraph 的出发点是：**Agent 的行为不应该是一条线，应该是一张图。**

节点就是函数，边就是控制流，条件边就是 if/else，循环边就是 for/while。整个 Agent 的执行拓扑在编译时就固定了——这不是 prompt 里写"请按步骤执行"，这是代码规定了节点之间只有这些路可走。

## 图是程序，不是建议

Superpowers 那篇文章提到了一个核心问题：用 prompt 约束 Agent 行为，Agent 可以绕过去。Red Flags 表再严格，也只是在"说服"模型配合。

LangGraph 换了一个思路。你不是告诉 Agent "应该"做什么，而是用图规定它**只能**做什么。

\`\`\`python
from langgraph.graph import StateGraph, END, START
from typing import TypedDict

class State(TypedDict):
    input: str
    analysis: str
    code: str
    passed: bool

builder = StateGraph(State)
builder.add_node("analyze", analyze_fn)
builder.add_node("code", code_fn)
builder.add_node("review", review_fn)
builder.add_node("fix", fix_fn)       # fix 也是注册过的节点
builder.add_edge(START, "analyze")
builder.add_edge("analyze", "code")
builder.add_edge("code", "review")

# 条件边：review 决定去 fix 还是结束
builder.add_conditional_edges("review", route, {
    "fix": "fix",
    "end": END,
})
builder.add_edge("fix", "code")  # fix 完回到 code

graph = builder.compile()
\`\`\`

画成图就是：

![LangGraph StateGraph](/discover/langgraph-graph.png)

\`fix → code\` 那条回头路就是循环——代码审查不通过就绕回去重写，绕几次由路由函数决定。

Superpowers 的七步流程也是类似的结构（brainstorming → worktree → plan → SDD → TDD → review → finish），但它的循环写在 SKILL.md 的 prompt 里——"审查没过就重来，最多 5 轮"。LangGraph 的循环写在图里——\`review → route → fix → code\` 是编译过的边，Agent 没有选择不走。

## 状态是一等公民

另一个跟传统 Agent 框架的区别是状态管理。大多数框架的状态藏在对话历史里——消息列表就是状态，Agent 读到哪就是哪。

LangGraph 把状态做成显式的 TypedDict。每个节点声明它消费什么字段、产生什么字段，框架自动做归并：

\`\`\`python
from typing import Annotated

def add_logs(a: list, b: list) -> list:
    """自定义 reducer：追加不重复的日志（纯函数，不修改输入）"""
    seen = set(a)
    result = a.copy()
    for item in b:
        if item not in seen:
            result.append(item)
            seen.add(item)
    return result

class AgentState(TypedDict):
    task: str
    code: str
    logs: Annotated[list, add_logs]  # 自动归并
    attempt: int
\`\`\`

\`Annotated[list, add_logs]\` 的意思是：当多个节点并发更新 \`logs\` 时，用 \`add_logs\` 函数归并，不是简单地覆盖。这在并行执行多个子 Agent 时尤其有用——每个子 Agent 往共享状态里追加自己的日志，不会互相覆盖。

TypedDict 还带类型检查。如果你在节点里试图读一个不存在的字段，Python 的类型检查器能提前发现。这对于多人维护的复杂图来说很实用——节点的"输入契约"和"输出契约"是显式声明的。

## 跟 framework 的边界

LangGraph 常与 LangChain 一同被提及——它确实是 LangChain 生态的一部分，但定位不同。LangChain 提供的是 LLM 调用的抽象层（ChatModel、PromptTemplate、Tool），LangGraph 提供的是 Agent 编排的图运行时。你可以不用 LangChain 的任何组件，只用 \`langgraph.graph.StateGraph\` 然后自己调 LLM SDK。

它的边界划得比较清楚：图结构归它管，tool 怎么实现、LLM 怎么调、embedding 怎么做，它不管。

## StateGraph 是怎么工作的

LangGraph 的核心运行时是一个状态机。每次执行从一个状态开始，经过一个节点产生新状态，然后沿着边走到下一个节点。

运行时管三件事：

**消息传递**——每个节点收到完整状态，返回部分更新。框架用 reducer 把更新归并到状态里，逻辑在上文已经讲过了。

**拓扑排序**——编译时确定节点的执行顺序。并行节点同时跑，串行节点挨个跑。有环的图通过 \`recursion_limit\`（默认 25）防止死循环。

**持久化**——LangGraph API server 对接 PostgreSQL，每一步执行后的状态都持久化。可以暂停、恢复、回退到任意 checkpoint。这在 Studio UI 里就是"时间旅行调试"——拖回之前的 checkpoint 看当时的状态。

这种设计不是 LangGraph 独有的——状态机在游戏引擎和嵌入式系统里用了三四十年了。但把它用在 Agent 编排上，并且把状态定义、归并、持久化做成框架级能力，它是第一个。

## 三种模式

LangGraph 的文档里反复出现三种多 Agent 模式，社区用这些模式搭出了各种系统。

### Supervisor

一个中央 supervisor 节点决定由哪个 Agent 执行任务。它读取当前状态，判断下一步派遣哪个节点：

\`\`\`
用户输入 → supervisor
                ├──→ researcher（查资料）
                ├──→ coder（写代码）
                └──→ FINISH
\`\`\`

Supervisor 本身也是图里的一个节点——它跟 worker 节点的区别只有职责不同，不是特殊实体。每次 supervisor 运行都调一次 LLM，让模型在"派给谁"之间做选择。

### Swarm

Agent 之间直接交接，不经过中央节点。Agent A 执行完毕后将控制权转给 Agent B，直接调用 Command(goto="B")：

\`\`\`
用户 → agent_a
        │
        ▼
     agent_b
        │
        ▼
     agent_c → 结束
\`\`\`

适合领域边界清晰的系统——支持团队干完转给销售团队，不需要中间人判断。

### Hierarchical

子图嵌套。每个子图是一个完整的状态机，放进父图当节点用：

\`\`\`
顶层 supervisor
  ├── 研究团队（子图）
  │   ├── 调研 agent
  │   └── 分析 agent
  ├── 编码团队（子图）
  │   ├── 前端 agent
  │   └── 后端 agent
  └── FINISH
\`\`\`

子图有自己的状态空间，跟父图隔离。研究团队内部的日志不会污染父图的 messages。父图只关心子图的输出，不关心其内部的执行路径。

这三种模式在官方文档的 tutorial 里都有完整实现，图结构画出来就能直接当架构图用。

## 本地实测

在本地搭了 LangGraph 官方 Tutorial 里的 Supervisor 模式，用 DeepSeek 替代了原本的 Claude。

碰到的问题：

- **DeepSeek 不支持 OpenAI 式的 \`json_schema\` 模式**（\`response_format\` 的严格结构化输出），LangChain 的 \`with_structured_output\` 需要这个能力来做路由决策。改用文本 prompt + 关键词解析绕过去了。
- **\`create_react_agent\` 默认 \`recursion_limit\` 是 25**，对于深层 tool calling 序列不一定够用，但更重要的是它在某些场景下会重复调用同一个 tool 停不下来。需要在 prompt 里加"只调一次"的约束，或者改用手动构建的图。
- **\`MessagesState\` 的消息归并**在 \`Command(update={"messages": [...]})\` 的搭配下，部分 edge case 下会出现用户消息丢失的问题。排查发现是 create_react_agent 返回的消息列表结构比预期的复杂，提取最后一轮输出的逻辑需要调整。

三个问题本质上是同一个：LangGraph 的高级模式高度依赖底层模型的 tool calling 能力。如果你的模型在这块不够稳定——格式不支持、循环控制不严格、或者像 DeepSeek 这样对 OpenAI 协议的兼容有缺口——LangGraph 的优势就变成了需要花时间绕的坑。

Claude 和 GPT 系列在这方面的支持最好，LangGraph 的大部分高级模式（\`with_structured_output\`、\`create_react_agent\`、\`Command goto\`）也是假设模型能稳定走 tool calling 流程的。DeepSeek 能跑，但每个高级功能都要单独调试。

相比之下，Superpowers 的依赖就简单得多——它只要模型能读 Markdown 文件。OpenSpec 也一样——只要模型能读 spec 文件。这两者不需要 tool calling，不需要 structured output，对模型的要求只有一条：能理解文本指令。

## 不好用

上面列的问题只是技术层面的。真正让人挫败的是另一个问题：**这东西不好用。**

LangGraph 的 Studio UI 是唯一的官方交互界面，但它默认显示的是 Experiment 视图（批量跑 benchmark 用的），想单次运行要自己摸索切换到 Thread 视图。Supervisor 模式的 Tutorial 代码用 Claude + Tavily，换成 DeepSeek 就踩了一串兼容坑。\`create_react_agent\` 是个黑盒——你传一个 prompt 给它，它自己决定调几次 tool、什么时候停，出问题你只能靠猜。文档写得很全，但信息分散在概念指南、how-to、API 参考三套之间，找一个具体问题的答案经常要翻三个页面。

这些体验问题叠加起来让一个本来清晰的概念（图即程序）变得很难用出来。如果你用的模型不是 Claude 或 GPT，如果你不想学 LangChain 那套抽象层，如果 Studio UI 让你觉得还不如写代码舒服——那 LangGraph 给你的不是确定性，是更多的调试时间。

## 还是在定义 Agent 角色

回到 Supervisor 模式本身。一个 supervisor、一个 researcher、一个 coder——这不就是定义角色然后派活吗？

跟 OpenAI Agents SDK 的 Handoff 没有本质区别，跟 Multica 的 Squad 也没有。你还是在说"这是谁、它管什么、什么时候交给谁"。LangGraph 的不同只在于"谁交给谁"这一步是用图画的，不是用代码写的——但在架构层面，走的还是"定义 Agent 角色 → 分配任务 → 路由结果"的老路。

图的价值不在"定义角色"这一步——定义角色是任何多 Agent 系统都要做的事。图的价值在"不确定的流程"上：条件分支、动态循环、跨子图的状态共享。如果你的 Agent 流程是线性的（A → B → C），用图是杀鸡用牛刀。如果你的流程里有你不知道什么时候会触发、触发多少次的条件逻辑，图就比线性编排合适得多。

所以问题不在"是不是在定义角色"，在"你的流程需要图吗"。

## LangGraph 适合什么

- ✅ 需要精确控制 Agent 执行拓扑的场景——任何两个节点之间的连接方式都要由代码规定
- ✅ 多人维护的复杂 Agent 系统——状态显式声明、reducer 可预测、图结构可 review
- ✅ 需要持久化、暂停、恢复、回退的生产系统
- ❌ 只想给 Agent 一组 tool 让模型自己发挥——ReAct 循环就够了，图式编排是过度设计
- ❌ 使用的模型 tool calling 不稳定——LangGraph 的优势建立在稳定的 tool calling 之上

回到 Superpowers 那篇文章的结尾：Superpowers 从外部约束 Agent 的行为，OpenSpec 从内部约束 Agent 的目标。LangGraph 提供了另一种约束方式——从结构上约束。但它的约束需要底层模型配合，不是纯文本能解决的。三个工具放在一起，选择哪个不取决于谁更好，取决于你信任模型什么能力。`,
  takeaway: 'LangGraph 用图结构替代 prompt 约束来做 Agent 编排——节点之间的路是编译时定死的，不是运行时靠 prompt 说服模型配合的。但这是双刃剑：图越精确，对模型 tool calling 能力的要求越高，如果模型不够稳定，确定性就变成了死板。Studio UI 难用、create_react_agent 是黑盒、文档分散，这些问题让上手门槛比预期的高。更关键的是，Supervisor 模式本质上还是在定义 Agent 角色然后路由，跟其他多 Agent 框架没有区别——图的价值在不确定的流程上，不在线性链里。选 LangGraph 之前先问自己：你的流程真的需要图吗？',
}

export default project
