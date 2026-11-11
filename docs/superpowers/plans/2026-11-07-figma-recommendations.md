# Figma Recommendations Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task.

**Goal:** 接入三类 Figma 首轮与二轮推荐，复用现有工作流。
**Architecture:** 首轮扩展 core/provider 输入输出与 Figma 适配；二轮扩展 scope 与工作流读回，共用原生矢量工具、状态和 UI。
**Tech Stack:** TypeScript / JavaScript / Vitest / node:test。
**Spec:** ../specs/2026-11-07-figma-recommendations-design.md

## Global Constraints
- 保留所有既有未提交修改，不增加运行依赖，不改系统配置或用户设计稿。
- 首轮一次请求、一条要求；二轮最多三条，可为零。
- 固定画框、真实视觉检查、20版上限、写入未知冻结与撤销边界不变。
- 本轮在现有脏工作区直接接入；不提交、推送或创建会丢失未提交依赖的 worktree。

## Review Focus
- 来源图和目标参考图混用；资料刷新读取新前台。
- 图标/空状态仍被旧提示词强制画成角色。
- 二轮读旧 PNG、候选 PNG 或用户后来收集的资料。
- 迟到建议覆盖新版、撤销缓存或正在输入的草稿。
- 无候选/失败时回落不适用的固定矢量按钮。

### Task 1: 首轮矢量契约与冻结适配
Files: src/agent-core/recommendations/core.mjs / core.d.mts; initial-recommendations.ts; file-runner.ts; tests/figma-initial-recommendations.test.ts.
- [x] RED: vector 只在获准目标接受；三种语义返回场景元数据；目标/参考图独立、冻结刷新、不调用旧规划、失败自行输入。
- [x] GREEN: 扩展输入参考图/输出 vector 和 scene；Figma 首次适配与冻结视觉。
- [x] Verify: vitest run tests/initial-recommendations.test.ts tests/figma-initial-recommendations.test.ts --maxWorkers=2.

### Task 2: 三场景执行与动态后续
Files: followup-scope.ts; followup-recommendations.ts; file-runner.ts; agent-client.ts; tests/figma-followup-recommendations.test.ts; tests/figma-followup-workflow.test.ts.
- [x] RED: 三场景白名单/方向去重、能力隔离、成功版本图、冻结参照、迟到/撤销与空推荐。
- [x] GREEN: 扩展 scope 与提示词；执行泛化；读回 currentArtwork 和成功目标 PNG，沿用请求/版本生命周期。
- [x] Verify: 对应新增与现有 followup / Figma 套件。

### Task 3: 共享界面与交付检查
Files: ui/components/task-panel.js; desktop-preview/tests/figma-followup-recommendations.mjs; package.json; docs/figma-recommendations.md; PROJECT_MEMORY.md; docs/development-status.md.
- [x] RED: 3类动态按钮、一次发送、有草稿追加、过期/失败/无场景不显示固定按钮。
- [x] GREEN: 共用动态入口；构建生成物，更新说明。
- [x] Verify: 后端全套（排除系统剪贴板集成），桌面全套，tsc、build、ui:check、diff；独立最终审查。

## Ledger
Ruling: 用户已批准上条具体设计并要求开始；在现有工作区原位实现，不重复索取批准 — 未提交的新推荐模块是本功能依赖 — 错误成本为需审查与现有工作区的组合改动。
Ruling: 保留现有未提交修改，不自动提交 — 无法把整批他人/先前工作归入本任务 — 本轮以文件和测试记录交付。
Baseline: 受限沙箱 207 passed / 18 skipped，3文件因 loopback EPERM 失败；允许本机端口后 217 passed / 10 skipped，0失败。
Task 1: complete — 6个预期失败 → 11项首轮检查通过，冻结参考图片与 vector/scene 校验。
Task 2: complete — 12个预期失败 → 9文件63项相关检查通过；tsc通过。执行提示保留矢量范围，三场景动态方向隔离，成功回读图片与冻结样式参照、撤销/迟到/结束已覆盖。
Task 3: complete — 5项DOM预期失败 → 90/90桌面检查通过；后端238通过/10外部环境跳过（排除系统剪贴板套件）；tsc/build/ui一致性/diff通过。旧vector-paste用例更新为Figma无伪造固定选项，Illustrator保留。
Live synthetic: 三类首轮全部识别，模型请求1039/1024/1148ms；二轮同样识别，16900/14409/12766ms。首次模型把系列一致性校验包装为优化，已收紧规则并保留语义仍依赖模型的限制。未作真实Figma写入。
Final review: independent read-only reviewer reported one Important/P2 continuity issue: default run drops the initial scene; custom replan receives no prior intent. Added two regression tests and observed expected failures; explicit-new-purpose case remains compatible. Fixed by carrying known Figma scene into default execution and forwarding prior intent to replanning with explicit new scene override.
Ruling: 同目录出现并行DirectExecutor/executionMetrics改动，完整保留并在当前组合代码上复验；运行同步要包含其依赖才能启动 — 不回退其他工作 — 如其尚未通过则不切换运行版。
Final: fixed initial-scene continuity — default-scene-execution/custom-prior-intent tests RED→GREEN; explicit-purpose override passes; final backend 259/259 passed +10 external skipped (clipboard excluded), DOM90/90, tsc/build/ui/diff pass.
Final: Ruling: reviewer declined to judge real Figma rendering and model semantic stability — synthetic/model-only validation is explicitly distinguished from host acceptance; no user file writes — cost: first true host flow still requires verification.
Runtime: confirmed idle/canUndo=false; backed up and synchronized 11 validated files including shared execution dependencies; normal quit/reopen, new runtime session health=true/idle/canUndo=false. Credentials, clipboard content and app signature unchanged.
Finish: keep existing branch/workspace changes, no commit/push/merge. No deferred minors reported.
Ruling: Figma无适用/可用二轮建议时明确保留输入，不回落旧固定矢量按钮；Illustrator与非适用Office保持既有路径 — 用户已要求不伪造建议 — 旧Figma固定入口不再显示。
