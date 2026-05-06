# Amazon Rufus 信息抓取工具 - 设计文档

## 项目概述

本项目是 Chrome Manifest V3 扩展，用于批量抓取 Amazon 商品详情页中的 `Ask Rufus` 模块信息。用户可以导入商品 URL 或 ASIN，扩展按队列打开页面，等待动态内容加载，提取 Rufus 提示按钮并导出为 CSV/JSON。

## 需求

- 支持每行输入一个商品 URL 或 ASIN
- 支持 Amazon 商品页路径：`/dp/{ASIN}`、`/{slug}/dp/{ASIN}`、`/gp/product/{ASIN}`
- 提取商品上下文：ASIN、标题、品牌、评分、评价数
- 提取 Rufus 模块：标题、全部提示按钮、问题按钮、操作按钮、是否存在 `Ask something else`
- 保留批量队列、暂停/继续、停止、断点续传、失败重试
- 自动导出 CSV，支持手动导出 JSON

## 架构

| 模块 | 职责 |
|------|------|
| Popup | URL/ASIN 导入、配置、状态展示、导出 |
| Background Service Worker | 队列状态、标签页生命周期、动态等待、页面内提取 |
| Content Script | 商品页状态指示器、备用页面内提取入口 |
| Chrome Storage | 保存 URL、配置、进度、已抓取数据 |

## 数据流

1. 用户在 Popup 中输入 URL/ASIN
2. `popup.js` 标准化为 Amazon 商品 URL
3. 用户点击开始，Popup 向 Background 发送 `start`
4. Background 创建后台标签页
5. 页面加载完成后等待商品/Rufus 动态内容
6. Background 注入 `extractProductRufusData()`
7. 结果写入队列数据并保存到 `chrome.storage.local`
8. Popup 接收进度消息并刷新 UI
9. 任务完成后自动导出 CSV

## 导出字段

| 字段 | 说明 |
|------|------|
| ASIN | 商品 ASIN |
| 商品标题 | `#productTitle` 或页面标题 |
| 品牌 | `#bylineInfo` 或品牌属性 |
| 评分 | 商品星级 |
| 评价数 | 商品评价数量 |
| Rufus标题 | 通常为 `Ask Rufus` |
| Rufus按钮 | 全部 Rufus 按钮文案 |
| Rufus问题 | 以 `?` 结尾的问题 |
| Rufus操作 | 非问题操作按钮 |
| 是否找到Rufus | 是否检测到 Rufus 模块或按钮 |
| Ask something else | 是否检测到该按钮 |
| URL | 抓取链接 |
| 抓取时间 | ISO 时间戳 |

## 风险

- Ask Rufus 是动态/个性化模块，不是每个用户、地区、商品都展示。
- Amazon DOM 可能调整，提取逻辑需要通过多选择器和文本回退保持弹性。
- 已按 `example/Lightdot 4Pack 200W LED Wall Pack Lights.html` 校准真实 Rufus 结构：`#dpx-nice-widget-container`、`.small-widget-pill`、`data-dpx-rufus-connect.query`。
- 过高频率可能触发验证或限制，应保留随机延迟和批次休息。
