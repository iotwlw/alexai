# Amazon Rufus 信息抓取工具 - 项目文档

这是一个 Chrome Manifest V3 扩展，用于批量抓取 Amazon 商品页中的 `Ask Rufus` 提示按钮信息。项目沿用原来的队列、重试、断点续传和导出机制，但目标页面已经从卖家页切换为商品详情页。

## 当前目标

- 输入 Amazon 商品页 URL 或 ASIN
- 自动打开商品页并等待动态内容加载
- 提取商品上下文：ASIN、标题、品牌、评分、评价数
- 提取 Rufus 信息：`Ask Rufus` 标题、全部按钮、问题按钮、操作按钮
- 导出 CSV/JSON

## 关键文件

| 文件 | 职责 |
|------|------|
| `manifest.json` | 扩展配置、权限、商品页 content script 匹配规则 |
| `background/background.js` | 队列调度、标签页创建、动态等待、Rufus 数据提取 |
| `content/content.js` | 商品页指示器、页面内备用提取函数 |
| `popup/popup.html` | 弹窗界面 |
| `popup/popup.js` | URL/ASIN 导入、配置、进度、CSV/JSON 导出 |
| `popup/popup.css` | 弹窗样式 |
| `README.md` | 用户使用说明 |
| `example-urls.txt` | 商品 URL/ASIN 示例 |

## 数据结构

抓取结果核心字段：

```json
{
  "asin": "B0D2R3KRFN",
  "productTitle": "Product title",
  "brand": "Lightdot",
  "rating": "4.3",
  "reviewCount": "102",
  "priceInsightLabel": "High price",
  "highPriceDetected": true,
  "rufusTitle": "Ask Rufus",
  "rufusFound": true,
  "rufusPrompts": ["Can it withstand harsh weather?"],
  "rufusQuestions": ["Can it withstand harsh weather?"],
  "rufusActions": ["Compare with similar"],
  "askSomethingElsePresent": true,
  "url": "https://www.amazon.com/dp/B0D2R3KRFN?th=1",
  "scrapedAt": "2026-05-05T00:00:00.000Z"
}
```

## 提取策略

`background/background.js` 中的 `extractProductRufusData()` 在页面上下文执行：

- 通过 canonical URL、页面路径、隐藏输入提取 ASIN
- 使用 `#productTitle`、`#bylineInfo`、评分区等选择器提取商品上下文
- 使用 `#rufus-price-ingress .price-insights-ingress-desktop-text` 检测 `High price` 等价格标识
- 搜索 `id/class/aria/data-*` 中包含 `rufus` 的元素
- 优先读取真实商品页样本中的 `#dpx-nice-widget-container`、`.small-widget-pill`、`data-dpx-rufus-connect.query`
- 通过页面可见文本回退查找 `Ask Rufus` 附近的按钮文案
- 识别问号结尾的问题，以及 `Ask something else`、`Compare with similar`、`Why you might like this` 等操作按钮

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

- Ask Rufus 是 Amazon 动态/个性化模块，页面不展示时导出 `rufusFound=false`。
- 不要把抓取频率调得太高，保留随机延迟和批次休息。
- 扩展打开后台标签页进行抓取，处理完会自动关闭。
