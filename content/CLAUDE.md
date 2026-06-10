# Content 模块文档

Content 模块位于 `content/content.js`，只在 Amazon 商品详情页注入。

## 职责

- 判断当前页面是否为商品页
- 在页面右下角显示 `alexai Ready` 状态指示器
- 监听 DOM 变化并缓存 `window.amazonRufusLastData`
- 暴露 `window.amazonRufusExtractData()` 作为手动调试入口
- 响应 `extractRufusData` 和兼容的 `extractData` 消息

后台正式抓取主要使用 `background/background.js` 中注入的 `extractProductRufusData()`，Content 模块负责页面增强和备用提取。底层 Rufus 命名保留用于兼容 Amazon 旧 DOM 结构。
