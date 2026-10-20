# Complex Contour Editor

复平面围道编辑器，用于绘制由直线和圆弧组成的积分路径，添加奇点标记与 LaTeX 标签，并导出适合笔记、讲义和文章使用的矢量或位图插图。

**[在线绘制围道 → https://huanyushi.github.io/contour-editor/](https://huanyushi.github.io/contour-editor/)**

打开网页即可使用，无需安装 Node.js 或 MathJax。数学排版代码和所需的 TeX 字形已随网站打包，可在其他电脑的浏览器中直接加载。

项目基于 React、TypeScript 和 Vite，使用原生 SVG 绘图、本地 MathJax 排版和 Lucide 界面图标。编辑、项目保存和图片生成均在浏览器中完成。

## 功能概览

围道由共享端点连接，拖动端点时，相邻路径段和填充会同步更新。数学坐标、对象样式和画布视图分别管理，便于在调整图形的同时保持坐标与比例准确。

| 功能     | 支持内容                                           |
| -------- | -------------------------------------------------- |
| 围道编辑 | 直线、三点圆弧、开放／闭合路径、增删端点和反转方向 |
| 独立对象 | 不参与围道连接的标记点和公式                       |
| 数学标签 | TeX base／AMS 命令，可调整字号、颜色和位置         |
| 图形样式 | 线宽、线型、方向箭头、点样式、纯色及斜线填充       |
| 视图控制 | 缩放、平移、适应图形、网格与坐标轴设置             |
| 编辑历史 | 撤销／重做，最多保留 100 步，一次拖动计为一步      |

## 本地运行

需要 Node.js **22.12 或更高版本**。在项目目录执行：

```bash
npm ci
npm run dev
```

开发服务器地址通常为 <http://localhost:5173/contour-editor/>，以终端输出为准。生产构建使用 `npm run build`，生成的静态文件位于 `dist/`；可通过 `npm run preview` 本地预览，同样访问 `/contour-editor/` 路径。

## 工作区与交互

界面采用全屏画布、左侧绘图工具和右侧对象属性面板。侧栏可折叠并独立滚动，窄屏时以覆盖面板呈现。工具名称与提示通过悬停显示，对象列表提供另一种选择对象的方式。

画布内滚轮以鼠标位置为中心缩放；平移支持手掌工具、中键拖动，以及画布聚焦后的空格＋拖动。网格、坐标轴、吸附和倍率集中在“视图设置”中。默认锁定两轴单位比例为 1:1，窗口尺寸和侧栏开合只改变可见范围，保持图形的数学坐标与单位长度。

整数吸附阈值为 8 个屏幕像素，`Alt` 可临时绕过吸附，属性面板中的数值输入始终保持精确值。标签外观即时生效，LaTeX 文字在点击“应用”后更新。撤销快捷键为 `Ctrl／⌘＋Z`，重做为 `Ctrl／⌘＋Shift＋Z` 或 `Ctrl＋Y`；选择和视图调整不进入编辑历史。

应用设置中附有半圆示例，可用于体验直线与圆弧混合的闭合围道。其他图形可参考[围道示例 PDF](https://github.com/huanyushi/pdf-study-notes/blob/main/latex/tikz-example-contour-integration.pdf)。

## 项目文件与图片导出

项目以 **JSON** 保存，包含已应用的几何、标签、公式、样式和视图设置，可重新打开继续编辑。浏览器会自动保存本地草稿并在刷新后恢复；跨设备或长期保存应使用项目文件。窄屏会隐藏顶部保存状态，自动保存仍然生效。

图片支持 **SVG** 和 **PNG**，可选择白色／透明背景，以及是否包含坐标轴、网格和端点标记。SVG 保留矢量路径和数学字形；PNG 提供 800×600、1600×1200、2400×1800 三种尺寸，默认使用 2×。

导出以当前视图中心和缩放比例为准，独立渲染固定 **800×600** 区域，因此范围可能与全屏编辑画布不同。导出不改变画布或编辑历史，也不受侧栏开合影响。

## GitHub Pages 发布

在线站点由本仓库独立发布到 <https://huanyushi.github.io/contour-editor/>。Vite 的 `base` 配置为 `/contour-editor/`，确保脚本和样式使用正确的项目路径。

向 `main` 分支推送后，[部署工作流](.github/workflows/deploy-pages.yml)会自动安装依赖、运行单元和组件测试、构建网站，并将 `dist/` 作为 Pages 产物部署。也可以在仓库的 Actions 页面手动运行“Deploy to GitHub Pages”。构建产物通过工作流上传，无需提交 `dist/`，也无需同步博客仓库。

首次启用时，仓库的 **Settings → Pages → Build and deployment → Source** 应选择 **GitHub Actions**。部署结果可在 Actions 中查看：`build` 和 `deploy` 均成功后，通过部署记录中的站点链接访问并刷新确认。

## 开发与验证

界面布局位于 `src/app/`，围道模型和交互位于 `src/features/contour/`，持久化及导出位于 `src/features/project/`。几何、视图投影和数学排版等基础代码放在 `src/lib/`。实现约定见 [AGENTS.md](AGENTS.md)。

| 命令                                      | 用途                |
| ----------------------------------------- | ------------------- |
| `npm run lint`                            | 代码规范检查        |
| `npm run format` / `npm run format:check` | 格式化／格式检查    |
| `npm run typecheck`                       | TypeScript 类型检查 |
| `npm test` / `npm run test:watch`         | 单元和组件测试      |
| `npm run test:e2e`                        | 浏览器测试          |
| `npm run build`                           | 生产构建            |

浏览器测试使用 Playwright，首次运行前需要安装 Chromium：

```bash
npx playwright install chromium
```

Linux 系统依赖可通过 `npx playwright install-deps chromium` 安装；中文截图需要中文字库，例如 `fonts-noto-cjk`。测试会自动启动开发服务器，以桌面覆盖完整流程，并在窄屏下验证与尺寸有关的交互。
