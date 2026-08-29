const project = {
  slug: 'openai-agents-python',
  date: '2026-07-29 00:21',
  name: 'OpenAI Agents SDK',
  url: 'https://github.com/openai/openai-agents-python',
  description: 'OpenAI 官方发布的 Python SDK，用于构建多智能体工作流。支持 100+ 大语言模型，提供 Agent 编排、沙箱、护栏、追踪等基础设施。',
  tags: ['Agent'],
  stars: '28k+',
  author: 'OpenAI',
  detail:
`编码助手通常以完整产品形式提供。如果要自行构建能够调用工具、读写文件和运行代码的 Agent 系统，则需要选择更底层的 SDK 或框架。

OpenAI Agents SDK 提供了这一层能力。

它与 Pi 的定位相近,但设计方向不同。Pi 保留较小的核心并依赖扩展,OpenAI Agents SDK 则内置 Agent 运行时、Tool calling、Handoff、Guardrails、Session、Tracing、沙箱和语音等基础设施。

## 跟 Claude Code 和 Codex 不是一回事

Claude Code 和 Codex 是可以直接使用的**终端产品**,OpenAI Agents SDK 则是用于构建 Agent 系统的**框架**。

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

一个 Agent 无法完成的任务可以通过 Handoff 转交给专门的 Agent。Guardrails 用于输入输出校验,\`run_streamed()\` 用于流式返回结果。这些能力都以 function call 为基础。SDK 不预置读取文件或执行 git commit 的工具,这些属于产品层;框架只提供定义和调用 tool 的能力。

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

Agent 完成运行后,可以使用 **Snapshot** 保存工作区状态(本地存为 tar,远程可以存入 S3、GCS、Azure Blob 或 R2),供后续恢复。

## Realtime Agent：原生全双工语音

Realtime Agent 使用 OpenAI 的 **gpt-realtime-2.1**,通过 WebSocket 长连接处理音频输入输出。

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

## 2026 年 Agent 框架的定位

这些框架可以按主要适用场景区分：

- **OpenAI Agents SDK** —— 集成 OpenAI 模型并快速构建基础 Agent
- **Pi** —— 小核心 + 扩展驱动,适合需要自行组合功能的场景
- **LangChain / LangGraph** —— 提供状态机、持久化和时间旅行调试,相关集成较多
- **Mastra** —— TypeScript 团队的一体化方案
- **Pydantic AI** —— 侧重 Python 类型安全和较小的框架开销

到 2026 年,tool calling 已经是常见能力。框架之间的主要差异在于持久化执行、可观测性和人机协同。

OpenAI Agents SDK 可以较快建立基础 Agent。如果目标是完整的编码助手,还需要实现 UI、文件编辑和 git 工作流。SDK 提供 Agent 基础设施,不提供 Codex 这类完整产品的全部功能。`,
  takeaway: 'OpenAI Agents SDK 提供 Agent 基础设施,不是 Claude Code 或 Codex 这类完整产品。它包含双后端沙箱、Manifest 声明式工作区和 Realtime Agent 全双工语音。构建完整编码助手时,仍需自行实现 UI、文件编辑、工具和 git 工作流。',
}

export default project
