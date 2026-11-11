# dev 到 main 合并记录

日期：2026-11-05。用户确认后已重新 `git fetch origin`，将功能提交 `36f3484` 推送到 dev；main 从 `63ae89d` 无冲突快进至同一功能提交并推送，远端两条分支已回读确认。本文完成记录以独立文档提交同步到两分支，最新 HEAD 以 Git 为准；最终返回 dev。

## 分支关系

- 同步前 main：`63ae89dd0e89c32e48670ba77d1be4439b108e96`。
- 本轮归档前 dev：`d60c47fa00a0e095bd741a8502ade96ac5cef922`。
- 功能提交：`36f3484cabd1fd9b69fdf8def72d69c11aeb2f14`；已推送到 dev 和 main，包含本轮 60 个文件的归档。
- main 为 dev 祖先，功能同步前独有提交数 `0 / 13`。实际使用 fast-forward，无三方冲突，没有重写/删除分支或强推。
- GitHub 的 `main.protected=false` 为执行前只读查询结果；未来同步仍需重新检查远端状态。

## 合并范围

这次同步会包含此前已经进入 dev 的 Office/Figma 实时适配、Agent Core、Blender 自动接入等历史，以及本轮图片 MIME 修复、通用建模说明、持久签名、内容包胶囊/飞行/取消归位、Blender 双入口、候选气泡、独立桌面 overlay 和 memory/SOP。

不能只把它描述成最新一处 UI 修改。使用快进会保留 dev 已有的合并历史，不重写或 squash 其他分支提交，也不删除分支。

## 检查与未验范围

本轮源码实现可归档：231 项后端、109 项桌面交互、3 项签名初始化检查、TypeScript、UI 一致性通过；此前完整 Swift 固定身份构建、独立原生 panel 与真实模型/MCP 场景事务已有分层证据。tracked ZIP 的 UI 资源及可执行文件与当前构建一致，未包含密钥、个人配置或采集内容。

以下仍是待验/后续适配，不应改写成全部 App 已完成验收：

- 物理拖入、⌥⌘V、Esc、跨屏及桌面遮罩覆盖真实生成结果的完整体验。
- Figma/Office 等其他 App 的结果区域适配和通用完成定位。
- 离屏生成结果的自动导航；当前只标明已有可信可见区域。

根目录已有未跟踪 `docs/`、`literature/` 不在本轮提交中；`.env.local`、`.local/`、依赖和构建缓存继续忽略。详见 [开发状态](development-status.md) 和 [overlay SOP](desktop-overlay-sop.md)。

## 已执行过程

功能同步按以下顺序完成；随后用文档提交记录完成状态并同步两分支：

```bash
git fetch origin
git push origin dev
git switch main
git merge --ff-only dev
git push origin main
git switch dev
```

`--ff-only` 保留既有历史；未来远端新增分叉时应重新检查，不强推。本轮沿用已有测试结果，合并本身未修改功能代码；未把待验项目改记为验收通过，也未因 Git 同步重新部署应用。
