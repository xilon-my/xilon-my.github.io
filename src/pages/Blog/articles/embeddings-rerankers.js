const article = {
  slug: 'embeddings-rerankers',
  date: '2026-08-05 10:00',
  name: '从零理解 Embedding 与 Reranker：何时以及如何判断相关性',
  description: '嵌入模型(embedding)和重排模型(reranker)的深度拆解:为什么一个把判断提前到入库、一个留到查询时,它们分别怎么被训出来,近三年又怎么被蒸馏成同一份判断力。',
  tags: ['RAG'],
  category: 'Project',
  author: 'Shannon',
  detail:
`先看一个失败案例。查询"这笔订单的退款政策是什么"时,embedding 检索器返回的 top-3 分别讨论退货流程、运费险和优惠券,没有直接回答问题。答案实际存在于库中,但它与问题缺少字面重合。embedding 把整段文本压缩成单个向量,精确词可能被整体语义稀释;reranker 对同一候选集逐 token 比较问题和文档后,把答案排到了第一名。

前一篇《RAG from Scratch》讨论了检索质量对 RAG 的限制。这里涉及两个模型:embedding(双塔 bi-encoder)在入库时把文档编码成单个向量,reranker(单塔 cross-encoder)在查询时联合编码查询和文档并打分。两者都判断文档与问题的相关性,区别在于计算发生在入库阶段还是查询阶段。

本文不重复 RAG 流水线的搭建过程,而是讨论双塔和单塔的结构、训练方式及规模变化,最后说明如何通过蒸馏在两种架构之间传递相关性判断能力。

## 同一个问题,两种判断方式:双塔与单塔

判断"相不相关"这件事,可以发生在两个时刻:入库时(先把所有文档变成可比较的形式),或者查询时(拿到问题再逐个细看)。embedding 选了前者,reranker 选了后者。

要把这两个模型讲明白,得先分清两对概念:一对是"入库/查询"——什么时候判断;另一对是"训练时/推理时"——同一个模型,训练时是一种结构、推理时是另一种用法。下面每个模型都按训练、推理两面拆开讲。

### 从 transformer 出发:两个模型都是它加一小层

假设你只知道 transformer,我们就从它出发。一个 transformer 模型做一件事:输入一串 token(词的编号),经过多层注意力,输出一串向量——每个 token 对应一个"上下文向量",编码的是"这个 token 在这个句子里、结合上下文是什么意思"。下文的一切都从这两句长出来。

先区分两个术语:transformer 输入层把 token 转成向量的表叫 token embedding;本文讨论的 embedding 模型则把**整段文本**编码成一个向量。

把 transformer 的输出(一串 token 向量)变成"一个向量"或"一个分数",各需要多加一小层,这正是两个模型的分界:

- **embedding 模型 = transformer + 池化层**。池化把"一串 token 向量"并成"一个向量"。一句话进来:先过 transformer,得到每个 token 的上下文向量;再池化成一个向量——这就是"这句话的嵌入"。
- **reranker = transformer + 打分头**。把 query 和 passage 拼进**同一个序列**,过 transformer,再拿整串的某种表示过一个打分头,输出一个相关性分数。

两者的核心区别是:**embedding 分别编码两个文本,最后比较向量;reranker 联合编码两个文本,直接输出分数。** 这一差别决定了各自的训练和推理方式。

### 双塔:训练时成对输入,推理时单独编码

"双塔"主要描述训练结构。**训练时**输入成对数据:(query, 正文档)的表示应靠近,(query, 负文档)的表示应远离。两个文本通过共享权重的编码器分别得到向量,再用对比损失调整权重。图中画成两座塔,实际使用的是同一套编码器参数。

**推理时**一次只编码一个文本,文档向量可以提前计算,查询向量则在请求到达时计算。

1. 入库:每个文档**单独**过一遍编码器,得到一个向量,存进向量库。文档之间互不相干,一个接一个来。
2. 查询:查询**单独**过一遍编码器,得到一个向量。
3. 比较:不在模型里。FAISS 拿查询向量对着一批**早就存好的**文档向量做内积,挑出最像的 k 个。

那为什么还叫"双塔"?因为检索天然涉及两个文本(查询、文档),它们必须被**同一个**编码器编码,才落在同一个向量空间、才比得了。图上的两座塔其实是同一个 transformer 画了两遍——左边编码查询、右边编码文档,权重是同一套。推理时你每次只跑这一个模型:入库时跑一遍每个文档,查询时跑一遍查询。不是"从两个 BERT 里挑一个",而是**本来就只有一个模型**。这也划清了两者的分工:模型的职责是决定"什么算相似"(训练时把语义写进权重),FAISS 的职责是在画好的空间里机械地找最近的 k 个——它只做算术,不懂语义。

![SBERT 孪生双塔架构](/images/sbert-arch-8bit.png)
*图:SBERT 用共享权重的两个 BERT 把句子各自编码成向量(arXiv:1908.10084,Figure 1)*

为什么非要"分开编码、最后比",而不是"拼一起一次算完"?因为这换来一个关键能力:**预计算**。2019 年之前,"两句话相不相似"用的是原生 BERT——把两句话拼成一个序列丢进去。它很准,但成本极高:在一万句话里找最相似的一对,要跑约 5000 万次两两拼接的推理,约 65 小时。SBERT(Sentence-BERT,2019,arXiv:1908.10084)用共享权重的双塔把它拆开:文档各自提前编码成向量存好(离线一遍,一万句约 5 秒),查询时只编查询、和存好的向量比(0.01 秒)。简言之:双塔换来文档可离线预计算、查询毫秒级——这正是 RAG 里"入库"这一步的由来。

池化把一组 token 向量合并为单个向量。常见方法有三种,选择取决于骨干模型和训练方式:
- **mean pooling**:把一句话 20 个 token 过 transformer 得到的 20 个 768 维上下文向量,按维度取平均,并成一个 768 维的句子向量;
- **取 [CLS]**:不平均,直接拿第 1 个位置那个 token 的向量([CLS] 是 BERT 在句首放的一个分类符,attention 让它看过整句);
- **取最后一个 token**:拿最后一个位置的向量,LLM 底座的惯例。

无论使用哪种方式,结果都是把一组 token 向量合并成单个文本向量。池化方式、损失函数和训练数据共同决定向量质量。

池化方式会随骨干模型变化。**2019～2023 年的主流是 BERT 类双向编码器**(SBERT、E5、bge、SimCSE),通常使用 [CLS] 或 mean pooling;**2024 年起,E5-Mistral、GTE-Qwen2、Qwen3-Embedding 开始使用解码器 LLM**(Mistral、Qwen2/3),并读取最后一个 token。解码器 LLM 的预训练规模更大,支持指令和 32K 长上下文,但也带来两个适配问题:

- **因果 mask**:解码器里每个 token 只能看左边,整个序列只有最后一个 token 才"全看过"。所以解码器底座的嵌入取**最后一个 token(即 [EOS])**当整句表示——[CLS] 是编码器的概念,解码器没有。也有模型干脆把解码器改成双向注意力、整段编码后再加一个 latent pooling([NV-Embed](https://github.com/NVIDIA/NV-Embed) 就是这么干的)。
- **EOS-last 的 recency bias**:读取最后一个 token 时,表示容易被靠近结尾的词主导(因果注意力下越靠后的词看到的越多)。批内句子长度不一且采用 left-padding 时,必须根据 attention mask 定位真实末尾,不能直接读取 [:, -1]。

这些问题只适用于解码器骨干,bge-m3 等仍使用编码器的模型不受影响。

向量维度不是超参,是骨干模型的隐藏层宽度:BERT-base 是 768、bge-m3 是 1024、GTE-Qwen2-7B 是 3584、Qwen3-8B 是 4096。维度是"够用 vs 成本"的权衡——前一篇讲过,1024 维 float32 约 4GB/百万向量。MRL 在这里先提一句:同样是改损失不改架构,可以逼着模型把判别信息挤进前几维,让你按需裁剪向量——细节留到训练那一节。

### 单塔:训练时学排序,推理时拼起来现算

"单塔"(cross-encoder)的名字来自结构:query 和 passage 拼成**同一个序列**([CLS] query [SEP] passage [SEP],[SEP] 是 BERT 用来隔开两段文本的分隔符),过同一个 transformer——两个文本并成了一个输入,所以是"一座塔"。这带来和双塔截然不同的一点:注意力跨两段文本互通,query 的每个 token 可以直接 attend 到 passage 的每个 token,"逐 token 互看"是字面意思,信息不需要先各自压缩。

**训练时**学习的是排序,不是向量。数据由一个 query、一组文档及其相关标签或顺序组成。常见方式有三种:
- pointwise:每篇文档单独标"相关/不相关",当二分类训;
- pairwise:给一对(正, 负),学"A 比 B 相关";
- listwise:给一整组和它们的顺序,学"该排前面的排前面"。
三种的共同目标,都是让模型打出的分数顺序符合真实顺序。为什么按排序训?因为推理时它要面对的从来不是"这一个相关不相关",而是一整排候选要排出先后。

**推理时**就是字面的样子:每个 (query, 候选文档) 拼起来、过一遍,得一个相关分数。难点在"怎么打分"——transformer 输出的是每个 token 的向量,不是一个分数,得靠"打分头"决定读它的哪个输出、怎么把它变成一个数。两种姿势:

- **分类头**:拿序列里某一个 token 的向量(通常是 [CLS] 那个——它在句首,attention 看过整串,等于整串的浓缩意见),过一个很小的线性层,把 768 维映射成两个数:分给"相关"和"不相关"两个类别的 logits(logits 是模型最后一层输出的未归一化原始分数,数值越大越像那类)。[bge-reranker-v2-m3](https://github.com/FlagOpen/FlagEmbedding) 就取两类 logits 的差值当相关分。
- **生成头**:不给模型接任何新层,而是让它**继续生成下一个词**。MonoT5 训练时被告知"相关就输出 true、不相关就输出 false",所以推理时看模型在下一个词位置上分给 "true" 和 "false" 的概率(logits),取两者之差当分数。

为什么能设计出这两种头?因为 transformer 的输出本来就有两种读法:把最后一层的向量当特征、自己在后面接个分类器(分类头);或者把模型当文本生成器、直接从它的下一个词分布里读答案(生成头)。两条路问的是同一个问题——"这个 (query, 文档) 对,你觉得相不相关?"——只是换了个姿势问。

ColBERT 论文用一张图比较四种神经 IR 匹配范式:(a) 表示式把查询和文档分别编码成单个向量,本文的 embedding 双塔属于这一类;(c) 全交互式把两者拼成一个序列输入 transformer,对应本文的单塔;(d) 晚期交互先分别编码为 token 向量,查询时通过 MaxSim 逐对取最大相似度再求和;(b) 词级交互为词对建立交互矩阵,代表方法包括 DRMM 和 KNRM,本文不展开。后文重点比较 (a) 双塔、(c) 单塔与 (d) 晚期交互。

![神经 IR 匹配范式全景](/images/colbert-paradigms-8bit.png)
*图:神经 IR 的四种匹配范式——(a) 表示式、(b) 词级交互式、(c) 全交互式、(d) 晚期交互(arXiv:2004.12832,Figure 2)*

embedding 和 reranker 可以放在同一条"判断时机 × 交互粒度"的取舍曲线上:双塔在入库时预计算表示,查询成本较低;单塔在查询时联合编码,交互更细但成本较高;晚期交互位于两者之间。

## 曲线的中点:晚期交互

单向量的粒度较粗,逐对完整前向的计算成本较高,晚期交互(late interaction)位于两者之间。[ColBERT](https://github.com/stanford-futuredata/ColBERT)(2020,arXiv:2004.12832)在入库时为每个 token 保存一个向量;查询时让 query 和 passage 的 token 逐对计算相似度,取最大值后求和(MaxSim)。它同时保留双塔的预计算能力和单塔的细粒度比较。

![ColBERT 架构](/images/colbert-arch-8bit.png)
*图:ColBERT 的晚期交互,查询和文档的 token 向量逐对 MaxSim(arXiv:2004.12832,Figure 3)*

token 向量可以像双塔一样预计算并建立索引,用于从全库检索 top-k;MaxSim 又可以像单塔一样对 top-k 逐对精排。它没有池化层,也不生成单向量,因此检索分成两级:入库时先对文档 token 向量聚类(ColBERTv2 使用 PLAID 索引),查询时每个 query token 先找到最近的簇并确定候选文档,再对候选计算精确 MaxSim。Cohere 的商业 rerank 和 bge-m3 都采用了晚期交互相关结构。

## 怎么训出这份判断

第一节说明了两个模型在训练和推理阶段的结构。本节进一步讨论损失函数、负样本和数据如何定义相似性。"语义"并非预先固定,而是由正负样本的构造方式决定。把意思相近的句子作为正样本,与把能回答问题的文档作为正样本,会得到不同的向量空间。因此损失函数、负样本质量和数据构造会直接影响模型效果。

embedding、reranker、ColBERT 的训练信号本质是同一个——让相关的 (query, 文档) 得分高于不相关的。区别只在两处:打分函数(单向量点积 / cross-attention / MaxSim),和损失的形态。"对比学习"这个词通常指 embedding 那边的 InfoNCE 或三元组;reranker 那边更多叫"排序学习"(learning to rank),其中 pairwise 和 listwise 也是对比思想,pointwise 则是纯分类。下面会看到,它们共用同一个底子。

### 双塔:把"语义"训进向量空间

双塔训练的目标是拉近正样本对、推远负样本对。下面具体展开损失函数。

未经句向量训练的 BERT 表示具有各向异性:任意两句话无论是否相关,余弦相似度都可能接近约 0.42,向量集中在空间的局部区域。对比学习缩短相关样本之间的距离、增大不相关样本之间的距离,并使表示分布更均匀,从而提高余弦相似度的区分能力。

常用损失是 InfoNCE(van den Oord 2018,arXiv:1807.03748),目标是让每个 query 的正文档在 batch 中排名第一。一个 batch 中除正文档外,其他文档自动作为负样本;计算 query 与所有文档的相似度并经过 softmax 后,正文档对应项应取得最大分数。这可以看作一个分类问题。

损失中的温度参数 τ(检索任务常见 0.05～0.1)控制 logits 的缩放。τ 越小,softmax 分布越尖锐,模型需要形成更大的正负样本分数差;τ 过大时,分数分布较平缓,区分信号减弱。E5 预训练使用 0.01,bge-m3 微调和 SimCSE 使用 0.05。

增加负样本通常会提高区分难度和训练信号,因此实际训练常使用较大的 batch。下面讨论负样本的来源。

最常见的是批内负样本:同一个 batch 中其他样本的编码直接作为负样本,不需要额外前向计算。SimCSE 无监督版使用 64 的 batch,E5 预训练则通过跨设备收集扩展到 32768([FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) 的 negatives_cross_device 参数)。[sentence-transformers](https://github.com/UKPLab/sentence-transformers) 的 MultipleNegativesRankingLoss 是 InfoNCE 的封装:

\`\`\`python
import torch
import torch.nn.functional as F

def contrastive_loss(q, k, temperature=0.05):
    # q, k: 同一 batch 的两个视角,已做 L2 归一化
    # 对角线是正样本对;同 batch 其它行自动成为负样本(in-batch negatives)
    logits = q @ k.T / temperature            # (batch, batch) 相似度矩阵
    labels = torch.arange(logits.shape[0])    # 正样本的位置在对角线上
    return F.cross_entropy(logits, labels)

# SimCSE 里"两个视角"是同一句话过两次编码器:
# q = encoder(sentences)   # 一次 dropout mask
# k = encoder(sentences)   # 另一次 dropout mask
# loss = contrastive_loss(q, k)
\`\`\`

这十几行值得拆开看:q @ k.T 算出一个 batch×batch 的相似度矩阵,第 i 行第 j 列是第 i 个查询和第 j 个文档的相似度;对角线是正样本对;cross_entropy 对每一行做 softmax,把"对角线尽量大、同行其他位置尽量小"当成目标。前面说的温度参数 τ,就在 temperature 这个参数里。

SimCSE(2021,arXiv:2104.08821)使用 dropout 构造正样本:同一句话经过编码器两次,因 dropout mask 不同而得到两个表示,两者构成正样本对。dropout 需要保持启用;关闭 dropout(p=0)或固定 mask 会导致表示塌缩。无监督版在 STS-B 上得到 76.3 分,有监督版为 81.6;有监督版还把 NLI 中的矛盾句对作为难负样本,使另一组 STS-B 实验从 84.9 提高到 86.2。

![SimCSE 无监督和有监督对比](/images/simcse-8bit.png)
*图:SimCSE——左为无监督(同一句两个 dropout mask 互为正对),右为有监督(蕴含对为正、矛盾对为负)(arXiv:2104.08821,Figure 1)*

#### 难负样本:提高细粒度区分能力

随机负样本通常与 anchor 相距较远,产生的训练梯度较小。难负样本与正样本表面相似但标签相反,可以提供更细的区分信号。例如,anchor 为"狗追猫"时,"股票今天大涨"与其差异明显,而"猫追狗"只改变主客体关系,更适合训练模型识别语义差异。

难负样本有三种常见来源,成本依次增加:
1. **数据里天然就有**:NLI 的矛盾对、问答数据里"答非所问"的文档。
2. **检索器生成**:[FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) 的 hn_mine.py 对全库建立 FAISS 索引,取 top-2～200 区间作为候选,并排除与正样本过于相似的伪负样本。生成候选的检索模型需要具有足够的区分能力。
3. **LLM 生成**:E5-Mistral 让 GPT-3.5/4 生成约 50 万条合成数据(含 15 万条指令、约 1.8 亿 token),覆盖 93 种语言。

训练数据主要来自三类来源:弱监督 web 数据([E5](https://github.com/microsoft/unilm) 的 CCPairs 从 13 亿对经一致性过滤得到 2.7 亿对,E5 论文报告其零样本 BEIR 指标高于 BM25)、LLM 合成数据(Qwen3-32B 合成 1.5 亿对)和公开标注数据(MS MARCO、NQ、SNLI·MNLI)。

需要说明这些训练规模的限制。E5-Mistral 使用约 1.8 亿 token 的合成数据,按当时 API 价格估算,生成成本达到百万美元量级,之后还要做一致性过滤和去重。个人实验可以使用约 1 万对标注和单张 GPU 微调较小模型,也可以用 LoRA 减少训练参数。是否满足需求应在目标语料上用 Recall@5 等指标验证。

#### 指令前缀:保持训练与推理格式一致

检索型嵌入在训练时会区分查询侧和文档侧。E5 给查询加 "query:",给文档加 "passage:";bge 只给查询加入英文指令 "Represent this sentence for searching relevant passages:";Qwen3 进一步加入指令感知,报告提升 3%～5%。这些前缀属于训练配置,推理时应保持一致,否则效果可能退化。

#### MRL:单个向量,按需裁剪

维度选择需要权衡表示能力与成本。Matryoshka Representation Learning(MRL,2022,arXiv:2205.13147)在训练时对不同长度的前缀分别计算损失(如 64/128/256/512/1024 维),使前部维度优先承载判别信息。因此同一向量既可以截取前 128 维以减少存储,也可以使用完整维度提高精度。

![MRL 嵌套表示](/images/mrl-nested-8bit.png)
*图:MRL 让表示按维度嵌套,前几维就能承载大部分判别信息(arXiv:2205.13147,Figure 1)*

这里有两个要求:**只有经过 MRL 训练的模型才能按前缀截断**;截断后必须重新做 L2 归一化。未经 MRL 训练时直接删除尾部维度会丢失未按顺序组织的信息。OpenAI text-embedding-3-large 官方声称 3072 维裁到 1024 维仍保有 95%～98% 的质量,可节省约 67% 的存储。

批内负样本的限制是正样本可能出现在 batch 中并被误作负样本,从而引入错误信号;大 batch 也会增加显存占用和训练时间。

### 单塔:排序损失与知识蒸馏

常见 reranker 使用两种训练方式:[bge-reranker](https://github.com/FlagOpen/FlagEmbedding) 家族使用 pointwise,把相关性当作二分类;Qwen3-Reranker 使用 listwise,为一个 query 配置 1 个正样本和 n 个负样本,再对 n+1 个分数做带温度的 softmax,目标是让正样本排第一。listwise 与实际排序任务更接近。

难负样本在这里同样关键:负例质量决定判别力。[FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding) 的训练数据每行是一个 JSON:{"query", "pos", "neg", "prompt"},关键参数 train_group_size 8、query_max_len 32、passage_max_len 128、学习率 5e-6、5 个 epoch。

训练单塔的另一个趋势是 LLM 当老师。[RankRAG](https://github.com/zjukg/rankRAG)(NeurIPS 2024)把排序和生成训练进同一个 LLM,在 5 个 RAG 基准上追平 GPT-4;ReasonRank 用 DeepSeek-R1 生成带推理过程的排序数据,筛掉不稳定的再训。

#### 从单塔向双塔蒸馏

蒸馏的目标是**把 cross-encoder 的判别能力迁移到 bi-encoder**。单塔精度较高,但需要对每个候选做联合计算;双塔可以预计算文档,成本较低,但判别能力通常较弱。知识蒸馏用单塔分数监督双塔训练。

具体做法是让单塔为每个 (query, 文档) 对打分,再训练双塔输出接近的结果。Hofstätter 2020(arXiv:2010.02666)发现,与其模仿教师模型的绝对分数,不如模仿相关文档和不相关文档之间的分数差。不同模型的分数尺度不同,相对差值通常更稳定。

[TCT-ColBERT](https://github.com/castorini/tct_colbert)(arXiv:2010.11386) 发现,只使用难负样本而没有教师模型筛选时,双塔效果反而下降。原因是难负样本本身包含噪声,需要更准确的模型判断哪些样本应当分开。[RocketQA](https://github.com/PaddlePaddle/RocketQA)(2021)用迭代去噪处理同一问题。到 2024 年,自蒸馏只用 13.5% 的数据就能达到完整蒸馏的水平。

蒸馏把 cross-encoder 的评分函数迁移到 bi-encoder,使两种架构共享一部分相关性判断能力。

bge-reranker-v2-m3 没有使用跨语言数据训练,因此跨语言效果较弱。这也说明模型卡指标不能覆盖所有实际场景。

## 推理成本

下面比较两种架构的推理成本。

**双塔**:入库时把全库向量算完,查询时只剩"query 编码一次 + ANN 检索"(前一篇讲过)。文档只编码一次,之后每次查询都不再碰它们,成本不随查询次数涨。

**单塔**:每个 (query, 候选) 都要经过一次完整 transformer 前向,候选数量会直接增加计算次数。分数由 query 和 passage 联合计算,无法提前缓存。因此生产环境通常只对第一阶段返回的 top-100 做精排,延迟预算约为 100～400ms;bge-reranker-v2-m3 的输入上限 max_length=1024;[jina-reranker-v2](https://github.com/jina-ai/jina-embeddings) 对超长文档使用滑动窗口(overlap 默认 80),并取各块最高分。

L2 归一化值得补一个新角度:前一篇讲它为了能用内积索引,更本质的是——**扔掉长度,只留方向**。同一句语义,无论写多写少,方向应该一致。bge v1.5 专门为此重训,让相似/不相似的分数分布可分。

工程细节三条:
- **批量推理**:batch 摊薄 transformer 开销。
- **缓存**:块的哈希命中就跳过推理;注意改分块参数后要整体重新入库。
- **MRL 维度裁剪**:只有经过 MRL 训练的模型才能截断。text-embedding-3-small 官方声称裁到 512 维可保留约 97.6% 的质量,并节省约 2/3 存储。

存储账:1024 维 float32 约 4GB/百万向量(前一篇讲过)。用 MRL 前 128 维建 ANN 索引,1000 万条约 5.1GB,全维要 41GB,约省 8 倍。注意细节:**索引建在截断维度上,全维向量另存,粗筛 top-200 后拿全维精打分**。FAISS 里就几句话:

\`\`\`python
import faiss
import numpy as np

dim = 128                          # 只取 MRL 的前 128 维做索引
index = faiss.IndexFlatIP(dim)     # 归一化后内积 = 余弦
index.add(full_vectors[:, :dim])   # 截断维度建 ANN;全维向量另存
_, I = index.search(query[:dim][None], 200)   # 粗筛 top-200
# 再用全维向量对 top-200 精打分、排序,取前几个
\`\`\`

## MTEB 与目标语料评测

嵌入模型的通用榜单是 [MTEB](https://github.com/embeddings-benchmark/mteb)(2022,arXiv:2210.07316),它对 8 类任务、58 个数据集计算平均分。**检索只是其中一类任务**,总分采用等权平均;模型可能在聚类或重排上得分较高,但检索得分较低。因此需要查看检索分项(复用 BEIR,主指标为 nDCG@10)。中文可以参考 C-MTEB(arXiv:2309.07597,35 个数据集、6 类任务),跨语言可以参考 MIRACL;2025 年发布的 MMTEB 覆盖 500+ 任务和 250+ 语言。

MTEB 排名不能直接代表目标语料效果,主要有三个原因:
1. **英语中心**:中文要用 C-MTEB 这类中文榜。
2. **零样本域外**:BEIR 显示,只在 MS MARCO 训练的 dense 模型迁移到域外语料时可能明显退化,部分场景低于 BM25。目标语料通常也属于域外数据。
3. **榜单污染与配置不一致**:换实现、换归一化方式,分数就有出入。

厂商报告的数字(Qwen3-Reranker 对比 bge-reranker-v2-m3 的 +21.0% MTEB-R、bge-m3 三合一、OpenAI 的裁维数字)应视为其指定配置下的评测结果,还需要在目标语料上复测。

实际选型时,可以先准备约 50 条真实 query,计算 Recall@5 和 nDCG@10。公开榜单的分数和区间需要在目标数据上重新验证。

还需要注意五项限制:① 各向异性会让句向量集中在相近区域;② 批内负样本可能误伤正样本,大 batch 成本较高;③ 向量维度不可单独解释;④ bge-reranker-v2-m3 的跨语言能力较弱;⑤ 单向量召回存在规模限制,512 维约从 50 万篇、1024 维约从 400 万篇文档开始出现召回下降(Weller 等,arXiv:2508.21038)。

## 2024-2026:这两个模型在怎么变

近三年的变化,可以压缩成三个因果。

**因果一:合成数据解除了数据瓶颈,decoder 骨干吃长上下文,MRL 成标配。** 2024 年 1 月 E5-Mistral(arXiv:2401.00368)证明用 GPT-4 合成数据 + 少于 1000 步微调就能刷榜(注意它几乎没有标注数据);同年 6 月 [GTE-Qwen2](https://github.com/Alibaba-NLP/gte) 把骨干换成 Qwen2(7B、3584 维、32K 上下文);8 月 [NV-Embed-v2](https://github.com/NVIDIA/NV-Embed) 证明只用公开数据也能达到同样高度;2025 年 6 月 [Qwen3-Embedding](https://github.com/QwenLM/Qwen3)(0.6/4/8B、32K 上下文、MRL 32～4096 维、Apache-2.0)把这套组合固定成新基线。

**因果二:评估压力倒逼变大变全。** 榜在涨,模型就必须跟着涨。reranker 同步变大:Qwen3-Reranker(0.6/4/8B)MTEB-R 8B 达 69.02(对比 bge-reranker-v2-m3 的 +21.0%,自家评测)。指令感知从 INSTRUCTOR(2022)到 bge-en-icl 再到 Qwen3,成了标配能力。

**因果三:蒸馏主流化,开源与 API 的差距基本弥合。** RAG-Retrieval 这类框架把 7B LLM reranker 蒸馏成边缘小模型;cross 是精排标杆、bi 是蒸馏出的廉价近似。开源侧 NV-Embed-v2 72.31、Harrier 27B 74.3、Jina v5 71.7(均为官方宣称),和商业 API 的差距已经不大。

还有一个重要的单模型形态:**bge-m3**(0.567B、1024 维、8192 上下文、100+ 语言)——一次推理同时产出 dense、sparse、ColBERT 三种表示(稀疏是对关键词检索的覆盖,ColBERT 引擎就是第二节那个"中点"),三合一在 MIRACL/MKQA/MLRB 上全面超单模式(自家评测)。这一代模型不再问你"选哪个范式",而是全都给。

MRL 变维常态化:OpenAI text-embedding-3 官方声称 3072 维裁到 256 维仍超 ada-002 完整的 1536 维(64.6 vs 61.0);Nomic 768 → 64(官方声称)。

多模态和 agent 各留一句:Cohere Embed v4 把文本和图像放进同一个空间,Gemini Embedding 2、Jina v5-omni 同路;agent 里 embedder 还被拿来选工具/函数——"工具描述"当文档、"用户意图"当查询,判断对象在变,判断方式的取舍没变。

诚实的展望:模型越来越大、越来越贵——4～8B 的 embedding 对个人开发者不现实,GTE-Qwen2-7B FP32 要约 28GB 显存,入库、存储、推理全涨。选型重心正在从"MTEB 分数"转向合规、延迟、运维;4-bit 量化 + MRL 成了新标配。

## 结论:判断发生在哪,决定模型长什么样

池化、维度、负样本、蒸馏和模型规模都与"判断发生在何时 × 比较粒度"有关。双塔在入库时把文档编码成单个向量,换取查询速度;单塔在查询时联合编码文本,换取更细的比较;晚期交互位于两者之间。蒸馏则把 cross-encoder 的部分判别能力迁移到 bi-encoder。

选型上:本地用 [bge-m3](https://github.com/FlagOpen/FlagEmbedding)(1024 维、MIT、三合一,前一篇讲过)或 Qwen3 小档(0.6B、1024 维、Apache);走 API 用 text-embedding-3(3072/1536 + MRL)或 Cohere/Gemini。2026 年的生产基线是混合检索 + 强制 rerank(前一篇讲过,和这里不打架)。

回到开头的失败场景:答案存在于语料库中,但没有被正确召回。embedding 和 reranker 都可以更换、微调或蒸馏。应先用约 50 条真实 query 测量检索指标,再决定优化哪一部分。`,
  takeaway: 'Embedding(bi-encoder)和 reranker(cross-encoder)都判断文档与问题的相关性,差别在于判断发生在入库阶段还是查询阶段,以及使用单向量还是逐 token 比较。晚期交互位于两者之间。训练数据中的正负样本定义了模型学习的语义:InfoNCE、难负样本和合成数据用于训练双塔,排序损失和知识蒸馏用于训练单塔;蒸馏可以让两个架构共享一部分判断能力。榜单分数不等于目标语料效果,应使用约 50 条真实 query 做初步评测。',
}

export default article
