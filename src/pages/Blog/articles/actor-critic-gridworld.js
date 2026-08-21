const article = {
  slug: 'actor-critic-gridworld',
  date: '2026-08-21 14:06',
  name: 'Actor-Critic Methods in a 3×3 Grid World',
  description: '第 10 课:actor-critic。上一课的 REINFORCE 用整条 episode 的回报估 q_t;这一课只动一处——q_t 换成学出来的价值函数(TD),策略(actor)和价值(critic)每步同步更新。一条主线:QAC 给 REINFORCE 加 critic,再把 actor 的信号从 q 换成优势 q−v(A2C)。off-policy 和 DPG 各一句带过。3×3 上每一步更新都能手算。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: '策略梯度更新式里 q_t 怎么估,决定算法叫什么:上一章用整条 episode 的回报(REINFORCE),这一章换成 TD 一步备份(actor-critic)。一条主线:先给 REINFORCE 加个 critic,每步估 q_t(QAC);再把 actor 的信号从 q 换成优势 q−v(A2C)——减基线梯度不变,无模型下用 TD error 近似,只用一个 v。off-policy(乘 π/β 换数据)和 DPG(确定性策略,链式法则)各一句带过。3×3 上每一步更新都能手算,价值从目标一格一格传回起点。',
  detail: String.raw`
## 1. 这一篇要解决什么问题

上一章停在 REINFORCE:

$$
\theta_{t+1} = \theta_t + \alpha\,\nabla_\theta\ln\pi(a_t|s_t,\theta_t)\,q_t(s_t,a_t)
$$

$q_t$ 是 $q_\pi(s_t,a_t)$ 的估计。上一章用整条 episode 的回报(MC)估它——要等一条 episode 走完,而且单条回报波动大。这一篇只动一处:**$q_t$ 换成用一个学出来的价值函数,每走一步估一次(TD)**。

更新式里有两个角色。策略 $\pi(a|s,\theta)$ 决定每个状态选什么动作——它负责"做",叫 **actor**(演员)。价值函数评价动作好坏——它负责"打分",叫 **critic**(评论家)。评论家把分数给演员:这一步做得好,演员就照着走;做得差,就换个方向。策略配 TD 价值估计,每步两个都更新,这套算法叫 **actor-critic**。

沿用 3×3 grid world:目标 $s_9(+1)$、禁区 $s_6(-1)$、撞墙 $-1$、其他 $0$,$\gamma=0.9$,5 个动作,确定性转移,初始策略 $\pi_0$ 均匀(每个动作 $1/5$)。

后面按一条线走:

- §2 给 REINFORCE 加一个 critic,每步估 $q_t$。叫 QAC。
- §3 把 actor 的信号从 $q$ 换成 $q-v$。叫 A2C。
- §4 还有两种做法(off-policy、DPG),各一两句带过。

## 2. QAC:给 REINFORCE 加一个 critic

REINFORCE 里 $q_t$ 用整条回报 $G_t$,要等一条 episode 走完才拿得到,单条回报波动还大。这一节给它加一个 **critic**——一个学出来的动作价值 $q(s,a,w)$,每走一步估一次 $q_t$。actor 不用等 episode 结束,每步都能更新。

critic 怎么学?走完一步,拿到 $(s_t,a_t,r_{t+1},s_{t+1})$,再按当前策略在 $s_{t+1}$ 选一个动作 $a_{t+1}$。目标:让 $q(s_t,a_t)$ 更接近 $r_{t+1}+\gamma q(s_{t+1},a_{t+1})$——这一步实际拿到的奖励,加上下一步的价值。这个"一步目标"叫一步备份。更新式就是第 8 章的 Sarsa:

$$
w_{t+1} = w_t + \alpha_w\big[r_{t+1} + \gamma\,q(s_{t+1},a_{t+1},w_t) - q(s_t,a_t,w_t)\big]\nabla_w q(s_t,a_t,w_t)
$$

括号里是"一步目标 − 当前值",是误差;$\nabla_w q$ 告诉 $w$ 往哪个方向改,才能让 $q$ 更接近目标。

actor 拿 critic 的 $q$ 当信号,还是上一章的更新式:

$$
\theta_{t+1} = \theta_t + \alpha_\theta\,\nabla_\theta\ln\pi(a_t|s_t,\theta_t)\,q(s_t,a_t,w_t)
$$

$\nabla_\theta\ln\pi(a_t|s_t)$ 是"让 $\pi(a_t|s_t)$ 变大的方向",$q$ 越大,这一步把"选 $a_t$"的概率抬得越狠。

和 REINFORCE 只差这一处:$q_t$ 从整条回报 $G_t$ 换成 critic 的 $q(s,a,w)$。REINFORCE 要等走完,QAC 每步都能更新。

**在 3×3 上算一步。** critic 用查表 $q$(one-hot 特征就是查表,第 8 章 §6),初始 $\theta=0$、$\hat{q}=0$,$\alpha_w=0.1$、$\alpha_\theta=0.05$。设从 $s_8$ 走 right 到 $s_9$($r=+1$):

$$
\hat{q}(s_8,\mathrm{right}) \leftarrow 0 + 0.1\times(1 + 0.9\times 0 - 0) = 0.1
$$

actor 要 $\nabla_\theta\ln\pi(\mathrm{right}|s_8)$。上一章 §5 推过:第 $a'$ 个分量是 $\delta_{a,a'}-\pi(a'|s)$,其中 $\delta_{a,a'}$ 在 $a'=a$ 时为 1、否则为 0。$\theta=0$ 时 $\pi(a'|s)=1/5$,取 $a=\mathrm{right}$:

$$
\nabla_\theta\ln\pi(\mathrm{right}|s_8) = [\,-0.2,\,+0.8,\,-0.2,\,-0.2,\,-0.2\,]
$$

(只有 right 那位是 $1-0.2=0.8$,其余是 $-0.2$。)于是

$$
\theta(s_8,\cdot) \leftarrow 0 + 0.05\times 0.1\times[\,-0.2,\,+0.8,\,-0.2,\,-0.2,\,-0.2\,]
= [\,-0.001,\,+0.004,\,-0.001,\,-0.001,\,-0.001\,]
$$

$\pi(s_8,\mathrm{right})$ 从 0.200 升到 0.201。

**价值从目标往回传,也可以手算。** $\hat{q}=0$ 时一步目标退化成即时奖励,所以只有 $r\neq0$ 的转移产生学习。假设某个时刻 $\hat{q}(s_8,\mathrm{right})=0.1$ 已经学到:$s_7\xrightarrow{\mathrm{right}}s_8$ 这步的目标是 $0+0.9\times0.1=0.09$,$\hat{q}(s_7,\mathrm{right})$ 被挪到 $0.1\times0.09=0.009$;再往后,$s_4\xrightarrow{\mathrm{down}}s_7$ 的目标是 $0.9\times0.009\approx0.008$,$\hat{q}(s_4,\mathrm{down})$ 被挪到 $0.0008$;再往后,$s_1\xrightarrow{\mathrm{down}}s_4$ 的目标是 $0.9\times0.0008=0.0007$——信号传到 $s_1$,actor 第一次拿到 down 的正方向。三步传完,每一步都能照这个式子自己算。

QAC 里 actor 的信号是 $q(s,a,w)$ 本身。这个信号有个问题,下一节就从它入手。

## 3. 减基线:A2C

**问题:q 的绝对值没法直接看。** $q_\pi(s,a)$ 带着"从 $s$ 出发"这个前提——同一个数值,在这个状态可能是好动作,在另一个状态可能是坏动作。直接拿它当信号,分不清"这个动作本身好"还是"这个状态本来就好"。要的是相对量:**这个动作比该状态的平均水平好多少**。上一章 §3.1 的梯度分量里恰好有它:

$$
\nabla_{\theta_{s,a}}J = \eta(s)\,\pi(a|s)\,(q_\pi(s,a) - v_\pi(s))
$$

($\eta(s)$ 是状态 $s$ 的长期访问频率,上一章 §2 叫平稳分布。)符号由 $q_\pi-v_\pi$ 决定。这一节把"减掉 $v_\pi$"讲清楚:先证明期望里减掉任意 $b(S)$ 梯度都不变,再取 $b=v_\pi$,得到优势函数 $q_\pi-v_\pi$。

在期望里减一个只依赖状态的 $b(S)$,梯度不变:

$$
\mathbb{E}\big[\nabla_\theta\ln\pi(A|S)(q_\pi(S,A)-b(S))\big]
= \mathbb{E}\big[\nabla_\theta\ln\pi(A|S)\,q_\pi(S,A)\big]
$$

因为 $\sum_a\pi(a|s)\nabla_\theta\ln\pi(a|s)=\sum_a\nabla_\theta\pi(a|s)=\nabla_\theta\sum_a\pi(a|s)=\nabla_\theta 1=0$,所以 $\mathbb{E}[\nabla_\theta\ln\pi(A|S)b(S)]=0$。

取 $b(s)=v_\pi(s)$。$v_\pi(s)$ 就是状态价值,定义是 $v_\pi(s)=\sum_a\pi(a|s)q_\pi(s,a)$(动作价值按 $\pi$ 加权平均)。于是

$$
\delta_\pi(s,a) = q_\pi(s,a) - v_\pi(s)
$$

叫**优势函数**(advantage)。$\delta>0$:比状态平均好,抬;$\delta<0$:压。

**agent 无模型,怎么拿到 $\delta$?** $\delta=q-v$ 要动作值 $q$,但 A2C 只想维护一个 $v$(少学一个函数)。$q$ 按定义展开一步:

$$
q_\pi(s,a)=\mathbb{E}\big[R_{t+1}+\gamma v_\pi(S_{t+1})\,\big|\,S_t=s,A_t=a\big]
$$

从 $s$ 选 $a$,拿这一步的奖励 $R_{t+1}$,然后按 $\pi$ 走到 $S_{t+1}$——后面的事全由 $v_\pi(S_{t+1})$ 接管。这样 $q$ 就从 $v$ 换出来了。减掉 $v_\pi(S_t)$(给定 $s$ 是已知常数):

$$
q_\pi(s,a)-v_\pi(s)
= \mathbb{E}\big[R_{t+1}+\gamma v_\pi(S_{t+1})-v_\pi(S_t)\,\big|\,S_t=s,A_t=a\big]
$$

右边只有 $v$,没有 $q$。但期望不能直接算——无模型,没有转移概率 $P$。每走一步,手里正好有一个样本 $(s_t,a_t,r_{t+1},s_{t+1})$,用这一次真实发生的 $r_{t+1}$、$s_{t+1}$ 代替期望:

$$
\delta_t = r_{t+1} + \gamma\,v(s_{t+1},w_t) - v(s_t,w_t)
$$

这就是 TD error——它只需要 critic 自己正在学的 $v(\cdot,w)$,不需要别的。

**整套 A2C**(advantage actor-critic),三步:

$$
\delta_t = r_{t+1} + \gamma\,v(s_{t+1},w_t) - v(s_t,w_t) \qquad \text{(advantage)}
$$

$$
\theta_{t+1} = \theta_t + \alpha_\theta\,\delta_t\,\nabla_\theta\ln\pi(a_t|s_t,\theta_t) \qquad \text{(actor)}
$$

$$
w_{t+1} = w_t + \alpha_w\,\delta_t\,\nabla_w v(s_t,w_t) \qquad \text{(critic)}
$$

critic 那条还是第 8 章的 TD-Linear:把 $v(s_t)$ 往目标 $r+\gamma v(s_{t+1})$ 挪,误差就是 $\delta_t$。actor 那条把 §2 的 $q$ 换成 $\delta_t$——上一章说"符号由 $q-v$ 决定",$\delta_t$ 就是这个 $q-v$ 的采样版。

**在 3×3 上把无模型的一遍算到底。** 初始 $\theta=0$($\pi_0$ 均匀)、$v=0$ 全零,$\alpha_w=0.1$、$\alpha_\theta=0.05$,$\gamma=0.9$。设这条 episode 恰好走对:

$$
s_1\xrightarrow{\mathrm{down}}s_4\xrightarrow{\mathrm{down}}s_7\xrightarrow{\mathrm{right}}s_8\xrightarrow{\mathrm{right}}s_9\xrightarrow{\mathrm{stay}}s_9\cdots
$$

$v$ 从 0 开始,前 3 步($r=0$)的 $\delta_t=0+0.9\times0-0=0$,critic 和 actor 都不动。第 4 步 $s_8\xrightarrow{\mathrm{right}}s_9$ 第一次拿到 $r=+1$:

$$
\delta_t = 1 + 0.9\times v(s_9) - v(s_8) = 1 + 0.9\times 0 - 0 = 1
$$

critic 更新(查表 $v$, $\nabla_w v$ 是 one-hot,直接挪):

$$
v(s_8) \leftarrow 0 + 0.1\times 1 = 0.1
$$

actor 更新,沿用 $\nabla_\theta\ln\pi(\mathrm{right}|s_8)=[\,-0.2,\,+0.8,\,-0.2,\,-0.2,\,-0.2\,]$:

$$
\theta(s_8,\cdot) \leftarrow 0 + 0.05\times 1\times[\,-0.2,\,+0.8,\,-0.2,\,-0.2,\,-0.2\,]
= [\,-0.01,\,+0.04,\,-0.01,\,-0.01,\,-0.01\,]
$$

$\pi(s_8,\mathrm{right})$ 从 0.200 升到 0.208——$\delta_t=1>0$,right 被抬。第 5 步 $s_9\xrightarrow{\mathrm{stay}}s_9$ 同样:$\delta_t=1$,$v(s_9)\leftarrow0.1$,$\theta(s_9,\mathrm{stay})$ 被抬。若一直停在 $s_9$,每步 $\delta_t=1+0.9\,v(s_9)-v(s_9)=1-0.1\,v(s_9)$ 都是正数,$v(s_9)$ 每次涨一点,朝 $10$ 收敛——一直拿 $+1$ 的折现和 $1/(1-0.9)$。

整个流程只用采样到的 $(s,a,r,s')$ 和 critic 自己学出来的 $v$,没碰转移概率 $P$,也没用第 6 章解出的 $v_{\pi_0}$——这是无模型的一遍。价值从目标往回传的机制,§2 用 $\hat{q}$ 讲过,这里不再重复;A2C 和 QAC 的差别只有一个——actor 的信号从 $q$ 换成了 $\delta_t$。

**减基线为什么有用。** 单条样本的估计 $X=\nabla_\theta\ln\pi(A|S)q_\pi(S,A)$ 随采到的动作而变,方差满足

$$
\operatorname{tr}\operatorname{var}(X) = \mathbb{E}[X^TX] - \mathbb{E}[X]^T\mathbb{E}[X]
$$

第二项 $\mathbb{E}[X]$ 与基线无关(期望不变,上面证过),所以要让方差小,只需让 $\mathbb{E}[X^TX]$ 小。减基线后 $X_b=\nabla_\theta\ln\pi(A|S)(q_\pi(S,A)-b(S))$,于是

$$
\mathbb{E}[X_b^TX_b] = \mathbb{E}\big[\|\nabla_\theta\ln\pi(A|S)\|^2\,(q_\pi(S,A)-b(S))^2\big]
$$

对固定的 $s$,这是 $b(s)$ 的一元二次函数,最小值在

$$
b^*(s) = \frac{\mathbb{E}_{A\sim\pi}\big[\|\nabla_\theta\ln\pi\|^2\,q_\pi(s,A)\big]}{\mathbb{E}_{A\sim\pi}\big[\|\nabla_\theta\ln\pi\|^2\big]}
$$

即 $q$ 按 $\|\nabla\ln\pi\|^2$ 加权平均。教科书常取不加权的 $b(s)=\mathbb{E}[q]=v_\pi(s)$ 作近似。$\delta$ 比 $q$ 小一个量级,估计的波动跟着小——这就是减基线降方差的来源。

## 4. 还有两种做法

QAC 和 A2C 已经是一条完整的线。这一节把另外两种做法各用一两句交代,不展开。

**Off-policy:换数据来源。** QAC、A2C 都是 on-policy:必须按当前策略 $\pi$ 采数据,策略一更新,旧数据作废。想用别的策略 $\beta$ 采的数据学 $\pi$,把对 $\pi$ 的期望改到 $\beta$ 上,每个样本乘校正权重 $\pi/\beta$——这就是 importance sampling。它的原理是一行恒等式(把对 $p_0$ 的求和改写成对 $p_1$ 的求和):

$$
\mathbb{E}_{X\sim p_0}[X]
= \sum_x p_0(x)\,x
= \sum_x p_1(x)\,\frac{p_0(x)}{p_1(x)}\,x
= \mathbb{E}_{X\sim p_1}\Big[\frac{p_0(X)}{p_1(X)}\,X\Big]
$$

(+1/−1 的例子:目标分布 $p_0$ 各 0.5,样本来自 $p_1=(0.8,0.2)$;直接平均收敛到 0.6,加权平均收敛到 0。)把 $\pi(a|s)$ 写成 $\beta(a|s)\cdot\pi(a|s)/\beta(a|s)$,actor 和 critic 的更新式各多乘一个权重 $\pi/\beta$,就变成 off-policy。

**DPG:换策略形式。** 前面都要求策略随机($\pi(a|s)>0$,公式里有 $\ln\pi$、要对动作采样)。动作是连续量时,随机策略是一个连续分布,难表示;而且最优策略常常是确定性的。确定性策略 $\mu(s,\theta)$ 直接输出一个动作,梯度变成链式法则:

$$
\nabla_\theta J
= \mathbb{E}\big[\nabla_\theta\mu(S)\; \nabla_a q_\mu(S,a)\big|_{a=\mu(S)}\big]
$$

朝"$q$ 上升最快的方向"推 $\mu$。梯度里没有动作随机变量,所以天然 off-policy。

## 5. 小结

- **问题没变**:对 $J(\theta)$ 梯度上升。变的是 $q_t$ 怎么估:上一章 MC(REINFORCE),这一章 TD(actor-critic)。
- **QAC**:给 REINFORCE 加一个 critic——critic 学 $q$(Sarsa),actor 用 $q$ 当信号。$q_t$ 换成 $q(s,a,w)$,每步都能更新,价值从目标一格一格传回起点。
- **A2C**:actor 的信号从 $q$ 换成 $q-v$(优势 $\delta$)。减基线梯度不变($\sum_a\pi(a|s)\nabla_\theta\ln\pi(a|s)=\nabla_\theta1=0$),无模型下用 TD error 近似,只用一个 $v$。
- **延展**:off-policy 用重要性采样($\pi/\beta$)换数据来源;DPG 换确定性策略,梯度是链式法则,天然 off-policy。
- 简言之:actor-critic 是策略梯度配 TD 价值估计;评论家打分,演员照着改。
`,
}
export default article
