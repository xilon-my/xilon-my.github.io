const project = {
  slug: 'finding-code-to-change',
  date: '2026-08-13 14:00',
  name: 'Finding the Code to Change: From Grep to Agentic RAG in a Large Codebase',
  url: 'https://github.com/xilon-my/agentic-code-rag',
  description: '让编码 agent 在大型存量代码仓里找到"自己要改的那段代码"。从一个具体的改支付重试的任务讲起,看 agent 怎么靠三种检索一步步定位:词法(grep 找名字)、结构(调用图找关系)、语义(嵌入找意图),最后用 OpenAI Agents SDK 把这条"按成本排序的漏斗"落成一个能跑的 agent。',
  tags: ['RAG'],
  author: 'Shannon',
  takeaway: 'agent 改代码之前,先要找到那行要改的代码。找名字靠 grep——代码的标识符几乎不重名,词法就够可靠;弄懂"改了影响谁"靠调用图——这是修改场景独有、也最重要的一层;匹配"代码里没有的词"这种意图靠嵌入——从 transformer 推导、按函数切块。三者按成本从便宜到贵组合成一条漏斗:先搜名字、再翻关系、最后才对意图。词法搜错是假阳性,扫一眼能排除;语义搜错是假阴性,agent 根本不知道漏了——所以便宜的先用,贵的放后面。Claude Code、Codex 默认不建向量库,不是 RAG 没用,而是多数任务词法这一层就够;等仓库变大、意图零重叠、要跨文件枚举影响面时,才把更深的一层接进来。',
  detail: `改代码之前,agent 得先回答一个问题:**那行要改的代码,到底在哪?**

这篇文章从一个具体的任务讲起。为了让例子看得见,先贴出配套仓库里那个订单/支付系统(shop)中要改的文件——支付重试逻辑,在 shop/payments/retry.py:

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

agent 打开仓库,第一件要做的事不是写代码,而是:**找到这个函数在哪个文件、哪一行。** 这一步看着简单,却是编码 agent 最容易出错的地方——在一堆代码里定位"要改的那一处"。下面看它实际怎么找。

## 1. agent 的第一反应是 grep(词法检索)

绝大多数 agent 会先 grep。Claude Code 的 Grep 工具、Codex 的 grep_files,本质上都是 ripgrep——在文件里搜字符串,返回命中的文件、行号和那一行的内容。

在例子里,grep -n "retry" 会命中上面这个 retry_payment——搜索词就是代码里的函数名,名字找到了,位置(shop/payments/retry.py)也就找到了。

为什么这一招在代码里特别管用?因为**代码的标识符几乎不重名**。文档里"退款"可以说成 refund、reimbursement、give back,同义改写一大堆;但代码里 retry_payment 通常只有一个——别人想调用它,就得用这个名字。所以**字面命中一个标识符,基本就等于命中了唯一正确的那个符号**。搜"退款"会漏掉所有写"reimbursement"的地方;搜 retry_payment 几乎不会漏。

但光找到 retry_payment 还不够。真正动手改之前,agent 还得回答另外两个问题,而这两个问题 grep 答不了:

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

要让"指数退避"这个意图命中 retry_payment,需要一种**不看字面、看意思**的检索。这就是嵌入(embedding)。嵌入是什么?从 transformer 的地基推一遍:

**嵌入 = transformer 编码器 + 池化。** transformer 把一串 token 变成一串向量(每个 token 一个,还带着上下文);池化把这串向量压成一个固定向量(最常见是把所有 token 向量按维度取平均)。于是"指数退避"变成一段向量,retry_payment 函数(连同它的 docstring,写着 retrying transient failures)也变成一段向量。**两个向量夹角的余弦,就是它们语义上的接近程度。** "指数退避"和"retrying transient failures"的向量挨得近,尽管字面上没有一个词相同——这就是语义检索能搜到"代码里没有的词"的原因。

但向量不是天生带意思的,是**训练逼出来的**。两步:预训练用掩码标识符预测,逼模型理解代码语义(把函数里的标识符盖住,让模型猜);检索专用微调用对比损失,把"docstring ↔ 函数"这类正对的向量拉近、把无关样本推开。

代码检索在这里和文档 RAG 有一个关键区别:**代码按什么切块**。文档按 token 切没关系,一段话前后几十个词通常就够;代码按 token 切,会把一个函数劈成两半。所以代码检索**按语法单元(函数/类)切**,靠一个能把代码变成树、能回答"函数从哪行到哪行"的工具——tree-sitter。

**tree-sitter 是一个把源代码解析成语法树(Abstract Syntax Tree,简称 AST)的工具。** 说"树"太抽象,拿例子里最小的函数 _sleep 看——它在 retry.py 里,长这样:

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

为什么按函数切?一个函数恰好是"一个意图对应的单元",而函数签名加 docstring 给了嵌入模型最稠密的文字锚点。在例子里,retry_payment 整个函数是一个检索单元,它的 docstring 说清了它在干什么,嵌入模型才有东西可对齐。

## 4. 结构:谁调用它,改了会不会弄坏别人

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

(同样做了简化。)现在能亲眼看到:process_checkout 这个函数里,有一行 record = retry_payment(order, gateway, token)——**调用发生在函数体里**。

grep "retry_payment" 也能找到这一行。但"process_checkout 调用了 retry_payment,而它是支付重试的唯一入口"这个**关系**,grep 只给了字面命中,没给关系。这个"谁调用了谁"藏在代码的结构里,要把结构挖出来,分三层:

1. **解析**:tree-sitter 把 retry.py 变成一棵 AST,知道哪些是函数、哪些是函数调用。
2. **名字绑定**:把代码里每个"调用了 retry_payment"的地方,关联到 retry.py 里那个真正的定义(跳过同名、作用域这些坑)。
3. **建图**:节点是函数/类,边是"调用"。process_checkout → retry_payment 是一条边。

建好图,检索就变成**走图**:问"谁调用 retry_payment",反向走一条边,得到 process_checkout;问"改它影响谁",沿反向一层层展开——直接调用者必受影响、隔一层的可能受影响、隔两层的至少要跑一下测试。

这就是修改场景独有的东西。文档 RAG 不需要回答"改这段会不会弄坏那段";代码 RAG 必须回答。**改代码前弄清楚影响面,靠的不是猜,是把调用图翻出来数一遍。**

## 5. 组合:一条按成本排序的漏斗

把三条路合起来,看 agent 拿到"把支付重试改成指数退避"这个任务时,实际走一遍:

1. **词法**:grep "retry" → 命中 retry_payment。任务里带着"重试"这个词,和函数名字面重叠,直接命中。便宜,几乎零成本。
2. **结构**:找到函数后,agent 要回答第 2 节那个问题——"谁在调用它?"调用图给出 process_checkout。改 retry_payment 的行为,checkout 是受影响方,要顺带检查。
3. **读代码**(这不是检索,是检索把人带到门口之后的活):agent 打开 retry.py 读这个函数,看到 time.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1)) 那行固定退避,把它改成指数退避。

**到这里,这个任务就走完了——词法加结构就够,语义层根本没上场。** 这不是漏斗失效,恰恰是它的设计:任务和代码字面有重叠时,便宜的层先接住。

语义层真正必须上场,是另一种情况。换个任务:需求是"支付失败后等待时间要递增——第 1 次等 1 秒、第 2 次等 2 秒、第 3 次等 4 秒"。这句话里没有任何一个词是代码里的标识符:没有 retry、没有 backoff、没有 payment,连"重试"都没说。grep 就没了入口——搜中文搜不到(代码里没有中文),把"递增""等待"这些词拿去对英文标识符也搜不到。这种时候才轮到语义层:嵌入把"失败后等待时间递增"这个意图,和 retry_payment 的 docstring(retrying transient failures)拉到一起,agent 才知道去改这个函数——否则它可能以为代码里没有现成的逻辑,从零写一个。

4. **重排**(可选):对召回的少数候选再用更贵的打分器精排一次,把真正相关的顶到最前。

**顺序为什么是词法 → 结构 → 语义?** 两个理由。一是**成本**:词法最便宜,先上;结构在改代码场景不可替代,用来精化;语义最贵(要跑模型),只在词法对不上意图时才值得。二是**犯错的方向**:词法出错是假阳性——字面匹配但无关,agent 扫一眼就能排除,换个词再搜;语义出错是假阴性——该找到没找到,agent 根本不知道漏了。所以先用便宜、错得起的那层,贵的、错不起的放后面。

还有一个问题悬着:为什么 agent 能容忍词法的假阳性?"词法够不够"的分界线到底在哪?下一节回答。

## 6. 为什么今天的编码 agent 默认不建向量库

前面把检索讲透了,但一个现实摆在面前:今天最流行的编码 agent——Claude Code、Codex——默认并不建向量库,却能改好代码。这不是疏忽,而是因为**agent 的检索方式和一次性 RAG 完全不同——它靠循环,而词法的失败模式对它恰好友好**。拆开有四条:

**第一,agent 会反复试,不需要一次就中。** 传统 RAG 是"查一次 → 拼进上下文 → 生成",检索漏了,答案就错,没有第二次机会。agent 不是:它 grep 到一个命中,读一下发现不是支付重试,换个词再搜;打开文件从头读到尾,顺着 import 跳到别的文件,找到调用者……它**可以错很多次,只要最后找到就行**。搜索本身便宜(一次 grep 几毫秒),真正的成本是"读了一个没用的文件"——而一次失败的 grep 命中,读一眼就知道不是,代价极小。

**第二,词法搜错的代价,agent 恰好承受得起。** 第 5 节说过:词法出错是假阳性——字面匹配但无关,agent 读一眼就能排除,换个词再搜;语义出错是假阴性——该找到没找到,agent 根本不知道漏了。所以对 agent 来说,词法的"噪声"可以容忍,语义的"盲区"才是致命的——这正是它敢用 grep 的底气。换成一个一次性 RAG 系统,就没有这个底气:它只查一次,假阳性直接污染答案,假阴性直接答错,没有循环来兜底。

**第三,检索只是开门,读代码才是活。** grep 把 agent 带到正确的文件后,真正的理解发生在 read_file——agent 把整个函数读完,理解上下文,顺藤摸瓜。检索只需要负责"把 agent 带到正确的门前",不需要像 RAG 那样把答案一次性打包好喂进去。这就是"检索粗糙,但读得仔细"能成立的原因。

**第四,仓库够小,加上有地图。** SWE-bench 这类基准的仓库通常就几千个文件,再配上 CLAUDE.md / AGENTS.md 这种分层上下文文件(相当于一页"仓库地图",告诉 agent 该去哪几个目录看),agent 知道往哪 grep。范围小,词法扫一遍就够。有团队在 SWE-bench 上报告过:"grep 和 find 就够了,embedding 不是瓶颈。"

**地图还可以更正式:OKF。** 前一篇讲过 OKF(Open Knowledge Format,Google 2026 年中的草案)——把"给 agent 的知识"标准化成 kb/ 目录:每个概念一个 Markdown 文件、头顶 YAML 标 type/verified/stale_after,index.md 当目录清单。它和 CLAUDE.md 是同一族,都靠"渐进式披露"让 agent 先知道有什么、再决定读什么;但 OKF 多给两样:**显式的 index.md 索引**(agent 顺着链接下钻,不把整包灌进上下文)和 **verified/stale_after 的信任/新鲜度标注**。

这一层在大型 to-B 存量系统里不是可选项,而是检索的前提。几千万行代码、上千个微服务,每个服务一个 repo、一套 API——agent 不可能跨几千个仓做词法检索;"先知道哪个服务拥有哪个领域、入口在哪"才是第一件事,index.md 就是这本"服务目录",把"去哪找"从大海捞针变成按图索骥。而且改财务、合规的 to-B 代码时,指标怎么定义、政策是什么、为什么这么实现——这些代码里没有的知识,决定改动能不能做,verified/stale_after 给它们标了信任和新鲜度。它管的仍然不是"代码在哪"(那是检索漏斗的活),而是"这段代码背后的领域知识";规模一大,顺序就变成:先读知识层知道去哪,再跑漏斗在那一片里找代码。OKF 还只是草案、生态很新,但"给 agent 一个结构化知识层"的方向,和本节的地图一脉相承。

但这四条都有个共同前提:**任务和代码在字面上有重叠。** "change payment retry to exponential backoff" 里带着 retry,词法直接命中 retry_payment。一旦这个前提不成立,词法就撑不住了,才轮到更深的一层:

| 失效场景 | 例子里是 |
|---|---|
| 意图和代码字面零重叠 | "指数退避" 对 retry_payment 里的 time.sleep(...) |
| 超大仓库,一个词命中几千处 | 在 monorepo 里 grep "retry" 出来一片 |
| 跨文件改动,要枚举影响面 | 改 retry_payment 的签名,得知道 process_checkout 在调用它 |
| 陌生/第三方代码,不知道名字 | 面对一个命名风格未知的库,想搜都不知道搜什么词 |

所以"上不上 agentic RAG"不是一个技术选择,而是:**你的仓库和任务,词法这一层够不够用。** 不够,就把漏斗更深的一层接进来。

## 7. 动手:用 OpenAI Agents SDK 把它落成 agent

原理讲完了,把它做出来。配套仓库 agentic-code-rag 用 OpenAI Agents SDK 把这条漏斗落成了一个能跑的 agent。索引与检索全部离线可跑,只有真正让 agent 答题才需要 API key;语义嵌入是严格可选的,放到 GPU 服务器上启用。

动手之前先想清楚两件事:这个 agent 的"意图识别"怎么发生,RAG 又是怎么变成工具的。

**意图识别靠的是工具描述,不是单独一个模块。** 在 OpenAI Agents SDK 里,每个 @tool 函数的 docstring 就是给模型的"使用说明书"——模型读到用户的任务,对照这些说明决定调哪个工具、传什么参数。这是六个工具在实现里的真实样子:

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

**agent 的循环由 SDK 的 Runner 跑**:任务 → 模型决定工具 + 参数 → SDK 执行、把结果文本喂回 → 模型根据结果决定下一步(换查询词再搜?查调用者?读文件?还是直接答)→ 直到模型认为信息够了,输出结构化 Answer。Answer 三个字段:answer(答案)、citations(引用,强制要有)、needs_more_info(信息不足时置真)。两道 guardrails:输入层拒绝空/非代码任务,输出层强制"要么带引用、要么标信息不足";SQLiteSession 记住对话历史,"现在给我看它的调用者"这类追问不用重新检索。

**检索层**照漏斗实现成四个可插拔阶段:

- 词法:自建 char-bigram BM25(前一篇文档 RAG 同款风格),让 "retry payment" 不用分词就能命中 retry_payment。
- 结构:tree-sitter 解析 → 名字绑定 → 调用图 + 引用图。
- 语义:函数级嵌入,设 AGENTIC_RAG_EMBEDDINGS=1 才启用,默认全离线(嵌入在 GPU 服务器上跑)。
- 混合:RRF(k=60)只融合词法 + 语义两个召回器;结构作为精化层——图连通的命中在分数相近时上浮。实现时踩过坑:RRF 融合后再按原始分重排,会把结构贡献洗掉,所以让结构做精化、不参与二次排序。

在示例仓上真跑"change the payment retry policy to exponential backoff",顶层命中就是 retry_payment,它的调用者 process_checkout 一起浮出来——和第 5 节走一遍的结果一致。

**两个取舍**:语义严格可选(便宜的层先上);调用关系基于名字解析(一个 charge 调用会解析到所有叫 charge 的符号)——便宜、可预测,但会误报。

到这里,agent 完整了。但这一切的"聪明",其实都是**模型临场发挥**的——这正是值得停下来看的地方。

## 8. 把"何时调工具"训进权重:agentic RL

我们的做法有一个诚实的短板:**它是"prompt 一个通用模型 + 一堆工具"。** 决定何时检索、搜到什么算够的,是模型的 tool-calling——它临场根据工具描述猜出来的,不是被训练出来的。猜得好不好,取决于模型本身,不取决于系统设计。

2025-2026 年的主流,已经用强化学习来补这个短板——**agentic RL**。它训的是模型权重,让模型学会"什么时候调用工具、搜到什么算够":把"在仓库里探索 → 定位 → 改码"的多轮轨迹当作策略,用可验证奖励(和 gold patch 算 F1:找到对的文件/行得高分、根本没找到得 0)把"何时检索、何时换查询词、何时停下"压进权重。今天最强的编码模型——Kimi K2、Qwen3-Coder——就是被这样 RL 出来的:它们知道什么时候该调工具,不是 prompt 教出来的。

"训谁"有两条路:

**路一:端到端训整个 agent。** 模型权重学会完整循环,包括"何时检索"。代表 SWE-RL、OpenHands-LM,以及前述的 Kimi K2 / Qwen3-Coder。代价:要大规模算力、数据、以及可靠的测试验证环境(Docker sandbox),个人团队很难复现。

**路二:把"搜索"单独切出来,训一个专门的 searcher 子模型。** 这是开源社区 2025-2026 的主线,因为便宜、可复现。主模型(通常是一个大 LLM,冻结不动)不亲自满仓库翻,而是调用一个小 searcher 去探索:

- **FastContext**(微软,MIT 开源):专训的"仓库探索器",奖励 = file-F1 + line-F1 + 并行奖励,目标返回"小而准"的文件+行号引用。主 agent token 最多 -60%。4B 版 8GB 显存就能跑。
- **CodeScout**(OpenHands,开源):只做定位,奖励 = file/module/function 三级 F1。14B 的文件定位 F1 超过 GPT-5。
- **CodeGrep**(GRPO 训的 14B grep agent):动作就是 grep/glob/read,效率信号放进 advantage 层,SWE-bench Verified 27.0%,已解决实例 -19% token。
- **SWE-Search**(开源):不训权重,推理时用 MCTS 增强搜索。

在路二里,大模型和小模型的分工很清晰:**searcher 是作为"一个工具"挂在大模型上的**(在 OpenAI SDK 里就是 agent.as_tool() 那种"把子 agent 当工具")。大模型在需要定位代码时——通常是第一步——调用它:输入是任务描述,输出是一小撮"文件+行号"引用(带行区间)。searcher 内部自己跑 grep/glob/read 的多轮循环,在**它自己的上下文窗口**里进行,大模型看不到这些中间过程;只有最终那几条引用回到大模型。类比:searcher 是侦察兵,大模型是指挥官——侦察兵只回报位置坐标,指挥官基于坐标做判断。

这套分工立足在两个好处上:

- **上下文压缩**:探索是编码 agent 的瓶颈(实测读/搜占 56% 的 tool 调用轮次、46% 的 token)。searcher 把原始搜索输出消化掉,只交回"坐标",大模型不用为满仓搜索烧 token(FastContext 实测主 agent token 最多 -60%)。
- **搜索策略被训练过**:searcher 知道什么时候换词、什么时候深挖,不是临场猜的——这正是"会调工具"和"会检索"的分界。

对我们而言,这套做法意味着两点。第一,我们的漏斗是**检索机制**(怎么把候选排好),agentic RL 训的是**检索策略**(何时搜、搜到什么算够),两者互补,不是二选一。个人团队最现实的做法是**接一个现成 searcher 当工具**:大模型先调 FastContext/CodeScout 拿引用,再跑我们的漏斗精化,几天能接上,不用从零训。第二,CodeGrep 的"检索精度阈值"实验:BM25(精度 0.375)反而拖累 agent,CodeGrep(精度 0.677)才跨过"检索开始省钱"的线——这印证前几节的漏斗排序:**检索质量上不去,不如让 agent 自己 grep;检索质量上去了,接进来才划算**。我们的漏斗把精度做高,恰恰是让"接进来"变划算的一环。

## 9. 结论

回到开头:agent 改代码前,先要找到那行要改的代码。找名字,靠 grep——代码的标识符几乎不重名,词法就够可靠;弄懂"改了影响谁",靠调用图——这是修改场景独有、也最重要的一层;匹配"代码里没有的词"这样的意图,靠嵌入——从 transformer 地基推出来,按函数切块。三者按成本从便宜到贵组合成一条漏斗。

简言之:**先搜名字,再翻关系,最后才对意图——便宜的先用。**

而这条漏斗的下一步,是把"怎么搜"本身也交给训练——从"会调工具"到"会检索"。`,
}

export default project
