const project = {
  slug: 'okf',
  date: '2026-07-27 16:24',
  name: 'Open Knowledge Format (OKF)',
  url: 'https://github.com/GoogleCloudPlatform/knowledge-catalog',
  description: '开放知识格式，用 Markdown 文件加 YAML 前置元数据来表示知识。设计为人可读、AI 代理也可消费。',
  tags: ['RAG'],
  stars: '7.8k+',
  author: 'Google Cloud',
  takeaway: 'OKF 是一种文件组织规范,使用 Markdown、Git 和 PR 管理知识,不引入 AI 专用格式。知识包通过 kb/ 目录集中保存结构化文档,使 Agent 可以复用已经确认的领域信息,而不必在每次任务中重新推断。',
  detail:
`Agent 所需的知识常分散在不同系统中:数据血缘位于 Dataplex,指标定义位于 Wiki,SQL 位于代码库。各系统使用不同 API 和数据格式,难以统一读取。

OKF 选择使用 Markdown 作为统一表示格式。

一个知识包对应一个目录,其中每个 .md 文件使用 YAML frontmatter 记录元数据,正文记录内容。人可以直接阅读,Agent 也可以将其加入上下文。文件由 Git 管理,修改通过 PR 审查,历史通过 git log 查询。

具体到每个文件长这样：

\`\`\`markdown
---
type: BigQuery Table
title: Customer Orders
description: 一行一个已完成的客户订单，全渠道。
tags: [sales, orders]
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T14:30:00Z }
---

# Schema

| Column | Type | Description |
|--------|------|-------------|
| order_id | STRING | 全局唯一订单ID |
| customer_id | STRING | 外键，关联 customers 表 |
| total_usd | NUMERIC | 订单总额（美元） |

关联 [customers](/tables/customers.md) 表。
\`\`\`

格式只要求 type 字段,其他字段均为可选项。它不依赖中央注册表或专用 SDK。

代码仓里 okf/bundles/ 下面放了几个示例包：

\`\`\`
okf/bundles/
├── acme_retail/                # 虚构的零售公司，最完整
├── ga4/                        # Google Analytics 4 电商数据集
├── stackoverflow/              # Stack Overflow 公开数据集
└── crypto_bitcoin/             # Bitcoin 区块链数据
\`\`\`

以 acme_retail 为例：

\`\`\`
bundles/acme_retail/
├── index.md                    # 目录清单，列出有什么
├── log.md                      # 变更日志，记录谁什么时候改了啥
├── tables/
│   ├── index.md
│   └── orders.md               # 数据表定义
├── metrics/
│   ├── index.md
│   ├── revenue.md              # 指标定义
│   └── gross-margin.md
├── computations/
│   ├── index.md
│   ├── gross-margin-period.md  # 可验证的计算（SQL 定死了怎么算）
│   └── revenue-ytd.md
├── policies/
│   ├── index.md
│   └── revenue-recognition.md  # 政策文档
├── attesters/
│   ├── index.md
│   └── sql_equality.py         # 验证脚本，用来验 Agent 跑的结果对不对
└── viz.html                    # 可视化页面
\`\`\`

viz.html 将知识包渲染为交互式图谱。它使用 Cytoscape.js 绘制力导向图,每个概念是一个节点,Markdown 链接表示边。选择节点后可以查看 frontmatter 和正文,也可以搜索并按类型筛选。该页面不需要后端服务。

这个 viz 是通过 \`reference_agent visualize --bundle ./bundles/acme_retail\` 生成的，本身也是一个 OKF consumer 的参考实现。

除了 bundles，仓库里还带了两套参考实现：
\`\`\`
okf/src/reference_agent/    # Python: Producer agent + 可视化
toolbox/mdcode/             # TypeScript: 数据目录双向同步
\`\`\`
reference_agent 分两阶段运行:先读取 BigQuery 元数据,为每张表生成概念文件;再根据一组 seed URL 读取官方文档并补充细节。mdcode 则在知识包和数据目录之间进行双向同步。

v0.2 增加可信度元数据,用于记录内容由人还是 Agent 生成、由谁核验、何时过期、来源地址以及来源的使用情况。

\`\`\`yaml
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-09-23
sources:
  - id: rev-policy
    resource: https://wiki.acme/finance/revenue-recognition
    usage_count: 5000
\`\`\`

Attested Computation 类型不仅记录收入结果,还用 SQL 固定计算逻辑。Agent 只能填写参数,不能修改查询结构,运行结果再由 attester 验证。这适合需要固定计算口径的财务与合规场景。

实际使用时,先建立 \`kb/\` 目录并编写 .md 文件。批量生成可以运行 \`reference_agent enrich\` 或使用 toolbox/mdcode。Agent 可以按任务读取对应文件,无需人工重复提供相同上下文。`,
}

export default project
