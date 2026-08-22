const article = {
  slug: 'rlhf-ppo',
  date: '2026-08-21 16:00',
  name: 'From Grid World to RLHF: PPO',
  description: '从 rl-math 出发,把策略梯度搬到语言模型上:一条回答是一条 token 轨迹,奖励整条回答一个分。PPO 给 actor-critic 加 clip(防一步走太远),重要性比 π_θ/π_old 让同一批数据能多轮更新。RLHF 管线:SFT → 奖励模型 → PPO,一条回答一条 episode,critic 拿奖励模型初始化,KL 惩罚逐 token 扣,一条 2-token 回答全链路数字手算。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: '整个 rl-math 系列是同一个更新式 θ←θ+α∇lnπ×(信号),区别在信号怎么算、怎么防跑偏。PPO 在 LLM 上的落地:信号是优势(critic 提供),比值 π_θ/π_old 就是重要性采样(把对 π_θ 的期望改写到采数据的 π_old 上),clip 把一步更新封在 [1−ε,1+ε]。RLHF 三步:SFT → 奖励模型(6B,偏好数据训)→ PPO;一条回答是一条 episode,奖励模型给一个分,critic(拿奖励模型初始化)把它摊成逐 token 优势,KL 惩罚逐 token 扣,β=0.02、ε=0.2。',
  detail: String.raw`
## 1. 这一篇讲什么

整个系列走完了 Bellman 方程到 actor-critic。每篇的核心其实是同一个更新式:

$$
\theta_{t+1} = \theta_t + \alpha\,\nabla_\theta\ln\pi(a_t|s_t,\theta_t)\,(\text{信号})
$$

区别只在"信号"怎么来:

- 第 9 章 REINFORCE:信号是整条 episode 的回报 $G_t$(MC 估计);
- 第 10 章 QAC:信号是 critic 学出来的 $q(s,a,w)$;A2C:信号换成优势 $\delta_t = q-v$。

这一篇换一个世界:从 3×3 格子到**语言模型**。大模型在 SFT(有监督微调)之后,学会了模仿人写的文本,但没有在优化任何目标。RL 后训练(RLHF 这一整套)就是让模型在一个目标上做梯度上升——回答正确、被人类偏好。数学框架一个都不变:MDP、策略梯度定理、优势函数、KL 约束。变的是状态、动作、奖励的表示和量级。

PPO 是 actor-critic 的现代版:信号是优势(来自 critic),再加一个 clip,防止一步更新走太远。先把"在语言上做 RL"翻译成课本的语言(§2),再看 PPO 本身(§3),最后看它在 LLM 上的完整管线 RLHF(§4),以及一条 2-token 回答的全链路手算。

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

为了能手算,定义一个玩具语言:**词表只有两个 token $a$ 和 $b$**,每条回答 2 个 token(回答是 $(y_1,y_2)$,每个 token 从 $\{a,b\}$ 里选)。奖励由奖励模型在回答结束时给一个分(§4 讲);下面的完整例子逐 token 展示"整条回答"怎么算。

**KL 锚定:别让策略漂离 SFT 模型。** 如果只把奖励做大,模型会去找奖励的漏洞。所以 RLHF 的目标在奖励之外带一个约束——策略别离参考策略太远。参考策略 $\pi_{\mathrm{ref}}(y|x)$ 取 SFT 模型。目标写:

$$
\max_\theta\ \mathbb{E}_{x\sim\mathcal{D}}\Big[\mathbb{E}_{y\sim\pi_\theta(y|x)}\big[r(x,y)\big] - \beta\,\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)\Big]
$$

符号:$r(x,y)$ 是回答的奖励,$\mathcal{D}$ 是训练用 prompt 的分布,$\beta>0$ 是 KL 系数,$\mathbb{D}_{\mathrm{KL}}$ 是 KL 散度:

$$
\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)
= \mathbb{E}_{y\sim\pi_\theta}\Big[\ln\frac{\pi_\theta(y|x)}{\pi_{\mathrm{ref}}(y|x)}\Big]
$$

直观:目标里"回答比 SFT 更不可能"要扣分。这和第 10 章的减基线不同——减基线是为了降方差,KL 约束是为了防漂移。它和 §3 要讲的 clip 构成防跑偏的两层:KL 防长期漂移,clip 防一步走太远。

## 3. PPO

**问题:每批数据只用一次。** 第 9、10 章的更新式 $\theta_{t+1}=\theta_t+\alpha\nabla_\theta\ln\pi\,(\text{信号})$ 是 on-policy:采一批数据,更新一次 $\theta$,数据作废,再重新采样。一步挪动小,收敛要采很多批,大部分时间花在重复采样上。PPO 想让同一批数据用好几轮。但第二轮更新时 $\theta$ 已经变了,手里的样本还是第一轮之前($\theta_{\mathrm{old}}$)采的:**我们想提高的是新策略的表现,样本却是旧策略采的**。

**$\theta_{\mathrm{old}}$ 到底是什么。** $\theta_{\mathrm{old}}$ 是**采这批数据时的策略参数**,在整个更新过程里固定不动;$\theta$ 是当前正在更新的参数。PPO 拿同一批数据做多次梯度更新:一个 batch 切成若干 minibatch,依次更新。第一次更新前 $\theta=\theta_{\mathrm{old}}$、比值都是 1;之后每更新一次,$\theta$ 都变一点,而数据始终是 $\theta_{\mathrm{old}}$ 采的——这就是后面重要性比要校正的事。"用几轮"可以很小:InstructGPT 里每批数据只用 1 轮,但 1 轮内部仍切多个 minibatch、做多次梯度步,所以 $\theta_{\mathrm{old}}$ 照样起作用。如果真是一次采样、一次更新、数据作废,那就是 vanilla policy gradient,根本不需要 $\theta_{\mathrm{old}}$——$\theta_{\mathrm{old}}$ 正是"同一批数据要反复用"才引入的。

一个状态 $s$ 下,新策略的表现是"按新策略的动作概率加权优势":

$$
\bar{A}(\theta) = \sum_a \pi_\theta(a|s)\,\hat{A}(s,a)
$$

$\hat{A}(s,a)$ 是优势:一个"这个动作比该状态平均水平好多少"的分数,正号说明值得选(它怎么估,§4 讲)。$\bar{A}(\theta)$ 的读法:新策略选 $a$ 的概率乘上 $a$ 的优势,全部加起来——新策略越常选的动作,在期望里占的权重越大。

**数据是旧策略采的,直接平均会错。** 样本里的动作按 $\pi_{\theta_{\mathrm{old}}}$ 的概率采。直接对样本的优势求平均,得到的是"旧策略的期望优势" $\sum_a\pi_{\theta_{\mathrm{old}}}(a|s)\hat{A}(s,a)$,不是新策略的 $\bar{A}(\theta)$。

**为什么不直接枚举 $\sum_a\pi_\theta(a|s)\hat{A}(s,a)$?** $\pi_\theta$ 已知,不缺它。但和式里每个动作要乘上它的优势,而你手里只有 batch 里采到的这些动作有奖励。直接平均 batch 得到的是 $\pi_{\theta_{\mathrm{old}}}$ 的期望——因为样本按 $\pi_{\theta_{\mathrm{old}}}$ 采。

**改权重的办法:重要性采样** 新策略选 $a$ 的概率是 $\pi_\theta(a|s)$,旧策略是 $\pi_{\theta_{\mathrm{old}}}(a|s)$。把和式里每项的"旧概率"换成"新概率",就是乘上它们的比:

$$
\bar{A}(\theta)
= \sum_a \pi_{\theta_{\mathrm{old}}}(a|s)\,\frac{\pi_\theta(a|s)}{\pi_{\theta_{\mathrm{old}}}(a|s)}\,\hat{A}(s,a)
= \mathbb{E}_{a\sim\pi_{\theta_{\mathrm{old}}}(\cdot|s)}\Big[\frac{\pi_\theta(a|s)}{\pi_{\theta_{\mathrm{old}}}(a|s)}\,\hat{A}(s,a)\Big]
$$

这个比就是 PPO 里的**重要性比**:

$$
r_t(\theta) = \frac{\pi_\theta(a_t|s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t|s_t)}
$$

它回答一个问题:**样本里的这个动作,新策略选它的概率比旧策略高几倍?** $r_t>1$:新策略更常选它,在"新策略的期望"里该占更大权重; $r_t<1$:新策略没那么常选它,权重调小; $r_t=1$:两个策略看法一样,权重不变。

$\theta=\theta_{\mathrm{old}}$ 时,每个比值都是 1,目标退化成旧数据上的普通平均。$\theta$ 变了,比值给每个样本重新加权,期望仍然是对的——前提是比值别离 1 太远:比值太大,少数样本的权重被放大,估计方差跟着涨。这正是后面 clip 要管的事。有了它,同一批数据可以多轮更新,不用每轮重新采样。

**为什么比值会让更新走太远。** 前面那个期望优势 $\bar{A}(\theta)$ 就是要最大化的目标,写成样本估计的形式(不裁剪的版本):

$$
L(\theta) = \mathbb{E}\big[r_t(\theta)\,\hat{A}_t\big]
$$

$\hat{A}_t$ 是优势的估计(来源 §4)。如果 $\hat{A}_t > 0$(好动作),增大 $r_t$ 能让目标变大,方法是把 $\pi_\theta(a_t|s_t)$ 往 1 推——一步把概率推到接近 1,策略退化成"只选这个动作",离旧策略太远,性能崩塌。如果 $\hat{A}_t < 0$(坏动作),反过来把概率往 0 压。论文原话:不加约束,目标会诱导过大的策略更新。

**TRPO 的约束:硬,贵。** TRPO 复用同一个目标,但加了一个硬约束:新旧策略的 KL 散度不超过一个阈值。用二阶方法(共轭梯度)解,实现复杂、计算量大。

**为什么有 KL 约束还要 clip。** §2 的 KL 约束锚定的是参考模型 $\pi_{\mathrm{ref}}$(SFT),管"整个训练别漂太远"这个长期基准。但 PPO 的单步更新是相对采数据的策略 $\theta_{\mathrm{old}}$ 的:比值 $r_t=\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 衡量"这一步比上一步走多远"。这两件事不是一回事——即使累计离 $\pi_{\mathrm{ref}}$ 不远,单步更新也可能把某个动作的概率从 $0.2$ 推到接近 $1$(比值从 $1$ 跳到很大),这一步本身就可能让性能崩掉。而且固定的 KL 系数 $\beta$ 很难恰好卡住单步跨度:论文原话是,很难选一个 $\beta$ 在整个学习过程中都合适(问题本身在变)。所以 PPO 用 clip 直接对单步比值设硬上限 $[1-\epsilon,1+\epsilon]$,不依赖 $\beta$ 调得准不准——KL 管长期锚定,clip 管单步跨度,两个防跑偏的机制各管一层(论文实验里,固定 KL 惩罚的效果也确实不如 clip)。

**PPO 的约束:裁剪,便宜。** PPO 把硬约束换成一步裁剪:

$$
L^{CLIP}(\theta)
= \mathbb{E}\Big[\min\big(r_t(\theta)\hat{A}_t,\ \operatorname{clip}(r_t(\theta),\,1-\epsilon,\,1+\epsilon)\,\hat{A}_t\big)\Big]
$$

$\operatorname{clip}(r,1-\epsilon,1+\epsilon)$ 把 $r$ 夹在 $[1-\epsilon,1+\epsilon]$ 里,$\epsilon$ 是超参(常用 0.2)。min 取两个值里较小的:比值越界时,目标被裁剪后的值封住,再怎么推也不加分。clip 只在"会让目标变好"的方向生效:抬好动作、压坏动作,到 $1\pm\epsilon$ 就封住;反向(压低好动作、抬高坏动作)不裁剪,全量罚。

## 4. 在 LLM 上:RLHF

InstructGPT 把这套接到语言模型上,三步:

1. **SFT**:用人工写的高质量回答微调,得到 $\pi^{\mathrm{SFT}}$;
2. **训奖励模型**:奖励模型是一个"给文本打分"的网络。结构上,它拿一个 SFT 模型,把最后一层(输出每个 token 概率的 unembedding 层)去掉,换成一个输出单个标量的投影层。输入是一段文本(prompt $x$ 加上回答 $y$),输出一个实数 $r(x,y)$——回答越好,分越高。注意规模:论文里奖励模型只用 **6B** 的(175B 的奖励模型训练不稳定),所以它是从 6B 的 SFT 模型改的,和后面要训练的任意规模策略不是同一个模型。

训练数据来自人。第 1 步的 SFT 模型已经会生成回答,用它给一批 prompt 各生成若干回答,让标注者比较同一 prompt 下的两个回答、选哪个更好(比较比打分可靠:人容易说"这个更好",难说"这个值 8 分")。这样得到一批偏好对 $(x, y_w, y_l)$,$y_w$ 是标注者选中的回答。

奖励模型一次只对一个 $(x,y)$ 打分。训练时,同一对里的两个回答各自送进模型一次,得 $r(x,y_w)$ 和 $r(x,y_l)$。损失用逻辑回归,让两者的差符合人的选择:

$$
\mathrm{loss} = -\mathbb{E}\big[\log\sigma\big(r(x,y_w) - r(x,y_l)\big)\big]
$$

$\sigma$ 是 sigmoid。$r(x,y_w)-r(x,y_l)$ 越大,"$y_w$ 优于 $y_l$"的概率越接近 1。最小化损失,就是让被偏好的回答得分高于另一个——模型学会给好的回答高分。

3. **PPO**:在 §2 的目标上做 PPO。

**每步的奖励信号从哪来。** 语言 RL 的 episode 是一条回答:策略按 §2 的状态/动作定义逐 token 生成 $y=(y_1,\dots,y_T)$,结束时奖励模型打一个分 $r(x,y)$。但 §3 的更新式 $\theta \leftarrow \theta+\alpha\nabla_\theta\ln\pi(a_t|s_t)\hat{A}_t$ 里,优势 $\hat{A}_t$ 是**每个 token 位置**都有的——每步更新都要一个信号,而奖励模型只给了整条一个分。中间缺一环:把"整条的一个分"补成每步能用的东西。这一环有两件东西:**即时奖励**(每步都有信号)和 **critic**(把信号串成优势)。

先看即时奖励。RLHF 里每个 token 位置 $t$ 的即时奖励由两部分构成:KL 惩罚(每步都有)加上奖励模型的分(只在最后一步有,其余为 0)。记第 $t$ 个 token 的 KL 惩罚为 $R_t$,奖励模型的分记 $r(x,y)$——所以第 $t$ 步即时奖励 = $R_t$(中间 token),最后一步 = $R_t + r(x,y)$。KL 惩罚就是 §2 目标里那个约束落到每一步:

$$
-\beta\ln\frac{\pi_\theta(y_t|x,y_{<t})}{\pi_{\mathrm{ref}}(y_t|x,y_{<t})}
$$

$\pi_{\mathrm{ref}}$ 是参考模型(SFT)。它和 §3 的重要性比 $\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 是两回事:重要性比在 clip 目标里重加权旧数据;这里的比值是 §2 的 KL 约束,锚定策略别离 SFT 太远。所以 §2 说"中间 token 没有奖励",指的是**奖励模型**没在中间打分;KL 惩罚是 PPO 加进每步的——中间 token 的即时奖励只有 KL 那一项,最后那个 token 才在 KL 之外加上 $r(x,y)$。

一个符号提醒:这个"惩罚项"不是 KL 散度本身(那个恒 $\ge 0$),它是 KL 散度逐 token 展开、加进奖励的一项,单个 token 上可正可负:$\pi_\theta>\pi_{\mathrm{ref}}$ 时(比 SFT 更偏激)$\ln>0$,这一项为负,扣分——偏离了 SFT;$\pi_\theta<\pi_{\mathrm{ref}}$ 时(比 SFT 更保守)$\ln<0$,这一项为正,加分——在往 SFT 靠。按 $\pi_\theta$ 对整条回答取期望,这一项的平均是 $-\beta\,\mathbb{D}_{\mathrm{KL}}\le 0$,和 §2 目标里减掉的那项一致:单个回答上可正可负,平均是扣的。

有了每步的即时奖励,再看第二件东西 **critic**:一个网络预估"从这个位置继续,平均还能拿多少"。有了它,把即时奖励串成回报、再减掉这个预测,就是每步的优势。

**critic:价值网络。** critic 是 $v(s_t,w)$,和策略 $\pi_\theta$ 并列的第二个模型。**它就是那个 6B 奖励模型换了个头**:论文原话"价值函数从奖励模型初始化",两者的结构一样(unembedding 层换成输出单个标量的投影层)。所以 critic 不是新造的,而是拿训练好的 6B 奖励模型当初始值,规模也是 6B——这也是为什么论文强调奖励模型要用 6B:175B 的训练不稳定,不适合当价值函数。

critic 对每个 token 位置输出一个数 $v(s_t,w)$,估计"从这里继续生成,平均还能拿多少奖励"。

**critic 怎么训练。** RL 阶段,策略按当前 $\pi_\theta$ 生成一条回答,每个 token 位置 $t$ 都有状态 $s_t$ 和 critic 的输出 $v(s_t,w)$;回答生成完,拿到真实奖励 $r(x,y)$。

每个 token 位置 $t$ 有了一个**目标值**:从 $t$ 出发、之后所有即时奖励的折现和

$$
G_t = R_t + \gamma\,R_{t+1} + \gamma^2\,R_{t+2} + \cdots
$$

其中 $R_t$ 是第 $t$ 个 token 的 KL 惩罚(上面定义的);即时奖励 = $R_t$(中间),最后一步 = $R_t + r(x,y)$。(具体数值下面全链路例子算。)

这个 $G_t$ 就是第 9 章的**回报(return)**:一条轨迹上实际发生的累计奖励。critic 想学的**状态价值**,从系列的定义出发:

$$
v_{\pi_\theta}(s) = \sum_a \pi_\theta(a|s)\,q_{\pi_\theta}(s,a),
\qquad
q_{\pi_\theta}(s,a) = \mathrm{E}\big[G_t \mid s_t = s, a_t = a\big]
$$

动作价值 $q$ 的期望按当前策略 $\pi_\theta$ 采样:给定状态 $s$ 和第一个动作 $a$,之后的动作都按 $\pi_\theta$ 走。把 $q$ 代进 $v$:

$$
v_{\pi_\theta}(s) = \sum_a \pi_\theta(a|s)\ \mathrm{E}\big[G_t \mid s_t = s, a_t = a\big]
$$

右边是"每个动作 $a$ 的期望回报,再按 $\pi_\theta(a|s)$ 加权"——也就是第一个动作按 $\pi_\theta$ 采样之后的期望回报。所以 $v$ 是"在 $s$ 按 $\pi_\theta$ 继续生成,平均能拿多少",只依赖状态、不依赖动作。critic 输出 $v(s_t,w)$,学的就是这个 $v_{\pi_\theta}$。

(对照:语言 RL 的 critic 不学动作价值 $q$。提它只为回应一个常见疑问:单步即时奖励 $R_t$ 只是 $G_t$ 的第一项,既不是 $q$,也不直接等于 critic 的输出。)

这个期望拿不到:要算它得知道每条轨迹的概率(转移 + 策略),语言 RL 里没有。能拿到的只有**采样**:按 $\pi_\theta$ 跑一条回答,在位置 $s_t$ 落下一个实际的 $G_t$。这条轨迹的第一个动作按 $\pi_\theta$ 采、之后也按 $\pi_\theta$ 走——所以 $G_t$ 天生就是上面那个期望的一个样本:以 $v_{\pi_\theta}(s_t)$ 为均值的一次观测。让 critic 往这些样本上回归:

$$
\mathrm{loss} = \big(v(s_t,w) - G_t\big)^2
$$

样本多了,$v(s_t,w)$ 平均逼近 $v_{\pi_\theta}(s_t)$。这就是 critic 的更新:目标 $G_t$ 不是随便定的,它就是状态价值定义里那个期望的样本;和第 8 章值函数近似一样,把预测往真实值挪,只是这里的"真实值"是采出来的 $G_t$。(PPO 论文把价值损失写进总目标 Eq. 9:$L^{VF}=(V_\theta(s_t)-V^{\mathrm{targ}}_t)^2$;InstructGPT 没展开这个公式,只给了 GAE 和 $\gamma=1$。上面用完整回报 $G_t$ 当目标,是 $\lambda=1$ 的 GAE 回报,和例子④配套。)

**优势:实际比预期好多少。** 有了 critic 的预测 $v(s_t)$,就能算优势——这条回答实际拿到的,比价值预期的好多少。最直接的单步估计是 A2C 的 TD 误差:

$$
\delta_t = R_t + \gamma\,v(s_{t+1},w) - v(s_t,w)
$$

$R_t$ 是第 $t$ 个 token 的 KL 惩罚;最后一步的即时奖励 $R_t + r(x,y)$ 才把奖励模型的分加进来。

PPO 不直接用单步 $\delta_t$,而用 **GAE**(generalized advantage estimation,广义优势估计),把后面几步的 $\delta$ 按折现加权加起来:

$$
\hat{A}_t = \delta_t + \lambda\,\delta_{t+1} + \lambda^2\,\delta_{t+2} + \cdots
$$

直觉:把相邻的价值差一路累加,中间的 $v$ 互相抵消,最后剩下的就是"最终奖励 − 当前价值"。$\lambda$ 控制累加多远:$\lambda=0$ 退化成单步,$\lambda=1$ 变成完整回报,常用 $\lambda=0.95$ 折中。InstructGPT 里不折现,即 $\gamma=1$。

**把全链路手算一遍。** 为能手算,用一条极短的回答:prompt $x$,模型生成 2 个 token $y=(y_1,y_2)$。设 $\beta=0.02$、$\gamma=1$(不折现)、$\epsilon=0.2$。旧策略(采样时)和参考策略都给具体的每-token 概率:

| token | $\pi_{\theta_{\mathrm{old}}}(y_t\mid x,y_{<t})$ | $\pi_{\mathrm{ref}}(y_t\mid x,y_{<t})$ | 奖励模型的分 |
|---|---|---|---|
| $y_1$ | $0.4$ | $0.5$ | — |
| $y_2$ | $0.3$ | $0.6$ | — |
| 回答结束 | — | — | $r(x,y)=+1$ |

假设这一轮 PPO 更新刚开始:当前 $\pi_\theta$ 和采样策略 $\pi_{\theta_{\mathrm{old}}}$ 相同(本轮还没动),所以 $\pi_\theta=\pi_{\theta_{\mathrm{old}}}$(这轮算的比值都是 1,正好演示无裁剪的更新)。注意 $\pi_{\theta_{\mathrm{old}}}$ 是上一轮更新后的策略,不等于参考模型 $\pi_{\mathrm{ref}}$(SFT)——策略已经从 SFT 走开了一段,所以表里两列的概率不同。位置 2 的条件是 $(x,y_1)$(表头里写的是 $y_{<t}$);下面为简洁,位置 2 的概率写成 $\pi_\theta(y_2|x)$、省略条件 $y_1$。

**① 每步奖励(含 KL 惩罚)。** 按上面的定义算即时奖励:$y_1$ 是中间 token,奖励模型不给分,即时奖励 = KL 惩罚;$y_2$ 是最后 token,即时奖励 = KL 惩罚 + 奖励模型的分:

- $y_1$:$-\beta\ln\frac{0.4}{0.5} = -0.02\ln0.8 = -0.02\times(-0.223) = +0.0045$($\pi_\theta<\pi_{\mathrm{ref}}$,往 SFT 靠,所以是正的,见上面符号说明);
- $y_2$:KL 惩罚 $-\beta\ln\frac{0.3}{0.6} = -0.02\ln0.5 = -0.02\times(-0.693) = +0.0139$,再加奖励模型的分 $+1$,即时奖励 $= 0.0139 + 1$。

**② 实际回报 $G_t$。** $\gamma=1$,从 $s_t$ 出发的回报 = 之后所有即时奖励折现和($R_1$、$R_2$ 就是上面算的 KL 惩罚,$+1$ 是最后 token 的奖励模型分)。回答只有 2 个 token,在 $s_2$(已生成 $y_1$)处:

$$
G_{s_2} = R_2 + 1 = 0.0139 + 1 = 1.0139
$$

在 $s_1$(还没生成)处:

$$
G_{s_1} = R_1 + R_2 + 1 = 0.0045 + 0.0139 + 1 = 1.0184
$$

(这两个 $G_t$ 就是 critic 的监督目标。)

**③ critic 更新。** 假设 critic 当前输出 $v(s_1)=0.9$、$v(s_2)=1.0$。critic 的均方误差:

- $s_1$:$(0.9-1.0184)^2 = 0.0140$
- $s_2$:$(1.0-1.0139)^2 = 0.0002$

梯度把这些 $v(s_t)$ 往目标拉近:$v(s_1)$ 从 0.9 抬向 1.0184,$v(s_2)$ 从 1.0 抬向 1.0139。

**④ 优势:用 GAE 算。** 先算每个位置的 TD 误差 $\delta_t = R_t + \gamma v(s_{t+1}) - v(s_t)$(终点 $s_3$ 的价值取 0):

- $\delta_1 = R_1 + v(s_2) - v(s_1) = 0.0045 + 1.0 - 0.9 = 0.1045$
- $\delta_2 = R_2 + r(x,y) + 0 - v(s_2) = 0.0139 + 1 + 0 - 1.0 = 0.0139$

GAE 是 $\hat{A}_t = \delta_t + \lambda\delta_{t+1} + \lambda^2\delta_{t+2} + \cdots$。取 $\lambda=1$(完整回报):

- $\hat{A}_1 = \delta_1 + \delta_2 = 0.1045 + 0.0139 = 0.1184$
- $\hat{A}_2 = \delta_2 = 0.0139$

注意这正好等于 $G_t - v(s_t)$($G_1-v_1=1.0184-0.9=0.1184$,$G_2-v_2=1.0139-1.0=0.0139$)——因为 $\lambda=1$ 时,GAE 把相邻 $\delta$ 累加,中间的 $v$ 抵消,最后就是"实际回报 − 价值",和前面讲的等价。两个优势都为正:这条回答实际拿到的比 critic 预期的多。

**⑤ 策略更新(clip)和反向传播。** 因为第一轮 $\pi_\theta=\pi_{\theta_{\mathrm{old}}}$,重要性比 $r_t(\theta)=1$ 都在 $[0.8,1.2]$ 内,clip 不生效。每个 token 的"目标项" = $r_t(\theta)\hat{A}_t = 1\times\hat{A}_t$。整条回答的策略更新目标 $L$ = 两个 token 的目标项之和:

$$
L = \hat{A}_1\,r_1(\theta) + \hat{A}_2\,r_2(\theta)
= 0.1184\times\frac{\pi_\theta(y_1|x)}{0.4} + 0.0139\times\frac{\pi_\theta(y_2|x)}{0.3}
$$

这个 $L$ 就是策略的"损失"(梯度上升用,符号见 §3)。反向传播就是算 $\nabla_\theta L$。梯度沿依赖链往回穿:$L$ 依赖重要性比 $r_t(\theta)=\pi_\theta(y_t|x)/\pi_{\theta_{\mathrm{old}}}$,概率 $\pi_\theta(y_t)$ 又由模型最后一层 softmax 决定。所以从 $L$ 出发,先算对概率的梯度(外层),再乘上概率对 logits 的 softmax 导数,一路穿到 $W$、$h_t$。

**外层:$L$ 对两个 token 概率的梯度。** $L=\hat{A}_1\pi_\theta(y_1|x)/0.4+\hat{A}_2\pi_\theta(y_2|x)/0.3$,对概率求导,旧概率是常数:

$$
\frac{\partial L}{\partial \pi_\theta(y_1|x)} = \frac{\hat{A}_1}{0.4} = \frac{0.1184}{0.4} = 0.296,
\qquad
\frac{\partial L}{\partial \pi_\theta(y_2|x)} = \frac{\hat{A}_2}{0.3} = \frac{0.0139}{0.3} = 0.0463
$$

两个都为正:$L$ 随"生成 $y_1$、$y_2$ 的概率"单调上升,所以梯度方向是让这两个概率都变大;幅度由优势决定,$y_1$ 的优势大,这层就大。但这不是参数梯度——还差一层:概率怎么被 logits 改。

**内层:概率对 logits 的 softmax 导数。** 反向传播到这里,要面对一个**分数**。模型在位置 $t$ 并不直接输出概率:最后一层隐藏向量 $h_t$ 乘线性层 $W$,先给词表里每个候选 token $k$ 打一个分数 $z_k$(这些分数合起来写成向量 $z=Wh_t$,叫 logits)。分数越高,模型越倾向选它。$z_{y_1}$ 就是"候选 token $y_1$ 的分数"。softmax 把分数变成概率——分数越大 $e^{z_k}$ 越大、概率越高:

$$
\pi_\theta(k|x,y_{<t}) = \frac{e^{z_k}}{\sum_{k'} e^{z_{k'}}}
$$

梯度要穿过 softmax,才能从概率回到分数,所以先要知道概率随分数怎么变——softmax 的导数:

$$
\frac{\partial \pi_\theta(k)}{\partial z_{k'}} = \pi_\theta(k)\big(\delta_{k,k'} - \pi_\theta(k')\big)
$$

($\delta_{k,k'}$ 是克罗内克函数:$k=k'$ 时为 1,否则 0。)算数值时不需要知道词表:对位置 $t$ 自己那个 token $y_t$,导数里自身项 $\partial\pi_\theta(y_t)/\partial z_{y_t}=\pi_\theta(y_t)(1-\pi_\theta(y_t))$,$1-\pi_\theta(y_t)$ 是"其余所有候选的概率之和"——表里就有 $\pi_\theta(y_1)=0.4$、$\pi_\theta(y_2)=0.3$。

位置 1(生成 $y_1$):链式法则,$\partial L/\partial z_{y_1} = \partial L/\partial\pi_\theta(y_1) \times \partial\pi_\theta(y_1)/\partial z_{y_1}$——先算 $L$ 对概率的梯度(刚算的 $0.296$),再乘概率对 logit 的 softmax 导数(概率怎么随 logit 变)。后一个因子用导数公式里的自身项:$\partial\pi_\theta(y_1)/\partial z_{y_1} = \pi_\theta(y_1)(1-\pi_\theta(y_1)) = 0.4\times0.6 = 0.24$,其中 $1-\pi_\theta(y_1)=0.6$ 是其余所有候选的概率之和。相乘:

$$
\frac{\partial L}{\partial z_{y_1}} = 0.296\times0.24 = 0.071
$$

对别的候选 $k'\neq y_1$:交叉项 $\partial\pi_\theta(y_1)/\partial z_{k'}=-\pi_\theta(y_1)\pi_\theta(k')<0$,梯度把它们的 logit 压下去,幅度按各自的 $\pi_\theta(k')$ 分配;所有候选的梯度之和为 0(一个被抬 $+0.071$,其余合计 $-0.071$)。

位置 2(生成 $y_2$):同样的链式,$\partial L/\partial z_{y_2} = \partial L/\partial\pi_\theta(y_2) \times \partial\pi_\theta(y_2)/\partial z_{y_2} = 0.0463 \times 0.3\times0.7$:

$$
\frac{\partial L}{\partial z_{y_2}} = 0.0463\times0.21 = 0.0097
$$

同样抬 $y_2$ 的 logit、压其余候选,但幅度只有 $0.0097$——外层梯度小(优势 $0.0139$ 对 $0.1184$),差了一个量级。

再往前到 $W$ 和 $h_t$:$\partial L/\partial W = (\partial L/\partial z)\,h_t^{\top}$、$\partial L/\partial h_t = W^{\top}(\partial L/\partial z)$,就是一般矩阵梯度,优化器(Adam)据此更新 $\theta$。

**这五步就是一条完整链路**:每步奖励(含 KL)→ 实际回报 → critic 更新 → 优势 → 策略更新。注意每个信号的去向:KL 惩罚在①进了每步奖励,奖励在②进了 $G_t$,$G_t$ 在③更新 critic、在④减 $v$ 得优势,优势在⑤更新策略。critic 的输出 $v$ 和 KL 惩罚都不直接在 clip 公式里出现——它们先被组合进 $G_t$ 和 $\hat{A}_t$,$\hat{A}_t$ 才进 clip。

## 5. 小结

- **问题没变**:对指标做梯度上升,变的是 $\nabla_\theta\ln\pi$ 前面的信号怎么算、怎么防止更新跑偏。
- **同一批数据多轮更新靠重要性比**:$\theta_{\mathrm{old}}$ 是采数据时的策略,比值 $r_t=\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 校正"数据是旧策略采的";一次采样、一次更新就不需要它。
- **clip 管单步,KL 管长期**:$\theta$ 多轮更新会让比值偏离 1,clip 把一步更新封在 $[1-\epsilon,1+\epsilon]$;§2 的 KL 约束锚定 $\pi_{\mathrm{ref}}$(SFT),管整个训练不漂太远。两个防跑偏机制各管一层。
- **RLHF 管线**:SFT → 奖励模型(6B,偏好数据训)→ PPO。一条回答是一条 episode,奖励模型给一个分;critic(拿奖励模型初始化)把它摊成逐 token 优势;KL 惩罚逐 token 扣,β=0.02、ε=0.2。
- 简言之:PPO 把课本的策略梯度搬到文本世界,信号是优势,防跑偏靠 clip。
`,
}
export default article
