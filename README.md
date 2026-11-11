# 妥帖 / OK Paste

基于参考内容、当前应用/目标位置和自然语言工作的本机桌面 Agent。日常入口为 Swift/AppKit 悬浮宿主，加载共享 HTML/JS 并启动 TypeScript 服务；Electron/React 入口保留作历史开发用途。

**接手先读 [当前交接速读](docs/current-handoff.md)**。本仓库以课程仓库中已跟踪的原型文件为起点，包含拆分时这些文件的本机修改。

| 需要了解 | 入口 |
| --- | --- |
| 当前状态、下一步、本机配置 | [当前交接速读](docs/current-handoff.md) |
| 各 APP 的入口和支持边界 | [APP 接入记录](docs/app-integration-2026-11-04.md) |
| 启动、自动连接、联调 | [运行说明](docs/run.md) |
| 历史进展与验收证据 | [开发状态](docs/development-status.md) |
| 用户要求与决策 | [项目记忆](PROJECT_MEMORY.md) |
| UI 源码与生成规则 | [UI 说明](ui/README.md) |
| Agent 实现边界 | [10 月 25 日交接](docs/session-handoff-2026-10-25.md) |

新配置默认使用 DeepSeek 官方 Chat Completions（`https://api.deepseek.com`，模型 `deepseek-flash`）。在妥帖菜单「设置」填写自己的 API Key，详见[模型接口](docs/model-api.md)。

当前快照的拖放与结果反馈仍有源码依赖留在原工作区，构建状态见[项目记忆](PROJECT_MEMORY.md)。

已安装时直接打开 `~/Applications/妥帖.app`。不要为日常使用执行旧版 `pnpm start`。运行数据保存在 `~/Library/Application Support/Tuotie/runtime/.local/`，密钥和采集内容不提交。

Blender 已配置普通启动后自动接入；Figma 插件需打开一次，运行后自动连接和重连。连接成功不等于生成或写入成功；Blender 仍需预览后确认，普通应用仍需用户手动粘贴。完整支持范围见上表文档。

组件源在 `ui/`，`components-preview.html` 等由脚本生成。[桌面宿主与分发包说明](desktop-preview/README.md) 保留安装和打包方法。概念汇报存放在原课程仓库。
