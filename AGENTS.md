# Repository Guidelines（仓库协作指南）

## 项目结构

本仓库是一个 Chrome Manifest V3 扩展，用于抓取 Amazon Alexa for Shopping/Rufus 数据。

- `manifest.json`：扩展权限、匹配域名和入口配置。
- `background/background.js`：队列调度、标签页管理、数据提取与重试。
- `content/content.js`：Amazon 页面状态指示器、DOM 监听和调试提取入口。
- `popup/`：弹窗界面（`popup.html`、`popup.css`、`popup.js`）及设置、导出流程。
- `icons/`：扩展图标；`example/`：保存的 Amazon 页面样本和资源。
- `README.md`、`PROJECT_DOCUMENTATION.md` 及各模块 `CLAUDE.md`：行为和约束说明。

## 构建、测试与开发

项目没有包管理器或构建步骤，直接在 Chrome 中加载源码目录：

1. 打开 `chrome://extensions`，启用开发者模式，选择“加载已解压的扩展程序”。
2. 选择 `D:\AmazonCode\AlexaAI`，修改源码后在扩展页面点击重新加载。
3. 使用弹窗和 Amazon 商品页验证，例如 `https://www.amazon.com/dp/B0D2R3KRFN?th=1`。

提交 JavaScript 修改前运行：

```powershell
node --check background\background.js
node --check popup\popup.js
node --check content\content.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

## 编码风格与命名

沿用现有原生 JavaScript 风格：四空格缩进、语句末尾使用分号，函数和变量使用清晰的 camelCase 命名。保留既有中文界面文案，以及选择器和导出字段中的 `Rufus` 兼容命名。优先做范围明确的小改动，避免无关重构；队列延迟、重试和存储行为应保持清晰可追踪。

## 测试指南

项目没有自动化测试框架或覆盖率门槛。上面的 Node 检查是提交前的最低冒烟验证，还应在 Chrome 中手动验证弹窗校验、队列开始/暂停/停止、CSV/JSON 导出和 content script 指示器。Amazon 模块具有动态性和个性化，报告问题时请记录站点、登录状态和实际表现。

## 提交与 Pull Request

提交信息使用简短的祈使式主题，可带范围前缀，保持与历史一致，例如 `feat: add Amazon media download buttons` 或 `Document High Price login requirement`。每个提交聚焦一个目的。Pull Request 应说明用户可见行为、列出验证命令和手动场景，标注权限或选择器变化；涉及界面时附弹窗或页面截图。不要提交凭据、会话数据或无关的 Amazon 抓取资源。

## 安全与配置

不得加入 Amazon 凭据、Cookie、令牌，也不得绕过登录、CAPTCHA、访问频率限制或权限控制。Host permissions 只保留所需的 Amazon 域名和媒体域名。
