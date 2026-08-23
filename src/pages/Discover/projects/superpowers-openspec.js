const project = {
  slug: 'superpowers-openspec',
  date: '2026-08-14 16:30',
  name: 'Superpowers + OpenSpec',
  url: 'https://github.com/obra/superpowers',
  url2: 'https://github.com/Fission-AI/OpenSpec',
  description: 'Superpowers 为 AI 编程代理提供结构化工程流程,OpenSpec 提供 spec 驱动的行为契约。本文按契约、隔离、拆解、验证和上线五个阶段,说明两者在存量系统中的分工与边界。',
  tags: ['agent'],
  stars: '237k+ / 56k+',
  author: 'Obra (Prime Radiant) / Fission AI',
  detail:
`Agent 写代码的能力在快速提升,但输出质量仍不稳定。同一个模型在不同会话中可能给出不同实现;在 Claude Code 上有效的流程,换到 Codex 后也可能表现不同。大型存量系统会放大这一问题:改动横跨多个文件,多人同时开发,错误改动的成本较高。

两个项目从不同方向在回应这个问题。一个是 **OpenSpec**，一个是 **Superpowers**。它们属于不同作者、不同社区，但解决的问题恰好互补。

这篇文章不按"先介绍工具、再讲用法"来组织，而是按**改一次大型存量系统的顺序**走一遍。场景是：一个 RR（需求单）进来，先定位到要改哪里——找到一个"坐标"（哪段源码、哪张表、跑在哪台机器），那是这个系列前一篇讲的事。坐标到手之后，还剩五步：**契约、隔离、拆解、验证、上线**。每一步该用什么，就介绍什么。

## 第一步，契约先行：OpenSpec 管"要改什么"

定位待修改代码后,第一步是明确记录本次改动的内容和边界。这一步由 **OpenSpec** 负责。

OpenSpec 来自 Fission AI，是一家 AI 原生的 spec 驱动开发框架。它的核心概念是 **spec（规范）**：代码告诉你系统**现在**是怎么跑的，spec 告诉你系统**应该**怎么跑。两者的区别在于意图——读代码你只能推导出作者实际做了什么，读 spec 你知道作者**想**做什么。

spec 用于明确预期行为。没有 spec 时,Agent 只能从 Issue 和对话历史中推断上下文,同一需求在不同会话中可能产生不同实现。把预期行为写入统一文件后,人和 Agent 可以依据同一份约束工作。

但传统 spec 的问题是太重了。写一份完整的软件需求规格说明可能要几周，写完已经过时了。OpenSpec 的解法是**增量**：不为整个项目写 spec，只为正在改的东西写。对大型存量系统，这一点尤其值钱——**五年前的老代码没 spec 没关系，你只为你这次碰的这一块写 spec**，不用给五年历史补课。

一次改动的契约，落在 OpenSpec 的 change 里。四个文件各管各的事：

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

- **proposal.md——为什么干和干什么**：锁定方向和范围，只回答"当前有什么问题、改的范围多大、不改什么"。目的是让一个人不读代码就能批准或否掉整个 change。
- **specs/——具体改了什么行为**：change 的核心，每条 requirement 用 SHALL 句式定义行为。它写的是 delta——新增、修改、删除了哪些行为。
- **design.md——怎么实现**：架构怎么调整、依赖怎么加、有没有兼容性风险。可选的——只改一个字符串常量就不用写。
- **tasks.md——实施清单**：给 Agent 执行的 checklist，按依赖顺序列出这次改动的每一块。

一篇 spec 文件长这样——每条 requirement 用 SHALL 句式定义行为，后面跟 scenario（Given/When/Then）：

\`\`\`markdown
### Requirement: 目录已存在时跳过
The system SHALL skip directory creation when openspec/ already exists.
#### Scenario: 已初始化过
- **WHEN** user runs \`openspec init\` in a project with openspec/
- **THEN** the system prints a message and exits
\`\`\`

这是 OpenSpec 的"真理来源"（source of truth）。当 AI 准备改代码时，读 spec 知道当前应该有什么行为，然后决定改哪条。

大型存量系统需要这份行为合同,主要有以下原因:

- **限制 scope creep（范围蔓延）**。存量系统中常有与当前需求相邻但无关的问题。合同明确记录改动范围,便于识别越界修改。
- **审计与回溯**。大系统是很多人、很多 agent 在改，每笔改动都要有据可查。哪天线上出了问题，要能倒查到"这笔改动当时批准的范围是什么、谁批的"。
- **验证有对账单**。后面所有测试、门禁、verify，都是拿代码对着这份合同比。

实际用起来，OpenSpec 在你的项目里加一个 \`openspec/\` 目录，同时注册一组命令：\`/opsx:propose\`（生成 change 的四个文件，你逐份审查，不对就跟 AI 来回改）、\`/opsx:apply\`（按 tasks.md 逐项实施）、\`/opsx:archive\`（delta specs 并回主 specs）、\`/opsx:verify\`（核对代码和合同）。安装就一条命令：\`npm install -g @fission-ai/openspec\`，然后 \`openspec init\`。

这一步上，OpenSpec 的契约和 Superpowers 的纪律是同一个方向——Superpowers 里也有一道同样的规矩（brainstorming）：Agent 不能直接写代码，先探索项目、读文档、把方案写成设计文档让你确认。两个项目在"先想清楚再动手"上是一致的。

OpenSpec 的 artifact 依赖是"使能"关系,不是强制闸门:proposal 未完成时仍可开始编写 design。这提供了灵活性,也意味着工具不会阻止使用者跳过 propose 直接修改代码。若缺少流程约束,spec 可能与代码脱节。下一步的 Superpowers 用于补充这类执行约束。

## 第二步，隔离与基线：Superpowers 管"别动到别人的"

合同签完，动手之前还有一件事：**别在主分支上直接改。** 大型存量系统同时有很多人、很多 agent 在改；在主分支上直接改，改到一半别人的提交进来，不是冲突就是覆盖，你的半成品还可能被当成新代码误合并上线。

这一步是 **Superpowers** 的主场。Superpowers 不是一个新的 Agent 框架或模型，而是一组 **SKILL.md 文件** 加一个启动注入机制，让 Agent 启动后走一套强制工程流程。作者是 Jesse Vincent（Obra）。它的核心判断是：Agent 的能力已经够用了，问题出在**工程纪律**上——默认情况下，Agent 拿到任务就写代码，没有 spec、没有计划、没有测试、没有 review。Superpowers 把这些步骤全部变成强制性的，而且让 Agent 无法绕过去。

它的答案是 worktree 隔离：从主代码仓另开一个独立的副本，在里面改，主分支不受影响，改完再合并回去。但这一步对存量系统最重要的，不是隔离本身，是进隔离区之前那道手续：**基线测试**。

**基线测试**是在改动开始前运行现有测试,记录系统当前状态。后续测试失败时,基线可以区分问题由本次改动引入,还是在改动前已经存在。Superpowers 要求执行这一步;如果基线测试不通过,是否继续由人决定,Agent 不能自行判断。

## 第三步，拆解实施：逐项执行，逐项验证

契约和隔离环境准备完成后,需要把跨文件改动拆成可执行步骤。OpenSpec change 中的 tasks.md 是合同级实施清单,按依赖顺序列出改动块。Superpowers 不直接执行这份清单,而是根据 proposal 和 specs 把每个改动块细化成 2-5 分钟、精确到文件并带验证标准的**原子任务**,再由子 Agent 逐条执行并配合 TDD。因此这里有两层计划:tasks.md 记录需要完成的事项,Superpowers 计划描述每项如何执行。两层之间需要 SpecPilot 等社区工具衔接;tasks.md 的勾选状态可用于恢复中断的会话。

实施阶段同时使用两项约束：

**SDD（Subagent-Driven Development，子 Agent 驱动开发）**与 OpenSpec 的 spec-driven 不同:SDD 让子 Agent 执行任务,spec-driven 用于编写行为契约。每项任务使用新的子 Agent,它不继承主会话记忆,只依据任务描述和文档工作。每个任务经过两道审查:先检查是否满足 spec,并精确到文件名和行号;再检查代码质量。这样可以在任务级识别超范围改动,而不是等到最终 review。审查不通过时重新修改,最多 5 轮。

**TDD（测试驱动开发）**先编写一个会失败的测试,运行并确认失败（RED）,再编写最少代码使其通过（GREEN）,最后重构。Superpowers 要求在生产代码之前观察测试失败,以确认测试确实覆盖尚未实现的行为。先写代码再补测试,只能确认当前实现,不能证明测试能够发现缺失行为。

先写测试也在定义接口和行为契约,包括函数输入、输出和边界。若先实现代码,再补一个只覆盖 happy path 的测试,测试可能只复述当前实现。因此 Superpowers 固定采用先 RED 后 GREEN 的顺序。

对于缺少测试的存量代码,应先为现有行为补充测试,再修改实现。这样可以记录函数修改前的行为,并判断后续变化是否来自本次改动。

Superpowers 的 bootstrap 列出常见的跳步理由,并为每种情况给出不应省略流程的说明:

| 想法 | 现实 |
|------|------|
| "这就是个简单问题" | 问题就是任务，检查有没有 skill 可用 |
| "我先看看代码" | Skill 会告诉你**怎么**看，先检查 skill |
| "我知道那个意思" | 知道概念不等于用了 skill，调它 |
| "这个 skill 对简单任务过重" | 简单任务也可能在执行中增加复杂度，仍需使用 |
| "我先做这一件小事" | 做什么之前都先检查 |

核心规则叫 **1% Rule**：只要你觉得有 1% 的可能某个 skill 能用，就必须调它。Agent 没有选择权。规则前面用 \`<EXTREMELY-IMPORTANT>\` 标签括起来，语气是"YOU DO NOT HAVE A CHOICE"——这不是建议，是声明。

## 第四步，验证：改对了，和没改坏，是两件事

修改完成后,需要用三类检查同时验证需求实现和回归情况:

1. **TDD 的绿色测试**——每个原子任务都验证过，证明"改对了"。
2. **OpenSpec 的 \`/opsx:verify\`**——机器搜代码，核对合同和代码是否一致：合同里承诺的每条 requirement 有没有实现、有没有被破坏。**注意，verify 检查的是"文档有没有跟上代码"，不是"代码有没有跑对"**——它搜代码找证据，发现问题按 CRITICAL / WARNING / SUGGESTION 三级摆出来，但不阻塞归档，只把问题亮出来。OpenSpec 还有一个全自动的 \`openspec validate\` 命令做结构性校验：检查合同本身有没有写坏（格式对不对、被替换的旧条款在不在、归档的任务有没有打勾）——它比的是 spec 和 spec，不是 spec 和代码；和代码对账，是 verify 的活。
3. **五道门禁**——Lint（代码风格和明显错误）、编译、测试、覆盖率和安全检查。任一门禁失败都会阻止流程继续。OpenSpec 和 Superpowers 本身不执行这些门禁;官方说明需要使用者通过 CI 或 hook 配置,最终结果由 CI 判定。

测试分为两层。**单元测试**隔离数据库、网络和其他模块,用于验证单个函数或类;**集成测试**连接多个真实组件,用于验证系统组合后的行为。Agent 可以编写两类测试,但集成测试依赖测试库、种子数据和服务启动方式等环境条件。人需要提供这些基础设施、说明存量系统的预期行为,并判断 flaky 测试来自测试本身还是系统缺陷。

存量系统需要同时验证新行为和既有行为:**TDD 验证前者,门禁检查后者。** 大量既有场景不适合人工逐一检查,因此由 CI 给出通过或失败结果。verify 则检查文档与代码是否一致,用于发现 spec 漂移。

## 第五步，上线：交给人审，给历史留痕

验证都过了，最后一步是把改动安全地并回主干、并且让这次改动以后查得到。这一步三样东西：

- **评估报告**——这次改动的验证总结：改了哪些文件、测试结果、门禁通过情况。
- **PR Gate（合并门禁）**——把评估报告和 diff（改动前后的对比）一起交给人，人批准才合并。**PR（Pull Request，合并请求）** 就是"把隔离区里的改动申请并回主代码仓"的那一步。
- **archive（归档）**——把 delta specs 并回主 \`openspec/specs/\`，change 移进 \`openspec/changes/archive/\`，成为精确的变更历史：哪天改了哪条 requirement、为什么改。

Superpowers 的**收尾**规矩也一样：rebase、跑全量测试，然后给你四个选项——merge、开 PR、保留分支、删 worktree。改完不是直接并回去，是交给你决定怎么收。

存量系统的上线影响范围较大，不能只依据 Agent 自己给出的结论。Agent 负责提供验证证据，人负责审查证据是否充分，PR Gate 负责在合并前落实这项审查。archive 则保留变更历史，便于出现问题时回溯，并维护一份描述系统当前状态的机器可读文档。

## 边界：开发、测试、部署，到底谁来管

完成五个步骤后，可以进一步明确两个工具在开发、测试和部署中的边界：**两者共同约束开发流程，只覆盖测试工作的一部分，均不负责部署。**

- **开发**：契约（OpenSpec）+ 纪律（Superpowers），上面讲完了。
- **测试**：OpenSpec 把"该测什么"写成 scenario——一条条 GIVEN / WHEN / THEN，官方原话是"**能变成一条自动化测试**"的原料；Superpowers 要求把 scenario 写成实际测试，并按 RED、GREEN 的顺序执行。**但测试运行环境不在两者的职责范围内。** TDD 的 RED 测试在存量代码上首次失败，原因可能不是实现尚未完成，而是周边代码无法编译或运行。要让长期未修改的代码具备可测试性，需要先建立**接缝**：隔离待修改部分，切断其对全局状态、时间、数据库和网络的直接依赖。这部分逆向分析与可测试性改造仍需项目自行完成。
- **部署**：Superpowers 的收尾停在 merge 或创建 PR 之前，后续的构建、发布、灰度和回滚不在其范围内；OpenSpec 的 CLI 也没有部署命令。**因此，部署门禁仍由项目自己的 CI/CD 实现。** 两个工具可以提供测试和变更记录，CI/CD 负责实际执行与判定。

还需说明一个限制：**spec 漂移（文档和代码逐渐脱节）没有完全解决。** OpenSpec 没有持续扫描机制，也不会阻止使用者跳过 propose 直接修改代码。增量 delta 只保证本次修改的部分具有 spec，不保证此前的实现与文档完全一致；最终仍需在代码审查和归档时由人确认。

把谁管什么列成一张表，边界就清楚了：

| 环节 | OpenSpec 干 | Superpowers 干 | 还得自己搭 |
|---|---|---|---|
| 定目标 | proposal + 增量 spec（SHALL 定义行为） | brainstorming 的产出 | — |
| 定做法 | design.md | 计划（原子任务 + 怎么验证） | — |
| 定位 | tasks.md 列出改动块 | 计划细化成原子任务（精确到文件） | 前一篇 OKF 的坐标 |
| 改代码 | — | SDD 子 Agent + 两道审查 | — |
| 测试 | scenario 提供 GIVEN/WHEN/THEN 骨架 | TDD 强制先红再绿 | 测试框架、测试基线、可测的接缝 |
| 部署 | — | 收尾只到 merge / PR | CI/CD、灰度、回滚闸门 |
| 防漂移 | verify 只查 spec 和代码一致 | 审查关卡 | 归档时人工确认（没人强制） |

## 放在一起看

Superpowers 管"怎么做"，OpenSpec 管"做什么"。没有 OpenSpec，Agent 按 Superpowers 的流程完成 brainstorming 和 planning 后，计划仍然基于对话历史中的零散描述，而不是结构化、可审计的 spec。反过来，OpenSpec 可以提供完整的 spec 文档，但如果缺少 Superpowers 提供的流程约束，Agent 仍可能偏离约定、跳过测试或扩大修改范围，最终使代码与 spec 不一致。

上面那五步流水线，每一步都是这两件事在配合：契约先钉"写的是什么"，SDD 和 TDD 守"怎么写"，verify 和门禁做验证。

Superpowers 的完整流程由七步组成：**brainstorming**（先探索项目、编写设计文档，再开始编码）→ **worktree 隔离**（创建独立副本并运行基线测试）→ **写计划**（拆成原子任务，每项精确到文件并带验证标准）→ **子 Agent 驱动开发（SDD）**（每项任务由新的子 Agent 执行并经过两轮审查）→ **TDD**（先 RED 后 GREEN）→ **代码审查**（Critical / Important 问题阻塞进度）→ **收尾**（rebase、全量测试、merge、创建 PR、保留分支或删除 worktree）。对应到本文，第一步包含 brainstorming，第二至第五步分别覆盖 worktree、计划、SDD/TDD 和收尾。这些步骤共同构成一套连续流程。

两个项目虽然独立发展，但各自的生态也在印证它们的角色：Superpowers 目前支持 11 个平台（Claude Code、Cursor、Codex、Gemini CLI 等），跨平台靠三层架构——skills/（纯 Markdown 行为描述，不提具体工具 API）→ tool mapping（每个平台一个映射文件）→ bootstrap（启动时注入）。OpenSpec 支持 32 个 AI 编码工具的 slash commands。社区里也已经有人在串这两个项目——有个叫 **SpecPilot** 的扩展把 OpenSpec 和 Superpowers 接成了一条五阶段流水线，还有个叫 **spec-superflow** 的项目更进一步，在源层面融合成了一套 9-skill、8-state 引擎，加上了 intent-lock 和 SHA256 hash 校验，保证 spec 不会被改掉而不被发现。

Superpowers 的案例之一是 **chardet 7.0.0** 的完全重写：性能提升 41 倍，准确率达到 96.8%，同时有 94% 的 PR 未被接受。这个案例展示了其流程约束在实际开发中的执行强度。

没有流程的 spec 变成没人看的 Markdown，没有 spec 的流程基于猜测写代码。一个成熟的项目两个都需要。

简言之：**Superpowers 约束修改过程，OpenSpec 明确修改目标；测试环境和部署流程仍由项目自身的基础设施提供。**`,
  takeaway: 'Superpowers 从外部约束 Agent 的行为，OpenSpec 从内部约束 Agent 的目标。一个管流程一套管契约。在存量系统上，坐标到手之后，它们补的是"改这一次"的全过程：契约先行定范围，worktree 加基线防回归，SDD 加 TDD 拆着改，verify 加门禁做验证，最后交给人审、archive 留痕。但它们管的是过程，不是基建——测试要跑得起来、代码要发得上去，靠你自己的测试基线和 CI/CD。没有流程的 spec 变成没人看的 Markdown，没有 spec 的流程基于猜测写代码。',
}

export default project
