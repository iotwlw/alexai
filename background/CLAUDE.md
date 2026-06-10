# Background 模块文档

Background 模块是扩展的队列和抓取核心，位于 `background/background.js`。

## 职责

- 管理 pending/processing/completed/failed 队列
- 动态维持 2-5 个后台商品页窗口
- 不等待页面 complete，轮询到可提取数据后立即关闭窗口
- 注入 `extractProductRufusData()` 提取 Alexa for Shopping/Rufus 页面数据
- 保存进度到 `chrome.storage.local`
- 向 Popup 发送进度和完成消息

## 关键函数

| 函数 | 说明 |
|------|------|
| `extractAsinFromUrl(url)` | 从商品 URL 中提取 ASIN |
| `extractWhenAvailable(tabId)` | 轮询页面，提取到 Alexa for Shopping/Rufus 或商品上下文后立即返回 |
| `processUrl(url)` | 处理单个商品 URL |
| `extractProductRufusData()` | 在页面上下文中执行的提取函数 |
| `extractPriceInsight()` | 检测 `High price` 等价格标识 |
| `extractSmidgetPrompts()` | 优先提取真实商品页 `#dpx-nice-widget-container` 中的 Rufus/Alexa 兼容按钮 |
| `startQueueScheduler()` | 启动 2-5 窗口动态并发调度器 |
| `runQueueScheduler()` | 根据目标窗口数、随机延迟和批次休息补充新窗口 |
| `startScraping()` | 初始化或恢复抓取任务 |

## 成功条件

单页结果至少需要提取到以下任意一项：

- ASIN
- 商品标题
- Alexa for Shopping/Rufus 模块或按钮

未展示 Alexa for Shopping/Rufus 的商品页也会作为成功结果导出，导出层会将 `问题1` 到 `问题5` 留空。
