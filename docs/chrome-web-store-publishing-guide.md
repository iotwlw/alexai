# Chrome Web Store 上架整改与发布指南

**项目：** AlexaAI  
**目标平台：** Chrome Web Store（不是 Google Play）  
**当前版本：** 1.0.0  
**远程仓库：** https://github.com/iotwlw/alexai.git  
**评估结论：** 不建议当前版本直接提交，先完成整改  
**文档日期：** 2026-07-20

> **核心建议**：首版先收窄为“批量提取并导出 Amazon 商品研究信息”，移除防检测表述、强制保活和媒体下载；待审核通过后再评估扩展功能。

## 1. 当前项目判断

项目已经具备 Manifest V3、后台 Service Worker、内容脚本和弹窗界面，JavaScript 语法检查通过。主要问题不在于能否运行，而在于公开商店审核会关注的用途边界、权限最小化、数据披露、品牌表达和对 Amazon 页面行为的影响。

| 维度 | 当前情况 | 上架判断 |
| --- | --- | --- |
| 技术形态 | Manifest V3；代码未发现远程脚本、`eval` 或 `new Function`。 | 基础条件满足 |
| 主要功能 | 批量抓取 Rufus/Alexa 提示、价格信息、图片和视频，并导出 CSV/JSON。 | 用途偏宽，需收窄 |
| 权限 | `storage`、`tabs`、`scripting`、`activeTab`、`notifications`、`downloads`。 | 存在可删减权限 |
| 行为表述 | README 和弹窗中出现“防检测”“模拟人类行为”。 | 高风险，必须改 |
| 数据与隐私 | 结果保存在 `chrome.storage.local`；仓库未见隐私政策页面。 | 必须补齐披露 |
| 品牌与版权 | 名称直接包含 Amazon Alexa；支持媒体下载。 | 需避免官方背书误解并说明权利边界 |

## 2. 提交前整改清单

### 2.1 收窄首版用途

建议首版只承诺一个主任务：批量提取并导出 Amazon 商品页公开展示的商品研究信息。图片下载、视频下载和 HLS 合并会同时增加权限、版权和审核复杂度，建议暂缓。

推荐单一用途文案：

> 本扩展用于批量提取 Amazon 商品页中公开展示的商品研究信息，并在本机导出为 CSV 或 JSON 文件。

### 2.2 删除规避检测表述和强制保活

- 删除“防检测”“模拟人类行为”等名称、提示和配置项。
- 保留合理的访问频率控制、批次间隔和用于触发懒加载的滚动，并改成中性的产品描述。
- 移除每 20 秒访问 `chrome.storage` 以强制保持 Service Worker 活跃的逻辑，改用持久化队列状态和事件驱动恢复。

> **风险说明：** Google 的“误导或意外行为”政策要求功能透明；Amazon 的反自动化和访问规则属于独立的条款风险，免责声明不能替代合规。

### 2.3 按功能最小化权限

| 权限/资源 | 当前用途 | 建议 |
| --- | --- | --- |
| `storage` | 保存 URL、配置、结果和任务状态。 | 保留，并在隐私表单说明本机存储。 |
| `scripting` | 在指定 Amazon 标签页执行提取函数。 | 保留，限定到实际 Amazon 域名。 |
| `tabs` | 当前代码主要创建和关闭标签页。 | 优先删除；重新验证是否读取 tab 的敏感字段。 |
| `activeTab` | 代码未显示必须依赖临时授权。 | 删除，避免与 `host_permissions` 重复。 |
| `notifications` | 任务完成提醒。 | 首版可删除，或明确说明提醒用途。 |
| `downloads` | 下载图片、视频和合并媒体。 | 若首版移除媒体下载，则一并删除。 |
| `web_accessible_resources` | 当前公开整个 `content/content.js`。 | 若无页面直接加载需求，删除。 |
| `media-amazon` / `ssl-images` | 媒体下载使用。 | 随媒体下载功能一起评估或删除。 |

### 2.4 调整品牌与版权表达

- 将“Amazon Alexa for Shopping 信息抓取工具”改为独立品牌加功能描述，例如“AlexAI - Amazon 商品研究数据导出”。
- 在商品详情中声明：本扩展与 Amazon、Alexa 或 Rufus 无隶属、授权或背书关系。
- 不要使用 Amazon 官方 Logo 或会造成官方产品误解的截图和宣传文案。
- 如果保留图片/视频下载，明确要求用户只下载其有权使用的内容；Google 审核不替代 Amazon 条款或版权审查。

### 2.5 补齐隐私政策和数据披露

即使项目没有自有后端，也应准备一个可公开访问的隐私政策页面，并在开发者信息中心填写链接。披露内容必须与实际代码一致。

- **读取：** 用户输入的商品 URL、Amazon 页面中公开展示的商品信息，以及为完成用户操作而读取的媒体地址。
- **处理：** 默认在用户设备本地处理，结果写入 `chrome.storage.local`，并由用户导出到本地文件。
- **传输：** 不向开发者自有服务器发送数据；访问 Amazon 资源的行为应按实际功能说明。
- **控制：** 提供清空本地数据的方法，并说明任务停止、重试和导出行为。

## 3. 发布包准备

1. 本地测试生产版本：从 `chrome://extensions` 加载解压扩展，覆盖单个商品、批量 URL、暂停/继续、失败重试、导出和清空数据等路径。
2. 更新 `manifest.json` 的 `name`、`description`、`version`、`permissions` 和 `host_permissions`；每次重新上传的版本号必须高于已上传版本。
3. 确认 `description` 不超过 132 个字符，Manifest JSON 中不含注释。
4. 制作 ZIP，并确保 `manifest.json` 位于 ZIP 根目录。不要把 `.git`、`CLAUDE.md`、测试页面、示例 URL 和内部文档放入发布包。
5. 准备商店资源：128×128 图标、至少一张 1280×800 截图、440×280 小宣传图；可选 YouTube 演示视频和 1400×560 选取框宣传图。
6. 准备主页、支持网址、隐私政策网址、支持邮箱和审核测试说明。

## 4. Chrome Web Store 后台操作

1. 给 Google 账号开启两步验证。
2. 注册 Chrome Web Store 开发者账号，接受开发者协议并支付一次性注册费；金额以控制台结算页面为准。
3. 验证联系邮箱，填写发布商名称；如提供付费功能或订阅，还要按要求填写实际地址。
4. 进入 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)，点击“添加新商品”，上传 ZIP。
5. 填写商品详情：名称、简短/详细说明、类别、语言、图标、截图、宣传图、主页和支持网址。
6. 填写隐私权规范：单一用途、权限理由、远程代码声明、数据使用披露和隐私政策链接。当前代码未发现远程执行代码，按实际情况选择“No”。
7. 填写分发设置：免费/应用内购买、公开范围、地区和测试版标签。公开、非公开列出和仅限测试人员都仍需经过政策审核。
8. 填写测试说明：提供不需要开发者账号的测试步骤、示例 Amazon URL、预期输出，以及哪些功能依赖 Amazon 登录或个性化页面。
9. 点击提交审核。建议先选择审核通过后暂不自动发布，检查商店详情无误后再手动发布。

## 5. 审核员测试说明示例

1. 安装扩展并打开弹窗。
2. 粘贴一个 Amazon 商品 URL，例如：`https://www.amazon.com/dp/B0D2R3KRFN`。
3. 点击“开始抓取”。
4. 等待任务完成。
5. 检查弹窗中的结果并导出 CSV/JSON。

补充说明：Rufus/Alexa 模块、价格提示和部分页面内容由 Amazon 按地区、登录状态、账号画像和页面实验动态展示；测试说明不能承诺每个商品都出现全部字段。

## 6. 最终提交检查表

- [ ] **用途：** 商店名称、描述、截图和实际功能都围绕一个清晰主用途。
- [ ] **权限：** 每项权限都有必要性；无 `tabs`、`activeTab`、`web_accessible_resources` 等冗余项。
- [ ] **行为：** 没有“防检测”或隐藏功能；后台标签页数量、频率控制和媒体访问已公开说明。
- [ ] **Manifest：** Manifest V3 有效；`description` ≤ 132 字符；`version` 高于历史版本。
- [ ] **隐私：** 隐私政策可访问，数据类型、处理方式、保存位置和删除方式与代码一致。
- [ ] **品牌：** 没有冒充 Amazon 官方；有独立发布商名称和非关联声明。
- [ ] **版权：** 截图、图标、宣传素材和下载功能的权利边界已确认。
- [ ] **测试：** 审核员能按说明完成安装、抓取、导出和清空数据。
- [ ] **ZIP：** `manifest.json` 在 ZIP 根目录，发布包不含 `.git`、内部文档和测试文件。
- [ ] **发布：** 已启用两步验证、验证邮箱，并决定公开/非公开列出/测试版策略。

## 7. 建议执行顺序

1. 先做首版范围决策：暂缓媒体下载，删除“防检测”概念。
2. 再做权限和 Service Worker 整改，并重新进行本地回归测试。
3. 同步完成隐私政策、英文或目标市场语言的商店文案、截图和测试说明。
4. 先以测试人员或非公开列出方式提交验证流程，但不要把它当作绕过审核的方式。
5. 审核通过后再考虑增加功能，每次增加高风险权限前都重新做政策和隐私评估。

## 8. 官方参考资料

- [注册开发者账号](https://developer.chrome.com/docs/webstore/register)
- [设置开发者账号](https://developer.chrome.com/docs/webstore/set-up-account)
- [准备扩展程序](https://developer.chrome.com/docs/webstore/prepare)
- [在 Chrome 应用商店中发布](https://developer.chrome.com/docs/webstore/publish)
- [填写隐私权字段](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [分发和可见性](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Chrome 应用商店审核流程](https://developer.chrome.com/docs/webstore/review-process)
- [权限使用政策](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- [Manifest V3 额外要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [品牌与知识产权政策](https://developer.chrome.com/docs/webstore/program-policies/impersonation-and-intellectual-property)

> 以上链接为官方文档入口，政策和后台字段可能更新；提交前应再次检查控制台显示内容。
