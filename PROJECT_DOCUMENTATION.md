# alexai - Amazon Alexa for Shopping 信息抓取工具设计文档

## 项目概述

alexai 是 Chrome Manifest V3 扩展，用于批量抓取 Amazon 商品详情页中的 Alexa for Shopping 模块信息，并兼容 `Ask Rufus` 旧页面结构。用户可以导入商品 URL 或 ASIN，扩展按队列动态打开 2-5 个后台窗口，提取 5 个推荐问题/提示、商品上下文和 High Price 价格提示，并导出为 CSV/JSON。High Price 检查读取当前页面实际展示内容，通常需要本机浏览器已登录 Amazon 账号。

## 需求

- 支持每行输入一个商品 URL 或 ASIN
- 支持 Amazon 商品页路径：`/dp/{ASIN}`、`/{slug}/dp/{ASIN}`、`/gp/product/{ASIN}`
- 提取商品上下文：ASIN、标题、品牌、评分、评价数
- 提取价格标识：例如 Amazon `High price`；该信息可能依赖本机 Amazon 登录状态、地区、账号画像和页面实验
- 提取 Alexa for Shopping/Rufus 模块中的 5 个推荐问题/提示，过滤 `Ask something else`
- 保留动态并发队列、暂停/继续、停止、断点续传、失败重试
- 自动导出 CSV，支持手动导出 JSON

## 架构

| 模块 | 职责 |
|------|------|
| Popup | URL/ASIN 导入、配置、状态展示、导出 |
| Background Service Worker | 队列状态、标签页生命周期、动态等待、页面内提取 |
| Content Script | 商品页状态指示器、备用页面内提取入口 |
| Chrome Storage | 保存 URL、配置、进度、已抓取数据 |

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
- 已按 `example/Lightdot 4Pack 200W LED Wall Pack Lights.html` 校准真实旧 Rufus 结构：`#dpx-nice-widget-container`、`.small-widget-pill`、`data-dpx-rufus-connect.query`。
- 过高频率可能触发验证或限制，应保留随机补位延迟和批次休息。

## 免责声明

- 本项目仅用于学习研究和个人数据整理，不保证 Amazon 页面数据、High Price 状态或 Alexa for Shopping/Rufus 提示长期可用。
- 使用者需自行遵守 Amazon 网站使用条款、账号规则、访问频率限制以及相关法律法规。
- 本项目不提供 Amazon 登录能力，不绕过登录、风控、验证码、权限或地区限制；需要登录后展示的数据必须由使用者在本机浏览器中自行登录后访问。
- 因使用本项目造成的账号限制、访问失败、数据误判、业务损失或第三方争议，由使用者自行承担责任。
