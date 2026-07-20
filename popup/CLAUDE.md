# Popup 模块文档

Popup 模块是扩展界面层，包含 `popup/popup.html`、`popup/popup.css`、`popup/popup.js`。

## 职责

- 接收 Amazon 商品 URL 或 ASIN
- 将 ASIN 标准化为 `https://www.amazon.com/dp/{ASIN}?th=1`
- 校验商品 URL 路径
- 管理延迟、2-5 并发窗口、批次、访问节奏、重试配置
- 在“链接巡查”模式中保存授权码、服务地址并调用专业版巡查 API
- 与页面右下角入口同步图片/视频按钮开关、直接/悬停显示和高清/标清设置
- 展示抓取进度和统计，以及链接巡查结果
- 导出带 `问题1` 到 `问题5` 固定列的 CSV/JSON，默认文件名为 `alexai_data`

## URL 支持

- `https://www.amazon.com/dp/B0D2R3KRFN?th=1`
- `https://www.amazon.com/{slug}/dp/B0D2R3KRFN/...`
- `https://www.amazon.com/gp/product/B0D2R3KRFN`
- `B0D2R3KRFN`

其他 Amazon 站点只要是 `amazon.*` 商品路径也会通过校验。
