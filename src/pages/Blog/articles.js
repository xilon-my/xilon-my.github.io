// Lightweight metadata only. Article bodies are loaded on demand by BlogPost.
const articles = [
  { slug: 'grpo', date: '2026-08-22 18:00', name: 'Group Relative Policy Optimization: GRPO', description: 'GRPO 删除 PPO 的 critic。对同一个 prompt 采一组回答,将每条回答的奖励在组内标准化,得到回答级优势;再把这个优势复制给回答中的每个 token,逐 token 计算新旧策略比、clip 和 KL。文章用四条 2-token 回答完整计算一轮更新。', tags: ['RL'], folder: 'rl-math', seriesOrder: 9 },
  { slug: 'dpo', date: '2026-08-22 12:00', name: 'Direct Preference Optimization: DPO', description: 'DPO 直接用离线偏好对训练语言模型。它从带 KL 的奖励最大化目标出发,把未知奖励改写成当前策略与参考模型的 log 概率差,再代入偏好概率,得到一个二分类损失。文章按真实训练流程,用一条 2-token 偏好对算完回答概率、DPO loss 和 softmax 梯度。', tags: ['RL'], folder: 'rl-math', seriesOrder: 8 },
  { slug: 'gpt2-moe-pretrain', date: '2026-08-22 09:00', name: '从下一个 token 到稀疏专家：预训练一个 775M MoE', description: '从一个 prompt 如何变成下一个 token 开始，解释自回归预训练、原始 Transformer/GPT-2 到 LLaMA 范式的架构演进，再落到 8-expert/top-2 MoE 的数据、训练、评测与路由诊断。', tags: ['Inference'] },
  { slug: 'rlhf-ppo', date: '2026-08-21 16:00', name: 'From Grid World to RLHF: PPO', description: '把 PPO 放进真实的 RLHF 管线:SFT 模型生成回答,奖励模型在结尾给分,KL 项逐 token 加进奖励,critic 估状态价值,GAE 算优势,PPO 再用新旧策略概率比和 clip 更新语言模型。最后用一条 2-token 回答把整条计算链完整算一遍。', tags: ['RL'], folder: 'rl-math', seriesOrder: 7 },
  { slug: 'actor-critic-gridworld', date: '2026-08-21 14:06', name: 'Actor-Critic Methods in a 3×3 Grid World', description: '第 10 课:actor-critic。上一课的 REINFORCE 用整条 episode 的回报估 q_t;这一课只动一处——q_t 换成学出来的价值函数(TD),策略(actor)和价值(critic)每步同步更新。一条主线:QAC 给 REINFORCE 加 critic,再把 actor 的信号从 q 换成优势 q−v(A2C)。off-policy 和 DPG 各一句带过。3×3 上每一步更新都能手算。', tags: ['RL'], folder: 'rl-math', seriesOrder: 6 },
  { slug: 'policy-gradient-gridworld', date: '2026-08-20 18:00', name: 'Policy Gradient Methods in a 3×3 Grid World', description: '第 9 课:策略梯度。前面都从价值推策略(argmax);这一篇把策略本身当函数 π(a|s,θ) 学,对一个标量指标做梯度上升。策略梯度定理给出 ∇J=E[∇lnπ(A|S)q(S,A)],REINFORCE 用一条 episode 的回报估 q。3×3 上从 θ=0(均匀 π0)出发,π(s1) 收敛到 down≈0.996。', tags: ['RL'], folder: 'rl-math', seriesOrder: 5 },
  { slug: 'value-function-approximation-gridworld', date: '2026-08-20 15:06', name: 'Value Function Methods in a 3×3 Grid World', description: '第 8 课:值函数方法。任务和 MC/TD 一样——估 π0 的价值;差别在表示:价值从"查表"换成"函数 v̂(s,w)"。表版 TD 更新式里的"格子"换成"参数 w"就是 TD-Linear,一步样本更新一次 w,连带所有状态。收敛后 RMSE 停在函数类地板,恰好等于最小二乘最优拟合。动作值版完成"评估→改进";DQN 是它加神经网络。', tags: ['RL'], folder: 'rl-math', seriesOrder: 4 },
  { slug: 'temporal-difference-gridworld', date: '2026-08-19 17:00', name: 'Temporal-Difference Methods in a Stochastic 3×3 Grid World', description: '第 7 课:时序差分。MC 要等整条 episode 结束才能更新;TD 走一步更新一步,用"这一步奖励 + 下一步状态的当前估计"当目标,所以有偏、需初始猜测。沿 TD(0) → Sarsa → n-step Sarsa → Q-learning 走一遍,只有 Q-learning 解最优方程(off-policy)。', tags: ['RL'], folder: 'rl-math', seriesOrder: 3 },
  { slug: 'monte-carlo-gridworld', date: '2026-08-19 15:00', name: 'Model-Free Monte Carlo in a Stochastic 3×3 Grid World', description: '第 5 课:无模型的蒙特卡洛。上一篇都要用 P、R 算期望;这篇没有模型,价值靠 episode 数据的样本平均来估。即使环境确定、策略随机,同一条 (s,a) 每次回报也不同。沿 MC Basic → 回合长度/稀疏奖励 → Exploring Starts → ε-Greedy 走一遍。', tags: ['RL'], folder: 'rl-math', seriesOrder: 2 },
  { slug: 'ondevice-fc', date: '2026-08-18', name: '基于可靠奖励的 SFT + GRPO 强化学习,让小模型在手机上学会调函数', description: '手机上的 agent 需要调用函数:用户说"定个闹钟",小模型要输出对应的 JSON 调用。我用 DroidCall 数据,在一张 RTX 5090 上把 Qwen2.5-3B 的函数调用准确率从 21% 训练到 51%。SFT 提高 4 个百分点,后续提升主要来自 GRPO 和奖励函数。', tags: ['RL'] },
  { slug: 'black-factory-qa', date: '2026-08-14 20:00', name: '黑灯工厂式自动化开发', description: '黑灯工厂式自动化开发。', tags: ['agent'] },
  { slug: 'ddd-and-3a', date: '2026-08-14 10:00', name: 'Domain-Driven Design: 域、子域、限界上下文,再到 3A 架构', description: '从 DDD 的域、子域、限界上下文,到公司三层(3A),到 OKF 知识仓,再到 agent 顺着这条链定位到要改的代码——所有词都在回答同一件事:边界在哪', tags: ['RAG'] },
  { slug: 'bellman-gridworld', date: '2026-08-12 19:00', name: 'Bellman Equation in a 2×2 Grid World', description: '最近在学习西湖大学赵世钰老师的强化学习的数学原理,前三节课完整介绍了强化学习的概念以及bellman equation,bellman optimality equation。这里用 2×2 grid world总结一下前三节的内容:把策略迭代和价值迭代两条路完整走一遍.', tags: ['RL'], folder: 'rl-math', seriesOrder: 1 },
  { slug: 'rag-self-train', date: '2026-08-06', name: '全参数微调检索模型的多模态 RAG', description: '一直用的是现成的检索模型:embedding 拿来就用,reranker 拿来就用。这次试着自己训了两个,一个检索器(bi-encoder),一个重排器(reranker),用在金融文档问答上。', tags: ['RAG'] },
  { slug: 'embeddings-rerankers', date: '2026-08-05 10:00', name: 'Embeddings and Rerankers from Scratch: When and How to Judge Relevance', description: '嵌入模型(embedding)和重排模型(reranker)的深度拆解:为什么一个把判断提前到入库、一个留到查询时,它们分别怎么被训出来,近三年又怎么被蒸馏成同一份判断力。', tags: ['RAG'] },
  { slug: 'rag', date: '2026-08-05 10:00', name: 'RAG from Scratch: Bolt-On Memory for LLMs', description: 'RAG 的完整工作逻辑、分块这个最容易被低估的细节、怎么客观评估一个 RAG 好不好(RAGAS / RAGChecker / 中文 benchmark),以及从 Naive 到 Agentic RAG 的进化。', tags: ['RAG'] },
  { slug: 'vla', date: '2026-08-03 23:15', name: 'VLA: Vision-Language-Action, When Robots Follow Instructions', description: 'VLA 将图像、语言指令和机器人状态作为输入,直接预测动作。本文以 4.5 亿参数的 SmolVLA 为例,说明它如何在 LIBERO 仿真中完成桌面操作任务。', tags: ['RL'] },
  { slug: 'embodied-ai', date: '2026-08-03 00:30', name: 'Embodied AI from Scratch: RL to Diffusion Policy', description: '具身智能主流方法论的两次范式切换：从 RL 奖励试错（REINFORCE → PPO）到模仿学习 + 扩散模型（Diffusion Policy）。两代方法怎么解决同一个问题，以及为什么后者成了主流。', tags: ['RL'] },
  { slug: 'mcp', date: '2026-07-28 10:59', name: 'Model Context Protocol (MCP)', description: 'AI Agent 与外部工具之间的开放标准协议。由 Anthropic 创建，现由 Linux 基金会旗下的 AAIF 管理，让模型以统一的方式调用工具、读取数据、执行操作。', tags: ['agent'] },
  { slug: 'os-course-reflection', date: '2026-07-26 04:03', name: 'NJU OS by Jyy', description: "我完全可以理解，'分数就是一切'的那种感觉。但忽然有一天分数不作为评价标准的时候，人生是否就失去动力？", tags: ['Course'] },
].sort((a, b) => b.date.localeCompare(a.date))

export const folders = {
  'rl-math': {
    name: 'rl-math',
    desc: '赵世钰《强化学习的数学原理》公开课笔记 + 大模型 RL 后训练延伸:Bellman 方程 → 蒙特卡洛 → 时序差分 → 值函数近似 → 策略梯度 → actor-critic → PPO / DPO / GRPO,从有模型到无模型,从基于价值到基于策略,从 grid world 到语言模型',
  },
}

export default articles
