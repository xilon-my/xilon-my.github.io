const project = {
  slug: 'mineru',
  date: '2026-08-17 16:20',
  name: 'MinerU: Inside the PDF-to-Markdown Pipeline',
  url: 'https://github.com/opendatalab/MinerU',
  url2: 'https://github.com/opendatalab/PDF-Extract-Kit',
  description: 'MinerU 怎么把一篇 PDF 变成干净的 Markdown:一条八道工序的管线,OCR 只是其中一道。先分清"数字出生"和"扫描件",再拆管线——版面检测、公式识别、表格重建、阅读顺序;OCR 那一步具体是检测加识别两步,引擎其实是 PaddleOCR 的 PyTorch 移植版。最后一张表看同类型工具(Marker / Docling / PaddleOCR / PyMuPDF / Nougat / Zerox / 云服务)怎么选。',
  tags: ['RAG'],
  stars: '77.8k',
  author: 'Shannon',
  detail:
`你手头有一批扫描版论文 PDF 要喂给 RAG:页面是图片,里面有正文、公式和表格,而检索要的是干净的文本。有人告诉你用 MinerU——\`pip install mineru\`,一行命令,吐出一份 Markdown。这一行命令背后其实是一条完整的解析管线,"OCR"只是其中一道工序。

这篇文章拆三件事:MinerU 把 PDF 变成 Markdown 的完整管线、"OCR"这一环具体怎么做、以及同类型工具有哪些、各自怎么选。

## MinerU 是谁

MinerU 出自 OpenDataLab(上海 AI Lab 的开放数据平台),最初是 InternLM 预训练时为了解决"把论文里的公式符号转成干净文本"而做的。GitHub 上约 7.8 万星(2026-08),是文档解析领域最活跃的项目之一。

它解决的是:把 PDF(以及图片、DOCX、PPTX、XLSX、网页)变成机器可读的 Markdown / JSON,供 LLM、RAG、Agent 下游使用。难点不在"读字",而在"读懂版面":去掉页眉页脚页码、按人类阅读顺序重排、处理多栏、把公式转成 LaTeX、把表格转成 HTML、自动识别扫描件并触发 OCR。

版本上值得知道一点:老版本(1.x)包名叫 magic-pdf,2.0(2025-06)才是现在的 MinerU——重写、改名、拆掉旧依赖、引入 VLM 后端;3.x 又加了原生 DOCX 解析、换了开源协议(从 AGPL 换成基于 Apache-2.0 的自定义协议)。最新 3.4.5。

还有一个前提要先说清楚:**OCR 不是对每个 PDF 都做的。**

## PDF 有两种:OCR 只对扫描件做

一个 PDF 可能是"数字出生"的——里面有真实的文本层,文字直接存成字符,只是排版复杂;也可能是"扫描"的——本质是一堆图片,页面上没有文本,只有像素。

MinerU 的第一步不是解析,是分类:自动采样前 10 页,用几条启发式判断这是"有文本层的"还是"需要 OCR 的"——提取出的字符数(阈值 50)、字形是否乱码(CID 字体)、图片覆盖率是否超过 80%。判断错了也能手动指定 \`-m txt\` / \`-m ocr\`。

这个分类决定后面的路:文本层好的 PDF 直接走文本提取,不会碰 OCR;只有扫描件 / 乱码件进入 OCR 流程。所以"MinerU 怎么做 OCR",准确说法是"MinerU 在扫描件上怎么做 OCR"。

## 解析管线:八道工序

一条 PDF 从进来到出去过八道工序。扫描件走全流程,数字件跳过 OCR 那几道。先放一张总览,再逐个拆:

| 工序 | 干什么 | 输出 | 扫描件 | 数字件 |
|---|---|---|---|---|
| 0. 分类 | 判断 PDF 有文本层还是要 OCR | txt / ocr 两条路 | 走 OCR | 走文本 |
| 1. 渲染 / 提文本 | 扫描页渲染成图片,数字页提取文本层 | 页面图像 / 文本 | ✓ | ✓ |
| 2. 版面检测 | 目标检测标出每块区域(标题/正文/表格/公式…) | 带标签的块 + 阅读序 | ✓ | ✓ |
| 3. 块→行→span | 组织成三层结构 | 结构化块 | ✓ | ✓ |
| 4. 公式识别 | 公式框识别成 LaTeX | \`$...$\` / \`$$...$$\` | ✓ | ✓ |
| 5. OCR | 扫描页正文读字(检测+识别) | 正文文本 | ✓ | ✗ |
| 6. 表格 | 有线/无线分类后重建 | HTML \`<table>\` | ✓ | ✓ |
| 7. 后处理 | 阅读排序、跨页合表、去页眉页脚 | 干净的块序列 | ✓ | ✓ |
| 8. 生成 | 输出 Markdown / JSON | mm.md / nlp.md / json | ✓ | ✓ |

下面按工序讲。

### 1. 渲染,或提取文本层

数字 PDF 直接从内容流里提出文本(pdfminer / pypdf),不渲染。扫描 PDF 先把每一页渲染成图片(pypdfium2/pdfium,2.0 起不再用 pymupdf),后面的版面检测、OCR 全在图片上做。

### 2. 版面检测:认出每块是什么

这是管线里最关键的一步,本质是一个目标检测模型,在页面上框出每个区域并打上标签:标题、正文、表格、图片、图表、页眉、页脚、脚注、页码、行间公式、行内公式、公式编号、竖排文字。1.x/2.x 用 DocLayout-YOLO,3.0 起换成 PaddleOCR 系的 PP-DocLayoutV2。这一步决定每块内容后面交给哪个模块。

### 3. 块 → 行 → span:三层结构

检测出的框按三层组织:块(正文 / 标题 / 表格 / 公式)→ 行 → span(最小单元,带类型:text / inline_equation / interline_equation / image)。span 按从左到右并成行、行按从上到下并成块;竖排文字有单独的兜底。这一步让后面生成 Markdown 时,每一层都能映射到对应的语法。

### 4. 公式:检测后识别成 LaTeX

公式被单拎出来,因为"公式识别"和"正文 OCR"是两个不同的模型。版面检测标出的公式框(行间、行内)裁剪出来,送进专门的公式识别模型,输出 LaTeX——默认 UniMERNet;开 MINERU_FORMULA_CH_SUPPORT 时用 PP-FormulaNet-Plus-M,支持中文公式。行内公式变成 \`$x^2$\`,行间公式变成 \`$$...$$\`;公式编号有专门的后处理,避免污染 Markdown。

关键细节,后面 OCR 一节会再提到:**公式区域在进入 OCR 之前先被遮掉**,这样 OCR 的检测阶段不会把公式当正文读。公式交给公式模型,正文交给 OCR,互不干扰。

### 5. OCR:扫描件的读字环节

扫描页上,正文区域的图片被送进 OCR 引擎:先检测(输出每个文本行的多边形框),再把每个框旋转扶正、裁剪,送进识别模型,输出这一行的字符;最后合并、排序。这一环用的引擎是 PaddleOCR——细节和它跟 PaddlePaddle 的关系,下一节单独讲。

### 6. 表格:有线无线两条路

表格也是单拎出来的难点。检测出表格框后先分类:有线表(有可见网格线)还是无线表(只有排版没有线)。

- 无线表:SLANet+ 直接预测 HTML 结构 + 单元格位置,再用 OCR 填充每个单元格。
- 有线表:TSRUnet 先检测横线竖线,拼出行 × 列网格,再逐格 OCR,最后重建 HTML。

旋转过的表格(0 / 90 / 270 度)有专门的方向分类器处理。输出是原样 HTML \`<table>\`,保留 rowspan / colspan。

### 7. 阅读顺序 + 后处理

块按阅读顺序排序(1.x/2.x 用专门的 LayoutReader 模型 + XY-Cut;3.0 起靠版面索引 + 启发式)。然后收尾:段落合并、跨页表格合并(默认开)、丢弃页眉页脚脚注页码。这一步是"读字"之外最容易出错的地方——读对了字、排错了序,Markdown 照样是乱的。

### 8. 生成 Markdown / JSON

按阅读顺序走一遍,生成四种产物:

- Markdown:mm 版(多模态,内嵌提取出的图片)和 nlp 版(纯文本 + LaTeX 公式 + HTML 表格);
- content_list.json:结构化的可读块列表,带类型和层级;
- middle.json / model.json:中间产物和原始模型输出(每块的标签 / 分数 / 框 / 阅读序);
- images/:提取出的图片、表格裁剪、公式裁剪。

下游 RAG 各取所需:喂 LLM 用 Markdown,结构化解析用 JSON。

## OCR 怎么"读"字

OCR 拆成两步——检测和识别。两个不同的模型,不是一件事。

**检测**:在页面上找出"哪里有文字"。DBNet 输出每个文本行的多边形框(注意是整行的框,不是单词框)。这一步要能扛住图片里的噪声、背景、印章。

**识别**:把每个框里的字读出来。先按多边形的角度把框旋转扶正(rotate-crop),再送进识别模型,输出一串字符。识别模型本质是一个序列模型:输入一行像素,输出一行文本。

**合并排序**:识别完的框按阅读顺序合并、排序。

两个反直觉的点:

1. 公式区先遮掉:OCR 检测之前,公式区域先被 mask 掉(代码里叫 mask_formula_regions_for_ocr_det),OCR 不会把公式当正文读;公式框由第 4 道的公式模型单独处理。
2. 引擎是 PaddleOCR,但不是 PaddlePaddle:MinerU 管线后端的 OCR 用的是百度 PaddleOCR 的模型权重,通过 PaddleOCR2PyTorch 移植版跑在 PyTorch/ONNX 上,不是装在 PaddlePaddle 框架里。当前(3.4)是 PP-OCRv6:中文一个 ch 模型,多语种走 PP-OCRv5 / PP-OCRv3,合计 109 种语言。所以"MinerU 自研了 OCR 模型"不准确——它自研的是怎么把这些模型组织成一条管线。

## 为什么还有一个 VLM 引擎

上面讲的是 pipeline 引擎。MinerU 有两套引擎,这是 2.0 重写之后的事:

- pipeline(传统多模型栈):上面八道工序,每一步一个专门的小模型(版面、OCR、公式、表格)。CPU 就能跑(4GB 显存或纯 CPU),每步可解释、可单独调参。代价是每步都可能错,误差逐层累积。
- vlm / hybrid(端到端 VLM):自研的 MinerU2.5-Pro,1.2B 参数的视觉语言模型。一个模型把版面、正文、公式、表格一次全读出来,直接吐文本 + LaTeX + HTML 表格——和 Zerox 这类"VLM 当 OCR"的思路一致,但是本地可跑、可微调。Pro 版用 6550 万样本的数据引擎 + GRPO 训练,OmniDocBench 拿到 95.69。hybrid 是两者配合:pipeline 兜底 + VLM 精读复杂区域。

怎么选:要准(旋转表、无线表、复杂长公式、中英混排)→ VLM / hybrid,但要 8GB 显存;要省、要 CPU、要可控 → pipeline。OmniDocBench 上 pipeline 86.47、VLM 95+,差 9 分,代价是显存和速度——3.3 的 effort=medium 模式说掉 0.13 分换 35%～220% 提速。

## 同类型工具:一张表

文档解析这两年挤成一个赛道,关键工具都在这张表里:

| 工具 | 出身 | 怎么做 | 中文 | 公式 | 速度 | 协议 |
|---|---|---|---|---|---|---|
| **MinerU** | OpenDataLab | 传统管线 + 自研 VLM | 优秀(109 语) | 强(LaTeX) | 中 | Apache-2.0 定制 |
| **PaddleOCR** | 百度 | PP-OCRv6 + 结构解析 + VLM | 最强 | 强 | 快 | Apache-2.0 |
| **Marker** | Datalab | Surya VLM + 布局小模型 | 好(多语 VLM) | 中(KaTeX) | 快(约 5x) | 代码开源 / 权重受限 |
| **Surya** | Datalab | 单一 650M VLM | 好(zh 82.5%) | 中 | 很快 | 代码开源 / 权重受限 |
| **Docling** | IBM | DocLayNet + TableFormer | 中(靠后端) | 只检测 | 中 | MIT |
| **PyMuPDF** | Artifex | 规则提取,无 ML | 好(文本层) | 无 | 最快 | AGPL |
| **unstructured** | Unstructured | pdfminer + 布局模型 | 中 | 无 | 快 | Apache-2.0 |
| **Nougat** | Meta | Donut 式 VLM | 无(仅英文) | 强(学术) | 慢 | MIT / CC-BY-NC |
| **Zerox** | OmniAI | 每页一个云 VLM | 好 | 看 VLM | 云延迟 | MIT |
| **Mathpix / Textract / Document AI** | 商业 | 云 OCR | 好 | Mathpix 最强 | 云 | 商业 |

表后的取舍,按工具一句话点透:

- **Marker**:当前最快的开源管线,吞吐约 MinerU 的 5 倍;但权重用 Open Rail-M 协议,融资超 500 万美元要付费,公式走 KaTeX 不如 UniMERNet。要吞吐选它。
- **Surya**:Marker 的引擎,单一 650M VLM 干全部活,部署最简单;短板是权重许可和中文略逊。
- **Docling**:MIT、格式覆盖最广、生态最完整(连 MCP server 都有),但公式只检测不识别、OCR 分数低。要企业级格式选它,要公式精度别选。
- **PaddleOCR**:MinerU 的 OCR 引擎来源,中文最强、协议最干净(Apache-2.0),PaddleOCR-VL 在 OmniDocBench 反超 MinerU;但要自己拼完整管线。
- **PyMuPDF**:无 ML 的规则提取,数字出生 PDF 的最快选择,但没公式,扫描件要外接 Tesseract。
- **unstructured**:企业 RAG 最常见的接入库,但布局模型偏旧,公司已转向 SaaS。
- **Nougat**:学术论文专用、公式强,但只支持英文、权重非商用、已停更——当历史看。
- **Zerox**:每页调一次云 VLM,实现极简、效果随云端模型走;但每页数据都出域,私有数据直接出局。MinerU 的 VLM 引擎相当于把它本地化了。
- **云服务**:零运维、弹性,代价是数据出域、按页付费。Mathpix 公式最强,Textract 表单强,Document AI 语言最全;批量处理前先想清楚数据能不能出域。

## 中文场景怎么选

1. 中文学术 / 技术 PDF,公式表格多,有 GPU → MinerU VLM / hybrid,或 PaddleOCR-VL。公式识别和中文 OCR 都在第一梯队。
2. 只要吞吐、要快,公式少 → Marker。代价是权重许可紧一档。
3. 格式杂(DOCX / PPTX / HTML 混着来)、要 MIT、要生态 → Docling。
4. 数字出生的干净 PDF,不 OCR → PyMuPDF,别上 MinerU。
5. 数据敏感,不能出域 → 本地开源,排除一切云服务。

## 榜单怎么读,坑在哪里

榜单要分开读。MinerU 官方引的是 OmniDocBench(MinerU2.5-Pro 95.69、pipeline 86.47),Marker 官方引的是 olmOCR-bench(Marker 76.0、MinerU pipeline 72.7)。两个榜单语料和指标不同,跨榜数字不可直接比——"谁第一"先问一句"哪个榜"再信。而且两榜都是英语为主的论文语料,中文效果要拿自己的语料实测。

坑是真实的,挑最常见的几条:

- 依赖重:pipeline 依赖 detectron2,在 Windows 和新版 CUDA 上安装是著名痛点;默认安装还是 CPU 版 PyTorch,要 GPU 得手动重装 CUDA 轮子。
- 表格慢:开了表格识别后可能极慢(社区反馈一个 4.5MB PDF 半小时);复杂长表 VLM 引擎也吃力。
- 模型下载:权重默认从 HuggingFace 下,国内网络常连不上,得配 ModelScope 镜像;模型文件共约 3-5GB。
- VLM 会幻觉:端到端模型偶尔把字符认错(比如 "prefill" 认成 "prefetch"),pipeline 每步独立、幻觉面更小。
- 复杂版面误判:多栏扫描件可能把右栏正文当页脚,竖排、90 度旋转表格是已知短板。
- 稳定性:大文件偶发 segfault / 内存问题。

这些坑不致命,但"一行命令"背后是上面八道工序,每一道都可能翻车——排错时按工序逐个排查更有效。

## 结论

MinerU 不是"一个 OCR 工具",而是一条八道工序的文档解析管线,OCR 只是其中一环、且只对扫描件生效;OCR 那一环是"检测 + 识别"两步,引擎借用 PaddleOCR 经 PyTorch 移植来跑。同类型工具各有取舍:要快选 Marker、要格式和 MIT 选 Docling、要中文和干净许可选 PaddleOCR、数字 PDF 直接 PyMuPDF。选型看两件事:文档是数字出生还是扫描件、公式表格有多难。这两点定下来,工具就选得出来了。`,
  takeaway: 'MinerU 不是"一个 OCR 工具",而是一条把 PDF 变成干净 Markdown 的八道工序管线——分类(扫描件才 OCR)、渲染/提文本、版面检测、块行 span、公式识别成 LaTeX、OCR(检测+识别两步)、表格重建、阅读顺序与后处理。OCR 只在扫描件上触发,引擎是 PaddleOCR 的 PyTorch 移植版,公式区先遮掉不与正文混读;另有自研 VLM 引擎做端到端解析(更准但要 8GB 显存)。同类型工具:要吞吐选 Marker、要格式覆盖和 MIT 选 Docling、要中文和 Apache-2.0 选 PaddleOCR、数字出生 PDF 直接 PyMuPDF;跨榜数字(OmniDocBench vs olmOCR-bench)不可直接比。',
}

export default project
