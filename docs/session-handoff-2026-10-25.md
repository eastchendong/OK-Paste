# 2026-10-25 技术交接与联调记忆

本文件对应首次上传自然语言 Blender Agent 原型的版本。产品决策见根目录 [PROJECT_MEMORY.md](../PROJECT_MEMORY.md)。这里保留实现位置、已解决问题和未完成工作；不提交本机密钥、原始日志、剪贴板缓存或完整模型消息。

## 可重建的运行环境

验证机器为 Apple Silicon Mac，macOS 26.5.1，Blender 5.2.3 LTS。Node 24.20.0、pnpm 11.25.0；应用依赖按 `package.json` 与 `pnpm-lock.yaml` 精确锁定。Electron 45.0.0、React 19.3.1、TypeScript 7.0.2、Vite 8.3.5、MCP TS SDK 1.32.2。

```bash
cd prototype
pnpm install --frozen-lockfile
pnpm run setup:mcp
python3 scripts/configure_ark_key.py
pnpm start
```

- `pnpm setup` 是 pnpm 自带命令，**应运行 `pnpm run setup:mcp`**。
- setup 使用 PATH 中的 `uv` 创建 Python 3.11 环境。本机曾需把 `$HOME/.local/bin` 加入 PATH。
- 上游仓库实际使用 `https://github.com/ahujasid/blender-mcp.git`，精确提交 `febcd90ece59c3416d7c55fd3723cea46bcaa59d`；server 与 addon 必须配套。Python 包 mcp-for-blender 2.2.4，MCP Python SDK 1.30.0，完整依赖见 `requirements-mcp.txt`。
- setup 将上游代码和 venv 放在忽略的 `.local/`，不提交第三方克隆和环境，也不修改其他 AI 客户端配置。
- `pnpm start` 若 127.0.0.1:9876 不可用，会打开专用测试 Blender，再启动 Electron；端口可用时复用连接。端口存在不证明连的是正确工程，联调前核对实际场景。
- 当前 Blender 路径是 `/Applications/Blender.app/Contents/MacOS/Blender`，不是跨平台打包版本。
- API Key 不包含在 Git；新克隆不能开箱直接调用真实模型，需要自行配置 Agent Plan。

## 实际调用链与代码导航

Electron 主进程 → 官方 MCP TS SDK 的 stdio client → 本地 Python MCP server → Blender addon 的 TCP 9876 → bpy。没有另建 Python 业务后端或 Web 服务。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | Electron 窗口、全局快捷键、剪贴板/截图、原生拖放、IPC 与 drop-event 文件监听 |
| `src/preload.ts` | contextBridge 暴露受控接口；renderer 不拿 Key 或 MCP 直接权限 |
| `src/agent-controller.ts` | 收集、上下文、对话、计划、隔离预览、差异、确认/撤回、状态持久化 |
| `src/agent-client.ts` | Agent Plan 请求、计划结构化工具、动态 MCP 工具定义、多轮执行与截图检查 |
| `src/blender-client.ts` | MCP 工具发现、序列化调用、超时与 `OKPASTE_JSON:` 包装解析 |
| `src/types.ts` | 通用计划、消息、阶段、变更类型；没有固定苹果意图枚举 |
| `src/ui.tsx` / `src/ui.css` | 收集浮窗、可修改计划、自然语言输入、真实预览与对象差异、确认/取消/撤回 |
| `blender/start.py` | 加载测试场景、同版本上游 addon、启动 MCP、注册本地操作桥接 |
| `blender/scene.py` | 创建桌面、开放篮子、相机与灯光；保存空篮子的演示工程 |
| `blender/operations.py` | 图片 FileHandler、AI 模式、drop-event、真实上下文；也保留旧版固定放置操作供历史测试 |
| `blender/spatial.py` | 真实世界包围盒、对象/材质/层级、视图射线、命中、篮子空间补充事实 |
| `blender/agent_scene.py` | 通用预览副本、代码边界、变更检测、提交、取消与撤回 |

旧版 `src/controller.ts` / `src/vision-client.ts` 已从当前源码移除。不要让下一轮开发误把旧固定放置模块重新接到 UI。

## 关键实现细节

### 收集与原生拖放

只在 AI 模式下、收集阶段读剪贴板图片；按 hash 去重，保存真实 PNG。`⌘⇧Space` 切换 AI 模式。缩略图通过 Electron `startDrag` 发出原生图片文件拖放；不占用 `⌘V`。

Blender 图片 FileHandler 接受 PNG/JPEG/WebP。AI 模式临时调整默认图片拖放处理，退出后恢复；任何 Blender 区域的拖入都可发起意图，非视口/无命中时标为位置不确定。drop-event 原子写入，按事件 ID 去重，收集到图片或发生拖放本身不会导入模型。

自动化跨应用拖放曾只能看到 dragstart，未可靠产生 drop；人类用户实际拖放已验证成功。不要把自动化失败当作业务结果，也不要记录成自动化端到端成功。

### 真实位置与已有物体

早期正交相机射线有起点错误：使用旧 region API 时射线起点可能落在几何后面。已改用视图逆矩阵反投影 near/far clip 点，获得真实射线。探针实际命中已有苹果、篮子和桌面。

上下文包括命中表面点、法线、根对象、对象清单、世界尺寸、材质、选择、单位、已有资产标记和场景指纹。已知篮子补充真实篮底与射线平面投影，但它不是通用内部空间/碰撞证明。

曾发现篮外推荐误用了篮底投影点：增加 `cursor.preferredPlacementPoint` 并在提示中明确，篮外以实际 Table 的 worldPoint 为准；篮底投影只能用于相应空间推断。历史对比 evidence 中仍保留修复前的数值，不应据此覆盖现行规则。

### 计划与通用执行

计划用 `present_plan` function calling 返回 title、summary、actions、questions、needsClarification。早期自由 JSON 回答解析不稳定，改用工具参数后真实验证通过。缺少目标或关键条件时澄清，不能偷偷执行。

执行工具定义来自当前 MCP `tools/list`，当前开放 `get_scene_info`、`look`、`execute_blender_code`。模型可组合任务并编写通用 bpy；实际代码走 `agent_scene.run_code` 在预览中执行。工具集合可扩展，尚未配置的付费/外部服务不可伪装成功。

请求使用 120 秒超时、8192 输出预算、`reasoning_effort: low`、最多 16 轮。此前默认思考可能耗满 120 秒；low 已缓解但未解决串行往返耗时。续接 tool messages 时内部保留模型返回的 reasoning_content 以满足多轮协议；不要打印、上传或作为用户输出保存。

`look` 的真实图像以图像消息继续传入模型，不把 Base64 当超长文本。每次代码操作后必须再次看图才能结束；图像观察是校验辅助，不等于严格几何碰撞检测。

### 预览事务

预览复制对象、几何、材质、父子关系及部分约束/修改器引用；用户原场景保持独立。模型代码经 AST 与执行边界检查，限制系统/网络/文件、其他场景及全局原对象访问；这是原型级边界，尚不能宣称恶意代码的生产安全沙箱。

差异跟踪稳定对象标识、变换、网格、材质参数等；确认时提交新增/删除/修改的对象，保留撤回备份。清理预览拥有的数据，支持重复提交幂等、版本/指纹校验，以及提交超时后查询真实状态。

最新源码还包括场景会话身份校验、无变更时的 answer 状态、预览上增量自然语言修改、退出时清理、每次 tool outcome 日志。**这些补充不等于本次用户逐项实测过**；已通过当前测试/构建。发布前没有强行重启用户正在操作的窗口。

不要在活跃预览事务中重载 `agent_scene.py`，其事务保存在 Blender 内存。`scripts/reload-blender.ts` 是开发工具，不是正式恢复机制；不要用它替代事务取消。Blender 会话关闭后的撤回与崩溃恢复尚未完整支持。

## 素材、场景与许可

- 参考照片：Wikimedia `File:Red_Apple.jpg`，Abhijit Tembhekar，CC BY 2.0，原 JPEG 未修改。
- 模型：Kenney Food Kit 2.0 的 apple.glb，CC0。将原配色 PNG 嵌入 GLB；未改几何/UV。实际 Blender 导入为 1 mesh、252 vertices、1 material，512×512 贴图。
- 源地址、授权、修改说明及 SHA-256 见 `assets/manifest.json` 和 `assets/README.md`。苹果 render 是真实 Blender 渲染。
- `assets/scenes/apple-basket.blend` 是可复现的空篮子演示场景；本机活动工程曾由用户加入苹果，不应为复现实验而重置用户当前场景。
- 程序化几何可用于其他意图；苹果资源不是 Agent 能力白名单，没有照片重建能力。

## 证据和检查命令

| 检查 | 已观察的结果 |
| --- | --- |
| `pnpm test` | 12 项当前 AgentController 测试通过，含对话、澄清、取消、场景变化、零差异、增量预览与提交状态查询 |
| `pnpm build` | TypeScript 检查、Vite renderer 与 esbuild main/preload 构建通过 |
| Python AST 检查 | 当前 blender/*.py 和 scripts/*.py 均可解析 |
| `pnpm check:placement` | 历史固定流程真实取消、旧版本拒绝、幂等和撤回检查通过 |
| `pnpm check:agent-scene` | 真实材质修改＋新几何隔离，原场景不变、提交幂等、撤回校验一致；系统访问被拒绝 |
| `pnpm exec tsx scripts/agent-parent-check.ts` | Basket 父层级变换涉及 47 个对象，撤回校验恢复 |
| `pnpm check:agent` | 真实 Agent Plan + MCP 复合任务，4 次工具调用，新增 GreenCube、修改 Table，原场景预览时未变 |
| `pnpm exec tsx scripts/context-plans-check.ts` | 相同参考与请求在篮内/篮外产生不同计划，识别已有苹果 |
| 用户旧版操作 | 图片拖入、加入苹果、撤回成功 |
| 用户新版操作 | 拖放、推荐、预览、应用成功；用户反馈除速度慢无问题 |

真实 Blender 检查会操作场景，真实 API 检查会消耗额度；应在专用演示工程执行，不要为每次文档改动重复跑。后两项脚本按对应配置读取本机运行环境。

可提交的开发者证据：`docs/evidence/compound-agent-result.json`、`compound-preview.png`、`context-aware-plans.json`。本轮用户桌面任务的去素材、去私密运行细节摘要见 `docs/evidence/desktop-flow-2026-10-25.json`。证据中的模型总结只代表当次结果，不自动成为通用正确性保证。

## 性能与下一步

本轮桌面任务 `8e997be5-b655-49fe-b6e7-37e4633294d5`（北京时间）：

| 阶段 | 时间 / 耗时 |
| --- | --- |
| 拖放后开始理解 | 15:36:12 |
| 推荐返回 | 15:36:29；约 16.8 秒 |
| 用户确认后生成预览 | 15:36:56 → 15:41:03；约 247.6 秒 |
| 生成阶段模型请求 | 16 轮，累计约 246.0 秒 |
| 最终确认应用 | 15:41:32；约 0.16 秒 |

预览阶段有 11 次代码工具、2 次场景读取、2 次看图和最后回复；不能仅凭调用数量判断全部必要或全部成功。已增加后续逐工具 outcome 日志，优先定位反复查询/修正的原因，减少往返和冗余上下文，并改善进度反馈。不要以固定苹果脚本替代通用 Agent 来“优化”。

当次 diff 还记录了旧苹果根节点删除/新增和旧 mesh 修改，虽然用户视觉体验正常，后续应核对资产分组和“保留原对象”的语义是否严格保持，不能把视觉通过等同于对象身份不变。

尚需覆盖：用户亲自输入复合自然语言、多轮预览调整；截图授权/框选和浏览器前台全局快捷键专项验证；不同目标/无命中/已有物体的泛化；复杂 bpy 数据提交/撤回；断连重连与崩溃恢复；完整真实录屏。2026-10-27 起，浏览器 Copy 会把文字、图片、视频及其他类型连同 URL、标题写入 `.local/clipboard/`，桌面悬浮窗可以贴到系统剪贴板、留在妥帖或 Blender。扩展仍需在 Chrome 中手动加载。鼠标侧键、分发打包、多平台/多屏验收还没有。具体边界见开发状态。

## 本机数据和常见陷阱

- `.local/task.json` 是最近状态，`task-events.ndjson` 是状态事件，`agent-api-events.ndjson` 是模型耗时/用量，新增 `agent-tools.ndjson` 是后续工具结果。idle 也会写状态，不能再用旧文件残留冒充新成功。
- `.local/reference.png` 是实际采集图片；`--resume-capture` 仅为重启后的开发续接，不是占位图。原始采集图和日志保持本机，不纳入 Git。
- MCP 上游 stderr 的 code/结果较长，排查时做有界摘取，不要在聊天倾倒整个日志，也不要上传完整请求/推理。
- 运行时使用 `DISABLE_TELEMETRY=1` 等环境变量关闭上游遥测；视觉输入仍会按用户配置发送给火山方舟 API。
- esbuild 构建使用 Node API（`scripts/build.mjs`），此前把 pnpm binary 当 Node 脚本执行曾失败。
- `dist/`、node_modules、venv、上游克隆、Key、缓存和日志不提交；构建通过不代表正在运行的 Electron 已热更新。重启前先确认没有用户活跃预览。
- 不依赖文档中的进程 PID 或 exec session ID；恢复时重新检查端口、场景和最近任务。

用户明确授权本次把当前代码和有用上下文上传 dev，再同步 main；不包含发布安装包、外部服务部署或删除有独立提交的分支。
