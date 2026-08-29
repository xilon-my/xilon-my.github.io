const project = {
  slug: 'llama-cpp',
  date: '2026-08-18 16:31',
  name: 'llama.cpp',
  url: 'https://github.com/ggml-org/llama.cpp',
  url2: 'https://github.com/ggml-org/ggml',
  description: 'llama.cpp 是一个 C/C++ 本地推理库,可以把 7B 模型量化到约 4.5GB,并在笔记本、树莓派和手机等设备上运行。本文说明量化、GGUF、KV cache、内存带宽限制、CPU/GPU 分工以及同类工具的适用场景。',
  tags: ['Inference'],
  stars: '124k+',
  author: 'Shannon',
  detail:
`在 8GB 内存的个人电脑上运行 7B 参数模型,主要受模型权重大小限制。llama.cpp 通过量化把 7B 模型缩小到约 4.5GB,使其可以在 CPU 甚至树莓派上生成文本。需要先明确其定位:**llama.cpp 不训练模型;它把已有权重转换并量化为 GGUF 格式,再负责本地推理。** 本文说明本地推理的资源限制、llama.cpp 的量化机制以及同类工具的适用场景。

## 为什么"本地跑模型"这么难

一个 transformer 模型由多组权重矩阵组成:每一层包含 \`W_Q\`、\`W_K\`、\`W_V\`(计算注意力)、\`W_O\`(注意力输出)和 FFN 权重矩阵。推理过程中,输入 token 的向量与这些矩阵相乘。模型大小主要取决于权重数量;7B 模型约有 70 亿个权重。

权重的内存占用取决于每个数值的存储字节数。fp16(半精度浮点)每个权重占 2 字节,因此 70 亿 × 2 字节 = 14GB。除权重外,推理还需要 KV cache 和运行时内存,所以通常需要 32GB 以上内存或 GPU 服务器才能直接运行 fp16 版本。

这是第一个问题:内存。llama.cpp 的做法是把这 14GB 压到 4.5GB——量化。

## 量化:把权重从 2 字节压到 0.5 字节

量化假设推理不需要为每个权重保留完整 fp16 精度。它用更少的比特表示权重,以一定精度损失换取更小的模型体积。

llama.cpp 的核心量化做法(后来整个行业都在用)叫**块量化**。具体机制:

1. 把一组权重分成一小块,通常是 32 个权重为一块(代码里叫 \`QK=32\`);
2. 每个权重存为一个 4bit(半字节)整数,而不是 2 字节浮点数,数值从 \`-7\` 到 \`7\` 分为 15 档;
3. 每个块额外存一个 fp16 的"缩放系数"(scale),代表这一块权重整体的大小。

计算一下:32 个权重,每个 4bit = 16 字节,加上块共享的 2 字节缩放 = 18 字节,平均每个权重 18/32 = 4.5bit ≈ 0.56 字节。7B 模型从 14GB 缩到约 4GB。这就是 Q4_0,llama.cpp 最早的量化格式。

关键机制是:**每个块共享一个缩放系数**。权重内部的相对关系由 4bit 整数保存,块与块之间的尺度差异由 fp16 系数恢复。4bit 量化后,模型困惑度(perplexity,越低越好)通常增加约 0.2-0.5。

后来的量化格式在"块"这个思路上演化:

- **Q8_0**:块内每个权重用 1 字节(int8),8.5bit/权重,体积约 7GB,几乎无损——追求质量时用。
- **k-quants(Q2_K ~ Q6_K)**:块更大(256 个权重),拆成 16 个子块,每个子块有自己的小缩放——让大小差异大的权重(比如注意力层)保留更多精度。Q4_K_M 是社区常用的默认档,4.6GB,质量只比 fp16 差一点。
- **i-quants(IQ1_S ~ IQ4_XS)**:1.5-4.5bit,使用码本(预先计算的 256 个格点)和子块缩放系数,可以把模型压缩到约 2GB。适合在 8GB 内存设备上运行 7B 模型,或在 16GB 设备上运行 13B 模型。
- **imatrix**:量化前使用一批语料运行模型,估计不同权重对输出的重要程度,再为重要权重分配更高精度。该步骤增加约 10 分钟处理时间,用于减少量化损失。

模型文件大小近似等于**权重数量 × 每个权重的字节数**。2 字节(fp16)约为 14GB,1 字节(Q8)约为 7GB,0.5 字节(Q4)约为 4GB,0.25 字节(IQ2)约为 2.5GB。量化档位决定模型体积与精度之间的权衡。

## 为什么模型变小,生成还变快了

直觉上,压缩权重应该只省空间,不省时间。但推理有一个关键事实:**生成速度由内存带宽决定,不是算力。**

原因在解码过程。transformer 生成时一次产生一个 token:

1. 将已有的 token 序列(输入 + 已经生成的)送入模型;
2. 每个 token 的向量,都要跟**所有权重矩阵**做一遍乘法;
3. 算出下一个 token,拼回去,重复。

也就是说,每生成一个 token,权重矩阵要完整地从内存读一遍(实际约两遍——注意力和 FFN 各用一遍)。假设权重 4GB、内存带宽 20GB/s,那么每生成一个 token 要从内存搬约 8GB,20GB/s ÷ 8GB ≈ 每秒 2.5 个 token。内存带宽是瓶颈,不是 GPU 算力。

因此,量化既减少模型的内存占用,也减少每次生成需要从内存读取的数据量。4bit 的 Q4_K_M 通常比 8bit 的 Q8_0 生成更快,原因就是单次读取的字节数更少。

## KV cache:不重复计算的缓存

transformer 推理还有一个大内存开销,叫 KV cache。注意力机制里,每个 token 都会算出自己的 K(键)和 V(值)向量,用于跟其他 token 交互。如果不缓存,生成第 100 个 token 时,前 99 个 token 的 K/V 得全部重新算一遍——推理会变得极慢。

所以 llama.cpp 把已经算过的 K/V 存在内存里,每次生成只算新 token 的那份,旧的直接复用。这个缓存的大小跟上下文长度成正比:上下文 2048 个 token,缓存大约要 1GB(7B 模型 fp16);上下文 8192,就要 4GB。这就是为什么"上下文越长,显存/内存越大"——不是模型变大了,是 KV cache 在增长。llama.cpp 支持把 KV cache 也量化(q8_0 / q4_0),进一步减少占用。

## GGUF:单文件模型格式

先交代清楚"量化是谁做的"。模型发布方(比如 Meta、阿里)在 Hugging Face 上发布的是原始 fp16 权重,不带量化。要得到 Q4_K_M 的 .gguf,需要两步,用的都是 llama.cpp 自带的工具:

1. \`convert_hf_to_gguf.py\`:把 fp16 权重转成 GGUF 格式;
2. \`llama-quantize\`:把 fp16 的 GGUF 压成 Q4_K_M / Q8_0 等档位。

所以你在 Hugging Face 上看到的 \`.gguf\` 文件,基本都是社区用这两个工具生成的。llama.cpp 不训练模型,它只做两件事:**压缩格式**和**本地运行**。

GGUF 格式本身(2023 年 8 月取代旧的 GGML 格式)把所有权重、tokenizer 词汇表、对话模板、超参数全部打成一个自描述的单个文件。单个文件的意义在于它可以直接 \`mmap\`(内存映射)加载——引擎读磁盘上的文件,不用把整个文件拷进内存再解压,按需读入需要的部分。这带来一个关键能力:**端侧部署**。

端侧怎么跑?llama.cpp 的引擎是纯 C/C++ 库,可以交叉编译到 iOS、Android(CMake+NDK)、浏览器(WebGPU/WASM)。部署时把 .gguf 文件放进手机存储或打包进 App 资源,引擎加载时直接 mmap 读文件,不需要额外文件、不需要联网。手机用 CPU 推理,靠 ARM NEON 优化内核。手机内存小,端侧通常选 i-quants 压到 1-2GB 的小模型(比如 3B 量过之后);7B 在 2023 年的 Pixel 5 上是 1 token/s,现在的旗舰机快得多。

## 两套后端:CPU 和 GPU

llama.cpp 的底层是一个叫 **ggml** 的张量库,纯 C/C++、零第三方依赖。它的一个特点:**CPU 也能跑**。它针对不同 CPU 手写了 SIMD 优化内核(AVX2、AVX-512、ARM NEON……),不依赖 CUDA——这是它跟 PyTorch 系最本质的区别:PyTorch 在 CPU 上是"能跑但慢",llama.cpp 在 CPU 上是专门优化的平台。

GPU 也支持,通过后端抽象:CUDA(N 卡)、Metal(苹果)、Vulkan(通用)、SYCL(Intel)等。默认策略是**混合推理**:把部分层放在 GPU 上加速,剩下放 CPU(参数 \`-ngl\` 控制放多少层)。苹果的 Metal 后端让它成了 Apple Silicon 上的常用引擎——M2 Ultra 跑 7B 能达到约 90 token/s。

## OpenAI 兼容的本地 API

llama.cpp 现在主打 \`llama-server\`:本地起一个 HTTP 服务,暴露 OpenAI 兼容的 API——\`/v1/chat/completions\`、\`/v1/embeddings\`、\`/v1/rerank\`(重排,给 RAG 用),还支持工具调用、JSON 结构化输出、约束生成(grammar)。也就是说,把代码里的 \`base_url\` 从 OpenAI 改成 \`http://localhost:8080/v1\`,就能把应用切换到本地模型。这是它生态影响力的来源:Ollama、LM Studio 这些更易用的工具,底层引擎都是它。

## 项目发展

2023 年 3 月,Meta 的 LLaMA 权重泄露。几天内,Georgi Gerganov 使用 C++ 完成移植并命名为 llama.cpp,随后支持 Apple Silicon。一周后,社区在 4GB 内存的树莓派 4 上运行 7B 模型,速度约为 0.1 token/s;Pixel 5 上约为 1 token/s。这些实验说明量化模型可以在消费级与边缘设备上运行。

此后项目加入 GPU 加速、k-quants 量化、KV cache、FlashAttention、投机解码、多模态和工具调用。截至本文记录时间,仓库约有 124k 颗星,支持 215 种模型架构,约有 1900 名贡献者。2025 年,项目从个人账号迁移到 ggml-org 组织;2026 年 2 月,ggml.ai 团队加入 Hugging Face,开源项目仍由独立社区维护。

## 同类型工具:一张表

先澄清一个常见误会:名字带 llama 是因为 2023 年它最初只支持 Meta 的 LLaMA 一个架构,现在支持 215 种,名字没改。下面这些工具也都是多架构的,不是只跑 LLaMA。另外,它们并不是都基于 llama.cpp——表里引擎列写着"自研"的,都是独立实现,只有前两行(Ollama、LM Studio)是包装 llama.cpp 的:

| 工具 | 定位 | 引擎 | 硬件 | 协议 | 特点 |
|---|---|---|---|---|---|
| **llama.cpp** | 推理引擎(基础) | 自研 ggml | CPU+多种 GPU | MIT | 架构与硬件覆盖较广 |
| **Ollama** | 一条命令本地运行 | llama.cpp | 同上 | MIT | 模型仓库+命令即可用 |
| **LM Studio** | 图形界面 | llama.cpp | 同上 | 专有 | 桌面 App、拖拽即用 |
| **vLLM** | 高并发服务 | 自研(PagedAttention) | N 卡为主 | Apache-2.0 | 多用户、吞吐优先 |
| **MLX** | Apple 原生推理 | Apple 自研 | 仅 Apple Silicon | MIT | 苹果上比 llama.cpp 快 |
| **ExLlamaV2** | 单卡高吞吐 | 自研 EXL2 量化 | 仅 N 卡 | MIT | 侧重单卡量化推理 |
| **transformers** | Python 参考实现 | PyTorch | GPU 为主 | Apache-2.0 | 覆盖训练、微调与推理 |
| **WebLLM** | 浏览器内推理 | WebGPU | 任意浏览器 | Apache-2.0 | 浏览器里跑小模型 |

逐一说:

- **Ollama**:在 llama.cpp 之上提供模型下载和 REST API,运行 \`ollama pull llama3\` 即可获取模型。适合不需要调整编译和底层参数的场景。
- **LM Studio**:提供图形界面和本地服务管理。它是闭源应用,底层使用 llama.cpp。
- **vLLM**:面向多用户高吞吐服务,使用 PagedAttention 管理 KV cache,适合服务器集群而不是个人 CPU 推理。
- **MLX**:Apple 官方框架,直接利用统一内存架构(CPU/GPU 共享内存,不用拷贝),在苹果芯片上经常比 llama.cpp 更快。llama.cpp 也支持 Apple,但 MLX 是原生方案。
- **ExLlamaV2**:只支持 NVIDIA GPU,使用 EXL2 量化,侧重单卡生成速度,不支持 CPU 推理。
- **transformers**:Hugging Face 的 Python 参考实现,覆盖训练、微调、推理。本地推理不是它的强项(需要 GPU、PyTorch 依赖重),它是权威参考。
- **WebLLM**:WebGPU 把模型编成浏览器能跑的形式,小模型直接浏览器里推理,适合边缘场景。

选型建议:个人本地跑模型、CPU 或苹果电脑 → llama.cpp(或它上面的 Ollama/LM Studio);要在 N 卡上追求最高速度 → ExLlamaV2;要服务大量并发用户 → vLLM;纯浏览器场景 → WebLLM。

## 榜单怎么读

llama.cpp 自己的 \`llama-bench\` 工具和社区榜单不少,但有两个注意点:

1. **跨工具数字不可直接比**。llama.cpp 默认 Q4_K_M 4bit,ExLlama 用 EXL2,vLLM 测的是批处理吞吐——量的是不同东西。同硬件上比较,先确认量化档、上下文长度、批大小一致。
2. **生成速度和"模型能力"是两回事**。token/s 只反映工程优化,不反映模型本身强不强。榜单数字只回答"这台机器跑这个档位的模型多快",不回答"这个模型好不好"。

## 结论

llama.cpp 使用块量化把 7B 模型从 fp16 的约 14GB 缩小到约 4.5GB,每 32 个权重共享一个缩放系数。生成 token 常受内存带宽限制,因此减少权重字节数也可以提高生成速度。GGUF 单文件格式、CPU/GPU 混合推理、KV cache 和 OpenAI 兼容 API 使其适合本地部署;Ollama 和 LM Studio 也使用它作为底层引擎。Ollama/LM Studio 侧重易用性,ExLlamaV2 侧重 NVIDIA 单卡推理,vLLM 侧重多用户并发,MLX 侧重 Apple Silicon。`,
  takeaway: 'llama.cpp 使用块量化(32 个权重共享一个缩放系数)把 7B 模型从 fp16 的约 14GB 缩小到约 4.5GB。生成 token 常受内存带宽限制,因此量化也可以提高生成速度。项目还提供 GGUF 单文件格式、KV cache、CPU/GPU 混合推理和 OpenAI 兼容 API。Ollama/LM Studio 侧重易用性,ExLlamaV2 侧重 NVIDIA 单卡推理,vLLM 侧重多用户并发,MLX 侧重 Apple Silicon;跨工具榜单需要统一量化档位、上下文长度和批大小后再比较。',
}

export default project
