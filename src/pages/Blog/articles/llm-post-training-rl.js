const article = {
  slug: 'llm-post-training-rl',
  date: '2026-08-21 18:00',
  name: 'From Grid World to LLM Post-Training: PPO, DPO, GRPO',
  description: '从 rl-math 出发,把策略梯度搬到语言模型上:一个回答是一条 token 轨迹,奖励整条回答一个分。三种后训练算法是一条主线的三个答案——PPO 给 actor-critic 加 clip(防一步走太远),DPO 解出 RL 目标的闭式解、一个监督损失对齐(不采样不训奖励模型),GRPO 用组内相对优势(不要 critic)。最后对照 agentic RL 与课本 RL:数学没变,状态/动作/奖励的来源和量级变了。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: '整个 rl-math 系列是同一个更新式 θ←θ+α∇lnπ×(信号),区别在信号怎么算、怎么防跑偏。LLM 后训练的三个算法是这条线在文本世界的落地:PPO 用优势(critic 提供)+ clip,比值 π_θ/π_old 超出 [1−ε,1+ε] 就封住;DPO 把 KL 约束目标解出闭式 π*∝π_ref·e^{r/β},反推隐式奖励 βln(π_θ/π_ref),代入 Bradley-Terry 得一个二分类损失,梯度权重=模型当前有多错;GRPO 用组内相对优势 (r_i−mean)/std,组均值替代学出来的 v,不要 critic。agentic RL 与课本 RL:状态从查表变 token 序列,动作从 5 个方向变词表或工具调用,奖励从每步都有变整条回答一个分,环境从已知转移变工具或模型自身生成——数学框架一个没变。',
  detail: String.raw`
## 1. 这一篇要解决什么问题

整个系列走完了 Bellman 方程到 actor-critic。每篇的核心其实是同一个更新式:

$$
\theta_{t+1} = \theta_t + \alpha\,\nabla_\theta\ln\pi(a_t|s_t,\theta_t)\,(\text{信号})
$$

区别只在"信号"怎么来:

- 第 9 章 REINFORCE:信号是整条 episode 的回报 $G_t$(MC 估计);
- 第 10 章 QAC:信号是 critic 学出来的 $q(s,a,w)$;A2C:信号换成优势 $\delta_t = q-v$。

这一篇换一个世界:从 3×3 格子到**语言模型**。大模型在 SFT(有监督微调)之后,学会了模仿人写的文本,但没有在优化任何目标。RL 后训练(RLHF 这一整套)就是让模型在一个目标上做梯度上升——回答正确、被人类偏好、会调用工具。数学框架一个都不变:MDP、策略梯度定理、优势函数、KL 约束。变的是状态、动作、奖励的表示和量级。

讲三个算法,它们是对同一个问题的三个答案:**$\nabla_\theta\ln\pi$ 前面的信号怎么算、怎么防止更新跑偏?**

- **PPO**(§3):actor-critic 的现代版。信号是优势(来自 critic),再加一个 clip,防止一步更新走太远。
- **DPO**(§4):把 RL 目标解出闭式解,一个监督损失就完成对齐——不训练奖励模型,也不走 RL 循环。
- **GRPO**(§5):用组内相对优势,连 critic 都不要了。DeepSeek-R1 用它训练推理。

§6 回答另一个问题:agentic RL 和课本里的 RL 到底差在哪。§7 小结。先把"在语言上做 RL"翻译成课本的语言,这是 §2。

## 2. 先把"在语言上做 RL"翻译成课本的语言

**一个回答是一条 token 序列。** 大模型逐 token 生成回答:给定 prompt $x$,先输出第一个 token $y_1$,再输出 $y_2$……直到结束。整个回答的概率是每个 token 概率的乘积:

$$
\pi_\theta(y|x) = \prod_{t=1}^{T} \pi_\theta(y_t\,|\,x,\,y_{<t})
$$

符号:$y=(y_1,\dots,y_T)$ 是一个回答,$x$ 是 prompt,$y_{<t}=y_1\cdots y_{t-1}$ 是 $y_t$ 之前已经生成的 token。每个因子 $\pi_\theta(y_t|x,y_{<t})$ 是一个 softmax 分布,对词表里的每个 token 给一个概率——这就是模型的"下一个 token 预测"。$\theta$ 是 Transformer 的参数。

把它放进课本的框架:

- 状态 $s_t = (x, y_{<t})$:已经生成的整段序列;
- 动作 $a_t = y_t$:下一个 token;
- 转移是确定的:选了 $y_t$,状态就变成 $(x, y_{<t}, y_t)$;
- 奖励:整条回答结束时给一个分 $r(x,y)$。稀疏——中间每个 token 没有自己的奖励。

**策略梯度公式原样搬过来。** 关键一步是 log 把乘积变求和:

$$
\ln\pi_\theta(y|x) = \sum_{t=1}^{T}\ln\pi_\theta(y_t\,|\,x,\,y_{<t})
$$

对 $\theta$ 求梯度,右边是每个 token 的梯度之和。整条回答就是一条 episode,回报是最后的 $r(x,y)$。第 9、10 章的一切照用。

为了能手算,定义一个玩具语言:**词表只有两个 token $a$ 和 $b$,每条回答只有一个 token**。奖励规则:回答 $a$ 得 $+1$,回答 $b$ 得 $0$。这样一个回答就是一次动作选择,信号可以逐个数字算。

**KL 锚定:别让策略漂离 SFT 模型。** 如果只把奖励做大,模型会去找奖励的漏洞(§6 细说)。所以 RLHF 的目标在奖励之外带一个约束——策略别离参考策略太远。参考策略 $\pi_{\mathrm{ref}}(y|x)$ 取 SFT 模型。目标写:

$$
\max_\theta\ \mathbb{E}_{x\sim\mathcal{D}}\Big[\mathbb{E}_{y\sim\pi_\theta(y|x)}\big[r(x,y)\big] - \beta\,\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)\Big]
$$

符号:$r(x,y)$ 是回答的奖励,$\mathcal{D}$ 是训练用 prompt 的分布,$\beta>0$ 是 KL 系数,$\mathbb{D}_{\mathrm{KL}}$ 是 KL 散度:

$$
\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)
= \mathbb{E}_{y\sim\pi_\theta}\Big[\ln\frac{\pi_\theta(y|x)}{\pi_{\mathrm{ref}}(y|x)}\Big]
$$

直观:目标里"回答比 SFT 更不可能"要扣分。这和第 10 章的减基线不同——减基线是为了降方差,KL 约束是为了防漂移。它和后面要讲的 clip 构成防跑偏的两层:KL 防长期漂移,clip 防一步走太远。

三个算法就从这个目标出发,对"信号怎么算、怎么防跑偏"给出三个不同的答案。

## 3. PPO:actor-critic 的现代版

**问题:一步更新可能走太远。** 策略梯度每次用一批数据只更新一步(第 9 章 REINFORCE 每回合更新一次)。如果一步推得太远,策略性能会掉。TRPO 的解决办法是给更新加硬约束:新旧策略的 KL 不超过一个阈值,用二阶方法解,贵。PPO 想保留"别走太远"的效果,但只用一阶的修改。

**先解决一个问题:怎么用旧数据评估新策略。** 目标是"对 $\pi_\theta$ 取期望"的量,数据却是按旧策略 $\pi_{\theta_{\mathrm{old}}}$ 采的。直接把这批数据平均,估的是 $\pi_{\theta_{\mathrm{old}}}$ 下的期望,不是 $\pi_\theta$ 下的——差的部分正是"新策略更常选谁"。要校正,用 **importance sampling**。原理是一行恒等式:把对 $\pi_\theta$ 的求和改写成对 $\pi_{\theta_{\mathrm{old}}}$ 的求和:

$$
\mathbb{E}_{a\sim\pi_\theta(\cdot|s)}\big[f(s,a)\big]
= \sum_a \pi_\theta(a|s)\,f(s,a)
= \sum_a \pi_{\theta_{\mathrm{old}}}(a|s)\,\frac{\pi_\theta(a|s)}{\pi_{\theta_{\mathrm{old}}}(a|s)}\,f(s,a)
= \mathbb{E}_{a\sim\pi_{\theta_{\mathrm{old}}}(\cdot|s)}\Big[\frac{\pi_\theta(a|s)}{\pi_{\theta_{\mathrm{old}}}(a|s)}\,f(s,a)\Big]
$$

中间一步是每一项乘上 $\pi_{\theta_{\mathrm{old}}}/\pi_{\theta_{\mathrm{old}}}=1$。每个旧策略采的样本,乘上新旧概率之比,平均下来就等于新策略下的期望。这个比 $\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 叫**重要性比**。这一步要求 $\pi_{\theta_{\mathrm{old}}}$ 的支撑覆盖 $\pi_\theta$:凡 $\pi_\theta(a|s)>0$ 处,$\pi_{\theta_{\mathrm{old}}}(a|s)>0$。softmax 策略每个动作概率都严格为正,自然满足。

**算一个数。** 玩具语言,两个动作 $a,b$,奖励 $r(a)=+1$、$r(b)=0$。旧策略均匀:$\pi_{\theta_{\mathrm{old}}}(a)=\pi_{\theta_{\mathrm{old}}}(b)=0.5$。新策略 $\pi_\theta(a)=0.8$、$\pi_\theta(b)=0.2$。我们想要的期望(按 $\pi_\theta$ 加权)真值是 $0.8\times(+1)+0.2\times0=0.8$。直接按旧策略平均,得到 $0.5\times(+1)+0.5\times0=0.5$——错了,低估了"新策略更常选 $a$"这一部分。加权后:采到 $a$(概率 0.5),权重 $0.8/0.5=1.6$,贡献 $1.6\times(+1)=1.6$;采到 $b$(概率 0.5),权重 $0.2/0.5=0.4$,贡献 $0.4\times0=0$;两个贡献的期望 $0.5\times1.6+0.5\times0=0.8$,对了。

PPO 里 $\theta_{\mathrm{old}}$ 就是采这批数据的策略,被校正的量是优势,比值记作

$$
r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t|s_t)}
$$

$\theta=\theta_{\mathrm{old}}$ 时,每个比值都是 1,目标退化成旧数据上的普通平均;$\theta$ 变了,比值给每个样本重新加权,估计仍然是对的——前提是比值别离 1 太远:比值太大,少数样本的权重被放大,估计方差跟着涨。这正是下一步 clip 要管的事。有了它,同一批数据可以多轮更新,不用每轮重新采样。

**裁剪目标。** 用 $r_t$ 乘上优势 $\hat{A}_t$ 当目标,就是策略梯度更新式的期望形式(不裁剪的版本):

$$
L(\theta) = \mathbb{E}\big[r_t(\theta)\,\hat{A}_t\big]
$$

$\hat{A}_t$ 是优势的估计。不裁剪的话,最大化这个目标会一步推得太大(论文原话:不加约束,目标会诱导过大的策略更新)。PPO 的裁剪目标:

$$
L^{CLIP}(\theta)
= \mathbb{E}\Big[\min\big(r_t(\theta)\hat{A}_t,\ \operatorname{clip}(r_t(\theta),\,1-\epsilon,\,1+\epsilon)\,\hat{A}_t\big)\Big]
$$

$\operatorname{clip}(r,1-\epsilon,1+\epsilon)$ 把 $r$ 夹在 $[1-\epsilon,1+\epsilon]$ 里,$\epsilon$ 是超参(常用 0.2)。min 取两个值里较小的:比值越界时,目标被裁剪后的值封住。

**在玩具语言上算四种情况。** 设 $\epsilon=0.2$,裁剪区间 $[0.8,1.2]$。

| 优势 $\hat{A}_t$ | 比值 $r_t$ | 未裁剪 $r_t\hat{A}_t$ | 裁剪后 | 目标值 min | 行为 |
|---|---|---|---|---|---|
| $+1$ | $1.3$ | $1.3$ | $1.2$ | $1.2$ | 抬好动作,超过 $1+\epsilon$ 封顶 |
| $+1$ | $0.7$ | $0.7$ | $0.8$ | $0.7$ | 压低好动作,全量罚 |
| $-1$ | $0.7$ | $-0.7$ | $-0.8$ | $-0.8$ | 压坏动作,低于 $1-\epsilon$ 封底 |
| $-1$ | $1.3$ | $-1.3$ | $-1.2$ | $-1.3$ | 抬高坏动作,全量罚 |

读这个表:裁剪只在"对目标有利"的方向生效——抬好动作、压坏动作,到 $1\pm\epsilon$ 就封住;反向(压低好动作、抬高坏动作)全量罚。用论文的话:只在会让目标变好的方向忽略比值的变化,在会让目标变差的方向保留它。

### 3.1 在 LLM 上:RLHF

InstructGPT 把这套接到语言模型上,三步:

1. **SFT**:用人工写的高质量回答微调,得到 $\pi^{\mathrm{SFT}}$;
2. **训奖励模型**:让标注者比较两个回答,在偏好数据上训练 $r(x,y)$,损失是逻辑回归(同一 prompt 下 $y_w$ 更被偏好):

$$
\mathrm{loss}(\theta) = -\mathbb{E}\big[\log\sigma\big(r(x,y_w) - r(x,y_l)\big)\big]
$$

3. **PPO**:用奖励模型当奖励,在 §2 的目标上做 PPO。

这个损失和 §4 的 DPO 损失是同一个形状,到 §4 再展开。信号怎么来?回答的奖励只有一个分(在最后一个 token 之后),但梯度逐 token 算。critic 是逐 token 的价值网络,提供优势 $\hat{A}_t$(第 10 章 A2C 的 $\delta_t$ 是它的单步估计,PPO 常用多步的 GAE 降方差;InstructGPT 里优势估计不折现)。KL 惩罚逐 token 加进奖励:每生成一个 token,从奖励里扣 $\beta\ln\frac{\pi_\theta(y_t|x,y_{<t})}{\pi^{\mathrm{SFT}}(y_t|x,y_{<t})}$。论文的数字:$\beta=0.02$、$\epsilon=0.2$。

一个诚实的说明:论文把一次对话当作单步 bandit——给一个 prompt,模型出一个回答,奖励模型打一个分,episode 结束。逐 token 的状态/动作是实现的视角(梯度按 token 算、KL 逐 token 扣),不是论文的字面描述。

## 4. DPO:不要奖励模型,也不要 RL 循环

**动机。** RLHF 管线复杂:要训奖励模型、要从当前策略在线采样、PPO 超参多。能不能只用一个监督损失就完成?

**回看 RLHF 目标。** 就是 §2 那个目标。关键观察:**对任意给定奖励 $r$,这个 KL 约束的最优策略有一个闭式解**。

先把它写成最小化(对每个 prompt $x$ 固定看):

$$
\min_\pi\ \mathbb{E}_{y\sim\pi(y|x)}\Big[\ln\frac{\pi(y|x)}{\pi_{\mathrm{ref}}(y|x)} - \frac{1}{\beta}r(x,y)\Big]
$$

定义

$$
\pi^*(y|x) = \frac{1}{Z(x)}\,\pi_{\mathrm{ref}}(y|x)\,e^{r(x,y)/\beta},
\qquad
Z(x) = \sum_y \pi_{\mathrm{ref}}(y|x)\,e^{r(x,y)/\beta}
$$

$Z(x)$ 是配分函数,保证 $\sum_y\pi^*=1$。把目标里的被积函数重新配成以 $\pi^*$ 为基准的 KL:

$$
\ln\frac{\pi}{\pi_{\mathrm{ref}}} - \frac{1}{\beta}r
= \ln\frac{\pi}{\pi^*} - \ln Z(x)
$$

代回去,目标等于 $\mathbb{D}_{\mathrm{KL}}(\pi\|\pi^*) - \ln Z(x)$。第二项与 $\pi$ 无关,第一项 KL ≥ 0,取 0 当且仅当 $\pi=\pi^*$。所以**最优策略就是 $\pi^*$**。

**反推:语言模型自己就是奖励模型。** 对 $\pi^*$ 的式子两边取对数:

$$
r(x,y) = \beta\ln\frac{\pi^*(y|x)}{\pi_{\mathrm{ref}}(y|x)} + \beta\ln Z(x)
$$

把 $\pi^*$ 换成要学的 $\pi_\theta$,$\beta\ln Z(x)$ 只依赖 $x$ 和 $\pi_{\mathrm{ref}}$,与 $\theta$ 无关,丢掉:

$$
\hat{r}_\theta(x,y) = \beta\ln\frac{\pi_\theta(y|x)}{\pi_{\mathrm{ref}}(y|x)}
$$

这就是论文标题的来源(你的语言模型隐藏着一个奖励模型):策略的对数似然比本身编码了奖励。回答比 SFT 更"可能",隐式奖励更高。

**代入 Bradley-Terry。** 人类的偏好模型:两个回答 $y_w$(更被偏好)和 $y_l$,$y_w \succ y_l$ 的概率是 sigmoid 作用在两者奖励差上:

$$
p(y_w \succ y_l|x) = \sigma\big(r(x,y_w) - r(x,y_l)\big)
$$

把 $\hat{r}_\theta$ 代进去,两个 $\beta\ln Z(x)$ 相消(同一个 prompt $x$ 下的两个回答):

$$
p(y_w \succ y_l|x)
= \sigma\Big(\beta\ln\frac{\pi_\theta(y_w|x)}{\pi_{\mathrm{ref}}(y_w|x)}
- \beta\ln\frac{\pi_\theta(y_l|x)}{\pi_{\mathrm{ref}}(y_l|x)}\Big)
$$

DPO 损失就是最大化这个概率的对数:

$$
\mathcal{L}_{\mathrm{DPO}}(\theta)
= -\mathbb{E}_{(x,y_w,y_l)\sim\mathcal{D}}\Big[\log\sigma\Big(\beta\ln\frac{\pi_\theta(y_w|x)}{\pi_{\mathrm{ref}}(y_w|x)}
- \beta\ln\frac{\pi_\theta(y_l|x)}{\pi_{\mathrm{ref}}(y_l|x)}\Big)\Big]
$$

一个二分类交叉熵损失:括号里是 logits(隐式奖励差),标签是"$y_w$ 比 $y_l$ 好"。没有奖励模型,没有采样,没有 RL 循环——一份静态偏好数据集上的监督训练。

**在玩具语言上算一对。** 词表 $\{a,b\}$,每条回答一个 token。设 $\pi_{\mathrm{ref}}(a)=\pi_{\mathrm{ref}}(b)=0.5$(SFT 均匀),$\beta=0.1$。偏好对:$y_w=a$,$y_l=b$。记

$$
h = \beta\Big(\ln\frac{\pi_\theta(a)}{\pi_{\mathrm{ref}}(a)} - \ln\frac{\pi_\theta(b)}{\pi_{\mathrm{ref}}(b)}\Big),
\qquad
\mathcal{L} = -\log\sigma(h)
$$

| 情形 | $\pi_\theta(a)$ | $\pi_\theta(b)$ | $h$ | $\sigma(h)$ | 损失 |
|---|---|---|---|---|---|
| 模型已对 | $0.9$ | $0.1$ | $+0.220$ | $0.555$ | $0.589$ |
| 模型反了 | $0.1$ | $0.9$ | $-0.220$ | $0.445$ | $0.810$ |

算第一行:$\ln\frac{0.9}{0.5}=\ln1.8=0.588$,$\ln\frac{0.1}{0.5}=\ln0.2=-1.609$,所以 $h=0.1\times(0.588+1.609)=0.220$;$\sigma(0.220)=1/(1+e^{-0.220})=0.555$。第二行对称,$h=-0.220$,$\sigma=0.445$。

**梯度:偏好对上的带权策略梯度。** 对 $h$ 求导,用 $\frac{d}{dh}\log\sigma(h)=1-\sigma(h)$:

$$
\nabla_\theta\mathcal{L}_{\mathrm{DPO}}
= \mathbb{E}\Big[\beta\big(\sigma(h)-1\big)\nabla_\theta\ln\pi_\theta(y_w|x)
+ \beta\big(1-\sigma(h)\big)\nabla_\theta\ln\pi_\theta(y_l|x)\Big]
$$

梯度下降时,第一项带 $\beta(\sigma(h)-1)<0$:负系数乘在 $\nabla_\theta\ln\pi_\theta(y_w)$ 上,减去它等于朝 $\nabla_\theta\ln\pi_\theta(y_w)$ 的方向走,把 $y_w$ 的概率**抬**上去。第二项带 $\beta(1-\sigma(h))>0$:正系数乘在 $\nabla_\theta\ln\pi_\theta(y_l)$ 上,减去它等于背对 $\nabla_\theta\ln\pi_\theta(y_l)$,把 $y_l$ 的概率**压**下来。两个方向的力度都是 $\beta(1-\sigma(h))$。而 $1-\sigma(h)$ 是"模型当前认为 $y_l$ 更好的概率"——**判断越错,推得越狠**;判断对了,权重趋近 0,不会过度修正。上表两行的权重分别是 $0.0445$ 和 $0.0555$,反了的那行权重更大。

**取舍。** DPO 简单、稳、便宜:不训奖励模型、不采样、一个监督 pass。代价是数据是离线的:它不能像 PPO 那样按当前策略生成新数据、针对当前策略新犯的错补样本。实际系统常把两者配合:离线方法(DPO 这类)先对齐,在线 RL(PPO 或 GRPO)再在关键任务上继续提升。

## 5. GRPO:不要 critic

**动机。** PPO 的 critic 是和策略一样大的价值网络——内存直接翻倍。而且奖励整条回答只给一个分,逐 token 的价值函数很难学(每个 token 的"价值"本来就没有定义)。能不能不要 critic,用一组采样回答把"平均"算出来?

**组内相对优势。** 对同一个 prompt $q$,从当前策略采 $G$ 条回答 $\{o_1,\dots,o_G\}$,每条拿一个奖励 $r_i$。第 $i$ 条的优势定义为它相对这一组的偏离:

$$
A_i = \frac{r_i - \mathrm{mean}(r_1,\dots,r_G)}{\mathrm{std}(r_1,\dots,r_G)}
$$

$\mathrm{mean}$ 是组内平均,$\mathrm{std}$ 是组内标准差。这正是第 10 章"减基线"的思想——A2C 的 $\delta_t = r+\gamma v(s')-v(s)$ 减的是**学出来的** $v(s)$;GRPO 减的是**这批回答的经验平均**。基线是组均值,所以不用学,也就没有 critic。除以 $\mathrm{std}$ 是额外的:让优势的尺度自动调节。

**在玩具语言上算一组。** 词表 $\{a,b\}$,奖励 $a=+1$、$b=0$。同一 prompt $q$ 采 $G=4$ 条回答:$a, b, b, b$,奖励 $r=[1,0,0,0]$。

- 平均 $\mathrm{mean}=(1+0+0+0)/4=0.25$;
- 偏离:正确那条 $1-0.25=0.75$,三条错的各 $-0.25$;
- 标准差 $\mathrm{std}=\sqrt{(0.75^2+3\times0.25^2)/4}=\sqrt{0.1875}=0.433$(按 4 条平均);
- 优势:

$$
A = \Big[\frac{0.75}{0.433},\, \frac{-0.25}{0.433},\, \frac{-0.25}{0.433},\, \frac{-0.25}{0.433}\Big]
= [1.73,\,-0.58,\,-0.58,\,-0.58]
$$

正确的那条优势 $+1.73$ 被抬,三条错误的各 $-0.58$ 被压。四者之和为 0——"相对平均"的基线让优势和为零,和课本里"期望中减基线梯度不变"是同一件事。

**目标函数。** 和 PPO 同构:裁剪的比值乘组优势,再加 KL 到参考策略:

$$
\mathcal{J}_{\mathrm{GRPO}}(\theta)
= \mathbb{E}\Big[\frac{1}{G}\sum_{i=1}^{G}
\min\big(\rho_i A_i,\ \operatorname{clip}(\rho_i,1-\epsilon,1+\epsilon)A_i\big)
- \beta\,\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(\cdot|q)\,\|\,\pi_{\mathrm{ref}}(\cdot|q)\big)\Big]
$$

$\rho_i=\pi_\theta(o_i|q)/\pi_{\theta_{\mathrm{old}}}(o_i|q)$ 是第 $i$ 条回答的比值(整条回答的概率之比;实现上逐 token 算、log 后求和)。KL 直接加在损失上(PPO 是塞进奖励里),这样不影响优势的计算。DeepSeekMath 的配置:$G=64$、$\beta=0.04$。

**R1 用它训练推理。** DeepSeek-R1 的奖励不用学出来的奖励模型,用**规则**:
- 正确性:数学题比对最终答案,LeetCode 用编译器跑测试用例;
- 格式:要求思考过程放在指定标签里。

R1-Zero 从基座模型直接上 GRPO,不做 SFT,推理能力自己涌现出来(AIME 2024 上 15.6% → 71.0%,pass@1)。R1 加了一步冷启动 SFT 再 RL,更稳定。论文明确说不用神经奖励模型做这个训练,因为在大规模 RL 里它容易被利用(§6)。

## 6. agentic RL 和课本的 RL 差在哪

**agentic RL 没有统一定义。** 最可辩护的说法:用 RL 训练一个 LLM,让它在一个环境里多轮行动——想很多步、调用工具、看到工具的返回再决定下一步——奖励是任务完成与否。DeepSeek-R1 是它的退化情形:环境就是模型自己的生成,没有外部观察。另一种常见用法把 R1 这类纯推理 RL 也算进 agentic,因为思考痕迹本身就是多步动作。

**和课本 RL 的差别,一张表看全:**

| 维度 | 课本 grid world | LLM 后训练 |
|---|---|---|
| 状态 | 9 个格点,查表 | 整条 token 序列(prompt + 已生成 + 工具返回的观察),不可枚举 |
| 动作 | 5 个离散方向 | 词表里选下一个 token,或一次工具调用 |
| 表示 | 查表 / 线性函数近似 | 只能是神经网络(Transformer),没有表可查 |
| 奖励 | 每步都有(撞墙 $-1$、到目标 $+1$) | 整条回答结束时一个分:规则可验证,或学出来的奖励模型 |
| 环境 | 转移已知的模拟器 | 工具(代码解释器、浏览器、搜索),或模型自身的生成 |

数学一个都没变:MDP、策略梯度定理、优势函数、KL 约束,前面三节全程在用。变的是状态/动作/奖励/环境的**量级和来源**。

三个课本里没有的现象值得单独说。

**可验证奖励(verifiable rewards)。** 规则判定,不学奖励模型:数学题比对最终答案,代码题跑测试。判定客观,不依赖一个可能被刷的学习模型。DeepSeek-R1、Tulu 3 都走这条路(后者给这套起了名字 RLVR)。

**reward hacking:模型利用奖励的漏洞。** 课本环境是手写的、玩具级的,奖励不会有漏洞;LLM 后训练里奖励来自规则或学出来的模型,模型会找到让奖励变大、任务却没做好的做法。两个真实例子:DeepSeek-R1 训练中模型的思考痕迹越来越长、语言混杂(为了凑格式奖励);Spurious Rewards 论文给数学模型用随机奖励做 RL,MATH-500 还涨了 21.4 分(真奖励涨 29.1)——奖励和正确性负相关,策略也会"变好",说明 GRPO 的裁剪项在放大预训练里已有的先验。

**稀疏奖励 + 长 horizon 的信用分配。** 一条回答几千个 token,只有一个分。哪个 token 让结果变好,要策略梯度自己学。GRPO 的组优势让一条回答里所有 token 共享同一个优势,就是对"整条回答一个分"的回应——这也是它不需要逐 token 价值函数的原因。

一个值得注意的反转:RLHF 形式上是单步 bandit(prompt 进、回答出、一个分),它比 agentic RL 更偏离课本的多步 MDP;agentic RL(调用工具、调试循环、多轮交互)反而更接近课本里多步转移的设定,只是状态空间、动作空间比课本大了几个数量级。

## 7. 小结

- **问题没变**:对指标 $J(\theta)$ 做梯度上升。变的是 $\nabla_\theta\ln\pi$ 前面的信号怎么算、怎么防止更新跑偏。
- **PPO**:actor-critic 的现代版。信号是优势(critic 提供),比值 $r_t=\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 就是重要性采样(把对 $\pi_\theta$ 的期望改写到采数据的 $\pi_{\theta_{\mathrm{old}}}$ 上);clip 把一步更新封在 $[1-\epsilon,1+\epsilon]$。RLHF 管线:SFT → 奖励模型 → PPO,KL 惩罚逐 token 扣,β=0.02、ε=0.2。
- **DPO**:RL 目标的闭式解。最优策略 $\pi^*\propto\pi_{\mathrm{ref}}e^{r/\beta}$,反推出隐式奖励 $\beta\ln(\pi_\theta/\pi_{\mathrm{ref}})$,代入 Bradley-Terry 得一个二分类损失。梯度是带权策略梯度:抬 $y_w$、压 $y_l$,权重 = 模型当前有多错。不训练奖励模型、不采样、不走 RL 循环。
- **GRPO**:组内相对优势 $A_i=(r_i-\mathrm{mean})/\mathrm{std}$,组均值替代学出来的 $v$,不要 critic。DeepSeek-R1 用规则奖励(正确性 + 格式)训练推理。
- **agentic RL 与课本 RL**:数学没变,状态从查表变 token 序列、动作从 5 个方向变词表或工具调用、奖励从每步都有变整条回答一个分、环境从已知转移变工具或自身生成。新现象:可验证奖励、reward hacking、稀疏奖励下的信用分配。
- 简言之:LLM 后训练把课本的策略梯度搬到文本世界,三个算法是对"信号怎么算、怎么防跑偏"的三个答案。
`,
}
export default article
