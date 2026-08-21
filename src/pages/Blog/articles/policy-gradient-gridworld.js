const article = {
  slug: 'policy-gradient-gridworld',
  date: '2026-08-20 18:00',
  name: 'Policy Gradient Methods in a 3×3 Grid World',
  description: '第 9 课:策略梯度。前面都从价值推策略(argmax);这一篇把策略本身当函数 π(a|s,θ) 学,对一个标量指标做梯度上升。策略梯度定理给出 ∇J=E[∇lnπ(A|S)q(S,A)],REINFORCE 用一条 episode 的回报估 q。3×3 上从 θ=0(均匀 π0)出发,π(s1) 收敛到 down≈0.996。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: '这一课把策略本身当函数学:π(a|s,θ) 是 softmax,θ=0 就是均匀 π0。一个 θ 管所有格子,所以"最优"定义成标量指标 J(θ):平均状态价值 v̄_π=Σd(s)v_π(s)(等价平均奖励 r̄_π,折现下 r̄_π=(1−γ)v̄_π)。策略梯度定理 ∇J=E[∇lnπ(A|S)q(S,A)]:ln 把"对动作求和"变成"对动作取期望",才能用样本估;softmax 表格下 ∇θ_{s,a}J=η(s)π(a|s)(q_π−v_π),比平均好的抬、差的压。REINFORCE:θ←θ+α∇lnπ(a_t|s_t)G_t,回报正抬负压。3×3 上 π(s1,down) 从 0.2 爬到 0.996,平均回报 7.27≈最优 7.29。',
  detail: String.raw`
## 1. 这一篇要解决什么问题

前面几篇(Bellman 方程、MC、TD、值函数近似)都是同一条路线:**估价值,再从价值推策略**。策略由"价值最高的动作"决定:

$$
\pi(s) = \arg\max_a q(s,a)
$$

这一篇换一条路:**直接把策略当函数来学**。策略不再是一张表,而是一个带参数的函数 $\pi(a|s,\theta)$。读法:$\pi(a|s,\theta)$ 表示"在状态 $s$ 下选择动作 $a$ 的概率",其中 $|$ 是条件概率记号(前面文章的 $p(s'|s,a)$ 也用它),$\theta$ 是参数——概率由 $\theta$ 决定,$\theta$ 变,所有状态的动作概率跟着变。找到好的 $\theta$,就找到了好的策略。这条路叫 **策略梯度**(policy gradient)。

为什么要换成函数?两个理由,都出在 argmax 上。

**理由一:argmax 作为"改进策略的操作"有局限。** 看第 8 课的最后一句:"策略依然用表存($\arg\max_a\hat{q}$)"——值函数近似改进了 $\hat{q}$,策略还是对 $\hat{q}$ 取 argmax 得来的。argmax 输出的是确定性单个动作,要探索还得另加 $\varepsilon$-greedy;动作空间一大,每步搜 argmax 很贵,连续动作空间甚至没法搜。

**理由二:argmax 不可微,没法做梯度。** 想在策略上做梯度上升,策略必须对 $\theta$ 可微。argmax 是分段常值函数——参数在哪一段上,argmax 都是同一个动作,只在边界处跳变,导数要么是 0 要么不存在。不可微就谈不上梯度。所以要换成一个可微的、输出概率的函数——softmax,它的公式、可微性、为什么接近 argmax,都在下面 §1.1 讲。这也是为什么后面 $\nabla_\theta J$ 的公式里会出现 $\ln\pi$、并要求 $\pi(a|s,\theta)>0$(§3)。

于是问题变成一个标准的优化问题:选一个指标 $J(\theta)$,做**梯度上升**

$$
\theta_{t+1} = \theta_t + \alpha\,\nabla_\theta J(\theta_t)
$$

其中 $\alpha$ 是步长。但函数策略带来一个新问题:**一个 $\theta$ 管着所有格子的概率**。表格策略可以逐格改;函数策略改 $\theta$,所有格子一起动,没法说"这一格最优、那一格其次"。所以"最优"只能定义成"**某个标量指标 $J(\theta)$ 最大**"。这一篇按下面的顺序回答三个问题:

1. **用什么指标 $J$?**(§2)
2. **梯度 $\nabla_\theta J$ 怎么算?**(§3)
3. **梯度怎么用样本估?**(§4)

然后 §5 回到 3×3 的例子上把整套流程走一遍。

### 1.1 softmax:可微的 argmax

说"换成 softmax",先把它的公式写出来。策略是

$$
\pi(a|s,\theta) = \frac{e^{h(s,a,\theta)}}{\sum_{a'} e^{h(s,a',\theta)}}
$$

$h(s,a,\theta)$ 叫"动作 $a$ 在状态 $s$ 的**偏好**"——一个实数,谁大谁的概率高。分母对 $s$ 下所有动作的 $e^{h}$ 求和,保证 5 个动作的概率加起来等于 1。最直接的参数化是让 $h(s,a,\theta)=\theta_{s,a}$:每个 $(s,a)$ 一个偏好参数,$\theta$ 总共 $9\times5=45$ 个数。这就是前文说的 softmax 表格策略。

**这里要说清一个常见的混淆:$\theta$ 是参数,不是概率。** $\theta_{s,a}$ 是"动作 $a$ 在状态 $s$ 的偏好分数",它可以是任意实数;$\pi(a|s,\theta)$ 才是概率,由 softmax 把偏好分数换算成 $(0,1)$ 之间的值、并保证五个动作加起来等于 1。

举一个 $\theta\neq 0$ 的例子。设 $s_1$ 的五个偏好为 up$=0$、right$=1$、down$=2$、left$=0$、stay$=0$。分母 $e^0+e^1+e^2+e^0+e^0 = 1+2.718+7.389+1+1 = 13.107$,于是:

| 动作 | 偏好 $\theta_{s_1,a}$ | 概率 $\pi(a\mid s_1)$ |
|---|---|---|
| up | 0 | $1/13.107 = 0.076$ |
| right | 1 | $2.718/13.107 = 0.207$ |
| down | 2 | $7.389/13.107 = 0.564$ |
| left | 0 | $1/13.107 = 0.076$ |
| stay | 0 | $1/13.107 = 0.076$ |

偏好大的动作概率高:down(偏好 2)概率 0.564,right(偏好 1)0.207,其余(偏好 0)各 0.076;五个概率加起来等于 1。$\theta=0$(所有偏好为 0)只是特例——算出均匀 $\pi(a|s)=1/5$,不是说概率为 0。

它为什么可微?每个 $e^{h}$ 都是光滑的指数函数,加减乘除都光滑,所以 $\pi(a|s,\theta)$ 对 $\theta$ 处处可导——这正是 §1 理由二要的。

它为什么接近 argmax?看两个极端,都从公式直接得出。

$\theta_{s,a}$ 全相等(记为 $c$)时:

$$
\pi(a|s,\theta) = \frac{e^c}{e^c+\cdots+e^c} = \frac{e^c}{5e^c} = \frac{1}{5}
$$

**均匀随机,就是 $\pi_0$**。某个动作(比如 $a^*$)的偏好远大于其余时,设 $\theta_{s,a^*}=c$、其余为 $c-\Delta$($\Delta\to\infty$):

$$
\pi(a^*|s,\theta) = \frac{e^c}{e^c+4e^{c-\Delta}} = \frac{1}{1+4e^{-\Delta}} \to 1,
\qquad
\pi(a|s,\theta) = \frac{e^{c-\Delta}}{e^c+4e^{c-\Delta}} \to 0 \quad (a\neq a^*)
$$

**偏好差越大,越接近 argmax**。

还有一个附带性质:对任何 $s$、$a$,$e^{h}>0$,所以 $\pi(a|s,\theta)>0$ 恒成立。每个动作的概率都严格为正,这就是"软"的含义——argmax 是硬的(只选一个),softmax 是软的(每个动作都有机会),探索因此内建在表示里。

## 2. 指标:平均状态价值与平均奖励

函数策略要最大化一个标量。有两个常用的指标。

**指标 1:平均状态价值**

$$
\bar{v}_\pi = \sum_{s \in \mathcal{S}} d(s)\, v_\pi(s)
$$

把每个状态的价值按权重 $d(s)$ 加权平均。$d(s)\ge 0$ 且和为 1,可以看作状态上的一个概率分布。权重怎么选?两种常见做法:

- $d$ 与策略无关,记作 $d_0$。比如所有状态等权 $d_0(s)=1/|\mathcal{S}|$;或者只关心某个起始状态 $s_0$,让 $d_0(s_0)=1$。
- $d$ 与策略有关,取 $d=d_\pi$,即 $\pi$ 下的**平稳分布**(长期访问频率)。长期常去的状态权重高,偶尔去的权重低。

**指标 2:平均奖励**

$$
\bar{r}_\pi = \sum_{s \in \mathcal{S}} d_\pi(s)\, r_\pi(s),
\qquad
r_\pi(s) = \sum_{a \in \mathcal{A}} \pi(a|s)\, r(s,a)
$$

$r_\pi(s)$ 是状态 $s$ 的期望一步奖励(按策略 $\pi$ 对动作加权),$\bar{r}_\pi$ 再按平稳分布加权。直观含义:长期平均每步拿多少奖励。

两个指标在折现情形($\gamma<1$)下是等价的。推导很短,从状态价值的 Bellman 方程出发($P_\pi$ 是策略 $\pi$ 下的状态转移矩阵):

$$
v_\pi = r_\pi + \gamma P_\pi v_\pi
$$

两边左乘 $d_\pi^T$:

$$
d_\pi^T v_\pi = d_\pi^T r_\pi + \gamma\, d_\pi^T P_\pi v_\pi
$$

平稳分布的定义 $d_\pi^T P_\pi = d_\pi^T$(乘以转移矩阵后不变)让第二项变成 $\gamma d_\pi^T v_\pi$。代入 $d_\pi^T v_\pi=\bar{v}_\pi$、$d_\pi^T r_\pi=\bar{r}_\pi$:

$$
\bar{v}_\pi = \bar{r}_\pi + \gamma\bar{v}_\pi
\quad\Longrightarrow\quad
\bar{r}_\pi = (1-\gamma)\,\bar{v}_\pi
$$

所以最大化它们俩是一回事——同一个 $\theta$ 让 $\bar{v}_\pi$ 最大时,$\bar{r}_\pi$ 也最大。

在 3×3 上算 $\pi_0$(均匀随机策略)的两个指标。$v_{\pi_0}$ 就是前几篇那个 $[-3.083,\dots]$;而 $\pi_0$ 下 $d_{\pi}$ 恰好也均匀(转移矩阵是双随机的,每行每列和都为 1),所以:

$$
\bar{v}_{\pi_0} = \frac{1}{9}\sum_{s=1}^{9} v_{\pi_0}(s) = -2.889,
\qquad
\bar{r}_{\pi_0} = (1-0.9)\times(-2.889) = -0.289
$$

两个都是负的:均匀乱走,平均价值本来就是负的。指标给出一个"策略好坏"的标尺——策略越好,$\bar{v}_\pi$ 越大。

## 3. 策略梯度定理

指标 $J(\theta)$ 的梯度是这个领域最重要的一个结果:

$$
\nabla_\theta J(\theta)
= \sum_{s \in \mathcal{S}} \eta(s) \sum_{a \in \mathcal{A}} \nabla_\theta \pi(a|s,\theta)\, q_\pi(s,a)
$$

其中 $\eta(s)$ 是某个状态分布,具体是哪个取决于指标。两种常用情形:

- 指标是 $\bar{v}_\pi^0$($d_0$ 与策略无关)时,$\eta$ 是"从 $d_0$ 出发、按 $\pi$ 走,长期访问到的状态分布",梯度是精确等式;
- 指标是 $\bar{r}_\pi$(或 $\bar{v}_\pi$)时,$\eta = d_\pi$,即平稳分布;折现情形下这是近似($\gamma\to 1$ 时更准),无折现时是精确的。

不同指标对应不同 $\eta$,但**梯度的表达式一样**——这正是把它合并成一条定理的原因。三个问题里,这一节只回答"梯度长什么样",$\eta$ 的细节可以先放下:我们的例子从 $s_1$ 出发,对应 $d_0$ 集中在 $s_1$,此时 $\eta$ 就是"从 $s_1$ 出发、按 $\pi$ 走,长期访问到的状态分布";实现里直接按当前策略采样,访问到的状态分布自然就是它(§4 会说)。

公式里的 $\nabla_\theta\pi(a|s,\theta)$ 是 $\pi$ 对 $\theta$ 的梯度,还有待化简。关键的一步:把 $\ln\pi$ 的梯度搬进来。因为

$$
\nabla_\theta \ln \pi(a|s,\theta)
= \frac{\nabla_\theta \pi(a|s,\theta)}{\pi(a|s,\theta)},
$$

两边乘 $\pi$ 再代回去,和式里的求和就可以写成期望:

$$
\begin{aligned}
\sum_a \nabla_\theta \pi(a|s,\theta)\, q_\pi(s,a)
&= \sum_a \pi(a|s,\theta)\, \nabla_\theta\ln\pi(a|s,\theta)\, q_\pi(s,a) \\
&= \mathbb{E}_{A\sim\pi(\cdot|s,\theta)}\big[\nabla_\theta\ln\pi(A|s,\theta)\, q_\pi(s,A)\big]
\end{aligned}
$$

整个梯度于是是:

$$
\nabla_\theta J(\theta)
= \mathbb{E}_{S\sim\eta,\,A\sim\pi(\cdot|S,\theta)}
\big[\nabla_\theta\ln\pi(A|S,\theta)\, q_\pi(S,A)\big]
$$

**这就是 $\ln$ 的功劳:把"对动作求和"变成"对动作取期望"。** 期望的好处是能拿样本估(§4)。

> 读法:指标对 $\theta$ 的梯度 = "从 $\eta$ 采一个状态、从 $\pi$ 采一个动作,算 $\nabla_\theta\ln\pi(A|S)$ 乘上动作价值"的期望。

**为什么要求 $\pi(a|s,\theta)>0$?** 因为公式里有 $\ln\pi$。softmax 恰好保证这一点:任何 $(s,a)$ 的概率都在 $(0,1)$ 之间,这也正是 §1.1 说的"软"——每个动作都可能被选到。

### 3.1 直觉:梯度在抬好动作、压坏动作

对 softmax 表格策略($h(s,a,\theta)=\theta_{s,a}$),梯度 $\nabla_\theta J$ 的第 $(s,a)$ 分量,就是把 §3 定理的和式对 $\theta_{s,a}$ 求偏导。这里有两个 $s,a$ 容易混:等号左边的 $\theta_{s,a}$ 是**固定的一个参数**(状态 $s$、动作 $a$ 的偏好),右边的求和变量则是跑遍所有状态和动作。为避免混淆,求和变量改用 $s'$、$a'$(读作 s-prime、a-prime),把固定的 $(s,a)$ 空出来:

$$
\frac{\partial J}{\partial \theta_{s,a}}
= \sum_{s'} \eta(s') \sum_{a'} \frac{\partial \pi(a'|s',\theta)}{\partial \theta_{s,a}}\, q_\pi(s',a')
$$

关键一步:$\theta_{s,a}$ 只出现在状态 $s$ 的 softmax 里。对 $s'\neq s$,$\pi(a'|s')$ 的分子分母里根本没有 $\theta_{s,a}$,偏导是 0。所以对 $s'$ 的求和只剩 $s'=s$ 一项:

$$
\frac{\partial J}{\partial \theta_{s,a}}
= \eta(s) \sum_{a'} \frac{\partial \pi(a'|s,\theta)}{\partial \theta_{s,a}}\, q_\pi(s,a')
$$

剩下的是对 $a'$ 求和。先算 $\partial\pi(a'|s)/\partial\theta_{s,a}$,直接对 §1.1 的 softmax 求导,记 $\delta_{a,a'}$ 是克罗内克函数($a=a'$ 时为 1,否则为 0):

$$
\frac{\partial \pi(a'|s,\theta)}{\partial \theta_{s,a}}
= \pi(a'|s,\theta)\,\big(\delta_{a,a'} - \pi(a|s,\theta)\big)
$$

代入得:

$$
\nabla_{\theta_{s,a}}J
= \eta(s)\sum_{a'}\pi(a'|s)\big(\delta_{a,a'}-\pi(a|s)\big)\,q_\pi(s,a')
$$

接下来处理里面的求和 $\sum_{a'}\pi(a'|s)(\delta_{a,a'}-\pi(a|s))q_\pi(s,a')$。把括号拆开成两项:

$$
\sum_{a'}\pi(a'|s)\big(\delta_{a,a'}-\pi(a|s)\big)\,q_\pi(s,a')
= \underbrace{\sum_{a'}\pi(a'|s)\,\delta_{a,a'}\,q_\pi(s,a')}_{\text{①}} - \underbrace{\sum_{a'}\pi(a'|s)\,\pi(a|s)\,q_\pi(s,a')}_{\text{②}}
$$

**① 项。** $\delta_{a,a'}$ 只在 $a'=a$ 时为 1、其余为 0,所以求和里只有 $a'=a$ 那一项留下来:

$$
\sum_{a'}\pi(a'|s)\,\delta_{a,a'}\,q_\pi(s,a')
= \pi(a|s)\,q_\pi(s,a)
$$

**② 项。** $\pi(a|s)$ 与求和下标 $a'$ 无关,提到求和号外面:

$$
\sum_{a'}\pi(a'|s)\,\pi(a|s)\,q_\pi(s,a')
= \pi(a|s)\sum_{a'}\pi(a'|s)\,q_\pi(s,a')
$$

而 $\sum_{a'}\pi(a'|s)q_\pi(s,a')$ 正是状态价值的定义 $v_\pi(s)=\sum_{a'}\pi(a'|s)q_\pi(s,a')$(动作价值按 $\pi$ 对动作加权平均)。于是整个求和变成:

$$
\sum_{a'}\pi(a'|s)\big(\delta_{a,a'}-\pi(a|s)\big)\,q_\pi(s,a')
= \pi(a|s)\,q_\pi(s,a) - \pi(a|s)\,v_\pi(s)
= \pi(a|s)\big(q_\pi(s,a) - v_\pi(s)\big)
$$

代回 $\nabla_{\theta_{s,a}}J$,得:

$$
\nabla_{\theta_{s,a}}J
= \eta(s)\,\pi(a|s,\theta)\,\big(q_\pi(s,a) - v_\pi(s)\big)
$$

这个公式把梯度方向讲得很清楚。**符号由 $q_\pi(s,a)-v_\pi(s)$ 决定**:

- $q_\pi(s,a) > v_\pi(s)$:这个动作比状态平均值好,梯度为正,$\theta_{s,a}$ 增大,概率 $\pi(a|s)$ 被抬高;
- $q_\pi(s,a) < v_\pi(s)$:比平均差,梯度为负,$\theta_{s,a}$ 减小,概率被压低。

在 3×3 上验算 $\pi_0$ 下 $s_1$ 的梯度方向。$v_{\pi_0}(s_1)=-3.083$,五个动作的 $q_{\pi_0}(s_1,\cdot)=[-3.774,-2.635,-2.454,-3.774,-2.774]$(up/right/down/left/stay):

| 动作 | $q_{\pi_0}(s_1,a)$ | $q-v_{\pi_0}(s_1)$ | 梯度方向 |
|---|---|---|---|
| up | $-3.774$ | $-0.692$ | 压 |
| right | $-2.635$ | $+0.447$ | 抬 |
| down | $-2.454$ | $+0.628$ | 抬(最多) |
| left | $-3.774$ | $-0.692$ | 压 |
| stay | $-2.774$ | $+0.308$ | 抬 |

方向完全符合直觉:撞墙的 up、left 被压,通向目标路径的 down 被抬得最多——和 MC 文章 §4 的结论一致(那里 $\arg\max_a q_{\pi_0}(s_1,a)=\text{down}$,改进后 $\pi_1(s_1)=\text{down}$)。梯度从一开始就把 down 往大了推:它不需要知道未来,只需要当前策略下的 $q$ 和 $v$。

## 4. 用样本估梯度:REINFORCE

§3 的梯度是个期望,期望就能用样本估——不把期望算完,采一条样本估计它。注意这和 §3.1 的公式不同:那里是真梯度 $\nabla_{\theta_{s,a}}J=\eta(s)\pi(a|s)(q_\pi-v_\pi)$,描述平均方向,但算法不会直接算它(它需要 $\eta$、$q_\pi$、$v_\pi$,无模型时都未知)。REINFORCE 做的是另一件事:取一条样本 $(s_t,a_t)$,把期望换成这一个点:

$$
\theta_{t+1}
= \theta_t + \alpha\, \nabla_\theta \ln \pi(a_t|s_t,\theta_t)\, q_t(s_t,a_t)
$$

$q_t(s_t,a_t)$ 是 $q_\pi(s_t,a_t)$ 的估计。**这个估计怎么来,决定了算法叫什么。**

- 如果 $q_t$ 用整条 episode 的回报(MC 估计),就叫 **REINFORCE**(也叫 Monte Carlo policy gradient):

$$
q_t(s_t,a_t) = G_t = \sum_{k=t+1}^{T} \gamma^{k-t-1} r_k
$$

- 如果 $q_t$ 用一个学出来的价值函数估(比如一步备份 $r+\gamma\hat{q}(s',a')$),就叫 **actor-critic**——策略 $\pi(\theta)$ 是 actor,价值函数是 critic。这是下一章的内容。

REINFORCE 是这些算法里最简单的:策略梯度管"梯度方向怎么走"($\nabla_\theta\ln\pi$),$q_t$ 用 MC 回报是其中一种估计方式。本文用 MC,因为它最直接——回报是采到的,不用额外学价值函数。

每次更新就一行:采到 $(s_t,a_t)$,得到回报 $G_t$,梯度上升。整套算法:

> 每条 episode:
> 1. 按当前 $\pi(\theta)$ 采样一条轨迹 $\{s_0,a_0,r_1,\dots,s_{T-1},a_{T-1},r_T\}$;
> 2. 对每个 $t$:算回报 $G_t$,更新 $\theta \leftarrow \theta + \alpha\nabla_\theta\ln\pi(a_t|s_t,\theta)\,G_t$。

**两个采样的对象都来自策略自己**:状态 $S$ 来自 $\eta$($\pi$ 下的访问分布),动作 $A$ 按 $\pi(\cdot|s,\theta)$ 采。所以 REINFORCE 是 **on-policy**——行为策略就是被更新的策略,不能像 Q-learning 那样用别的策略采的数据。

### 4.1 直觉:回报正抬、回报负压

把更新拆开看。$\nabla\ln\pi = \nabla\pi/\pi$,所以

$$
\theta_{t+1}
= \theta_t + \alpha \underbrace{\frac{q_t(s_t,a_t)}{\pi(a_t|s_t,\theta_t)}}_{\beta_t}
\, \nabla_\theta \pi(a_t|s_t,\theta_t)
$$

$\beta_t = q_t/\pi(a_t|s_t)$ 是一个系数。而 $\nabla_\theta\pi(a_t|s_t,\theta)$ 是"朝提高 $\pi(a_t|s_t)$ 的方向"——参数沿它走,选中 $(s_t,a_t)$ 的概率会变大。于是:

- **$\beta_t \ge 0$(回报非负)**:$\pi(a_t|s_t)$ 被抬高。回报越大,抬得越狠。
- **$\beta_t < 0$(回报为负)**:$\pi(a_t|s_t)$ 被压低,离这个"坏动作"越来越远。

这正是 §3.1 那句"抬好动作、压坏动作"的采样版。$\beta_t$ 里还有一层:**除以 $\pi(a_t|s_t)$** 意味着当前概率小的动作,同样的回报能把它的概率抬得比例更多——低概率动作得到更多校正机会。

## 5. 例子:REINFORCE 在 3×3 grid world

回到 3×3。策略用 §1.1 的 softmax 表格:偏好 $h(s,a,\theta)=\theta_{s,a}$,45 个参数。$\theta=0$ 时所有偏好相等,$\pi(a|s)=1/5$——**初始就是均匀 $\pi_0$**。

看一次更新。从 $s_1$ 出发采一条 episode,恰好走对到目标: $s_1\xrightarrow{\mathrm{down}}s_4\xrightarrow{\mathrm{down}}s_7\xrightarrow{\mathrm{right}}s_8\xrightarrow{\mathrm{right}}s_9\xrightarrow{\mathrm{stay}}s_9\cdots$。按 $\gamma=0.9$ 从后往前算回报:

| 步 | 转移 | 回报 $G_t$ |
|---|---|---|
| 1 | $s_1\xrightarrow{\mathrm{down}}s_4$ | $0+0.9\times7.29=7.29$ |
| 2 | $s_4\xrightarrow{\mathrm{down}}s_7$ | $0+0.9\times8.1=8.1$ |
| 3 | $s_7\xrightarrow{\mathrm{right}}s_8$ | $0+0.9\times9=9$ |
| 4 | $s_8\xrightarrow{\mathrm{right}}s_9$ | $1+0.9\times10=10$ |
| 5 | $s_9\xrightarrow{\mathrm{stay}}s_9$ | $1+0.9\times10=10$ |

(回报从后往前看:停在 $s_9$ 每步 $+1$,折现和 $10$;第 4 步 $+1$ 进目标后接 $10$。)

现在看第一步的更新,取 $\alpha=0.02$。按 §4 的更新式,要算的是 $\nabla_\theta\ln\pi(\mathrm{down}|s_1)$,它对 $\theta$ 里 $s_1$ 那一行的 5 个分量求导。先把 $\ln\pi$ 展开:

$$
\ln\pi(a|s,\theta) = \theta_{s,a} - \ln\sum_{a'} e^{\theta_{s,a'}}
$$

对 $\theta_{s,a'}$ 求导,第一项是 $\delta_{a,a'}$($a'=a$ 时为 1),第二项是 $\partial(\ln\sum e^\theta)/\partial\theta_{s,a'}=e^{\theta_{s,a'}}/\sum e^\theta=\pi(a'|s,\theta)$:

$$
\frac{\partial}{\partial\theta_{s,a'}}\ln\pi(a|s,\theta)
= \delta_{a,a'} - \pi(a'|s,\theta)
$$

取 $a=\mathrm{down}$、$s=s_1$、$\theta=0$(此时 $\pi(a'|s_1)=1/5$),代入得 5 个分量:

$$
\nabla_\theta\ln\pi(\mathrm{down}|s_1) = [\,-0.2,\,-0.2,\,+0.8,\,-0.2,\,-0.2\,]
$$

($\mathrm{down}$ 那个分量是 $1-0.2=0.8$,其余是 $-0.2$。)

于是 $s_1$ 那行参数更新:

$$
\theta_{s_1} \leftarrow \theta_{s_1} + 0.02 \times 7.29 \times [\,-0.2,-0.2,+0.8,-0.2,-0.2\,]
= [\,-0.029,\,-0.029,\,+0.117,\,-0.029,\,-0.029\,]
$$

down 的偏好从 0 涨到 $+0.117$,其余四个动作略降。$\pi(s_1,\mathrm{down})$ 从 0.2 涨到约 0.22。一次更新只动一点点——因为 $\alpha$ 小、且单条回报噪声大。跑很多条,方向一致,就积累起来了。

**跑 2000 条 episode**(从 $s_1$ 出发、每条 400 步、$\alpha=0.02$,$\gamma=0.9$),看 $\pi(s_1,\cdot)$ 怎么收敛:

| 回合 | up | right | down | left | stay |
|---|---|---|---|---|---|
| 1 | 0.204 | 0.208 | 0.224 | 0.153 | 0.211 |
| 10 | 0.101 | 0.239 | 0.365 | 0.105 | 0.189 |
| 50 | 0.035 | 0.098 | 0.747 | 0.028 | 0.092 |
| 200 | 0.005 | 0.010 | 0.960 | 0.004 | 0.021 |
| 2000 | 0.000 | 0.001 | 0.996 | 0.000 | 0.002 |

$\pi(s_1,\mathrm{down})$ 从 0.2 爬到 0.996——策略从"均匀乱走"变成"几乎总向下去 $s_4$"。最终从 $s_1$ 出发的平均回报(最后 200 条 episode 的均值)$\approx 7.27$,逼近最优价值 $v_*(s_1)=7.29$(MC 文章 §5 提过这个数)。REINFORCE 没见过模型、没见过 $q_*$,只靠采样 + 梯度上升,就把 $s_1$ 的价值学到了接近最优。

REINFORCE 学到的 $\arg\max_a\pi(a|s)$ 指向同一条最短路径 $s_1\!\to\!s_4\!\to\!s_7\!\to\!s_8\!\to\!s_9$——和值方法找到的最优策略一致,但表示方式不同:值方法把最优藏在一张 $q$ 表里,策略梯度把它直接编码进了 $\pi(a|s,\theta)$。

## 6. 小结

- **问题变了**:前面是"估 $q$,argmax 推策略";这一篇是"把策略本身当函数 $\pi(a|s,\theta)$ 学"。因为函数策略没法逐格改,最优定义成一个标量指标 $J(\theta)$,梯度上升去最大化它。
- **指标**:平均状态价值 $\bar{v}_\pi=\sum_s d(s)v_\pi(s)$ 或平均奖励 $\bar{r}_\pi$;折现下 $\bar{r}_\pi=(1-\gamma)\bar{v}_\pi$,两者一起最大。$\pi_0$ 下 $d_\pi$ 均匀,$\bar{v}_{\pi_0}=-2.889$。
- **梯度**:策略梯度定理 $\nabla_\theta J=\mathbb{E}[\nabla_\theta\ln\pi(A|S)q_\pi(S,A)]$。$\ln$ 把"对动作求和"变成"对动作取期望",期望才能用样本估。softmax 表格下分量 $\nabla_{\theta_{s,a}}J=\eta(s)\pi(a|s)(q_\pi-v_\pi)$:比状态平均好的动作被抬、差的被压。
- **用样本**:REINFORCE,$\theta\leftarrow\theta+\alpha\nabla_\theta\ln\pi(a_t|s_t)G_t$。回报正抬、负压;on-policy,行为策略就是被更新的策略。
- **例子**:3×3 上从 $\theta=0$(即 $\pi_0$)出发,$\pi(s_1,\mathrm{down})$ 从 0.2 爬到 0.996,从 $s_1$ 出发的平均回报逼近最优 7.29。策略梯度不需要模型,只需要按当前策略采样。
`,
}
export default article
