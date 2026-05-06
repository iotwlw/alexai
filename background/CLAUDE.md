# Background 模块文档

Background 模块是扩展的队列和抓取核心，位于 `background/background.js`。

## 职责

- 管理 pending/processing/completed/failed 队列
- 创建后台商品页标签页
- 等待页面加载和 Rufus 动态内容首轮渲染
- 注入 `extractProductRufusData()` 提取页面数据
- 保存进度到 `chrome.storage.local`
- 向 Popup 发送进度和完成消息

## 关键函数

| 函数 | 说明 |
|------|------|
| `extractAsinFromUrl(url)` | 从商品 URL 中提取 ASIN |
| `waitForProductContent(tabId)` | 等待商品标题或 Rufus 模块出现 |
| `processUrl(url)` | 处理单个商品 URL |
| `extractProductRufusData()` | 在页面上下文中执行的提取函数 |
| `extractSmidgetPrompts()` | 优先提取真实商品页 `#dpx-nice-widget-container` 中的 Rufus 按钮 |
| `processBatch()` | 按批次处理 URL 队列 |
| `startScraping()` | 初始化或恢复抓取任务 |

## 成功条件

单页结果至少需要提取到以下任意一项：

- ASIN
- 商品标题
- Rufus 模块或 Rufus 按钮

未展示 Rufus 的商品页也会作为成功结果导出，并标记 `rufusFound=false`。
