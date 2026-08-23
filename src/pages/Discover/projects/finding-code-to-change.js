const project = {
  slug: 'finding-code-to-change',
  date: '2026-08-13 14:00',
  name: 'Finding the Code to Change: From Grep to Agentic RAG in a Large Codebase',
  url: 'https://github.com/xilon-my/agentic-code-rag',
  description: '本文以修改支付重试逻辑为例,说明编码 Agent 如何在大型存量代码仓中定位待修改代码。检索分为三层:词法检索用 grep 查找名称,结构检索用调用图查找关系,语义检索用嵌入匹配意图。最后使用 OpenAI Agents SDK 实现一个按成本依次调用三层检索的 Agent。',
  tags: ['RAG'],
  author: 'Shannon',
  takeaway: 'Agent 修改代码前需要先定位待修改位置。grep 适合查找名称,因为代码标识符通常具有较高区分度;调用图用于分析修改影响;嵌入用于匹配与代码字面不重叠的意图。三者按成本组成一条检索漏斗:先查名称,再分析关系,最后匹配意图。词法检索的假阳性可以通过阅读结果排除,语义检索的假阴性则不易被 Agent 发现,因此优先使用成本较低的词法层。Claude Code 和 Codex 默认不建立向量库,是因为多数任务可以由词法检索完成;当仓库规模增大、意图与代码字面不重叠或需要跨文件分析影响时,再加入结构与语义检索。',
  detail: `修改代码前,Agent 需要先确定:**待修改代码位于哪个文件和哪一行。**

本文从一个具体任务开始。配套仓库中的订单与支付系统(shop)把支付重试逻辑放在 shop/payments/retry.py:

    # shop/payments/retry.py —— 支付重试逻辑
    def retry_payment(order, gateway, token):
        """Charge order through gateway, retrying transient failures."""
        for attempt in range(MAX_PAYMENT_RETRIES + 1):
            record = gateway.charge(order, token)               # 发起扣款
            if record.success:
                return record                                   # 成功就返回
            if attempt < MAX_PAYMENT_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))  # 失败就固定等几秒
        return record

(代码做了简化,省略了 import 和类型标注——核心逻辑没变。)任务是:**让 agent 把这个函数从"失败后固定等几秒"改成"指数退避"——第 1 次等 1 秒、第 2 次等 2 秒、第 3 次等 4 秒,每次翻倍。**

Agent 打开仓库后,首先要确定这个函数所在的文件和行号。在大型代码仓中,定位错误会使后续修改作用于无关代码。下面依次说明三种定位方法。

## 1. agent 的第一反应是 grep(词法检索)

绝大多数 agent 会先 grep。Claude Code 的 Grep 工具、Codex 的 grep_files,本质上都是 ripgrep——在文件里搜字符串,返回命中的文件、行号和那一行的内容。

在例子里,grep -n "retry" 会命中上面这个 retry_payment——搜索词就是代码里的函数名,名字找到了,位置(shop/payments/retry.py)也就找到了。

词法检索在代码中有效,原因是**标识符通常具有较高区分度**。文档中的"退款"可以写成 refund、reimbursement 或 give back;代码中的 retry_payment 通常只有一个定义,调用处也必须使用这个名称。因此,命中完整标识符时通常可以直接定位对应符号。搜索"退款"可能漏掉使用 reimbursement 的文本,搜索 retry_payment 则不会受同义改写影响。

仅找到 retry_payment 还不够。开始修改前,Agent 还需要回答两个 grep 无法直接回答的问题:

1. **谁在调用 retry_payment?** 改了它的行为,会不会影响别人?
2. **用户说的"指数退避",代码里根本没有这个词。** grep 搜"退避"命中为零。

这两个问题,分别对应代码检索的另外两条路。

## 2. 三个问题,三种检索

agent 改代码时要回答三类问题,每一类靠一种不同的检索:

| agent 改代码时的问题 | 例子里是 | 靠什么 |
|---|---|---|
| 这个符号在哪? | retry_payment 在哪个文件 | **词法**(grep / BM25) |
| 谁调用它?改了影响谁? | process_checkout 调用了 retry_payment | **结构**(调用图) |
| 用户说的意图,代码里没这个词 | "指数退避" | **语义**(嵌入) |

下面把后两路讲清楚。这两路,正是代码检索和文档检索最不一样的地方。

## 3. 语义:怎么搜"代码里没有的词"

第三个问题最难的地方在于:用户说"把支付重试改成**指数退避**",可上面那个函数里根本没有"退避"这两个字——只有一行 time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1)),表示"失败后固定等几秒"。grep 搜"退避",命中为零。

要让"指数退避"这个意图命中 retry_payment,需要根据语义而不是字面匹配。这就是嵌入(embedding)。下面从 transformer 的结构说明嵌入的来源:

**嵌入 = transformer 编码器 + 池化。** transformer 把一串 token 变成一串向量(每个 token 一个,还带着上下文);池化把这串向量压成一个固定向量(最常见是把所有 token 向量按维度取平均)。于是"指数退避"变成一段向量,retry_payment 函数(连同它的 docstring,写着 retrying transient failures)也变成一段向量。**两个向量夹角的余弦,就是它们语义上的接近程度。** "指数退避"和"retrying transient failures"的向量挨得近,尽管字面上没有一个词相同——这就是语义检索能搜到"代码里没有的词"的原因。

向量中的语义关系来自训练。第一步,预训练使用掩码标识符预测,模型根据上下文恢复被遮蔽的函数标识符;第二步,检索微调使用对比损失,缩短"docstring ↔ 函数"等正样本对的向量距离,增大无关样本之间的距离。

代码检索在这里和文档 RAG 有一个关键区别:**代码按什么切块**。文档按 token 切没关系,一段话前后几十个词通常就够;代码按 token 切,会把一个函数劈成两半。所以代码检索**按语法单元(函数/类)切**,靠一个能把代码变成树、能回答"函数从哪行到哪行"的工具——tree-sitter。

**tree-sitter 是一个把源代码解析成抽象语法树(Abstract Syntax Tree,简称 AST)的工具。** 以 retry.py 中的 _sleep 函数为例:

    def _sleep(seconds):
        time.sleep(seconds)

tree-sitter 解析出来的是这样一棵树(节点名做了简化):

    module
      function_definition                 "def _sleep(seconds):"
        name: identifier                  "_sleep"
        parameters                        seconds
        body: block
          call                            time.sleep(seconds)

注意这不是一行行字,而是**一棵有结构的树**:最外面是 module(整个文件),里面一个 function_definition(函数定义),函数底下挂着它的名字、参数、函数体,函数体里是一次函数调用 time.sleep(...)。grep 只能告诉你"time.sleep 出现在第 2 行";有了这棵树,问"_sleep 函数从哪行到哪行",就是"function_definition 这个节点覆盖了哪些行",一问就有;问"哪里调用了 time.sleep",就是"树里所有 call 节点底下是不是挂着 time.sleep"。**这就是 grep 给不了、结构层需要的东西。** 后面建调用图,也是先靠它把代码变成这棵树。

按函数切分有两个原因:函数通常对应一个相对完整的意图,函数签名和 docstring 也提供了集中描述语义的文字。在本例中,retry_payment 整个函数构成一个检索单元,其 docstring 为嵌入模型提供与查询对齐的文本。

## 4. 结构:调用关系与修改影响

第二个问题靠调用图。先想清楚为什么 grep 答不了:grep 只能找"字面写着 retry_payment 的地方"。但 retry_payment 是被 shop/checkout.py 里的 process_checkout 调用的——看这个文件:

    # shop/checkout.py —— 结账流程
    def process_checkout(cart, order_id, gateway, token, orders):
        order = cart.to_order(order_id)                   # 把购物车变成订单
        reserve_stock(order.items)                       # 锁定库存
        orders.create_order(order)                       # 登记订单
        record = retry_payment(order, gateway, token)    # ← 支付重试在这里被调用
        if record.success:
            order.payment = PaymentStatus.SUCCEEDED
            return order
        release_stock(order.items)                       # 支付失败,释放库存
        raise CheckoutError("payment failed")

(代码同样经过简化。)process_checkout 函数中的 record = retry_payment(order, gateway, token) 表明调用发生在函数体内。

grep "retry_payment" 也能找到这一行,但只返回字面命中,不会直接表示"process_checkout 调用了 retry_payment"这一关系。调用关系需要通过三步从代码结构中得到:

1. **解析**:tree-sitter 把 retry.py 变成一棵 AST,知道哪些是函数、哪些是函数调用。
2. **名字绑定**:把代码中调用 retry_payment 的位置关联到 retry.py 中对应的定义,同时处理同名符号和作用域等问题。
3. **建图**:节点是函数/类,边是"调用"。process_checkout → retry_payment 是一条边。

建好图,检索就变成**走图**:问"谁调用 retry_payment",反向走一条边,得到 process_checkout;问"改它影响谁",沿反向一层层展开——直接调用者必受影响、隔一层的可能受影响、隔两层的至少要跑一下测试。

这是代码修改场景特有的要求。文档 RAG 通常不需要分析修改影响,代码 RAG 则需要。**修改前可以通过调用图列出直接和间接调用者,据此确定需要检查与测试的范围。**

## 5. 组合:一条按成本排序的漏斗

把三条路合起来,看 agent 拿到"把支付重试改成指数退避"这个任务时,实际走一遍:

1. **词法**:grep "retry" → 命中 retry_payment。任务中的"重试"与函数名称在字面上重叠,因此可以直接命中,检索成本接近于零。
2. **结构**:找到函数后,Agent 需要确认调用者。调用图返回 process_checkout,说明修改 retry_payment 的行为时也需要检查 checkout 流程。
3. **读代码**:Agent 打开 retry.py,读取 time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1)) 所在函数,并将固定退避改为指数退避。检索负责定位候选,代码阅读负责确认具体修改位置。

至此,词法与结构检索已经提供完成任务所需的信息,无需调用语义层。这符合检索漏斗的设计:任务和代码字面有重叠时,优先使用成本较低的层。

语义层适用于另一类情况。假设需求写成"支付失败后等待时间要递增——第 1 次等 1 秒、第 2 次等 2 秒、第 3 次等 4 秒"。这句话不包含 retry、backoff 或 payment 等代码标识符,中文查询也无法直接命中英文代码。此时,嵌入可以根据语义把"失败后等待时间递增"与 retry_payment 的 docstring(retrying transient failures)关联起来,使 Agent 定位已有实现,避免重复编写相同逻辑。

4. **重排**(可选):对召回的少数候选再用更贵的打分器精排一次,把真正相关的顶到最前。

检索顺序采用词法 → 结构 → 语义,有两个原因。第一是成本:词法成本最低,结构用于分析代码关系,语义需要运行模型,适合在词法无法匹配意图时使用。第二是错误类型:词法检索的假阳性可以通过阅读结果排除;语义检索的假阴性则不容易被 Agent 发现。因此先使用成本较低、结果容易复核的检索层。

下一节进一步说明 Agent 能够容忍词法假阳性的原因,以及何时需要增加向量检索。

## 6. 为什么今天的编码 agent 默认不建向量库

Claude Code 和 Codex 等编码 Agent 默认不建立向量库,仍能完成许多代码修改任务。原因是**Agent 可以在循环中反复检索和阅读,而词法检索产生的假阳性可以在循环中被排除**。具体包括四点:

**第一,Agent 可以多次检索,不要求首次命中正确结果。** 传统 RAG 通常执行一次检索并将结果加入上下文;Agent 则可以读取 grep 命中,发现无关后更换查询词,也可以沿 import 继续查找调用者。一次 grep 通常只需几毫秒,主要额外成本来自读取无关文件。

**第二,Agent 可以处理词法检索的假阳性。** 字面匹配但无关的结果可以通过代码阅读排除,然后更换查询词;语义检索漏掉相关结果时,Agent 往往无法确定缺少了什么。一次性 RAG 没有后续检索循环,因此对假阳性和假阴性都更敏感。

**第三,检索负责定位,代码阅读负责理解。** grep 定位候选文件后,Agent 使用 read_file 阅读完整函数和相关上下文。检索不需要一次返回完整答案,只需缩小后续阅读范围。

**第四,仓库规模有限,并且有目录说明。** SWE-bench 这类基准仓库通常包含数千个文件,再配合 CLAUDE.md / AGENTS.md 等分层上下文文件,Agent 可以先缩小需要检索的目录。范围有限时,词法检索通常已经足够。有团队在 SWE-bench 上报告过:"grep 和 find 就够了,embedding 不是瓶颈。"

**目录说明也可以采用 OKF。** OKF(Open Knowledge Format,Google 2026 年中的草案)把提供给 Agent 的知识组织为 kb/ 目录:每个概念对应一个 Markdown 文件,YAML 标注 type/verified/stale_after,index.md 提供目录清单。它与 CLAUDE.md 都采用渐进式披露,使 Agent 先了解可用信息,再选择需要读取的内容;OKF 还提供显式的 index.md 索引和 verified/stale_after 状态标注,无需把全部内容一次加入上下文。

在大型企业存量系统中,这一知识层是检索的前提。面对数千万行代码和上千个微服务,Agent 不能在全部仓库中逐一执行词法检索;index.md 可以先说明各领域对应的服务和入口,将检索范围缩小到相关仓库。财务、合规等代码还依赖指标定义、政策和设计原因等代码外知识,verified/stale_after 用于标注这些知识的可信状态和时效。OKF 不负责直接定位代码,而是提供代码背后的领域知识:先根据知识层确定检索范围,再在对应范围内执行检索漏斗。OKF 目前仍是草案,相关生态也处于早期阶段。

这四点有一个共同前提:**任务和代码在字面上有重叠。** "change payment retry to exponential backoff" 包含 retry,因此词法检索可以直接命中 retry_payment。没有字面重叠时,需要增加结构或语义检索:

| 失效场景 | 例子里是 |
|---|---|
| 意图和代码字面零重叠 | "指数退避" 对 retry_payment 里的 time.sleep(...) |
| 超大仓库,一个词命中几千处 | 在 monorepo 里 grep "retry" 出来一片 |
| 跨文件改动,要枚举影响面 | 改 retry_payment 的签名,得知道 process_checkout 在调用它 |
| 陌生/第三方代码,不知道名字 | 面对一个命名风格未知的库,想搜都不知道搜什么词 |

是否使用 agentic RAG,取决于仓库和任务能否由词法检索覆盖。词法层不足时,再加入结构或语义层。

## 7. 使用 OpenAI Agents SDK 实现 Agent

配套仓库 agentic-code-rag 使用 OpenAI Agents SDK 实现了这条检索漏斗。索引与检索可以离线运行,只有调用模型生成答案时需要 API key;语义嵌入为可选功能,可以在 GPU 服务器上启用。

实现前需要明确两个问题:Agent 如何识别检索意图,以及 RAG 如何作为工具接入 Agent。

**意图识别依赖工具描述,不是单独的分类模块。** 在 OpenAI Agents SDK 中,每个 @tool 函数的 docstring 向模型说明工具用途。模型根据任务和这些说明选择工具与参数。实现包含六个工具:

    hybrid_search(query, top_k=5)    # 漏斗主入口:定位要改的函数/类
    find_symbol(name)                # 按确切名字找符号定义
    get_callers(symbol_fqn)          # 谁调用它 —— 改动影响面
    get_callees(symbol_fqn)          # 它调用了谁 —— 依赖
    read_file(path, start, end)      # 读文件 / 行区间
    grep(pattern)                    # 词法兜底

每个工具的 docstring 写清了"什么时候用、参数传什么",比如 hybrid_search 的说明是:

    "Search the codebase for the code most relevant to the task. Use this as
     your primary tool to locate the function or class to edit. query: What
     the user wants to find or change, e.g. 'payment retry policy'."

拿到任务"把支付重试改成指数退避",模型就这样"识别意图":它读 hybrid_search 的说明——"主工具,用来定位要改的函数"——于是调 hybrid_search(query="payment retry policy"),拿到 retry_payment;读 get_callers 的说明——"改动的影响面"——于是调 get_callers("shop.payments.retry.retry_payment"),拿到 process_checkout;再 read_file 读代码。**每一步调哪个工具、传什么参数,就是"意图识别"的实体。**

**RAG 变成工具,就是 @tool 那一行。** @tool 把任意 Python 函数变成 agent 可调用的工具:SDK 从函数签名(参数类型)自动生成 schema,从 docstring 生成描述。检索漏斗(词法/结构/语义)在工具内部执行,模型看到的只是"我调了 hybrid_search,它返回了这些符号"——它不知道也不关心 BM25 和 RRF 的区别,这正是封装的意义。

**Agent 循环由 SDK 的 Runner 执行**:任务 → 模型选择工具和参数 → SDK 执行并返回结果文本 → 模型根据结果更换查询词、查找调用者、读取文件或生成答案 → 信息充分后输出结构化 Answer。Answer 包含 answer(答案)、citations(引用)和 needs_more_info(信息不足时置真)三个字段。输入 guardrail 拒绝空任务和非代码任务,输出 guardrail 要求结果包含引用或标记信息不足;SQLiteSession 保存对话历史,使后续问题可以复用已有上下文。

**检索层**照漏斗实现成四个可插拔阶段:

- 词法:自建 char-bigram BM25(前一篇文档 RAG 同款风格),让 "retry payment" 不用分词就能命中 retry_payment。
- 结构:tree-sitter 解析 → 名字绑定 → 调用图 + 引用图。
- 语义:函数级嵌入,设 AGENTIC_RAG_EMBEDDINGS=1 才启用,默认全离线(嵌入在 GPU 服务器上跑)。
- 混合:RRF(k=60)只融合词法 + 语义两个召回器;结构作为精化层——图连通的命中在分数相近时上浮。实现时遇到一个问题:RRF 融合后再按原始分重排,会消除结构分数的贡献,所以让结构只做精化、不参与二次排序。

在示例仓中运行查询 "change the payment retry policy to exponential backoff" 时,首个结果是 retry_payment,同时返回其调用者 process_checkout,与第 5 节的分析一致。

**两个取舍**:语义严格可选(便宜的层先上);调用关系基于名字解析(一个 charge 调用会解析到所有叫 charge 的符号)——便宜、可预测,但会误报。

至此,Agent 已经具备完整的检索循环。不过,何时调用工具仍由模型根据当前上下文临时判断,没有经过专门训练。

## 8. 把"何时调工具"训进权重:agentic RL

当前方法有一个限制:**它由通用模型、prompt 和一组工具组成。** 模型根据工具描述临时判断何时检索、何时停止,这些行为没有经过专门训练,因此结果主要取决于模型本身的 tool-calling 能力。

2025-2026 年出现了使用强化学习训练工具调用策略的方法,即 **agentic RL**。它把"在仓库中探索 → 定位 → 修改代码"的多轮轨迹作为策略,使用可验证奖励训练模型判断何时检索、更换查询词和停止。奖励可以根据结果与 gold patch 的文件和行号 F1 计算。Kimi K2、Qwen3-Coder 等编码模型也在训练中使用了这类方法,使工具调用策略不只依赖 prompt。

"训谁"有两条路:

**路一:端到端训整个 agent。** 模型权重学会完整循环,包括"何时检索"。代表 SWE-RL、OpenHands-LM,以及前述的 Kimi K2 / Qwen3-Coder。代价:要大规模算力、数据、以及可靠的测试验证环境(Docker sandbox),个人团队很难复现。

**路二:单独训练 searcher 子模型。** 这种方法需要的训练资源较少,也更容易复现。主模型通常保持冻结,在需要定位代码时调用较小的 searcher:

- **FastContext**(微软,MIT 开源):专训的"仓库探索器",奖励 = file-F1 + line-F1 + 并行奖励,目标返回"小而准"的文件+行号引用。主 agent token 最多 -60%。4B 版 8GB 显存就能跑。
- **CodeScout**(OpenHands,开源):只做定位,奖励 = file/module/function 三级 F1。14B 的文件定位 F1 超过 GPT-5。
- **CodeGrep**(GRPO 训的 14B grep agent):动作就是 grep/glob/read,效率信号放进 advantage 层,SWE-bench Verified 27.0%,已解决实例 -19% token。
- **SWE-Search**(开源):不训权重,推理时用 MCTS 增强搜索。

在第二种方法中,**searcher 作为工具接入主模型**;在 OpenAI SDK 中可以通过 agent.as_tool() 实现。主模型输入任务描述,searcher 在自己的上下文窗口内执行多轮 grep/glob/read,最终只返回少量包含文件与行号的引用。主模型不接收中间搜索过程,而是根据这些引用继续判断和修改。

这套分工立足在两个好处上:

- **上下文压缩**:探索是编码 Agent 的主要成本之一(实测读/搜占 56% 的工具调用轮次、46% 的 token)。searcher 处理原始搜索输出,只返回位置引用,减少主模型接收的搜索上下文。FastContext 报告主 Agent 的 token 使用量最多降低 60%。
- **搜索策略被训练过**:searcher 知道什么时候换词、什么时候深挖,不是临场猜的——这正是"会调工具"和"会检索"的分界。

这套方法说明两点。第一,本文的漏斗属于**检索机制**,负责候选排序;agentic RL 训练的是**检索策略**,负责决定何时检索和停止,两者可以组合。资源有限的团队可以接入已有 searcher:主模型先调用 FastContext 或 CodeScout 获取引用,再用检索漏斗精化结果,无需从头训练。第二,CodeGrep 的检索精度实验显示,BM25(精度 0.375)会降低 Agent 表现,CodeGrep(精度 0.677)才开始减少整体成本。这说明只有当检索质量达到一定水平时,接入额外检索器才有收益。

## 9. 结论

Agent 修改代码前,需要先定位待修改位置。grep 用于查找具有较高区分度的代码标识符;调用图用于分析修改影响;嵌入用于匹配与代码字面不重叠的意图,并按函数等语法单元切块。三者按成本从低到高组成检索漏斗。

简言之:**先搜名字,再翻关系,最后才对意图——便宜的先用。**

而这条漏斗的下一步,是把"怎么搜"本身也交给训练——从"会调工具"到"会检索"。`,
}

export default project
