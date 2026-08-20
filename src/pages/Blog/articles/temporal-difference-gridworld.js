const article = {
  slug: 'temporal-difference-gridworld',
  date: '2026-08-19 17:00',
  name: 'Temporal-Difference Methods in a Stochastic 3×3 Grid World',
  description: '第 7 课:时序差分。MC 要等整条 episode 结束才能更新;TD 走一步更新一步,用"这一步奖励 + 下一步状态的当前估计"当目标,所以有偏、需初始猜测。沿 TD(0) → Sarsa → n-step Sarsa → Q-learning 走一遍,只有 Q-learning 解最优方程(off-policy)。',
  tags: ['RL'],
  category: 'Course Review',
  author: 'shannon',
  takeaway: 'TD 与 MC 一样无模型,差别在"数据来了怎么用":MC 攒完整条 episode 的回报再平均(非增量);TD 拿到一步样本就更新当前状态(增量),target 用当前估计(bootstrap)。bootstrap 带来方差小、有偏、需初始猜测、能处理持续任务四个特点。TD(0) 估状态值;Sarsa 换成动作值并配合策略改进(广义策略迭代);n-step Sarsa 是 Sarsa↔MC 的插值;Q-learning 的 target 里是 max,直接解 Bellman 最优方程,因此 off-policy——能用别的策略采的数据学,行为策略探索越强学得越快。',
  detail: String.raw`

## 1. 世界:还是那个 3×3 grid world

沿用上一篇的 3×3 grid world,规则不变:目标 $s_9$($+1$)、禁区 $s_6$($-1$)、撞墙 $-1$、其他 $0$,$\gamma=0.9$,5 个动作,确定性转移。初始策略 $\pi_0$ 均匀随机(每个动作 $1/5$)。

![3×3 确定性 grid world,π0 均匀随机](/images/mc-3x3-map.png)

## 2. MC 的痛点:一个样本要等 400 步

MC 估价值的方式是"采样回报、求平均"。以估 $q_{\pi_0}(s_1,\mathrm{right})$ 为例:反复从 $(s_1,\mathrm{right})$ 出发,每条 episode 走满 400 步,把折现回报 $G=r_1+\gamma r_2+\gamma^2r_3+\cdots$ 累加完,得到一个样本($-2.85$、$-2.06$、$-2.66$……),然后平均。

**一个样本 = 400 步。** 慢。而且方差大:一条回报是 400 个随机奖励的加权和,里面什么都有(撞墙、踩禁区、偶尔 $+1$)。

能不能不等 400 步?走一步,就有样本?

## 3. TD 的主意:走一步,就用一步备份当样本

Bellman 文章里全篇最核心的式子:

$$
Q(s,a) = R(s,a) + \gamma\, V(s')
$$

动作的价值 = 这一步的立即奖励 + 折扣后的下一格价值。

这句话反过来读:**走一步,看到 $(r, s')$,就有了一个对"当前价值"的估计**——"我应该值 $r + \gamma\times$ 下一格的价值"。后面发生什么不用等,因为"后面"用一个估计 $V(s')$ 顶上了。

TD 就把这个"一步备份"当样本,每走一步,把当前状态的价值向它挪一小点:

$$
v(s) \leftarrow v(s) + \alpha\,\big[\,(r+\gamma\,v(s'))-v(s)\,\big]
$$

读作:新价值 = 旧价值 + 一小步 × (一步备份 − 旧价值)。$\alpha$ 是步长,取 0 到 1 之间的小数(这里用 0.1),每次挪一小点。括号里 $r+\gamma v(s')$ 叫 **TD target**(更新的目标),差量 $(r+\gamma v(s'))-v(s)$ 叫 **TD error**(离目标还差多少)。名字不用记,含义就是这句。

## 4. 例子:走一步更新一步,+1 从目标往外传

用和 MC 文章同一条"恰好走到目标"的轨迹:

$$
s_1 \xrightarrow{\mathrm{right}} s_2 \xrightarrow{\mathrm{down}} s_5 \xrightarrow{\mathrm{down}} s_8 \xrightarrow{\mathrm{right}} s_9 \xrightarrow{\mathrm{stay}} s_9 \xrightarrow{\mathrm{stay}} \cdots
$$

初始猜测 $v_0(s)=0$(所有状态),$\alpha=0.1$。走一步更新一步,逐项算:

| 步 | 转移(动作 $a$、奖励 $r$) | target $=r+0.9\,v(s')$ | 更新后 |
|---|---|---|---|
| 1 | $s_1\xrightarrow{\mathrm{right}}s_2$,$r{=}0$ | $0+0.9\times0=0$ | $v(s_1):\ 0\to0$ |
| 2 | $s_2\xrightarrow{\mathrm{down}}s_5$,$r{=}0$ | $0+0.9\times0=0$ | $v(s_2):\ 0\to0$ |
| 3 | $s_5\xrightarrow{\mathrm{down}}s_8$,$r{=}0$ | $0+0.9\times0=0$ | $v(s_5):\ 0\to0$ |
| 4 | $s_8\xrightarrow{\mathrm{right}}s_9$,$r{=}{+}1$ | $1+0.9\times0=1$ | $v(s_8):\ 0\to0.1$ |
| 5 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | $1+0.9\times0=1$ | $v(s_9):\ 0\to0.1$ |
| 6 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | $1+0.9\times0.1=1.09$ | $v(s_9):\ 0.1\to0.199$ |
| 7 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | $1+0.9\times0.199=1.179$ | $v(s_9):\ 0.199\to0.297$ |

第 1~3 步:target 全是 0,价值不动。第 4 步:$s_8$ 走到 $s_9$ 拿到 $+1$,学到"去 $s_9$ 有 $+1$",价值从 0 升到 0.1。第 5 步起:$s_9$ 自己学会 stay 有 $+1$,价值开始爬:$0\to0.1\to0.199\to0.297\to\cdots$,最后会爬到 $1/(1-\gamma)=10$(每一步 $+1$ 的折现和)。

关键看第 4、5 步:**$+1$ 这个信息是从 $s_9$ 往回传的**。$s_8$ 学到的 $+1$,来自"$s_9$ 有 $+1$";$s_9$ 自己学到的 $+1$,来自"stay 有 $+1$"。而 $s_1$、$s_2$、$s_5$ 现在还是 0——它们要等以后再次被访问,才能把 $+1$ 一步步传回来。

这和 Bellman 文章里价值迭代"价值从目标往外传"是同一个现象,只是节奏不同:**价值迭代每轮扫一遍所有状态;TD 每次只更新"刚走过"的那一个**。所以 TD 不用等 400 步,代价是 $+1$ 只能"一步一传",要反复经过才传回 $s_1$。

真实轨迹不是这条 lucky 的:均匀随机下 agent 多数时间撞墙、踩禁区。模拟里从 $s_1$ 出发的前 30 步,15 步拿到 $-1$(8 步撞墙、7 步踩禁区),只有 1 步 $+1$;到第 28 步才第一次到 $s_9$(那次 $s_6$ 做 down,$v(s_6)$ 从 $-0.3875$ 升到 $-0.2488$,把 $+1$ 传回 $s_6$)。

TD 学的是"当前策略 $\pi_0$"的价值。$\pi_0$ 均匀随机时,目标格 $s_9$ 的价值 $v_{\pi_0}(s_9)=-2.926$ 是负的。为什么?因为这是**在 $\pi_0$ 下**的价值,不是最优价值。站在 $s_9$,五个动作各 $1/5$:

| 动作 | 结果 | 奖励 |
|---|---|---|
| up | 进禁区 $s_6$ | $-1$ |
| right | 撞墙 | $-1$ |
| down | 撞墙 | $-1$ |
| left | 到 $s_8$ | $0$ |
| stay | 留在 $s_9$ | $+1$ |

每步期望立即奖励 $\frac15(-1-1-1+0+1)=-0.4$。$+1$ 只在 stay($1/5$ 概率)时出现,抵不过 $3/5$ 概率的 $-1$——所以均匀随机下"站在目标格反而是亏的"。而最优策略下 $s_9$ 价值是 $10$(永远 stay):同一个格,策略不同,价值天差地别。MC 文章 §9 也提过这一点:完全均匀(ε=1)时 $s_9$ 价值 $-2.93$,比邻居 $s_8$ 还低。

旁观者用模型解出的 $V_{\pi_0}$:

$$
V_{\pi_0}=[-3.083,\ -2.928,\ -3.579,\ -2.727,\ -2.639,\ -2.884,\ -2.864,\ -2.371,\ -2.926].
$$

TD($\alpha=0.1$,$v_0=0$)从 $s_1$ 出发按 $\pi_0$ 走,估计逐步逼近真值:

| 步数 $t$ | RMSE vs $V_{\pi_0}$ | $v_t(s_1)$ | $v_t(s_8)$ | $v_t(s_9)$ |
|---|---|---|---|---|
| 100 | 2.63 | $-0.33$ | $-0.03$ | $-0.36$ |
| 1,000 | 1.05 | $-2.09$ | $-1.17$ | $-2.01$ |
| 10,000 | 0.36 | $-2.85$ | $-1.94$ | $-2.27$ |
| 100,000 | 0.24 | $-3.20$ | $-2.81$ | $-2.60$ |
| 500,000 | 0.28 | $-3.08$ | $-1.94$ | $-2.76$ |

两点注意。第一,50 万步后 RMSE 停在 0.24~0.28,估计在真值附近小幅徘徊而不精确停下:常数 $\alpha=0.1$ 不满足 $\sum\alpha_t^2<\infty$,教材的收敛定理只保证期望意义收敛,实践中常用常数步长,代价就是这点波动。第二,波动幅度因状态而异:$s_8$ 在 $\pi_0$ 下很少被访问,访问少,波动就大——10 万步 $-2.81$、50 万步 $-1.94$,真值 $-2.371$。

## 5. 一步样本 vs 整条回报:TD 和 MC 差在哪

同一个问题(估价值),MC 和 TD 的"样本"不一样:

| | MC | TD |
|---|---|---|
| 一个样本是什么 | 整条回报 $G$ | 一步备份 $r+\gamma v(s')$ |
| 攒一个样本要等多久 | 整条 episode(400 步) | 一步 |
| 样本里有自己的估计吗 | 没有(全是真实奖励) | 有 $v(s')$ |
| 方差 | 高(400 个随机项之和) | 低(只有一项随机) |
| 没有终止态的任务 | 不行(没有"结束"就没有回报) | 行 |

具体到同一条 lucky 轨迹,站在 $s_1$:MC 要的样本是从 $s_1$ 出发的完整回报 $0+0.9\times0+0.9^2\times0+0.9^3\times1+0.9^4\times1+\cdots=7.29$(MC 文章 §6 表格里那行),必须等整条轨迹算完;TD 第一步的样本只有 $0+0.9\times v_0(s_2)=0$,一步就有。

"样本里有自己的估计"这一行是 TD 的代价,它带来三件事:

- **要初始猜测**。target 里有 $v(s')$,所以得先有个 $v_0$。MC 不需要,直接平均回报。(这里设成 0。)
- **$+1$ 只能一步步传**。$s_1$ 要等 $s_2$、$s_5$、$s_8$ 的价值都涨起来才能学到——这就是 bootstrap 的"慢"。
- **target 不完美**。用的 $v(s')$ 不是真的 $v_\pi(s')$,一开始偏差大,随估计变准而变准。

## 6. 动作值版本:Sarsa

**解出 $v_{\pi_0}$ 之后怎么改进策略?答案是 $\arg\max$,但 $\arg\max$ 的对象是 $Q$,不是 $V$。**

$\pi(s)\leftarrow\arg\max_a q(s,a)$——Bellman 文章的"决策靠 $Q$"。但 $q$ 不能从 $v$ 白拿:$q_{\pi_0}(s,a)=R(s,a)+\gamma\sum_{s'}P(s'|s,a)\,v_{\pi_0}(s')$,里面有 $P$、$R$,没有模型就算不了。假设有模型,以 $s_1$ 为例逐动作算(下一步用 $v_{\pi_0}$ 查表):

| 动作 | $q_{\pi_0}(s_1,a)=R+0.9\,v_{\pi_0}(s')$ | 值 |
|---|---|---|
| up(撞墙) | $-1+0.9\times(-3.083)$ | $-3.77$ |
| right | $0+0.9\times(-2.928)$ | $-2.64$ |
| down | $0+0.9\times(-2.727)$ | **$-2.45$** |
| left(撞墙) | $-1+0.9\times(-3.083)$ | $-3.77$ |
| stay | $0+0.9\times(-3.083)$ | $-2.77$ |

$\arg\max$ 是 down,所以 $\pi_1(s_1)=\mathrm{down}$。但这五个数用了 $P$、$R$——无模型的环境里 agent 拿不到。

要分清 agent 和旁观者两个视角。**我们**(读者、写文章的人)设计了这个世界,手里有 $P$、$R$ 表,所以能解出 $V_{\pi_0}$、能算上面这五个数——这是"旁观者"视角,只用来验证。**agent 没有这些**:它的输入只有它实际经历过的样本 $(s,a,r,s')$,它不能问"从 $s_1$ 做 down 会到哪、给多少奖励",除非真的做一次、看结果。所以"估出 $v$ 之后没法改进"指的是 agent:它手里只有 $v$ 的估计和样本,没有 $P$、$R$。

无模型必须直接估 $q$:把 TD 更新里的 $v$ 全换成 $q$:

$$
q(s,a) \leftarrow q(s,a) + \alpha\big[\,r+\gamma\,q(s',a')-q(s,a)\,\big]
$$

$a'$ 是下一步(在 $s'$ 按当前策略)会做的动作。因为每次更新需要 $(s,a,r,s',a')$ 五个东西,所以叫 **Sarsa**(state-action-reward-state-action)。$a'$ 要等 agent 在 $s'$ 真的选了才拿得到,所以更新比行动慢一步。

和状态值版唯一的差别:target 里"下一格的价值"用 $q(s',a')$(下一步实际会做的动作),不是 $v(s')$——这一点正是 §9 说 Sarsa 是 on-policy 的原因。

## 7. 例子:Sarsa 学 $s_1\to s_9$ 的最优路径

下面用真实数字把 Sarsa 走一遍:先看一个样本怎么代入更新式,再走一整段轨迹,最后看 $q$ 表怎么被填满、策略怎么读出来。

取一个样本:agent 站在 $s_1$,做了 **left**(这是 $a$),撞墙,得了 $r=-1$,还在 $s_1$(即 $s'=s_1$)。**agent 没停下,继续在 $s_1$ 选下一个动作——按当前策略(ε-greedy)选了 down,这就是 $a'$。** $a'$ 不是算出来的,是 agent 走到 $s'$ 之后自己选的下一步,这次是 down;换成别的动作也行,只是 $q(s_1,a')$ 会查不同的格子。

查表,$q(s_1,\mathrm{down})$ 现在是 0。按 §6 的更新式算 TD target:

$$
\bar{q}_t = r + \gamma\, q(s',a') = -1 + 0.9\times q(s_1,\mathrm{down}) = -1 + 0.9\times 0 = -1.
$$

说明 $q(s_1,\mathrm{left})$ 应该接近 $-1$。但一条样本有噪声,不能一步到位,只挪一小步($\alpha=0.1$):

$$
q(s_1,\mathrm{left}) \leftarrow q(s_1,\mathrm{left}) + 0.1\times(\bar{q}_t - q(s_1,\mathrm{left}))
= 0 + 0.1\times(-1-0) = -0.1.
$$

一个样本走完,$q(s_1,\mathrm{left})$ 从 0 变成 $-0.1$。

现在让 agent 走一整段(示意:恰好走到目标的那条;$q_0=0$、$\alpha=0.1$)。这条轨迹的动作序列是给定的——包括每行的 $a'$,都是 agent 当时自己选的(和上面那个样本一样);真实里由 ε-greedy 随机决定、多数走不到目标。每一步都写全:从哪做了哪个动作、得了什么奖励、到了哪、下一步动作是什么、哪个格子被更新成多少:

| 步 | 转移(动作 $a$、奖励 $r$) | 下一步 $a'$ | TD target $\bar{q}_t=r+0.9\,q(s',a')$ | 更新后 |
|---|---|---|---|---|
| 1 | $s_1\xrightarrow{\mathrm{right}}s_2$,$r{=}0$ | down | $0+0.9\times q(s_2,\mathrm{down})=0$ | $q(s_1,\mathrm{right}):\ 0\to0$ |
| 2 | $s_2\xrightarrow{\mathrm{down}}s_5$,$r{=}0$ | down | $0+0.9\times q(s_5,\mathrm{down})=0$ | $q(s_2,\mathrm{down}):\ 0\to0$ |
| 3 | $s_5\xrightarrow{\mathrm{down}}s_8$,$r{=}0$ | right | $0+0.9\times q(s_8,\mathrm{right})=0$ | $q(s_5,\mathrm{down}):\ 0\to0$ |
| 4 | $s_8\xrightarrow{\mathrm{right}}s_9$,$r{=}{+}1$ | stay | $1+0.9\times q(s_9,\mathrm{stay})=1$ | $q(s_8,\mathrm{right}):\ 0\to0.1$ |
| 5 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | stay | $1+0.9\times q(s_9,\mathrm{stay})=1$ | $q(s_9,\mathrm{stay}):\ 0\to0.1$ |
| 6 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | stay | $1+0.9\times 0.1=1.09$ | $q(s_9,\mathrm{stay}):\ 0.1\to0.199$ |
| 7 | $s_9\xrightarrow{\mathrm{stay}}s_9$,$r{=}{+}1$ | stay | $1+0.9\times 0.199=1.179$ | $q(s_9,\mathrm{stay}):\ 0.199\to0.297$ |

一段走完,看三件事:

- **每步只更新一个格子**——"这一步从哪个状态做了哪个动作"的那个 $(s,a)$。其他格子原样不动。
- **$a'$ 起着作用**:第 4 步更新 $q(s_8,\mathrm{right})$ 时,target 里要 $q(s_9,\mathrm{stay})$——所以得先等 agent 在 $s_9$ 选了 stay,这一步的更新才算得出来。这就是 §6 说的"更新比行动慢一步"。
- **$+1$ 从目标格一步步传回来**:和 §4 的 $v$ 版本是同一段轨迹、同样的数字,只是这次写进 $q$ 表。$q(s_9,\mathrm{stay})$ 从 0 爬到 0.297——因为每次 stay 的 $\bar{q}_t=1+0.9\,q(s_9,\mathrm{stay})$ 随它自己涨(bootstrap);等 $s_9$ 的价值涨起来,$q(s_8,\mathrm{right})$ 下次再被访问时也会跟着涨。

$q$ 是一张表(状态 × 动作),轨迹里每步只碰一个格子。agent 反复走,$\varepsilon$-greedy 的探索保证每个动作迟早被选到,于是每个格子迟早被访问、被更新;访问越多的格子越准。

策略改进 $\pi(s)=\arg\max_a q(s,\cdot)$ 只是**查当前这行**:agent 站在 $s$,把这行已经攒出来的值拿来比较,选最大。行没填满也能查(没填的格子还是初始 0)——这正是"边估边改"能跑起来的原因。

真实跑 1000 回合($q_0=0$、$\alpha=0.1$、$\varepsilon=0.1$,每个回合从 $s_1$ 出发、到 $s_9$ 终止),$s_1$ 这一行随回合累积:

| 回合末 | $q(s_1,\mathrm{up/right/down/left/stay})$ | $\arg\max$ |
|---|---|---|
| 1 | $[0,\ 0,\ 0,\ -0.1,\ 0]$ | 全是 0,并列 |
| 50 | $[-0.34,\ 0.00,\ 0.42,\ -0.30,\ 0.05]$ | down |
| 500 | $[-0.48,\ 0.10,\ 0.65,\ -0.53,\ 0.26]$ | down |
| 1000 | $[-0.47,\ 0.24,\ 0.66,\ -0.48,\ 0.39]$ | down |

- **up、left 一直负**:撞墙,而且一旦变负就不再被选,$\arg\max$ 避开。
- **down 越涨越高**:通往目标的路径反复走,$+1$ 一步步传回 $s_1$。
- **right 涨得慢**:被 down 压着,访问少。
- 这些数都小(到 0.66):回合在 $s_9$ 终止,agent 学的是"从 $s_1$ 到目标的折现奖励",不是无限期价值($q^*(s_1,\mathrm{down})=7.29$);但 $\arg\max$ 的排序是对的。

Sarsa 单独用只评估;配合策略改进才是完整算法(教材 Algorithm 7.1):每更新完 $q(s,a)$,立刻把 $s$ 的策略改成 $\varepsilon$-greedy(定义见 MC 文章 §7)。这就是广义策略迭代——边评估边改进,不把某个策略先评估到收敛。

对应的,每回合的总奖励和长度(同样是那 1000 回合):

| 回合 | 总奖励 | 长度 |
|---|---|---|
| 1 | $-3$ | 23 |
| 5 | $0$ | 12 |
| 10 | $1$ | 4 |
| 50 | $1$ | 4 |
| 100 | $0$ | 5 |
| 500 | $1$ | 4 |
| 1000 | $1$ | 4 |

第 1 回合:总奖励 $-3$、长度 23——初始 $q=0$,策略几乎随机,乱走、撞墙、踩禁区。到第 10 回合,回合已经是 4 步最短路径:总奖励 $1$、长度 4。$s_1\to s_9$ 最短 4 步:$\mathrm{down}\to\mathrm{down}\to\mathrm{right}\to\mathrm{right}$($s_1\to s_4\to s_7\to s_8\to s_9$),奖励 $1$;另一条 $\mathrm{right}\to\mathrm{down}\to\mathrm{down}\to\mathrm{right}$ 同样 4 步同样奖励,也是最优。

偶发回退:第 5 回合长度 12、第 100 回合长度 5——$\varepsilon$-greedy 有小概率走出非最优动作;1000 回合里最差总奖励 $-7$、最长 29 步,都是这个原因。教材的建议:$\varepsilon$ 衰减。

学过之后的策略:路径上的状态对了——$s_1$、$s_4$ 学到 down(和最优 right 等值,$q^*(s_1,\mathrm{right})=q^*(s_1,\mathrm{down})=7.29$),$s_7$、$s_8$ 学到 right。路径外的状态没被充分探索:$s_3$ 学到 right(最优是 down,$q^*=8$),禁区 $s_6$ 学到 left(最优是 down,一步逃进目标)。这就是路径任务的特点:只探索路径附近就够,代价是其他状态可能局部次优——教材 7.2.2 的结论。

## 8. n-step Sarsa:用几步真实奖励,再开始用估计

TD 用 1 步真实奖励、剩下用估计;MC 用整条真实奖励。中间还有很多选法——用 $n$ 步真实奖励、再开始用估计。把 target 按这个思路拆开:

$$
\begin{aligned}
n{=}1{:}\quad r_{t+1} + \gamma\,q(s_{t+1},a_{t+1}) &\qquad\text{(Sarsa)}\\
n{=}2{:}\quad r_{t+1} + \gamma r_{t+2} + \gamma^2 q(s_{t+2},a_{t+2}) &\\
n{=}3{:}\quad r_{t+1} + \gamma r_{t+2} + \gamma^2 r_{t+3} + \gamma^3 q(s_{t+3},a_{t+3}) &\\
n{=}\infty{:}\quad r_{t+1} + \gamma r_{t+2} + \gamma^2 r_{t+3} + \cdots &\qquad\text{(MC,完整回报)}
\end{aligned}
$$

它们其实都是同一个回报 $G_t$ 的分解,只是"用几项真实奖励、剩下的用估计收尾"不一样。

- $n=1$:就是 Sarsa。
- $n=\infty$:就是 MC(整条真实回报,再令 $\alpha=1$ 一步到位)。
- 中间的 $n$:介于两者之间。

代价:n 越大,要攒越久才能更新(得等 $t+n$ 步攒够 target)。n 小 → 接近 Sarsa:马上更新、方差小、偏差大(估计用得多);n 大 → 接近 MC:等得久、方差大(真实奖励里随机项多)、偏差小。

## 9. Q-learning:target 里用"最好的动作",不是"实际做的动作"

Sarsa 的 target(§7):$\;r+\gamma\,q(s',a')$,$a'$ 是**实际会做的动作**——所以它评估的是"当前正在走的这个策略"。

Q-learning 的 target:$\;r+\gamma\max_a q(s',a)$——**$s'$ 里看起来最好的动作**:

$$
q(s,a) \leftarrow q(s,a) + \alpha\big[\,r+\gamma\max_a q(s',a)-q(s,a)\,\big]
$$

Bellman 文章里见过这个区别:评价一个策略的方程用"按策略平均",最优方程用"取最大"。Sarsa 解的是前者(给定策略的 Bellman 方程),Q-learning 解的是后者(Bellman 最优方程),所以 Q-learning 直接冲着最优价值去,不用管当前策略是什么。

**on-policy 还是 off-policy。** 任务里其实有两个策略:生成样本的行为策略 $\pi_b$,和要被学出来的目标策略 $\pi_T$。

- **Sarsa 是 on-policy**:target 里的 $a'$ 是"实际会做的动作",按生成样本的策略采的——所以 Sarsa 估的就是那个策略本身,目标策略 = 行为策略,分不开。
- **Q-learning 是 off-policy**:target 里是 $\max_a q(s',a)$,和"实际做哪个动作"无关。生成样本用谁都行(甚至用均匀随机),学出来的目标策略是贪心策略,可以和生成样本的策略不同。根本原因:它解的是最优方程,解里天然带 $\max$。

off-policy 的价值:可以用"别的策略"采的数据来学。想估全部 $(s,a)$,样本就得覆盖所有 $(s,a)$;Sarsa 的 $\varepsilon$ 通常小,探索有限;直接用探索强的策略(比如均匀随机)采一条长轨迹再 off-policy 学习,效率高得多。

别和 online/offline 搞混。online 指边与环境交互边更新;offline 指用预先采好的数据更新。on-policy 只能 online 用;off-policy 两种都行。

## 10. 例子:off-policy Q-learning

行为策略 $\pi_b$ = 均匀随机(每个动作 $0.2$),采一条 10 万步的轨迹;目标策略 $\pi_T$ 是贪心。$\alpha=0.1$、$q_0=0$。

每步循环(整个 10 万步不变):行为策略掷骰子选动作 $a$ → 做 $a$ 得 $r$、$s'$ → 更新 $q(s,a)$ → 下一格继续掷骰子。更新式就是 §9 的:

$$
q(s,a) \leftarrow q(s,a) + \alpha\big[\,r + \gamma \max_a q(s',a) - q(s,a)\,\big]
$$

$\max_a q(s',a)$ 读作"在 $s'$ 那行取最大":$s'$ 是**实际到达的下一格**,$q(s',\cdot)$ 有 5 个数(5 个动作各一个),取最大的那个。例如第 1 步 agent 做 stay、$s'{=}s_9$,$q(s_9,\cdot)=[0,0,0,0,0]$,$\max=0$;第 2 步 $q(s_9,\mathrm{stay})=0.1$ 后,这行变 $[0,0,0,0,0.1]$,$\max=0.1$。注意是对 $s'$ 取,不是对当前格 $s$:第 4 步 agent 做 up 到了 $s_6$,max 取 $s_6$ 那行(还是 0)。(§9 讲过,正因为更新用 $\max$、不依赖实际动作,行为策略才能随便选。)

行为策略均匀随机,真实跑的前 8 步:

| 步 | 在 $s$ 做 $a$($r$) | 到了 $s'$ | $\bar{q}_t=r+0.9\max_a q(s',a)$ | 更新后 |
|---|---|---|---|---|
| 1 | $s_9$: stay($+1$) | $s_9$ | $1+0.9\times\max_a q(s_9,a)=1+0.9\times0=1$ | $q(s_9,\mathrm{stay}):\ 0\to0.1$ |
| 2 | $s_9$: stay($+1$) | $s_9$ | $1+0.9\times0.1=1.09$ | $q(s_9,\mathrm{stay}):\ 0.1\to0.199$ |
| 3 | $s_9$: stay($+1$) | $s_9$ | $1+0.9\times0.199=1.179$ | $q(s_9,\mathrm{stay}):\ 0.199\to0.297$ |
| 4 | $s_9$: up($-1$) | $s_6$ | $-1+0.9\times\max_a q(s_6,a)=-1+0.9\times0=-1$ | $q(s_9,\mathrm{up}):\ 0\to-0.1$ |
| 5 | $s_6$: stay($-1$) | $s_6$ | $-1+0.9\times0=-1$ | $q(s_6,\mathrm{stay}):\ 0\to-0.1$ |
| 6 | $s_6$: stay($-1$) | $s_6$ | $-1+0.9\times0=-1$ | $q(s_6,\mathrm{stay}):\ -0.1\to-0.19$ |
| 7 | $s_6$: right($-1$) | $s_6$ | $-1+0.9\times0=-1$ | $q(s_6,\mathrm{right}):\ 0\to-0.1$ |
| 8 | $s_6$: up($0$) | $s_3$ | $0+0.9\times\max_a q(s_3,a)=0$ | $q(s_6,\mathrm{up}):\ 0\to0$ |

表里能看两件事。一是 $\max_a q(s',a)$ 怎么算:前 3 步更新 $q(s_9,\mathrm{stay})$ 时取 $s_9$ 那行目前最大的值,它随 $q(s_9,\mathrm{stay})$ 自己涨而涨;到 $s_6$ 后 $\max_a q(s_6,a)=0$,target 只剩立即奖励。二是 agent 做什么由行为策略随机挑,和更新里的 $\max$ 是两回事:agent 在 $s_9$ 做 stay 是均匀随机掷出来的(前 3 次碰巧 stay、第 4 次碰巧 up,跟"哪个动作最好"无关),更新 $q(s_9,\mathrm{stay})$ 时却用 $\max_a q(s_9,a)$——那是想学的最优值。行为策略决定 agent 实际走哪,更新公式决定 $q$ 朝哪挪,两者不必一致。

真值由模型版策略迭代解出(MC 文章同款):

$$
V^*=[7.29,\ 8.10,\ 8.00,\ 8.10,\ 9.00,\ 10.00,\ 9.00,\ 10.00,\ 10.00],
$$

$$
\pi^*=[\mathrm{right},\ \mathrm{down},\ \mathrm{down},\ \mathrm{right},\ \mathrm{down},\ \mathrm{down},\ \mathrm{right},\ \mathrm{right},\ \mathrm{stay}].
$$

Q-learning 学到的 $\pi_T=[\mathrm{down},\ \mathrm{down},\ \mathrm{down},\ \mathrm{right},\ \mathrm{down},\ \mathrm{down},\ \mathrm{right},\ \mathrm{right},\ \mathrm{stay}]$。和 $\pi^*$ 比只有 $s_1$、$s_4$ 不同,而这两处都是等值的最优动作($q^*(s_1,\mathrm{right})=q^*(s_1,\mathrm{down})=7.29$,$q^*(s_4,\mathrm{right})=q^*(s_4,\mathrm{down})=8.1$)。所以 $\pi_T$ 的价值已经最优,只是选了另一个最优策略——教材 Figure 7.4 特别说明过:存在多个最优策略,学到的和模型解出的不必逐动作一致。注意这里的 $s_3$、$s_6$ 都学对了(§7 的路径任务里它们是次优的):均匀行为策略探索了所有状态。

以上都是 uniform 这一个实验的结果。下面换成三种行为策略各跑一个实验,看探索强弱怎么影响学习。衡量用的是 $\max_a q(s,a)$——"按当前 $q$ 贪心选动作"的价值:每个状态取这行 5 个动作里最大的 $q$,它就是 $q$ 表隐含的状态价值。因为 $V^*(s)=\max_a q^*(s,a)$(Bellman 最优方程),$q$ 学到最优时 $\max_a q(s,a)=V^*(s)$,所以拿它跟 $V^*$ 比 RMSE,RMSE 越小说明 $q$ 越接近最优。$\varepsilon$-greedy 是"以概率 $1-\varepsilon$ 选当前贪心动作、以概率 $\varepsilon$ 随机挑一个",$\varepsilon$ 越小探索越少:

| 步数 | uniform(即 $\varepsilon{=}1$) | $\varepsilon$-greedy, $\varepsilon{=}0.5$ | $\varepsilon$-greedy, $\varepsilon{=}0.1$ |
|---|---|---|---|
| 100 | 8.76 | 8.39 | 8.32 |
| 1,000 | 7.34 | 4.73 | 6.58 |
| 5,000 | 2.87 | 1.68 | 6.14 |
| 10,000 | 0.95 | 0.80 | 4.92 |
| 30,000 | 0.007 | 0.071 | 4.33 |
| 100,000 | 0.000 | 0.000 | 3.31 |

uniform 行为策略 10 万步内收敛到 0;$\varepsilon=0.5$ 也能收敛但慢;$\varepsilon=0.1$ 到 10 万步还停在 3.31——探索不足,某些 $(s,a)$ 没被充分访问。行为策略探索越弱,off-policy 学习越慢;uniform 可以看成 $\varepsilon=1$ 的特例。

![不同行为策略下 Q-learning 的收敛速度](/images/td-qlearn-behavior.png)

行为策略之外,初始猜测也影响收敛(bootstrap 的结果)。同样用 uniform 行为策略:$q_0=10$ 时 5,000 步内收敛($q_0=10$ 最接近真值 $7\sim10$);$q_0=0$ 约 3 万步;$q_0=100$ 最慢,约 10 万步——过高的初始猜测要把所有 $q$ 先压下来。教材 Figure 7.4(g)(h)。

## 11. 统一视角

所有 TD 算法(动作值版)是同一个式子,差别只在 TD target:

$$
q(s,a) \leftarrow q(s,a) + \alpha\,[\,\bar{q}_t - q(s,a)\,]
$$

| 算法 | TD target $\bar{q}_t$ | 解的方程 |
|---|---|---|
| Sarsa | $r_{t+1}+\gamma q(s_{t+1},a_{t+1})$ | Bellman 方程($q_\pi$) |
| n-step Sarsa | $r_{t+1}+\gamma r_{t+2}+\cdots+\gamma^n q(s_{t+n},a_{t+n})$ | Bellman 方程($q_\pi$) |
| Q-learning | $r_{t+1}+\gamma\max_a q(s_{t+1},a)$ | Bellman 最优方程($q^*$) |
| MC | $r_{t+1}+\gamma r_{t+2}+\gamma^2 r_{t+3}+\cdots$ | Bellman 方程($q_\pi$) |

MC 是这个式子的特例:令 $\alpha=1$、$\bar{q}_t$ 取完整回报,更新就变成 $q(s,a)\leftarrow\bar{q}_t$。除 Q-learning 外,其余算法都在解"给定策略的 Bellman 方程",所以都是 on-policy;只有 Q-learning 解 Bellman 最优方程,off-policy。

还有一个变体:Expected Sarsa 把 Sarsa 的 $q(s_{t+1},a_{t+1})$ 换成 $\sum_a\pi(a\mid s_{t+1})q(s_{t+1},a)$,少一个随机变量($a_{t+1}$),方差更低。

## 12. 小结

- **TD 和 MC 解决同一个问题,差别只在"一个样本是什么"**:MC 的样本是整条回报(等 400 步),TD 的样本是一步备份 $r+\gamma v(s')$(一步就有)。
- **TD 的 target 里有自己的估计(bootstrap)**:所以要初始猜测、$+1$ 只能一步步传、target 一开始不准;换来不用等、方差小、能处理持续任务。
- **算法脉络**:TD(0) 估状态值 → Sarsa 估动作值 + 策略改进 → n-step Sarsa(用几步真实奖励的旋钮)→ Q-learning(target 用 max,直接解最优方程)。
- **on-policy(Sarsa 系)**:目标策略 = 行为策略;**off-policy(Q-learning)**:可以不同,能用别的策略采的数据学。`,
}

export default article
