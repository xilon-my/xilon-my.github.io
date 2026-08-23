const article = {
  slug: 'gpt2-moe-pretrain',
  date: '2026-08-22 09:00',
  name: '从下一个 token 到稀疏专家：预训练一个 775M MoE',
  description: '从一个 prompt 如何变成下一个 token 开始，解释自回归预训练、原始 Transformer/GPT-2 到 LLaMA 范式的架构演进，再落到 8-expert/top-2 MoE 的数据、训练、评测与路由诊断。',
  tags: ['Inference'],
  category: 'Model Pretraining',
  author: 'shannon',
  takeaway: '语言模型训练的核心任务始终是预测下一个 token；现代 LLaMA 范式改变的是完成这项任务的内部结构和效率。本项目使用 RoPE、RMSNorm、SwiGLU、GQA 与 top-2 MoE，在单张 RTX 5090 上训练 5B tokens，得到 775.0M 总参数、265.4M active parameters 的模型，最终 val loss 2.834。九项评测说明它已学到可测量能力，同时也暴露出 LAMBADA 差距和专家负载不均衡。',
  detail: String.raw`

## 1. 语言模型最初在做什么

语言模型的目标是：给定已经出现的 token，估计下一个 token 的概率。

对于序列 $x_1,x_2,\ldots,x_T$，联合概率按条件概率展开为：

$$
P(x_{1:T})=\prod_{t=1}^{T}P(x_t\mid x_{<t})
$$

这就是自回归分解。它不是 Transformer 才有的概念；n-gram、RNN、GPT 和 LLaMA 都可以使用同一个目标，区别在于如何表示 $x_{<t}$。

### 1.1 n-gram：只看固定窗口

以 trigram 为例，它近似认为下一个词只依赖前两个词：

$$
P(x_t\mid x_{<t})\approx P(x_t\mid x_{t-2},x_{t-1})
$$

这些概率由语料计数得到。如果 “capital of France” 出现很多次，模型就会提高 France 在 “capital of” 后面的概率。问题是上下文窗口固定、未见组合难以估计，参数也不能在相似词之间共享。

### 1.2 RNN/LSTM：把历史压进一个状态

RNN 按时间顺序更新隐藏状态：

$$
h_t=f(W_xe_t+W_hh_{t-1}),\qquad P(x_{t+1})=\operatorname{softmax}(W_oh_t)
$$

$e_t$ 是当前词向量，$h_{t-1}$ 概括此前历史。它可以处理可变长度上下文，但 token 必须一个接一个计算；长距离信息还要反复穿过同一个隐藏状态。LSTM 用门控缓解梯度消失，却没有消除训练的串行依赖。

### 1.3 Transformer：让每个位置直接读取历史位置

2017 年的 Transformer 用 self-attention 替代循环。训练时所有位置可以并行形成 query、key、value；任意两个位置之间只需一次 attention 就能交换信息。

![原始 Transformer encoder-decoder 架构，Figure 1](/images/gpt2-moe/transformer-figure-1.png)

*图源：[Attention Is All You Need, Figure 1](https://arxiv.org/abs/1706.03762)，Vaswani et al., 2017。原论文图。*

原始模型是机器翻译用的 encoder-decoder：encoder 双向读取源语言，decoder 用 masked self-attention 生成目标语言，并通过 cross-attention 读取 encoder。后来的 GPT 去掉 encoder 与 cross-attention，只保留 decoder 式 causal Transformer，用统一的 next-token prediction 在大规模文本上预训练。

## 2. 以 GPT-2 为基线：早期 Transformer LLM 的结构

本文不把原始 Transformer 直接当作 GPT。真正用于后续逐项对照的基线是 GPT-2，因为它已经具备今天 causal LLM 的骨架：decoder-only、token embedding、causal self-attention、MLP、residual stream 和 next-token LM head。

一个 GPT-2 block 可以概括为：

$$
H' = H + \operatorname{MHA}(\operatorname{LayerNorm}(H))
$$

$$
H^{\mathrm{next}} = H' + \operatorname{MLP}_{\mathrm{GELU}}(\operatorname{LayerNorm}(H'))
$$

GPT-2 使用 learned absolute position embedding、multi-head attention、LayerNorm 和 GELU MLP。它已经采用 Pre-LayerNorm，而 2017 原始 Transformer 使用 Post-LayerNorm。这个区别很重要：现代 LLaMA 不是第一次把 normalization 放到子层之前，而是进一步把 LayerNorm 换成 RMSNorm。

下面拿一条具体输入把 GPT-2 的 forward、训练和生成顺一遍。为了让矩阵可手算，示例把真实模型维度缩小；计算顺序与真实 GPT-2 相同。

## 3. 一条 prompt 在 GPT-2 中如何计算

输入文本：

> The capital of France is

GPT-2 的 byte-level BPE tokenizer 先把文本切成 token。这个句子可以理解为 The、␠capital、␠of、␠France、␠is，其中前导空格也是 token 的一部分。tokenizer 再把每个 token 映射成整数 id。

下面只追踪最后一个 token ␠is，观察模型怎样根据它前面的上下文预测 ␠Paris。真实 GPT-2 会同时处理序列中的所有位置，计算过程相同。

### 3.1 Token embedding 与位置

模型不能直接计算整数 id，因此先从 token embedding 表中查出向量。GPT-2 还为每个位置保存一条 learned position embedding：

$$
h_t^{(0)}=E_{tok}[x_t]+E_{pos}[t]
$$

第一项表示 token 是什么，第二项表示它出现在第几个位置。两者相加后，France 出现在第 4 个位置和出现在第 20 个位置会得到不同的初始表示。

经过这一步，每个 token 都变成一条连续向量，但不同 token 之间还没有交换信息。

### 3.2 Self-attention：让 is 读取前文

GPT-2 先对 hidden states 做 LayerNorm，再通过三个线性投影产生 query、key 和 value：

$$
Q=HW_Q,\qquad K=HW_K,\qquad V=HW_V
$$

可以把三者理解为：

- query：当前位置想寻找什么信息；
- key：每个位置提供什么匹配线索；
- value：匹配成功后真正取回什么内容。

attention 的完整公式是：

$$
\operatorname{Attention}(Q,K,V)
=\operatorname{softmax}\left(\frac{QK^\top}{\sqrt{d_h}}+M\right)V
$$

$QK^\top$ 计算每个 query 与每个 key 的相似度。除以 $\sqrt{d_h}$ 是为了避免维度增大后点积过大，使 softmax 进入梯度很小的饱和区域。$M$ 是 causal mask：当前位置只能读取自己和左侧 token，未来位置被加上 $-\infty$，softmax 后权重变成 0。

对最后一个 token ␠is 来说，The、capital、of、France 和 is 都可见。下面用一个二维 attention head 演示分数的实际计算。假设 ␠is 的 query 为：

$$
q_{is}=[1,1]
$$

五个 token 的 keys 为：

$$
K=\begin{bmatrix}
1&0\\
0&1\\
0.5&0.5\\
1&1\\
0&0.5
\end{bmatrix}
$$

先让 query 分别与五个 keys 做点积：

$$
q_{is}K^\top
=[1\times1+1\times0,\
1\times0+1\times1,\
1\times0.5+1\times0.5,\
1\times1+1\times1,\
1\times0+1\times0.5]
$$

$$
q_{is}K^\top=[1,\ 1,\ 1,\ 2,\ 0.5]
$$

这个简化 head 的维度 $d_h=2$，因此再除以 $\sqrt2$：

$$
s=\frac{q_{is}K^\top}{\sqrt2}
=\frac{[1,\ 1,\ 1,\ 2,\ 0.5]}{\sqrt2}
\approx[0.71,\ 0.71,\ 0.71,\ 1.41,\ 0.35]
$$

这五个值才是送入 softmax 的 attention scores。由于 ␠is 是当前最后一个 token，没有已有位置需要被 causal mask 屏蔽。softmax 后得到：

$
\exp(s)\approx[2.03,\ 2.03,\ 2.03,\ 4.10,\ 1.42]
$

指数之和约为：

$
2.03+2.03+2.03+4.10+1.42=11.61
$

因此逐项除以 11.61：

$
a=\operatorname{softmax}(s)
\approx[0.18,\ 0.18,\ 0.18,\ 0.35,\ 0.12]
$

这个 head 给 France 的权重最大。若五个位置的 value 分别为 $v_0,\ldots,v_4$，输出就是：

$
o=0.18v_0+0.18v_1+0.18v_2+0.35v_3+0.12v_4
$

这里的数字只演示一次 attention 加权，不是训练后模型的真实权重。真实 GPT-2 使用多个 heads：一个 head 可以关注 France，另一个可以关注 capital of 这个句式。各 head 输出拼接后再做一次线性投影。

attention 输出通过 residual connection 加回原表示：

$$
h'=h+\operatorname{MHA}(\operatorname{LN}(h))
$$

这样模型既保留原 token 表示，也加入从上下文读取的信息。

### 3.3 GELU MLP：变换当前位置的特征

attention 负责 token 之间的信息交换；MLP 对每个位置独立做非线性变换：

$$
\operatorname{MLP}(h')
=W_2\operatorname{GELU}(W_1h'+b_1)+b_2
$$

第一层先把表示投影到更宽的中间空间，GELU 决定哪些特征以多大程度通过，第二层再投影回 residual stream。随后再次做 residual connection：

$$
h^{next}=h'+\operatorname{MLP}(\operatorname{LN}(h'))
$$

LayerNorm、attention、MLP 和两条 residual connection 构成一个 GPT-2 block。GPT-2 Large 重复 36 层，使 ␠is 的表示逐层整合词义、位置、句法和前文信息。

### 3.4 LM head：让所有 token 竞争

最后一层之后，模型把 hidden state 投影到整个词表：

$$
z=h^{(L)}W_{vocab}^\top
$$

$z_i$ 是候选 token $i$ 的 logit。softmax 将 logits 变成概率：

$$
P(i\mid x_{\le t})
=\frac{\exp(z_i/T)}{\sum_j\exp(z_j/T)}
$$

温度 $T$ 控制分布的平缓程度。模型不是直接输出字符串 Paris，而是给词表里的每个 token 一个分数。如果 ␠Paris 的概率最高，greedy decoding 会选中它；sampling 则按处理后的概率分布抽取。

### 3.5 从一次 forward 到连续生成

选中 ␠Paris 后，序列变成：

> The capital of France is Paris

模型再根据这段新上下文预测下一个 token，例如句号。这个循环不断重复：

$$
x_{1:t}\rightarrow P(x_{t+1}\mid x_{1:t})
\rightarrow \hat x_{t+1}
\rightarrow x_{1:t+1}
$$

训练和生成使用同一个条件概率模型。训练时真实的下一个 token 已知，可以通过 teacher forcing 并行计算所有位置；生成时答案未知，只能把模型刚选出的 token 追加回来，逐步继续。

KV cache 会保存历史 token 在每层已经计算好的 key 和 value。生成新 token 时只需计算新增位置的 Q/K/V，再让新 query 查询历史 cache，不必每一步重算整个前缀。


### 3.6 Forward 之后：梯度怎样反向传播

forward 得到词表概率后，训练会把它与真实下一个 token 比较。设模型预测分布为 $p$，真实 token 的 one-hot 向量为 $y$，交叉熵为：

$$
\mathcal L=-\sum_i y_i\log p_i
$$

softmax 与交叉熵合在一起求导后，logits 的梯度有一个直接形式：

$$
\frac{\partial\mathcal L}{\partial z}=p-y
$$

这说明更新方向来自预测概率与真实标签之间的差。例如真实 token 是 ␠Paris：Paris 的梯度分量是 $p_{Paris}-1$，会推动它的 logit 上升；其他 token 的分量是 $p_i$，会推动这些错误候选的 logit 下降。

接下来使用链式法则，梯度沿 forward 的相反方向传递：

$$
\text{loss}
\rightarrow \text{LM head}
\rightarrow \text{第 36 层}
\rightarrow \cdots
\rightarrow \text{第 1 层}
\rightarrow \text{embeddings}
$$

在每个 block 内，梯度分别流经 MLP 和 attention，计算 $W_1$、$W_2$、$W_Q$、$W_K$、$W_V$、$W_O$ 等参数应怎样改变。矩阵乘法 $Y=XW$ 的基本反向关系是：

$$
\frac{\partial\mathcal L}{\partial W}=X^\top\frac{\partial\mathcal L}{\partial Y},
\qquad
\frac{\partial\mathcal L}{\partial X}=\frac{\partial\mathcal L}{\partial Y}W^\top
$$

residual connection 还提供一条直接路径。若 $y=x+f(x)$，那么：

$$
\frac{\partial\mathcal L}{\partial x}
=\frac{\partial\mathcal L}{\partial y}
+\frac{\partial\mathcal L}{\partial y}\frac{\partial f}{\partial x}
$$

第一项不需要穿过 attention 或 MLP，这有助于梯度传过很多层。backward 最终只计算梯度，并不直接修改参数；AdamW 会在随后一步利用这些梯度、动量和学习率更新权重。

## 4. GPT-2 如何训练，又如何逐 token 生成

训练文本可以是：

> The capital of France is Paris .

输入与标签整体错开一位：

| 输入 | 该位置的真实标签 |
|---|---|
| The | ␠capital |
| ␠capital | ␠of |
| ␠of | ␠France |
| ␠France | ␠is |
| ␠is | ␠Paris |
| ␠Paris | ␠. |

causal mask 使每个位置只能读取左侧，但训练时所有位置可以一次并行 forward。模型使用真实前缀而非自己的历史预测，这叫 teacher forcing。交叉熵为：

$$
\mathcal L=-\frac1{T-1}\sum_{t=1}^{T-1}\log P_\theta(x_{t+1}\mid x_{\le t})
$$

如果正确 token Paris 的预测概率为 0.20，该位置 loss 是 $-\log0.20\approx1.61$；如果只有 0.001，loss 约为 6.91。backward 根据 loss 对每个参数求梯度，AdamW 再更新 embedding、attention、MLP、normalization 与 LM head。

训练和生成都是自回归模型。差别是执行方式：

- **训练**：真实后续 token 已知，用 teacher forcing 并行计算所有位置。
- **生成**：真实后续 token 未知，只能选出一个 token，追加到输入，再预测下一个。

生成 Paris 后，输入变成 “The capital of France is Paris”，模型再运行一次预测句号或其它 token。KV cache 保存历史 token 在各层的 K/V，使下一步不必重算全部历史。

到这里，GPT-2 基线已经完整：它知道如何表示 token 和位置，如何读取历史，如何经 MLP 变换，如何计算 next-token loss，也知道如何逐 token 解码。现代 LLaMA 范式没有改变这个目标，而是逐项替换内部组件。

## 5. 现代 LLaMA 范式：逐项替换 GPT-2

| 模块 | GPT-2 基线 | 现代方案 | 主要目的 |
|---|---|---|---|
| 位置 | learned absolute embedding | RoPE | 直接在 attention 中表达相对位置 |
| 归一化 | LayerNorm | RMSNorm | 简化归一化计算 |
| FFN | GELU MLP | SwiGLU | 用门控调节特征通路 |
| attention | MHA | GQA | 减少 KV cache 与读取带宽 |
| FFN 容量 | dense | 可选 sparse MoE | 分离总容量与单 token 激活计算 |

下面每项都沿用同一顺序：旧方案怎么算、限制是什么、新方案怎么算、代价是什么。

### 5.1 绝对位置 embedding 与 RoPE

**GPT-2 的计算。** GPT-2 直接把 $P[t]$ 加到 token embedding：

$$
h_t=E[x_t]+P[t]
$$

位置表是可学习参数。模型需要从这些 absolute vectors 中自己学出“相隔 1 个 token”和“相隔 100 个 token”的关系；最大位置还由表长固定。

**RoPE 的计算。** LLaMA 不把位置向量加进 residual stream，而是在每个 attention head 中旋转 Q/K。对二维分量：

$$
R_{\theta,t}\begin{bmatrix}q_{2i}\\q_{2i+1}\end{bmatrix}
=
\begin{bmatrix}
\cos(t\theta_i)&-\sin(t\theta_i)\\
\sin(t\theta_i)&\cos(t\theta_i)
\end{bmatrix}
\begin{bmatrix}q_{2i}\\q_{2i+1}\end{bmatrix}
$$

key 做同样旋转。旋转后的 $q_m^\top k_n$ 会依赖相对距离 $m-n$。

**为什么替换。** 语言中的依赖通常与相对距离有关。RoPE 把相对位置直接放进 attention 点积，并省去 learned position table。

**代价与边界。** RoPE 仍有频率与训练长度设定；超过训练上下文并不会自动可靠，需要 scaling 或长上下文继续训练。

### 5.2 LayerNorm 与 RMSNorm

**GPT-2 的计算。** LayerNorm 先减均值，再除标准差：

$$
\operatorname{LN}(x)=\gamma\odot\frac{x-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta
$$

**RMSNorm 的计算。** RMSNorm 不减均值，也通常没有 additive bias：

$$
\operatorname{RMSNorm}(x)=\frac{x}{\sqrt{\frac1d\sum_i x_i^2+\epsilon}}\odot g
$$

**为什么替换。** 它保留对向量尺度的控制，省去中心化步骤，结构与运算更简单。现代 decoder-only 模型的大规模训练表明这种归一化足够稳定。

**需要澄清。** 原始 Transformer 是 PostNorm；GPT-2 已经是 Pre-LayerNorm。本项目沿用 PreNorm 的位置，只把 LayerNorm 换成 RMSNorm。

### 5.3 GELU MLP 与 SwiGLU

**GPT-2 的计算。** 一个输入投影、GELU、一个输出投影：

$$
W_2\operatorname{GELU}(W_1x+b_1)+b_2
$$

**SwiGLU 的计算。** 它有内容分支和门控分支：

$$
W_2\left(\operatorname{SiLU}(W_gx)\odot W_1x\right)
$$

若某维门值接近 0，该特征被抑制；门值较大则通过。

**为什么替换。** 普通 GELU 对所有中间特征应用固定形式的非线性；SwiGLU 可以按当前 token 表示动态控制特征通路，经验上在现代语言模型中有较好的性能。

**代价。** SwiGLU 多一个输入投影。公平比较参数量时，中间维度应相应调整，不能把 GPT-2 的 4 倍维度原样搬过来。

### 5.4 MHA、MQA 与 GQA

**GPT-2 的 MHA。** 如果有 12 个 query heads，也有 12 个 K heads 和 12 个 V heads。生成时每层都要为历史 token 保存全部 K/V。

**MQA。** 所有 query heads 共用一个 K head 与一个 V head，KV cache 最小，但共享过强可能降低表达能力。

**GQA。** query heads 被分组，每组共用一组 K/V，在两端之间折中。

![MHA、GQA 与 MQA 的 head 组织方式，Figure 2](/images/gpt2-moe/gqa-figure-2.png)

*图源：[GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints, Figure 2](https://arxiv.org/abs/2305.13245)，Ainslie et al., 2023。原论文图。*

本项目使用 12 Q heads、4 KV heads，即每 3 个 query heads 共用一组 K/V。相对 12-KV-head MHA，K/V head 状态减少到三分之一。

**为什么替换。** 自回归服务常受 KV cache 容量与显存带宽限制。GQA 主要优化这部分，而不是让整个 attention FLOPs 或模型参数都缩小三倍。

**代价。** 共享 K/V 减少容量；具体质量与速度收益取决于模型大小、序列长度、batch 和 kernel 实现。

## 6. 从 dense FFN 到 sparse MoE

MoE 不是所有 LLaMA 模型的必备组件。LLaMA 本身是 dense；本项目在 LLaMA 式 block 上进一步采用 Mixtral 的 sparse MoE。

![Mixtral 论文中的 sparse MoE layer，Figure 1](/images/gpt2-moe/mixtral-figure-1.png)

*图源：[Mixtral of Experts, Figure 1](https://arxiv.org/abs/2401.04088)，Jiang et al., 2024。原论文图。*

### 6.1 Dense FFN 怎么算

GPT-2 或 dense LLaMA 的每层只有一个 FFN。batch 中每个 token 都经过同一组 $W_1/W_2$ 或 SwiGLU 权重。增加 FFN 宽度会同时增加参数和每个 token 的计算。

### 6.2 MoE 怎么算

MoE 准备 $N$ 个独立专家。router 根据当前 token 隐藏状态打分：

$$
z=W_rh,\qquad p=\operatorname{softmax}(z)
$$

本项目取 top-2 集合 $S$：

$$
y=\sum_{e\in S}\tilde p_eE_e(h)
$$

8 个专家权重都属于模型总参数，但一个 token 只计算 2 个专家。下一个 token 或下一层可以选择不同专家。

### 6.3 为什么这样改

固定 top-$K$、增加专家总数 $N$，可以增加模型存储的 FFN 容量，而不按相同比例增加单 token FFN 计算。这就是 total parameters 与 active parameters 必须分开的原因。

### 6.4 MoE 付出的代价

- 全部专家权重和优化器状态仍要保存，显存与磁盘不按 active parameters 缩小。
- router 带来额外计算、调度和通信。
- token 分布不均会让少数专家过热、其余专家利用不足。
- 稀疏 kernel 在小 batch、单卡或不合适的硬件上不一定达到理论收益。

因此，MoE 的准确描述是条件计算与容量扩展，不是“用 265M 的成本免费得到 775M 模型”。

## 7. 我们的项目如何采用这套范式

项目不是在 GPT-2 Large 上继续训练，而是从随机权重初始化。GPT-2 提供 tokenizer 和对照模型；模型主体使用 MixtralForCausalLM 构造 LLaMA/Mixtral 式 decoder。

| 配置 | 数值 | 对应选择 |
|---|---:|---|
| hidden size | 768 | residual stream |
| layers | 36 | 对齐 GPT-2 Large 的深度 |
| query heads | 12 | head dimension 64 |
| KV heads | 4 | GQA，3 个 Q heads 共用 K/V |
| normalization | RMSNorm | PreNorm，$\epsilon=10^{-5}$ |
| position | RoPE | $\theta=10000$，context 2048 |
| FFN | SwiGLU MoE | 8 experts / top-2 |
| expert intermediate | 1024 | 单个专家中间维度 |
| vocabulary | 50,304 | GPT-2 BPE + 补齐槽位 |
| embeddings | tied | input embedding 与 LM head 共享 |
| parameters | 775.0M total / 265.4M active | 总容量与激活计算分开统计 |

现在前面的替换关系可以逐一落回配置：没有 learned position embedding，因为使用 RoPE；没有 LayerNorm，因为使用 RMSNorm；没有 GELU MLP，因为专家内部是 SwiGLU；没有 12 组独立 K/V，因为使用 4 组 GQA；没有唯一 dense FFN，因为每层由 router 选择 8 个专家中的 2 个。

## 8. 数据管线：FineWeb-Edu 到训练序列

原始语料来自 FineWeb-Edu 的 sample-10BT。数据集已经做过教育质量过滤和近重复去重。本项目以 streaming 方式读取文本，用 GPT-2 BPE 编码，并在文档之间写入 end-of-text token。

token id 可由 uint16 表示。相较直接保存 int64，5.01B tokens 的理论原始体积从约 40GB 降到约 10GB。训练时通过 memory map 读取连续窗口，再转换为 int64 tensor：

~~~python
arr = np.memmap(path, dtype=np.uint16, mode="r")
a = arr[i * 2048:(i + 1) * 2048].astype(np.int64)
x = torch.from_numpy(a)
return {"input_ids": x[:-1], "labels": x[1:]}
~~~

最终得到 5B train tokens 和约 10M validation tokens。验证样本按固定步长从流中抽取，与训练样本按文档互斥，使不同 checkpoint 的 val loss 可比较。



## 9. 训练实现：单张 RTX 5090 跑完 5B tokens

| 项目 | 配置 |
|---|---:|
| per-device batch | 8 sequences |
| gradient accumulation | 8 |
| nominal effective batch | 64 sequences |
| sequence window | 2048 tokens |
| optimizer steps | 38,146 |
| planned tokens | 约 5.00B |
| learning rate | $3\times10^{-4}$ |
| scheduler | warmup 500 + cosine |
| precision | bf16 compute + fp32 AdamW |
| gradient checkpointing | enabled |
| peak GPU memory | 约 27.5GB |
| observed throughput | 约 15.1k tokens/s |
| wall time | 91.9 hours |

bf16 缩小 activation 与部分计算开销，同时保留比 fp16 更大的指数范围；AdamW 状态保持 fp32。gradient checkpointing 不保存所有中间 activation，而是在 backward 时重算部分 forward，以计算换显存。

训练约每 1B tokens 保存 checkpoint，并保留最近 3 个。单个完整 checkpoint 包含模型与优化器状态，约 8.7GB，所以磁盘与显存一样需要提前规划。

正式训练前在 TinyStories 上做了 1000 步 smoke test。loss 从约 10.85 降到 1.487，并生成连贯短故事。这一步只验证数据、forward、backward、保存和生成链路。



## 10. 结果：与 GPT-2 Large 在同一环境比较

正式训练最终 train loss 为 **3.248**，固定验证集 val loss 为 **2.834**。固定 prompt 的生成从 4B 到 5B tokens 仍在减少重复、改善连贯性，但存在事实错误，因此不能只用流畅样例判断能力。

两套模型随后在同一版本 lm-eval-harness、相同任务定义和 zero-shot 设置下评测。acc_norm 表示先按答案长度归一化 log-likelihood，再选择候选项。

| 任务 | GPT-2 Large 774M dense | 本项目 775M total / 265M active | 差值 |
|---|---:|---:|---:|
| HellaSwag acc_norm | 45.35% | 37.00% | -8.35pp |
| LAMBADA acc | 47.66% | 30.62% | -17.04pp |
| Winogrande acc | 55.33% | 51.85% | -3.48pp |
| PIQA acc_norm | 69.21% | 66.21% | -3.00pp |
| ARC-easy acc_norm | 46.63% | **51.09%** | **+4.46pp** |
| ARC-challenge acc_norm | 25.09% | **26.96%** | **+1.87pp** |
| BoolQ acc | 60.49% | 60.03% | -0.46pp |
| SciQ acc_norm | 69.30% | **69.70%** | **+0.40pp** |
| OpenBookQA acc_norm | 31.20% | **31.80%** | **+0.60pp** |

HellaSwag 的随机基线为 25%，37.00% 说明模型学到了可测量的常识续写能力，但距离 GPT-2 Large 仍差 8.35 个百分点。PIQA 和 Winogrande 较接近；LAMBADA 差距最大，长上下文末词预测是明显短板。

ARC、SciQ 和 OpenBookQA 上的小幅领先不能直接归因于 MoE。GPT-2 Large 约使用 40B tokens 训练，本项目只有 5B；数据、架构也不完全一致。准确结论是：同一评测程序下，本模型以约三分之一的 active parameters 在若干任务上接近 GPT-2 Large，并在部分知识问答任务上达到或略高于它；这不是 compute-matched 或 data-matched 的受控对照实验。



## 11. MoE 专项诊断：专家是否真正被使用

训练结束后，在验证集约 205k tokens 上收集 36 层 router logits，对每个 token 统计 top-2 专家。8 个专家都有非零使用率，因此没有完全坍缩；但负载高度不均。例如第 35 层约 47% 和 48% 的选择落在两个专家，其余 6 个专家各约 1% 到 3%，部分层最大/最小使用率接近 90 倍。

早期分析曾把 router logits 写成 rl[0]，只统计一个 token，因而误判为只有少量专家存活。正确统计必须保留 token 维度：

~~~python
# rl: [num_tokens, num_experts]
top2 = torch.topk(rl, 2, dim=-1).indices
counts = torch.bincount(top2.flatten(), minlength=8)
~~~

修正后要区分：专家全部存活，不代表负载均衡。项目从最终权重继续训练 500 步，将 auxiliary loss 系数从 0.01 提高到 0.1，并加入 0.001 router z-loss；平均 live experts 保持 7.5–7.6/8，但最大专家占比仍为 0.42–0.43，基本没有改善。

路由分工在 5B tokens 后已经稳定，短期续训不足以重新分配专家。下一轮应从训练开始比较更强 auxiliary loss、router jitter 或容量控制，而不是在终点做短期补救。



## 12. 工程问题与复现

这次训练还处理了几类非模型问题：Hugging Face 镜像分页链接回到官方域名、transformers 5.x 参数变化、GPT-2 tokenizer 缺少 pad token、生成时 router logits 导致 auxiliary loss tensor 尺寸不一致、nohup stdout 缓冲、lm-eval-harness 安装以及 checkpoint 磁盘占用。

处理原则是修正原路径，不随意换成更弱的数据、模型或评测：分页问题重写 next-page host；推理关闭 output_router_logits；日志使用 python -u；磁盘限制通过 checkpoint 保留策略解决。

~~~bash
# 数据：5B train + 10M validation tokens
python -u prepare.py \
  --out out \
  --tokens-train 5000000000 \
  --tokens-val 10000000

# 从随机初始化开始正式训练
python -u train.py \
  --data-dir out \
  --out-dir runs/main

# 自回归生成
python generate.py --ckpt runs/main/checkpoint-38146

# 专家路由分析
python analyze_experts.py \
  --ckpt runs/main/checkpoint-38146 \
  --data out/val.bin \
  --blocks 100
~~~



## 13. 结论：先理解基线，再理解项目

语言模型从 n-gram 到 RNN，再到 Transformer，训练目标始终围绕下一个 token。GPT-2 已经形成 decoder-only 自回归 LLM 的完整基线：绝对位置 embedding、Pre-LayerNorm、MHA、GELU MLP、causal mask 和 next-token cross-entropy。

现代 LLaMA 范式不是推倒 GPT-2，而是逐项替换内部组件：RoPE 改变位置进入 attention 的方式；RMSNorm 简化归一化；SwiGLU 给 FFN 加入输入相关的门；GQA 减少自回归 KV cache。Mixtral 式 MoE 再把 dense FFN 改成条件计算，使总参数容量与单 token 激活量部分解耦。

本项目把这条演进落实到一个可运行系统：775.0M total / 265.4M active parameters，5B training tokens，单张 RTX 5090 训练 91.9 小时，最终 val loss 2.834。九项评测证明模型已经学到可测量能力，专家诊断则表明稀疏容量并未被均匀使用。

下一步应固定 tokenizer、数据和训练 token，对比 dense 265M、MoE 775M/265M-active，以及不同 router 正则。只有在相同实验条件下，才能判断现代组件与稀疏容量分别贡献了什么。
`,
}

export default article
