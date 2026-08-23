const project = {
  slug: 'pi',
  date: '2026-07-29 10:08',
  name: 'Pi Agent Harness',
  url: 'https://github.com/earendil-works/pi',
  description: '一个保持较小核心功能集的 AI Agent 工具包，提供统一的多供应商 LLM 接口、带差分渲染的 TUI、可扩展的 Agent 运行时和编码 Agent CLI。',
  tags: ['agent'],
  stars: '79.5k+',
  author: 'earendil-works',
  detail:
`许多 Agent 框架把 MCP、子 Agent、权限确认和 Plan Mode 等能力直接放入核心功能。功能增加后,默认行为和上下文开销也随之增加。

Pi 选择保留较小的核心功能集,其余能力通过扩展提供。使用者可以按需安装,未启用的扩展不会占用运行时上下文。

这一设计把更多功能选择留给使用者,代价是部分常用能力需要自行配置。

## Pi 是什么

Pi 是四个包组成的 monorepo。@earendil-works/pi-ai 管统一 LLM 接口（15+ 供应商），@earendil-works/pi-agent-core 管 Agent 运行时和 tool calling，@earendil-works/pi-coding-agent 是面向用户的 CLI，@earendil-works/pi-tui 是终端 UI 组件库。TypeScript + Bun 写的。

用起来就是设个环境变量就能切模型。设过 \`DEEPSEEK_API_KEY\` 的话，\`/model\` 里直接出现 deepseek-v4-flash，不需要配供应商。

## 少了什么比多了什么更重要

Pi 的 README 使用 "What we didn't build" 一节明确列出未内置的能力及原因。

没有 MCP 支持，因为觉得"Build CLI tools with READMEs"就够了。没有子 Agent，留给扩展实现。没有权限弹窗，进程有什么权限 Pi 就有什么权限。没有 Plan Mode，不需要就是不支持。没有内置 Todo，文件就是你的 todo。没有后台 bash，因为已经有 tmux 了。

这些能力可以通过外部工具或扩展实现,项目选择不在核心中预设实现方式。

功能通过三种方式扩展：Extensions（TypeScript 模块）、Skills（遵循 Agent Skills 标准的 Markdown 包）和 Themes（JSON 配色）。Extensions 附带了几十个例子，\`plan-mode/\` 用约 50 行实现只读模式，\`permission-gate.ts\` 用约 30 行实现危险命令确认。

Skills 采用按需加载。启动时 Pi 只把名称和描述加入 system prompt，等 Agent 判断任务匹配后再加载完整内容，避免所有 Skill 同时占用 context。

![Pi 对话截图](/discover/pi-agent.png)

## Databricks 的评测：核心功能规模与成本

2026 年 7 月，Databricks 公开了他们内部的编码 Agent 评测结果。他们用了自己百万行级别的真实代码仓库做测试，不是 SWE-Bench 那种公开榜单。

评测显示：**同一个模型运行在不同框架上时，成本相差超过 2 倍，而质量指标接近。**

Pi 每轮发送的上下文约少 3 倍,运行轮数也较少。Claude Code 和 Codex 内置的 Plan Mode 提示词、权限确认逻辑、MCP 工具定义和子 Agent 指令模板会增加 token 使用量;Pi 未内置这些功能,因此默认上下文更短。

![编码 Agent Pareto 前沿](/discover/db-pareto.png)

评测还显示模型能力可以分为三个层次:Opus 4.8 和 GLM 5.2 得分较高,GPT 5.4 Mini 和 Haiku 居中,受测开源模型得分较低。由于工程师在修改简单 flag 时也可能使用成本较高的模型,团队开始根据任务复杂度自动路由。

另一个结果是：**Token 单价较低不一定使总成本更低。** Sonnet 5 的单 token 价格比 Opus 4.8 低 1.7 倍,但该评测中的总成本更高($2.09 vs $1.94),分数低 6 个百分点。原因是两者完成任务所需的 token 数量不同。

## Formal ability 和 Representational ability 的发展

比完"能不能写代码"和"能调几个 tool"，有两个更深层的能力在悄悄决定这些框架的上限。

### Formal ability

Formal ability 说的是 Agent 跟外部系统打交道的方式有多"正式"。它的反面是"在 prompt 里写一段自然语言来描述怎么调用"。

最早期的 Agent 就是调 API 然后解析字符串。OpenAI 的 function calling 是一个转折点。从那之后分了三步走：function calling / JSON mode → MCP → Agent Skills 标准。

值得注意的是三个工具在这个链条上选了不同的位置。Claude Code 推 MCP，Codex 跟着 Workflow.md 走，Pi 则明确拒绝了 MCP——与其搞一个抽象协议层不如让 Agent 直接读工具的 README。但它兼容 Skills 标准，RPC 模式也有严格的 JSONL 帧结构。

Databricks 的评测间接证明了这条路行得通——Pi 的 context 管理更紧凑，说明它没有为了 formal 而 formal，而是找到了够用的平衡点。

### Representational ability

如果说 formal 解决的是"怎么跟外面说话"，representational 解决的就是"自己怎么想事情"——Agent 内部怎么表示知识和状态，不只是 UI 好不好看。

早期 LLM Agent 本质上没有表征能力。Function calling 让表示从自由文本变成了 schema，但问题是"用完即弃"的。后来出现了记忆系统和上下文管理方案，但都是外挂存储——Agent 知道文件被修改了是因为 context 里有 git diff，不是因为它有一个内部状态模型。

最新的研究通过探针分析发现，LLM 在做空间导航任务时，中间层会激活与空间位置强相关的神经元，这些表征不随 prompt 表述方式变化。[MIT 的研究](https://www.csail.mit.edu/event/thesis-defense-world-models-user-models-and-self-models-ai-systems)揭示了模型内部确实存在一张"地图"。

回到三个工具来看，在内部表征层面它们都依赖底层模型的能力。区别在于**外部表征**的设计。Pi 的 Session 不存成线性日志，而是树形结构。\`/tree\` 看到全部分支，\`/resume <id>\` 跳到任意节点，\`/fork\` 从当前点分叉。Agent 的对话历史不是一条线，而是一棵可以任意导航的树。`,
  takeaway: 'Pi 保留较小的核心功能集,把其他能力交给扩展。Databricks 的评测显示,同一模型运行在不同框架上时,成本相差超过 2 倍而质量指标接近,说明默认上下文规模会直接影响 token 成本。Pi 没有内置 MCP,而是使用 CLI 和 README 描述工具;Session 使用树形结构保存分支,支持恢复和分叉。',
}

export default project
