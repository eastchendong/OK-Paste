# 仓库协作说明

- 接续开发前先读 `PROJECT_MEMORY.md` 与 `docs/session-handoff-2026-10-28.md`，保留 `docs/session-handoff-2026-10-25.md` 中的 Agent 实现边界。新进展同步更新项目记忆与开发状态。
- 高亮、虚拟 cursor 与遮罩遵守 `docs/desktop-overlay-sop.md`。由独立原生桌面 overlay 跨 App 统一绘制，目标 adapter 只返回真实区域几何。
- 模型默认连接 DeepSeek 官方 Chat Completions。真实 Key 保存于本机 `.env.local`，采集内容与运行日志保存于 `.local/`，均不提交。
