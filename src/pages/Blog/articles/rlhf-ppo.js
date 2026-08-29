const article = {
  slug: 'rlhf-ppo', date: '2026-08-21 16:00', name: '从 Grid World 到 RLHF：PPO',
  description: '把 PPO 放进真实的 RLHF 管线:SFT 模型生成回答,奖励模型在结尾给分,KL 项逐 token 加进奖励,critic 估状态价值,GAE 算优势,PPO 再用新旧策略概率比和 clip 更新语言模型。最后用一条 2-token 回答把整条计算链完整算一遍。',
  tags: ['Post-training'], category: 'Course Review', folder: 'rl-math', author: 'shannon',
  takeaway: 'PPO 一轮训练的顺序是:固定采样策略 π_old → 生成回答 → 奖励模型分与 KL 项组成逐 token 奖励 → critic 估状态价值 → GAE 算逐 token 优势 → 用 π_θ/π_old 构造裁剪目标 → 更新策略。π_ref 是长期参考模型,π_old 是本批数据的采样模型;KL 约束前者,clip 限制相对后者的本批更新。',
  detail: String.raw`
## 1. 一条回答就是一条轨迹

给定 prompt $x$,语言模型依次生成 $y_1,...,y_T$。第 $t$ 步的状态是 $s_t=(x,y_{<t})$,动作是下一个 token $a_t=y_t$,策略是 softmax 概率 $\pi_\theta(y_t\mid s_t)$。整条回答的概率为:

$$
\pi_\theta(y\mid x)=\prod_{t=1}^{T}\pi_\theta(y_t\mid s_t),
\qquad
\ln\pi_\theta(y\mid x)=\sum_{t=1}^{T}\ln\pi_\theta(y_t\mid s_t)
$$

所以整条回答只有一个最终评价,仍然可以逐 token 反向传播。现在缺的是每个 token 前面应乘什么训练信号。

## 2. 从旧策略采样到 PPO 目标

先固定参数 $\theta_{\mathrm{old}}$,用 $\pi_{\theta_{\mathrm{old}}}$ 采一批回答。随后令 $\theta\leftarrow\theta_{\mathrm{old}}$,把这批数据切成 minibatch 更新。更新几步后,$\pi_\theta$ 已经变化,但数据仍来自 $\pi_{\theta_{\mathrm{old}}}$。

对采到的动作 $a_t$,定义逐动作概率比:

$$
r_t(\theta)=\frac{\pi_\theta(a_t\mid s_t)}{\pi_{\theta_{\mathrm{old}}}(a_t\mid s_t)}
$$

$r_t>1$ 表示当前策略提高了这个动作的概率。将它乘到采样时算好的优势 $\hat A_t$ 上,得到替代目标:

$$
L(\theta)=\mathbb E_t[r_t(\theta)\hat A_t]
$$

$\hat A_t>0$ 时提高该动作概率会增大目标;$\hat A_t<0$ 时降低概率会增大目标。但优势和状态都来自旧数据,这个目标只适合描述采样策略附近的变化。PPO 因此使用:

$$
L^{\mathrm{CLIP}}(\theta)=\mathbb E_t\left[
\min\left(r_t\hat A_t,
\operatorname{clip}(r_t,1-\epsilon,1+\epsilon)\hat A_t\right)
\right]
$$

正优势样本在 $r_t>1+\epsilon$ 后继续提高概率不再增加目标;负优势样本在 $r_t<1-\epsilon$ 后继续降低概率也不再增加目标。clip 截断的是目标中的收益,不会把真实概率比硬锁在区间内。

## 3. RLHF 中的三个模型

### 3.1 SFT 模型

人工示范回答先训练出 SFT 模型。它初始化策略 $\pi_\theta$,同时复制出固定参考模型 $\pi_{\mathrm{ref}}$。后者在整个 PPO 训练中不更新。

### 3.2 奖励模型

对同一个 prompt,标注者比较两个回答,得到 $(x,y_w,y_l)$。奖励模型输入 prompt 与完整回答,输出标量 $R_\phi(x,y)$,并最小化:

$$
\mathcal L_{\mathrm{RM}}=-\log\sigma\big(R_\phi(x,y_w)-R_\phi(x,y_l)\big)
$$

这会提高被偏好回答相对另一个回答的分数。InstructGPT 使用 6B 奖励模型,因为其 175B 奖励模型训练不稳定。

### 3.3 critic

critic 是标量输出网络 $v(s_t,w)$。InstructGPT 用奖励模型初始化它,但 PPO 开始后,奖励模型固定、critic 持续更新。critic 学的是状态价值。由

$$
q_\pi(s,a)=\mathbb E[G_t\mid s_t=s,a_t=a]
$$

和

$$
v_\pi(s)=\sum_a\pi(a\mid s)q_\pi(s,a)
$$

可知:动作按策略采样后,一次实际回报 $G_t$ 是 $v_\pi(s_t)$ 的一个样本。因此 critic 使用价值损失:

$$
\mathcal L_V(w)=\big(v(s_t,w)-G_t\big)^2
$$

## 4. 从最终奖励到逐 token 优势

奖励模型只在回答结束时给分。RLHF 还要约束策略不要离固定参考模型太远,所以每个采样 token 都加入 KL 奖励。记送进 RL 算法的即时奖励为 $u_t$:

$$
u_t=
\begin{cases}
-\beta\ln\dfrac{\pi_{\theta_{\mathrm{old}}}(y_t\mid s_t)}{\pi_{\mathrm{ref}}(y_t\mid s_t)}, & t<T,\\[7pt]
R_\phi(x,y)-\beta\ln\dfrac{\pi_{\theta_{\mathrm{old}}}(y_T\mid s_T)}{\pi_{\mathrm{ref}}(y_T\mid s_T)}, & t=T.
\end{cases}
$$

中间 token 的奖励模型分为 0,所以只有 KL 项;最后一步再加完整回答的分数。采样后,$u_t$ 在本批更新中固定。

从位置 $t$ 开始的回报、TD error 与 GAE 分别是:

$$
G_t=u_t+\gamma u_{t+1}+\gamma^2u_{t+2}+\cdots
$$

$$
\delta_t=u_t+\gamma v(s_{t+1})-v(s_t)
$$

$$
\hat A_t=\delta_t+(\gamma\lambda)\delta_{t+1}+(\gamma\lambda)^2\delta_{t+2}+\cdots
$$

$\lambda=0$ 时只用一步;$\lambda=1$ 时得到 $\hat A_t=G_t-v(s_t)$。InstructGPT 说明 GAE 不折现,即 $\gamma=1$,但没有报告 $\lambda$。

## 5. 一条 2-token 回答完整算一遍

设回答为 $y=(y_1,y_2)$,奖励模型给分 $R_\phi(x,y)=1$。取 $\beta=0.02$、$\gamma=1$、$\lambda=1$、$\epsilon=0.2$:

| token | $\pi_{\theta_{\mathrm{old}}}(y_t\mid s_t)$ | $\pi_{\mathrm{ref}}(y_t\mid s_t)$ |
|---|---|---|
| $y_1$ | $0.4$ | $0.5$ |
| $y_2$ | $0.3$ | $0.6$ |

### 5.1 奖励与回报

$$
u_1=-0.02\ln\frac{0.4}{0.5}=0.0045
$$

$$
u_2=1-0.02\ln\frac{0.3}{0.6}=1.0139
$$

$$
G_2=1.0139,
\qquad
G_1=0.0045+1.0139=1.0184
$$

### 5.2 critic 与优势

假设采样时 critic 输出 $v(s_1)=0.9$、$v(s_2)=1.0$,终点价值为 0。critic 的训练误差为:

$$
(0.9-1.0184)^2=0.0140,
\qquad
(1.0-1.0139)^2=0.0002
$$

用同一组旧预测计算:

$$
\delta_1=0.0045+1.0-0.9=0.1045,
\qquad
\delta_2=1.0139-1.0=0.0139
$$

$$
\hat A_1=0.1045+0.0139=0.1184,
\qquad
\hat A_2=0.0139
$$

### 5.3 策略更新到 softmax

第一次更新前 $\pi_\theta=\pi_{\theta_{\mathrm{old}}}$,两个概率比都是 1,clip 暂不生效:

$$
L(\theta)=0.1184\frac{\pi_\theta(y_1\mid s_1)}{0.4}
+0.0139\frac{\pi_\theta(y_2\mid s_2)}{0.3}
$$

$$
\frac{\partial L}{\partial\pi_\theta(y_1\mid s_1)}=\frac{0.1184}{0.4}=0.296,
\qquad
\frac{\partial L}{\partial\pi_\theta(y_2\mid s_2)}=\frac{0.0139}{0.3}=0.0463
$$

设 $z_k$ 是 softmax 前 token $k$ 的 logit。因为

$$
\frac{\partial\pi(k)}{\partial z_{k'}}=\pi(k)(\delta_{k,k'}-\pi(k'))
$$

所以两个已采样 token 自身的 logit 梯度为:

$$
\frac{\partial L}{\partial z_{y_1}}=0.296\times0.4(1-0.4)=0.071
$$

$$
\frac{\partial L}{\partial z_{y_2}}=0.0463\times0.3(1-0.3)=0.0097
$$

做梯度上升时,两个 logit 都提高,但 $y_1$ 的优势更大,梯度也更大。框架若统一做梯度下降,实际 loss 取 $-L$。

继续使用这批数据更新后,$\pi_\theta$ 改变,$r_t$ 不再等于 1,此时 clip 开始起作用。整批更新完成后,令新策略成为下一批的 $\pi_{\theta_{\mathrm{old}}}$,重新采样。

## 6. 小结

PPO 在 RLHF 中是一条固定的数据流:

1. $\pi_{\theta_{\mathrm{old}}}$ 生成回答;
2. 奖励模型分与 KL 项组成 $u_t$;
3. critic 给出状态价值,GAE 得到优势;
4. $\pi_\theta/\pi_{\theta_{\mathrm{old}}}$ 与 clip 更新策略;
5. critic 用回报目标单独更新。

$\pi_{\mathrm{ref}}$ 始终固定,用于 KL 锚定;$\pi_{\theta_{\mathrm{old}}}$ 每批更新,用于说明数据由谁采样。
`,
}

export default article
