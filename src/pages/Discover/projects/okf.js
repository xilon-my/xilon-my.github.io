const project = {
  slug: 'okf',
  date: '2026-07-27 16:24',
  name: 'Open Knowledge Format (OKF)',
  url: 'https://github.com/GoogleCloudPlatform/knowledge-catalog',
  description: '开放知识格式，用 Markdown 文件加 YAML 前置元数据来表示知识。设计为人可读、AI 代理也可消费。',
  tags: ['RAG'],
  stars: '7.8k+',
  author: 'Google Cloud',
  takeaway: 'OKF 本质上不是什么新技术，就是个文件组织规范。它的核心观点是：软件工程里管代码的那套（Markdown + Git + PR）直接拿来管知识就够了，不需要给 AI 搞特权格式。如果你发现你的 Agent 每次都要重新搞清楚同一个东西，可能就是缺了一个 kb/ 目录。',
  detail:
`现在 Agent 越来越多了，但每个 Agent 的知识都锁在不同的系统里 —— 数据血缘在 Dataplex，指标定义在 Wiki，SQL 在代码库。各有各的 API，谁也读不懂谁。

OKF 的解法很粗暴：就用 Markdown。

一个知识包就是一个目录，里面一堆 .md 文件，每个文件头顶 YAML 写元数据，正文写内容。人用 cat 能看，Agent 也能直接丢进 context。放 Git 里，改就是 PR，历史就是 git log。

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

格式只强制一个字段：type。别的全是可选的。没有中央注册表，不需要 SDK。

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

viz.html 是把整个知识包渲染成交互式图谱的工具。用 Cytoscape.js 画的力导向图 —— 每个概念是一个节点，Markdown 里的链接关系是边。点一个节点能看到它的 frontmatter 和正文，还能搜索和筛选类型。不需要后端，一个 HTML 就能跑。

这个 viz 是通过 \`reference_agent visualize --bundle ./bundles/acme_retail\` 生成的，本身也是一个 OKF consumer 的参考实现。

除了 bundles，仓库里还带了两套参考实现：
\`\`\`
okf/src/reference_agent/    # Python: Producer agent + 可视化
toolbox/mdcode/             # TypeScript: 数据目录双向同步
\`\`\`
reference_agent 分两阶段跑：先读 BigQuery 元数据为每张表写概念文件，再给 Agent 一组 seed URL 去爬官方文档补充细节。mdcode 则反过来，把你的知识包和数据目录保持双向同步。

v0.2 还加了一套可信度机制 —— 每条知识可以记录谁写的（人还是 Agent）、谁核验过、什么时候过期、来源是啥、来源活不活跃。

\`\`\`yaml
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-09-23
sources:
  - id: rev-policy
    resource: https://wiki.acme/finance/revenue-recognition
    usage_count: 5000
\`\`\`

还有一个 Attested Computation 类型 —— 不只说"收入是多少"，而是把"收入应该怎么算"写成 SQL 定死，Agent 只能填参数不能改逻辑。跑完有 attester 来验。财务合规场景很实用。

实践中怎么用？建一个 \`kb/\` 目录开始写 .md。需要批量生成的话跑 \`reference_agent enrich\` 或者用 toolbox/mdcode。Agent 不需要人喂上下文了，直接指向文件就能读。`,
}

export default project
