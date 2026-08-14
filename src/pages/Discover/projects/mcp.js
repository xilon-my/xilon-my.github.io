const project = {
  slug: 'mcp',
  date: '2026-07-39 10:59',
  name: 'Model Context Protocol (MCP)',
  url: 'https://claude.com/blog/bringing-mcp-2026-07-28-to-claude',
  description: 'AI Agent 与外部工具之间的开放标准协议。由 Anthropic 创建，现由 Linux 基金会旗下的 AAIF 管理，让模型以统一的方式调用工具、读取数据、执行操作。',
  tags: ['agent'],
  author: 'Anthropic / AAIF',
  detail:
`在 MCP 出现之前，给 AI 模型接工具是一个工具一套写法。你要让 Claude 能查数据库，写一个 database tool；让 ChatGPT 也能查同一个数据库，再写一个。每个模型都有自己的 tool calling 格式——OpenAI 的是 function calling，Anthropic 的是 tool use，参数怎么传、错误怎么返回，全不一样。N 个模型 × M 个工具 = N×M 个适配器。

MCP 的思路是把这层标准化：每个工具写一个 MCP server，所有兼容 MCP 的客户端（Claude、ChatGPT、Cursor、VS Code 等等）都能用它。这就是一个标准插座，谁都能插。不用为每个模型重复造工具。

但光说"标准插座"还不够，得看它具体是怎么接的。

## 一个请求的完整流程

假设你装了天气查询的 MCP server，然后问 Claude "东京今天多少度"。背后发生的事情是：

\`\`\`
你 → Claude Desktop (Host)
         ↓ 发现你有天气 MCP server
         ├─ MCP Client(weather) → JSON-RPC over HTTP → MCP Server(weather)
         │                              ↓
         │                     Server 返回 tools/list
         │                              ↓
         ├─ Claude 看到有 get_forecast 这个 tool
         │    ↓ 决定调用
         ├─ MCP Client(weather) → tools/call {name:"get_forecast", args:{city:"东京"}}
         │                              ↓
         │                     Server 查天气API，返回结果
         │                              ↓
         └─ Claude 收到结果，组织成自然语言回复你
\`\`\`

这就是 MCP 的核心模型。三个角色：

- **Host** —— 你直接用的 AI 应用（Claude Desktop、Cursor、VS Code）。它负责管理哪些 MCP server 是打开的、每个连接权限如何。
- **Client** —— Host 内部跟每个 Server 一一对应的协议客户端。Host 启动时会为每个配置好的 MCP server 创建一个 Client。Client 负责把 Host 的请求翻译成 JSON-RPC 2.0 发给 Server。
- **Server** —— 一个轻量程序，暴露该工具的能力。Server 不需要知道对面是什么模型，它只做一件事：收到请求，干活，返回结果。

一个 Host 可以同时连接多个 Server（比如一个连文件系统、一个连数据库、一个连 Slack），每个 Server 被一个独立的 Client 管理。

## Server 暴露什么

每个 MCP server 可以暴露三类主要能力：

| 能力 | 就像 | 干什么用 |
|------|------|---------|
| **Tools** | 函数/API | Agent 主动调用，执行操作（发邮件、查天气、创建 Jira） |
| **Resources** | 文件/数据 | Agent 读取上下文（读文件、查文档、查数据库记录） |
| **Prompts** | 模板 | 预置的 prompt 模板，Server 告诉 Agent 怎么跟自己打交道 |

最常用的是 Tools。Client 在这里扮演翻译的角色——它把模型的 tool calling 转成 JSON-RPC 发给 Server，再把 Server 的响应转回模型能理解的格式。

具体到请求上，第一步是发现 Server 有什么工具。Client 发 \`tools/list\`：

\`\`\`json
{"jsonrpc": "2.0", "id": "1", "method": "tools/list", "params": {}}
\`\`\`

Server 返回可用的工具列表，每个带名字、描述和参数 schema：

\`\`\`json
{"jsonrpc": "2.0", "id": "1", "result": {
  "tools": [{
    "name": "get_forecast",
    "description": "获取指定城市的天气预报",
    "inputSchema": {
      "type": "object",
      "properties": {
        "city": {"type": "string"},
        "days": {"type": "number"}
      },
      "required": ["city"]
    }
  }]
}}
\`\`\`

Client 把这个列表告诉模型。模型决定调用 \`get_forecast\`，Client 就发 \`tools/call\`：

\`\`\`json
{"jsonrpc": "2.0", "id": "2", "method": "tools/call", "params": {
  "name": "get_forecast",
  "arguments": {"city": "东京", "days": 3}
}}
\`\`\`

Server 收到后调天气预报 API，返回结果：

\`\`\`json
{"jsonrpc": "2.0", "id": "2", "result": {
  "content": [{"type": "text", "text": "东京未来3天：25-28°C，多云转晴"}]
}}
\`\`\`

Client 把这段文本送回模型，模型据此生成自然语言回复。整个过程就是这三步：**发现 → 调用 → 返回**。

传输层有两种。本地工具走 **stdio**——把 Server 当子进程启动，通信走标准输入输出，零网络开销。远程工具走 **Streamable HTTP**，生产环境要求 HTTPS。

## 为什么需要这套东西

在 MCP 出现之前，给 AI 接工具的工作流是：你在 prompt 里描述工具 → 模型输出特定格式 → 你解析 → 你调 API → 你把结果塞回去。每家做的格式不一样，换个模型整套重来。

MCP 把"模型怎么声明工具有哪些"、"怎么调用"、"错误怎么返回"这些全部标准化了。换句话说，它把 AI tool calling 从"各家自己定"变成了"行业标准协议"。

## 发展简史

MCP 最早是 Anthropic 在 2024 年 11 月开源的。初期只有简单的工具调用和文件读取，走 SSE 长连接。

几个关键转折点：

**2025 年 4 月** — OpenAI 和 Google 都宣布在自己的产品里接入 MCP。这标志着 MCP 从 Anthropic 一家的事情变成了行业标准。

**2025 年 12 月** — Anthropic 把 MCP 捐给了 Linux 基金会旗下的 **Agentic AI Foundation（AAIF）**。AWS、Google、Microsoft、OpenAI 都是 AAIF 会员。从此没有任何一家公司能控制 MCP 的方向。

**2026 年 7 月 28 日** — MCP 最大的更新发布。

## 2026-07-28：无状态化

这次更新是 MCP 有史以来最大的一次改动。核心是去掉 session——但为什么要去掉？

### 之前的模型有什么问题

在旧版 MCP 里，客户端和服务端要先走一个 initialize 握手建立 session，之后所有请求都绑定在 session 上。服务端需要记住每个连接的 state，路由需要有 sticky session，Server 没法部署在无状态环境上。

这对运行在服务器上的单体应用来说没问题，但 Agent 工具不只跑在服务器上。你想让 MCP server 跑在 AWS Lambda 或 Cloudflare Workers 上——它们按请求计费、不维护持久连接——就不行。而且 session 本身成了藏状态的地方，开发者经常把不该放传输层的东西塞进去，出了问题还不好查。

### 改成什么样

新规范完全去掉了 session。每个 HTTP 请求自己带齐所有信息：

\`\`\`
POST /mcp HTTP/1.1
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: search
\`\`\`

请求的 \`_meta\` 字段里包含了协议版本、客户端信息和能力声明。Server 不需要记住你是谁，每个请求都是全新的、独立的。

### 状态去哪了

Session 没了，但状态还在。只是从隐含的传输层变成了显式的 tool 参数。以前购物车的状态存在 session 里 Server 自动记住，现在模型每次调用 tool 时用参数把上下文传回来。更麻烦但更透明——设计者的原话是 "visible arguments beat hidden session bags"。

### Multi-Round-Trip Requests

另一个重要改动是 MRTR。以前 Server 要跟用户确认时（比如"你确定要删这个文件吗？"），靠保持 SSE 长连接发消息。这不适用于无状态架构。

新的方案：Server 收到请求后返回 \`input_required\` + 一个 opaque 的 \`requestState\`，Client 展示确认 UI 后把用户确认结果带上 \`requestState\` 重新请求。不需要长连接，但能达到同样的交互效果。

### 两个新扩展

核心协议保持精简，新增能力通过扩展规范添加：

- **MCP Apps** —— Server 可以返回交互式 UI（sandboxed iframe 渲染在对话里），不只是文本。天气预报可以返回一张天气图而不是文字描述。
- **Tasks** —— 异步长时间任务。Server 返回一个 task ID，Client 轮询 \`tasks/get\` 获取结果。对应队列 worker 和定时任务这类场景。

### 认证升级

之前 MCP 的认证方案比较随意——很多实现就是"一个 header 里放长寿命共享密钥"。新规范对齐了企业标准：OAuth 2.0 / OpenID Connect，支持 Entra、Okta 等身份提供商。Dynamic Client Registration 被废弃，替代方案是 CIMD。

### 废弃（12 个月迁移期）

Roots、Sampling、Logging、旧版 HTTP+SSE 传输全部进入 12 个月废弃窗口。这意味着老版本 Server 还能用一年，但新开发应该直接基于新规范。

## 生态

到 2026 年中，MCP 的 SDK 月下载量已经超过 4 亿次，Claude 的连接器目录收录了 950+ Server。SDK 覆盖 TypeScript、Python、Go、C#、Rust、Java。

Pi 拒绝 MCP 的理由是"Build CLI tools with READMEs"——让 Agent 直接读 README 然后调用 CLI，不要中间层。这是个可选的立场，但从生态数据看，MCP 已经成为 Agent 工具连接的事实标准。`,
  takeaway: 'MCP 把 AI 工具调用从各家自定义格式变成了行业标准协议。Host/Client/Server 三层模型、JSON-RPC 2.0 通信、无状态设计——它在 Agent 基础设施层扮演的角色，某种程度上类似 HTTP 之于 Web：不是唯一的选择，但大多数人都在用。',
}

export default project
