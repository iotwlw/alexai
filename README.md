# alexai - Amazon Alexa for Shopping 信息抓取工具

> 批量抓取 Amazon 商品页中的 Alexa for Shopping 提示按钮，兼容 Ask Rufus 旧页面结构，支持 High Price 检查、图片/视频下载、断点续传、自动重试、CSV/JSON 导出。

## 功能

| 功能 | 说明 |
|------|------|
| 批量导入 | 支持每行一个 Amazon 商品 URL 或 ASIN |
| Alexa for Shopping 抓取 | 提取 Alexa for Shopping/Rufus 区块中的 5 个推荐问题/提示 |
| 商品上下文 | 同时导出 ASIN、商品标题、品牌、评分、评价数 |
| High Price 检查 | 检测 Amazon 页面展示的 `High price` 等价格提示；该信息通常依赖本机浏览器已登录 Amazon 账号 |
| 商品图下载 | 在搜索结果页和详情页给商品图添加 `DL` 大图按钮和 `XL` 当前缩略图按钮；详情页也支持点击商品图下载较大尺寸版本 |
| 商品视频下载 | 在商品详情页识别 Amazon VSE/Product Videos 和已渲染的 Amazon `<video>`，给视频画面添加 `VID` 下载按钮，并支持 HLS/m3u8 分片合并下载 |
| 队列管理 | 支持 2-5 个后台窗口动态并发、暂停、继续、停止 |
| 防检测 | 窗口补位随机延迟、模拟滚动、批次休息 |
| 数据导出 | 支持 CSV 和 JSON |

## 安装

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目文件夹
5. 点击浏览器工具栏里的扩展图标

## 使用

在输入框中粘贴商品页 URL 或 ASIN，每行一个：

```text
https://www.amazon.com/dp/B0D2R3KRFN?th=1
B0D2R3KRFN
```

点击“开始抓取”，完成后会自动导出 CSV，也可以手动导出 CSV 或 JSON。

抓取时会动态保持 2-5 个后台窗口。单个窗口一旦提取到 Alexa for Shopping/Rufus 或商品上下文数据，会立即关闭，不再等待页面完全加载；随后按设置的随机延迟补充新的窗口。

在 Amazon 搜索页（例如 `https://www.amazon.com/s?k=entertainment+center+for+living+room`），每个搜索结果主图右侧外沿会显示 `DL` 和 `XL` 按钮。`DL` 下载较大尺寸版本，`XL` 下载页面当前使用的缩略图。在商品详情页，商品图、高级 A+ 图和 `Reviews with images` 评价图也会显示这两个按钮，也可以直接点击商品图触发大图下载。按钮默认直接显示，也可以在 Popup 中切换为不显示；当大图右侧没有足够可视空间时，按钮会自动贴到图片右内缘，避免完全消失。

Popup 的“抓取设置”中可以调整图片下载按钮：

- 取消勾选“图片检测”：关闭页面图片/视频检测，不再显示 `DL`、`XL`、`VID` 按钮。
- “按钮显示”：可选择“直接显示”或“不显示”；默认直接显示。“不显示”只隐藏按钮和商品图点击下载，仍可保留检测开关状态。

在 Amazon 商品详情页的 Product Videos / Videos for this product，以及 Similar brands on Amazon 这类 Sponsored 视频区域，能精确匹配到的视频画面右下角会显示 `VID` 按钮。点击后会选择 m3u8 中最高分辨率的媒体列表，或直接下载 MP4/WebM 文件。

## 导出字段

| 字段 | 说明 |
|------|------|
| ASIN | Amazon 商品 ASIN |
| 商品标题 | 商品页标题 |
| 品牌 | 页面显示的品牌或店铺名 |
| 评分 | 星级评分 |
| 评价数 | 商品评价数量 |
| 价格标识 | Amazon 价格提示，例如 `High price` |
| 是否High price | 是否检测到 `High price` 标识 |
| 问题1 | Alexa for Shopping/Rufus 第 1 个推荐问题/提示，不包含 `Ask something else` |
| 问题2 | Alexa for Shopping/Rufus 第 2 个推荐问题/提示 |
| 问题3 | Alexa for Shopping/Rufus 第 3 个推荐问题/提示 |
| 问题4 | Alexa for Shopping/Rufus 第 4 个推荐问题/提示 |
| 问题5 | Alexa for Shopping/Rufus 第 5 个推荐问题/提示 |
| URL | 抓取的商品链接 |
| 抓取时间 | ISO 时间戳 |

## 注意

- Alexa for Shopping 是动态模块，页面未展示该模块时 `问题1` 到 `问题5` 会留空。
- High Price 检查读取当前页面实际展示的价格提示，可能依赖 Amazon 账号登录状态、地区、商品、账号画像和页面实验；未登录或页面未展示时会留空或显示“否”。
- Amazon 页面 DOM 可能仍保留 Rufus 旧命名，本项目会继续兼容这些选择器和数据属性。
- Amazon 商品页结构和个性化展示可能变化，建议保留合理延迟。
- 商品图下载会优先从 Amazon 图片 URL、`srcset`、`data-a-dynamic-image` 和高分辨率 URL 变体中选择较大版本；如果 Amazon 返回的原图本身较小，则以实际可加载的最大版本为准。
- 商品视频下载只针对 Amazon 媒体域名中的 VSE/Product Videos 数据和页面已渲染的 Amazon `<video>`；常见 HLS 视频会合并保存为 `.ts`，MP4/fMP4 来源会保存为 `.mp4`。加密 HLS 不做绕过。

## 免责声明

- 本工具仅用于学习研究和个人数据整理，不保证抓取结果完整、准确或持续可用。
- 使用者需自行确认并遵守 Amazon 网站使用条款、robots/访问规则、账号规则以及所在地法律法规。
- 本项目不会提供、绕过或代替 Amazon 登录账号；需要登录后才展示的数据，必须由使用者在本机浏览器中自行登录后访问。
- 因使用本工具导致的账号限制、访问限制、数据误用、业务损失或第三方权益争议，由使用者自行承担责任。
