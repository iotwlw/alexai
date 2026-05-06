# Amazon Rufus 信息抓取工具 - Chrome 扩展

> 批量抓取 Amazon 商品页中的 Ask Rufus 提示按钮，支持断点续传、自动重试、CSV/JSON 导出。

## 功能

| 功能 | 说明 |
|------|------|
| 批量导入 | 支持每行一个 Amazon 商品 URL 或 ASIN |
| Ask Rufus 抓取 | 提取 Rufus 标题、提示按钮、问题按钮、操作按钮 |
| 商品上下文 | 同时导出 ASIN、商品标题、品牌、评分、评价数 |
| 队列管理 | 支持批量处理、暂停、继续、停止 |
| 防检测 | 随机延迟、模拟滚动、批次休息 |
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
| Rufus标题 | 通常为 `Ask Rufus` |
| Rufus按钮 | 提取到的全部 Rufus 按钮文案 |
| Rufus问题 | 以问号结尾的问题类按钮 |
| Rufus操作 | `Why you might like this`、`Compare with similar` 等操作按钮 |
| 是否找到Rufus | 当前页面是否检测到 Rufus 模块 |
| Ask something else | 是否出现 `Ask something else` 按钮 |
| URL | 抓取的商品链接 |
| 抓取时间 | ISO 时间戳 |

## 注意

- Ask Rufus 是动态模块，页面未展示该模块时会导出 `是否找到Rufus=否`。
- Amazon 商品页结构和个性化展示可能变化，建议保留合理延迟。
- 本工具仅用于学习研究，请遵守 Amazon 网站使用条款和相关法律法规。
