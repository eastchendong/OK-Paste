# 新版折角 IP 与七状态动效

2026-11-07 按用户要求，以交互设计文档中的 [ai 形象](https://www.figma.com/design/OYmXBbfDyz3btW5Gw1uMJ4/?node-id=447-3) 为源，更新 App 的浮窗角色、应用图标、菜单栏图标和分发 ZIP。已安装并重开本机 `~/Applications/妥帖.app`，实际截图确认新版闲置形象。

[打开可交互预览](../companion-motion-preview.html) · [七状态定帧总览](evidence/companion-v2-states-2026-11-07.png) · [去私密验收记录](evidence/companion-v2-2026-11-07.json)

## 视觉与资源

新版使用柔和折角三角轮廓，保留 Figma 的蓝、薄荷绿、柔黄渐变、深色折面、黑色眼睛和玻璃质感气泡。Figma 的状态板为 `462:533`。导出的 14 个本地 SVG 保持原始字节、路径、遮罩、滤镜和根尺寸；原节点、尺寸与 SHA-256 记录在 `ui/assets/companion/manifest.json`。成功态的四角星光是按状态板文字方向新制作的代码图形。没有改动远端 Figma 原稿。

沿用现有字体和玻璃面板，不另改任务布局。实际角色仍使用 48pt 布局框与 64pt 内部舞台，动画仅写内部分层，外部 dock 的拖动、560ms 落点飞行和返回仍由原模块控制。高亮、虚拟 cursor、遮罩继续遵守 `desktop-overlay-sop.md`，不向目标 App 内容写入产品反馈。

## 动作与触发

| 状态 | 时长 | 动作与触发 |
| --- | --- | --- |
| 闲置 | 5600ms 循环 | 等待时偶尔眨眼，身体仅作极轻微浮动 |
| 加入内容 | 760ms 一次 | 新资料 ID 进入收集态后点头；重复轮询、删除、首次快照恢复不触发 |
| 收到任务 | 800ms 一次 | 独立评审姿态为 wink；实际开始工作时先显示 700ms 的单次 wink，再露出工作姿态 |
| 思考 | 1800ms 循环 | 规划中气泡交替浮起；真实推荐就绪后停止，不在等待用户输入时持续假装思考 |
| 工作 | 2400ms 循环 | 视线由左下向右上扫动，铅笔轻微跟随；任务开始的 wink 不随工作循环重播 |
| 成功 | 1450ms 一次 | 两次轻跳、摇摆落定与星光；只由真实成功结果触发 |
| 失败 | 1000ms 一次 | 明确失败时低头；回执不确定保持中性，保留旧版本不误庆祝 |

相同 `eventKey` 不重建动画。取消、撤销、恢复旧成功结果不重播庆祝；新一轮正常成功可再次播放。隐藏或离屏暂停，返回从原时间继续；减少动态或缺少动画能力时显示完整静态姿态。点头完成后回到闲置。独立预览支持七状态、暂停、重播、拖动进度和 48pt／放大两尺寸，原 SVG 嵌在 HTML 内，单独复制文件或禁用脚本仍能显示。

## 应用与菜单栏图标

`scripts/build-desktop-icons.mjs` 用同一身体、眼睛和源几何生成图标 SVG，不重画第二个角色。应用包为柔白底的渐变折角角色；菜单栏使用单色 alpha 轮廓和透明眼睛。

原 AppKit SVG 导入会丢失 Figma 的模糊／遮罩；WebKit 在大幅放大嵌套 SVG 遮罩时会出现低分辨率栅格边缘。打包图标改由仓库已有 Electron／Chromium 在隔离、隐藏窗口中渲染，再导出 macOS 全套尺寸和模板 PNG，不增加依赖或系统权限。`make-icons.cjs` 只参与构建，不进入产品交互。App 的 WebKit 浮窗仍读取原始本地 SVG；极度放大 WebKit 评审帧可见栅格化，实际 48pt 与 Chromium 图标分别验收。

## 验证与部署

- 桌面 160 项检查通过，包括真实组件的新增资料点头、首次快照不误点头、规划／就绪切换、失败与不确定回执、成功去重、静态恢复和独立预览。
- TypeScript、前端构建、UI 生成物与 `git diff --check` 通过。未修改后端执行逻辑，本轮没有重复真实模型或目标软件写入测试。
- 实际 WebKit 保存 22 张固定帧，检查七种状态、48pt、340/390pt 窄屏、同帧一致性（变换数值容差 0.0001）、循环边界、减少动态、隐藏／离屏暂停和实际自动播放。成功自然结束且同事件不重播。
- WebKit 的收集列表／悬浮详情、普通与 Blender 共享输入框布局、Office 12pt/64pt 网格和既有飞行检查通过。
- 固定证书签名构建与安装前连续性检查通过；新 App 严格签名验证通过。构建先清理自己生成的 UI 资产，ZIP 不含旧版帽子／烟花等分层、凭据、采集目录或 node_modules。
- 安装前确认 `idle/canUndo=false`，备份原 App 与 runtime UI；验证新候选满足原签名要求后替换并重开。密钥配置与采集内容聚合哈希前后一致。运行版、安装包及 ZIP 的 HTML、live JS、overlay JS、14 个 SVG 和应用／菜单栏图标逐项一致。重开后 health=true、idle、canUndo=false。
- 只在实际 App 观察新版闲置 IP，没有用日常工程伪造七种状态，不把隔离视图检查称为所有目标 App 的完整物理操作验收。没有修改 TCC 或重新初始化证书。源码未提交／推送。

维护入口仍为 `ui/components/companion.js`、`companion-motion.js`、`styles/components/companion-character.css` 和 `templates/companion-motion-preview.html`。生成 HTML 不直接修改；`node scripts/sync-component-library.mjs` 重建。图标使用 `desktop-preview/build.sh --package-only` 随签名分发包生成。
