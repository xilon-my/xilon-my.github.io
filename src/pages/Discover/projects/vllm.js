const project = {
  slug: 'vllm',
  date: '2026-08-28 18:00',
  name: 'vLLM',
  url: 'https://github.com/vllm-project/vllm',
  url2: 'https://arxiv.org/abs/2309.06180',
  description: 'vLLM 是面向高并发大模型服务的推理引擎。本文从三个同时到达的请求出发，区分 prefill 与 decode，计算 KV cache 的显存占用，再说明 continuous batching、PagedAttention、chunked prefill、prefix caching 与 speculative decoding 如何共同影响吞吐和延迟。最后给出并行部署、基准测试与同类工具的适用边界。',
  tags: ['Inference'],
  stars: '90.2k',
  author: 'Shannon',
  detail: String.raw`
## 1. 问题不是生成一个回答，而是同时生成很多回答

在本地命令行中运行模型时，通常只有一个请求：输入一段 prompt，等待模型逐 token 生成回答。此时主要关心单条请求能否放进内存，以及每秒能生成多少 token。llama.cpp 主要处理这一类问题：通过量化、GGUF 和 CPU/GPU 后端，让模型在个人设备上运行。

在线服务面对的是另一种负载。假设一张 GPU 在同一时刻收到三个请求：

| 请求 | 到达时间 | prompt 长度 | 预计输出长度 |
|---|---:|---:|---:|
| A | 0 ms | 80 tokens | 120 tokens |
| B | 20 ms | 800 tokens | 20 tokens |
| C | 60 ms | 40 tokens | 200 tokens |

如果逐个处理，请求 B 必须等 A 生成完，请求 C 又要等 B。GPU 每次只服务一个请求，等待时间随队列增长。如果把 A、B、C 固定成一个 batch，B 生成 20 个 token 后已经结束，但它占据的 batch 位置可能一直空到 A 和 C 都结束。新的请求也要等整个 batch 完成才能进入。

vLLM 解决的是这类服务问题。它不是新的模型架构，也不改变模型权重；它负责在 GPU 显存和计算预算有限的情况下，决定哪些请求在下一轮运行、KV cache 放在哪里，以及完成的请求何时离开、新请求何时进入。

理解 vLLM 需要先区分一次生成中的两个阶段：prefill 和 decode。

## 2. Prefill 与 decode 使用 GPU 的方式不同

### 2.1 Prefill：一次处理整段 prompt

请求 A 的 80 个 prompt token 已经全部已知。模型可以把它们组成矩阵，在各层中并行计算，并为每个 token 产生 key 和 value。这个阶段叫 **prefill**。

如果 prompt 长度是 $P$，hidden size 是 $d$，线性层的大矩阵乘法可以同时处理 $P$ 行输入。$P$ 较大时，GPU 有较多并行计算可做，prefill 通常更偏向算力瓶颈。用户看到的第一个直接结果，是首个输出 token 出现；从请求到达到首个 token 返回的时间叫 **TTFT（time to first token）**。

### 2.2 Decode：每轮只产生一个新 token

prefill 完成后，模型开始自回归生成。已有 KV cache 的情况下，每一轮只为最新 token 计算新的 query、key 和 value，然后读取此前所有 token 的 key/value，产生下一个 token。这个阶段叫 **decode**。

对一条请求而言，每轮 decode 的输入行数只有 1。矩阵乘法规模较小，却仍需读取模型权重和已有 KV cache，因此常受显存带宽限制。连续两个输出 token 之间的平均时间叫 **ITL（inter-token latency）**。用户感受到的流式输出速度主要由 ITL 决定。

两阶段的差异可以概括为：

| 阶段 | 每条请求一轮处理的 token | 主要工作 | 常见瓶颈 | 直接影响 |
|---|---:|---|---|---|
| prefill | 多个 prompt token | 建立整段 prompt 的 hidden states 与 KV cache | 计算 | TTFT |
| decode | 1 个新 token | 读取权重和已有 KV cache，生成下一 token | 显存带宽 | ITL |

服务引擎不能只追求其中一个指标。长 prompt 的 prefill 如果一次占满 GPU，正在流式生成的请求会停顿；如果始终优先 decode，新到达的 prompt 又可能长时间得不到处理。调度器需要在两者之间分配每一轮的 token 预算。

## 3. Continuous batching：batch 在每一轮都可以变化

传统静态 batch 在开始运行前确定成员，直到整批结束才释放。**Continuous batching（连续批处理）**把调度粒度缩小到模型执行的一轮：每轮结束后检查请求状态，完成的请求立即移出，等待中的请求可以立即加入。

仍用 A、B、C 举例。prefill 完成后，一次 decode 迭代可以同时为三个请求各生成一个 token：

| 迭代 | 本轮运行 | 迭代后发生的事 |
|---|---|---|
| 1 | A、B | C 仍在等待 prefill |
| 2 | A、B，加上 C 的部分 prefill | decode 与 prefill 共享本轮预算 |
| 20 | A、B、C | B 达到输出上限，立即释放 |
| 21 | A、C、D | 新请求 D 使用 B 释放的容量 |

这样做提高吞吐的原因不是单个 token 的计算公式变了，而是把多条请求的小矩阵运算合并成较大的矩阵运算，并减少空闲 batch 位置。设观察时间为 $T$，所有请求共生成 $N_{out}$ 个输出 token，则输出吞吐为：

$$
\operatorname{throughput}=\frac{N_{out}}{T}
$$

吞吐的单位通常是 output tokens/s 或 requests/s。它是整个服务的总量，不等于某个用户看到的生成速度。一个系统可以通过扩大 batch 提高总吞吐，同时让单条请求排队更久。因此报告性能时至少要同时给出吞吐、TTFT、ITL 和并发数。

continuous batching 还需要解决一个更难的问题：每条请求的 KV cache 长度都不同，并且每轮都在增长。显存无法像固定形状的训练 batch 那样提前整齐分配。

## 4. KV cache 为什么成为并发数的限制

在一层 self-attention 中，第 $t$ 个 token 会产生 key 向量 $k_t$ 和 value 向量 $v_t$。生成后续 token 时，这两条向量会反复使用，因此推理引擎把它们保存在 KV cache 中。

设模型有：

- $L$ 层 Transformer block；
- 每层 $H_{kv}$ 个 KV head；
- 每个 head 的维度为 $D_h$；
- 当前序列已有 $T$ 个 token；
- 每个缓存数值占 $B$ 字节。

一条序列的 KV cache 大小近似为：

$$
M_{KV}=L\times T\times 2\times H_{kv}\times D_h\times B
$$

式子中的 2 来自 key 和 value 两份缓存。$H_{kv}$ 不一定等于 query head 数：使用 grouped-query attention（GQA）的模型会让多个 query head 共享一组 key/value，因此能减小 KV cache。

用一组具体数字计算。假设模型有 32 层、8 个 KV head，每个 head 为 128 维，KV cache 使用 bf16，每个数值 2 字节。每增加一个 token，需要：

$$
32\times2\times8\times128\times2
=131072\ \text{bytes}
=128\ \text{KiB}
$$

一条 8192-token 序列约占：

$$
8192\times128\ \text{KiB}=1\ \text{GiB}
$$

这还不包括模型权重、激活、CUDA graph 和运行时工作区。若 GPU 留给 KV cache 的空间为 16 GiB，理论上也只能同时保存约 16 条这样的完整序列。实际请求长短不一，管理方式还会产生额外浪费。

### 4.1 提前预留会浪费显存

请求到达时不知道最终会生成多少 token。若按最大上下文长度为每条请求预留连续显存，一个只生成 20 token 的请求也可能占据为数千 token 准备的空间。论文把这一部分称为 reservation。

### 4.2 连续空间会产生碎片

请求不断进入和离开后，显存中会出现大小不同的空洞。空闲总量也许足够，但没有一段连续空间能容纳新请求，这叫 external fragmentation。按较大固定区间分配又会让区间尾部未使用，形成 internal fragmentation。

并发服务的限制因此不只是“KV cache 总共多大”，还包括“这些大小不断变化的 cache 怎样分配”。PagedAttention 就从这里开始。

## 5. PagedAttention：逻辑连续，物理上按块存放

PagedAttention 借用了操作系统分页的思路。操作系统让进程看到连续的虚拟地址，而物理内存页可以分散；vLLM 让一条序列看到按 token 顺序排列的逻辑 KV cache，而实际数据可以存放在不连续的显存块中。

假设每个 block 存 4 个 token。一条包含 10 个 token 的请求需要 3 个逻辑块：

| 逻辑块 | token 位置 | 映射到物理块 |
|---:|---|---:|
| 0 | 0–3 | 7 |
| 1 | 4–7 | 1 |
| 2 | 8–9 | 12 |

物理块 7、1、12 不连续。请求保存一张 block table，attention kernel 根据这张表找到每段 key/value。新增 token 时，只在当前块写入；当前块满后，再从空闲池取一个物理块。请求结束后，它使用的块可以分别归还，不必移动其他请求的数据。

按块分配带来三个结果：

1. **不按最大长度预留。** 请求只为已经计算和下一轮将要计算的 token 申请块。
2. **消除大部分外部碎片。** 任意空闲物理块都可以加入一条请求，不要求连续。
3. **内部浪费限制在最后一个块。** 若 block size 为 $S$，一条请求最多浪费 $S-1$ 个 token 的位置，而不是一整段最大上下文。

PagedAttention 不等于“把 KV cache 放进 CPU 虚拟内存”。常规路径中的物理块仍在 GPU 显存中；“paged”描述的是 block table 间接寻址和按块分配。它也不是把注意力的理论复杂度从 $O(T^2)$ 变成 $O(T)$。它首先解决的是 KV cache 的存储与共享，attention kernel 仍需读取当前请求可见的 key/value。

最初的 vLLM 论文在其测试模型和负载上报告：与 FasterTransformer、Orca 等当时的系统相比，在相近延迟水平下吞吐提高 2–4 倍。这个数字是 2023 年论文中的特定实验结果，不应直接当作当前任意模型、GPU 和并发配置下的固定倍数。

## 6. Prefix caching：相同前缀不重复做 prefill

很多请求共享相同开头。例如一个问答服务的每条请求都包含：

1. 同一段 system prompt；
2. 同一份产品手册；
3. 用户各自的问题。

第一次请求已经为 system prompt 和手册计算了 KV cache。后续请求若前缀 token 完全相同，可以复用这些块，只对新的问题部分做 prefill。这叫 **automatic prefix caching**。

vLLM 为每个完整 KV block 计算哈希。一个块的标识不只包含块内 token，还包含父块哈希，因此“相同的 16 个 token 出现在不同前文后”不会被错误地视为同一个前缀。LoRA ID、多模态输入哈希等信息也会加入标识。

prefix caching 减少的是重复 prompt 的 prefill 计算，因此主要改善 TTFT 和 prefill 吞吐。它不能让新生成的 decode token 更快，也不会帮助没有共同前缀的请求。

共享 cache 还有安全边界。攻击者可能通过 TTFT 差异推测某段前缀是否已经缓存。多租户服务可以为请求设置 \`cache_salt\`，让只有使用相同 salt 的请求才能共享前缀块。是否命中缓存不应跨越互不信任的租户边界。

## 7. Chunked prefill：长 prompt 不独占一轮

假设调度器每轮最多处理 2048 个 token，一条新请求有 6000-token prompt。如果一次完成整个 prefill，它要么无法进入当前批次，要么会占用数轮 GPU 时间，使正在 decode 的请求暂停，ITL 随之升高。

chunked prefill 把长 prompt 分成多个片段。例如先处理 2048 token，再处理 2048 token，最后处理 1904 token。每轮剩余预算可以与其他请求的 decode 一起组成 batch：

$$
N_{decode}+N_{prefill}\leq N_{budget}
$$

$N_{decode}$ 是本轮为运行中请求生成的 token 数，$N_{prefill}$ 是本轮接收的 prompt token 数，$N_{budget}$ 对应 \`max_num_batched_tokens\` 一类调度预算。

vLLM V1 在可用时默认启用 chunked prefill，并优先安排已有请求的 decode，再用剩余 token 预算处理 prefill。这样可以减少流式输出停顿，同时把偏带宽瓶颈的 decode 与偏计算瓶颈的 prefill 放进同一批次，提高 GPU 利用率。

代价是调度参数不存在脱离负载的统一最优值。增大 token budget 通常有利于吞吐和长 prompt 的 TTFT，却可能增加每轮执行时间与 ITL；减小预算通常改善交互延迟，但可能让 prefill 分成更多轮。

## 8. Speculative decoding：先猜多个 token，再统一验证

普通 decode 每轮调用一次目标模型，只确认一个新 token。speculative decoding 使用较小的 draft model、模型自带的 multi-token prediction head，或 n-gram 等方法先提出多个候选 token，再让目标模型用一次前向计算并行验证。

假设 draft 一次提出 $d_1,d_2,d_3,d_4$。目标模型检查这些 token 在各位置是否可接受；如果前三个通过而第四个不通过，本轮可以接受前三个，再从目标分布产生替代 token。正确实现会保持目标模型的采样分布，而不是直接采用小模型的输出。

它减少目标模型 decode 轮数，但增加了提议、验证和维护 draft 状态的工作。因此收益取决于：

- draft 与目标模型的接受率；
- 目标模型是否处于显存带宽瓶颈；
- 当前 QPS 和 batch 大小；
- 验证多个 token 的额外计算。

vLLM 文档将其主要定位在中低 QPS、延迟优先、偏显存带宽瓶颈的负载。高并发时，普通 continuous batching 已经能用较大 batch 填满 GPU，额外 draft 计算不一定提高总吞吐。speculative decoding 因此不是默认适合所有服务的开关，必须在真实请求分布上测量。

## 9. 从一张 GPU 扩展到多张 GPU

PagedAttention 和调度解决一张 GPU 内的利用率。如果模型权重放不下一张卡，或单个副本吞吐不足，还需要并行部署。

| 并行方式 | 怎么拆 | 主要用途 | 主要代价 |
|---|---|---|---|
| tensor parallel（TP） | 一层中的矩阵分到多张 GPU | 单卡放不下模型；降低单卡计算量 | 每层需要 GPU 间通信 |
| pipeline parallel（PP） | 不同层分到不同 GPU | 模型跨多卡或多节点 | 流水线空隙与跨阶段通信 |
| data parallel（DP） | 每组 GPU 保存完整模型副本 | 增加独立请求的总吞吐 | 每个副本都占一份权重显存 |
| expert parallel（EP） | MoE 的不同 expert 分到不同 GPU | 稀疏 MoE 模型 | token 路由与 all-to-all 通信 |

TP 和 PP 解决“一个模型副本怎样跨卡”，DP 解决“怎样增加副本数”。例如 8 张 GPU 可以设为 TP=4、DP=2：两组副本各用 4 张卡做 tensor parallel。总 GPU 数近似为各并行维度的乘积，具体组合取决于模型是否能放下、GPU 互联带宽和请求规模。

单机通常优先使用高速互联范围内的 TP；跨节点时，较慢网络会让逐层 TP 通信成本增加，可以按节点划分 PP。vLLM 支持原生 multiprocessing 与 Ray 等分布式执行方式，但“能启动”不代表组合已经合适，仍需观察通信占比和每张卡的显存余量。

## 10. 用 OpenAI 兼容接口启动服务

vLLM 可以直接启动一个兼容 OpenAI API 协议的服务。以官方 quickstart 使用的小模型为例：

\`\`\`bash
vllm serve Qwen/Qwen2.5-1.5B-Instruct
\`\`\`

服务默认监听 \`http://localhost:8000\`。请求格式为：

\`\`\`bash
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen2.5-1.5B-Instruct",
    "messages": [
      {"role": "user", "content": "Explain KV cache in two sentences."}
    ],
    "temperature": 0
  }'
\`\`\`

应用侧可以继续使用支持自定义 \`base_url\` 的 OpenAI 客户端。生产环境还需要明确模型版本、chat template、采样默认值、API 鉴权、并发上限、超时和日志策略。仓库中的 \`generation_config.json\` 可能覆盖部分采样默认值；如果需要稳定基准，应显式固定这些参数。

## 11. 基准测试：先固定负载，再比较引擎

“每秒多少 token”没有脱离实验条件的答案。至少需要固定：

- 模型和权重精度；
- GPU 型号、数量和互联方式；
- prompt 长度与输出长度分布；
- 请求到达率和最大并发数；
- 是否启用 prefix caching、chunked prefill、量化或 speculative decoding；
- TTFT、ITL 的延迟目标。

常见的两种测试回答不同问题：

1. **离线吞吐测试**：所有请求预先存在，调度器尽量填满 GPU。它测系统的处理上限，但不反映排队和真实到达间隔。
2. **在线服务测试**：请求按某个 QPS 或时间分布到达，并报告 TTFT、ITL、端到端延迟的分位数。它更接近用户体验。

只报告平均值会隐藏长尾。例如 p50 TTFT 为 200 ms、p99 为 8 s，说明大多数请求较快，但少数请求在高负载下排队很久。服务容量通常应定义为“在 p99 TTFT 和 p99 ITL 不超过目标时可承受的最大 QPS”，而不是 GPU 完全饱和时的最高 tokens/s。

## 12. 与同类工具的边界

| 工具 | 主要场景 | 硬件与实现侧重 | 适合先研究的问题 |
|---|---|---|---|
| **vLLM** | GPU 高并发在线服务与离线批处理 | 多种 GPU/加速器、PagedAttention、continuous batching | KV cache 管理与服务调度 |
| **llama.cpp** | 个人设备、CPU、Apple Silicon 和边缘端 | C/C++、GGUF、低比特量化、广泛后端 | 模型怎样放进有限内存 |
| **SGLang** | 高性能模型与 agent workload 服务 | RadixAttention、结构化生成、分布式 serving | 前缀复用与复杂生成运行时 |
| **TensorRT-LLM** | NVIDIA GPU 上的深度优化部署 | TensorRT、CUDA kernel 与 NVIDIA 平台集成 | 特定硬件上的编译与 kernel 优化 |
| **Transformers** | 模型参考实现、训练、微调和实验 | PyTorch、模型覆盖面 | 模型结构与算法验证 |

这张表不是速度排名。vLLM 与 SGLang 的结果会随模型、版本、并发和功能组合变化；TensorRT-LLM 的平台范围更窄，但能利用 NVIDIA 专用优化；llama.cpp 在 CPU 和端侧更合适。选择顺序应是先确定硬件、请求分布和延迟目标，再跑同条件基准。

## 13. 限制与排查顺序

vLLM 提高的是资源利用率，不会消除模型本身的成本。实际部署常见的限制包括：

- **显存仍是硬约束。** 权重、KV cache、激活和运行时工作区必须共同放入设备；上下文或并发增加后仍会发生 preemption 或请求排队。
- **吞吐与延迟相互制约。** 较大的 batch 和 token budget 可能提高总吞吐，却增加单轮时间和排队延迟。
- **模型、量化和 attention backend 有兼容矩阵。** 某项功能在一种 GPU 或模型上可用，不表示所有组合都可用。
- **多卡通信可能成为瓶颈。** TP 增加后，每层 collective communication 的比例会上升；跨节点网络尤其需要测量。
- **共享 prefix cache 需要租户隔离。** 对互不信任的请求使用 cache salt，不能只考虑命中率。
- **功能组合需要分别验证。** speculative decoding、量化、LoRA、prefix caching 和分布式并行同时开启时，应先建立单功能基线，再逐项增加。

排查性能时可以沿一条固定顺序：先看模型权重和 KV cache 各占多少显存，再看 scheduler 中运行、等待和被抢占的请求数；随后区分 TTFT 与 ITL，判断问题在 prefill、decode 还是排队；最后再调整 batch token budget、并行方式和可选优化。只看 GPU utilization 很难定位问题，因为 100% 利用率既可能来自有效计算，也可能伴随较高排队延迟。

## 14. 结论

vLLM 把大模型推理从“完成一条生成”改写成“在每一轮有限 token 预算内调度多条生成”。prefill 一次处理多个 prompt token，主要影响 TTFT；decode 每轮为每条序列生成一个 token，主要影响 ITL。continuous batching 让请求可以逐轮进入和退出，提高 GPU 的批处理利用率。

并发数常受 KV cache 限制。PagedAttention 把每条序列的逻辑 KV cache 映射到不连续的物理显存块，按需分配，并把内部浪费限制在最后一个块。prefix caching 复用相同 prompt 前缀的完整 KV block，chunked prefill 防止长 prompt 独占执行轮次，speculative decoding 则尝试用一次目标模型验证多个候选 token。它们优化的阶段和适用负载不同，不能由一个开关统一替代测量。

最终需要同时报告吞吐、TTFT、ITL、并发和请求长度分布。vLLM 的核心价值不是让某一条请求必然更快，而是在延迟目标允许的范围内，让有限 GPU 同时保存并推进更多请求。

## 参考资料

- [vLLM GitHub repository](https://github.com/vllm-project/vllm)
- [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
- [vLLM documentation: Optimization and Tuning](https://docs.vllm.ai/en/stable/configuration/optimization/)
- [vLLM documentation: Automatic Prefix Caching](https://docs.vllm.ai/en/latest/design/prefix_caching/)
- [vLLM documentation: Speculative Decoding](https://docs.vllm.ai/en/latest/features/speculative_decoding/)
- [vLLM documentation: Parallelism and Scaling](https://docs.vllm.ai/en/latest/serving/parallelism_scaling/)
`,
  takeaway: 'vLLM 面向多请求 GPU 服务。prefill 并行处理 prompt，主要影响 TTFT；decode 每轮生成一个 token，主要影响 ITL。continuous batching 让请求逐轮进入和退出，PagedAttention 用 block table 把逻辑连续的 KV cache 映射到不连续显存块，从而按需分配并减少碎片。prefix caching、chunked prefill 和 speculative decoding 分别减少重复 prefill、限制长 prompt 对调度的占用，以及减少目标模型的 decode 轮数。评估时需要同时固定模型、硬件、请求长度和并发，并报告吞吐、TTFT、ITL 与长尾延迟。',
}

export default project
