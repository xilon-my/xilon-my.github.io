const project = {
  slug: 'verl',
  date: '2026-08-28 20:00',
  name: 'verl',
  url: 'https://github.com/verl-project/verl',
  url2: 'https://arxiv.org/abs/2409.19256',
  description: 'verl 是面向大语言模型强化学习后训练的分布式训练框架。本文从两个 prompt、每题四条 rollout 的一轮 GRPO 开始，逐项追踪 actor、rollout、reference policy、critic 与 reward 的输入输出，再说明 HybridFlow 如何把算法控制流、分布式模型计算和 GPU 放置分开。最后讨论 FSDP、Megatron、vLLM、SGLang、权重同步、共置部署以及排查训练吞吐的方法。',
  tags: ['Post-training'],
  stars: '22.7k',
  author: 'Shannon',
  detail: String.raw`
## 1. verl 处理的是一轮 RL 训练怎样运行

PPO 和 GRPO 给出了策略更新公式，但从公式到大模型训练之间还有一段工程过程。一次更新可能同时需要：

- actor 根据 prompt 生成回答；
- reward function 或 reward model 给回答打分；
- reference policy 计算参考概率；
- critic 估计每个 token 状态的价值，GRPO 则省略这一项；
- actor 重新计算 token 概率并反向传播；
- 多张 GPU 在生成布局与训练布局之间同步权重。

这些工作使用的并行方式并不相同。生成引擎关心 KV cache、continuous batching 和 tensor parallel；训练引擎还要保存梯度、优化器状态，并执行 data parallel、tensor parallel 或 pipeline parallel。单独调用 vLLM 能得到 rollout，单独调用 FSDP 能更新模型，但两者之间还需要数据传递、资源放置和权重同步。

verl 处理的就是这一层。它不是新的强化学习算法，也不是新的推理引擎。它把 PPO、GRPO 等算法表示成数据流，再把数据流中的各项模型计算交给 FSDP、Megatron、vLLM 或 SGLang 等后端。

## 2. 从两个 prompt 的 GRPO batch 开始

假设一个 batch 有两个数学题，每题从当前策略采样四条回答。记 prompt 数为 $B=2$，每个 prompt 的采样数为 $G=4$，那么本轮共有：

$$
N=B\times G=2\times4=8
$$

条 rollout。若每条回答最多生成 256 个 token，生成阶段最多处理 2048 个 response token；实际数量由每条回答何时生成 EOS 决定。

一轮同步 GRPO 可以写成：

| 次序 | 执行角色 | 输入 | 输出 |
|---:|---|---|---|
| 1 | rollout | 2 个 prompt、actor 权重 | 8 条回答、采样时的 log probability |
| 2 | reward | prompt 与回答 | 8 个奖励 |
| 3 | reference policy | 8 条完整序列 | 每个 response token 的参考 log probability |
| 4 | controller | 奖励、mask、样本分组 | 每条回答的 advantage |
| 5 | actor | token、旧概率、advantage | policy loss、梯度、新权重 |

GRPO 不需要 critic。若算法换成 PPO，表中还要加入 critic 的前向计算、GAE 和 critic 更新。verl 的价值在于这些角色可以复用同一套 worker 与资源抽象，而训练器只需描述本轮先后调用哪些角色。

## 3. 一条 rollout 中有哪些张量

先看第 $i$ 条回答。prompt token 记为 $x_i$，模型生成的 response token 记为：

$$
y_i=(y_{i,1},y_{i,2},\dots,y_{i,T_i})
$$

$T_i$ 是这条回答的实际长度。对第 $t$ 个 response token，rollout policy 在采样时给出的 log probability 是：

$$
\ell^{\mathrm{rollout}}_{i,t}
=\log \pi_{\mathrm{rollout}}(y_{i,t}\mid x_i,y_{i,<t})
$$

reference policy 对同一个 token 计算：

$$
\ell^{\mathrm{ref}}_{i,t}
=\log \pi_{\mathrm{ref}}(y_{i,t}\mid x_i,y_{i,<t})
$$

actor 更新时还会用当前参数重新计算：

$$
\ell^{\theta}_{i,t}
=\log \pi_{\theta}(y_{i,t}\mid x_i,y_{i,<t})
$$

这三个量不能混为一项。rollout probability 说明数据由哪个策略采出；reference probability 约束模型不要偏离初始策略过远；当前 probability 参与梯度计算。在严格同步、每轮只更新一次的简单情况中，rollout policy 与更新前 actor 相同，但异步 rollout 或一批数据做多轮更新后，它们可能不再相同。

不同回答长度不同，因此 batch 还需要 response mask $m_{i,t}$：真实 token 为 1，padding 为 0。所有 loss 和统计量都必须乘 mask，否则较短回答尾部的 padding 会进入均值。

verl 使用 \`DataProto\` 在控制器和 worker 之间传递这类 batch。可以把它理解成带协议的批数据：张量部分保存 token、mask、log probability 和 advantage，非张量部分保存原始 prompt、样本 ID、数据来源等信息。协议的作用不是改变数学公式，而是让不同 worker 对 batch 的字段、切分和合并方式达成一致。

## 4. 奖励怎样变成 GRPO advantage

对同一个 prompt 的四条回答，假设规则奖励为：

$$
r=[1,1,0,0]
$$

组内平均值为：

$$
\bar r=\frac{1+1+0+0}{4}=0.5
$$

按总体标准差计算：

$$
\sigma_r
=\sqrt{\frac{(1-0.5)^2+(1-0.5)^2+(0-0.5)^2+(0-0.5)^2}{4}}
=0.5
$$

于是四条回答的 advantage 为：

$$
A_i=\frac{r_i-\bar r}{\sigma_r}
$$

$$
A=[1,1,-1,-1]
$$

outcome reward 只在回答级给分，所以一条回答中的所有有效 token 共用同一个 $A_i$。actor 的 PPO-clip 形式可写为：

$$
\rho_{i,t}(\theta)
=\exp\left(\ell^\theta_{i,t}-\ell^{\mathrm{old}}_{i,t}\right)
$$

$$
L_{i,t}
=-\min\left(
\rho_{i,t}A_i,
\operatorname{clip}(\rho_{i,t},1-\epsilon,1+\epsilon)A_i
\right)
$$

$\rho_{i,t}$ 是当前策略与旧策略对已采样 token 的概率比，$\epsilon$ 限制一次更新允许的变化范围。最终 loss 还要按 response mask 聚合，并可加入 reference policy 的 KL 项。

这里的公式与站内 GRPO 文章相同。verl 增加的是执行过程：怎样取得三组 log probability、怎样让同一 prompt 的四条回答保持同一个 group ID、怎样在八条变长序列之间做负载均衡，以及怎样把结果送回 actor worker。

## 5. 同步训练循环是一张数据流图

把上一节的过程展开，一轮常见的同步流程为：

\`\`\`text
prompts
   │
   ▼
rollout.generate_sequences
   │ responses + rollout log probs
   ├──────────────► reward.score
   └──────────────► reference.compute_log_prob
                         │
reward ◄─────────────────┘
   │
   ▼
compute_advantage
   │
   ▼
actor.update_actor
   │
   ▼
new actor weights ───────► rollout engine
\`\`\`

图中的节点不是普通 Python 函数那么简单。

- \`generate_sequences\` 可能在 8 张 GPU 上运行一个 tensor-parallel vLLM 实例；
- \`compute_log_prob\` 可能在 FSDP worker group 上运行并做序列切分；
- \`update_actor\` 需要前向、反向、梯度同步和 optimizer step；
- 权重更新后，rollout engine 必须在下一批采样前取得新参数。

如果把所有细节都写进训练循环，换一次训练后端或模型放置方式就要改算法代码。HybridFlow 的目标是把“调用次序”和“每次调用怎样分布式执行”分开。

## 6. HybridFlow：外层单控制器，内层多控制器

verl 采用 hybrid-controller 结构，也就是论文所说的 HybridFlow。

外层是 **single controller**。一个 \`RayPPOTrainer\` 进程保存全局训练循环，决定何时生成、打分、计算 advantage 和更新模型。PPO 换成 GRPO 时，主要修改这一层的数据依赖，例如去掉 critic 并改用 group reward。

内层是 **multi-controller**。每个 model worker group 内部运行常规的 SPMD 分布式程序：所有 rank 执行相同代码，FSDP 或 Megatron 用 collective communication 完成参数、梯度和激活的同步。rollout engine 也在自己的多个 rank 上协调生成。

两层分工可以写成：

| 层 | 回答的问题 | 例子 |
|---|---|---|
| 全局控制器 | 下一步调用哪个角色，数据送到哪里 | rollout 完成后同时启动 reward 与 reference |
| worker group | 一项模型计算怎样跨设备执行 | actor 用 FSDP shard，rollout 用 TP=2 |
| model/rollout engine | 具体后端怎样完成前向、反向或生成 | Megatron、FSDP、vLLM、SGLang |

纯单控制器若逐个调度每个 GPU kernel，会产生大量远程控制开销；纯多控制器若让每个 rank 同时承担全局算法分支，控制流又会与并行实现耦合。HybridFlow 在两者之间设定边界：全局只编排粗粒度方法，方法内部仍由分布式后端执行。

## 7. Role、WorkerGroup 与 ResourcePool

verl 用三个概念描述“谁在什么设备上做什么”。

**Role** 表示算法中的职责，例如 ActorRollout、Critic、RefPolicy 和 RewardModel。Role 是数据流图中的逻辑节点，不等于一张 GPU。

**WorkerGroup** 是一组执行同类分布式计算的 worker。一个 actor worker group 可能有 8 个 rank，每个 rank 绑定一张 GPU。控制器调用 worker group 的一个方法时，框架负责把输入分发到各 worker，再把输出收集回来。

**ResourcePool** 描述可供角色使用的设备集合。role-to-pool mapping 决定多个角色是共用一组 GPU，还是放在独立 GPU 池中。

一个 8-GPU 共置配置可以概括为：

\`\`\`text
global_pool: GPU 0..7
├── ActorRollout
├── RefPolicy
└── Critic        # GRPO 中没有
\`\`\`

另一种分离配置可能是：

\`\`\`text
train_pool:   GPU 0..7   → Actor + Ref + Critic
rollout_pool: GPU 8..15  → Rollout replicas
reward_pool:  GPU 16..17 → Reward model
\`\`\`

第一种配置减少所需 GPU 数，但同一时刻通常只有当前角色占用主要算力；角色切换时还要释放或重新取得显存。第二种配置能让生成、奖励和训练重叠，但模型副本与 GPU 数量增加，还要跨资源池传输样本和权重。

## 8. Actor 与 rollout 为什么组成 HybridEngine

actor 和 rollout 使用同一组策略权重，却需要两种不同的内存布局。

训练阶段通常需要：

- 模型参数；
- 梯度；
- optimizer state；
- 前向激活；
- FSDP 或 Megatron 的训练分片。

生成阶段不需要梯度和 optimizer state，但需要：

- 适合推理的权重布局；
- KV cache；
- vLLM 或 SGLang 的调度状态；
- tensor parallel 等生成并行组。

若 actor 与 rollout 共置在同一组 GPU 上，系统在两个阶段之间切换。训练完成后，actor 权重需要同步到 rollout engine；生成前要为 KV cache 留出显存；回到训练时又要释放 cache，并恢复训练所需的参数、梯度和 optimizer state。

论文中的 3D-HybridEngine 重点处理 actor 在训练与生成布局之间的 reshard。当前 verl 把训练、rollout 和 checkpoint/weight transfer 进一步拆成可替换的 engine 接口。核心问题仍相同：共享权重不表示能直接共享同一份物理布局，布局转换和权重同步本身也有时间与显存成本。

因此 \`gpu_memory_utilization\` 不能孤立设置得尽可能高。rollout 为 KV cache 保留过多空间，可能使 actor 恢复训练状态时 OOM；保留过少又会降低生成并发。共置部署需要观察完整阶段切换，而不是只测一次 vLLM generation。

## 9. FSDP、Megatron、vLLM 与 SGLang 各自负责什么

这些名称处在不同层，不能直接视为同类替代项。

| 组件 | 所在阶段 | 主要职责 |
|---|---|---|
| FSDP / FSDP2 | 训练、log probability 前向 | 分片参数、梯度与 optimizer state，适合实验和常规模型扩展 |
| Megatron | 大规模训练 | 提供 tensor、pipeline、context、expert 等并行维度 |
| vLLM | rollout | 批量生成、KV cache 管理与推理调度 |
| SGLang | rollout | 批量生成、前缀复用与推理运行时 |
| Ray | 跨角色编排 | 创建 worker、放置资源并执行远程方法 |

例如“actor 使用 FSDP，rollout 使用 vLLM”并不矛盾。前者规定训练权重怎样分片，后者规定采样时怎样生成。两种布局之间必须有 checkpoint engine 或 weight update 路径。

选择后端时先看问题所在：模型训练状态放不下，检查 FSDP offload、Megatron 并行和 activation checkpointing；rollout 速度不足，检查生成长度、并发、tensor parallel 与推理引擎；阶段切换慢，则检查权重同步、reshard 与 cache 释放。只更换一个后端通常不会同时处理三类问题。

## 10. 变长序列让样本数不再代表工作量

假设一张 GPU 分到两条回答，长度分别是 80 和 900；另一张 GPU 分到两条长度为 480 和 500 的回答。两边样本数都是 2，但前者的 padding、attention 计算和显存峰值可能不同。

因此训练 batch 需要区分三种尺度：

- **global batch size**：一轮 rollout 使用多少 prompt；
- **mini-batch size**：同一批 rollout 被拆成多大的 actor 更新批次；
- **micro-batch size 或 token budget**：单次前向/反向在一张 GPU 上实际容纳多少样本或 token。

GRPO 中 rollout 条数为：

$$
N_{rollout}=B_{prompt}\times G
$$

但计算量更接近所有有效 token 之和：

$$
N_{token}=\sum_{i=1}^{N_{rollout}} T_i
$$

长推理任务中，$T_i$ 的方差可能很大。固定“每卡 8 条”会让长序列所在的 rank 成为尾部等待点。verl 提供按 token 的动态 batch 与 sequence-length balancing 配置，用来让各 data-parallel rank 的有效 token 数更接近。它不改变 global batch 的算法含义，只改变每次设备执行怎样装箱。

## 11. PPO 与 GRPO 在框架中的差别

两种算法的大部分执行节点相同，差别集中在 advantage 和 critic。

| 项目 | PPO | GRPO |
|---|---|---|
| 同一 prompt 的采样数 | 可以为 1 或更多 | 必须多条才能形成组内比较 |
| critic | 需要 | 不需要 |
| advantage | 常用 GAE，由 reward 与 value 递推 | 由同组回答奖励标准化得到 |
| actor 更新 | PPO clip | 通常仍使用 PPO clip 形式 |
| reference policy | 可用于 KL | 常用于 KL loss |

在 verl 配置中，很多字段仍带 \`ppo_\` 前缀，因为 GRPO 复用了 PPO trainer 的 batch 切分和 policy update 路径。切换到 GRPO 的关键不是重命名这些字段，而是设置 group sampling、选择 \`grpo\` advantage estimator、移除 critic，并明确 KL 放在 reward 还是 actor loss 中。

如果 \`train_batch_size=128\` 且 \`rollout.n=8\`，本轮不是 128 条回答，而是：

$$
128\times8=1024
$$

条回答。显存估算、reward 并发和 actor mini-batch 都应从 1024 条 rollout 出发。只看 prompt batch size 容易低估生成与打分成本。

## 12. Reward 是训练系统的一部分

verl 支持规则函数与模型奖励。数学题可以抽取最终答案并核对；代码题可以送入沙箱运行测试；开放式偏好任务可以调用 reward model。多个数据源还可以按各自规则选择 scorer。

规则奖励也需要工程边界：

- 答案解析失败与答案错误要分开统计；
- 代码执行需要超时、资源限制和进程隔离；
- reward model 的 tokenizer 与 chat template 必须与训练数据约定一致；
- 某组奖励全部相等时，GRPO 的组内标准差接近零，advantage 不再提供区分信号；
- 奖励函数耗时若高于 rollout，会成为整轮训练的等待点。

reward model 可以与 actor 共置，也可以使用独立 resource pool。共置节省设备，但通常在 rollout 完成后才切换到 reward；独立放置可以流式接收完成的样本，却增加模型副本和跨池通信。选择依据是每条样本的打分时间、模型大小和期望的阶段重叠程度。

## 13. 读懂一条 GRPO 启动命令

官方示例通常以 Hydra override 形式调用统一入口：

\`\`\`bash
python3 -m verl.trainer.main_ppo \
  algorithm.adv_estimator=grpo \
  data.train_files=/data/train.parquet \
  data.val_files=/data/test.parquet \
  data.train_batch_size=128 \
  actor_rollout_ref.model.path=Qwen/Qwen3-4B \
  actor_rollout_ref.rollout.name=vllm \
  actor_rollout_ref.rollout.n=8 \
  actor_rollout_ref.actor.use_kl_loss=True \
  trainer.n_gpus_per_node=8 \
  trainer.nnodes=1
\`\`\`

这段命令只用于说明字段关系，不是一套与显存无关的通用参数。逐项解释如下：

- \`main_ppo\` 是共享的训练入口，名称不表示只能运行 PPO；
- \`adv_estimator=grpo\` 把 advantage 计算切到组相对奖励；
- \`train_batch_size=128\` 表示 prompt 数；
- \`rollout.n=8\` 让每个 prompt 生成八条回答；
- \`rollout.name=vllm\` 选择生成后端；
- \`use_kl_loss=True\` 在 actor loss 中加入参考策略 KL；
- 两个 trainer 字段声明总资源为一个节点上的八张 GPU。

真正运行前还要根据模型和硬件设置 prompt/response 最大长度、mini-batch、每卡 micro-batch 或 token budget、gradient checkpointing、offload、rollout tensor parallel 和显存比例。应优先复制与当前版本、模型规模和后端匹配的官方 example script，再逐项修改；不同 verl 与 vLLM 版本的配置名和兼容范围会变化。

## 14. 性能应按阶段记账

一轮总时间可以近似拆为：

$$
T_{step}
=T_{rollout}+T_{reward}+T_{ref}+T_{adv}+T_{update}+T_{sync}+T_{idle}
$$

$T_{rollout}$ 是生成时间，$T_{reward}$ 是打分时间，$T_{ref}$ 是参考概率前向，$T_{adv}$ 是 advantage 计算，$T_{update}$ 是 actor/critic 更新，$T_{sync}$ 是权重重分片与同步，$T_{idle}$ 是各 rank 或各角色相互等待。

优化顺序可以固定下来：

1. 记录每个阶段的 wall-clock time，先找占比最高的一项；
2. 对 rollout 同时记录生成 token 数，计算有效 tokens/s；
3. 对 update 记录有效 token 数、每卡峰值显存和最慢 rank 时间；
4. 比较权重同步前后时间，判断瓶颈是模型计算还是布局转换；
5. 检查 reward 是否有超时、解析失败或长尾样本；
6. 最后再调整并行维度和异步程度。

只看 GPU utilization 不足以判断效率。生成与训练之间切换时，GPU 利用率下降可能来自必要的权重同步；保持 100% 也可能只是某个 rank 处理超长序列，而其他 rank 正在等待。应把设备指标与阶段、样本长度和训练 step 对齐。

异步训练可以让 rollout 与 update 重叠，减少 $T_{idle}$，但会引入 policy staleness：样本由较旧策略生成，训练时 actor 已经更新。此时需要记录 rollout policy 版本，并明确 importance sampling、拒绝采样或其他 correction。异步不是同步训练的无条件加速开关，它改变了数据分布与更新策略之间的关系。

## 15. verl 与相邻工具的边界

| 工具 | 主要抽象 | 适合处理的问题 |
|---|---|---|
| verl | 多角色 RL 数据流、worker 与资源池 | 大模型 PPO/GRPO 等训练怎样跨后端和 GPU 执行 |
| TRL | Hugging Face 风格的训练器 | 单机或较直接的 SFT、DPO、GRPO 实验 |
| OpenRLHF | Ray 驱动的 RLHF 训练系统 | 分布式 RLHF 与多种训练/生成后端组合 |
| vLLM / SGLang | 推理与 rollout engine | 怎样高吞吐地产生回答 |
| FSDP / Megatron | 分布式模型训练 | 参数、梯度、优化器和激活怎样跨设备放置 |

vLLM 与 verl 不是替代关系：vLLM 可以是 verl 的 rollout 后端。FSDP 与 verl 也不是替代关系：FSDP 可以是 actor 或 critic 的训练后端。TRL 与 OpenRLHF 才更接近同一层的框架选择，但实际差异会随版本变化，应使用同一个模型、batch、生成长度和 GPU 集群做验证。

如果目标是先理解 GRPO 数学，一份较小的 PyTorch 实现更直接；如果目标是单卡验证 reward 是否正确，较轻的 trainer 更容易调试；当问题变成多模型、多节点、训练与生成布局切换时，verl 的 Role、WorkerGroup、ResourcePool 和 engine 分层才开始产生明显作用。

## 16. 限制与排查顺序

verl 把分布式组件组合起来，也继承了各组件的约束。

- **版本组合敏感。** PyTorch、CUDA、FlashAttention、vLLM、SGLang 与训练后端需要匹配，安装成功不表示任意组合都可运行。
- **配置空间较大。** global batch、rollout 数、生成长度、训练 micro-batch、TP、offload 和显存比例会共同影响结果。
- **共置存在切换成本。** GPU 数量减少后，权重同步、reshard、cache 释放和重新装载可能占据可见时间。
- **异步会引入旧策略数据。** 吞吐提高时仍需测量 policy lag 与 correction 的实际效果。
- **reward 决定训练目标。** 框架能加速错误的奖励函数，因此先验证样本、解析和分数分布，再扩大 GPU 数。
- **动态长度造成长尾。** OOM 或 step 停顿常由少量超长回答触发，平均长度不能说明峰值。

排查时先用少量样本确认完整数据流：prompt 能否正确套用 chat template，rollout 是否可读，reward 是否符合规则，group ID 是否正确，advantage 是否有正有负，actor loss 是否有限。随后用一张或少量 GPU 建立基线，再增加并行规模。直接从多节点任务开始，错误往往只表现为 Ray 超时、NCCL 等待或某个 worker 退出，定位范围会明显扩大。

## 17. 结论

verl 把 LLM 强化学习表示成多阶段数据流。以 GRPO 为例，rollout 为每个 prompt 生成一组回答，reward 给出分数，reference policy 计算参考概率，controller 计算组内 advantage，actor 再执行 clipped policy update。PPO 会在同一流程中增加 critic 与 GAE。

HybridFlow 将这张图分成两层：单控制器描述角色之间的调用顺序和数据依赖，worker group 内的多控制器执行 FSDP、Megatron、vLLM 或 SGLang 的分布式程序。Role 说明职责，WorkerGroup 说明执行单元，ResourcePool 说明 GPU 放置；HybridEngine 处理 actor 训练布局与 rollout 生成布局之间的切换和权重同步。

理解 verl 时应同时保留算法视角和系统视角。算法视角检查 reward、advantage、KL 与 policy ratio；系统视角检查 rollout、训练、同步和等待分别消耗多少时间。前者决定训练是否在优化正确目标，后者决定有限 GPU 是否被合理使用。

## 参考资料

- [verl GitHub repository](https://github.com/verl-project/verl)
- [HybridFlow: A Flexible and Efficient RLHF Framework](https://arxiv.org/abs/2409.19256)
- [verl documentation: HybridFlow Programming Guide](https://verl.readthedocs.io/en/latest/hybrid_flow.html)
- [verl documentation: PPO Example Architecture](https://verl.readthedocs.io/en/latest/examples/ppo_code_architecture.html)
- [verl documentation: Group Relative Policy Optimization](https://verl.readthedocs.io/en/latest/algo/grpo.html)
- [verl documentation: Engine Workers](https://verl.readthedocs.io/en/latest/workers/engine_workers.html)
- [verl documentation: Installation](https://verl.readthedocs.io/en/latest/start/install.html)
`,
  takeaway: 'verl 负责把 PPO、GRPO 等大模型强化学习算法变成可执行的分布式数据流。外层单控制器编排 rollout、reward、reference、critic 和 actor，内层 worker group 使用 FSDP、Megatron、vLLM 或 SGLang 完成模型计算。Role 定义职责，WorkerGroup 定义分布式执行单元，ResourcePool 定义 GPU 放置。评估时既要检查 reward、advantage、KL 与 policy ratio，也要分别测量生成、打分、更新、权重同步和等待时间。',
}

export default project
