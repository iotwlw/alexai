# alexai - Amazon Alexa for Shopping 信息抓取工具项目文档

alexai 是一个 Chrome Manifest V3 扩展，用于批量抓取 Amazon 商品页中的 Alexa for Shopping 提示按钮信息，并兼容 `Ask Rufus` 旧页面结构。项目沿用原来的队列、重试、断点续传和导出机制，但目标页面已经从卖家页切换为商品详情页。

## 当前目标

- 输入 Amazon 商品页 URL 或 ASIN
- 自动维持 2-5 个后台窗口动态并发抓取
- 提取商品上下文：ASIN、标题、品牌、评分、评价数
- 提取 Alexa for Shopping/Rufus 区块中的 5 个推荐问题/提示
- 导出 CSV/JSON

## 关键文件

| 文件 | 职责 |
|------|------|
| `manifest.json` | 扩展配置、权限、商品页 content script 匹配规则 |
| `background/background.js` | 动态并发队列调度、标签页创建、早停提取、Alexa for Shopping/Rufus 数据提取 |
| `content/content.js` | 商品页指示器、页面内备用提取函数 |
| `popup/popup.html` | 弹窗界面 |
| `popup/popup.js` | URL/ASIN 导入、配置、进度、CSV/JSON 导出 |
| `popup/popup.css` | 弹窗样式 |
| `README.md` | 用户使用说明 |
| `example-urls.txt` | 商品 URL/ASIN 示例 |

## 导出结构

CSV/JSON 导出记录核心字段：

```json
{
  "ASIN": "B0D2R3KRFN",
  "商品标题": "Product title",
  "品牌": "Lightdot",
  "评分": "4.3",
  "评价数": "102",
  "价格标识": "High price",
  "是否High price": "是",
  "问题1": "Can it withstand harsh weather?",
  "问题2": "Does it have a motion sensor?",
  "问题3": "Is installation hardware included?",
  "问题4": "Why you might like this",
  "问题5": "Compare with similar",
  "URL": "https://www.amazon.com/dp/B0D2R3KRFN?th=1",
  "抓取时间": "2026-05-05T00:00:00.000Z"
}
```

## 提取策略

`background/background.js` 中的 `extractProductRufusData()` 在页面上下文执行：

- 通过 canonical URL、页面路径、隐藏输入提取 ASIN
- 使用 `#productTitle`、`#bylineInfo`、评分区等选择器提取商品上下文
- 使用 `#rufus-price-ingress .price-insights-ingress-desktop-text` 检测 `High price` 等价格标识
- 搜索 `id/class/aria/data-*` 中包含 `rufus` 或 `alexa-shopping` 的元素
- 优先读取真实商品页样本中的 `#dpx-nice-widget-container`、`.small-widget-pill`、`data-dpx-rufus-connect.query`
- 通过页面可见文本回退查找 Alexa for Shopping 或 `Ask Rufus` 附近的按钮文案
- 提取 Alexa for Shopping/Rufus 推荐问题/提示，导出时过滤 `Ask something else` 并填入 `问题1` 到 `问题5`

## 验证

当前项目没有自动化测试框架。修改 JS 后至少运行：

```powershell
node --check background\background.js
node --check popup\popup.js
node --check content\content.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

安装扩展后用示例商品页验证：

```text
https://www.amazon.com/dp/B0D2R3KRFN?th=1
```

## 注意

- Alexa for Shopping 是 Amazon 动态/个性化模块，页面不展示时 `问题1` 到 `问题5` 会留空。
- Amazon 页面 DOM 可能仍保留 Rufus 旧命名，底层提取函数和选择器会继续兼容这些字段。
- 不要把抓取频率调得太高，保留随机窗口补位延迟和批次休息。
- 扩展打开后台标签页进行抓取，提取到可用信息后会立即关闭，不等待页面完全加载。
