# 妥帖 UI 组件源码

所有在用产品界面的共用样式由这里维护。原则：数据决定内容，组件决定结构，变量决定外观，宿主只处理平台差异。不要直接编辑生成的 `components-preview.html` 或 `desktop-preview/desktop-overlay.js`。

## 修改入口

| 要修改什么 | 源码 |
| --- | --- |
| 官方色板、文字颜色 | `styles/tokens/palette.css` |
| 玻璃、描边、遮底、阴影 | `styles/tokens/surfaces.css` |
| 收集卡片尺寸与叠放间距 | `tokens/collection.json`，同时生成 CSS 与 JS 几何参数 |
| 卡片标题、类型图标、缩略预览、来源链接 | `components/content-card.js`，预览、桌面、归档共用 |
| 工作输入、完成反馈、固定快捷调整选项 | `components/task-panel.js`；`desktop-live.js` 只提供目标能力档位 |
| 收集、展开、收起与材质切换 | `components/collection-controller.js` |
| 展开行的内容预览与悬浮来源详情 | `components/content-card.js`、`components/collection-hover.js` |
| 卡片、输入、推荐、结果、详情等组件样式 | `styles/components/` |
| 桌面紧凑收集布局 | `styles/collection.css`，只覆盖宿主尺寸与状态 |
| 原生玻璃与页面事件桥接 | `desktop-overlay.js`、`styles/desktop.css` |
| 内容包原生拖动后的 IP 飞行、取消归位 | `components/pack-drag-motion.js`；原生宿主负责随指针的胶囊 |
| 渐变折角 IP、七状态动效 | `components/companion.js`、`components/companion-motion.js`、`styles/components/companion-character.css`；真实 Figma 分层在 `assets/companion/` |
| 浏览器选区浮条定位 | `styles/browser-selection.css` |
| 组件目录与演示场景布局 | `styles/workbench/`、`templates/catalog.html` |
| 原生设置／选区工具条 | `desktop-preview/Sources/ComponentControls.swift`、`SelectionToolbar.swift`；颜色／字体通过 `ComponentLibrary.generated.swift` 同步 |

每类内容在 `content-card.js` 定义一次。文字、图片、表格、视频、文档使用已有官方 SVG；未知类型回退为文档。图标是装饰，类型文字和可访问标签仍保留。来源链接与类型保持同行。

## 构建与校验

在 `prototype/`：

```sh
npm run ui:build
npm run ui:check
npm test --prefix desktop-preview
npm run test:companion-motion --prefix desktop-preview
```

`styles/manifest.json` 明确记录样式拼接顺序，避免迁移改变 CSS 优先级。`scripts/build-ui.mjs` 将模板与组件编成自包含 HTML 和桌面注入脚本；`scripts/sync-component-library.mjs` 再从同一套源码产出浏览器 CSS／选区组件和 Swift 设计变量。正式构建、运行目录准备、测试都自动调用同步入口。生成结果不含外部运行依赖，仍支持直接打开本地预览页及 WKWebView 注入。

修改完通过 `scripts/prepare-desktop-runtime.mjs` 同步，再重启已安装的妥帖。纯 UI 变更不需要重新签名原生宿主。

`companion-motion-preview.html` 也由同一构建生成：复用真实角色和运动轨道，提供大图／48pt、闲置／点头／收到任务／思考／工作／成功／失败、播放暂停与逐帧 seek。独立动效预览内嵌原SVG字节，并预渲染两处角色：单独复制HTML不丢素材，禁用脚本仍显示静态角色；无脚本窄屏使用居中160pt静态姿态。真实dock及目录仍读取本地SVG，根目录使用 `ui/assets/companion/`，运行版复制到 `runtime/ui/assets/companion/`，这两者不能只复制HTML。角色动效不修改外层 dock transform，保持落点飞行独立；真实状态轮询不能重播庆祝。新版规则见 `docs/companion-v2-2026-11-07.md`（此前六边形为历史版本）。

## 当前视觉规则

- 输入 340×40 点；收起和展开共用简洁内容条，文字行高 34 点、图片／表格行高 62 点，宽度均为 340 点。混合类型的后卡按前卡底部对齐后再下移。
- 堆叠与展开始终使用同一原生玻璃；后卡被遮挡区域不绘制，原生背景保留完整圆角轮廓并另加裁切遮罩。最多三层，每层内缩 10 点、下移 10 点；保留全部条目并从第三层连续展开，列表间距 6 点。材质不做透明度动画。
- 收集阶段没有“内容包”标题；卡片与左侧助手顶部对齐，计数／展开胶囊位于卡片下方靠右，箭头旋转表达展开状态。卡片标题前类型图标使用深黑 ink。
- 工作、完成和调整沿用同一 340 点宽度、40 点输入高度、22 点圆角、10 点组间距；结果说明与操作分行，快捷调整位于输入框下方。每个独立表面在同一个材质注册表接入原生玻璃，容器自身透明。
- 固定选项由内容能力档位决定，点击发送一次真实 continuation，并保留输入草稿；暂不显示动态建议与未接通的滑轨参数。
- 展开行仅显示实际内容：文字单行省略，图片等比缩略，表格使用真实行列。悬停或键盘聚焦后出现独立玻璃详情，显示内容、应用与来源链接；收起堆叠使用相同内容条；任务／归档保留完整卡片结构。单条不响应点击／回车，数量胶囊负责展开收起。
- 悬浮详情在 body 下独立注册材质和命中区域，不放在列表的滚动／渐隐遮罩内；220ms 打开、180ms 延迟关闭以容许移入点击来源，滚动或 Esc 关闭；无额外“查看完整内容”入口。来源应用图标由原生按已记录 bundle ID 解析，缺少身份时使用明确说明与通用图标。
- 原生内容包拖动通过 `TuotiePackDrag.begin/end/cancel` 通知共享界面；拖动时只隐藏源包及详情，保留源数据与展开偏好。成功后 IP 用 560ms 弧线飞到落点，再用 240ms 从胶囊形状展开原卡片；取消用 320ms 回到拖前实际位置，不固定回屏幕边缘。每帧同步原生玻璃几何，运动期间不截获目标 App 点击；减少动态效果时即时完成。Office 固定插入锚点不参与这条移动流程。

停用的 Electron 演示 `src/ui.css`、PPT 汇报及开发探针有独立用途，不由产品组件构建覆盖。上游设计稿更新应迁入对应源码模块，再构建预览产物，不能直接覆盖生成文件。

展开列表底部使用 `scrollFade` 共享尺寸（32pt），网页 mask 与原生 `fadeBottom` / `fadeBottomOffset` 同步；到底时渐隐归零。修改时须同时验证原生玻璃与文字，不能仅对网页设置透明度。
