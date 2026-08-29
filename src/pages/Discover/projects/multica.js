const project = {
  slug: 'multica',
  date: '2026-07-30 11:30',
  name: 'Multica',
  url: 'https://github.com/multica-ai/multica',
  description: '一个开源的多智能体管理平台,用于向 AI 编程代理分配 Issue,并记录代理的代码修改、阻塞状态和执行进度。',
  tags: ['Agent'],
  stars: '42k+',
  author: 'multica-ai',
  detail:
`当多个编码 Agent 并行运行时,还需要统一分配任务、检查进度和记录执行状态。Multica 为这类场景提供项目管理界面。

Multica 本身不编写代码,而是管理执行代码任务的 Agent。后台 daemon 可以连接 Claude Code、Codex、Pi、Copilot 和其他 15 种 Agent CLI,使用者通过网页分配任务。

## 怎么工作的

安装 CLI 并运行 \`multica setup\` 后,daemon 会检测本机安装的 Agent CLI。随后在网页中创建 Agent 配置,选择 runtime 和 provider,即可创建 Issue 并分配给对应 Agent。

Agent 接收 Issue 后依次拉取代码、分析、编码、测试并提交 PR。执行进度通过 WebSocket 更新,Agent 也可以在 Issue 中记录信息、报告阻塞和创建子任务。网页集中展示这些状态。

\`\`\`
创建 Issue → 分配给 Agent → Agent 接收 → 执行 → 更新状态
                      ↓
              网页展示执行进度
\`\`\`

## Squads

多 Agent 协作没有统一实现。Multica 使用 **Squad(小队)** 组织多个 Agent 和人,并指定一个 leader,任务分配给小队而不是单个成员。

例如,前端 Agent、后端 Agent 和设计 Agent 可以组成一个 Squad,Issue 分配给 \`@FrontendTeam\`。leader Agent 根据成员列表和技能决定执行者,成员数量变化时无需修改外部路由规则。Leader 还会评估执行结果,决定继续、跳过或标记失败。

## 跟 Symphony 的对比

Symphony 那篇文章里提到 Multica 做"理解与规划"，Symphony 做"执行与编排"。

Symphony 读取 Linear 面板并调度 Codex,假设项目已经有既定管理流程,主要负责从 Issue 到代码修改的执行阶段。Multica 自身提供项目管理能力,并支持 Claude Code、Codex 和 Pi 等多种 Agent。

两种实现之间的主要差异是:**是否提前定义 Agent 角色。**

Squad 先定义前端、后端和设计等职责,每个 Agent 使用固定 system prompt。优点是分工明确,限制是角色难以随任务动态变化。

另一种方法只提供一个 runtime,不预设角色。主 Agent 接收任务后进行拆分,按需创建子 Agent 并传递当前阶段的上下文,任务结束后释放。子 Agent 可以被视为有明确输入和输出的临时执行单元。

这与 Symphony 的单 runtime 设计相近:WORKFLOW.md 定义行为,Agent 按状态流转。WORKFLOW.md 可以进一步声明何时创建子 Agent、如何传递上下文以及状态如何变化,再由 Agent 执行这些规则。

两种模型没有绝对对错。Squad 适合分工明确的场景，单 runtime + 增强版 WORKFLOW.md 适合任务边界模糊、需要灵活应变的场景。

## 其他值得一提的

**Autopilot** —— 定时任务。支持 cron、webhook、手动三种触发方式，可以让 Agent 每天自动出站会总结、CI 失败时自动创建 Issue。

**Skills** —— 可复用的能力包。每个 Agent 完成任务的方案可以沉淀为 Skill，通过 \`skills-lock.json\` 锁定版本，团队共享。

这些功能用于让 Agent 在持续协作中保留任务、状态和可复用能力,而不只是执行一次调用。

## 架构

后端 Go（Chi router + sqlc + PostgreSQL），前端 Next.js 16，daemon 跑在本地机器上。后端管理任务队列和状态，daemon 负责调用 Agent CLI。

前后端分离后,创建 Issue 时 daemon 可以离线;重新上线后,daemon 会拉取所有待处理任务。

## 适合什么

Multica 不负责提高单个 Agent 的编码能力,而是管理多个 Agent 的任务分配与执行状态。

- **适合**:团队同时运行多个 Agent
- **适合**:Agent 分布在不同机器上
- **适合**:需要定时任务和自动化
- **适合**:需要保存并复用 Agent 的执行方案
- **不适合**:只在本地运行单个 Agent`,
  takeaway: 'Multica 使用 Squad 管理多个 Agent,先定义成员职责,再由 leader 分配任务。另一种方式是不预设角色,由单一 runtime 按需创建临时子 Agent。Multica 适合固定分工和集中管理,Symphony 的 WORKFLOW.md 路线更接近按状态动态编排。',
}

export default project
