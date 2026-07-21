# alexai - Amazon Alexa for Shopping 信息抓取工具

> 批量抓取 Amazon 商品页中的 Alexa for Shopping 提示按钮，兼容 Ask Rufus 旧页面结构，支持 High Price 检查、图片/视频下载、断点续传、自动重试、CSV/JSON 导出。

## 功能

| 功能 | 说明 |
|------|------|
| 批量导入 | 支持每行一个 Amazon 商品 URL 或 ASIN |
| Alexa for Shopping 抓取（专业版） | 输入有效授权码后，批量提取 Alexa for Shopping/Rufus 区块中的 5 个推荐问题/提示 |
| 商品上下文 | 同时导出 ASIN、商品标题、品牌、评分、评价数 |
| High Price 检查 | 检测 Amazon 页面展示的 `High price` 等价格提示；该信息通常依赖本机浏览器已登录 Amazon 账号 |
| 商品图下载（免费） | 在搜索结果页和详情页按设置显示高清 `HD` 按钮，开启后可同时显示标清 `SD` 按钮 |
| 商品视频下载（免费） | 在商品详情页识别 Amazon VSE/Product Videos 和已渲染的 Amazon `<video>`，给视频画面添加更醒目的下载按钮，并支持 HLS/m3u8 分片合并下载 |
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

图片和视频下载可以免费使用。批量抓取 Alexa for Shopping/Rufus 前，需要在 Popup 顶部输入授权码并激活高级版；授权服务返回 `alexa_scraping` 权益后，“开始高级抓取”按钮才会开放。完成后会自动导出 CSV，也可以手动导出 CSV 或 JSON。

抓取时会动态保持 2-5 个后台窗口。单个窗口一旦提取到 Alexa for Shopping/Rufus 或商品上下文数据，会立即关闭，不再等待页面完全加载；随后按设置的随机延迟补充新的窗口。

在 Amazon 搜索页（例如 `https://www.amazon.com/s?k=entertainment+center+for+living+room`），每个搜索结果主图右侧外沿会按页面下载设置显示 `HD` 按钮。在商品详情页，商品图、高级 A+ 图和 `Reviews with images` 评价图也会显示该按钮。页面右下角的 `A` 图标可以直接调整按钮启用状态、直接/悬停显示方式和图片清晰度。默认采用悬停显示且只创建高清按钮；大幅视频的“下载视频”入口保持可见，避免因为悬停策略降低发现率。当大图右侧没有足够可视空间时，按钮会自动贴到图片右内缘，避免完全消失。

Popup 的“抓取设置”中可以调整图片下载按钮：

- 取消勾选“启用图片和视频按钮”：关闭页面图片/视频检测，不再显示下载按钮。
- “显示方式”：可选择“悬停显示”或“直接显示”；默认悬停显示，使用纯 CSS 状态切换，不增加额外扫描监听。
- “图片清晰度”：默认“仅高清 HD”；选择“高清 + 标清”后才会创建 `SD` 当前尺寸下载按钮，避免默认增加页面节点数量。

在 Amazon 商品详情页的 Product Videos / Videos for this product，以及 Similar brands on Amazon 这类 Sponsored 视频区域，能精确匹配到的视频画面右下角会显示下载按钮。大幅视频宿主会显示更大的“下载视频”按钮；同一视频同时出现在顶部主图缩略栏和 Product Videos 时，会优先给 Product Videos 的大视频画面加按钮；如果页面实验导致卡片无法精确匹配，会在 Product Videos 区域标题下方生成备用按钮。点击后会选择 m3u8 中最高分辨率的媒体列表，或直接下载 MP4/WebM 文件。

### Alexa / Rufus 抓取授权

Popup 激活授权时，由 Background 向授权服务发送 `POST /v1/licenses/activate`。请求包含授权码、扩展随机生成并持久化的设备 ID，以及扩展版本；不会上传 Amazon Cookie、商品 URL、ASIN 或抓取结果。服务端必须返回包含 `alexa_scraping` 的 `features`，否则不会解锁。

Popup 负责显示授权状态和禁用按钮，Background 在每次开始或继续抓取前还会再次向服务端验证，避免只修改界面即可绕过。默认服务地址为 `http://127.0.0.1:8080`；正式远程服务必须使用 HTTPS，并由用户授予对应的可选网络权限。当前 MVP 采用严格在线校验，网络不可用、授权过期或服务端撤销时，开始/继续抓取会被拒绝，但已有输入和结果不会删除。

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
- Chrome 扩展源码可被查看和修改，本地授权不能形成不可绕过的 DRM；正式商业化应依赖可靠的服务端授权、持续更新或服务端高级能力。
- 商品图下载会优先从 Amazon 图片 URL、`srcset`、`data-a-dynamic-image` 和高分辨率 URL 变体中选择较大版本；如果 Amazon 返回的原图本身较小，则以实际可加载的最大版本为准。
- 商品视频下载只针对 Amazon 媒体域名中的 VSE/Product Videos 数据和页面已渲染的 Amazon `<video>`；常见 HLS 视频会合并保存为 `.ts`，MP4/fMP4 来源会保存为 `.mp4`。加密 HLS 不做绕过。

## 免责声明

- 本工具仅用于学习研究和个人数据整理，不保证抓取结果完整、准确或持续可用。
- 使用者需自行确认并遵守 Amazon 网站使用条款、robots/访问规则、账号规则以及所在地法律法规。
- 本项目不会提供、绕过或代替 Amazon 登录账号；需要登录后才展示的数据，必须由使用者在本机浏览器中自行登录后访问。
- 因使用本工具导致的账号限制、访问限制、数据误用、业务损失或第三方权益争议，由使用者自行承担责任。
