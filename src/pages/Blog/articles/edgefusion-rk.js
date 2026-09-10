const article = {
  slug: 'edgefusion-rk',
  date: '2026-09-10 15:00',
  name: 'EdgeFusion-RK：在 RK3588 上构建端侧多模型推理与异构调度系统',
  description: '从“模型能运行”继续向下做：把 MiniCPM5-2B 与航拍 YOLO11n 部署到 RK3588，比较 FP16、INT8 与混合精度，设计 RKNN/RKLLM/CPU 统一 C++ 运行时，并用真实突发负载验证 EDF 调度和后处理优化。',
  tags: ['Inference'],
  category: 'Project',
  author: 'Shannon',
  takeaway: '项目在 Orange Pi 5 Plus（RK3588）上打通了两条端侧推理链路：MiniCPM5-2B 经 RKLLM W8A8 运行，航拍 YOLO11n 经 RKNN FP16/INT8 运行。在此基础上实现 RKNN、RKLLM、CPU 统一异步接口与 NPU/CPU 双通道调度器。64 图 VisDrone 回归集上，INT8 达 45.6 FPS；EDF 在 16 任务突发负载中将截止期违约从 FIFO 的 7 次降到 0 次；score-sum 早筛与 pre-NMS Top-K 将 Python 后处理从 324.2 ms 降至 18.1 ms。所有数字都保留测试口径与限制。',
  detail:
`这个项目最初只有一个目标：让 MiniCPM5-2B 在 RK3588 的 NPU 上运行。模型成功生成文本之后，问题反而变得更明确：一次成功输出只能证明接口接通，不能说明部署是否可靠，也不能回答精度损失、尾延迟、资源竞争和性能瓶颈。

因此，项目继续加入一个航拍目标检测模型、一套量化评测、一个统一 C++ 运行时和三种调度策略。最终要回答的不是“RK3588 能不能运行模型”，而是以下四个问题：

1. 训练框架中的模型如何转换成芯片可以执行的格式；
2. INT8 和混合精度分别损失多少准确率、换来多少吞吐率；
3. 视觉模型、语言模型和 CPU 后处理同时到来时，任务应该如何排队；
4. 推理完成后，CPU 后处理是否会成为新的瓶颈。

本文按这个顺序介绍技术背景、实现过程、实验结果和没有解决的问题。

## 1. 硬件背景：RK3588 提供了什么

实验设备是 Orange Pi 5 Plus，SoC 为 RK3588，内存 16 GiB。Rockchip 的官方规格给出四个 Cortex-A76、四个 Cortex-A55、Mali-G610 GPU，以及三核、标称 6 TOPS 的 NPU。这里的 TOPS 指每秒可执行的整数运算次数，是芯片峰值指标，不等于任意模型都能达到相同吞吐率。

![RK3588 芯片实物图，来源：Wikimedia Commons，CC0](/images/edgefusion-rk/rk3588-chip.jpeg)

CPU、GPU 和 NPU 的工作方式不同：

| 计算单元 | 适合的工作 | 本项目中的用途 |
|---|---|---|
| CPU | 控制流、文件 I/O、预处理、后处理、小规模串行任务 | 图像预处理、NMS、任务队列、基线推理 |
| GPU | 通用并行计算和图形 | 本项目未作为主要推理后端 |
| NPU | 固定计算图中的卷积、矩阵乘和量化算子 | YOLO11n 与 MiniCPM5-2B 推理 |

NPU 的优势来自专用数据通路和片上存储，但它并不直接执行 PyTorch 模型。模型要先经过图转换、算子映射、量化和内存规划，变成芯片运行时认识的格式。这也是端侧部署与普通 GPU 推理的主要差别。

## 2. 软件背景：RKNN 与 RKLLM

Rockchip 提供了两套相关但用途不同的工具链。

- **RKNN Toolkit2** 面向一般神经网络。训练好的 PyTorch 或 ONNX 模型在电脑上转换为 RKNN 文件，开发板再通过 RKNN Runtime 的 C/Python API 调用 NPU。
- **RKLLM Toolkit** 面向大语言模型。原始权重在电脑上经过结构识别、量化和构建，生成 RKLLM 文件；开发板通过 RKLLM Runtime 运行自回归生成。

Rockchip 官方给出的 RKLLM 软件栈如下。左侧是模型权重，中间是在电脑上运行的转换工具，右侧是开发板上的用户态 API、内核驱动与 NPU 硬件。

![RKLLM 软件栈，来源：Rockchip rknn-llm 官方仓库](/images/edgefusion-rk/rkllm-framework.jpg)

图中需要区分“编译阶段”和“运行阶段”。Toolkit 在 x86 电脑上完成模型转换，不在开发板上训练模型；Runtime 负责加载已经构建好的文件、分配内存、提交任务并返回结果。工具链版本、板端 Runtime 和内核驱动之间也需要匹配。

本次验证环境为：

| 项目 | 版本 |
|---|---|
| 开发板 | Orange Pi 5 Plus / RK3588 / 16 GiB |
| 系统 | Ubuntu 24.04，Rockchip Linux 6.1 |
| RKNN Runtime | 2.3.2 |
| RKLLM Runtime / Toolkit | 1.3.0 |
| RKNPU 驱动 | 0.9.7 |

## 3. 为什么选择 MiniCPM5-2B

MiniCPM5-2B 是一个 2B 参数的 dense Transformer。官方模型卡将它定位为本地助手、代码 Agent、工具调用和长上下文场景使用的紧凑模型，原始模型支持 131072 token 上下文。

它并不是一个拿到鼠标和屏幕后就能自动操作电脑的完整系统。模型提供文本生成、代码和工具使用能力；真正的电脑操作还需要观察模块、工具协议、执行器和安全策略。这里选择它的原因是参数规模适合 16 GiB 开发板，同时工具调用能力使它可以作为端侧任务规划器。

### 3.1 先建立 CPU 基线

CPU 路径使用 llama.cpp 和官方 Q4_K_M GGUF，固定到两个 Cortex-A76 核。基线的意义不是与 NPU 做简单胜负比较，而是确认模型、提示词和输出正确，并为 NPU 转换失败时保留一个可运行参照。

| 阶段 | CPU Q4_K_M |
|---|---:|
| 128-token prefill | 18.00 tok/s |
| 64-token decode | 10.10 tok/s |

### 3.2 为什么不能直接把 GGUF 交给 RKLLM

实际尝试发现，RKLLM Toolkit 1.3.0 不接受 llama.cpp 的 Q4_K_M 或 Q8_0 GGUF 作为量化输入。F16 GGUF 可以进入无量化构建，但生成文件超过 4 GiB，板端初始化失败。RK3588 目标也拒绝 W4A16。

最终可用路径是：

~~~text
Hugging Face safetensors
  → RKLLM Toolkit 读取原始权重
  → 使用代表性文本做 W8A8 量化
  → 构建 RK3588 / 4096-token RKLLM 文件
  → 板端 RKLLM Runtime 异步生成
~~~

这里的 4096 token 是部署模型的构建上限，不是原始模型能力的上限。端侧可用上下文同时受构建参数、KV cache、提示词长度、输出长度和可用内存约束。

## 4. W8A8 到底表示什么

W8A8 表示权重（Weight）和激活值（Activation）都使用 8 bit 整数表示。原始浮点数不能直接塞进 int8，需要用缩放因子把浮点范围映射到整数范围。常见的仿射量化写成：

\[
q = \operatorname{clip}\left(\operatorname{round}\left(\frac{x}{s}\right)+z, q_{\min},q_{\max}\right)
\]

其中，\(x\) 是浮点值，\(q\) 是量化后的整数，\(s\) 是 scale，\(z\) 是 zero point。反量化近似为：

\[
\hat{x}=s(q-z)
\]

int8 的存储量约为 FP32 的四分之一，也更符合 NPU 的整数矩阵计算单元。但映射过程会丢失信息。激活范围如果被少量离群值拉大，有限的 256 个整数刻度会变粗，小值的表示误差随之增大。

因此量化需要**校准集**：先让一批代表性输入经过模型，统计各层激活范围，再确定 scale 和 zero point。校准集不是训练集，不更新模型参数；它只决定浮点数如何映射到整数。

## 5. 为什么加入航拍视觉任务

只有语言模型还不足以覆盖典型端侧 AI 软件栈。视觉模型包含卷积、检测头、DFL 解码和 NMS，更适合研究 ONNX→RKNN 转换、逐输出误差和 CPU 后处理。

项目没有依赖摄像头，而是使用公开的 VisDrone2019-DET-val。VisDrone 由天津大学 AISKYEYE 团队采集，官方仓库给出的完整基准包含 10209 张静态图像、288 段视频和超过 260 万个目标框，覆盖行人、汽车、自行车和三轮车等航拍目标。

![VisDrone 航拍样例，来源：VisDrone2019-DET 官方数据集](/images/edgefusion-rk/visdrone-sample.jpg)

航拍图像中的目标通常较小、密集且尺度变化明显，比普通近景图片更容易暴露量化和后处理问题。实验从验证集确定性抽取 64 张图，得到 4585 个有效目标。固定子集让每次转换都使用相同输入，适合工程回归；它不是完整 VisDrone 官方榜单。

检测器使用在 VisDrone 上微调的 YOLO11n。权重实际包含 11 个输出类别，而模型页主要描述 10 个有效类别；额外类别为 others。评测时保留 11 类输出维度，但明确排除模型类 10，避免类别错位。

## 6. 从 YOLO11 到 RKNN

转换分三步：

1. 从 PyTorch checkpoint 导出 ONNX；
2. 使用 Rockchip 的 YOLO11 优化导出方式移除图内后处理，并额外产生 score-sum 输出；
3. 用 RKNN Toolkit2 构建 FP16、INT8 或混合精度模型。

把后处理留在 CPU 的原因是 NMS 包含排序、分支和动态候选数量，未必适合固定计算图；卷积主干和检测头则适合 NPU。这样做也允许单独分析 NPU 推理与 CPU 后处理。

64 图固定子集采用 COCO 风格 101 点插值、IoU 0.50:0.95、maxDet=300。板端稳态时延来自两轮、每轮 100 次相同输入的测试：

| 模型 | mAP50 | mAP50-95 | 板端时延 | 吞吐率 |
|---|---:|---:|---:|---:|
| Host FP32 ONNX | 0.30562 | 0.18503 | 不同机器，不横向比较 | — |
| RKNN FP16 | 0.30791 | 0.18652 | 33.22 ms | 30.1 FPS |
| RKNN INT8 | 0.29949 | 0.17528 | 21.96 ms | 45.6 FPS |
| Hybrid 0.99 | 0.30048 | 0.17708 | 23.50 ms | 42.6 FPS |
| Hybrid 0.995 | 0.30069 | 0.17779 | 27.76 ms | 36.0 FPS |

纯 INT8 相对 FP16 的吞吐率提高约 51.5%，mAP50-95 下降约 1.12 个百分点。混合精度的目标是把误差较大的层保留为较高精度，但这次收益有限：阈值 0.99 只比 INT8 恢复约 0.18 个百分点，却损失约 6.6% 吞吐率；0.995 再恢复约 0.07 个百分点，速度进一步降到 36.0 FPS。

这个结果说明混合精度不是层数越多越好。需要在准确率和时延之间寻找 Pareto 点，而不是默认更多 FP16 算子一定值得。

## 7. 量化误差如何定位

只看最终 mAP 无法判断误差来自哪里。项目保存 FP16、INT8 和混合精度模型的 9 个输出张量，对对应输出计算 cosine similarity 与归一化均方根误差（NRMSE）。

纯 INT8 中，最差 cosine 出现在输出 3，为 0.86229；最差 NRMSE 出现在输出 8，为 0.05916。混合精度 0.99 明显改善了输出 4 和 5，cosine 分别达到 0.99623 和 0.99705，但输出 3 略降为 0.85582。局部张量更接近 FP16，不保证最终检测指标按同样比例提高，因为检测结果还经过阈值、类别选择和 NMS。

项目也比较了 VisDrone 校准集和不匹配的 COCO 校准集。在这个 64 图子集上，两者差异很小且方向不完全一致，因此没有得出“跨域校准必然明显下降”的结论。完整数据集和多个随机子集才能支持更强判断。

MMSE 量化方法也做过尝试。Toolkit 在第 2/156 层时预计还需约 47 分钟，并提示较高内存需求，因此中止。这项结果仍然有价值：优化方法除了精度，还要计算转换时间、内存和迭代成本。

## 8. 从两个 demo 到统一 C++ 运行时

如果 RKNN 和 RKLLM 各自只有独立 demo，上层应用需要分别管理模型生命周期、输入格式、超时和日志。项目因此定义统一 Backend 接口，把视觉、语言和 CPU 工作都包装成异步任务。

每个任务包含：

~~~text
kind    payload    priority    relative_deadline_ms    timeout_ms
~~~

- vision 的 payload 是预处理后的 RGB uint8 张量路径；
- llm 的 payload 是提示词；
- cpu 的 payload 是用于模拟后处理的工作时长。

运行时支持有界队列、排队中取消、运行中取消、超时、相对截止期，以及每个任务的 queue_ms、run_ms、backend、state 和 deadline_missed JSON 遥测。

最初实现只有一个工作线程，虽然接口统一，但 CPU 工作也会阻塞 NPU 任务。后续改为两个资源通道：

- RKNN 与 RKLLM 共用 NPU 通道，避免两套运行时同时争用三个 NPU 核；
- CPU 后处理使用独立通道，可以与 NPU 推理并发。

这不是完整的多芯片调度器，但它已经表达了异构系统最基本的约束：任务的后端不同，资源冲突关系也不同。

## 9. FIFO、固定优先级与 EDF

调度实验使用同一批 16 个任务：10 个真实 RKNN 推理、1 个真实 RKLLM 生成和 5 个 CPU 工作项。三种策略只改变通道内的取任务顺序：

- **FIFO**：按提交顺序执行；
- **固定优先级**：优先执行 priority 数值更高的任务；
- **EDF（Earliest Deadline First）**：优先执行绝对截止时间更早的任务。

最终数据采用线性插值计算 P50/P95/P99：

| 策略 | 墙钟时间 | 吞吐率 | P50 | P95 | P99 | 截止期违约 |
|---|---:|---:|---:|---:|---:|---:|
| FIFO | 710.118 ms | 22.53 task/s | 367.384 ms | 695.221 ms | 707.034 ms | 7/16 |
| 固定优先级 | 683.967 ms | 23.39 task/s | 505.715 ms | 665.792 ms | 680.243 ms | 10/16 |
| EDF | 607.502 ms | 26.34 task/s | 138.286 ms | 326.722 ms | 551.253 ms | 0/16 |

固定优先级比 FIFO 出现更多违约，因为实验中的静态 priority 没有完全对应任务的截止时间。高优先级只表达业务重要性，不能自动满足实时约束。EDF 直接使用 deadline 排序，在这批负载中消除了截止期违约，同时降低了 P50 和 P95。

这个实验没有证明 EDF 对所有负载都最优。它只说明：当目标指标是截止期违约率时，调度策略需要显式使用截止时间；只看平均吞吐率会遗漏尾延迟问题。

## 10. NPU 结束以后，CPU 后处理成为瓶颈

YOLO11 的优化图每个尺度输出三个张量：边框分布、类别分数和 score-sum。Rockchip 的 C++ 示例会使用 score-sum 早退，Python 示例则忽略它。

类别分数均为非负数。若某个位置满足：

\[
\sum_c p_c < \tau
\]

那么必然有：

\[
\max_c p_c < \tau
\]

因此，score-sum 小于置信度阈值的位置不可能成为候选框，可以在 DFL 解码前安全跳过。剩余候选再按最大类别分数做 pre-NMS Top-K，减少逐类别 NMS 的排序和 IoU 计算。

同一组 FP16 输出张量的离线后处理结果如下。三组任务在电脑端并行运行，所以绝对耗时只用于同轮相对比较：

| pre-NMS Top-K | 平均耗时 | P95 | mAP50 | mAP50-95 |
|---:|---:|---:|---:|---:|
| 禁用 | 324.179 ms | 366.932 ms | 0.307905 | 0.186523 |
| 3000 | 58.735 ms | 70.689 ms | 0.307905 | 0.186521 |
| 1000 | 18.131 ms | 22.725 ms | 0.307899 | 0.186547 |

Top-K=1000 将平均后处理时间降低 17.9 倍，mAP50 只变化 0.000006。score-sum 筛选是严格无损的；Top-K 则是近似优化，因此保留为可配置参数，并通过准确率回归决定是否启用。

## 11. MiniCPM5-2B 的板端结果

W8A8 RKLLM 文件约 2.636 GiB，使用三个 NPU 核和 4096 token 构建上下文。10 轮混合提示词测试得到：

| 阶段 | RKLLM NPU W8A8 | llama.cpp CPU Q4_K_M |
|---|---:|---:|
| Prefill | 149.75 tok/s（中位数） | 18.00 tok/s |
| Decode | 8.57 tok/s（中位数） | 10.10 tok/s |
| 峰值模型内存 | 3347.4 MB | 未采集 |

NPU 在 prefill 阶段处理整段 prompt，矩阵规模较大，并行单元更容易被利用。Decode 每一步只生成一个 token，计算粒度小，还包含采样、同步与 KV cache 访问，因此本轮 NPU decode 反而低于双核 CPU。

由于两边的 token 数和量化格式没有完全匹配，prefill 数字不能直接写成严格加速比。更重要的是，结果没有隐藏 NPU 不占优势的部分：它指出下一步应该分析小 batch 自回归阶段的 NPU 利用率和 CPU/NPU 同步开销。

## 12. 项目边界

当前实验有四个明确边界：

1. VisDrone 指标来自 64 图工程回归子集，不是完整官方 benchmark；
2. RK3588 只有单 SoC 内的 CPU/GPU/NPU，不能声称验证了多芯片 NPU/DSP 调度；
3. 板载系统没有可信的输入功率传感器，温度不能代替功耗，能耗需要外接 USB-C 功率计；
4. 调度实验是固定突发负载，没有覆盖长期到达过程、抢占和热约束。

这些限制决定了结果应该如何表述。项目验证的是模型转换、量化诊断、统一运行时和资源感知调度的方法，而不是机载硬件认证或完整飞行系统。

## 13. 从“移植”到“系统”的变化

项目的主要变化不是多运行了一个模型，而是把每个结论变成可复查的数据：

- 模型转换失败时记录输入格式、工具版本和失败边界；
- 量化同时报告精度、时延和逐输出误差；
- 调度同时报告吞吐率、P50/P95/P99 和截止期违约；
- 优化前后使用同一批张量做准确率回归；
- 无法测量的功耗明确标记为缺失，不从温度推断。

在端侧系统中，模型、编译工具链、运行时和调度不是四个独立问题。量化改变输出分布，输出分布改变后处理负载，后处理负载又会影响 CPU 与 NPU 的并发和截止期。把这些环节放在同一个可复现实验中，才是这个项目最终要解决的问题。

## 14. 资料与图片来源

- [Rockchip RK3588 官方产品页](https://www.rock-chips.com/a/en/products/RK35_Series/2022/0926/1660.html)：CPU、GPU、NPU 与视频能力规格。
- [RKNN Toolkit2 官方仓库](https://github.com/airockchip/rknn-toolkit2)：模型转换与 Runtime 工具链说明。
- [RKNN Model Zoo](https://github.com/airockchip/rknn_model_zoo)：YOLO11 转换与板端示例。
- [Rockchip YOLO11 优化导出仓库](https://github.com/airockchip/ultralytics_yolo11)：移除图内后处理与 score-sum 输出。
- [RKLLM 官方仓库](https://github.com/airockchip/rknn-llm)：RKLLM Toolkit、Runtime 和软件栈图片。
- [MiniCPM5-2B 官方模型卡](https://huggingface.co/openbmb/MiniCPM5-2B)：模型定位、上下文长度与公开权重。
- [VisDrone 官方数据集](https://github.com/VisDrone/VisDrone-Dataset)：数据规模、任务定义与航拍样例。
- [RK3588 芯片实物图](https://commons.wikimedia.org/wiki/File:Rockchip_RK3588.jpeg)：Wikimedia Commons，CC0。

文中的 VisDrone 图片来自公开验证集；RKLLM 软件栈图片来自 Rockchip 官方仓库；两张图片均未重新绘制。`,
}

export default article
