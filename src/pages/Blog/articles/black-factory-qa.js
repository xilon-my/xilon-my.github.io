const article = {
  slug: 'black-factory-qa',
  date: '2026-08-14 20:00',
  name: '黑灯工厂式自动化开发：从需求到代码交付',
  description: '以两条 ERPNext 采购需求的真实运行为例，说明开发运行时如何解释需求、定位代码、固定行为契约，并通过状态机、隔离执行和质量门禁完成可追踪、可恢复的存量系统修改。',
  tags: ['Agent'],
  category: 'Project',
  author: 'shannon',
  takeaway: '自动化开发的关键不是让 Agent 从 Issue 直接生成代码，而是把需求解释、代码定位、行为规格、实施验证和人工审批连接成一条可恢复、可审查的证据链。',
  detail: `
“让 Agent 根据 Issue 写代码”并不难。真正困难的是：在一个大型存量系统中，怎样证明它理解了需求、找对了代码、没有越界修改，并且在测试或审查失败后能够从正确的位置继续。

我参与设计的“黑灯工厂式自动化开发”处理的正是这条完整链路。这里的“黑灯”是一个比喻：重复的整理、检索、执行和检查由运行时自动完成；需求确认、异常判断和代码交付仍由人负责。它不是取消人工检查，更不是让模型拿到一条 Issue 后直接修改主分支。

由于实习涉及的内部系统、代码仓和生产任务不能公开，本文用两条 ERPNext 公开 Issue 还原设计和实验过程。第一条 Issue 贯穿全文，展示一次需求如何走到本地交付；第二条 Issue 用来检验这套流程是否只对单一样例有效。ERPNext 只是公开案例，不代表内部系统的结构和规模。

## 1. 起点：一条看似简单的采购需求

ERPNext GitHub Issue [#53919](https://github.com/frappe/erpnext/issues/53919) 描述了一个常见的采购场景：供应商把物料直接送到项目现场，但采购订单的 Shipping Address 主要显示与 Company 关联的地址，项目现场地址和客户地址不能直接选择。

用户只能把项目地址也关联到 Company。这个临时办法虽然能让地址出现在选择框里，却产生了三个副作用：

1. 同一个地址可能被重复维护，地址归属变得不准确。
2. 新建采购订单时，系统可能自动填入不适用的 Company 默认地址。
3. 地址候选越来越多，采购人员更容易选错送货地点。

Issue 希望采购订单能够选择 Project Site 或 Customer Address，并在 Company 默认地址不适用时避免自动填充。

业务问题到这里已经说清楚了，但代码还不能开始写。至少还有几个问题没有答案：

- 地址候选是前端过滤的，还是后端接口返回的？
- Address 与 Company、Project、Customer 分别怎样关联？
- 用户能看见一个地址，是否也有权把它保存到采购订单？
- 同一个地址同时关联多个对象时怎样去重？
- 没有 Project 或 Customer 时应该返回什么？
- 原有 Company 地址和既有采购订单要保持哪些行为？

这些问题横跨需求、架构、权限和兼容性。模型能够编写 Python 或 JavaScript，只能说明它有局部编码能力；一次可靠的存量系统修改，还需要先把这些不确定性逐层收敛。

## 2. 先定义“完成”，再启动 Agent

正常的软件交付不是“Issue → 代码”，而是：

\`需求 → 需求确认 → 架构定位 → 行为规格 → 代码修改 → 验证与审查 → 交付与归档\`

对 #53919 来说，完成标准也不能只是“新增一个地址查询函数”。我们先把外部可观察的行为写成四条验收条件：

| 编号 | 可验收行为 |
| --- | --- |
| AC-1 | 采购订单仍可选择用户有权访问的 Company 地址 |
| AC-2 | 选择 Project 或 Customer 后，可以选择对应且有权访问的地址 |
| AC-3 | 缺少关联对象时返回空候选；重复关联只返回一个地址 |
| AC-4 | 不适用 Company 默认地址时不自动填充；非法地址仍不能保存 |

验收条件只描述行为，不预设函数名和文件名。这样需求理解可以在编码前单独评审，实现方案即使发生变化，也必须对同一组行为负责。

运行时围绕这些验收条件形成了一条产物链：

\`RR → IR → DecisionRecord → ArchitectureBinding → US → OpenSpec → FactoryWorkItem → ValidationRun → AssessmentReport\`

| 产物 | 它回答的问题 |
| --- | --- |
| RR，Requirement Request | 用户原本提出了什么 |
| IR，Interpreted Requirement | 平台怎样理解需求，还有哪些问题未确认 |
| DecisionRecord | 人对产品歧义作了什么决定 |
| ArchitectureBinding | 业务概念对应哪些应用对象、源码和证据 |
| US，User Story | 需求可以拆成哪些可独立验收的工作 |
| OpenSpec change | 本次修改承诺改变什么、保持什么 |
| FactoryWorkItem | 在哪个 commit、哪些允许路径内执行哪些任务 |
| ValidationRun | 实际运行了哪些检查，结果如何 |
| AssessmentReport | 规格、代码和剩余风险是否可以交付 |

这些不是一组常驻 Agent 的名字，而是每个阶段写入持久化存储的数据。模型进程可以随时退出，下一阶段重新从这些产物中取得上下文。

## 3. 第一条真实运行：#53919 如何走到本地交付

2026 年 8 月 25 日，我用 #53919 完整执行了一次本地实验。运行编号是 \`run-ca1acbf0ae60\`，固定的 ERPNext base commit 是 \`8b8422662cddce98da2ea36a320eedf8fba0a490\`。它不是对 ERPNext 的正式贡献或生产发布，但保留了状态、产物、日志和 commit，可以复盘每一次推进与返工。

### 3.1 需求澄清：模型整理问题，人决定产品行为

RR 原样保存 Issue 的 URL、标题、正文、抓取时间和完整 JSON。接着，运行时把标题和正文交给 DeepSeek，并用固定 JSON Schema 要求它生成 IR：业务意图、涉及对象、已知条件、未知项和验收条件必须分别返回，不能混成一段自然语言总结。

第一次 IR 留下了 7 个 unknowns，因此 \`resolved_ir\` gate 不允许流程继续。这里的关键是：模型可以发现歧义，但不能替产品负责人决定歧义。

这时进入第一个人为审核的节点：IR Review。人需要确认模型是否准确理解了原始需求，并对会改变产品行为的未知项作出决定。审核结论和具体选择由指定 actor 写入 6 条 DecisionRecord，明确了这次修改的边界：

- 地址来源取 Company、Project、Customer 的并集，并对重复地址去重。
- 没有 Project 或 Customer 上下文时，保留 Company 地址作为 fallback。
- 只调整 Purchase Order，不改变 Sales Order。
- 本次不增加 feature flag。
- Company 默认地址只有在仍然适用时才保留。
- 非法关联地址仍必须被服务端拒绝。

只有 IR Review 通过且 DecisionRecord 完整，控制平面才会生成一份新的 resolved IR。旧 IR 不会被覆盖，因而仍能审计“最初有哪些问题”；新 IR 清空 unknowns，成为后续阶段的输入。

确认后的需求被拆成 5 个 User Story：查询 Project 地址、查询 Customer 地址、合并并去重候选、调整默认值和服务端校验、补充测试与说明。每条 story 都有 acceptance 和 depends_on，顶层还保留整组验收条件与依赖关系。US 是从已确认的 IR 和架构绑定中派生出的执行计划，默认只做 schema、依赖和验收条件的一致性校验；如果拆分过程中改变了需求范围或架构依赖，才另行触发 Scope Review。这样不会把同一份需求重复审核两次。

### 3.2 架构定位：从业务语言走到确定的源码

ERPNext 基于 Frappe Framework。Frappe 用 DocType 描述数据和表单，再由 Python 控制器、JavaScript 表单脚本、权限规则和通用服务共同实现业务行为。因此，一张采购订单并不对应一个文件：

\`\`\`text
erpnext/
  buying/doctype/purchase_order/
    purchase_order.json     # 字段与 DocType 元数据
    test_purchase_order.py  # 采购订单测试
  controllers/
    queries.py              # 权限感知的候选查询
  accounts/services/
    party_validation.py     # 地址与交易方校验
  public/js/controllers/
    buying.js               # 表单查询与默认值行为
\`\`\`

“项目现场地址”是业务语言，源码中对应的可能是字段、DocType、Dynamic Link、查询条件或保存校验。只做关键词搜索，很容易找到名称相近但职责不同的实现。

为此，平台使用 OKF 知识仓按 3A 组织定位信息：

| 层次 | 要回答的问题 | 本例中的内容 |
| --- | --- | --- |
| BA，业务架构 | 业务要完成什么 | 采购流程需要记录物料的实际送货地点 |
| AA，应用架构 | 哪些系统对象负责 | Purchase Order、Address 及其关联和校验 |
| TA，技术架构 | 代码和测试在哪里 | 查询、表单控制器、服务端校验和测试文件 |

DDD 用来区分业务边界：采购流程中的地址表示送货地点，公司主数据中的地址可能表示注册地址，名字相同并不等于规则相同。OKF 则把这些业务对象、应用对象和代码坐标保存成实体与关系。

本次实现没有使用向量检索。它先对 Issue 和实体的 name、description、terms 分词，按词项交集选出 seed，再沿双向 relation 做广度扩展。最终从 2 个 BA 实体出发，选出 3 个 AA 实体和 5 个 TA 实体。ArchitectureBinding 保存了实体、关系、证据路径、OKF snapshot 和 source commit，并对选中的源码计算 hash。

这个绑定同时承担两种职责：一是给模型提供“为什么这些文件相关”的架构上下文；二是从 repository=erpnext 的 TA 实体中推导 \`allowed_paths\`，成为执行阶段可机械比较的文件白名单。检索结果只是候选，最终仍要用调用关系、权限规则和测试确认。

这里也保留了一个真实的 provenance 缺口：ERPNext 文件通过 \`git show <fixed-commit>:<path>\` 读取并计算 hash，Frappe 文件当时却直接从相邻 working tree 读取。前者是 commit-pinned，后者只是 path+content-hash pinned，不能声称两个仓库已经做了同等强度的版本固定。

### 3.3 行为规格：把“想要什么”固定下来

US 说明工作单元，但“采购订单可以选择项目地址”仍不够精确：无地址、无权限、重复关联时分别怎样处理？哪些相邻行为不在本次范围内？这些需要写成增量行为契约。

平台使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 的 change 目录组织四类文件：

\`\`\`text
openspec/changes/run-ca1acbf0ae60-allow-project-shipping-address/
  proposal.md
  design.md
  tasks.md
  specs/purchase-order-shipping-address.md
\`\`\`

- \`proposal.md\` 解释为什么修改，以及明确排除哪些范围。
- \`spec\` 用 SHALL／WHEN／THEN 固定行为。
- \`design.md\` 说明查询、权限、默认值和服务端校验怎样配合。
- \`tasks.md\` 把实施工作按依赖顺序拆开。

例如，项目没有关联地址时，规格要求项目地址候选为空，同时保留原本合法的 Company 地址。这个行为不会因为后续查询函数换了一种实现方式而改变。

这次实验没有接入 OpenSpec 官方 CLI 的全部验证语义。控制平面只做了最小结构检查：proposal 和 design 必须以标题开始，spec 必须同时出现 SHALL、WHEN、THEN，tasks 必须包含未完成 checkbox。它能证明四类产物存在且格式基本可解析，不能证明每条 Requirement 都有测试，也不能证明 design 始终与最终实现一致。

结构检查通过后，5 个 US 被合并成一个 FactoryWorkItem。OpenSpec 中的 20 条 task 说明“要做什么”，ArchitectureBinding 推导出的 4 个允许路径说明“可以在哪里做”：

\`\`\`json
{
  "base_commit": "8b842266...",
  "allowed_paths": [
    "erpnext/controllers/queries.py",
    "erpnext/public/js/controllers/buying.js",
    "erpnext/accounts/services/party_validation.py",
    "erpnext/buying/doctype/purchase_order/test_purchase_order.py"
  ],
  "tasks": ["20 条 OpenSpec task"],
  "checks": ["format", "lint", "compile", "test", "coverage", "security"]
}
\`\`\`

### 3.4 实施准备：先证明环境是干净的

执行器在固定 base commit 上创建 detached worktree，并再次用 \`rev-parse HEAD\` 验证。不同 RR 使用包含 run id 的独立路径，不共享未提交修改。

本文所说的“使用 Superpowers”，不是安装了一个同名服务或调用了某个 API，而是把它强调的工程实践落实为可检查的动作：先澄清再开发，先写行为契约，使用独立 worktree，修改前跑基线，按小任务执行 TDD，再分别做规格审查和代码审查。方法论只有落到 artifact、命令、权限和 gate 上，才真正构成约束。

修改代码之前还必须建立 BaselineRun。原因很现实：最初可用的测试站点是半初始化状态，数据库中连 Frappe 核心表都不存在。如果直接在这里跑测试，任何失败都无法归因于本次代码。

运行因此创建了独立站点 \`factory-ca1acbf0.localhost\`，安装 Frappe 和 ERPNext，再在没有修改的 worktree 上运行 Purchase Order 测试模块：63 个测试全部通过。BaselineRun 保存 base commit、命令、站点、退出状态、耗时和日志路径。后续 gate 不仅要求 baseline 通过，还要求它绑定 FactoryWorkItem 的 base commit。

这一点把两个问题分开了：修改前已经失败，是环境或存量代码问题；修改后才失败，才可能是本次变更引入的问题。

### 3.5 TDD 与提交：模型可以编辑，控制平面决定事实

development 阶段重新启动一次无 session persistence 的 DeepSeek 进程。它一次性收到 OpenSpec、ArchitectureBinding、FactoryWorkItem、BaselineRun 和精确测试命令；上下文来自 artifact store，而不是前一段聊天记忆。

这次 TDD 留下了真实的 red/green 记录：先新增 12 个目标测试，并在没有实现的状态运行，结果为 \`Ran 12 tests\`、\`FAILED (errors=8)\`、exit=1；恢复实现后，同一组测试 exit=0，随后 Purchase Order 全模块 75 个测试通过。

模型返回的 \`tasks_completed\`、\`tdd_evidence\`、\`checks_run\` 和 \`risks\` 只是执行说明。真正决定结果的是 git diff 和外部测试。控制平面对实际 changed paths 与 allowed paths 做集合差，确认没有越界文件后，才由控制平面执行 git add 和 commit，并写入带有 result commit 的新 FactoryWorkItem。

运行中还修复了一个会破坏路径检查的小 bug：git wrapper 对整段 porcelain 输出调用 \`strip()\`，误删了第一行表示 unstaged change 的前导空格，随后又把文件名首字母删掉。合法的 \`erpnext/...\` 因而被解析成 \`rpnext/...\`。修复后只移除行尾换行，并补了“第一行是 unstaged 文件”的回归测试。

### 3.6 质量门禁：测试全绿之后，审查仍然可以打回

独立 ValidationRun 包含以下门禁，每一项都记录完整命令、状态、耗时和日志路径；\`all_passed\` 是所有结果的逻辑与，不存在“非阻断失败”：

| Check | 目的 |
| --- | --- |
| git diff --check | 拦截冲突标记和 whitespace error |
| ruff format --check | 检查变更 Python 文件格式 |
| changed-line ruff lint | 允许记录 base 旧问题，但禁止变更行引入新诊断 |
| python -m py_compile | 验证变更 Python 文件可编译 |
| node --check | 验证 buying.js 语法 |
| bench build --app erpnext | 验证前端 asset 可构建 |
| focused shipping tests | 验证地址候选、去重、默认值和非法保存 |
| drop-ship regression | 固定原有 drop-ship 行为 |
| Purchase Order module --coverage | 在真实数据库环境运行整个模块 |
| security diff scan | 检查新增动态执行、shell=True 和插值 SQL |

第一轮 ValidationRun 没有通过。Ruff 报出的两处问题来自 base 旧代码，不是本次新增；coverage 也因为 Bench 环境缺少 coverage 包而没有运行。流程进入 \`blocked_validation\`。控制平面补齐环境，并把 lint 改为只阻止新增或修改行上的新诊断，而不是让模型顺手改掉无关旧代码。

重跑后，所有门禁都通过了。但流程没有直接进入 PR Gate，因为“测试通过”和“实现正确”是两件不同的事。第一次 AssessmentReport 中，独立 code reviewer 找到了三个实质问题：

| 审查发现 | 实际影响 |
| --- | --- |
| 前端只查询 1 条 contextual address，再用它判断当前选择是否合法 | Project／Customer 有多个地址时，可能清掉用户已选的合法地址 |
| 只要存在 contextual address 就清理非 contextual 值 | 用户明确选择的合法 Company 地址也会被错误清掉 |
| Company、Project、Customer 分别分页后再合并 | 第一页可能超长，load-more 可能跳过或重复候选 |

Assessment 再次把任务送回 \`blocked_validation\`。repair 读取完整 findings，把后端查询改成：先合并并去重 Dynamic Link 对应的 Address name，再交给 Frappe permission-aware \`search_widget\` 统一过滤和分页。前端只跟踪并清理系统自动填入的 Company default，不再清理用户主动选择的地址；测试也补上了 Company+Project、Company+Customer 去重、统一分页和非 Purchase Order 校验范围。

修复产生了新 commit，旧 ValidationRun 因 commit 不匹配而自动失效，必须重新跑完整门禁。第二轮又因 Ruff format 单独失败。这次不需要模型推理，确定性 formatter 直接修复，并留下独立 Checkpoint 和 commit。第三轮 ValidationRun 才全部通过；最终 Purchase Order 模块在 coverage 模式下运行 82 个测试，结果为 OK。

最终 commit 链清楚记录了三类工作：开发 commit \`e4a96f1\`、行为修复 commit \`45b5828\`、格式修复 commit \`2b233c9\`。环境问题、代码问题和纯格式问题没有被混进同一个“再试一次”。

### 3.7 一次越界写入：worktree 不等于隔离

repair 期间还暴露了控制平面自身的缺陷。DeepSeek 为了让 Bench 加载 worktree 文件，使用 \`cp\` 覆盖了主 ERPNext checkout 中的 4 个文件。原有检查只验证 worktree 内的变更路径，所以 allowed paths 虽然通过，真正的隔离却已经被绕过。

运行被人工停止，主 checkout 按原 commit 恢复并确认 clean。之后代码阶段被放入 bubblewrap：根文件系统只读，只把当前 worktree 和指定测试目录重新绑定为可写；repair 阶段还移除了 Bash 和 Write，只保留读取、检索和受控编辑能力。

这次事故说明了一个重要边界：提示词要求“只在 worktree 工作”不是权限系统，事后检查 worktree 也不能阻止跨目录写入。能力白名单只有落实到操作系统级文件边界，才构成真正的隔离。

### 3.8 本地交付：不把实验写成生产发布

第二轮 spec review 和 code review 都通过后，运行进入第二个人工节点 PR Gate。批准记录绑定 OpenSpec、AssessmentReport、ValidationRun 和 FactoryWorkItem 的 content hash。

最终 ERPNext commit 为 \`2b233c976bf2ff793f73d20b0b92ce1857fd7b66\`。相对 base，它修改 4 个文件，新增 645 行、删除 32 行。deploy 阶段只在本地 ERPNext 仓库创建 \`factory/run-ca1acbf0ae60\` 分支并写入 DeploymentRecord，没有创建上游 GitHub PR，也没有声称发布到了生产。

最后，OpenSpec change 被归档，最终 commit 和 changed paths 写入 OKF KnowledgeUpdate，状态进入 \`done\`。这次运行从 11:15 UTC 到 15:12 UTC，墙钟时间约 3 小时 57 分钟，其中包括首次搭建测试站点、多轮全模块测试、两轮审查、代码和格式返工，以及隔离漏洞修复。它不能直接与普通开发工时比较，但比预设一个“60 分钟、零人工干预”的数字更接近真实成本。

## 4. 为什么失败后还能继续：状态机只根据证据推进

上面的故事不是一段持续四小时的模型对话。clarification、context、proposal、development、repair、spec review 和 code review 都会启动新的运行时进程。跨阶段传递的状态来自 SQLite 和文件系统中的产物，而不是模型记忆。

### 4.1 状态、产物和事件各自负责什么

本地 MVP 使用四张核心表：

| 表 | 保存内容 |
| --- | --- |
| runs | run_id、当前 state、version、target commit 和时间 |
| artifacts | kind、schema version、JSON payload、content hash、source commit |
| events | 产物写入和状态转换事件 |
| leases | owner 和过期时间 |

\`run.state\` 只表示当前调度位置，不承载业务结果。进入 assessment 不等于测试通过：测试结论在 ValidationRun，当前实现 commit 在 FactoryWorkItem，两者必须由 gate 比较。events 回答“流程怎样走到这里”，artifacts 回答“流程凭什么走到这里”。

产物写入前会按 kind 校验必填字段，再对 canonical JSON 计算 SHA-256。相同 run、kind 和 content hash 不会重复插入。读取“当前产物”时按 \`created_at\` 和 SQLite \`rowid\` 取最后一条，因为实验中确实出现过同一秒写入两份同类 artifact 的情况。

### 4.2 Workflow 怎样决定下一步

Workflow YAML 为每个状态声明可读取的 context、允许能力、输出、required artifacts、gate 和 next。状态机本身不知道采购订单的业务细节，它只做一次判断：当前证据是否足以离开当前状态。

主要 gate 如下：

| Gate | 判断条件 |
| --- | --- |
| resolved_ir | IR.unknowns 为空，并且存在 DecisionRecord |
| three_a_binding | BA、AA、TA 都非空，并且有 OKF snapshot |
| complete_openspec | proposal、spec、design、tasks 和 structure_check 完整 |
| strict_validation_match | baseline 绑定 base 且通过；全部 check 通过；ValidationRun.commit 等于 result commit |
| assessment_matches_validation | report.commit 等于 validation.commit，spec/code review 都通过 |
| successful_deployment | DeploymentRecord.status 为 succeeded |
| archive_and_writeback | Archive 和 KnowledgeUpdate 同时存在 |

一次自动推进可以简化为：

\`CLI 执行阶段工作 → 校验并写入 artifact → 检查 required artifacts → 执行 gate → 带版本号更新 state → 写入 transition event\`

transition 使用带 \`expected_state\` 和 \`expected_version\` 条件的更新，成功后 version 加一。受影响行数不是 1 就说明调用者拿到了过期状态。这个乐观版本检查在单测中验证过，但本次运行是单 worker 顺序执行，不能据此声称已经证明多 worker 并发可靠。

### 4.3 blocked 不是失败终点，而是带原因的路由

进入 blocked 前，状态机会先写 BlockedRecord，保存 category、reason、resume_state 和时间。环境问题、代码验证问题和需求问题可以因此回到不同位置。

代码 repair 是需要特别处理的情况：assessment 失败时，通用 resume 原本会回到 assessment；但一旦 repair 产生新 commit，旧 ValidationRun 已经失效，必须先回 development 重新验证。这个规则不是预先想象出来的，而是在真实运行中补上的。

#53919 的 version 0 → 16 记录如下：

| Version | 状态转换 | 触发原因 |
| --- | --- | --- |
| 0–4 | clarification → context_ready → us_review → proposal → development | 需求解决、架构绑定、人工批准和 OpenSpec 完整 |
| 5–6 | development → blocked_validation → development | lint／coverage 门禁失败并修复 |
| 7–9 | development → assessment → blocked_validation → development | 测试全绿，但 reviewer 发现行为缺陷并返工 |
| 10–11 | development → blocked_validation → development | Ruff format 失败并由 formatter 修复 |
| 12–13 | development → assessment → pr_gate | 最终门禁和两类审查通过 |
| 14–16 | pr_gate → deploy → archive → done | 人工批准、本地交付、归档和知识更新完成 |

这条时间线解释了为什么“Agent 说完成”“测试跑过”和“可以交付”是三个不同结论。

### 4.4 RuntimeTrace、Checkpoint 和日志如何配合

每次成功的模型调用都会留下 RuntimeTrace，记录 stage、runtime、起止时间、耗时、turns、原始输出路径和 hash。Checkpoint 的粒度更小，用来记录 worktree 创建、任务完成、repair 和 formatter 等执行节点。Validation 日志则按 check 单独保存。

三类证据分别回答：模型当时收到什么并返回什么，原子任务执行到哪里，外部命令的 stdout/stderr 究竟是什么。

越界事故中，被中断的 repair 没有成功返回 envelope，因此没有完整 RuntimeTrace；证据只能来自终端进程、两个 checkout 的 diff 和恢复操作。这又暴露了一个缺口：适配器应该在调用开始时就写 invocation record，并持续记录退出原因，而不是只在成功返回后写 trace。

### 4.5 模型运行时受到什么约束

本项目没有直接调用 DeepSeek HTTP API，而是通过本机 \`claude-paratera\` CLI 发起一次性 prompt。每个阶段都关闭 session persistence，要求返回符合该阶段 JSON Schema 的 structured output。适配器还会检查进程退出码、错误标志和输出类型；一段看似合理但无法解析的 Markdown，不会被当成成功 artifact。

代码阶段有两层边界：工具列表限制模型可以请求哪些能力，bubblewrap 决定进程最终能写到哪里。两者不能互相替代。当前隔离仍未禁网，也没有 CPU、内存、进程数和分阶段凭据配额；\`/tmp\` 仍可写。只有指定 cwd 的代码阶段进入 bubblewrap，纯结构化阶段主要依赖空工具列表。

Workflow 也还不是完全通用的解释器。gate 和 next 已由 YAML 驱动，但具体阶段读取哪些 artifact、怎样拼装 prompt、给模型哪些工具，仍有一部分写在 Python stage 函数中。后续需要由统一 dispatcher 根据 Workflow 声明组装上下文和能力，避免声明与实现逐渐漂移。

## 5. 第二条运行：验证流程不是为一个样例硬编码

只跑通 #53919，还不能说明这是一条通用链路。于是我又选择了 ERPNext Issue [#46721](https://github.com/frappe/erpnext/issues/46721)：FrappeCloud 自动升级后，dropshipping 保存 Purchase Order 时出现 \`Contact Person does not belong to the TEST LLC\`。

第二条运行编号为 \`run-ab75f57347e7\`，固定目标 commit 为 \`9a05cb71fa60105642cffded4be6418adc7864c6\`。它沿用了同一条产物链，但很快暴露出第一处硬编码：\`decide\` 命令原本只会处理 #53919 的地址优先级。控制平面因此增加 \`--decision-file\`，让 operator 为不同需求提供独立决策。

这次决策明确：drop-ship PO 的 \`contact_person\` 可以来自 Supplier 或选中的 Customer；普通 PO 保持 Supplier-only；系统不自动清空或改写联系人；混合普通行和 drop-ship 行的下游 PR/PI 风险必须记录。基于新的 resolved IR，运行时重新生成联系人校验语义的 US 和包含 24 个 task 的 OpenSpec，没有复用第一条运行的旧规格。

第二次运行又依次暴露了几个系统问题：

- 短 SHA 与完整 \`rev-parse HEAD\` 直接比较会误判，必须先解析成 canonical object id。
- 新建 site 时没有 Docker socket 权限，只能复用已验证站点，但仍要为当前 commit 重新运行 baseline，不能复制上一条 BaselineRun。
- 模型完成编辑后长期没有返回 structured output，人工中断后只能根据实际 diff、测试和 Checkpoint 手动 finalize；适配器因此增加 600 秒超时。
- 空 \`changed_paths\` 让 \`py_compile\` 收到空参数，控制平面改为从 \`base..HEAD\` 重新推导路径。
- assessment 发现规格要求更新文档，而 allowed paths 中没有文档路径，必须扩展白名单、修改 README、产生新 commit 并重新验证。
- 第二次 assessment 返回 placeholder，被本地 schema 校验拒绝；最终报告明确标记为操作员基于完整 diff 和门禁结果生成，而不是伪装成模型正常返回。

最终，这条 run 的状态版本为 17，本地交付 commit 为 \`58207728674556b090c45dc128f1ec3ed9291d35\`。它保留 3 个 BlockedRecord、4 个 ValidationRun、8 个 RuntimeTrace、7 个 FactoryWorkItem、6 个 Checkpoint 和 2 个人工 ReviewDecision。

第二条运行的价值不是又多了一次“全绿”，而是证明同一条链路可以处理不同业务语义，同时把决策硬编码、SHA 规范化、空变更集、模型超时、审查占位输出和修复路由等平台问题暴露出来。自动化平台本身也必须通过真实任务接受测试。

## 6. 人在哪里，以及我负责了什么

正常链路保留两个固定人工节点：

- IR Review 检查 IR 和验收条件，并通过 DecisionRecord 确认会改变产品行为的选择。US 随后由系统从已确认信息派生并自动校验；只有发生范围或依赖变化时，才增加 Scope Review。
- PR Gate 检查 AssessmentReport、代码 diff、proposal 和 design，决定是否允许交付。

需求歧义无法收敛、架构证据不足、执行环境不可用或权限不够时，也会临时转给人。自动化边界不取决于模型还能生成多少内容，而取决于当前问题是否有明确输入、可检查输出和预先定义的处理规则。

我在项目中的工作集中在四部分：

1. 设计 RR → IR → DecisionRecord → US 的需求加工链路，区分模型可以整理的信息和必须由人决定的产品行为。
2. 设计 OKF 知识仓与 BA → AA → TA 的定位路径，使业务概念能够追踪到源码、测试和版本证据。
3. 把 OpenSpec 的行为契约与 worktree、baseline、TDD、门禁和审查连接成 FactoryWorkItem。
4. 参与 Multica 运行时和状态机设计，为规格问题、代码问题、环境异常和人工确认定义不同的推进与恢复路径。

## 7. 小结

一条 Issue 不能直接提供正确的代码修改。它要先被整理成可确认的业务边界，再映射到应用对象和源码，写成增量行为契约，最后在隔离环境中实施、验证和审查。

这套“黑灯工厂”真正自动化的不是判断本身，而是判断之间的重复工作：重新装载上下文、执行任务、保存证据、检查门禁、按原因回退。人仍然负责决定需求、接受风险和批准交付。

两条 ERPNext 运行最有价值的地方，也不是最终都到达了 \`done\`，而是它们没有一次通过：环境、代码审查、格式、运行时隔离、决策硬编码和模型输出都真实失败过。每次失败都迫使系统回答三个问题——哪里出了问题、凭什么这样判断、下一步应该回到哪里。

因此，这个实验验证的是：需求解释、架构定位、行为规格、隔离执行、质量门禁、独立审查、人工审批和知识回写，可以被连接成一条可追踪、可恢复的证据链。距离生产化仍有并发调度、完整隔离、上游 CI/CD、规格对账和知识合并等工作，但“从 Issue 直接生成代码”的黑箱，已经被拆成了一组可以逐项检查的工程环节。
`,
}

export default article
