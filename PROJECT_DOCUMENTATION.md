# alexai - Amazon Alexa for Shopping 信息抓取工具设计文档

## 项目概述

alexai 是 Chrome Manifest V3 扩展，用于批量抓取 Amazon 商品详情页中的 Alexa for Shopping 模块信息，并兼容 `Ask Rufus` 旧页面结构。用户可以导入商品 URL 或 ASIN，扩展按队列动态打开 2-5 个后台窗口，提取 5 个推荐问题/提示、商品上下文和 High Price 价格提示，并导出为 CSV/JSON。High Price 检查读取当前页面实际展示内容，通常需要本机浏览器已登录 Amazon 账号。

## 需求

- 支持每行输入一个商品 URL 或 ASIN
- 支持 Amazon 商品页路径：`/dp/{ASIN}`、`/{slug}/dp/{ASIN}`、`/gp/product/{ASIN}`
- 提取商品上下文：ASIN、标题、品牌、评分、评价数
- 提取价格标识：例如 Amazon `High price`；该信息可能依赖本机 Amazon 登录状态、地区、账号画像和页面实验
- 提取 Alexa for Shopping/Rufus 模块中的 5 个推荐问题/提示，过滤 `Ask something else`
- 支持 Amazon 搜索页主图下载：搜索结果主图右侧外沿注入 `DL` 大图按钮和 `XL` 当前缩略图按钮
- 支持 Amazon 商品详情页图片下载：商品图和 `Reviews with images` 评价图显示 `DL`/`XL` 按钮，并支持直接点击商品图下载较大尺寸图片
- 支持 Amazon 商品详情页视频下载：识别 VSE/Product Videos 中的 `videoURL` 和页面已渲染的 Amazon `<video>`，注入 `VID` 按钮，并合并常见 HLS/m3u8 分片
- 支持 Popup 下载按钮设置：可关闭页面图片/视频检测，也可选择按钮直接显示或不显示
- 保留动态并发队列、暂停/继续、停止、断点续传、失败重试
- 自动导出 CSV，支持手动导出 JSON

## 架构

| 模块 | 职责 |
|------|------|
| Popup | URL/ASIN 导入、配置、图片/视频下载按钮设置、状态展示、导出 |
| Background Service Worker | 队列状态、标签页生命周期、动态等待、页面内提取 |
| Content Script | 商品页状态指示器、备用页面内提取入口、搜索页/详情页图片下载入口、商品视频下载入口、下载按钮设置响应 |
| Chrome Storage | 保存 URL、配置、下载按钮设置、进度、已抓取数据 |

## 图片下载流程

1. Content Script 在 Amazon 搜索页识别 `.s-result-item` 中的主图，并在图片容器右侧外沿注入 `DL` 和 `XL` 按钮。
2. Content Script 在商品详情页识别商品图区域、高级 A+ 图和 `Reviews with images` 评价图，注入 `DL` 和 `XL` 按钮，并给商品图绑定点击下载事件。
3. 图片右侧外沿空间不足时，Content Script 给图片容器添加内缘兜底 class，把按钮收回到图片右内缘；A+ 轮播中横向不可见的侧边图会隐藏按钮。
4. 点击下载后，Content Script 从 `data-a-dynamic-image`、`srcset`、`data-old-hires`、`data-src`、`currentSrc`、`src` 提取候选 URL。
5. 对 Amazon 缩略图 URL 生成无尺寸修饰、`SL2000`、`SL1500` 等高分辨率候选，并用浏览器图片加载结果选择实际可加载尺寸最大的候选。
6. 点击 `XL` 时，Content Script 直接使用当前图片元素的 `currentSrc`/`src`/`data-src` 缩略图 URL，不做大图放大。
7. Popup 将 `imageDownloadSettings` 写入 `chrome.storage.local`；Content Script 监听该设置，关闭检测时移除已注入控件，切换“直接显示 / 不显示”时更新根节点 class。
8. Content Script 将最终图片 URL 和文件名发送给 Background Service Worker。
9. Background 使用 `chrome.downloads.download` 保存到 `Downloads/amazon-images/`，并用 `uniquify` 避免重名覆盖。

## 视频下载流程

1. Content Script 只在 Amazon 商品详情页扫描 `videoURL`、`videoSrc`、`.m3u8`、`.mp4`、页面 `<video>` 等 Amazon 媒体 URL，过滤 `videopreview` 和 `gandalf_preview` 这类预览片段。
2. 从同一段 Amazon VSE/Product Videos JSON 上下文或 `<video>` 所在商品卡读取标题、作者、时长和缩略图信息，并用 URL 去重。
3. Content Script 用视频 URL、asset key、标题、作者或缩略图物理 ID 匹配页面中的真实视频画面，在视频右下角注入 `VID` 按钮。
4. 如果页面实验导致卡片无法精确匹配，则不注入按钮，避免把下载入口放到错误视频或整块容器上。
5. 点击下载后，如果来源是 MP4/WebM，直接 fetch 为 Blob 并触发浏览器下载。
6. 如果来源是 m3u8，先解析 master playlist，选择最高分辨率/最高带宽的媒体 playlist。
7. 解析媒体 playlist 后顺序下载 init segment 和媒体分片，合并为本地 Blob；TS 分片保存为 `.ts`，fMP4 分片保存为 `.mp4`。
8. 加密 HLS 不做绕过，遇到 `#EXT-X-KEY` 且非 `METHOD=NONE` 时直接报错。

## 数据流

1. 用户在 Popup 中输入 URL/ASIN
2. `popup.js` 标准化为 Amazon 商品 URL
3. 用户点击开始，Popup 向 Background 发送 `start`
4. Background 抽取 2-5 个目标并发窗口数并创建后台标签页
5. Background 不等待页面 `complete`，而是轮询注入 `extractProductRufusData()`
6. 单页提取到 Alexa for Shopping/Rufus 或商品上下文后立即关闭当前窗口
7. 调度器按随机延迟补充新窗口，并在 2-5 范围内动态调整目标并发
8. 结果写入队列数据并保存到 `chrome.storage.local`
9. Popup 接收进度消息并刷新 UI
10. 任务完成后自动导出 CSV

## 导出字段

| 字段 | 说明 |
|------|------|
| ASIN | 商品 ASIN |
| 商品标题 | `#productTitle` 或页面标题 |
| 品牌 | `#bylineInfo` 或品牌属性 |
| 评分 | 商品星级 |
| 评价数 | 商品评价数量 |
| 价格标识 | Amazon 价格洞察标识，例如 `High price` |
| 是否High price | 是否检测到 `High price` |
| 问题1 | Alexa for Shopping/Rufus 第 1 个推荐问题/提示，不包含 `Ask something else` |
| 问题2 | Alexa for Shopping/Rufus 第 2 个推荐问题/提示 |
| 问题3 | Alexa for Shopping/Rufus 第 3 个推荐问题/提示 |
| 问题4 | Alexa for Shopping/Rufus 第 4 个推荐问题/提示 |
| 问题5 | Alexa for Shopping/Rufus 第 5 个推荐问题/提示 |
| URL | 抓取链接 |
| 抓取时间 | ISO 时间戳 |

## 风险

- Alexa for Shopping 是动态/个性化模块，不是每个用户、地区、商品都展示。
- High Price 是 Amazon 页面动态展示的价格提示，不是稳定公开字段；未登录本机 Amazon 账号、账号地区不匹配或页面实验未命中时可能无法检测。
- Amazon 页面 DOM 可能仍保留 Rufus 旧命名，提取层保留 Rufus 选择器和数据属性以兼容旧结构。
- Amazon DOM 可能调整，提取逻辑需要通过多选择器和文本回退保持弹性。
- Amazon 视频通常是 HLS；当前实现合并未加密 VOD 分片，不转码、不封装为标准 MP4。需要标准 MP4 时应在下载后用 ffmpeg 转封装。
- 已按 `example/Lightdot 4Pack 200W LED Wall Pack Lights.html` 校准真实旧 Rufus 结构：`#dpx-nice-widget-container`、`.small-widget-pill`、`data-dpx-rufus-connect.query`。
- 过高频率可能触发验证或限制，应保留随机补位延迟和批次休息。

## 免责声明

- 本项目仅用于学习研究和个人数据整理，不保证 Amazon 页面数据、High Price 状态或 Alexa for Shopping/Rufus 提示长期可用。
- 使用者需自行遵守 Amazon 网站使用条款、账号规则、访问频率限制以及相关法律法规。
- 本项目不提供 Amazon 登录能力，不绕过登录、风控、验证码、权限或地区限制；需要登录后展示的数据必须由使用者在本机浏览器中自行登录后访问。
- 因使用本项目造成的账号限制、访问失败、数据误判、业务损失或第三方争议，由使用者自行承担责任。
