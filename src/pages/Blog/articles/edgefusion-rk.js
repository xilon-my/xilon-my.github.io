const article = {
  slug: 'edgefusion-rk',
  date: '2026-09-10 15:00',
  name: 'EdgeFusion-RK：从 MiniCPM5 移植到 RK3588 端侧推理系统',
  description: '项目从“让 MiniCPM5-2B 在 RK3588 上说出第一句话”开始，沿着真实瓶颈继续做量化评测、航拍检测、CPU 后处理和异构调度，最终形成一套可测量、可比较的端侧推理系统。',
  tags: ['Inference'],
  category: 'Project',
  author: 'Shannon',
  takeaway: '一次成功推理只能说明模型接口接通。这个项目继续追踪模型进入 NPU 后出现的四个问题：如何转换、量化损失多少、后处理是否成为瓶颈、多个任务如何共享 CPU 与 NPU。最终 MiniCPM5-2B 通过 RKLLM W8A8 运行，YOLO11n INT8 在 64 张 VisDrone 图像上达到 45.6 FPS；Top-K 将检测后处理从 324.2 ms 降至 18.1 ms；EDF 在 16 个混合任务中把截止期违约从 FIFO 的 7 次降到 0 次。',
  detail: String.raw`
项目是从开发板上的一次模型输出开始的。

最初的任务很直接：把 MiniCPM5-2B 移植到 Orange Pi 5 Plus，让它不经过云端、直接使用 RK3588 的 NPU 生成文本。模型最终确实运行起来了，但这一步完成后，项目仍然只能写成“调用 RKLLM 跑通了一个模型”。它没有说明量化带来了什么损失，也没有解释 NPU 是否真的比 CPU 更合适。

于是后面的工作没有继续堆模型，而是沿着第一次推理暴露的问题逐层展开：先理解模型怎样进入 NPU，再用一个可以计算准确率的视觉任务研究量化，然后处理被 NPU 推理暴露出来的 CPU 瓶颈，最后让语言、视觉和 CPU 任务共享同一套运行时。

这条路径最终形成了 EdgeFusion-RK。

## 1. 第一层问题：模型文件不能直接交给 NPU

实验设备是 16 GiB 内存的 Orange Pi 5 Plus，核心芯片为 RK3588。它包含四个 Cortex-A76、四个 Cortex-A55、Mali-G610 GPU 和三核 NPU。Rockchip 给出的 NPU 峰值算力是 6 TOPS，并支持 INT4、INT8、INT16、FP16 等数据格式。

![RK3588 芯片实物图，来源：Wikimedia Commons，CC0](/images/edgefusion-rk/rk3588-chip.jpeg)

TOPS 是每秒整数运算次数的峰值，不是模型速度。要让模型使用这些计算单元，首先需要把训练框架中的计算图变成 NPU 能执行的图。这个过程会处理算子映射、常量折叠、内存规划和量化；如果某个算子没有对应实现，或者模型格式不被转换器接受，硬件有算力也无法运行模型。

Rockchip 为两类模型提供了两条工具链：

| 工具链 | 处理对象 | 电脑端产物 | 开发板运行时 |
|---|---|---|---|
| RKNN Toolkit2 | CNN、检测、分割等一般神经网络 | RKNN 文件 | RKNN Runtime |
| RKLLM Toolkit | 自回归语言模型 | RKLLM 文件 | RKLLM Runtime |

二者都有一个共同结构：转换发生在 x86 电脑上，开发板只负责加载转换后的文件并执行。下图是 Rockchip 给出的 RKLLM 软件栈。

![RKLLM 软件栈，来源：Rockchip rknn-llm 官方仓库](/images/edgefusion-rk/rkllm-framework.jpg)

本次板端环境固定为 Ubuntu 24.04、Rockchip Linux 6.1、RKNPU 驱动 0.9.7、RKNN Runtime 2.3.2 和 RKLLM 1.3.0。固定版本很重要，因为 Toolkit 生成的文件、用户态 Runtime 和内核驱动需要彼此兼容。

## 2. MiniCPM5-2B 的第一次移植

MiniCPM5-2B 是一个 2B 参数的 dense Transformer。官方模型卡把它定位为本地助手、代码 Agent 和工具调用模型，原始模型支持 131072 token 上下文。它本身不是完整的电脑操作系统：模型负责生成文本或工具调用，观察屏幕、执行动作和限制权限仍需要外围程序。

选择它有两个原因。第一，2B 参数仍有机会放进 16 GiB 开发板；第二，它具备工具调用能力，后续可以作为端侧任务规划器，而不只是聊天模型。

### 2.1 先保留一条 CPU 路径

移植前先使用 llama.cpp 加载官方 Q4_K_M GGUF，并固定在两个 Cortex-A76 核上运行。128-token prefill 为 18.00 tok/s，64-token decode 为 10.10 tok/s。

这条 CPU 路径不是最终方案，但解决了两个基础问题：它先确认权重、分词器和提示词可以正常工作；NPU 转换失败时，也能判断错误来自模型本身还是 RKLLM 工具链。

### 2.2 GGUF 不能直接复用

最初希望把 llama.cpp 已经量化好的 GGUF 直接转换成 RKLLM。实际测试中，RKLLM Toolkit 1.3.0 不接受 Q4_K_M 或 Q8_0 GGUF 作为量化输入。F16 GGUF 可以开始无量化构建，但生成文件超过 4 GiB，板端初始化失败；RK3588 目标也不支持这次尝试中的 W4A16 配置。

最后可运行的路径是：

~~~text
Hugging Face safetensors
  → RKLLM Toolkit 读取原始权重
  → 代表性文本校准 W8A8
  → 构建 RK3588 / 4096-token RKLLM
  → 板端 RKLLM Runtime 生成文本
~~~

这里的 4096 token 是这份 RKLLM 文件的构建上限，而不是原始模型的能力上限。部署时的实际上下文还受到 KV cache、输入长度、输出长度和剩余内存限制。

## 3. W8A8 为什么能让模型进入开发板

W8A8 中的两个 8 分别表示权重 Weight 和激活 Activation 都使用 8 bit 整数。假设一个浮点值为 (x)，量化过程用缩放因子 (s) 和零点 (z) 把它映射为整数：

$$
q = \operatorname{clip}\left(\operatorname{round}\left(\frac{x}{s}\right)+z, q_{\min},q_{\max}\right)
$$

运行时再用

$$
\hat{x}=s(q-z)
$$

近似恢复原值。(q) 只有 256 个可能的整数刻度，因此 (hat{x}) 通常不再等于 (x)。量化换来了更小的模型和适合 NPU 的整数矩阵计算，同时引入了误差。

其中，权重在转换前已经确定，范围容易统计；激活取决于输入，所以需要一组有代表性的文本运行模型，观察各层激活范围，再决定 (s) 和 (z)。这就是校准。校准不训练模型，也不更新参数，只决定浮点范围怎样分配给有限的整数刻度。

最终的 W8A8 RKLLM 文件约为 2.636 GiB。它使用三个 NPU 核，10 轮混合提示词测试得到：

| 阶段 | RKLLM NPU W8A8 | llama.cpp CPU Q4_K_M |
|---|---:|---:|
| Prefill | 149.75 tok/s，中位数 | 18.00 tok/s |
| Decode | 8.57 tok/s，中位数 | 10.10 tok/s |
| 峰值模型内存 | 3347.4 MB | 未采集 |

Prefill 一次处理整段输入，矩阵规模较大，NPU 的并行计算更容易发挥作用。Decode 每次只生成一个 token，还包含采样、同步和 KV cache 访问，本轮测试反而慢于双核 CPU。

两条路径的量化格式和 token 数没有完全对齐，因此不能把表中的 prefill 比值写成严格加速比。它仍然揭示了一个重要事实：使用 NPU 不等于所有阶段都更快。到这里，项目已经能运行语言模型，却还无法回答量化后的输出究竟损失了多少精度，因为文本生成没有一个简单、稳定的逐样本正确答案。

## 4. 为了测清量化，引入航拍目标检测

接下来加入 YOLO11n，不是为了让项目看起来包含更多模型，而是因为目标检测同时提供三样东西：确定的标注框、适合 NPU 的卷积计算，以及必须在 CPU 上完成的解码和 NMS。它可以把“模型能运行”变成精度、时延和后处理开销三组可比较的数字。

开发板没有连接摄像头，实验使用公开的 VisDrone2019-DET-val。VisDrone 的航拍图中包含行人、汽车、自行车和三轮车等目标，目标通常较小而且密集，比普通近景图片更容易暴露量化和 NMS 的问题。

![VisDrone 航拍样例，来源：VisDrone2019-DET 官方数据集](/images/edgefusion-rk/visdrone-sample.jpg)

实验从验证集确定性抽取 64 张图，共包含 4585 个有效目标。每次模型转换都使用同一批图，因此结果适合作为工程回归；这个子集不能代替完整 VisDrone 官方榜单。

模型先从 PyTorch 导出 ONNX，再采用 Rockchip 的 YOLO11 导出方式移除图内后处理，最后分别构建 FP16、INT8 和两种混合精度 RKNN。NPU 负责卷积主干和检测头，CPU 负责 DFL 解码、候选筛选和 NMS。这样分工是因为 NPU 适合固定计算图，而 NMS 中的排序、分支和动态候选数量更适合 CPU。

## 5. INT8 的收益和代价可以同时计算

64 张固定子集采用 COCO 风格 101 点插值、IoU 0.50:0.95 和 maxDet=300。板端时延来自两轮、每轮 100 次相同输入的稳态测试：

| 模型 | mAP50 | mAP50-95 | 板端时延 | 吞吐率 |
|---|---:|---:|---:|---:|
| Host FP32 ONNX | 0.30562 | 0.18503 | 不同机器，不比较时延 | — |
| RKNN FP16 | 0.30791 | 0.18652 | 33.22 ms | 30.1 FPS |
| RKNN INT8 | 0.29949 | 0.17528 | 21.96 ms | 45.6 FPS |
| Hybrid 0.99 | 0.30048 | 0.17708 | 23.50 ms | 42.6 FPS |
| Hybrid 0.995 | 0.30069 | 0.17779 | 27.76 ms | 36.0 FPS |

纯 INT8 相对 FP16 的吞吐率提高约 51.5%，mAP50-95 下降约 1.12 个百分点。这组数字给出了第一个明确取舍：如果应用接受约一个百分点的回归，INT8 可以把检测速度从 30.1 FPS 提高到 45.6 FPS。

混合精度试图把误差较大的层保留为较高精度。阈值 0.99 相比 INT8 恢复约 0.18 个百分点，但损失约 6.6% 吞吐率；0.995 只再恢复约 0.07 个百分点，速度却降到 36.0 FPS。因此，混合精度需要逐层分析和实测，不能通过增加高精度层数直接得到更好的工程结果。

为了确定误差位置，项目保存 FP16、INT8 和混合精度模型的 9 个对应输出张量，计算 cosine similarity 与归一化均方根误差。纯 INT8 最差 cosine 出现在输出 3，为 0.86229；最差 NRMSE 出现在输出 8，为 0.05916。混合精度 0.99 改善了输出 4 和 5，但输出 3 略有下降。

这也解释了为什么某些张量更接近 FP16，最终 mAP 却没有按同样比例恢复。检测框还要经过阈值、类别选择和 NMS，单个中间张量的距离不能直接代表最终任务指标。

项目还比较了 VisDrone 与 COCO 校准集。在当前 64 图子集上，两者差异很小，方向也不完全一致，所以现有结果不支持“跨域校准一定造成明显下降”的结论。MMSE 量化也被测试过，但 Toolkit 在第 2/156 层时预计还需约 47 分钟，并提示较高内存需求，因此中止。转换时间和内存同样是量化方案的成本。

## 6. NPU 加快以后，瓶颈转移到 CPU

YOLO11 的优化图在每个尺度输出边框分布、类别分数和 score-sum。最初的 Python 后处理忽略 score-sum，对所有位置完成 DFL 解码和候选排序。离线计时显示，未经限制的后处理平均需要 324.179 ms，远高于 NPU 的 33.22 ms。此时继续优化 NPU 已经不能明显缩短完整链路时延。

score-sum 可以在解码前排除不可能通过阈值的位置。类别分数 (p_c) 都是非负数；置信度阈值记为 (	au)。如果

$$
\sum_c p_c < \tau
$$

那么一定有

$$
\max_c p_c < \tau
$$

这个位置不可能产生候选框，因此早筛不会改变结果。对剩余候选，再按照最大类别分数保留 pre-NMS Top-K，减少排序和两两 IoU 计算。

同一组 FP16 输出张量上的结果如下：

| pre-NMS Top-K | 平均耗时 | P95 | mAP50 | mAP50-95 |
|---:|---:|---:|---:|---:|
| 禁用 | 324.179 ms | 366.932 ms | 0.307905 | 0.186523 |
| 3000 | 58.735 ms | 70.689 ms | 0.307905 | 0.186521 |
| 1000 | 18.131 ms | 22.725 ms | 0.307899 | 0.186547 |

Top-K=1000 把平均后处理时间降低到原来的约 1/17.9，mAP50 只变化 0.000006。score-sum 早筛由不等式保证无损；Top-K 是近似优化，所以保留为配置项，并用固定回归集验证它是否可以启用。

这一步改变了项目对“端侧性能优化”的理解：瓶颈不固定属于某个硬件。NPU 加快卷积以后，候选数量、内存搬运和 CPU 算法会成为新的限制，完整链路必须分阶段计时。

## 7. 多个模型共存后，需要统一运行时

到这一步，开发板上已经有 RKLLM 语言模型、RKNN 视觉模型和 CPU 后处理。如果它们各自保留独立 demo，上层应用就要分别处理模型生命周期、输入格式、超时、日志和取消，模型之间也无法协调资源。

项目因此定义统一的 C++ Backend 接口，把三类工作包装成异步任务。每个任务都包含：

~~~text
kind    payload    priority    relative_deadline_ms    timeout_ms
~~~

其中，vision 的 payload 是预处理后的 RGB uint8 张量路径，llm 的 payload 是提示词，cpu 的 payload 是后处理工作。运行时统一记录 queue_ms、run_ms、backend、state 和 deadline_missed，并支持有界队列、排队中取消、运行中取消和超时。

第一版运行时只有一个工作线程。接口虽然统一，CPU 后处理仍会挡住 NPU 任务。第二版把执行资源拆成两个通道：RKNN 与 RKLLM 共用 NPU 通道，避免两套运行时同时争用三个 NPU 核；CPU 工作使用独立通道，可以和 NPU 推理并行。

这个结构没有虚构 RK3588 不具备的 DSP 或多芯片能力。它只描述板上真实存在的资源冲突：语言模型和视觉模型竞争 NPU，后处理占用 CPU，但两个通道可以重叠执行。

## 8. 调度器需要关注截止时间，而不只是吞吐率

统一任务以后，最后一个问题是队列顺序。实验一次提交 16 个任务，包括 10 个真实 RKNN 推理、1 个真实 RKLLM 生成和 5 个 CPU 工作项，然后比较三种策略：

- FIFO 按提交顺序运行；
- 固定优先级先取 priority 数值更高的任务；
- EDF 按绝对截止时间从早到晚运行。

三次实验使用相同负载，百分位数采用线性插值：

| 策略 | 墙钟时间 | 吞吐率 | P50 | P95 | P99 | 截止期违约 |
|---|---:|---:|---:|---:|---:|---:|
| FIFO | 710.118 ms | 22.53 task/s | 367.384 ms | 695.221 ms | 707.034 ms | 7/16 |
| 固定优先级 | 683.967 ms | 23.39 task/s | 505.715 ms | 665.792 ms | 680.243 ms | 10/16 |
| EDF | 607.502 ms | 26.34 task/s | 138.286 ms | 326.722 ms | 551.253 ms | 0/16 |

固定优先级出现 10 次违约，比 FIFO 还多。原因不是优先级算法实现错误，而是静态业务优先级没有表达任务还剩多少时间。EDF 直接把 deadline 用作排序依据，在这批负载中消除了违约，并同时降低 P50 和 P95。

这组实验只覆盖固定突发负载，没有证明 EDF 在所有到达过程下都最优。它能够支持的结论是：当应用关心截止期时，只报告平均 FPS 或总吞吐率不够，调度器需要把 deadline 和尾延迟纳入决策。

## 9. 项目最终解决了什么

EdgeFusion-RK 最后形成的不是两个模型 demo 的集合，而是一条可以测量的端侧推理链路：

~~~text
原始权重
  → RKNN / RKLLM 转换与量化
  → NPU 推理
  → CPU 后处理
  → 统一异步任务
  → 资源通道与截止期调度
  → 精度、时延和违约率回归
~~~

这条链路中的步骤互相影响。量化改变输出分布，输出分布影响候选数量，候选数量改变 CPU 后处理时间，CPU 时间又会影响混合任务的尾延迟。单独优化某个模型的 NPU 时延，无法代表系统最终表现。

当前结果仍有明确边界：VisDrone 指标来自 64 图子集；RK3588 只有单 SoC 内的 CPU、GPU 与 NPU，实验没有覆盖多芯片 NPU/DSP；板载系统没有可信输入功率读数，温度不能代替功耗；调度负载也没有覆盖抢占、长期到达过程和热约束。

下一步最有价值的工作不是增加更多模型，而是补完整 VisDrone 评测、使用外接功率计记录每任务能耗，并把固定任务序列扩展为可重复的到达过程。这样才能继续研究精度、时延、能耗和截止期之间的联合取舍。

## 资料与图片来源

- [Rockchip RK3588 官方产品页](https://www.rock-chips.com/a/en/products/RK35_Series/2022/0926/1660.html)：CPU、GPU、NPU 与数据格式规格。
- [RKNN Toolkit2 官方仓库](https://github.com/airockchip/rknn-toolkit2)：模型转换与 Runtime 工具链。
- [RKNN Model Zoo](https://github.com/airockchip/rknn_model_zoo)：YOLO11 转换与板端示例。
- [Rockchip YOLO11 优化导出仓库](https://github.com/airockchip/ultralytics_yolo11)：图外后处理与 score-sum 输出。
- [RKLLM 官方仓库](https://github.com/airockchip/rknn-llm)：RKLLM Toolkit、Runtime 与软件栈图片。
- [MiniCPM5-2B 官方模型卡](https://huggingface.co/openbmb/MiniCPM5-2B)：模型定位、上下文长度与公开权重。
- [VisDrone 官方数据集](https://github.com/VisDrone/VisDrone-Dataset)：数据规模、任务定义与航拍样例。
- [RK3588 芯片实物图](https://commons.wikimedia.org/wiki/File:Rockchip_RK3588.jpeg)：Wikimedia Commons，CC0。

文中的 VisDrone 图片来自公开验证集，RKLLM 软件栈图片来自 Rockchip 官方仓库，图片均未重新绘制。`,
}

export default article
