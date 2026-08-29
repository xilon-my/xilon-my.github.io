const article = {
  slug: 'grpo', date: '2026-08-22 18:00', name: 'GRPO：组内相对奖励与策略更新',
  description: 'GRPO 删除 PPO 的 critic。对同一个 prompt 采一组回答,将每条回答的奖励在组内标准化,得到回答级优势;再把这个优势复制给回答中的每个 token,逐 token 计算新旧策略比、clip 和 KL。文章用四条 2-token 回答完整计算一轮更新。',
  tags: ['Post-training'], category: 'Course Review', folder: 'rl-math', author: 'shannon',
  takeaway: 'GRPO 的顺序是:旧策略对同一 prompt 采 G 条回答 → 奖励函数逐条打分 → 组内标准化得到 A_i → 同一回答的每个 token 共用 A_i → 逐 token 计算 π_θ/π_old、clip 和 KL → 更新策略。它省掉 critic,没有省掉奖励;DeepSeekMath 使用奖励模型,DeepSeek-R1-Zero 使用正确性和格式规则。',
  detail: String.raw`
## 1. GRPO 只改 PPO 的一处

PPO 需要 critic $v(s_t)$ 给每个 token 状态估计基线,再由 GAE 算优势。对 LLM 来说,critic 通常也是一个大模型;而奖励又常在回答末尾才出现,训练逐 token 价值网络会增加内存、计算和拟合难度。

GRPO 删除 critic。它对同一个 prompt 一次采多条回答,直接用这一组回答的奖励均值作为经验基线。其余部分仍保留 PPO 的基本结构:旧策略采样、新旧策略概率比、clip 和参考模型 KL。

注意:删除的是 critic,不是奖励。每条回答仍必须得到一个分数。

## 2. 先从一组回答算优势

给定 prompt $q$,用旧策略 $\pi_{\theta_{\mathrm{old}}}$ 采 $G$ 条回答:

$$
o_1,o_2,\dots,o_G\sim\pi_{\theta_{\mathrm{old}}}(\cdot\mid q)
$$

奖励函数分别给出 $r_1,dots,r_G$。GRPO 将第 $i$ 条回答的奖励在组内标准化:

$$
A_i=\frac{r_i-\operatorname{mean}(r_1,dots,r_G)}
{\operatorname{std}(r_1,dots,r_G)}
$$

$A_i>0$ 表示这条回答比同组平均好;$A_i<0$ 表示比平均差。outcome supervision 只给整条回答一个奖励,所以同一回答中的所有 token 共用这个优势:

$$
\hat A_{i,t}=A_i,
\qquad t=1,dots,|o_i|
$$

它不像 PPO 的 GAE 那样区分同一回答中的不同位置。GRPO 用更多回答换掉了价值网络。

## 3. 优势怎样进入参数更新

对回答 $o_i$ 的第 $t$ 个 token,新旧策略概率比为:

$$
\rho_{i,t}(\theta)
=\frac{\pi_\theta(o_{i,t}\mid q,o_{i,<t})}
{\pi_{\theta_{\mathrm{old}}}(o_{i,t}\mid q,o_{i,<t})}
$$

DeepSeekMath 提出的原始 GRPO 目标逐 token 计算概率比、clip 和 KL:

$$
\mathcal J_{\mathrm{GRPO}}(\theta)
=\mathbb E\left[
\frac{1}{G}\sum_{i=1}^{G}\frac{1}{|o_i|}
\sum_{t=1}^{|o_i|}
\left(
\min\big(\rho_{i,t}A_i,
\operatorname{clip}(\rho_{i,t},1-\epsilon,1+\epsilon)A_i\big)
-\beta D_{i,t}
\right)
\right]
$$

这里有两种不同的比较:

- $\rho_{i,t}$ 比较当前策略与采样策略,用于复用旧数据并做 clip;
- $D_{i,t}$ 比较当前策略与固定参考策略,用于 KL 锚定。

DeepSeekMath 使用的逐 token KL 估计为:

$$
D_{i,t}
=\frac{\pi_{\mathrm{ref}}(o_{i,t}\mid q,o_{i,<t})}
{\pi_\theta(o_{i,t}\mid q,o_{i,<t})}
-\ln\frac{\pi_{\mathrm{ref}}(o_{i,t}\mid q,o_{i,<t})}
{\pi_\theta(o_{i,t}\mid q,o_{i,<t})}-1
$$

令 $x=\pi_{\mathrm{ref}}/\pi_\theta$,则 $D=x-\ln x-1\ge0$,因此目标中的 $-\beta D_{i,t}$ 始终是惩罚项。GRPO 先用原始回答奖励计算 $A_i$,再从策略目标中单独减 KL;KL 不进入组内奖励标准化。

## 4. 四条 2-token 回答完整算一遍

词表是 $\{a,b\}$,每条回答有两个 token。奖励规则为:回答 $(a,a)$ 得 1,其余回答得 0。对同一个 prompt 采到:

$$
o_1=(a,a),\quad o_2=(a,b),\quad o_3=(b,a),\quad o_4=(b,b)
$$

$$
r=[1,0,0,0]
$$

### 4.1 组内优势

平均奖励:

$$
\bar r=\frac{1+0+0+0}{4}=0.25
$$

标准差:

$$
\operatorname{std}(r)
=\sqrt{\frac{(1-0.25)^2+3(0-0.25)^2}{4}}
=0.433
$$

所以:

$$
A=[1.73,-0.58,-0.58,-0.58]
$$

$o_1$ 比同组平均好,它的两个 token 都使用 $A_1=1.73$;另外三条回答的 token 分别使用 $-0.58$。这些是每条采样轨迹对总梯度的贡献,共享 token 可能在不同轨迹中得到相反方向,最终由所有样本梯度相加决定。

### 4.2 对正确回答逐 token 做 clip

假设更新若干步后,$o_1=(a,a)$ 两个 token 的新旧策略比分别为:

$$
\rho_{1,1}=1.10,
\qquad
\rho_{1,2}=1.25
$$

取 $\epsilon=0.2$。第一个 token 没越界:

$$
\min(1.10\times1.73,1.10\times1.73)=1.903
$$

第二个 token 超过 $1.2$:

$$
\min(1.25\times1.73,1.20\times1.73)=2.076
$$

第二个 token 的当前概率比虽然是 $1.25$,裁剪目标只按 $1.20$ 计算;继续提高它不会再增加这一项的目标。

### 4.3 再计算 KL 惩罚

假设第一个 token 上,当前策略给已采样 $a$ 的概率是 $0.44$,参考策略给它 $0.40$。则:

$$
x=\frac{0.40}{0.44}=0.9091
$$

$$
D_{1,1}=0.9091-\ln0.9091-1=0.0044
$$

若 $\beta=0.04$,从第一个 token 的目标项中减去:

$$
\beta D_{1,1}=0.04\times0.0044=0.00018
$$

因此这个 token 对目标的最终贡献约为:

$$
1.903-0.00018=1.90282
$$

其他 token 完全同样计算,最后按 token、回答和 batch 求平均,对 $\mathcal J_{\mathrm{GRPO}}$ 做梯度上升。

## 5. 奖励从哪来

GRPO 本身不规定奖励必须由什么产生。

**DeepSeekMath** 使用训练出的奖励模型给回答打分。论文配置中每个问题采 $G=64$ 条回答,KL 系数 $\beta=0.04$。

**DeepSeek-R1-Zero** 不使用神经奖励模型,而使用规则:

- 正确性奖励:数学答案按指定格式提取后核对;代码题可编译并运行测试用例;
- 格式奖励:检查推理过程是否放在指定标签中。

R1-Zero 直接从基座模型开始 RL,没有预先做 SFT;其 AIME 2024 pass@1 在训练过程中从 15.6% 上升到 71.0%。DeepSeek-R1 则先加入冷启动 SFT,之后还包含多阶段 SFT 与 RL,不能把它的完整管线简化成一次 GRPO。

## 6. 一轮 GRPO 的顺序

1. 固定 $\pi_{\theta_{\mathrm{old}}}$;
2. 对每个 prompt 采 $G$ 条回答;
3. 奖励函数给每条回答打分;
4. 组内标准化得到 $A_i$;
5. 把 $A_i$ 复制给回答中的每个 token;
6. 逐 token 计算 $\rho_{i,t}$、clip 和 $D_{i,t}$;
7. 更新 $\pi_\theta$;
8. 下一批采样前,再更新 $\pi_{\theta_{\mathrm{old}}}$。

GRPO 与 PPO 的主要差别集中在第 4 步:PPO 用 critic 和 GAE 估优势,GRPO 用同一 prompt 下的一组回答直接算相对优势。
`,
}

export default article
