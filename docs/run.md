# 运行与联调

当前桌面入口为 `~/Applications/妥帖.app`。顶部「妥帖小人图标 → 设置…」可配置 OpenAI 兼容的 Base URL、模型与 API Key 和五项产品快捷键；保存到 Application Support 的运行目录，Key 不回显，下一次请求生效。浏览器扩展从旧版升级后需重新加载并刷新已有页面一次。菜单不再提供复制练习页或演示操作，开发者仍可直接运行仓库中的开发页面。

这是 MacBook 上的本机原型：Swift 透明悬浮宿主加载共享 HTML，启动本地剪贴板 / Agent HTTP 服务（47721）。场景工具通过官方 MCP SDK → mcp-for-blender → Blender 插件；Office 文件工具用本机 Python 子进程读取与修改独立副本。默认模型连接使用 DeepSeek 官方 API，详见[模型接口](model-api.md)。旧 Electron 开发入口保留作历史联调，不作为当前桌面入口。

## 安装与启动

需要 Node 24、pnpm、uv 和 `/Applications/Blender.app`。首次准备：

```bash
pnpm install --frozen-lockfile
pnpm run setup:mcp
pnpm run setup:office       # 需要 DOCX/XLSX/PPTX 时
cd desktop-preview
zsh build.sh
open ~/Applications/妥帖.app
```

打开应用后，在菜单「设置」填写自己的 DeepSeek API Key。

当前桌面不要运行 `pnpm start`，它会打开旧 Electron 窗口。用菜单「打开 Blender」连接/启动测试实例；不要关闭、重置或保存覆盖当前用户工程。
单独运行测试 Blender：`pnpm blender`。妥帖会检查真实宿主响应并自动重连；仅启动 MCP 子进程不算连接成功。排查现有工程时不要运行会打开演示文件的 `blender/start.py`，也不要在活跃预览中重载模块。

### 自动连接（2026-11-04）

本机已启用 Blender 5.2 自动接入。今后正常打开 Blender 和妥帖即可，先后顺序不限；Blender 的启动模块每 2 秒等待本机服务，接入后妥帖每约 5 秒检查真实宿主，断线后重试。不自动打开演示工程，不保存或重置当前工程。当前只支持一个 Blender 进程占用 9876；第二实例不接管拖放，后台渲染不启用接入。

其他机器在运行资源准备完成后执行：

```bash
pnpm run setup:blender-auto                     # 已安装的 Blender 版本
pnpm run setup:blender-auto --version 5.2       # 明确指定版本
pnpm run setup:blender-auto --disable          # 下次 Blender 启动不再自动接入
```

安装只写用户 Blender 版本目录的 `scripts/startup/tuotie_autoconnect.py`，不改偏好或 startup.blend；新 Blender 大版本需再次安装。已开着的未接入窗口需正常重开一次才能载入 startup 模块，开发诊断可在不重载事务模块的前提下显式注册。关闭自动接入不会中途终止当前会话，退出 Blender 后生效。

Figma 的「妥帖 · 矢量创作」插件打开后自动连接；妥帖未启动时显示等待，服务重启或网络短暂中断会自动恢复，不重复执行旧写入。保持插件运行即可。Figma [要求手动运行插件](https://help.figma.com/hc/en-us/articles/360042532714-Use-plugins-in-files)，因此插件被关闭、文件关闭后仍需再打开一次；这不等同于随 Figma 应用全自动启动。两端的自动连接都不会自动生成或提交作品。

## 打开桌面应用并试复制

当前桌面入口是 `~/Applications/妥帖.app`。`build.sh` 会安装它，并把运行代码和依赖准备到 `~/Library/Application Support/Tuotie/runtime`，避免从 Desktop 仓库运行时触发文件夹访问弹窗。它沿用同一套悬浮界面，并在本机启动剪贴板服务。复制的内容写到 `~/Library/Application Support/Tuotie/runtime/.local/clipboard/`（`items.json` 和 `files/`），退出再打开还在。这个目录被 Git 忽略。

在仓库里构建并打开：

```bash
cd desktop-preview
zsh build.sh
open ~/Applications/妥帖.app
```

菜单栏小人图标提供内容包、归档、取消标记位置、目标选择、打开目标、停止、撤销与设置。没有示例页或开发动作。当前聚焦位置显示在包内底部；图片显示实际缩略图。不要另开 `pnpm start` 或 `pnpm clipboard:serve`，47721 由桌面应用管理。

1. 在妥帖设置查看辅助功能状态；原生 macOS 划词不需要浏览器扩展，程序不会反复请求授权。
2. 选中文字，点 **加入内容包** 保存参考并写入系统剪贴板；默认 **Alt+C** 直接复制当前选区。 跨应用采集使用 **⌘⌥C（Command + Option + C）**：选中文字或可复制的图片后按下即可，普通 ⌘C 不加入内容包；当前应用不支持复制时会提示失败。
3. 也可先在目标选区或辅助功能可读取的空白编辑插入点选择 **设为目标位置**。这只标记修改位置，不复制、不生成；之后找来的参考用于该位置。包内显示标记，菜单可取消。
4. 推荐依据整个活动包和当前应用上下文刷新；有标记时以标记目标为准。空包不展开、无推荐。点击建议或输入要求生成独立预览，确认后才应用或复制；成功归档任务开始时的整包，失败／取消保留，处理中新增来源留给下一任务。
5. 普通应用目前只生成适合目标的待粘贴文字，不自动发送或写入在线文档。Blender 与已保存 Office 文件使用真实事务；剪映当前禁用。Office/Figma 的实时入口及限制见 [APP 接入记录](app-integration-2026-11-04.md)。图片／视频的可选网页增强在 `browser/`，未自动安装到用户浏览器。

HTML／JS／TypeScript 更新优先同步 Application Support 运行资源，复用同一宿主，不重签 App。Swift 变化需要重新构建，但日常安装必须先配置固定的代码签名身份；缺身份或证书不可用时在编译前停止，不静默退回 ad-hoc。身份来自 `TUOTIE_CODESIGN_IDENTITY`、持久的 `~/Library/Application Support/Tuotie/signing/identity.json` 或旧 `.local/codesign-identity`。首次本机设置见 `desktop-preview/README.md`；每次复用同一张证书和 bundle ID，并校验新包满足旧版 DR。签名身份变更仍可能需要一次AX迁移，不修改TCC或系统隐私数据库。本机已完成固定身份初始化和一次登记；实际两个不同原生版本更新后 AX 仍有效。不要为后续构建重建证书或重复信任配置；专用链只在签名期间临时加入搜索列表并在结束后恢复。

## 使用已保存的 Office 文件

先在仓库根目录运行 `pnpm run setup:office` 并重新运行桌面 `build.sh`。它用 uv 创建 `.local/office-venv`，安装 `requirements-office.txt` 的固定版本，不改变系统 Python。

1. 菜单 **✳ 妥帖** → **选择目标文档、幻灯片或表格…**，选一个已保存的 `.docx`、`.xlsx` 或 `.pptx`。
2. 复制来源，读取目标的实际段落、单元格或幻灯片后，浮窗显示对应建议。选择建议，或输入要求。
3. 生成后用默认应用打开独立预览副本；浮窗也有「打开预览」。确认后点「应用」写入原文件，再可「撤回」。原文件若已被其他应用改变，会提示重新读取。

这是文件目标接入。执行前先在编辑器保存；不能读取未保存改动或实时选区。应用/撤回后默认应用的已打开文档是否自动刷新仍需前台验收，必要时重新打开文件。预览目录与本地日志都在 `.local/`；不会上传绝对目标路径给模型。

可复现集成检查（使用合成数据，不修改用户文件）：

```bash
pnpm check:office                              # 三种文件；真实模型，消耗套餐额度
pnpm check:office pptx                         # 单独检查一种
pnpm exec tsx scripts/office-context-plans-check.ts # 同源不同目标的推荐
node scripts/render-office-check.mjs           # 可选：本机 LibreOffice + pdftoppm 渲染 QA
```

未装 Office Python 环境时，相关 Vitest 文件测试会明确跳过。QA 渲染器使用独立 LibreOffice profile 和局部字体配置；不需要原生 Office、也不代表 Office UI 流程已经验收。运行目录见 `.local/office-render-check/manifest.json`。

## 当前交互

2026-11-05 日常版：已有内容包时，可以拖入 Blender，或聚焦 Blender 按 **⌥⌘V**。拖入保留真实鼠标射线，快捷键明确使用按下时的“三维视口中心”；两者先规划、确认后才生成独立预览。收集态仅在候选明确、来源和焦点匹配时显示最多两项轻气泡。

生成预览或应用后回到 Blender；可见结果的真实投影由妥帖自己的独立原生桌面 overlay 短暂标明，Blender 内不绘制产品反馈、不改选区或视图。没有可信区域则不画框，应用/撤回仍可使用。绘制层跨 App 共用，目前只有 Blender 接入真实生成区域；[SOP](desktop-overlay-sop.md) 与 [检查证据](evidence/desktop-overlay-2026-11-05.json) 区分组件验证和待验的物理完整链。

1. 在妥帖点「进入 AI 模式」，或按 `⌘⇧Space`。
2. 在 Chrome 复制参考图片。也可用 macOS 的 `⌃⌘⇧4` 框选截图，或点「截图收集」。截图授权与框选流程仍缺专项验收；复制图片已经验证。
3. 点击 Blender，把妥帖的实际参考缩略图或 `⠿` 拖到窗口内。不占用 `⌘V`，不要求必须命中几何。
4. 模型结合鼠标视图射线、真实命中物体、对象清单、已有内容和图片推荐一个可修改的计划。位置无法确定时应说明并澄清。
5. 在「补充你的要求」输入框中自然语言修改计划，例如“不要新增苹果，把桌面改蓝，再在篮外创建绿色立方体”。这不是预设按钮或固定意图枚举。
6. 确认计划后，Agent 在独立场景副本中通过 MCP 查询、写 bpy 操作并查看真实截图。面板显示实际对象差异。
7. 可以继续用自然语言调整当前临时预览。最终点「确认应用这些修改」才将差异提交到原场景，并退出 AI 模式。可「撤回本次修改」。

本地 GLB 是可选复用资源，不是物体种类白名单。已有合适模型可复用；没有匹配模型或资产库为空时，Agent 通过 Blender MCP 的 bpy/bmesh 按参考创建可编辑近似，包括没有苹果 GLB 时建模苹果。拖图默认提出在真实落点创建参考主体预览的方案，常规尺寸合理决定，真实主体/位置歧义仍追问；焦点刷新、重试或规划中断不会将真实落点换成视口中心。没有接通照片重建或未配置的外部三维生成服务。来源 URL / 标题暂时缺失，面板不伪造来源。当前使用的 MCP 工具为实际发现的场景查询、看图和通用 bpy 执行；其他应用或外部服务需要各自接入。

正式场景的修改有版本与指纹校验，发生变化时要求重新理解。复杂 bpy 数据类型、外部资源和崩溃恢复仍未生产化，不能将当前测试推广为所有 Blender 功能已完整验收。

## 验证与日志

```bash
pnpm probe             # MCP 工具发现、场景信息、真实视口截图
pnpm check:agent-scene # 通用隔离预览、材质/几何差异、提交与撤回
pnpm check:agent       # 真实 Agent Plan + MCP 复合任务验证（消耗套餐额度）
pnpm exec tsx scripts/scene-text-check.ts # 文字来源 → 通用预览 → 取消恢复（消耗套餐额度）
pnpm exec tsx scripts/agent-copy-check.ts # 通用对象复制身份 → 提交 → 撤回校验
pnpm test              # 状态与请求失败等单元测试
pnpm build             # TS 检查与构建
```

`check:agent-scene` 与 `check:agent` 会在测试 Blender 中产生并清理临时修改。请勿在自己的工作工程上运行。

命令行开发检查的数据位于仓库被忽略的 `.local/`；当前桌面应用的数据位于 `~/Library/Application Support/Tuotie/runtime/.local/`：`mcp.log`、`blender.log`、`app.log`、`drag.log`、`drop-event.json`、`task.json`。联调时可 `tail -F .local/drag.log .local/blender.log .local/app.log`。`task-events.ndjson` 与 `agent-api-events.ndjson` 记录状态变化、工具名称、调用用量和耗时，不保存密钥或隐藏推理。`reference.png` 是实际采集的本次参考；不提交剪贴板内容、场景截图或 API Key。

窗口内直接拖入原生图片由小型 FileHandler 桥接；AI 模式退出后恢复 Blender 默认图片拖放处理。上游 MCP 插件保持原样，不写新的复杂 Blender 插件，模型的通用 bpy 工具代码在隔离副本执行并检查边界；不开放系统、网络、其他场景或任意文件访问。

## 已锁定的版本

本机：macOS 26.5.1、Apple Silicon；Blender 5.2.3 LTS、Node 24.20.0、pnpm 11.25.0、Electron 45.0.0、React 19.3.1、TypeScript 7.0.2、MCP TS SDK 1.32.2、Python MCP SDK 1.30.0、mcp-for-blender 2.2.4。JS 依赖见 `pnpm-lock.yaml`；Python 依赖见 `requirements-mcp.txt`。

上游 MCP server 和配套插件来自同一提交 `febcd90ece59c3416d7c55fd3723cea46bcaa59d`。本机 MCP 运行时禁用了上游遥测；视觉请求按当前模型配置发送任务素材。
