const project = {
  slug: 'symphony',
  date: '2026-07-27 20:42',
  name: 'Symphony',
  url: 'https://github.com/openai/symphony',
  description: 'OpenAI 的自主编码自动化参考实现。监控 Linear 面板，自动派发 AI 代理实现任务，要求提供工作量证明后才能合入代码。',
  tags: ['Agent'],
  stars: '26k+',
  author: 'OpenAI',
  detail:
`Agent 写代码已经不算新鲜了，但每次都要人盯着、手动给 prompt、手动提 PR，本质上还是把 Agent 当高级补全在用。

Symphony 想解决的问题就是这个——它不做代码补全，它做的是**无人值守的编码调度**。你只管往 Linear 里扔 Issue，Symphony 会自动 Claim、分配 Workspace、启动 Agent、等 Agent 写完代码跑完测试、最后提交 PR。整个过程不需要人盯着 Codex 的会话窗口。

## 参考实现为什么用 Elixir

官方参考实现用的 **Elixir**，这门语言跑在 Erlang 的 BEAM 虚拟机上。BEAM 的设计哲学是一个进程管一件事，进程之间靠消息通信，不共享内存。创建进程的开销极低（微秒级），所以你可以随手开几千个进程。

这对 Symphony 来说很合适——每个 Agent 会话就是一个进程，各自管各自的状态，一个挂了不影响其他的。如果用 Python 写这套东西，你得自己搓事件循环和状态机。

当然 SPEC.md 是语言无关的，README 也说了"让你喜欢的 coding agent 按规范用任何语言实现"，所以不用学 Elixir 也能看懂。

## 怎么工作的

一个 Issue 的生命周期是这样流转的：

\`\`\`
Todo -> In Progress -> Human Review -> Merging -> Done
                        |      ^
                        v      |
                      Rework --+
\`\`\`

Symphony 每 5 秒轮询一次 Linear，发现 Todo 状态的 Issue 就 Claim 过来，然后：

1. 创建一个隔离的 Workspace 目录
2. git clone 目标仓库进去
3. 启动 Codex 的 app-server 模式
4. 把 WORKFLOW.md 里的 prompt 注入给 Codex
5. Codex 自主完成：分析 → 编码 → 测试 → commit → push → PR
6. Symphony 检测到完成后清理 Workspace

每个步骤都有对应的状态管理——Agent 卡住了就重试（指数退避），重试超上限就升级成 Human Review，Issue 被移到 Cancelled 就停掉对应的 Agent。

## 仓库里有什么

\`\`\`
symphony/
├── SPEC.md                 # 语言无关的规范（81KB，真正的核心）
├── elixir/                 # Elixir/BEAM 参考实现
│   ├── WORKFLOW.md         # 驱动 Agent 行为的 prompt 模板
│   ├── lib/symphony_elixir/
│   │   ├── orchestrator.ex     # 轮询调度 + 状态管理
│   │   ├── workspace.ex        # Workspace 生命周期
│   │   ├── agent_runner.ex     # 管理 Codex 子进程
│   │   ├── workflow.ex         # 解析 WORKFLOW.md
│   │   ├── tracker.ex          # Linear 适配层
│   │   ├── prompt_builder.ex   # 把 Issue + 模板拼成 prompt
│   │   ├── status_dashboard.ex # Phoenix LiveView 仪表盘
│   │   ├── cli.ex              # 命令行入口
│   │   └── ...
│   ├── config/             # 运行时配置
│   ├── test/               # 测试
│   └── mix.exs
├── docs/                   # 文档
└── .github/                # CI + 演示视频封面
\`\`\`

### SPEC.md 里到底写了什么

81KB 的规范文件，分 8 章讲清楚了整个系统：

前两章讲为什么要有 Symphony（问题 + 目标范围），第三章画整体架构图和 8 个组件，第四章把 Issue、Workspace、Run Attempt 这些实体定义清楚，第五章是最长的——完整定义了 WORKFLOW.md 的格式和 schema。后面三章讲配置解析、派发重试策略、和日志监控。

Elixir 实现只是这套规范的一种具体化，顺着 SPEC.md 用任何语言都能重写。

## WORKFLOW.md：Agent 的行为契约

这是 Symphony 里最巧妙的设计。Agent 的行为规范不硬编码在代码里，而是作为一个 **WORKFLOW.md** 放在仓库根目录，跟着版本走。

文件分两部分：

**YAML frontmatter** 定义调度参数：

\`\`\`yaml
tracker:
  kind: linear
  project_slug: "my-project"
  active_states: [Todo, In Progress, Merging, Rework]
  terminal_states: [Done, Closed, Cancelled]
polling:
  interval_ms: 5000
workspace:
  root: ~/code/symphony-workspaces
hooks:
  after_create: |
    git clone --depth 1 https://github.com/me/my-repo.git .
codex:
  command: codex --sandbox danger-full-access app-server
  approval_policy: never
  thread_sandbox: danger-full-access
agent:
  max_concurrent_agents: 10
  max_turns: 20
\`\`\`

**Markdown 正文**是 Agent 的 prompt 模板，用 Liquid 风格的插值注入 Issue 数据：

\`\`\`
You are working on a Linear ticket \`{{ issue.identifier }}\`

Issue context:
Title: {{ issue.title }}
Description: {{ issue.description }}

## Status map
- \`Todo\` → move to In Progress
- \`In Progress\` → continue execution
- \`Human Review\` → wait for approval
- \`Merging\` → run land skill
- \`Rework\` → address feedback
\`\`\`

Symphony 启动时读取这个文件，\`workflow.ex\` 解析 YAML frontmatter 获取配置，\`prompt_builder.ex\` 将 Issue 的标题、描述和标签等信息填入模板,生成最终 prompt 后发送给 Codex。

改工作流就是改这个文件提 PR，跟改代码一个流程。这个思路跟 OKF 的 YAML frontmatter 异曲同工——都是把元数据和内容放在一起，人可读、Agent 也可读。

## 本地实际测试

本地搭了一套环境，Symphony 的终端面板长这样：

![Symphony TUI](/discover/symphony_tui.png)

不过这个 TUI 提供的信息有限：它只显示 Agent 当前轮次和 token 用量。Event 列主要是 \`item completed: reasoning\` 等概括状态，不显示当前步骤、正在读取的文件或具体代码改动。仪表盘同样只有整体状态，没有细粒度进度，因此不便于定位执行问题。

架构是这样的：

\`\`\`
Symphony (Elixir/BEAM)
  ├── 轮询 Linear API (每 5s)
  ├── Workspace → ~/code/symphony-workspaces/{ISSUE_ID}/
  ├── Codex app-server 进程
  └── Phoenix 仪表盘 (:4000)
        │
        ▼
mimo2codex 协议代理 (:8788)
  ├── 翻译 Responses API → Chat Completions
  └── 转发到 DeepSeek API
        │
        ▼
DeepSeek V4 Flash (deepseek-v4-flash)
\`\`\`

需要增加 mimo2codex,因为 Codex CLI 0.142.2 只支持 OpenAI 的 **Responses API**,而 DeepSeek 只提供 **Chat Completions API**,两者协议不兼容。mimo2codex 是本地协议转换器:它把 Codex 请求转换为 Chat Completions 的 messages 数组,再把 DeepSeek 响应转换回 Responses API 格式。

### 实现中遇到的问题

Symphony 本身可以正常启动,主要问题来自下游工具链的配置:

\`\`\`bash
# 1. bwrap 沙箱权限 —— Ubuntu 24.04 默认禁了用户命名空间
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0

# 2. Git 认证 —— Workspace 里 push 没凭证
gh auth login --with-token < ~/.github-token
gh auth setup-git

# 3. Sandbox 策略覆盖 —— 默认的 turn_sandbox_policy 把 .git 设成只读
# 在 WORKFLOW.md 里显式配置即可解决
\`\`\`

### 实测：两轮 Issue

测试共运行两个 Issue。

**Round 1 — SHA-5: 多语言实现 two-sum**

第一轮用于验证 Symphony 能否读取 Issue 并调度 Codex。在 Linear 创建 Issue 后,Symphony 读取了任务、创建 Workspace 并启动 Codex,说明调度链路可以运行。实际代码由人工提交,因为本轮只验证调度链路,不评估 Codex 的编码能力。

**Round 2 — SHA-6: 添加 GitHub Actions CI**

第二轮用于给仓库增加 CI。Issue 要求创建 GitHub Actions 工作流和 Makefile,使所有语言的测试可以通过一条命令运行。

本轮遇到一个沙箱权限问题:

第一次跑 Codex 把 CI 文件和 Makefile 都创建好了，但 git commit 时报错：
\`\`\`
fatal: Unable to create '.git/index.lock': Read-only file system
\`\`\`

原因是 Codex 的 app-server 模式把 .git 目录设为只读,而 Symphony 生成的默认 sandbox 策略没有覆盖这一限制。修改 WORKFLOW.md 中的 \`turn_sandbox_policy\` 后问题解决。

重启后第二次运行完成了 commit、push 和 PR 创建。但 WORKFLOW.md 要求 CI 通过后才能进入 Human Review,Codex 因而持续轮询 GitHub Actions 状态,该过程消耗约 500 万 token。

最终 PR：https://github.com/xilon-my/symphony-test/pull/1

![Linear Issue](/discover/linear.png)

两轮测试表明,Symphony 的调度流程能够运行,但实际接入时间主要花在沙箱权限、认证和协议兼容等工程配置上。上述 sandbox 权限问题需要第二轮运行才解决。

## Symphony 适合什么

最适合**高信任度、小粒度、无外部依赖的任务**：

- **适合**:批量修复相互独立的 Bug
- **适合**:文档生成或翻译
- **适合**:two-sum 这类单一功能实现
- **不适合**:跨多个模块且存在任务依赖的复杂功能,因为没有 DAG 编排和 Issue 依赖管理
- **不适合**:需求尚未明确的任务,因为没有意图提取层,需要人先拆解

Elixir 参考实现还包含一个 Phoenix LiveView 仪表盘,启动后访问 \`localhost:4000\` 可以查看每个 Issue 的实时状态。Multica 负责理解与规划,把需求拆成任务;Symphony 负责执行与编排,调度 Agent 逐项处理。两者覆盖自主开发流程中的不同阶段。`,
  takeaway: 'Symphony 是一个调度器,负责读取 Issue、创建 Workspace 并调用 Agent,自身不编写代码。实际接入中的主要工作来自下游工具链的兼容性,包括 Codex 协议、bwrap 沙箱和 git 认证。因此,在配置编排流程前需要先验证这些基础设施。',
}

export default project
