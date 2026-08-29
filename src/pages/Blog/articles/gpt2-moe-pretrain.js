const article = {
  slug: 'gpt2-moe-pretrain',
  date: '2026-08-22 09:00',
  name: '从下一个 token 到稀疏专家：预训练一个 775M MoE',
  description: '从一个 prompt 如何变成下一个 token 开始，解释自回归预训练、原始 Transformer/GPT-2 到 LLaMA 范式的架构演进，再落到 8-expert/top-2 MoE 的数据、训练、评测与路由诊断。',
  tags: ['Training'],
  category: 'Model Pretraining',
  author: 'shannon',
  takeaway: '语言模型训练的核心任务始终是预测下一个 token；现代 LLaMA 范式改变的是完成这项任务的内部结构和效率。本项目使用 RoPE、RMSNorm、SwiGLU、GQA 与 top-2 MoE，在单张 RTX 5090 上训练 5B tokens，得到 775.0M 总参数、265.4M active parameters 的模型，最终 val loss 2.834。九项评测说明它已学到可测量能力，同时也暴露出 LAMBADA 差距和专家负载不均衡。',
  detail: String.raw`

## 1. 先固定问题：模型预测的是 token，不是完整答案

输入一句 “The capital of France is”，模型不会直接检索一条名为“法国首都”的记录，也不会一次输出完整答案。tokenizer 先把字符串变成一串离散编号，模型再根据已有编号，为词表中的每个候选编号计算下一个位置的概率。

token 是 tokenizer 定义的基本单位，不一定等于一个单词。GPT-2 使用 byte-level BPE：常见字符串可以合成一个 token，少见字符串会拆成多个 token，空格也可能属于 token 的一部分。模型看到的是 token id；字符与 token id 之间的映射由 tokenizer 决定，不是模型在预训练中重新学习的。

设一段文本经过分词后得到 $x_1,x_2,\ldots,x_T$。其中 $T$ 是序列长度，$x_t$ 是第 $t$ 个 token，$x_{<t}$ 表示它左侧的 $x_1,\ldots,x_{t-1}$。语言模型的目标是：给定 $x_{<t}$，估计 $x_t$ 的条件概率。

对于序列 $x_1,x_2,\ldots,x_T$，联合概率按条件概率展开为：

$$
P(x_{1:T})=\prod_{t=1}^{T}P(x_t\mid x_{<t})
$$

这是概率的链式法则，也叫自回归分解。每一项都是一个“根据前文预测下一个 token”的问题；把这些条件概率相乘，就得到模型赋给整段文本的概率。它不是 Transformer 才有的概念；n-gram、RNN、GPT 和 LLaMA 都可以使用同一个目标，区别在于怎样表示和读取 $x_{<t}$。

训练通常不直接最大化一串很小概率的乘积，而是最小化平均负对数似然：

$$
\mathcal L_{\mathrm{LM}}
=-\frac{1}{T-1}\sum_{t=1}^{T-1}
\log P_\theta(x_{t+1}\mid x_{\le t})
$$

$\theta$ 表示模型的全部可训练参数。某个正确 token 的概率越高，对应的 $-\log P$ 越小。对 loss 取指数得到 perplexity：

$$
\operatorname{PPL}=\exp(\mathcal L_{\mathrm{LM}})
$$

perplexity 可以理解为模型在每个位置面对的等效候选数，但只有 tokenizer、数据和 loss 计算方式相同时才适合直接比较。本文最终的 val loss 为 2.834，对应 PPL 约为 $e^{2.834}=17.0$；这个数字不能脱离验证集直接与另一篇论文的 PPL 比较。

全文接下来沿一条计算链展开：先用 GPT-2 说明 token 如何经过 embedding、attention、MLP 和 LM head 变成 next-token loss；再把四个内部组件替换为 RoPE、RMSNorm、SwiGLU 和 GQA；随后只把 FFN 改成 top-2 MoE；最后检查数据、参数量、token 预算、评测与专家负载。这样每个项目配置都能回到前面的一个具体问题。

### 1.1 n-gram：只看固定窗口

以 trigram 为例，它近似认为下一个词只依赖前两个词：

$$
P(x_t\mid x_{<t})\approx P(x_t\mid x_{t-2},x_{t-1})
$$

这些概率由语料计数得到。如果 “capital of France” 出现很多次，模型就会提高 France 在 “capital of” 后面的概率。未见过的 trigram 计数为 0，实际系统需要平滑或回退到更短的 n-gram。即使做了平滑，固定窗口仍看不到更远的主语或约束；“France”和“Germany”的统计也各自存放，不能自然共享“国家—首都”这类结构。

### 1.2 RNN/LSTM：把历史压进一个状态

RNN 按时间顺序更新隐藏状态：

$$
h_t=f(W_xe_t+W_hh_{t-1}),\qquad P(x_{t+1})=\operatorname{softmax}(W_oh_t)
$$

$e_t$ 是当前词向量，$h_{t-1}$ 概括此前历史，$W_x$、$W_h$、$W_o$ 是训练得到的矩阵。它可以处理可变长度上下文，也能在相似词之间共享参数，但所有历史都要逐步压进固定宽度的 $h_t$。第 100 个 token 的表示依赖第 99 个状态，所以训练无法沿序列维度并行；一条长距离信息还要反复经过很多次状态更新。LSTM 用门控缓解梯度消失，却没有消除这条串行依赖。

### 1.3 Transformer：让每个位置直接读取历史位置

2017 年的 Transformer 用 self-attention 替代循环。训练时所有位置可以并行形成 query、key、value；在同一层内，任意两个位置之间可以直接交换信息。代价是标准 attention 要构造长度为 $T$ 的分数矩阵，计算量和中间存储随 $T^2$ 增长。Transformer 消除了 RNN 的序列串行瓶颈，但没有让长上下文变成无成本操作。

![原始 Transformer encoder-decoder 架构，Figure 1](/images/gpt2-moe/transformer-figure-1.png)

*图源：[Attention Is All You Need, Figure 1](https://arxiv.org/abs/1706.03762)，Vaswani et al., 2017。原论文图。*

原始模型是机器翻译用的 encoder-decoder：encoder 双向读取源语言，decoder 用 masked self-attention 生成目标语言，并通过 cross-attention 读取 encoder。后来的 GPT 去掉 encoder 与 cross-attention，只保留 decoder 式 causal Transformer。这里的“decoder-only”描述的是 block 结构，不表示模型只能在推理时工作；预训练仍会在完整文本上并行计算所有位置的 next-token loss。

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

两条式子中的 $H\in\mathbb R^{T\times d}$ 是整段序列的 hidden states：$T$ 是 token 数，$d$ 是每个 token 的表示维度。attention 沿 $T$ 这一维交换不同位置的信息；MLP 分别处理每一行，改变单个位置内部的特征。residual connection 则要求子层输出仍为 $T\times d$，这样才能与输入逐项相加。

下面拿一条具体输入把 GPT-2 的 forward、训练和生成顺一遍。为了让矩阵可手算，示例把真实模型维度缩小；计算顺序与真实 GPT-2 相同。

## 3. 一条 prompt 在 GPT-2 中如何计算

输入文本：

> The capital of France is

GPT-2 的 byte-level BPE tokenizer 先把文本切成 token。这个句子可以理解为 The、␠capital、␠of、␠France、␠is，其中前导空格也是 token 的一部分。tokenizer 再把每个 token 映射成整数 id。

下面只追踪最后一个 token ␠is，观察模型怎样根据它前面的上下文预测 ␠Paris。真实 GPT-2 会同时处理序列中的所有位置，计算过程相同。

### 3.1 Token embedding 与位置

模型不能把整数 id 的数值大小当成词义，因此先把 id 当作索引，从 token embedding 表中查出向量。GPT-2 还为每个位置保存一条 learned position embedding：

$$
h_t^{(0)}=E_{tok}[x_t]+E_{pos}[t]
$$

第一项表示 token 是什么，第二项表示它出现在第几个位置。两者维度同为 $d$，才能逐项相加。相加后，France 出现在第 4 个位置和出现在第 20 个位置会得到不同的初始表示。GPT-2 的 input embedding 与输出 LM head 共享同一组权重，这叫 weight tying；它减少一张大小为“词表大小 × hidden size”的独立参数表。

经过这一步，每个 token 都变成一条连续向量，但不同 token 之间还没有交换信息。

### 3.2 Self-attention：让 is 读取前文

GPT-2 先对 hidden states 做 LayerNorm，再通过三个线性投影产生 query、key 和 value。为简化符号，下面把归一化后的矩阵仍记作 $H$：

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

若序列长为 $T$、单个 head 维度为 $d_h$，则 $QK^\top$ 的形状是 $T\times T$。第 $t$ 行表示“位置 $t$ 应该从各位置读取多少信息”。causal mask 把这张矩阵的严格上三角遮住。这样，第 2 个位置预测第 3 个 token 时看不到第 3 个 token 本身，训练标签不会泄漏进输入。

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

这个简化 head 的维度 $d_h=2$。点积并缩放后得到：

$$
s=\frac{q_{is}K^\top}{\sqrt2}
=\frac{[1,\ 1,\ 1,\ 2,\ 0.5]}{\sqrt2}
\approx[0.71,\ 0.71,\ 0.71,\ 1.41,\ 0.35]
$$

␠is 位于序列末尾，没有未来位置需要遮蔽。softmax 把分数归一化为权重：

$$
a=\operatorname{softmax}(s)
\approx[0.175,\ 0.175,\ 0.175,\ 0.353,\ 0.122]
$$

France 对应的权重最大。若五个位置的 value 分别为 $v_0,\ldots,v_4$，这个 head 的输出为：

$$
o=0.175v_0+0.175v_1+0.175v_2+0.353v_3+0.122v_4
$$

这些数字只演示计算顺序，不是模型的真实权重。真实 GPT-2 使用多组独立的 Q/K/V 投影；各 head 输出拼接后经 $W_O$ 投影回 hidden size，再加回 residual stream：

attention 输出通过 residual connection 加回原表示：

$$
h'=h+\operatorname{MHA}(\operatorname{LN}(h))
$$

residual connection 同时保留原 token 表示和 attention 读取的上下文信息。

### 3.3 GELU MLP：变换当前位置的特征

attention 负责 token 之间的信息交换；MLP 对每个位置独立做非线性变换：

$$
\operatorname{MLP}(h')
=W_2\operatorname{GELU}(W_1h'+b_1)+b_2
$$

第一层先把表示从 $d$ 维投影到更宽的中间空间，GELU 提供非线性；没有它，多层线性变换仍可以合并成一次线性变换。第二层再投影回 $d$ 维，使输出能够加回 residual stream。随后再次做 residual connection：

$$
h^{next}=h'+\operatorname{MLP}(\operatorname{LN}(h'))
$$

LayerNorm、attention、MLP 和两条 residual connection 构成一个 GPT-2 block。GPT-2 Large 重复 36 层，使 ␠is 的表示逐层整合词义、位置、句法和前文信息。

### 3.4 LM head：让所有 token 竞争

最后一层之后，模型把 hidden state 投影到整个词表：

$$
z=h^{(L)}W_{vocab}^\top
$$

$z_i$ 是候选 token $i$ 的 logit，也就是归一化前的分数。softmax 将 logits 变成概率：

$$
P(i\mid x_{\le t})
=\frac{\exp(z_i/\tau)}{\sum_j\exp(z_j/\tau)}
$$

这里用 $\tau$ 表示温度，避免与前文表示序列长度的 $T$ 混淆。训练和报告 loss 时取 $\tau=1$。生成时才常用其它温度：$\tau<1$ 会放大 logit 差异，分布更集中；$\tau>1$ 会缩小差异，分布更平缓。模型不是直接输出字符串 Paris，而是给词表里的每个 token 一个分数。如果 ␠Paris 的概率最高，greedy decoding 会选中它；sampling 则按概率抽取，还可以配合 top-$k$ 或 top-$p$ 截去低概率尾部。这些解码方法只改变如何从分布选 token，不改变模型参数。

### 3.5 生成时：从一次 forward 到连续生成

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


### 3.6 训练时：梯度怎样反向传播

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

在每个 block 内，梯度分别经过 MLP、attention 和 residual connection，最终得到各参数的梯度。residual connection 提供不经过子层的直接路径，有助于梯度传过多层。backward 只计算梯度；随后才由 AdamW 更新权重。

## 4. 一段文本怎样变成一个训练 batch

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

实现时不需要为每一行单独构造样本。设一段 token id 为：

$$
[x_1,x_2,x_3,x_4,x_5,x_6,x_7]
$$

取前六个作为 input_ids，后六个作为 labels，两者只相差一个位置。模型一次输出六组词表 logits，再把第 $t$ 组与标签 $x_{t+1}$ 比较。batch 中若有 $B$ 条序列，实际参与平均的预测位置数约为 $B(T-1)$。

文档边界处要插入 end-of-text token。否则，前一篇网页的最后一句和下一篇网页的第一句会被直接拼成一段不存在的自然文本。end-of-text 既是边界标记，也是正常的预测目标；它与为了对齐 batch 长度而添加、通常不计入 loss 的 padding token 作用不同。本项目把语料预先打包成定长连续窗口，因此训练主体不依赖大量 padding。

一条训练序列因此提供多个监督信号，而不是只监督最后一个位置。所有位置共享同一组模型参数，最终 loss 对这些位置求平均后再 backward。训练不用 KV cache，因为整段序列的所有位置本来就并行计算，而且 backward 需要当前 forward 的计算图。

到这里，GPT-2 基线已经完整：它知道如何表示 token 和位置，如何读取历史，如何经 MLP 变换，如何计算 next-token loss，也知道如何逐 token 解码。现代 LLaMA 范式没有改变这个目标，而是逐项替换内部组件。

## 5. 现代 LLaMA 范式：逐项替换 GPT-2

| 模块 | GPT-2 基线 | 现代方案 | 主要目的 |
|---|---|---|---|
| 位置 | learned absolute embedding | RoPE | 直接在 attention 中表达相对位置 |
| 归一化 | LayerNorm | RMSNorm | 简化归一化计算 |
| FFN | GELU MLP | SwiGLU | 用门控调节特征通路 |
| attention | MHA | GQA | 减少 KV cache 与读取带宽 |
| FFN 容量 | dense | 可选 sparse MoE | 分离总容量与单 token 激活计算 |

下面每项都沿用同一顺序：旧方案是什么、新方案怎样替换、为什么替换、代价是什么。前一节已经用具体 prompt 展开过一次完整 forward，这里不再重复手算矩阵，只保留理解项目配置所需的公式。

### 5.1 绝对位置 embedding 与 RoPE

**GPT-2 的计算。** GPT-2 直接把位置 embedding 加到 token embedding：

$$
h_t=E_{tok}[x_t]+E_{pos}[t]
$$

其中 $E_{pos}\in\mathbb R^{T_{max}\times d}$ 是一张可训练参数表。训练开始时它和其它权重一样随机初始化，随后通过 next-token loss 更新；训练完成后，每一行已经是学到的位置向量，不再是随机数。

同一个 token 放到另一个位置，会查找 $E_{pos}$ 的另一行，因此得到不同的初始表示。原始 Transformer 还使用过固定的正余弦位置编码：

$$
PE(t,2i)=\sin\left(\frac{t}{10000^{2i/d}}\right)
$$

$$
PE(t,2i+1)=\cos\left(\frac{t}{10000^{2i/d}}\right)
$$

它同样与 token embedding 相加，但数值由位置 $t$ 和维度 $i$ 直接生成，不参与训练。GPT-2 选择的是 learned absolute embedding，不是这套固定编码。

learned absolute embedding 的问题不在于“初始化随机”，因为其它模型权重也从随机值开始；问题在于每个绝对位置各有一行独立参数。模型需要从这些行中自己学出“相隔 1 个 token”和“相隔 100 个 token”的关系，最大位置还由表长 $T_{max}$ 固定。

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

这里的 $i$ 表示第 $i$ 对维度，$t$ 是 token 位置。若 head dimension 为 $d_h$、RoPE base 为 $\theta_{base}$，常用频率为：

$$
\theta_i=\theta_{base}^{-2i/d_h}
$$

第 $t$ 个位置在这一对维度上的实际旋转角为 $t\theta_i$。不同维度对使用不同频率，因此可以同时表示短距离和长距离变化。相对位置来自旋转矩阵的性质：

$$
(R_mq)^\top(R_nk)
=q^\top R_m^\top R_nk
=q^\top R_{n-m}k
$$

点积只保留位置差 $n-m$，不需要为每个绝对位置学习一条独立向量。RoPE 只旋转 Q/K，不旋转 V；位置影响“读哪里”，取回的 value 仍由内容投影得到。

**为什么替换。** 语言中的依赖通常与相对距离有关。RoPE 把相对位置直接放进 attention 点积，并省去 learned position table。

**代价与边界。** RoPE 仍有基频和训练长度设定。本项目的 $\theta=10000$ 是频率计算中的 base，不是“最多 10,000 tokens”；实际训练窗口是 2048。超过训练上下文时，模型会遇到训练中没有覆盖过的旋转角度组合，不能仅凭没有位置表就推断它会可靠外推。RoPE scaling 或长上下文继续训练需要单独验证。

### 5.2 LayerNorm 与 RMSNorm

**GPT-2 的计算。** LayerNorm 先减均值，再除标准差：

$$
\operatorname{LN}(x)=\gamma\odot\frac{x-\mu}{\sqrt{\sigma^2+\epsilon}}+\beta
$$

**RMSNorm 的计算。** RMSNorm 不减均值，也通常没有 additive bias：

$$
\operatorname{RMSNorm}(x)=\frac{x}{\sqrt{\frac1d\sum_i x_i^2+\epsilon}}\odot g
$$

$d$ 是 hidden size，$\epsilon$ 防止分母接近 0，$g\in\mathbb R^d$ 是训练得到的逐维缩放。LayerNorm 的 $\mu$、$\sigma^2$ 要从当前 token 的 $d$ 个特征计算；RMSNorm 只计算平方均值。两者都逐 token 归一化，不会在不同 batch 样本之间共享统计量。

两者都会控制向量尺度，但结果不同：LayerNorm 先把特征均值移到 0，RMSNorm 保留原有的均值关系，只按均方根缩放。实际模型中的 $\gamma$、$\beta$ 或 $g$ 会继续逐维调整结果。

**为什么替换。** residual stream 反复相加后，向量尺度可能逐层改变。RMSNorm 保留对尺度的控制，省去中心化步骤，结构更简单。这里应把算法结构和实际速度分开：RMSNorm 的算术步骤更少，但端到端速度仍取决于是否有融合 kernel，不能只凭公式断定训练会快多少。详见 [RMSNorm 原论文](https://arxiv.org/abs/1910.07467)。

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

![GELU FFN 与 SwiGLU FFN 的结构对比，Figure 1(a)(b)](/images/gpt2-moe/gelu-swiglu-figure-1.png)

*图源：[Masked Gated Linear Unit, Figure 1(a)(b)](https://arxiv.org/abs/2506.23225)，Tajima et al., 2025。截取自原论文图，未重绘。图中的 Swish 与本文公式中的 SiLU 是同一个函数。*

若某维门值接近 0，该特征被抑制；门值较大则通过。

更具体地说，$W_1x$ 和 $W_gx$ 都从 hidden size $d$ 投影到 expert intermediate size $d_{ff}$，逐项相乘后再由 $W_2$ 投影回 $d$。SiLU 定义为：

$$
\operatorname{SiLU}(u)=u\,\sigma(u),
\qquad
\sigma(u)=\frac{1}{1+e^{-u}}
$$

因此一条无 bias 的 SwiGLU FFN 有三张矩阵，参数量约为 $3dd_{ff}$；普通两层 MLP 约为 $2dd_{ff}$。本项目每个专家取 $d=768$、$d_{ff}=1024$，所以单个专家恰有 $3\times768\times1024=2,359,296$ 个矩阵参数。

SiLU 的输出不是概率，也不受 $[0,1]$ 限制，因此门控分支既能缩放特征，也能改变符号。$W_2$ 再把中间特征混合并投影回 residual stream。

**为什么替换。** 普通 GELU 对所有中间特征应用固定形式的非线性；SwiGLU 让一个投影控制另一个投影的通过比例，因此门值随当前 token 表示改变。它是经验上的架构选择，不是由 next-token objective 必然推出的形式；对照实验见 [GLU Variants Improve Transformer](https://arxiv.org/abs/2002.05202)。

**代价。** SwiGLU 多一个输入投影。公平比较参数量时，中间维度应相应调整，不能把 GPT-2 的 4 倍维度原样搬过来。

### 5.4 MHA、MQA 与 GQA

**GPT-2 的 MHA。** 如果有 12 个 query heads，也有 12 个 K heads 和 12 个 V heads。生成时每层都要为历史 token 保存全部 K/V。

**MQA。** 所有 query heads 共用一个 K head 与一个 V head，KV cache 最小，但共享过强可能降低表达能力。

**GQA。** query heads 被分组，每组共用一组 K/V，在两端之间折中。

![MHA、GQA 与 MQA 的 head 组织方式，Figure 2](/images/gpt2-moe/gqa-figure-2.png)

*图源：[GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints, Figure 2](https://arxiv.org/abs/2305.13245)，Ainslie et al., 2023。原论文图。*

本项目使用 12 Q heads、4 KV heads，即每 3 个 query heads 共用一组 K/V。相对 12-KV-head MHA，K/V head 状态减少到三分之一。共享 K/V 不表示同组 query head 的输出相同：各 query head 保留独立的 Q 投影，仍会产生不同的 attention scores、权重和输出。

设层数为 $L$、缓存序列长度为 $T$、每个 K/V head 维度为 $d_h$、每个元素占 $b$ bytes，单条序列的 KV cache 近似为：

$$
\text{KV bytes}=2LTn_{kv}d_hb
$$

系数 2 来自 K 和 V 两份缓存。本项目 $L=36$、$n_{kv}=4$、$d_h=64$；同 hidden size 的 MHA 会取 $n_{kv}=12$。因此被压缩到三分之一的是 KV cache 及相关投影，不是 Q、输出投影、MLP 或全部模型参数。

**为什么替换。** 自回归服务常受 KV cache 容量与显存带宽限制。GQA 主要优化这部分，而不是让整个 attention FLOPs 或模型参数都缩小三倍。

**代价。** 共享 K/V 减少了各 query head 独立保存上下文表示的容量；具体质量与速度收益取决于模型大小、序列长度、batch 和 kernel 实现。训练短序列时 MLP 可能占主要开销，GQA 的收益不会等同于 KV head 数的缩减比例。

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

$W_r\in\mathbb R^{N\times d}$ 是 router 矩阵，$z_e$ 是专家 $e$ 的未归一化分数，$p_e$ 是它在 8 个专家中的概率。top-2 先选出最大的两个分量，再在这两个分量内重新归一化：

$$
\tilde p_e=\frac{p_e}{\sum_{j\in S}p_j},\qquad e\in S
$$

两个被选专家各自处理同一个 $h$，输出按重新归一化后的权重相加。8 个专家权重都属于模型总参数，但这个 token 只执行其中 2 个专家；下一个 token 或下一层可以选择不同专家。

实现上会先把 token 按专家编号分组，让每个专家只接收分配给自己的 token，再把输出散射回原顺序。如果直接让 8 个专家处理全部 token、最后把 6 个结果乘 0，数学输出相同，但不会节省主要的 FFN 计算。

top-$K$ 的离散选择本身不可导。backward 会更新被选专家、混合权重以及产生这些权重的 router；未被选专家不会从这个 token 的语言模型 loss 收到梯度。因此，如果少数专家在训练早期获得较高概率，它们会收到更多样本和更新，负载不均可能进一步延续。

### 6.3 为什么这样改

固定 top-$K$、增加专家总数 $N$，可以增加模型存储的 FFN 容量，而不按相同比例增加单 token FFN 计算。以本项目一层为例，8 个专家共有约 18.87M 参数，但一个 token 只激活 2 个专家、约 4.72M 参数。attention、normalization 和 router 仍然始终执行。这就是 total parameters 与 active parameters 必须分开的原因。

“active parameters”是结构计数，不等于精确 FLOPs，也不等于训练显存。它没有表示 attention 随序列长度变化的计算量、dispatch 开销、kernel 利用率，以及 backward 与优化器状态。它适合说明一个 token 经过哪些权重，不适合单独预测训练会快多少。

### 6.4 为什么还需要负载均衡损失

next-token loss 只关心最终 token 概率，并不要求 8 个专家平均工作。如果 router 把大部分 token 送给两个专家，而语言模型 loss 仍能下降，主任务本身没有足够动力修正负载。

常见做法是在语言模型 loss 外加入 auxiliary load-balancing loss。设 $f_e$ 是一个 batch 中分配给专家 $e$ 的 token-slot 比例，$\bar p_e$ 是 router 给专家 $e$ 的平均概率，$N$ 是专家数，可写成：

$$
\mathcal L_{aux}=N\sum_{e=1}^{N}f_e\bar p_e
$$

当实际分配和平均概率都集中在少数专家时，这一项增大。总训练目标为：

$$
\mathcal L
=\mathcal L_{LM}+\lambda_{aux}\mathcal L_{aux}
+\lambda_z\mathcal L_z
$$

$\lambda_{aux}$ 与 $\lambda_z$ 控制两个路由正则相对主任务的强度。router z-loss 常写为：

$$
\mathcal L_z
=\frac1{BT}\sum_{b,t}
\left(\log\sum_{e=1}^{N}\exp z_{b,t,e}\right)^2
$$

它限制 router logits 的整体尺度，减少 logits 持续变大的数值风险；它不直接保证每个专家获得相同 token 数。auxiliary loss、router jitter 和容量限制处理的是不同问题，不能互相替代。

### 6.5 MoE 付出的代价

- 全部专家权重和优化器状态仍要保存，显存与磁盘不按 active parameters 缩小。
- router 带来额外计算、调度和通信。
- token 分布不均会让少数专家承担大部分 token、其余专家利用不足；多卡 expert parallel 时，最忙的设备还会决定整层等待时间。
- 稀疏 kernel 在小 batch、单卡或不合适的硬件上不一定达到理论收益。
- 每个专家看到的数据少于 dense FFN，路由训练本身也增加新的超参数和失败方式。

因此，MoE 的准确描述是条件计算与容量扩展，不是“用 265M 的成本免费得到 775M 模型”。

## 7. 我们的项目如何采用这套范式

项目不是在 GPT-2 Large 上继续训练，而是从随机权重初始化。GPT-2 提供 tokenizer 和对照模型；模型主体使用 MixtralForCausalLM 构造 LLaMA/Mixtral 式 decoder。

一层的完整顺序是：

$$
H'=H+\operatorname{GQA}(\operatorname{RMSNorm}(H))
$$

$$
H^{next}=H'+\operatorname{MoE}(\operatorname{RMSNorm}(H'))
$$

GQA 内对 Q/K 应用 RoPE，MoE 内每个专家都是 SwiGLU。36 层后再做一次 RMSNorm，并由 tied LM head 投影到词表。这个顺序说明 MoE 只替换每层的 FFN，attention 仍是 dense：每个 token 都会经过每层 attention 和 router。

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

### 7.1 775.0M 总参数怎样得到

参数量可以直接从矩阵形状复算。记 hidden size 为 $d=768$，expert intermediate 为 $d_{ff}=1024$，词表为 $V=50,304$。

| 部分 | 计算 | 参数量 |
|---|---:|---:|
| tied embedding / LM head | $Vd$ | 38,633,472 |
| 每层 Q/K/V/O | $768^2+2(768\times256)+768^2$ | 1,572,864 |
| 每个 SwiGLU expert | $3dd_{ff}$ | 2,359,296 |
| 每层 8 experts | $8\times2,359,296$ | 18,874,368 |
| 每层 router | $d\times8$ | 6,144 |
| 每层两个 RMSNorm | $2d$ | 1,536 |
| 最终 RMSNorm | $d$ | 768 |

K/V 投影的输出维度是 $4\times64=256$，所以它们小于 Q 投影的 $12\times64=768$。将每层各项相加、乘 36 层，再加 embedding 和最终 RMSNorm：

$$
38,633,472
+36\times20,454,912
+768
=775,011,072
$$

即 775.0M。这里没有再加一份 LM head，因为 weight tying 让它与 input embedding 共用参数。

### 7.2 265.4M active parameters 怎样得到

对一个 token，每层只把 8 个专家改成 2 个，其余 attention、router 和 norm 都保留：

$$
38,633,472
+36\times
\left(
1,572,864
+2\times2,359,296
+6,144
+1,536
\right)
+768
=265,403,136
$$

即 265.4M。这个口径把整张 embedding / LM head 记为 active module，便于与常见模型参数统计一致；单个 token 的 embedding lookup 实际只读取其中一行，而 LM head 仍要用整张矩阵计算全部词表 logits。

### 7.3 配置中的几个非直观选择

- **36 层**只是在深度上对齐 GPT-2 Large，不代表两者是参数、数据或计算量严格匹配的实验。
- **50,304 词表**保留 GPT-2 原有 50,257 个 token id，并补到便于硬件矩阵对齐的大小。新增槽位没有新语义，也不会凭空改善 tokenizer；训练标签仍来自原 GPT-2 BPE。
- **2048 context**表示每次训练最多在一个窗口内建立依赖。模型不会在不同训练窗口之间保留 KV cache 或 hidden state。
- **随机初始化**表示所有 attention、expert 和 router 权重都从头学习。复用 tokenizer 只复用了字符串到 id 的规则，没有复用 GPT-2 的语言知识。

## 8. 数据管线：FineWeb-Edu 到训练序列

模型结构只规定“怎样学习”，语料决定它能观察到什么。本项目使用 FineWeb-Edu 的 sample-10BT 子集。FineWeb-Edu 是从 FineWeb 中按教育相关质量分数筛出的英文网页集合；上游还包含 URL、语言、内容质量和近重复清理。这里的“教育质量过滤”表示分类器更偏好具有讲解性质的文本，不表示每条事实已经人工核验。数据处理背景见 [FineWeb 论文](https://arxiv.org/abs/2406.17557)。

### 8.1 从文档流到 token 流

处理分为四步：

1. 以 streaming 方式逐篇读取文档，避免先下载并展开整个数据集。
2. 对文档文本执行同一版 GPT-2 byte-level BPE，得到 token id。
3. 在相邻文档之间插入 end-of-text id，保留边界信息。
4. 把 id 顺序写入二进制文件，训练时再按定长窗口读取。

streaming 只描述原始文档的读取方式。正式训练并不一边联网取网页一边等待 tokenizer，而是读取已经物化的 train.bin 与 val.bin。这样做把网络波动和在线分词从 91.9 小时训练路径中移开，也使 checkpoint 恢复后看到的数据文件保持不变。

窗口允许跨文档边界，但中间会出现 end-of-text token。模型因此可以学习一篇文档结束后进入新文档，而不会把两个网页无标记地接成一句话。

### 8.2 为什么保存为 uint16，训练时再转 int64

token id 可由 uint16 表示。相较直接保存 int64，5.01B tokens 的理论原始体积从约 40GB 降到约 10GB。训练时通过 memory map 读取连续窗口，再转换为 int64 tensor：

~~~python
arr = np.memmap(path, dtype=np.uint16, mode="r")
# 需要 2048 个输入和各自右移一位的标签，所以读取 2049 个 id
a = arr[i * 2048:i * 2048 + 2049].astype(np.int64)
x = torch.from_numpy(a)
return {"input_ids": x[:2048], "labels": x[1:2049]}
~~~

uint16 能表示 0 到 65,535，本项目最大 token id 小于这个上限。PyTorch 的 embedding 索引需要整数索引 tensor，因此取出一个小窗口后再转成 int64。转换后的 batch 占 GPU 内存，但磁盘上的 5B-token 主文件仍保持约四分之一体积。memory map 还让操作系统按需读取页面，不必把约 10GB 文件整体复制进进程内存。

代码必须读取 2049 个 id 才能产生 2048 组 next-token 训练对。若只读取 2048 个再用 x[:-1] 和 x[1:]，每条序列实际只有 2047 个预测位置，后面的 token 预算也会少算一位。

### 8.3 训练集与验证集为什么要按文档分开

最终得到约 5B train tokens 和约 10M validation tokens。验证文档用确定性规则从文档流中抽取，并且一篇文档只进入 train 或 validation 一侧。不能先把全部 token 拼起来再随机切窗口：相邻窗口可能来自同一篇网页，近乎相同的内容出现在两侧会使 val loss 偏低。

固定验证文件有两个作用：每次评估读取相同 token，checkpoint 间的差异不会混入验证采样噪声；文档互斥则减少直接内容泄漏。它仍不能排除上游数据中语义相近但未被去重的网页，因此 val loss 是这套数据管线内部的指标，不是对任意互联网文本的无偏估计。


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

### 9.1 一个 optimizer step 实际包含多少 token

单个 micro-batch 有 8 条序列，每条 2048 个预测位置：

$$
8\times2048=16,384\ \text{tokens}
$$

显存不能同时容纳 64 条序列，所以连续计算 8 个 micro-batch，把梯度累加到同一组参数上，再执行一次 AdamW update：

$$
B_{eff}=8\times8=64\ \text{sequences}
$$

$$
N_{step}=64\times2048=131,072\ \text{tokens}
$$

38,146 个 optimizer steps 对应：

$$
38,146\times131,072
=4,999,872,512
$$

即约 5.00B 个训练 token。gradient accumulation 改变的是多久更新一次参数，不会让 8 个 micro-batch 的 activation 同时留在显存里。实现还要把每个 micro-batch 的 loss 除以 accumulation steps，或由训练框架做等价缩放，否则累积梯度会被放大 8 倍。

“nominal effective batch”特意保留 nominal：最后一个不完整 batch、被忽略的 label 或分布式采样策略都可能让实际计数略有变化。本项目预打包定长窗口并按完整 step 规划，所以主预算可以由上式直接复算。

### 9.2 AdamW、warmup 与 cosine 分别解决什么

AdamW 根据当前梯度 $g_t$ 维护一阶矩和二阶矩：

$$
\begin{aligned}
m_t&=\beta_1m_{t-1}+(1-\beta_1)g_t\\
v_t&=\beta_2v_{t-1}+(1-\beta_2)g_t^2
\end{aligned}
$$

$m_t$ 平滑更新方向，$v_t$ 调整各参数的有效步长。做偏差修正后，更新可概括为：

$$
\theta_{t+1}
=(1-\eta_t\lambda)\theta_t
-\eta_t\frac{\hat m_t}{\sqrt{\hat v_t}+\epsilon}
$$

$\eta_t$ 是当前学习率，$\lambda$ 是 decoupled weight decay 系数。AdamW 决定怎样使用梯度；learning-rate schedule 决定每一步的整体更新幅度。

本项目用前 $W=500$ 个 optimizer steps 做线性 warmup，再在总计 $S=38,146$ 步内做 cosine decay。若 warmup 从 0 开始、终点学习率为 $\eta_{min}$，调度可写成：

$$
\eta_t=
\begin{cases}
\eta_{max}\dfrac{t}{W}, & 0\le t<W\\[6pt]
\eta_{min}+\dfrac12(\eta_{max}-\eta_{min})
\left[1+\cos\left(\pi\dfrac{t-W}{S-W}\right)\right],
& W\le t\le S
\end{cases}
$$

warmup 避免随机初始化阶段立即使用峰值学习率 $\eta_{max}=3\times10^{-4}$；cosine 则在后续训练中逐步缩小更新。500 个 warmup steps 对应：

$$
500\times131,072
=65,536,000\ \text{tokens}
$$

关键区别是：AdamW 调整参数之间的相对步长，warmup 控制训练开头，cosine 控制其余训练过程。$\beta_1$、$\beta_2$、$\epsilon$、weight decay、gradient clipping 和 $\eta_{min}$ 仍需从实际配置文件读取。

### 9.3 bf16 与 gradient checkpointing 节省的是不同内存

bf16 用 8 位指数、7 位显式尾数。它与 fp32 有相同的指数位数，因此可表示的数量级范围远大于 fp16；代价是有效数字较少。混合精度让适合的矩阵乘法和 activation 使用 bf16，同时让 AdamW 的累积状态保持 fp32。它减少的主要是计算张量与 activation 带宽，不能据此认为模型、梯度和两个 Adam 状态都只占 2 bytes。

训练内存至少包括：参数、梯度、AdamW 的一阶/二阶状态、当前 batch 的 activation、临时 kernel workspace。对 775M 总参数，单是两份 fp32 Adam 状态理论上就约为：

$$
775\text{M}\times2\text{ states}\times4\text{ bytes}
\approx6.2\text{GB}
$$

gradient checkpointing 处理的是 activation：forward 时只保留部分层边界，backward 走到某段时重新计算该段中间结果。它以额外 forward 计算换取显存，不能减少参数或 AdamW 状态。因此峰值约 27.5GB 不能只用 active parameters 乘字节数解释。

### 9.4 参数量与数据量怎样一起选择

固定训练计算预算下，需要在模型参数量 $N$ 和训练 token 数 $D$ 之间分配计算。对 dense Transformer，忽略 attention、embedding 等项时，训练计算量常近似写成：

$$
C\approx6ND
$$

这里 $C$ 是训练 FLOPs，$N$ 通常指参与矩阵乘法的非 embedding 参数；该式只用于数量级估算。

[Chinchilla](https://arxiv.org/abs/2203.15556) 在其 dense 模型实验中得到约 20 tokens/parameter 的经验比例。它是特定实验条件下的拟合结果，不是固定常数。

把本项目精确的 $D=4,999,872,512$ 代入，可以得到三个不同答案：

| $N$ 的口径 | 参数量 | $D/N$ |
|---|---:|---:|
| checkpoint 中的全部参数 | 775.0M | 6.45 |
| 每 token 激活参数，包含 tied embedding | 265.4M | 18.84 |
| 每 token 激活的非 embedding 参数 | 226.8M | 22.05 |

22.05 最接近 $C\approx6ND$ 的常用口径，只能说明 5B tokens 与 20:1 处于同一数量级。MoE 同时受 total parameters 和 active parameters 影响，不能把任意一个值直接代入 dense 经验式并宣称已经达到最优。要确定训练量，需要在固定计算预算下做多组 IsoFLOP 实验。

### 9.5 从 tokens/s 到训练计算量

5B tokens 除以 91.9 小时，端到端平均吞吐为：

$$
\frac{5.0\times10^9}{91.9\times3600}
\approx15,100\ \text{tokens/s}
$$

采用两种 active 参数口径，$C\approx6ND$ 给出的训练量为：

$$
\begin{aligned}
6\times226.8\text{M}\times5.0\text{B}
&\approx6.8\times10^{18}\ \text{FLOPs}\\
6\times265.4\text{M}\times5.0\text{B}
&\approx8.0\times10^{18}\ \text{FLOPs}
\end{aligned}
$$

对应约 20.6–24.1 model TFLOP/s。这个近似没有完整计入 attention、router、dispatch 和 gradient checkpointing 的重复 forward，因此 15.1k tokens/s 适合比较同一配置下的实现变化，不能单独用来比较不同架构或反推 MFU。

### 9.6 smoke test 与小规模 pilot 的分工

TinyStories 的 1000-step smoke test 中，loss 从约 10.85 降到 1.487，并能生成连贯短文。这说明数据错位、forward、backward、checkpoint 和生成链路可以运行，但不能证明正式训练配置合适。仍需通过 pilot 检查的选择包括：

| 训练选择 | 当前依据 | 还需要的证据 |
|---|---|---|
| 36 层、hidden size 768 | 对齐 GPT-2 Large 的深度 | 相同参数或 FLOPs 下的 depth / width sweep |
| peak LR $3\times10^{-4}$ | 单次正式配置 | 多个 learning rate 的短程 loss 曲线 |
| 131,072 tokens / update | 显存与累积可运行 | batch size sweep 或 gradient-noise 估计 |
| 5B tokens | 预先设定的训练预算 | 多个规模与 token 数的 IsoFLOP 点 |
| router auxiliary loss 0.01 | 初始配置 | 从随机初始化开始的路由消融 |

pilot 应保持 tokenizer、数据顺序和优化器定义不变，只扫描模型形状、学习率、batch 和 token 预算。smoke test 验证实现，pilot 选择配置，两者不能互相替代。

## 10. 结果：与 GPT-2 Large 在同一环境比较

正式训练日志末段的 train loss 为 **3.248**，固定验证集平均 val loss 为 **2.834**，后者对应约 17.0 PPL。train loss 高于 val loss 不足以说明训练异常：前者可能是最后一个或最后一段 noisy mini-batch，后者是整个固定验证集的平均；训练日志还可能包含 router auxiliary loss，而验证日志只报告 LM loss。只有先核对两者的聚合窗口和 loss 定义，才能讨论是否过拟合。

固定 prompt 的生成从 4B 到 5B tokens 仍在减少局部重复、改善句子衔接，但存在事实错误。生成样例适合发现重复、截断和解码故障，不适合作为总体能力分数：更换 prompt、temperature 或随机种子就可能得到不同文本，因此还需要固定数据集上的量化评测。

### 10.1 zero-shot 评测是怎样评分的

两套模型随后在同一版本 lm-eval-harness、相同任务定义和 zero-shot 设置下评测。zero-shot 表示 prompt 中没有附带已解答示例，也没有针对任务更新模型权重。

对 HellaSwag、PIQA、ARC 等选择题，给定问题上下文 $q$ 和候选答案 $c=(c_1,\ldots,c_m)$，模型逐 token 累加候选答案的 log-likelihood：

$$
s(c)=\sum_{j=1}^{m}
\log P(c_j\mid q,c_{<j})
$$

直接使用总和会偏向较短答案，因为每个 token 的 log 概率通常为负。acc_norm 使用对应 harness 版本与任务实现定义的 continuation length 做归一化，可概括为 $s(c)/\ell(c)$，再选择分数最大的候选；$\ell(c)$ 可能按字符或 byte 计算，不应在没有核对代码时写成 token 数。acc 与 acc_norm 是不同评分规则，不能在同一列里混用。

LAMBADA 不是多项选择题。它要求模型根据前文预测文本中预先标注的最后一个词，表中的 acc 表示该词是否完整匹配。BoolQ、Winogrande 等任务也各有自己的候选构造方式。因此复现时需要同时保存 harness commit、task version 和 prompt 模板，不能只记录任务名。

九项任务覆盖的能力并不相同：

| 任务 | 输入与判定 | 主要覆盖范围 |
|---|---|---|
| HellaSwag | 四个情境续写中选一个 | 常识事件续写 |
| LAMBADA | 根据一段叙事预测最后一个词 | 较长语篇中的末词预测 |
| Winogrande | 两个候选中补全指代 | 代词与常识消歧 |
| PIQA | 两个方案中选更合理者 | 日常物理常识 |
| ARC-easy / challenge | 多项选择科学题 | 基础科学知识与推理 |
| BoolQ | 根据短文回答 yes / no | 阅读理解与判断 |
| SciQ | 多项选择科学题 | 科学知识 |
| OpenBookQA | 多项选择题 | 基础事实与组合推理 |

它们大多用语言模型概率间接完成分类，不等于聊天式问答，也不测指令遵循。

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

ARC、SciQ 和 OpenBookQA 上的 0.40–1.87 个百分点小幅领先不能直接归因于 MoE。表中没有列标准误或置信区间，小差值可能包含有限测试集带来的采样波动；需要按样本结果做配对 bootstrap 或至少报告 harness 标准误，才能判断差异是否稳定。

GPT-2 报告描述的是约 40GB、800 万文档的 WebText，而不是可直接拿来对齐的“40B GPT-2 BPE tokens”。本项目使用 5B FineWeb-Edu tokens；两边的文档分布、去重、训练轮数、优化器和架构都不同。775M total 相近也不表示每 token 计算相近，因为本项目只有 265M active parameters，GPT-2 Large 的 dense MLP 则全部激活。

### 10.2 当前评测的边界

这组结果还缺少三项控制：

- FineWeb-Edu 可能包含 benchmark 题目，需要检查训练集与测试集重叠。
- 表中没有标准误或多随机种子结果，小幅分差未必稳定。
- GPT-2 Large 与本项目的数据、训练量和 active compute 都不同，不是受控的 dense / MoE 对照。

因此可以确认的是：模型已经学到可测量能力，LAMBADA 和 HellaSwag 仍是明显短板。不能确认的是：科学问答任务上的小幅领先是否稳定，以及这些差异是否来自 MoE。



## 11. MoE 专项诊断：专家是否真正被使用

语言模型 loss 下降不表示路由均衡，因此还要单独统计 router 输出。

训练结束后，在验证集约 205k tokens 上收集 36 层 router logits，对每个 token 统计 top-2 专家。设第 $l$ 层专家 $e$ 被选中的次数为 $c_{l,e}$，该层的选中占比为：

$$
u_{l,e}=\frac{c_{l,e}}{2N_{tok}}
$$

分母中的 2 来自每个 token 的两个 expert slots，因此一层 8 个 $u_{l,e}$ 之和为 1，均匀值是 12.5%。8 个专家都曾被选中，但负载并不均衡：最后一层约 47% 和 48% 的 slots 落在两个专家，其余专家各约 1%–3%，部分层最大/最小使用率接近 90 倍。这个统计能判断专家是否存活和负载是否均衡，不能证明专家已经形成语义分工。

早期分析曾把 router logits 写成 rl[0]，只统计一个 token，因而误判为只有少量专家存活。正确统计必须保留 token 维度：

~~~python
# rl: [num_tokens, num_experts]
top2 = torch.topk(rl, 2, dim=-1).indices
counts = torch.bincount(top2.flatten(), minlength=8)
~~~

修正统计后，项目从最终权重继续训练 500 步，将 auxiliary loss 系数从 0.01 提高到 0.1，并加入 0.001 router z-loss。平均 live experts 仍为 7.5–7.6/8，最大专家占比仍为 0.42–0.43。关键结论是：专家都存活，但负载不均；训练终点的 500-step 正则续训没有改变这一状态。下一轮需要从随机初始化开始比较不同路由正则。



## 12. 工程问题与复现

这次训练还遇到几类不会直接写进模型公式、却会改变结果或让任务中断的问题。

### 12.1 数据分页：streaming 仍依赖每一页地址

Hugging Face 镜像能返回第一页，但响应中的 next-page URL 指回官方域名；受限网络下，迭代器读完第一页才失败。只检查“能否打开数据集”发现不了这个问题。处理方式是在客户端保留 path 和 query，只重写分页链接的 host，并在正式 tokenization 前连续读取多页、核对文档计数。不能通过反复重试第一页代替修复，否则可能重复写入数据。

### 12.2 tokenizer 的 pad token 与 end-of-text

GPT-2 tokenizer 默认没有独立 pad token。需要 padding 的生成或评测 batch 若不显式处理，库可能报错或生成错误 attention mask。可以把 pad id 指向 end-of-text，但必须同时提供 attention mask，让 padding 位置不参与上下文和 loss。两者共用 id 不表示语义相同：是否被忽略由 mask 和 label 的 ignore index 决定。

本项目训练数据预先打包为等长窗口，训练主体不需要 padding；问题主要出现在不同长度 prompt 的批量生成和评测阶段。

### 12.3 训练输出与推理输出不是同一需求

训练 MoE 时需要 router logits 来计算 auxiliary loss 和诊断；自回归生成通常只需要词表 logits 与 KV cache。若生成时仍返回每层、每步的 router logits，框架在拼接 generation outputs 时可能遇到尺寸不一致，也会保留不需要的张量。推理路径因此关闭 output_router_logits，专项分析时再单独打开并明确处理它的 [tokens, experts] 形状。

### 12.4 日志与 checkpoint

nohup 把 stdout 指向文件后，Python 可能改用块缓冲，训练仍在运行但日志长时间不更新。使用 python -u 或显式 flush 即可。训练约每 1B tokens 保存 checkpoint、保留最近 3 个，单个完整 checkpoint 约 8.7GB。恢复训练需要模型、optimizer、scheduler、step 和随机状态，不能只保存模型权重。

transformers 与 lm-eval-harness 的输出和任务模板会随版本变化。复现记录至少包括：

- 环境和依赖的精确版本；
- 模型、初始化、优化器、学习率与随机种子；
- 数据 revision、train / validation 分配、文件 hash 与 benchmark overlap；
- 参数量口径、wall time、评测 task version 和逐样本结果。

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

四条命令只展示阶段顺序。正式复现还要固定配置、依赖、数据 revision 和随机种子，并保存最终权重、评测原始结果与专家计数。



## 13. 结论：这次实验说明了什么

训练目标始终是预测下一个 token。GPT-2 建立了 decoder-only 基线；RoPE、RMSNorm、SwiGLU 和 GQA 替换了位置、归一化、FFN 与 K/V 组织方式；MoE 再把 dense FFN 改成条件计算。变化的是内部结构和计算分配，不是训练目标。

本项目得到 775.0M total / 265.4M active parameters 的模型，在单张 RTX 5090 上训练 5B tokens、耗时 91.9 小时，最终 val loss 为 2.834。九项评测显示模型已学到可测量能力，但 LAMBADA 和 HellaSwag 仍落后于 GPT-2 Large；8 个专家全部存活，负载却高度不均。

当前实验不是相同数据和计算预算下的 dense / MoE 对照，也没有多个随机种子，因此不能把分数差异归因于 MoE。下一步应固定数据、token 预算、optimizer 和评测版本，对比 dense 265M 与 MoE 775M/265M-active，并从随机初始化开始测试路由正则。

## 14. 主要资料

- [Attention Is All You Need](https://arxiv.org/abs/1706.03762)：原始 encoder-decoder Transformer、scaled dot-product attention 与 multi-head attention。
- [Language Models are Unsupervised Multitask Learners](https://cdn.openai.com/better-language-models/language_models_are_unsupervised_multitask_learners.pdf)：GPT-2 架构、WebText 与 zero-shot 评测。
- [RoFormer](https://arxiv.org/abs/2104.09864)：Rotary Position Embedding。
- [Root Mean Square Layer Normalization](https://arxiv.org/abs/1910.07467)：RMSNorm。
- [GLU Variants Improve Transformer](https://arxiv.org/abs/2002.05202)：SwiGLU 等门控 FFN 变体。
- [GQA](https://arxiv.org/abs/2305.13245)：MHA、MQA 与 grouped-query attention 的关系。
- [Mixtral of Experts](https://arxiv.org/abs/2401.04088)：top-2 sparse MoE 架构与实验。
- [Switch Transformers](https://arxiv.org/abs/2101.03961)：稀疏路由、expert capacity 与负载均衡损失。
- [ST-MoE](https://arxiv.org/abs/2202.08906)：router z-loss 与稀疏模型训练稳定性。
- [The FineWeb Datasets](https://arxiv.org/abs/2406.17557)：FineWeb / FineWeb-Edu 的过滤与去重过程。
- [Training Compute-Optimal Large Language Models](https://arxiv.org/abs/2203.15556)：dense 模型中参数量与训练 token 数的 compute-optimal 关系。
- [lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness)：本文下游任务的评测实现；复现时仍需固定具体 commit 和 task version。
`,
}

export default article
