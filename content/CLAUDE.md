# Content 模块文档

Content 模块位于 `content/content.js`，在 Amazon 商品详情页和搜索页注入页面下载能力。

## 职责

- 判断当前页面是否为商品页
- 在页面右下角显示可展开的 `A` 设置入口，直接调整图片/视频按钮开关、显示方式和图片清晰度
- 默认仅创建高清下载按钮；大视频使用更大的下载按钮
- 监听 DOM 变化并缓存 `window.amazonRufusLastData`
- 暴露 `window.amazonRufusExtractData()` 作为手动调试入口
- 响应 `extractRufusData` 和兼容的 `extractData` 消息

后台正式抓取主要使用 `background/background.js` 中注入的 `extractProductRufusData()`，Content 模块负责页面增强和备用提取。Alexa / Rufus 抓取的高级版授权由 Popup 展示、Background 激活和复验，Content Script 不接触授权码。底层 Rufus 命名保留用于兼容 Amazon 旧 DOM 结构。
