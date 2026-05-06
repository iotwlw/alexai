# 图标文件说明

本扩展需要三个尺寸的PNG图标文件：
- icon16.png (16x16) - 工具栏小图标
- icon48.png (48x48) - 扩展管理页面图标
- icon128.png (128x128) - Chrome Web Store图标

## 快速获取图标

### 方法1：在线生成（推荐）

1. 访问 https://www.favicon-generator.org/ 或类似网站
2. 上传 `icon.svg` 文件
3. 下载生成的PNG图标包
4. 将图标文件重命名并放入此文件夹

### 方法2：使用图像编辑软件

1. 用Photoshop/GIMP/Illustrator打开 `icon.svg`
2. 导出为PNG格式
3. 分别导出三个尺寸：16x16, 48x48, 128x128
4. 保存为 icon16.png, icon48.png, icon128.png

### 方法3：使用命令行工具（需要ImageMagick）

```bash
# 安装 ImageMagick 后执行：
magick convert -background none -size 128x128 icon.svg icon128.png
magick convert -background none -size 48x48 icon.svg icon48.png
magick convert -background none -size 16x16 icon.svg icon16.png
```

### 方法4：临时占位符（测试用）

如果没有图标文件，扩展仍然可以正常工作，只是会显示默认图标。

## 图标设计说明

当前图标使用渐变背景（蓝色到绿色），包含：
- 🛒 购物车图标（代表Amazon）
- 🔴 红色徽章数字（代表待处理任务）

您可以自定义图标，建议：
- 保持简洁易识别
- 使用与Amazon相关的视觉元素
- 确保在小尺寸下仍然清晰
