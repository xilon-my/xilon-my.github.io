# shannon.github.io — 站点约定

个人站(部署在 xilon-my.github.io / Vercel),React + Vite + 终端风格。改这个仓库前先读,写作和改结构都要遵守。

## 写作风格:平实,不油腻

站内文章(Blog 文章 + Discover 项目页)要求**平实、克制、教科书式**:先给具体例子,再上公式,符号逐个解释来源;术语不预设读者知道。范本是 grid world 三篇(bellman / monte-carlo / temporal-difference)。

**禁止的油腻表达**(过去出现过,已清除,不许再写):

| 油腻 | 换成 |
|---|---|
| 天花板 | 上限 / 瓶颈 |
| 烧钱 | 成本 |
| 无脑 | 直接 / 机械 |
| 翻车 | 失败 / 出错 |
| 搞定 | 实现 / 解决 |
| 白搭 | 也没用 |
| 离谱 | 过高 / 难以接受 |
| 爆炸(形容大) | 极高 |
| 极致 | 充分 / 最大限度 |
| 一键 | 一条命令 |
| 埋钩子 / 埋一句 | 提一句 / 先说 |
| 完美解决 | 问题解决 |
| 一句话:(口头禅) | 简言之: |
| 有意思的是 | 值得注意的是 |
| 骗分 | 骗取奖励 |
| 安全带(比喻) | 防线 |

**同样禁止**:夸张词(极好/超强/无敌/惊艳/震撼/惊人)、反问煽动(`还记得…吗` / `你想…吗` / `你就能…`)、俏皮比喻(看走眼/钻空子)、emoji 和表情符号、波浪号、连续感叹号。

**写法原则**:
- 具体 → 公式 → 具体;每个符号从"为什么存在"讲起
- 不用反问句作强调,直接陈述
- 中文句子用中文标点;公式里不写中文

## 站点结构(设计约束)

- **一页一个 Terminal**:每页是一个 shell 会话,只有一个 Terminal 窗口(title 形如 `shannon@shannon.zone ~/<dir> %`)。所有内容堆在同一个 Terminal 里,不要为分区再开第二个 Terminal。
- **Blog = 文件系统**:`/blog` 是根目录(`ls` 列表),子目录是课程系列(如 `rl-math/` 在 `/blog/rl-math`);文章页 `cd ..` 按所在目录回退。文章文件在 `src/pages/Blog/articles/`。
- **Tag 统一词汇表**:全站只有 `RL / RAG / agent / Inference / Course`,每篇文章/项目**恰好一个 tag**。新增内容先对齐这套词汇,别发明新 tag。
- **Discover vs Blog 的分工**:Discover 只放"有明确 GitHub 项目的工具"(有 github url + stars);论文笔记、概念讲解、无仓库的文章一律放 Blog。
- **图片**:放 `public/images/`,路径 `/images/...`。详情页(文章和项目)统一用 DiscoverDetail 的布局和 `discover-detail-*` 样式。
- **一页一个 shell 会话内的命令区**用 `.term-divider` 分隔;列表页的 tag 显示用 `[tag]` 括号风格。
