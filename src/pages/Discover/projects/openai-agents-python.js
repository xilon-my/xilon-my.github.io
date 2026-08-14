const project = {
  slug: 'openai-agents-python',
  date: '2026-07-29 00:21',
  name: 'OpenAI Agents SDK',
  url: 'https://github.com/openai/openai-agents-python',
  description: 'OpenAI 官方发布的 Python SDK，用于构建多智能体工作流。支持 100+ 大语言模型，提供 Agent 编排、沙箱、护栏、追踪等基础设施。',
  tags: ['agent'],
  stars: '28k+',
  author: 'OpenAI',
  detail:
`编码助手越来越强，但它们是产品，不是基础设施。如果你想自己搭一个 Agent 系统——不是聊天机器人，是真的能调用工具、读写文件、跑代码的那种——你能用什么？

OpenAI Agents SDK 就是 OpenAI 给的答案。

它跟 Pi 是一个赛道的，但思路完全不同。Pi 砍功能做扩展，这个 SDK 把你能想到的 Agent 基础设施都塞进去了——Agent 运行时、Tool calling、Handoff、Guardrails、Session、Tracing、沙箱，还包括语音。

## 跟 Claude Code 和 Codex 不是一回事

首先要搞清楚定位。Claude Code 和 Codex 是**终端产品**——你装好就能直接对话，帮你写代码。OpenAI Agents SDK 是**框架**——你拿它搭自己的 Agent 系统。

## 核心概念的用法

Agent 是最小的单位——给它指令、工具、跑起来：

\`\`\`python
from agents import Agent, Runner

agent = Agent(
    name="Assistant",
    instructions="You only respond in haikus.",
)
result = await Runner.run(agent, "Tell me about recursion.")
print(result.final_output)
\`\`\`

加 tool 用 \`@tool\` 装饰器，类型提示就是 schema：

\`\`\`python
@tool
def get_weather(city: str) -> str:
    """Get the weather for a given city."""
    return f"The weather in {city} is sunny."

agent = Agent(
    name="WeatherBot",
    instructions="Use the weather tool to answer questions.",
    tools=[get_weather],
)
\`\`\`

一个 Agent 搞不定的可以用 Handoff 转交给专门的 Agent。还有 Guardrails 做输入输出校验、流式输出用 \`run_streamed()\` 逐步拿结果。每一样都是 function call，SDK 不预置任何"读文件"或"git commit"的工具——那是产品层的事情，框架只给你搭 tool 的能力。

## 三种运行模式

| 函数 | 场景 |
|------|------|
| \`Runner.run()\` | 标准异步 |
| \`Runner.run_sync()\` | 不需要 async 的场合 |
| \`Runner.run_streamed()\` | 实时输出 tool 调用和消息 |

## 沙箱是怎么实现的

SandboxAgent 是它跟 Pi 最大的区别之一。Pi 不做沙箱——它说"进程有什么权限 Pi 就有什么权限"，隔离你自己用容器或者扩展解决。OpenAI 这边内置了两套后端：

**UnixLocalSandboxClient** —— 在 Linux/macOS 上用用户命名空间做文件系统隔离，不走 Docker。轻量，直接在宿主机上限制 Agent 的读写范围。

**DockerSandboxClient** —— 基于 Docker SDK，每次创建独立的容器。支持挂载卷、暴露端口、容器级别资源限制。

工作区的初始化靠 **Manifest** 声明式定义：

\`\`\`python
Manifest(entries={
    "repo": GitRepo(repo="openai/openai-agents-python", ref="main"),
    "data": Dir(children={
        "config.json": File(content="..."),
    }),
    "results": Dir(),
})
\`\`\`

Agent 在工作区里跑完，可以用 **Snapshot** 把状态存下来（本地存 tar，远程可以存 S3、GCS、Azure Blob、R2），下次恢复回来原封不动。

## Realtime Agent：原生全双工语音

这个值得一提。它用的是 OpenAI 的 **gpt-realtime-2.1**，走 WebSocket 长连接，原生理解音频输入输出。

\`\`\`python
from agents.realtime import RealtimeAgent, RealtimeRunner

agent = RealtimeAgent(
    name="Assistant",
    instructions="You are a helpful voice assistant.",
)
runner = RealtimeRunner(starting_agent=agent)
session = await runner.run()
\`\`\`

跟传统的"语音转文字 → LLM → 文字转语音"三阶段方案不同，这是一个原生多模态模型——音频以 PCM 格式直接流进去流出来，语气、语速、停顿这些信息不会在转文字的过程中丢失。

延迟在几百毫秒级别。目前只能用 OpenAI 的 Realtime API，DeepSeek 这类供应商没有这个能力。价格也贵很多——音频比文本贵大概 20 倍。

字节跳动的豆包走的是同一个技术路线，4 月发布的 Seeduplex 也是原生全双工方案，现在豆包 App 的"打电话"功能里全量上线了，2025 年 6 月开放了 API。

## 2026 年的 Agent 框架格局

对当前框架们的位置大概有了个判断：

- **OpenAI Agents SDK** —— 如果你用 OpenAI 模型，从零到能跑的 Agent 最快路径
- **Pi** —— 极简 + 扩展驱动，适合想自己定制一切的人
- **LangChain / LangGraph** —— 生态最大，状态机 + 持久化 + 时间旅行调试，生产最成熟
- **Mastra** —— TypeScript 团队的一体化方案
- **Pydantic AI** —— Python 类型安全最强，最轻量

所有框架都能调用 tool 了，2026 年这已经不是区分点。真正拉开差距的是持久化执行、可观测性、人机协同。

OpenAI Agents SDK 在"从决定到第一个能跑的 Agent"这段路上是最短的。但你要搭的是一个完整的编码助手——要有 UI、有文件编辑、有 git 工作流——那 SDK 只给了你 40%，剩下 60% 是搭 UI、写 tool 和配流程。它不是 Codex，它是造 Codex 的积木。`,
  takeaway: 'OpenAI Agents SDK 是 OpenAI 在"Agent 基础设施"层的布局。它不是 Claude Code 也不是 Codex——它是造那些东西的积木。沙箱的双后端设计、Manifest 声明式工作区、Realtime Agent 的全双工语音，这三样是它跟 Pi 和 LangChain 拉开差距的地方。但框架始终是框架，想搭一个好用的编码助手，剩下 60% 的工作量得自己来。',
}

export default project
