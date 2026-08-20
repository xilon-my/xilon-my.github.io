const project = {
  slug: 'multica',
  date: '2026-07-30 11:30',
  name: 'Multica',
  url: 'https://github.com/multica-ai/multica',
  description: '一个开源的多智能体管理平台。像分配给同事一样给 AI 编程代理分配 Issue，代理自主编写代码、报告阻塞、更新进度。',
  tags: ['agent'],
  stars: '42k+',
  author: 'multica-ai',
  detail:
`用 Symphony 的时候会想到一个问题：你有了能写代码的 Agent，但你总不能每次都手动分配任务、手动检查进度、手动跟踪谁在干什么。人多了需要 Jira，Agent 多了也需要一个 Jira。

Multica 就是干这个的。

它不是又一个能写代码的 Agent——它不写代码，它管理写代码的 Agent。你装一个后台 daemon，连上 Claude Code、Codex、Pi、Copilot 或者其他 15 种 Agent CLI，然后在网页上给它们分任务。就像在 GitHub Issues 里 @一个人一样 @Agent。

## 怎么工作的

装好 CLI 跑一遍 \`multica setup\`，启动 daemon，daemon 自动检测你机器上装了哪些 Agent CLI。然后在网页上创建 Agent 配置文件，选一个 runtime 和一个 provider，之后就能创建 Issue 分配给这个 Agent。

Agent 拿到 Issue 后的生命周期：接单 → 拉代码 → 分析 → 编码 → 测试 → 提交 PR。过程中通过 WebSocket 实时更新进度，会在 Issue 下面留言、报告阻塞、创建子任务。你在网页上看进度，跟看同事干活一样。

\`\`\`
你创建 Issue → 分配给 Agent → Agent 接单 → 执行 → 更新状态
                      ↓
              你在网页上跟踪进度
\`\`\`

## Squads

多 Agent 怎么协作是个没标准答案的问题。Multica 的答案是 **Squad（小队）**——把多个 Agent 和人类组队，指定一个 leader，任务分配给小队而不是个人。

比如你有前端 Agent、后端 Agent、设计 Agent，组一个 Squad，assign Issue 给 \`@FrontendTeam\`。leader Agent 决定谁来接，团队扩张时路由规则不用改。Leader 会收到一份简报，包含成员列表（谁是谁、各自有什么技能），然后评估执行结果，决定是否继续、跳过、或者标记失败。

## 跟 Symphony 的对比

Symphony 那篇文章里提到 Multica 做"理解与规划"，Symphony 做"执行与编排"。

Symphony 盯 Linear 面板，自动派 Codex 去干活。它假设你已经有了一套项目管理流程，只负责"把 Issue 变成代码"这一段。Multica 覆盖的范围更广——它自己就是项目管理平台，不挑 Agent 类型，Claude Code、Codex、Pi 都支持。

但这两个项目放在一起看，引出了一个更深的问题：**一定要提前定义 Agent 角色吗？**

Squad 的模型是"先定义谁负责什么，再分配任务"——前端 Agent、后端 Agent、设计 Agent，每个有固定的 system prompt。好处是清晰，坏处是僵化。

另一种思路是：只有一个 runtime，不预设角色。主 Agent 接到任务后自己判断怎么拆，需要的时候动态召子 Agent，传当前阶段需要的上下文，用完就丢。子 Agent 是函数式的——调一个子 Agent 就像调一个函数，输入参数，拿回结果。

有点类似 Symphony 的思路吗——背后一个 runtime，WORKFLOW.md 定义行为，Agent 按状态流转。只不过 WORKFLOW.md 不只是写一段 prompt，而是能定义"什么情况下召子 Agent"、"上下文怎么传"、"状态怎么流转"——声明式的规则，Agent 自己读自己执行。

两种模型没有绝对对错。Squad 适合分工明确的场景，单 runtime + 增强版 WORKFLOW.md 适合任务边界模糊、需要灵活应变的场景。

## 其他值得一提的

**Autopilot** —— 定时任务。支持 cron、webhook、手动三种触发方式，可以让 Agent 每天自动出站会总结、CI 失败时自动创建 Issue。

**Skills** —— 可复用的能力包。每个 Agent 完成任务的方案可以沉淀为 Skill，通过 \`skills-lock.json\` 锁定版本，团队共享。

这些功能其实都在回答同一个问题：Agent 怎么不只是"单个工具"，而是变成团队里可持续协作的成员。

## 架构

后端 Go（Chi router + sqlc + PostgreSQL），前端 Next.js 16，daemon 跑在本地机器上。后端管理任务队列和状态，daemon 负责调用 Agent CLI。

分离的好处：你在网页上创建 Issue 时 daemon 可以离线，它重新上线后会拉取所有待处理的任务。

## 适合什么

它解决的不是"Agent 写不出代码"的问题——那是 Claude Code 和 Codex 的事。它解决的是"Agent 多了怎么管"的问题。

- ✅ 团队里同时跑多个 Agent
- ✅ Agent 分布在不同的机器上
- ✅ 需要定时任务和自动化
- ✅ 想把 Agent 产出沉淀下来复用
- ❌ 你只有一个 Agent 在本地跑跑`,
  takeaway: 'Multica 给"Agent 多了怎么管"提供了一个 Squad 方案。跟它价值相当的其实是它引发的问题——"一定要提前定义 Agent 角色吗？"——这个问题指向了 Symphony 路线上的 WORKFLOW.md 增强方向。两个项目放在一起看，比单独看任何一个都更能说明问题。',
}

export default project
