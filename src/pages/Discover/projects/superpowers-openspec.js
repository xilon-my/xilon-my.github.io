const project = {
  slug: 'superpowers-openspec',
  date: '2026-07-30 16:30',
  name: 'Superpowers + OpenSpec',
  url: 'https://github.com/obra/superpowers',
  url2: 'https://github.com/Fission-AI/OpenSpec',
  description: 'Superpowers 是一套给 AI 编程代理用的结构化方法论，OpenSpec 是一个 AI 原生的 spec 驱动开发框架。一个管过程一个管契约，放在一起看才完整。',
  tags: ['Framework'],
  stars: '237k+ / 56k+',
  author: 'Obra (Prime Radiant) / Fission AI',
  detail:
`Agent 写代码的能力在快速提升，但一个根本问题始终没有解决：**你没法相信它输出的质量是稳定的**。同一个模型这次写得好，下次可能就跑偏了；在 Claude Code 上表现好的流程，换到 Codex 上又不一样。

两个项目从不同方向在回应这个问题。一个是 Superpowers，一个是 OpenSpec。它们属于不同作者、不同社区，但解决的问题恰好互补——已经有社区项目把它们串起来用了（SpecPilot）。先各自看清楚，再放在一起看，才能理解为什么。

## Superpowers：Agent 的纪律

Superpowers 不是一个新的 Agent 框架或模型。它是一组 **SKILL.md 文件** 加一个启动注入机制，让 Agent 启动后走一套强制工程流程。作者是 Jesse Vincent（Obra），做 Perl 的那个，后来做了 RT 和 K-9 Mail。

它的核心判断是：Agent 的能力已经够用了，问题出在**工程纪律**上。默认情况下，Agent 拿到任务就写代码——没有 spec、没有计划、没有测试、没有 review。Superpowers 把这些步骤全部变成强制性的，而且在系统层面让 Agent 无法绕过去。

### 七步流程

Agent 装上 Superpowers 后的工作流是固定的：

\`\`\`
brainstorming → worktree 隔离 → 写计划 → 子 Agent 驱动开发(SDD) → TDD → 代码审查 → 收尾
\`\`\`

每个步骤之间是硬性关卡：

**brainstorming**：Agent 不能写任何代码。它必须探索项目结构、读现有文档、分析你提的问题然后给 2-3 个方案，每展示一个 section 让你确认一次。所有对话产出保存为一份设计文档写入 \`docs/superpowers/specs/\`。你确认了书面 spec 之后，Agent 才能进入下一步。

**worktree 隔离**：在独立的 git worktree 上开发，不污染主分支。进入前先跑一遍测试确认基线。

**写计划**：把设计拆成 2-5 分钟的原子任务。每个任务必须写清楚操作哪个文件、具体改什么、怎么验证。没有 TODO、没有"以后再说"。计划的阅读对象是"一个有天赋但没有上下文、判断力和品味的初级工程师"——所以任何模糊的东西都不行。

**Subagent-Driven Development (SDD)**：每项任务派一个全新的子 Agent，不继承主会话的任何历史。子 Agent 执行完后经过**两轮审查**——先查是否满足 spec（要精确到文件名和行号），再查代码质量。审查没过就重来，最多重试 5 轮，超了主 Agent 介入。审查者每次都是全新的子 Agent，避免"知道实施者想干什么所以放过"的偏差。

**TDD**：RED → GREEN → REFACTOR。先写一个会失败的测试，跑一遍确认它真的失败，写最少代码让它通过，重构。

"先写测试"不是测试，是**设计**——你在定义接口和行为契约，确定函数接受什么、返回什么、边界在哪。如果 Agent 先写了代码再写测试，测试只是在确认代码已经在做的事，不是验证代码是否满足需求。Agent 特别擅长这个把戏：先写代码，再写一个只覆盖 happy path 的测试，然后说"全绿了"。那不是测试，是走形式。

所以规矩是：先红再绿，顺序不能倒。如果发现 Agent 先写了代码，删掉重来——不是惩罚，是保证测试真的在检查需求，不是在验证刚写的那行代码。

**代码审查**：在任务之间做，不是全部完成后。毛病分 Critical、Important、Minor 三级。Critical 和 Important 阻塞进度，不解决不能继续。

**收尾**：rebase、跑全量测试、给四个选项——merge、开 PR、保留分支、删 worktree。

### Red Flags 表

这是 Superpowers 在系统设计上最独特的地方。bootstrap 里有一张对照表，列出 Agent 用来跳过流程的常用借口，然后每条后面打脸：

| 想法 | 现实 |
|------|------|
| "这就是个简单问题" | 问题就是任务，检查有没有 skill 可用 |
| "我先看看代码" | Skill 会告诉你**怎么**看，先检查 skill |
| "我知道那个意思" | 知道概念不等于用了 skill，调它 |
| "这 skill 杀鸡用牛刀" | 简单的事情也会变复杂，用 |
| "我先做这一件小事" | 做什么之前都先检查 |

核心规则叫 **1% Rule**：只要你觉得有 1% 的可能某个 skill 能用，就必须调它。Agent 没有选择权。

规则的前面用了 \`<EXTREMELY-IMPORTANT>\` 标签括起来，语气是"YOU DO NOT HAVE A CHOICE"。这不是建议，是声明。

### 跨平台设计

Superpowers 目前支持 11 个平台：Claude Code、Cursor、Codex、Gemini CLI、Kimi Code、OpenCode、Pi、Antigravity、Copilot CLI、Factory Droid。

架构分三层：**skills/**（纯 Markdown 行为描述，不提具体工具 API）→ **tool mapping**（每个平台一个映射文件）→ **bootstrap**（启动时注入）。Skill 文件不写 "用 claude code 的某工具"，只写 "读一个文件" 或 "派一个子 Agent"，由映射层翻译成平台对应的工具调用。

### 一个实际成果

Superpowers 最知名的产出是 **chardet 7.0.0** 的完全重写——一个字符编码检测库。用 Superpowers 流程重写后性能提升 41 倍、准确率达到 96.8%。整个开发过程中 94% 的 PR 被拒率——大部分是 Agent "没走流程" 直接提的——也反向验证了这个项目对纪律的坚持不是口头上的。

## OpenSpec：Agent 的蓝图

OpenSpec 来自 Fission AI，一家 YC W26 的初创公司，核心开发者是 Tabish Bidiwale。它的定位是 "the most loved spec framework"。

如果说 Superpowers 管的是"Agent 怎么干活"，OpenSpec 管的就是"Agent 要干什么活"。

Spec（规范）就是写清楚"这个系统应该做什么"的文件。代码告诉你系统**现在**是怎么跑的，spec 告诉你系统**应该**怎么跑。两者的区别在于意图：读代码你只能推导出作者实际做了什么，读 spec 你知道作者**想**做什么。

为什么要为 Agent（和人）写 spec？因为没有 spec 的时候，每件事都要靠猜。新来的开发者看一段逻辑，不确定它是功能还是要修的 bug。AI 拿到一个 Issue，只能从对话历史里拼凑上下文，同一个需求不同会话可能做出完全不同的实现。Spec 把"预期行为"变成白纸黑字——所有人都看同一份文件，不用猜。

但传统 spec 的问题是太重了。写一份完整的软件需求规格说明（SRS）可能要几周，写完已经过时了。OpenSpec 的解法是**增量**：不为整个项目写 spec，只为正在改的东西写。"你要改搜索功能？那就写搜索功能的行为 spec，只写你改的那部分。"——这就是"spec-driven"的意思：不是写完全部再开发，而是用 spec 驱动每次改动，让文档跟着代码一起长。

### Spec 驱动的核心

OpenSpec 在你的项目里加一个 \`openspec/\` 目录，结构分两半：

\`\`\`
openspec/
├── specs/               # 当前系统的事实——现在长什么样
│   └── cli-init/spec.md
├── changes/             # 正在做的事——要改什么
│   └── add-dark-mode/
│       ├── proposal.md  # 为什么和要什么
│       ├── specs/       # 增量差异（新增了啥、改了啥、删了啥）
│       ├── design.md    # 技术方案
│       └── tasks.md     # 实施清单
└── config.yaml          # 配置 + 项目规则
\`\`\`

一篇 spec 文件的结构长这样：

\`\`\`markdown
# CLI Init Specification

## Purpose
\`openspec init\` 在当前目录创建 openspec/ 结构。

## Requirements

### Requirement: 目录已存在时跳过
The system SHALL skip directory creation when openspec/ already exists.
#### Scenario: 已初始化过
- **WHEN** user runs \`openspec init\` in a project with openspec/
- **THEN** the system prints a message and exits

### Requirement: 指定 tools 参数
The system SHALL generate config for specified AI tools.
#### Scenario: 单工具
- **WHEN** user runs \`openspec init --tools claude\`
- **THEN** only Claude Code 的配置文件被生成
\`\`\`

每条 requirement 是 SHALL 句式定义的行为约束，后面跟具体的 scenario（Given/When/Then）。不写实现细节，只写"应该怎么样"。

这是 OpenSpec 的"真理来源"（source of truth）。当有人问"这个命令干了什么"，读 spec 比读代码快。当 AI 准备改代码时，读 spec 知道当前应该有什么行为，然后决定改哪条。

### 实际怎么用

安装就一条命令：

\`\`\`bash
npm install -g @fission-ai/openspec
cd your-project && openspec init
\`\`\`

\`openspec init\` 在项目里建好 \`openspec/\` 目录结构，同时在你的 AI 工具里注册 slash commands。以 Claude Code 为例，init 之后你的技能列表里多了 \`opsx:propose\`、\`opsx:apply\`、\`opsx:archive\` 等命令。

日常使用走四步：

1. **想清楚** —— 拿不准怎么做时跑 \`/opsx:explore\`，AI 会读你的代码并讨论方案，不产生任何文件
2. **写计划** —— \`/opsx:propose 功能名\`，AI 生成四个 artifact，你逐份审查，不对就跟 AI 来回改
3. **干活** —— 确认计划后跑 \`/opsx:apply\`，AI 按 tasks.md 逐项实施。做一半超时了？重开会话再跑一次 \`/opsx:apply\`，从上次未完成的任务继续
4. **归档** —— 完成后跑 \`/opsx:archive\`，delta specs 合并进主 specs，change 移到 archive/。你的 \`openspec/specs/\` 现在描述了系统的最新行为

这四步不是瀑布。你随时可以在 apply 过程中改 spec，改完继续 apply，不需要重来。也随时可以跳过某些 artifact——如果你只需要改个 API key 的名字，写个 tasks.md 直接开干就行，不用写 proposal 和 design。

第一次用的话，建议跑 \`openspec init\` 之后去它的 dogfooding 目录看看——OpenSpec 自己就用 OpenSpec 开发，\`openspec/specs/\` 里有 35 个 spec 文件，\`openspec/changes/archive/\` 里有 80+ 个已归档 change。装完之后看一眼就知道怎么写了。

### Change 里的四个文件

当你跑 \`/opsx:propose\` 时，AI 会生成一个完整的 change 目录。这四个文件各管各的事，而且有明确的上下游依赖关系。

**proposal.md——为什么干和干什么**

这是 change 的第一份文档，用来锁定方向和范围。不谈具体怎么实现，只回答：当前有什么问题、改的范围是多大、不改什么东西、跟现有的 spec 和设计有什么关系。如果准备砍 scope 或发现依赖关系也要写在这里。

目的就是让你和 AI 在"要不要做"上达成一致。如果这里就谈不拢，下面的都不用写了。审查者（human）看完 proposal 就能决定是否批准整个 change，不需要读代码。

实际内容有点像 RFC 的摘要——几百字，说清楚"不做这个会怎样"和"做了会怎样"就够了。跑 \`/opsx:explore\` 出来的讨论结果可以当素材直接贴进来。

**specs/——具体改了什么行为**

这是 change 的核心。里面按能力域组织文件（\`specs/cli-init/spec.md\`），每个文件只写 delta——新增、修改、删除了哪些 requirement。

每条 requirement 用 SHALL 句式定义行为：

\`\`\`markdown
### Requirement: 支持 help 子命令

The system SHALL display usage info when \`openspec --help\` is invoked.

#### Scenario: 正确输入显示帮助
- **WHEN** user runs \`openspec --help\`
- **THEN** system prints the usage text
- **AND** exits with code 0

#### Scenario: 短参数 -h 等效
- **WHEN** user runs \`openspec -h\`
- **THEN** the output is identical to \`--help\`
\`\`\`

Archive 时这些 delta 合并到主 \`openspec/specs/\` 里——新增的追加进去、修改的替换原版、删除的移除。Archive 之后的历史就是一份精确的 changelog：哪天改了哪条 requirement，为什么。

**design.md——怎么实现**

你决定做、也知道改什么行为了，接下来就是技术方案怎么写。design.md 用来记录：架构怎么调整、依赖怎么加、数据流怎么走、有没有兼容性风险。不写具体代码量，写思路。

这个文件是可选的。如果你的 change 改的就是换一个字符串常量，不写 design.md 完全 OK。但如果涉及数据结构变更或第三方服务交互，最好写清楚，方便以后的人（包括 AI）看 spec 的时候知道为什么要这么实现。

"Enablers, not gates" 在这里体现得很明显：proposal 没写完也能开始写 design，design 和 specs 互相独立，谁先写都行。

**tasks.md——实施清单**

这是给 Agent 执行的。其他文件是给人看的，这个是给 AI 逐项打勾用的。

每项 task 对应一个具体的代码改动，格式是 checklist：

\`\`\`markdown
- [ ] 读取当前配置，确定 help 命令尚未实现
- [ ] 在 cli/index.ts 中注册 --help 子命令
- [ ] 实现 help 文本输出函数
- [ ] 测试：分别测试 --help 和 -h
\`\`\`

每项 task 尽量拆到 5 分钟以内。不设 TODO 或"以后再做"。Agent 按顺序执行，每完成一项打一个勾。如果中间会话超时了，重开之后 \`/opsx:apply\` 会从第一个未完成的 task 继续，不丢进度。

这四个文件的依赖路径是：proposal → specs → design → tasks。每一层都依赖前一层的输出才能写好，但任何时候都可以回头改。它们告诉 AI 三件事：**做什么、做成什么样、按什么顺序干**。

这就是 OpenSpec 跟 GitHub Spec Kit 和 Kiro 最大的区别——不是让你先写完整份系统文档再开工，而是**每次 change 只写 delta**。项目已经存在五年了，你从今天开始用 OpenSpec，只需要为你这次改动的行为写 spec，不用补之前五年的文档。Archive 之后的 \`openspec/specs/\` 就是一份精确的变更历史：哪天改了哪条 requirement，为什么改，谁批准的。

### "Enablers, not gates"

另一个关键的设计取舍：OpenSpec 的 artifact 依赖关系是"使能"关系，不是"闸门"。提案没写完也能开始写设计，设计和 spec 可以并行。没有哪个步骤锁住你不能做下一步。

好处是灵活，代价是依赖团队自觉——没人拦着你跳过 \`/opsx:propose\` 直接改代码。跳过之后 spec 就跟代码脱节了，系统退化成"一堆没人看的 Markdown"。这是所有文档驱动开发的共同困境，OpenSpec 没解决这个问题，但它用轻量设计把这个问题暴露得足够清晰——你可以随时开始，也可以随时放弃，后果自负。

### 生态集成

OpenSpec 支持 32 个 AI 编码工具的 slash commands。\`openspec init --tools claude,cursor\` 一键在对应目录生成配置。每个工具的调用格式不同（\`/opsx:propose\` vs \`/opsx-propose\` vs \`@opsx-propose\`），init 命令会自动处理。

## 放在一起看

这两个项目放在一起不是巧合。

Superpowers 是一个能约束 Agent 行为的方法论。但方法论管的是"怎么做"，不是"做什么"。没有 OpenSpec 的话，Agent 按 Superpowers 的流程跑完 brainstorming 和 planning，它的"计划"还是基于对话历史里那些零散的描述——不是基于一份结构化的、可审计的 spec。

反过来也一样。OpenSpec 给了一份漂亮的 spec 文档，但如果没有 Superpowers 那样的流程约束，Agent 可能在写了三行代码之后就跑偏了，或者跳过了测试，或者做了 scope creep——spec 还在那里，但代码已经不是 spec 的样子了。

一个解决"Agent 怎么写代码"，一个解决"Agent 写的是什么"。

社区里已经有人在串这两个项目了。有一个叫 **SpecPilot** 的扩展把 OpenSpec 和 Superpowers 接成了一条五阶段流水线：先用 OpenSpec 把需求写进 spec（\`/opsx:propose\`），再触发 Superpowers 的 SDD 流程去执行，执行完回到 OpenSpec 做 \`/opsx:verify\` 验证一致性，最后 \`/opsx:archive\` 归档。还有个叫 **spec-superflow** 的项目更进一步——把两个项目在源层面融合成了一套 9-skill、8-state 引擎，加上了 intent-lock 和 SHA256 hash 校验，保证 spec 不会被改掉而不被发现。

这说明两个项目虽然在独立发展，但它们在工具链里扮演的角色已经相对确定了——Superpowers 偏执行质量，OpenSpec 偏目标对齐。一个成熟的项目两个都需要。`,
  takeaway: 'Superpowers 从外部约束 Agent 的行为，OpenSpec 从内部约束 Agent 的目标。一个管流程一套管契约。两个项目独立发展但被社区串成了完整工具链——先用 OpenSpec 写 spec，再用 Superpowers 按流程实现。没有流程的 spec 变成没人看的 Markdown，没有 spec 的流程基于猜测写代码。两个都装了你才能说自己的 Agent 开发流程是完整的。',
}

export default project
