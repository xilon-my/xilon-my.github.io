const project = {
  slug: 'flashattention',
  date: '2026-08-28 21:00',
  name: 'FlashAttention',
  description: 'FlashAttention 不改变标准 attention 的输出，而是重新安排 Q、K、V 和中间结果在 GPU memory hierarchy 中的流动。本文从三个 score 的数值例子开始，依次解释 dense 与 sparse attention、HBM 与 SRAM、tiling、online softmax、backward recomputation，以及它在训练、prefill 和 decode 中的不同作用。最后区分 KV cache 与 PagedAttention，并梳理 FA1 到 FA4 的演进。',
  tags: ['Inference'],
  url: 'https://github.com/Dao-AILab/flash-attention',
  url2: 'https://arxiv.org/abs/2205.14135',
  stars: '24.8k',
  author: 'Shannon',
  takeaway: 'FlashAttention 不修改 attention 公式，也不删除远距离 token。它把 Q、K、V 切成能放入片上 SRAM 的 tile，逐块计算 score，并用 online softmax 维护每行的 running max、归一化分母和未归一化输出。这样不需要把完整 N×N attention matrix 写入 HBM，forward 的额外存储从平方级降到线性级。它主要优化 attention 的数据移动；KV cache 负责避免重复计算历史 K/V，PagedAttention 负责分配和管理 cache，三者不能相互替代。',
  detail: String.raw`
## 1. 先算一行普通 attention

先不考虑 Q、K 如何产生，假设一个 query 与三个 key 的 scaled score 已经是：

$$
s=[2,1,3]
$$

三个 value 暂时各用一个标量表示：

$$
v=[10,20,30]
$$

softmax 先把三个 score 变成和为 1 的权重：

$$
p_i=\frac{e^{s_i}}{e^2+e^1+e^3}
$$

数值约为：

$$
p=[0.2447,0.0900,0.6652]
$$

attention 输出是 value 的加权和：

$$
O=0.2447\times10+0.0900\times20+0.6652\times30
\approx24.205
$$

这个例子只有一行。推广到一个 attention head，query、key、value 分别记为：

$$
Q,K,V\in\mathbb R^{N\times d}
$$

$N$ 是序列长度，$d$ 是一个 head 的维度。矩阵形式为：

$$
S=\frac{QK^\top}{\sqrt d}+M
$$

$$
P=\operatorname{softmax}(S),\qquad O=PV
$$

$S,P,M\in\mathbb R^{N\times N}$，$O\in\mathbb R^{N\times d}$。$S_{ij}$ 是第 $i$ 个 query 与第 $j$ 个 key 的 score；$M$ 是 mask，不允许访问的位置填 $-\infty$，不使用 mask 时所有元素均为 0；softmax 沿每一行进行。上面的三个数值就是 $S$ 的其中一行。

FlashAttention 仍然计算这个 $O$。它没有删除远距离 token，也没有把 softmax 换成近似函数。变化的是矩阵分块方式、中间结果存放位置和运算顺序。因此论文称它为 exact attention：数学定义与标准 attention 相同。浮点运算的顺序改变后，结果通常只在误差范围内相同，不要求逐 bit 一致。

## 2. 直接实现为什么产生大量显存读写

先考虑最直观的三步实现：

1. 读取 $Q$ 和 $K$，计算 $S=QK^\top/\sqrt d$，把 $S$ 写入 GPU HBM；
2. 从 HBM 读出 $S$，应用 mask 并逐行做 softmax，把 $P$ 写回 HBM；
3. 从 HBM 读出 $P$ 和 $V$，计算 $O=PV$。

HBM 是 GPU 上容量较大但离计算单元较远的显存。GPU 片上还有容量小得多、带宽高得多的 SRAM 和 registers。矩阵乘法的算术通常在片上执行，输入和中间结果却需要从 HBM 搬入、再把结果搬回。

当 $N$ 增大时，$S$ 和 $P$ 都有 $N^2$ 个元素。假设 batch size 为 1、head 数为 32、序列长度 $N=4096$，score 使用 fp16。只保存 $S$ 就需要：

$$
1\times32\times4096^2\times2\ \text{bytes}
=1\ \text{GiB}
$$

如果 $P$ 也单独保存，又需要约 1 GiB。这还是单层 attention 的中间结果，不包括 Q、K、V、输出、模型权重和其他层。

相同配置下，把所有 head 合并后的 hidden size 记为 $d_{model}=4096$。一份 Q 张量的有效数值约占：

$$
4096\times4096\times2\ \text{bytes}
=32\ \text{MiB}
$$

K 和 V 各自也是同一数量级。$N\times N$ 中间矩阵因此会比 $N\times d_{model}$ 输入更快增长。问题不只是“矩阵放不下”，还包括每一步都要把这些矩阵写入和读出 HBM。

## 3. FLOPs 相同，运行时间仍可不同

两段程序可以执行相近数量的浮点运算，却花费不同时间。原因是硬件还要移动数据。

设一项计算执行 $F$ 次浮点运算，从较慢内存传输 $B$ 字节，则算术强度为：

$$
I=\frac{F}{B}
$$

单位是 FLOPs/byte。算术强度较低时，计算单元经常等待数据，性能受内存带宽限制；算术强度较高时，数据能在片上被重复使用，性能才更接近计算单元的峰值。

标准 attention 中两个矩阵乘法 $QK^\top$ 与 $PV$ 适合 GPU，但若把中间的 $S$、$P$ 完整写回 HBM，再逐步读回，数据移动会占用可见时间。FlashAttention 的出发点是 IO-aware：设计计算顺序时，同时计算 FLOPs 与各层内存之间的读写量。

![FlashAttention 原论文 Figure 1：GPU memory hierarchy 与 tiled attention](/images/flashattention/figure-1-full-02.png)

图中左侧的 memory hierarchy 表示 SRAM 容量较小但带宽高，HBM 容量较大但访问成本更高；中间的虚线框表示完整的 $N\times N$ attention matrix 不需要被物化到 HBM。外层循环搬运 K、V 的 tile，内层循环搬运 Q 的 tile，在 SRAM 中完成局部 score、softmax 和 value 累加。写回 HBM 的是每行统计量与 partial output，而不是 score 或 probability tile。图中的容量与带宽是论文所用硬件的示例，不是所有 GPU 的固定参数。图片截自 [FlashAttention 原论文 Figure 1](https://arxiv.org/abs/2205.14135)。

因此“FlashAttention 更快”不来自更少的 attention 配对。它允许在片上多做一些重算，只要能换来更少的 HBM 访问。GPU 上一次额外的算术操作，可能比一次不必要的 HBM 往返成本更低。

## 4. Tiling：一次只处理能放进 SRAM 的小块

设 SRAM 一次只能容纳部分 Q、K、V。FlashAttention 沿序列维切块：

- Q tile 含 $B_r$ 行 query；
- K/V tile 含 $B_c$ 行 key 和 value；
- 每次只计算一个 $B_r\times B_c$ score tile。

第 $i$ 个 Q tile 与第 $j$ 个 K tile 产生一个局部 score matrix：

$$
S_{ij}=Q_iK_j^\top
$$

这个 $B_r\times B_c$ 小矩阵在 SRAM 中产生，参与 softmax 与 value 加权后即可丢弃，不需要写成完整的 $N\times N$ 矩阵。

初代论文的 forward algorithm 把 K/V block 放在外层循环，以便一个已经载入 SRAM 的 K/V block 服务多个 Q block。把不影响主线的细节省略后，执行顺序是：

~~~text
initialize O, row max m, and denominator l

for each K/V block j:
    load K block j and V block j into SRAM

    for each Q block i:
        load Q block i and its current O, m, l
        scores = Q block i × K block jᵀ
        update m and l with online softmax
        update O with V block j
        write updated O, m, l back
~~~

不同版本会改变 block 与 warp 的划分，但有一个共同约束：局部 $S_{ij}$ 和 probability tile 不写入 HBM。具体 block size 由 head dimension、dtype、SRAM 容量、register pressure 和硬件调度共同决定，不是独立于 GPU 的固定常数。

现在出现一个问题：softmax 的分母需要一整行的所有 score，第一块计算结束时还没看到后面的块。online softmax 解决这一点。

## 5. 稳定 softmax 为什么需要最大值

对一行 score $s_1,\dots,s_N$，softmax 为：

$$
p_i=\frac{e^{s_i}}{\sum_{k=1}^{N}e^{s_k}}
$$

较大的 $s_i$ 直接取指数可能溢出。通常先减去这一行的最大值：

$$
m=\max_i s_i
$$

$$
p_i=\frac{e^{s_i-m}}{\sum_{k=1}^{N}e^{s_k-m}}
$$

分子和分母同时乘 $e^{-m}$，比例没有变化。最大的指数现在是 $e^0=1$，其余指数不超过 1，数值更稳定。

若整行一次存在内存中，先求 $m$，再求分母即可。分块之后，每个 tile 只有局部最大值。后来读到的新 tile 可能出现更大的 score，前面已经累加的指数必须按新的最大值重新缩放。

## 6. Online softmax 的三个状态

对一行 query，处理若干 score 后，只需维护三个状态：

- $m$：已经见过的 score 最大值；
- $\ell$：以 $m$ 为基准的 softmax 分母；
- $o$：以 $m$ 为基准、尚未除以分母的 value 加权和。

其定义为：

$$
m=\max_{k\in\mathcal A}s_k
$$

$$
\ell=\sum_{k\in\mathcal A}e^{s_k-m}
$$

$$
o=\sum_{k\in\mathcal A}e^{s_k-m}v_k
$$

$\mathcal A$ 是已经处理的位置集合。最终 attention 输出为：

$$
O=\frac{o}{\ell}
$$

现在加入一个新 tile。旧状态为 $(m_{old},\ell_{old},o_{old})$，新 tile 自己的局部状态为 $(m_b,\ell_b,o_b)$。合并后的最大值为：

$$
m_{new}=\max(m_{old},m_b)
$$

旧累计值原本以 $m_{old}$ 为基准，需要乘：

$$
e^{m_{old}-m_{new}}
$$

新 tile 则乘 $e^{m_b-m_{new}}$。因此：

$$
\ell_{new}
=e^{m_{old}-m_{new}}\ell_{old}
+e^{m_b-m_{new}}\ell_b
$$

$$
o_{new}
=e^{m_{old}-m_{new}}o_{old}
+e^{m_b-m_{new}}o_b
$$

这两项正是把不同局部最大值下的指数重新换算到同一个 $m_{new}$。每个 tile 处理结束后，只保留 $m$、$\ell$ 和 $o$，局部 score 可以丢弃。

## 7. 把第一节的三个 score 分成两块

第一节一次看到了 $s=[2,1,3]$。现在模拟 FlashAttention 的分块过程：第一块包含 score $[2,1]$ 与 value $[10,20]$，第二块包含 score 3 与 value 30。目标仍然是得到第一节的 $O\approx24.205$。

### 7.1 第一块

第一块 score 是 $[2,1]$，因此：

$$
m_1=2
$$

$$
\ell_1=e^{2-2}+e^{1-2}
=1+e^{-1}
\approx1.3679
$$

$$
o_1=e^{2-2}\times10+e^{1-2}\times20
\approx17.3576
$$

### 7.2 第二块到达后重新缩放

第二块只有 score 3 和 value 30：

$$
m_b=3,\qquad \ell_b=1,\qquad o_b=30
$$

新的全局最大值变成 3。第一块累计值要乘 $e^{2-3}=e^{-1}$：

$$
\ell_2=e^{-1}\times1.3679+1
\approx1.5032
$$

$$
o_2=e^{-1}\times17.3576+30
\approx36.3850
$$

最终输出为：

$$
O=\frac{36.3850}{1.5032}\approx24.205
$$

直接对 $[2,1,3]$ 做完整 softmax，再乘 $[10,20,30]$，得到同一个结果。后面的最大值从 2 增加到 3 时，前一块没有重算各个 score；只需整体缩放已有分母和输出累加器。

真实 value 是 $d$ 维向量，所以 $o$ 也是 $d$ 维；$m$ 与 $\ell$ 对每个 query row 各保存一个标量。额外状态随 $N$ 线性增长，而不是保存 $N\times N$ 概率矩阵。

## 8. Dense、sparse 与 causal attention

### 8.1 Dense attention

dense attention 中，每个 query 都与允许范围内的全部 key 计算 score。若忽略 mask，长度为 $N$ 的序列共有 $N^2$ 个 query-key 配对。FlashAttention 默认优化的就是这种标准 dense attention：配对数量仍是平方级，只是不把完整 score 和 probability matrix 写入 HBM。

### 8.2 Sparse attention

sparse attention 预先规定每个 query 只访问一部分 key。以长度为 6、窗口宽度为 3 的 local attention 为例，第 4 个 token 只查看第 2、3、4 个 token。把第 $i$ 个 query 允许访问的 key 下标集合记为 $\Omega_i$，则：

$$
O_i=\sum_{j\in\Omega_i}
\frac{\exp(S_{ij})}{\sum_{k\in\Omega_i}\exp(S_{ik})}V_j
$$

$\Omega_i$ 的存在表示并非所有 key 都参与这一行的 softmax。常见模式包括 local window、按块指定连接关系的 block sparse，以及让少数 token 查看全局的 global token。

若每个 query 只访问固定宽度 $w$ 的窗口，配对数约为 $Nw$。当 $w$ 不随 $N$ 增长时，它对序列长度近似为线性复杂度。代价是 attention 的数学定义发生了变化：窗口外的信息不能在同一层直接参与输出。

仅在已经算出的 $N\times N$ score matrix 上添加 mask，不会自动减少计算。实现还需要 sparse kernel 跳过被屏蔽的 block，才能减少实际运算和数据移动。FlashAttention 与 sparse attention 因此是两个维度：前者安排数据流，后者决定哪些配对存在。项目也可以为 block-sparse 模式实现 FlashAttention 风格的 kernel。

### 8.3 Causal mask 怎样进入 tile

decoder-only 模型的 causal attention 要求第 $i$ 个 query 只能读取 $j\le i$ 的 key。标准实现会给未来位置加 $-\infty$，使其 softmax 权重为 0。

分块后有三类 tile：

1. **完全位于因果对角线左下方**：所有位置都可见，正常计算；
2. **与对角线相交**：只对 tile 内满足 $j\le i$ 的元素计算有效 softmax；
3. **完全位于对角线右上方**：整个 tile 都是未来位置，可以直接跳过。

跳过第三类 tile 减少了 causal attention 的无效工作。它没有改变 causal attention 的定义，因为这些位置原本就被 $M$ 屏蔽。虽然有效配对约为完整矩阵的一半，数量仍随 $N^2$ 增长。

padding mask、局部窗口和 ALiBi 等额外约束也可以在 score tile 内应用，但 kernel 是否支持某种组合取决于实现版本。数学上能写进 mask，不表示当前硬件 kernel 已提供对应路径。

## 9. Backward 为什么选择重算

训练的 backward 需要 softmax probability。普通实现可以在 forward 保存完整 $P$，但它占 $O(N^2)$ 内存。FlashAttention forward 只保存输出 $O$ 和每行 softmax 的归一化统计量，例如 log-sum-exp：

$$
L_i=\log\sum_j e^{S_{ij}}
$$

backward 再按相同 tile 顺序重新计算局部 $S$ 和 $P$，随后得到 $dQ$、$dK$、$dV$。这增加了一部分 FLOPs，却避免读取和保存完整 attention matrix。

这是一种明确的交换：

$$
\text{more recomputation}
\quad\longleftrightarrow\quad
\text{less HBM traffic and memory}
$$

在 GPU 上，额外矩阵运算可以由吞吐较高的计算单元执行，而减少 HBM 访问同时降低内存占用和数据等待。FlashAttention 论文的重点因此不只是 forward kernel，也包括让 backward 在不保存平方级中间结果的情况下运行。

不要把这种重算与 gradient checkpointing 混为一项。gradient checkpointing 通常在 Transformer layer 或子层尺度丢弃 activation，backward 时重做整段 forward；FlashAttention backward 是 attention kernel 内部针对 score/probability tile 的重算。两者可以同时使用。

## 10. Prefill 与 decode 中的作用不同

prefill 时，长度为 $N$ 的 prompt 同时产生 $N$ 个 query，attention 逻辑上包含 $N\times N$ score。FlashAttention 不保存完整矩阵，因此对长 prompt 的显存和 HBM 流量影响明显。

自回归 decode 时，每一步通常只有一个新 query：

$$
Q_{new}\in\mathbb R^{1\times d}
$$

它读取长度为 $T$ 的 KV cache，score 只有 $1\times T$。这里本来就没有新的 $T\times T$ attention matrix，主要成本转为读取历史 K/V、调度不同长度序列，以及让小 query batch 有足够并行度。

因此一个模型“启用了 FlashAttention”不能单独说明 decode tokens/s 会提高多少。prefill、训练 forward/backward 与 decode 使用不同形状和 kernel。应分别报告 prompt tokens/s、TTFT、output tokens/s 与 token 间延迟。

Flash-Decoding、split-KV 等 decode kernel 会把一个长 KV sequence 分给多个 thread block，再合并局部 softmax 状态。它们仍使用 online softmax 的可合并结构，但并行问题与大矩阵 prefill 不同。

## 11. FlashAttention、KV cache 与 PagedAttention 的边界

这些技术经常同时出现，但处理不同问题：

| 技术 | 主要问题 | 保存或改变什么 |
|---|---|---|
| FlashAttention | attention 中间矩阵产生过多 HBM IO | tile 内计算 score/softmax，不保存完整 $N\times N$ 矩阵 |
| Sparse attention | query-key 配对数随序列平方增长 | 只保留集合 $\Omega_i$ 中的配对，改变连接模式 |
| Linear attention | 标准 attention 的配对计算为平方级 | 修改 attention 的数学形式 |
| KV cache | decode 反复重算历史 token 的 K/V | 保存每层历史 K 和 V |
| PagedAttention | 多请求、变长 KV cache 难以连续分配 | 把逻辑 cache 映射到不连续物理 block |

FlashAttention 不会消除 KV cache。decode 仍需要历史 K/V，只是 attention kernel 以更合适的方式读取它们。PagedAttention 也不替代 online softmax；它主要改变 K/V 的地址组织，kernel 需要根据 block table 找到各段 cache。

同样，FlashAttention 不等于 linear attention。linear attention 会修改或重排 attention 的数学形式，目标是避免标准 $N^2$ 配对；FlashAttention 保留标准 softmax attention 的配对数量，重点是减少数据移动和中间存储。

## 12. 从 FlashAttention-1 到 FlashAttention-4

初代 FlashAttention 建立了 tiling 与 IO-aware exact attention。后续版本没有推翻 online softmax，而是随硬件和已暴露的瓶颈调整并行划分、流水线与实现语言。

**FlashAttention-1** 解决的是完整 attention matrix 反复进出 HBM 的问题。它用 tiling 与 online softmax 保留 exact attention，并在 backward 中重算 tile，换取线性级额外存储。

**FlashAttention-2** 主要做三件事：减少非矩阵乘法 FLOPs；在 sequence 维增加 thread block 并行度，使 batch size 或 head 数较小时仍有足够 occupancy；重新划分 warp 工作，减少 shared memory 通信。论文在 A100 上报告相对初代约 2 倍的 kernel 加速，并达到理论峰值 FLOPs 的 50%–73%。这些是论文中的特定硬件和形状结果，不是所有模型的固定倍数。

**FlashAttention-3** 面向 Hopper GPU。它使用 warp specialization 让一部分 warp 搬运数据、另一部分执行矩阵乘法，并利用 TMA 与 Tensor Core 的异步能力重叠数据移动和计算；还把矩阵乘法与 softmax 的执行交错，减少等待。FP8 路径加入 block quantization 和改善数值误差的处理。论文在 H100 上报告 FP16 最高 740 TFLOPs/s，以及相对 FlashAttention-2 的 1.5–2.0 倍加速。

**FlashAttention-4** 面向 Hopper 与 Blackwell，并以 Blackwell B200 的硬件变化为主要设计背景。B200 的 matrix multiply 吞吐提升快于 shared memory 和 exponential unit，瓶颈因此从矩阵乘法转向 shared-memory traffic 与 softmax 中的指数运算。FA4 使用更大的 tile、异步 MMA pipeline、条件 softmax rescaling，以及在 FMA 单元上近似计算指数；backward 还利用 tensor memory 与 2-CTA MMA 减少 shared-memory traffic 和 atomic add。实现从 CUDA C++ template 转为嵌入 Python 的 CuTe-DSL。论文在 B200、BF16 的特定设置下报告最高 1613 TFLOPs/s；这一数字不能外推到其他硬件。

版本数字不能脱离硬件理解。FA3 的 Hopper 路径不会让 A100 获得相同机制，FA4 针对 Blackwell 的优化也不表示所有 GPU 都应选择它。框架还可能根据 GPU、dtype、head dimension、mask 与 dropout 条件回退到其他 kernel。真正运行的是哪个 backend，应由 profiler、框架日志或 kernel trace 确认。

## 13. 怎样验证正确性与性能

正确性检查应先固定一组较小张量，用 reference attention 与 flash kernel 比较：

$$
O_{ref}=\operatorname{softmax}(QK^\top/\sqrt d+M)V
$$

$$
O_{flash}=\operatorname{FlashAttention}(Q,K,V,M)
$$

然后检查：

$$
\max|O_{ref}-O_{flash}|
$$

误差阈值要与 dtype 和硬件对应。fp16、bf16、fp8 使用同一绝对阈值通常不合理。训练还要比较 $dQ$、$dK$、$dV$，并对 dropout 使用相同随机约定或直接关闭 dropout。

至少覆盖以下形状：

- sequence length 小于、等于和大于 tile size；
- causal 与 non-causal；
- 长度不能整除 tile size 的尾块；
- 不同 head dimension；
- MHA、GQA 或 MQA 的实际布局；
- padding 或 variable-length batch；
- 数值幅度较大的正负 score，检查 online max rescaling。

性能测试则要预热 kernel，固定 dtype、batch、head 数、head dimension 和 sequence length，并分别报告 forward、backward 与端到端模型时间。只比较 kernel latency，不能直接推导训练 step 或在线服务会获得同样比例的改进，因为 attention 之外还有 projection、MLP、通信和调度。

![FlashAttention 原论文 Figure 2：HBM 访问、运行时间与 block-sparse speedup](/images/flashattention/figure-2-06.png)

Figure 2 左侧给出一个具体对比：standard attention 执行 66.6 GFLOPs、读写 40.3 GB HBM、耗时 41.7 ms；FlashAttention 执行 75.2 GFLOPs、读写 4.4 GB HBM、耗时 7.3 ms。这里 FlashAttention 的 FLOPs 更多，运行时间却更短，说明减少 HBM traffic 可以抵消额外重算。中间显示 block size 增大后 HBM access 与 runtime 的变化，右侧显示 block-sparse FlashAttention 随非零 block 比例变化的 runtime。这些数值来自论文在 A100 和 GPT-2 medium 设置下的实验，不能直接当作其他 GPU 或模型的固定收益。图片截自 [FlashAttention 原论文 Figure 2](https://arxiv.org/abs/2205.14135)。

## 14. 常见误解

**“FlashAttention 把 attention 从 $O(N^2)$ 变成 $O(N)$。”** 不对。forward 不再保存平方级 score/probability matrix，额外存储变为线性级；标准 attention 的配对计算仍是平方级。

**“Exact attention 表示输出逐 bit 相同。”** 不对。exact 表示没有用 sparse、low-rank 或 linear attention 改写数学目标。tile 合并顺序、低精度 dtype 和指数函数实现仍会产生浮点误差；FA3 的 FP8 路径与 FA4 的 polynomial exponential 还需要各自的数值误差分析。

**“它只是一组 fused kernels。”** kernel fusion 是实现手段之一，但关键是 online softmax 让 tile 可以独立产生并合并行统计量，否则仍需保存整行 score。

**“显存省下来了，所以任何模型都会按相同比例加速。”** 不对。模型可能受 MLP、通信、KV cache 或小 batch 调度限制；短序列的 attention matrix 也可能本来就不是主要成本。

**“用了 PagedAttention 就不需要 FlashAttention。”** 不对。前者管理 KV cache block，后者减少 attention 计算中的 HBM IO。服务系统可以同时需要两者。

## 15. 结论

标准 attention 的三个公式会自然产生 $N\times N$ score 和 probability matrix。若按公式逐步写成独立 kernel，这些中间矩阵需要多次进出 HBM。序列增长后，运行时间和显存都会受到数据移动影响。

FlashAttention 把 Q、K、V 切成能放入 SRAM 的 tile。每个 score tile 在片上产生，通过 online softmax 更新 running max、归一化分母和未归一化 value 加权和，随后即可丢弃。新的 tile 出现更大 score 时，旧累计量乘指数因子换到新的最大值基准，因此最终结果仍等于整行 softmax。

这套方法把 attention 的优化问题从“少做哪些配对”转成“怎样安排相同配对的数据流”。FA2 改进并行划分与 warp 分工，FA3 针对 Hopper 重排异步执行，FA4 根据 Blackwell 上新的资源比例重新设计 pipeline。评估时仍需区分训练、prefill 与 decode，并把 FlashAttention、sparse attention、KV cache 和 PagedAttention 放在各自的问题层级中。

## 参考资料

- [FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness](https://arxiv.org/abs/2205.14135)
- [FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning](https://arxiv.org/abs/2307.08691)
- [FlashAttention-3: Fast and Accurate Attention with Asynchrony and Low-precision](https://arxiv.org/abs/2407.08608)
- [FlashAttention-4: Algorithm and Kernel Pipelining Co-Design for Asymmetric Hardware Scaling](https://arxiv.org/abs/2603.05451)
- [Dao-AILab/flash-attention](https://github.com/Dao-AILab/flash-attention)
- [Online normalizer calculation for softmax](https://arxiv.org/abs/1805.02867)
- [Efficient Memory Management for Large Language Model Serving with PagedAttention](https://arxiv.org/abs/2309.06180)
`,
}

export default project
