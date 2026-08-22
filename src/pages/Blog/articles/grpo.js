const article = {
  slug: 'grpo',
  date: '2026-08-22 18:00',
  name: 'Group Relative Policy Optimization: GRPO',
  description: 'PPO 要同时维护策略和 critic 两个模型。GRPO 不要 critic:对同一个 prompt 采一组回答,用组内相对优势 (r_i−mean)/std 替代学出来的价值函数。KL 直接加在损失上,而不是逐 token 扣进奖励。DeepSeek-R1 用它训练推理,奖励用规则不用学出来的模型。',
  tags: ['RL'],
  category: 'Course Review',
  folder: 'rl-math',
  author: 'shannon',
  takeaway: 'GRPO 用组内相对优势 A_i=(r_i−mean)/std:组均值替代学出来的 v,不要 critic。目标函数和 PPO 同构(裁剪比值 × 组优势),但 KL 直接加在损失上而不是扣进奖励。DeepSeek-R1 用规则奖励(正确性+格式)训练推理,AIME 2024 pass@1 从 15.6% 涨到 71.0%。',
  detail: String.raw`
## 1. PPO 的 critic 问题

上一讲的 PPO 要同时维护两个模型:策略 $\pi_\theta$ 和 critic(价值网络)。critic 是拿奖励模型初始化的,规模和策略相当,训练时内存和计算都翻倍。而且论文指出:奖励模型通常只给最后一个 token 打分,要训练一个"每个 token 都准确"的价值网络变复杂。能不能不要 critic,用一组采样回答把"平均"算出来?

GRPO 就是答案:对同一个 prompt 采一组回答,用**组内相对优势**替代学出来的价值函数——没有 critic,也就省掉一个模型的训练。注意省掉的是 critic,不是奖励:每条回答还是要一个奖励 $r_i$,来源可以是学出来的奖励模型,也可以是规则判定(§3 的 R1 讲后者)。先把语言 RL 的基础和 PPO 的裁剪比值摆好(§2),再看 GRPO(§3)。

## 2. 语言 RL 的基础

**一个回答是一条 token 序列。** 大模型逐 token 生成回答:给定 prompt $x$,输出回答 $y=(y_1,\dots,y_T)$,整条回答的概率是逐 token 概率的乘积。$\pi_\theta(y|x)$ 是当前策略给回答的概率,$\pi_{\mathrm{ref}}(y|x)$ 是参考模型(SFT)的概率。

**KL 锚定。** 后训练想让"奖励的期望大、但别离参考策略太远",目标是:

$$
\max_\theta\ \mathbb{E}_{x\sim\mathcal{D}}\Big[\mathbb{E}_{y\sim\pi_\theta(y|x)}\big[r(x,y)\big] - \beta\,\mathbb{D}_{\mathrm{KL}}\big(\pi_\theta(y|x)\,\|\,\pi_{\mathrm{ref}}(y|x)\big)\Big]
$$

$r(x,y)$ 是回答的奖励,$\beta>0$ 是 KL 系数。这个目标在 PPO 和 GRPO 里都有,只是 KL 项的放法不同(§3 讲)。

**重要性比和裁剪。** 语言 RL 里采样一条回答要花一次生成,同一批数据想多用几轮,就得用重要性比校正"数据是旧策略采的"。第 $i$ 条回答的比值是

$$
\rho_i = \frac{\pi_\theta(o_i|q)}{\pi_{\theta_{\mathrm{old}}}(o_i|q)}
$$

($o_i$ 是第 $i$ 条回答,$q$ 是 prompt,$\theta_{\mathrm{old}}$ 是采这批数据时的策略)。比值越大,说明新策略比采数据时更常选这条回答。为避免一步更新走太远,PPO 用 clip 把比值夹在 $[1-\epsilon,1+\epsilon]$($\epsilon$ 常用 0.2)。GRPO 的目标函数里这两样都会原样出现。

为了能手算,玩具语言:**词表只有两个 token $a$ 和 $b$**,每条回答 2 个 token(和前面两篇一样:回答是 $(y_1,y_2)$,每个 token 从 $\{a,b\}$ 里选)。奖励规则在下面的例子里给。

## 3. GRPO

**动机。** PPO 的优势要靠 critic 提供:"实际奖励 − 价值网络的预期",$v(s)$ 是**学出来的**"平均能拿多少"。学一个准确的 $v$ 不容易——奖励模型通常只给整条回答一个分,却要让价值网络对每个 token 位置都预测准。GRPO 换一个基线:不学,直接采一组回答,用这一组的**经验平均**当"平均能拿多少"。

**组内相对优势。** 对同一个 prompt $q$,从当前策略采 $G$ 条回答 $\{o_1,\dots,o_G\}$,每条拿一个奖励 $r_i$。第 $i$ 条的优势定义为它相对这一组的偏离:

$$
A_i = \frac{r_i - \mathrm{mean}(r_1,\dots,r_G)}{\mathrm{std}(r_1,\dots,r_G)}
$$

$\mathrm{mean}$ 是组内平均,$\mathrm{std}$ 是组内标准差。

它和 PPO 的优势是同一个东西。PPO 里优势 = 实际奖励 − 价值网络的预期,$v(s)$ 是**学出来的**"平均能拿多少";GRPO 里优势 = 当前奖励 − 这一组回答的平均。两者都是"减掉一个基线,看这条比平均好多少",区别只在基线从哪来:PPO 的基线是 critic 学的,GRPO 的基线是这批采样的经验均值——所以不用学,也就没有 critic。除以 $\mathrm{std}$ 是额外的:让优势的尺度自动调节。

**在玩具语言上算一组。** 词表 $\{a,b\}$,每条回答 2 个 token。奖励规则:回答 $(a,a)$ 得 $+1$,其他回答得 $0$。同一 prompt $q$ 采 $G=4$ 条回答:$(a,a)$、$(a,b)$、$(b,a)$、$(b,b)$,奖励 $r=[1,0,0,0]$。

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

$\rho_i=\pi_\theta(o_i|q)/\pi_{\theta_{\mathrm{old}}}(o_i|q)$ 是第 $i$ 条回答的比值(整条回答的概率之比;实现上逐 token 算、log 后求和)。括号里和 PPO 的 $L^{CLIP}$ 一模一样,只是优势从"critic 估的"换成"组内算的"。

注意 KL 项的位置和 PPO 不同。PPO 把 KL 惩罚逐 token 扣进奖励,再算优势;GRPO 把 KL 直接加在损失上——因为 KL 进奖励会改变每条回答的 $r_i$,组内平均跟着变,优势的计算就绕进去了。DeepSeekMath 的配置:$G=64$、$\beta=0.04$。

**R1 用它训练推理。** DeepSeek-R1 的奖励不用学出来的奖励模型,用**规则**:
- 正确性:数学题比对最终答案,LeetCode 用编译器跑测试用例;
- 格式:要求思考过程放在指定标签里。

R1-Zero 从基座模型直接上 GRPO,不做 SFT,推理能力自己涌现出来(AIME 2024 上 15.6% → 71.0%,pass@1)。R1 加了一步冷启动 SFT 再 RL,更稳定。论文明确说不用神经奖励模型做这个训练,因为在大规模 RL 里它容易被利用(reward hacking)。

## 4. 小结

- **GRPO 用组内相对优势** $A_i=(r_i-\mathrm{mean})/\mathrm{std}$:组均值替代学出来的 $v$,不要 critic。
- **目标函数和 PPO 同构**:裁剪比值 $\rho_i$ 乘组优势,KL 直接加在损失上(而不是扣进奖励)。
- **奖励用规则**:数学题比对答案、代码跑测试,不学奖励模型。
- DeepSeek-R1 用规则奖励训练推理,AIME 2024 pass@1 从 15.6% 涨到 71.0%。
- 和 PPO 的分工:PPO 有 critic(学出来的基线),GRPO 有组采样(经验基线);PPO 的 KL 扣进奖励,GRPO 的 KL 加在损失上。同一套 RL 目标,基线来源和 KL 放法不同。
`,
}
export default article
