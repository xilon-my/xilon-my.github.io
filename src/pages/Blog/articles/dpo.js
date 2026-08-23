const article = {
  slug: 'dpo', date: '2026-08-22 12:00', name: 'Direct Preference Optimization: DPO',
  description: 'DPO 直接用离线偏好对训练语言模型。它从带 KL 的奖励最大化目标出发,把未知奖励改写成当前策略与参考模型的 log 概率差,再代入偏好概率,得到一个二分类损失。文章按真实训练流程,用一条 2-token 偏好对算完回答概率、DPO loss 和 softmax 梯度。',
  tags: ['RL'], category: 'Course Review', folder: 'rl-math', author: 'shannon',
  takeaway: 'DPO 的输入是一份 (prompt,偏好回答,被拒回答) 数据集和一个固定参考模型。当前模型与参考模型分别计算两条回答的 log 概率;四个数构成隐式奖励差,再进入 −log σ 损失。梯度提高偏好回答的概率、降低被拒回答的概率。训练中没有独立奖励模型、critic、在线采样和新旧策略比。',
  detail: String.raw`
## 1. DPO 的输入与输出

DPO 开始前已经有一份偏好数据集:

$$
\mathcal D=\{(x,y_w,y_l)\}
$$

$x$ 是 prompt,$y_w$ 是标注者偏好的回答,$y_l$ 是同一 prompt 下被拒的回答。DPO 不再单独训练奖励模型,而是直接更新语言模型 $\pi_\theta$。

训练时还有一个固定参考模型 $\pi_{\mathrm{ref}}$,通常取偏好训练开始前的 SFT 模型。当前策略 $\pi_\theta$ 通常也从它初始化,但随后只有 $\pi_\theta$ 更新,$\pi_{\mathrm{ref}}$ 始终冻结。

一条回答的概率是逐 token 概率的乘积,因此实际计算使用 log 概率之和:

$$
\ln\pi_\theta(y\mid x)
=\sum_{t=1}^{T}\ln\pi_\theta(y_t\mid x,y_{<t})
$$

一个 DPO batch 的目标很明确:用当前模型和参考模型分别计算 $y_w$、$y_l$ 的整条回答 log 概率,再由这四个数计算损失。

## 2. 为什么损失里会出现参考模型

先从标准 RLHF 目标出发。对每个 prompt,希望策略得到高奖励,同时不要离参考模型太远:

$$
\max_\pi\ \mathbb E_{y\sim\pi(\cdot\mid x)}[r(x,y)]
-\beta D_{\mathrm{KL}}\big(\pi(\cdot\mid x)\,\|\,\pi_{\mathrm{ref}}(\cdot\mid x)\big)
$$

假设奖励函数 $r$ 已知,这个目标的最优策略为:

$$
\pi^*(y\mid x)
=\frac{1}{Z(x)}\pi_{\mathrm{ref}}(y\mid x)e^{r(x,y)/\beta}
$$

$Z(x)$ 负责把所有回答的概率归一化。对上式取对数并整理:

$$
r(x,y)
=\beta\ln\frac{\pi^*(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
+\beta\ln Z(x)
$$

这一步说明:奖励可以用“最优策略相对参考策略抬高了多少 log 概率”表示。实际不知道 $\pi^*$,所以用可训练的 $\pi_\theta$ 去拟合它,定义参考模型相对分数:

$$
\hat r_\theta(x,y)
=\beta\ln\frac{\pi_\theta(y\mid x)}{\pi_{\mathrm{ref}}(y\mid x)}
$$

它不是回答的绝对奖励;只比较同一个 prompt 的两个回答时才有意义。

## 3. 从偏好概率得到 DPO loss

Bradley-Terry 模型把“$y_w$ 优于 $y_l$”的概率写成奖励差的 sigmoid:

$$
p(y_w\succ y_l\mid x)
=\sigma\big(r(x,y_w)-r(x,y_l)\big)
$$

将上面的参考模型相对分数代入。两个回答共享的 $\beta\ln Z(x)$ 相消,得到:

$$
h_\theta
=\beta\left[
\ln\frac{\pi_\theta(y_w\mid x)}{\pi_{\mathrm{ref}}(y_w\mid x)}
-\ln\frac{\pi_\theta(y_l\mid x)}{\pi_{\mathrm{ref}}(y_l\mid x)}
\right]
$$

$$
p_\theta(y_w\succ y_l\mid x)=\sigma(h_\theta)
$$

标签已经告诉我们 $y_w$ 应该胜出,所以最小化负对数似然:

$$
\mathcal L_{\mathrm{DPO}}(\theta)=-\log\sigma(h_\theta)
$$

这就是完整的 DPO loss。它没有 critic、回报或 GAE;也没有 $\pi_\theta/\pi_{\theta_{\mathrm{old}}}$,因此没有 PPO clip。偏好数据仍然可以重复训练多个 epoch。

## 4. 一条 2-token 偏好对完整算一遍

词表只有 $\{a,b\}$。同一个 prompt 下,标注者偏好

$$
y_w=(a,b),
\qquad
y_l=(b,a)
$$

下面展示训练若干步后的一次更新。当前模型已经偏离参考模型:

| 回答与位置 | $\pi_{\mathrm{ref}}$ | $\pi_\theta$ |
|---|---|---|
| $y_w$ 位置 1:$a\mid x$ | $0.4$ | $0.4$ |
| $y_w$ 位置 2:$b\mid x,a$ | $0.6$ | $0.4$ |
| $y_l$ 位置 1:$b\mid x$ | $0.6$ | $0.6$ |
| $y_l$ 位置 2:$a\mid x,b$ | $0.6$ | $0.6$ |

取 $\beta=0.1$。

### 4.1 四个整条回答 log 概率

$$
\ln\pi_\theta(y_w\mid x)
=\ln0.4+\ln0.4=-1.833
$$

$$
\ln\pi_{\mathrm{ref}}(y_w\mid x)
=\ln0.4+\ln0.6=-1.427
$$

$$
\ln\pi_\theta(y_l\mid x)
=\ln0.6+\ln0.6=-1.022
$$

$$
\ln\pi_{\mathrm{ref}}(y_l\mid x)=-1.022
$$

当前模型相对参考模型降低了 $y_w$ 的 log 概率 $0.406$,而 $y_l$ 没变。它当前的相对排序与人的偏好相反。

### 4.2 偏好 logit 与损失

$$
h_\theta
=0.1\big[(-1.833+1.427)-(-1.022+1.022)\big]
=-0.0406
$$

$$
\mathcal L=-\log\sigma(-0.0406)=0.714
$$

$h_\theta<0$ 表示模型当前把被拒回答的相对分放在了偏好回答之上。

### 4.3 梯度怎样改变回答概率

因为

$$
\frac{d}{dh}\big[-\log\sigma(h)\big]=-(1-\sigma(h))
$$

所以

$$
\nabla_\theta\mathcal L
=\beta(1-\sigma(h_\theta))
\left[
\nabla_\theta\ln\pi_\theta(y_l\mid x)
-\nabla_\theta\ln\pi_\theta(y_w\mid x)
\right]
$$

代入 $h_\theta=-0.0406$:

$$
\beta(1-\sigma(h_\theta))
=0.1\times0.51=0.051
$$

梯度下降因此提高 $y_w$ 的 log 概率、降低 $y_l$ 的 log 概率。模型排序越违背标签,$1-\sigma(h_\theta)$ 越大,更新力度越大。

### 4.4 梯度穿过第一个位置的 softmax

位置 1 中,$y_w$ 选 $a$,$y_l$ 选 $b$。这一位置的损失梯度是:

$$
0.051\big[\nabla\ln\pi_\theta(b\mid x)-\nabla\ln\pi_\theta(a\mid x)\big]
$$

log-softmax 对 logit 的导数为:

$$
\frac{\partial\ln\pi(k)}{\partial z_{k'}}
=\delta_{k,k'}-\pi(k')
$$

当前位置 $\pi(a)=0.4$、$\pi(b)=0.6$,所以:

$$
\frac{\partial\mathcal L}{\partial z_a}
=0.051(-0.4-0.6)=-0.051
$$

$$
\frac{\partial\mathcal L}{\partial z_b}
=0.051(0.4+0.6)=0.051
$$

梯度下降执行 $z\leftarrow z-\alpha\nabla_z\mathcal L$,因此 $z_a$ 增大、$z_b$ 减小:偏好回答开头的 $a$ 被提高,被拒回答开头的 $b$ 被降低。位置 2 用相同方法,分别在状态 $(x,a)$ 与 $(x,b)$ 下更新对应 token。

## 5. 实际训练流程

1. 固定 $\pi_{\mathrm{ref}}$,初始化 $\pi_\theta$;
2. 从偏好数据读取一个 batch 的 $(x,y_w,y_l)$;
3. 两个模型分别计算两条回答的整条 log 概率;
4. 四个 log 概率进入 $h_\theta$ 和 DPO loss;
5. 只对 $\pi_\theta$ 反向传播,参考模型不更新;
6. 重复 batch 和 epoch。

DPO 微调阶段不在线生成新回答,也不训练独立奖励模型。它用参考模型相对 log 概率,把偏好标签直接变成语言模型参数的梯度。
`,
}

export default article
