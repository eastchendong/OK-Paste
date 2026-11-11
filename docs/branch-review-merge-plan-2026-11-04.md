# wanyiran1104 与 dev 分支审查及合并计划

> 后续执行取舍已由用户明确：UI 优先 wanyiran；Figma 默认采用 wanyiran 实时接入，dev 的图文能力先保留实验代码；剪映暂时禁用；解决冲突后更新 dev。下文保留合并前的审查基线和原计划，执行后的当前状态见 [APP 接入与合并记录](app-integration-2026-11-04.md)。

审查日期：2026-11-04。建议以 `dev` 为最终集成分支，采用 `wanyiran1104` 的 UI、Agent Core、Office 实时修订与 Figma 矢量流程，保留 `dev` 的剪映修复及 Figma 图文布局能力。Figma 的入口、安装目录和事务协议需要专门整合，不能用整分支覆盖或统一选择 ours/theirs 解决。

## 1. 审查基线

| 项目 | 本次范围 |
| --- | --- |
| 共同祖先 | `5aec84c441320bc61c045e4a5b94e60777a332cd`，也是本地记录的 `origin/wanyiran1029` |
| dev | `cb0948a`；分叉后 5 个提交 |
| wanyiran | `wanyiran1104` 的 `2703537`；分叉后 1 个整合提交 |
| 分叉后文件改动 | dev 32 个，wanyiran 134 个，双方同时修改 12 个路径 |
| 两个 tip 的差异 | 154 个文件，5,003 行增加、1,318 行删除；包含测试、文档、生成物和 ZIP，不代表纯业务代码量 |
| 合并预演 | `git merge-tree --write-tree dev wanyiran1104`：8 个冲突路径 |
| 远端时效 | 两次 fetch 均因 GitHub TLS 连接错误失败；本地分支与已有 origin 跟踪引用一致，但不能保证包含远端最新推送 |

当前检出 `wanyiran1104`。开始审查时，`PROJECT_MEMORY.md`、`development-status.md` 已有未提交的本机安装记录，还有未跟踪的根目录 `docs/`、`literature/` 和 Figma 安装证据。这些不计入分支 tip 对比，继续保留。

历史关系：

```text
5aec84c 共同祖先
├─ 9e53949 Figma MCP 与剪映草稿可移植化
│  └─ 64dc1a0 剪映 11.6.0 不兼容保护
│     └─ 63f5ebf / 7af74df / cb0948a 研究与独立插件验收记录 → dev
└─ 2703537 UI、Agent Core、四平台流程整合 → wanyiran1104
```

因此，tip 对比中 `figma/` 显示“删除”，只是该能力仅存在于 dev；不是 wanyiran 在自己的分支里删除了 dev 后来实现的 MCP。Office 实时接口、原生玻璃组件、已有来源跳转与快捷键已经属于共同祖先，也不能全部算作本次新增。

## 2. UI 与交互

| 维度 | dev | wanyiran1104 | 合并建议 |
| --- | --- | --- | --- |
| 内容包默认形态 | 新内容以卡片堆叠展开；点击堆叠进入列表，点击卡片打开详情 | 新内容默认展开紧凑列表；文字直接显示正文，图片/表格显示实际预览；用底部计数胶囊切换堆叠 | 采用 wanyiran |
| 内容详情和来源 | 标题、类型和来源呈现在卡片/详情中 | 悬停或键盘聚焦展示独立浮层，包含完整内容、应用图标和来源链接；不再点击卡片开模态框 | 采用 wanyiran；保留键盘可达与浮层命中区域检查 |
| 图片来源 | 右键采集已有网页 URL/标题，但可能缺少采集应用身份 | Chrome 采集端写入 appName/bundleId；原生按记录身份补图标，不用当前前台 App 猜来源 | 采用 wanyiran；旧记录不凭空补归属 |
| 实时粘贴面板 | Office 输入框和三条独立建议 | Office/Figma 实时任务采用单条真实默认推荐；空输入发送推荐，自定义文字覆盖；助手、输入和来源放在同一面板 | 采用 wanyiran；默认推荐不是写死占位文案 |
| 生成和完成 | 共用生成/结果/继续调整组件 | 实时任务生成中简化为加工状态和停止；成功后直接展开撤销、轻量调整与来源列表 | 采用 wanyiran |
| 目标和草稿 | 已捕获宿主 Range/对象，但任务锁定、收尾和连续修订规则较早 | 未结束任务禁止重新捕获；点击其他位置、跨软件不改目标；显示真实插入位置，结束后清理草稿和锚点 | 采用 wanyiran；保留全链路契约 |
| 快捷调整 | 独有 design（间距/参考配色）、video（转场更短/减弱特效） | 新增 vector（路径/配色）、presentation（选中文字）并优先采用目标声明的 profile | 合并选项库与 profile 映射，不能让剪映回退到“更简短/语气” |
| 失败与重连 | 较早的停止/失败反馈 | 区分处理中、已保留上一版、写入结果未知；未知状态禁重发；服务重启清掉失效撤销 UI | 采用 wanyiran 的状态规则 |

代码依据：`ui/components/collection-controller.js`、`collection-hover.js`、`content-card.js`、`task-panel.js`、`ui/styles/collection.css`、`desktop-preview/desktop-live.js`、`Sources/SourceLocation.swift`。本轮是源码与 DOM 交互审查，没有重新进行原生窗口视觉验收。

## 3. APP 接入与能力

| 应用 | dev | wanyiran1104 | 判断 |
| --- | --- | --- | --- |
| Word | 已有真实 Office.js 光标捕获、全文上下文、纯文字原位插入、调整与撤销 | 新增受约束图文 Patch、基础格式、段落/行内边界、V2→V1→V0；新候选失败保留旧版 | wanyiran 明显更完整；仍只编辑本任务新增范围，不是任意全文重排 |
| Excel | 已有真实选区、工作簿上下文、值/公式写入及撤销 | 区分公式与公式样纯文字，null 清空；保留数字格式；版本链、计算错误反馈、复杂区域写入前拒绝 | 采用 wanyiran；ExcelApi 要求由 1.4 升到 1.13，须更新清单并检查兼容性 |
| PowerPoint | 已有真实选中图片/头像空位替换、全稿上下文、直接写入与撤销 | 图片加单段文字编辑；字体/对象 ID 映射保护；完整候选与多版本撤销 | 采用 wanyiran；混合字样、复杂动画等仍拒绝，图片重建不承诺原 ID 或文件字节一致 |
| Figma | 自有 stdio MCP + HTTP 插件，偏图文与布局副本 | 共用本机 HTTPS 文档桥 + Plugin API，偏目标 Frame 内可编辑矢量创作 | 能力互补，详见下表；不能直接互相替换 |
| Illustrator | 无这套实时适配器 | 新增 CEP/ExtendScript 宿主、捕获画板与受约束矢量写入 | 保留为实验能力；未完成真实 Illustrator 验收，也没有 Figma 同等的多版本/视觉闭环 |
| 剪映 | 草稿自带真实素材、加密元数据回退根索引、索引 ID 维护、11.6.0 不可打开保护 | 沿用共同祖先版本，没有上述 dev 独立修复 | 保留 dev；独立新 MCP 插件播放通过不等于妥帖已经切换后端 |
| Blender | MCP、真实场景/落点、隔离预览、看图、确认与撤销 | 专用 SceneRunner/MCP/bpy 实现无分叉改动，模型公共层有重构 | 保留通用 Agent 与隔离预览；合并后做回归，不计作新扩展 |
| 已保存 DOCX/XLSX/PPTX | 三类文件适配已在共同祖先存在 | 保留，PPT 文件处理有配合实时图文的改动 | 保留独立文件预览/确认语义，不套用实时任务自动写入规则 |
| 普通应用 | 真实窗口/可读选区生成待粘贴文字，确认后复制 | 同一能力，公共任务生命周期有升级 | 仍不宣称任意 App 原位写回 |

### Figma 必须分清的两条链

| 项目 | dev 的 FigmaTarget | wanyiran 的 FigmaLiveTarget |
| --- | --- | --- |
| 通道 | `src/figma/` → stdio MCP → loopback HTTP 47723 → 插件 | `OfficeBridge` → 本机 HTTPS 47722 → Figma 插件 |
| 入口 | 聚焦 Figma 自动路由；菜单“连接 Figma…” | 在 Figma 选 Frame，按 ⌥⌘V 捕获 |
| 目标 | 单个选区的克隆，或空选区的新画板 | 页面顶层、未锁定、无自动布局的单个 Frame |
| 写入能力 | 创建 Frame、矩形、文字，放入内容包图片；修改副本的文字、填充、几何 | 受约束 path/ellipse/rect 数据编译为 SVG，导入目标 Frame；暂不生成文字或位图 |
| 原稿关系 | 在旁边独立副本上编辑，用户确认后保留 | 在固定 Frame 内新增/替换本任务作品，不编辑已有原图层 |
| 视觉验证 | 可导出真实 PNG 供查看；未实现同等的强制模型看图 review 协议 | 临时克隆渲染真实 PNG，模型必须审核最新 candidateId 后才能写入 |
| 撤销 | 单结果保护，不具备 wanyiran 同等的 revision/未知写入协议 | 每任务最多 20 版，V2→V1→V0；手改拒绝，未知写入冻结 |
| 已有证据 | 真 MCP/Plugin API 中文卡片创建、导出、保留、撤回；不是完整模型 UI 验收 | 合成稿真实模型生成/修订、快捷键、固定目标、视觉检查及逐级撤销记录 |

推荐产品方向：保留“矢量创作”和“图文布局副本”两种能力，统一到显式捕获目标的任务入口。第一阶段默认沿用已验收的矢量流程；dev 的图文副本通过明确的独立入口保留，在协议适配完成前不自动抢占 Figma 焦点路由。不能合并后悄悄宣称一种模式覆盖另一种能力。

当前本机已经安装并连接新版矢量插件是工作区的额外安装记录；连接成功不等于本轮重新完成上述编辑验收。

## 4. Agent、事务与运行工程

| 层 | 主要差异及合并原则 |
| --- | --- |
| Agent Core | wanyiran 拆出 ModelGateway、ContextBuilder、ToolLoop、ExecutionPolicy、TaskWorkflow；保留 AgentClient 兼容外观。采用该结构，无新增 LangChain/LangGraph 运行依赖 |
| 执行策略 | Word/Excel/PPT 实时目标单完整候选，失败可在预算内修正；Figma 为最多 6 轮的有界观察/修正。Blender 保留原专用视觉工具循环 |
| 版本事务 | `EditableTarget` 增加可选 revision、mutationUncertain、locationLabel、adjustmentProfile；FileRunner 保存对应成功结果和对话。老适配器能编译不意味着自动拥有这些保证 |
| 传输 | 共享 bridge-client 处理串行批次、丢回执补发、过期命令和服务会话失效；不能把这套保障自动归到 dev 的独立 FigmaBridge |
| 原生宿主 | wanyiran 增加 watchdog、启动退避、日志句柄复用与 workRevision，防止旧等待回调终结新任务；dev 增加 Figma 菜单、路由和名称 |
| 依赖 | 两个 tip 的 pnpm-lock、运行依赖无差异；package.json 主要差异是 dev 的 setup:figma 命令。没有必须升级整套依赖的理由 |
| UI 生成 | `ui/` 是源码；HTML、overlay、浏览器/Swift 组件应统一重生成，不手动拼接生成物 hash |
| 分发 | 两边都修改已跟踪 ZIP；必须从最终源码重新构建。不能任选一个旧 ZIP 当作合并后的版本 |
| 范围外 | `PPT/` 概念汇报、README、AGENTS 与根忽略规则无本次 tip 差异，不纳入原型合并改版 |

两边都没有跨服务/插件重启恢复完整事务的能力。新核心使状态更清楚，但不是持久化工作流已经完成。继续保留 10 月 25 日的 Blender 通用 Agent、受限工具、真实预览、确认提交和撤销边界。

## 5. 优先处理的合并问题

### P1 两套 Figma 插件默认写入同一目录

dev `scripts/setup-figma.ts:3–7` 无条件写 `.local/figma-plugin/` 的 code、UI、manifest，manifest 不保留已注册 ID；wanyiran `scripts/prepare-figma-plugin.mjs:7–16` 使用同一默认目录，并要求保留 Figma 分配的真实 ID。两者顺序执行会覆盖另一插件协议，甚至使下一次 prepare 因缺少 ID 失败。

此外 dev 在 `prepare-desktop-runtime.mjs:36` 自动运行 setup。即使复制目录冲突选成两边并集，这条自动命令仍可能覆盖已有矢量插件。应为两个模式使用独立输出目录、身份和清晰菜单；安装时识别既有插件，不覆盖、不编造 ID。复用已经信任的证书与既有授权。

### P1 Git 能自动合并 Figma 路由，但产品入口不一致

dev `src/app-context.ts:7` 让 Figma 聚焦自动进入 `FigmaTarget`；wanyiran `desktop-live.js:324` 把 Figma 视为显式粘贴宿主，`collection-controller.js:224` 会隐藏其非显式任务的推荐面板。快捷键又通过 `beginFigmaPaste` 走另一个 `FigmaLiveTarget`。

这是代码组合可推导的语义风险，尚未进行合并版原生复现：后台可能准备 MCP 任务，而可见入口要求 HTTPS 插件。应先决定模式路由；不能只看到 desktop-agent.ts 无冲突就认定兼容。新增检查必须带真实 focusContext 并验证按钮可见与可点击，不能只 dispatch 内部事件绕过 UI。

### P1 采用 wanyiran 快照覆盖 dev 会丢失剪映正确性修复

dev `targets/jianying.ts:22,83` 在已验证不兼容的 11.6.0 拒绝添加草稿；同文件还补齐素材复制、路径授权检查、索引元数据和 draft_ids。整分支替换会恢复“注册草稿成功但原生打不开”的路径，或让草稿继续依赖采集缓存。

正常三方 merge 会自动保留这些仅 dev 修改的文件；风险来自强行用 wanyiran 整体覆盖。保留 dev 文件与测试。新 Jianying Local MCP 的独立播放验证属于后续后端迁移依据，不能据此删掉当前后端的版本保护。

### P1 解决 UI 冲突时必须合并控制语义

`main.swift` 的同一段冲突，一边增加 figma 目标，另一边给 runAgent/finishWork 增加 revision。只留 dev 会丢新签名/代次控制，只留 wanyiran 会丢 MCP 目标。`desktop-live.js` 同时包含未知结果冻结、后端重启、design/video/vector/presentation profile 和不同提交语义。应逐块合并，不整文件选边。

dev FigmaTarget 没有 revision/mutationUncertain，不能因为新 FileRunner 字段是可选的，就在产品里显示它也能逐级撤销或自动安全重试。原有保留副本模式先如实维持边界，后续接入同等协议。

### P2 协议和生成物需要一起升级

Word/Excel/PPT/Figma 的目标、宿主脚本、bridge-client、协议检查和 UI 应作为一组交付。旧加载项需要重开；Excel 清单需要同步 1.13。构建脚本目录列表应包含两个保留的 Figma 模式及 illustrator-live，随后重生成所有 UI 派生文件、构建原生程序与 ZIP。

## 6. 逐文件冲突处理

以下为 merge-tree 实际报告的全部 8 个冲突路径：

| 文件 | 处理方式 |
| --- | --- |
| `PROJECT_MEMORY.md` | 合并双方新增事实；顶部增加唯一当前能力/合并状态，保留历史证据限定与本机额外安装记录 |
| `prototype/docs/development-status.md` | 合并当前能力与证据；区分旧剪映后端不可用、新插件独立验证、Figma 两种模式 |
| `prototype/desktop-preview/Sources/main.swift` | wanyiran 的 revision/watchdog/快捷键为主，保留 dev 必要的 Figma 连接/执行/目标导航能力，并按统一模式重命名入口 |
| `prototype/desktop-preview/desktop-live.js` | 合并状态逻辑及五类调整 profile；保留 dev 副本预览/保留操作，不给 live 模式加回二次确认 |
| `prototype/scripts/prepare-desktop-runtime.mjs` | 复制保留目录并集；修改自动 setup 行，隔离输出目录并避免覆盖已有插件 |
| `prototype/desktop-preview/Sources/ComponentLibrary.generated.swift` | 从最终 UI 源重新生成 |
| `prototype/src/browser/selection-component.generated.ts` | 从最终 UI 源重新生成 |
| `prototype/desktop-preview/preview/TuotieDesktopPreview-macos-arm64.zip` | 最终阶段重新构建，不作为文本冲突解决 |

没有报冲突但必须复核：`src/app-context.ts`、`src/desktop-agent.ts`、`ui/components/task-panel.js`、自动合并的 `components-preview.html` 和 `tests/ui-components.mjs`，以及 dev 的 setup 脚本。`components-preview.html` 即使自动合并，也要用源码重新生成。

## 7. Merge plan

| 阶段 | 要做什么 | 完成门槛 |
| --- | --- | --- |
| M0 冻结输入 | 网络恢复后 fetch，重新核对两个 SHA 和 merge-base；保全未提交文档/未跟踪资料；从 dev 创建 `codex/merge-wanyiran1104` 集成分支 | 不混入本机密钥、证书、采集内容或旧运行日志；若远端前移，重算差异 |
| M1 选定 Figma 路由 | 默认使用显式 ⌥⌘V 的矢量模式；保留 dev 图文布局副本为明确独立入口。隔离两个插件输出目录，决定菜单与安装迁移 | 同一任务只选一个适配器；两种插件不会覆盖 ID、UI、连接码；没装对应插件给出对应提示 |
| M2 三方合并源码 | 在集成分支执行非快进、暂不提交的 merge；采用 wanyiran UI/Core/Office 协议整体，保留 dev 剪映与 Figma 工具能力；按上表解决冲突 | 不丢三类 Office 既有能力、Blender 事务或 dev 功能；旧 Figma 模式不冒领新事务保证 |
| M3 生成与自动检查 | 重生成 UI/原生组件，运行 TypeScript、两边测试的并集；补路由/安装/profile/回调代次交叉检查 | 所有正常用例通过；各分支后端套件串行运行，避免共用系统剪贴板冲突；外部环境跳过显式列出 |
| M4 跨应用验收 | 独立合成稿验证 Word/Excel/PPT 两版与逐级撤销、停止/手改保护；Figma 矢量与副本模式分别走可见入口；Blender 预览/取消/应用/撤回；剪映保留拒绝并检查素材自包含 | 真实宿主内容符合预期；目标固定；不误归档；异常不重放。MCP/DOM 通过不能替代原生视觉或物理快捷键证据 |
| M5 分发并回 dev | 在源码验收后构建 Swift、运行资源和 ZIP；保留应用身份、证书与权限；合并证据文档，再将集成分支正常合回 dev | ZIP/运行源码一致；记录构建 SHA；不强推、不删除任一分支、不自动同步 main |

建议保留一个含双方历史的 merge commit，再用独立 fix commit 收敛安装、路由和测试。不要直接 cherry-pick `9e53949` 到 wanyiran 作为唯一方案：它混合 Figma、剪映、UI、生成物和分发包，仍需同样的语义审查。也不建议从大提交中仅挑 CSS/JS，把宿主协议和状态机遗漏。

后续可单独安排两项增强，均不应阻塞保留现有能力的基础合并：一是将 dev 的图文/布局能力迁入统一 Figma 宿主协议和版本链；二是正式迁移新的 Jianying Local MCP。后者必须实现保存退出/发布/重开、素材授权、预览与撤回后再替换旧后端。

### 自动检查与验收命令

以下以 `prototype/` 为工作目录，适用于最终集成源码；不要在日常运行目录并行启动真实宿主验收服务。

```bash
pnpm run ui:build
pnpm run ui:check
pnpm exec tsc --noEmit
pnpm test
pnpm --dir desktop-preview test
git diff --check
```

随后在隔离构建环境编译 Swift，按应用清单执行真实宿主检查。`desktop-preview/build.sh` 会涉及本机 runtime/安装流程，不能把它当成无副作用的纯编译命令直接对日常服务运行。构建或切换前先结束活跃任务，复用现有安装身份与已授权配置。

## 8. 本轮检查结果

测试使用从两个提交导出的隔离源码副本，复用同一套已锁定 Node 依赖；未复制本机 `.env.local`、宿主连接与个人采集数据。

| 检查 | dev cb0948a | wanyiran1104 2703537 |
| --- | --- | --- |
| TypeScript | 通过 | 通过 |
| UI 生成一致性 | 通过 | 通过 |
| 后端 Vitest | 105 通过 / 11 跳过 | 182 通过 / 10 跳过 |
| 桌面 DOM/交互 | 44 通过 | 68 通过 |
| 本轮原生宿主/模型/Swift/分发验收 | 未重跑 | 未重跑 |

首次并行运行两分支后端套件时，wanyiran 的系统剪贴板断言读到了另一套件写入的探测文字；串行完整复测后 182 项通过。该失败来自共享 macOS pasteboard 的并发测试干扰，不作为业务缺陷；后续双基线检查串行执行。测试自身会临时写系统剪贴板并在 finally 恢复此前文字。

跳过项涉及隔离副本没有安装的 Office/Jianying 可选 Python 环境，不能称全部外部适配已经重新验证。既有原生证据分别见 `docs/four-platform-interaction-checklist.md`、`docs/evidence/*2026-11-03.json`；dev 的补充证据在 `cb0948a:prototype/docs/session-handoff-2026-10-30.md` 与 `figma-mcp-native-2026-10-30.*`。

本轮没有执行实际分支 merge、提交、推送、安装或重启应用。merge-tree 只生成了审查树；两边基线测试通过不代表尚未实施的集成版本已验收。
