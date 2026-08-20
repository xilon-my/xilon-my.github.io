const project = {
  slug: 'pi',
  date: '2026-07-29 10:08',
  name: 'Pi Agent Harness',
  url: 'https://github.com/earendil-works/pi',
  description: '一个极简 AI Agent 工具包。统一的多供应商 LLM 接口，带差分渲染的 TUI，可扩展的 Agent 运行时，和自解释的编码 Agent CLI。',
  tags: ['agent'],
  stars: '79.5k+',
  author: 'earendil-works',
  detail:
`Agent 框架现在多到数不过来，每个都在往里面塞东西——加 MCP、加子 Agent、加权限弹窗、加 Plan Mode。功能越堆越多，留给用户自己发挥的空间就越小。

Pi 反着来的。它核心功能少到不能再少，然后把扩展做得很充分。你需要什么自己装，不需要的零开销。

这个理念说好听叫"极简"，说直白就是"我替你把决定权留着"。

## Pi 是什么

Pi 是四个包组成的 monorepo。@earendil-works/pi-ai 管统一 LLM 接口（15+ 供应商），@earendil-works/pi-agent-core 管 Agent 运行时和 tool calling，@earendil-works/pi-coding-agent 是面向用户的 CLI，@earendil-works/pi-tui 是终端 UI 组件库。TypeScript + Bun 写的。

用起来就是设个环境变量就能切模型。设过 \`DEEPSEEK_API_KEY\` 的话，\`/model\` 里直接出现 deepseek-v4-flash，不需要配供应商。

## 少了什么比多了什么更重要

Pi 的 README 里有一节叫 "What we didn't build"，挺能说明这项目的性格。

没有 MCP 支持，因为觉得"Build CLI tools with READMEs"就够了。没有子 Agent，留给扩展实现。没有权限弹窗，进程有什么权限 Pi 就有什么权限。没有 Plan Mode，不需要就是不支持。没有内置 Todo，文件就是你的 todo。没有后台 bash，因为已经有 tmux 了。

每个"没有"后面都跟了理由。不是做不了，是不想替你做这个决定。

你想要什么自己装。装的方式有三种：Extensions（TypeScript 模块）、Skills（遵循 Agent Skills 标准的 Markdown 包）、Themes（JSON 配色）。Extensions 自带了几十个例子，\`plan-mode/\` 大概 50 行就能实现只读模式，\`permission-gate.ts\` 30 行实现危险命令确认。

Skills 的设计也很聪明。启动时 Pi 只扫名字和描述加到 system prompt，完整内容等 Agent 判断任务匹配了再加载。不是一股脑全塞进 context——这本身就是在省 token。

![Pi 对话截图](/discover/pi-agent.png)

## Databricks 的验证：少确实省钱

2026 年 7 月，Databricks 公开了他们内部的编码 Agent 评测结果。他们用了自己百万行级别的真实代码仓库做测试，不是 SWE-Bench 那种公开榜单。

结果最值得注意的发现是：**同一个模型跑在不同框架上，成本差距超过 2 倍，但质量几乎不变。**

原因是 Pi 每轮发送的上下文少了大约 3 倍，跑的轮数更少，工作集更紧凑。Claude Code 和 Codex 内置了大量功能（Plan Mode 提示词、权限弹窗逻辑、MCP 工具定义、子 Agent 指令模板），这些本身就是 token 开销。Pi 没有这些，所以 context 更干净。

![编码 Agent Pareto 前沿](/discover/db-pareto.png)

他们还发现模型能力出现了三个明确的分层。Opus 4.8 和 GLM 5.2 在顶端，GPT 5.4 Mini 和 Haiku 在中间层，开源模型在底层。工程师们即使做简单的 flag 翻转也在用最贵的模型，所以他们开始根据任务复杂度自动路由。

另一个反直觉的发现：**Token 单价便宜不代表总成本低。** Sonnet 5 每 token 比 Opus 4.8 便宜 1.7 倍，但总成本反而更高（$2.09 vs $1.94），分数还低了 6 个百分点。大模型 token 效率更高，花得更少。

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
  takeaway: 'Databricks 的 benchmark 给 Pi 的"极简哲学"做了一个有力的注脚：同一个模型跑在不同的框架上，成本差距超过 2 倍，质量几乎不变。少即是多不只是理念问题——它在 token 账单上能直接体现出来。Pi 在 formal ability 上拒绝了 MCP 选择了更轻的路，在 representational ability 上用树形 Session 给出了不一样的设计，这些选择在 benchmark 中被证明是有效的。',
}

export default project
