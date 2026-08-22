const article = {
  slug: 'dpo',
  date: '2026-08-22 14:30',
  name: 'Direct Preference Optimization: DPO',
  description: 'RLHF 要训奖励模型、在线采样、走 PPO,还要 critic 和一堆超参。DPO 换一条路:不训练奖励模型,不采样,不走 RL 循环——把 RL 目标解出闭式解,一个监督损失就完成对齐。推导三步:最优策略闭式解 → 隐式奖励 → Bradley-Terry 偏好模型。critic、clip 都不要了,KL 约束内化在隐式奖励里;一条 2-token 偏好对数字手算。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: 'DPO 从同一个 RLHF 目标(KL 约束的奖励最大化)出发,先解出最优策略的闭式形式 π*∝π_ref·e^{r/β},反推出隐式奖励 βln(π_θ/π_ref),代入 Bradley-Terry 偏好模型得一个二分类交叉熵损失。梯度是带权策略梯度:抬 y_w、压 y_l,权重=模型当前有多错。对账:critic 没了(不采样不估回报)、clip 没了(无重要性比)、KL 内化(β 是 KL 系数、π_ref 是锚定)。',
  detail: String.raw`
## 1. RLHF 的问题

上一讲(RLHF/PPO)走的是完整 RL 路:训奖励模型、在线采样、PPO 更新,还要 critic 和一堆超参。DPO 换一条路:**不训练奖励模型,不采样,不走 RL 循环**——只用一个监督损失。它从同一个 RLHF 目标出发,但发现这个目标能直接解出最优策略的闭式形式,于是绕开了 RL 那套机器。

先把语言 RL 的基础摆好(§2),再走 DPO 的三步推导(§3),最后用一条 2-token 偏好对把全链路手算一遍(§3 内)。

## 2. 语言 RL 的基础

**一个回答是一条 token 序列。** 大模型逐 token 生成回答:给定 prompt $x$,输出回答 $y=(y_1,\dots,y_T)$,整条回答的概率是逐 token 概率的乘积。$\pi_\theta(y|x)$ 是当前策略给回答的概率,$\pi_{\mathrm{ref}}(y|x)$ 是参考模型(SFT)的概率。这就是上一篇里"在语言上做 RL"的翻译:状态是已生成的序列,动作是下一个 token,奖励在回答结束时给一个分。

**RLHF 目标。** 后训练想让"奖励的期望大、但别离参考策略太远",目标是:

$$
\max_\theta\ \mathbb{E}_{x\sim\mathcal{D}}\Big[\mathbb{E}_{y\sim\pi_\theta(y|x)}\big[r(x,y)\big] - \beta\,\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)\Big]
$$

$r(x,y)$ 是回答的奖励,$\beta>0$ 是 KL 系数,$\mathbb{D}_{\mathrm{KL}}$ 是 KL 散度。DPO 的推导就从这里出发。

**奖励模型和偏好对。** RLHF 的第一步是用人类偏好数据训练奖励模型:给一批 prompt,让标注者比较同一 prompt 下的两个回答、选哪个更好,得到偏好对 $(x, y_w, y_l)$($y_w$ 是标注者选中的)。奖励模型训练时假设"$y_w$ 优于 $y_l$"的概率是 sigmoid 作用在两者奖励差上:

$$
p(y_w \succ y_l|x) = \sigma\big(r(x,y_w) - r(x,y_l)\big)
$$

$\sigma$ 是 sigmoid。这个偏好模型(叫 Bradley-Terry 模型)在 DPO 里会原样出现。$\succ$ 读作"优于":$y_w$ 在偏好里排在 $y_l$ 前面;两个回答是文本,不比大小,只比好坏。

为了能手算,玩具语言:**词表只有两个 token $a$ 和 $b$**,下面的例子用 2-token 回答。

## 3. DPO

推导里有两个策略要分清:$\pi_{\mathrm{ref}}$ 是参考模型(SFT),固定不动;$\pi^*$ 是某个奖励 $r$ 对应的**最优策略**(推导里的概念,不是实际模型);我们正在训练的是 $\pi_\theta$。推导核心一句话:**如果 $\pi_\theta$ 学到了最优,它就该等于 $\pi^*$**——后面把 $\pi^*$ 换成 $\pi_\theta$,是同一个对象换名字。

**第一步:最优策略长什么样。** 对每个 prompt $x$,§2 的目标是"奖励的期望大、但别离参考策略 $\pi_{\mathrm{ref}}$ 太远"。这类 KL 约束问题的闭式解是:**把 $\pi_{\mathrm{ref}}$ 按分数 $e^{r(x,y)/\beta}$ 重新加权**——分数越高的回答,概率被放得越大:

$$
\pi^*(y|x) = \frac{1}{Z(x)}\,\pi_{\mathrm{ref}}(y|x)\,e^{r(x,y)/\beta},
\qquad
Z(x) = \sum_y \pi_{\mathrm{ref}}(y|x)\,e^{r(x,y)/\beta}
$$

$\beta$ 控制放大程度($\beta$ 小放大得越狠,$\beta$ 大越接近 $\pi_{\mathrm{ref}}$),$Z(x)$ 是归一化常数(把所有回答的权重加起来,保证概率之和为 1)。为什么它是最优:把 $\pi^*$ 代回目标,任意 $\pi$ 的目标值等于 $-\beta\,\mathbb{D}_{\mathrm{KL}}(\pi\|\pi^*)+$ 与 $\pi$ 无关的常数,KL 散度 $\ge0$ 只在 $\pi=\pi^*$ 时取 0——最优策略就是"往高分方向重加权"。

**第二步:把奖励换成策略,奖励就被消掉了。** 对 $\pi^*$ 的式子取对数:

$$
r(x,y) = \beta\ln\frac{\pi^*(y|x)}{\pi_{\mathrm{ref}}(y|x)} + \beta\ln Z(x)
$$

意思是:最优策略本身就编码了奖励——从 $\pi^*$ 和 $\pi_{\mathrm{ref}}$ 就能读出 $r$。$\beta\ln Z(x)$ 只依赖 $x$、不依赖回答,后面会相消。把 $\pi^*$ 换成要学的 $\pi_\theta$,得到**隐式奖励**:

$$
\hat{r}_\theta(x,y) = \beta\ln\frac{\pi_\theta(y|x)}{\pi_{\mathrm{ref}}(y|x)}
$$

$\pi_\theta$ 给回答 $y$ 的概率比 $\pi_{\mathrm{ref}}$ 高多少,就代表它认为 $y$ 比"平均"好多少。**奖励模型不见了**——全程只用 $\pi_\theta$ 和 $\pi_{\mathrm{ref}}$。这就是论文标题的来源(你的语言模型隐藏着一个奖励模型)。

**第三步:人的偏好怎么进来。** 用 §2 奖励模型训练时同一个偏好模型——"$y_w$ 优于 $y_l$"的概率是 sigmoid 作用在两者奖励差上。把隐式奖励代进去,同一 prompt 的两个回答共享的 $\beta\ln Z(x)$ 相消:

$$
p(y_w \succ y_l|x) = \sigma\Big(\beta\ln\frac{\pi_\theta(y_w|x)}{\pi_{\mathrm{ref}}(y_w|x)}
- \beta\ln\frac{\pi_\theta(y_l|x)}{\pi_{\mathrm{ref}}(y_l|x)}\Big)
$$

**DPO 损失**就是最大化这个概率(取负对数):

$$
\mathcal{L}_{\mathrm{DPO}}(\theta)
= -\mathbb{E}_{(x,y_w,y_l)\sim\mathcal{D}}\Big[\log\sigma\Big(\beta\ln\frac{\pi_\theta(y_w|x)}{\pi_{\mathrm{ref}}(y_w|x)}
- \beta\ln\frac{\pi_\theta(y_l|x)}{\pi_{\mathrm{ref}}(y_l|x)}\Big)\Big]
$$

一个二分类交叉熵损失:括号里是 logits(隐式奖励差),标签是"$y_w$ 比 $y_l$ 好"。没有奖励模型、没有采样、没有 RL 循环——一份静态偏好数据集上的监督训练。

到这里对一下账:PPO 里的东西,在 DPO 里怎么样了?

- **critic 没了。** critic 存在的理由是估计"从这个位置继续能拿多少",给优势当基线。DPO 不走 RL 更新:它不采样、不估计回报,损失只比较两条现成的回答,所以没有价值网络,也没有 GAE 那套。
- **clip 也没了。** clip 是 PPO 为了"同一批数据多轮更新时,重要性比别放大"加的。DPO 不用重要性比重加权数据,一步就在一个偏好对上做一次监督梯度,没有多轮复用同一批数据的问题,自然不需要 clip。
- **KL 约束还在,但内化了。** 推导就是从 §2 那个带 KL 约束的目标出发的——闭式解 $\pi^*\propto\pi_{\mathrm{ref}}e^{r/\beta}$ 正是这个约束的解,不是凭空来的。KL 系数 $\beta$ 出现在隐式奖励 $\hat{r}_\theta=\beta\ln(\pi_\theta/\pi_{\mathrm{ref}})$ 里;隐式奖励里那个 $\pi_{\mathrm{ref}}$ 就是 KL 锚定的体现——$\pi_\theta$ 给回答的概率相对 $\pi_{\mathrm{ref}}$ 抬高多少,才被当成多少"好"。PPO 把 KL 惩罚逐 token 扣进奖励,DPO 把 KL 写进目标、解进闭式解,再让隐式奖励把它带进损失。同一个约束,放的位置不同。

和上一讲一样给具体数字。词表 $\{a,b\}$,每条回答 2 个 token。偏好对:人标注 $y_w=(a,b) \succ y_l=(b,a)$(人偏好"a 开头、b 结尾"那条)。$\pi_\theta$ 从参考模型 $\pi_{\mathrm{ref}}$(SFT)初始化;下面展示的是训练若干步之后的一次更新,此时 $\pi_\theta$ 已经偏离 $\pi_{\mathrm{ref}}$。逐 token 概率:

| token 位置 | $\pi_{\mathrm{ref}}$ | $\pi_\theta$(当前) |
|---|---|---|
| $y_w$ 位置 1($a$) | $0.4$ | $0.4$ |
| $y_w$ 位置 2($b\mid x,a$) | $0.6$ | $0.4$ |
| $y_l$ 位置 1($b$) | $0.6$ | $0.6$ |
| $y_l$ 位置 2($a\mid x,b$) | $0.6$ | $0.6$ |

取 $\beta=0.1$。注意位置 2 的 $(x,a)$ 条件下,$\pi_\theta$ 给 $b$ 只有 $0.4$(参考模型给 $0.6$),而 $b$ 正是 $y_w$ 的第二个 token——模型现在相对地冷落了被偏好的 $y_w$。它把判断做错了,DPO 这一步就是要把这个错误纠正回来。

**① 整条回答的 log 概率。** 回答的 log 概率 = 各位置 log 概率之和。$y_w$:$\ln\pi_\theta(y_w)=\ln0.4+\ln0.4=-0.916-0.916=-1.833$,而 $\ln\pi_{\mathrm{ref}}(y_w)=\ln0.4+\ln0.6=-0.916-0.511=-1.427$;$y_l$:$\ln\pi_\theta(y_l)=\ln0.6+\ln0.6=-0.511-0.511=-1.022$,同值 $\ln\pi_{\mathrm{ref}}(y_l)=-1.022$。

这四个数就是 DPO 的输入。它们不单独起作用:隐式奖励 $\hat{r}_\theta(y)=\beta(\ln\pi_\theta(y)-\ln\pi_{\mathrm{ref}}(y))$ 用的是每条回答的 log 概率差——$y_w$ 的差是 $\beta(-1.833+1.427)=\beta(-0.406)$,而 $y_l$ 的差是 $\beta(-1.022+1.022)=0$。模型把 $y_l$ 的相对分抬到了 $y_w$ 之上,这就是它的判断错误。

**② 隐式奖励差 $h$。** $h=\beta\big[(\ln\pi_\theta(y_w)-\ln\pi_{\mathrm{ref}}(y_w))-(\ln\pi_\theta(y_l)-\ln\pi_{\mathrm{ref}}(y_l))\big]=0.1(-0.406-0)=-0.0406$。$h<0$:模型当前认为 $y_l$ 相对更好,和人的偏好相反。

**③ 损失。** $\mathcal{L}=-\log\sigma(h)=-\log\sigma(-0.0406)=0.714$。

**④ 梯度:判断越错,推得越狠。** 对损失求 $\theta$ 的梯度。用 $\frac{d}{dh}\log\sigma(h)=1-\sigma(h)$,而 $\nabla_\theta h=\beta[\nabla_\theta\ln\pi_\theta(y_w)-\nabla_\theta\ln\pi_\theta(y_l)]$($\pi_{\mathrm{ref}}$ 固定,不贡献梯度),所以

$$
\nabla_\theta\mathcal{L}
= -\big(1-\sigma(h)\big)\nabla_\theta h
= \beta\big(1-\sigma(h)\big)\big[\nabla_\theta\ln\pi_\theta(y_l)-\nabla_\theta\ln\pi_\theta(y_w)\big]
$$

代入 $h=-0.0406$:$\sigma(-0.0406)\approx0.49$,权重 $\beta(1-\sigma(h))=0.1\times0.51=0.051$——比中立时($h=0$ 的 $0.05$)略大:模型错得越多,这一步推得越重。梯度下降时,$\nabla\ln\pi_\theta(y_w)$ 前的系数是负的,朝它的方向走把 $y_w$ 概率**抬**上去;$\nabla\ln\pi_\theta(y_l)$ 前的系数是正的,背对它的方向把 $y_l$ 概率**压**下来,力度都是 $0.051$。权重 $1-\sigma(h)$ 是"模型当前认为 $y_l$ 更好的概率"——**判断越错,推得越狠**;判断对了($h$ 大正),权重趋近 0,不会过度修正。

**⑤ 穿过 softmax(位置 1)。** $\nabla L=0.051[\nabla\ln\pi_\theta(y_l)-\nabla\ln\pi_\theta(y_w)]$ 逐 token 展开:$\ln\pi_\theta(y_w)=\ln\pi_\theta(a|x)+\ln\pi_\theta(b|x,a)$、$\ln\pi_\theta(y_l)=\ln\pi_\theta(b|x)+\ln\pi_\theta(a|x,b)$。位置 1 的 logits $z_a$、$z_b$ 只影响位置 1 的 softmax,即 $\ln\pi(a|x)$、$\ln\pi(b|x)$;位置 2 的 $\ln\pi(b|x,a)$、$\ln\pi(a|x,b)$ 不涉及它们。所以 $\nabla L$ 里属于位置 1 的部分是

$$
0.051\big[\nabla\ln\pi(b|x)-\nabla\ln\pi(a|x)\big]
$$

($y_l$ 以 $b$ 开头、$y_w$ 以 $a$ 开头,$y_l-y_w$ 所以是 $b$ 减 $a$)。位置 1 概率 $\pi(a|x)=0.4$、$\pi(b|x)=0.6$。$\ln\pi$ 对 logit 的导数:$\partial\ln\pi(k)/\partial z_{k'}=\frac{1}{\pi(k)}\,\partial\pi(k)/\partial z_{k'}=\delta_{k,k'}-\pi(k')$——注意这是"log 概率"对 logit 的导数,和上一讲里"概率对 logit 的导数"$\pi(k)(\delta_{k,k'}-\pi(k'))$ 差一个除以 $\pi(k)$:因为 DPO 梯度里出现的是 $\nabla\ln\pi$ 而不是 $\nabla\pi$。代入得 $\partial\ln\pi(a)/\partial z_a=0.6$、$\partial\ln\pi(b)/\partial z_a=-0.4$、$\partial\ln\pi(a)/\partial z_b=-0.6$、$\partial\ln\pi(b)/\partial z_b=0.4$。于是

$$
\frac{\partial\mathcal{L}}{\partial z_a} = 0.051\big[\partial\ln\pi(b)/\partial z_a - \partial\ln\pi(a)/\partial z_a\big] = 0.051(-0.4-0.6) = -0.051
$$

$$
\frac{\partial\mathcal{L}}{\partial z_b} = 0.051\big[\partial\ln\pi(b)/\partial z_b - \partial\ln\pi(a)/\partial z_b\big] = 0.051(0.4+0.6) = +0.051
$$

梯度下降把参数往梯度反方向挪($\theta\leftarrow\theta-\alpha\nabla L$),所以 $\partial\mathcal{L}/\partial z_a=-0.051<0$ 的意思是"$z_a$ 越大、损失越小"——更新时 $z_a\leftarrow z_a-\alpha(-0.051)$,减负数等于加,$z_a$ 变大,softmax 后 $a$ 的概率跟着变大,即把 $a$ 的分数**抬**上去($y_w$ 以 $a$ 开头,被偏好,该抬);$\partial\mathcal{L}/\partial z_b=+0.051>0$ 则相反:更新把 $z_b$ 调小,$b$ 的概率被**压**下来($y_l$ 以 $b$ 开头)。位置 2 方向相同:在条件 $(x,a)$ 下把刚才被冷落的 $b$($y_w$ 的第二个 token)**抬**回来、压 $a$;在条件 $(x,b)$ 下压 $a$($y_l$ 的第二个 token)、抬 $b$。

**这一轮走完**:位置 1 的 $a$ 被抬、$b$ 被压,位置 2 在 $(x,a)$ 下把被冷落的 $b$ 重新抬起来,$\pi_\theta$ 朝"人类偏好的 $y_w$"挪了一步,模型刚才的判断错误被修正了一点。全程没有采样、没有奖励模型、没有 critic——就是一次前向(算整条回答的 log 概率)+ 一次反向。

## 4. 小结

- **DPO 从同一个 RLHF 目标出发**:KL 约束的奖励最大化,先解出最优策略闭式解 $\pi^*\propto\pi_{\mathrm{ref}}e^{r/\beta}$。
- **反推隐式奖励**:$r$ 被消掉,$\hat{r}_\theta=\beta\ln(\pi_\theta/\pi_{\mathrm{ref}})$——模型本身隐藏着奖励。
- **代入 Bradley-Terry**:得一个二分类交叉熵损失,括号里是隐式奖励差,标签是"$y_w$ 比 $y_l$ 好"。
- **梯度是带权策略梯度**:抬 $y_w$、压 $y_l$,权重 $\beta(1-\sigma(h))$=模型当前有多错。
- **对账**:critic 没了、clip 没了、KL 内化。不训练奖励模型、不采样、不走 RL 循环。
- 代价:数据是离线的,不能像 PPO 那样按当前策略生成新数据。实际系统常把两者配合:离线方法(DPO 这类)先对齐,在线 RL(PPO 或 GRPO)再在关键任务上继续提升。
`,
}
export default article
