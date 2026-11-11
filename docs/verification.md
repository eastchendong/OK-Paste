# 准备阶段验证记录

日期：2026-10-25。

## 素材

- 下载的照片与模型已记录来源、许可及 SHA-256，见 `assets/manifest.json`。
- 苹果 GLB 已嵌入原颜色贴图，无外部图片依赖。
- 在独立的 Blender 5.2.3 LTS 后台进程实际导入并渲染：1 个网格、252 个顶点、1 个材质、512 × 512 贴图载入成功。
- 尺寸与包围盒见 `assets/models/apple-info.json`；本机渲染见 `assets/models/apple-render.png`。

## Agent Plan 真实调用

- 本机隐藏输入框已保存用户提供的 Agent Plan 专属 Key，文件权限 `600`，由 Git 忽略。
- Base URL：`https://ark.cn-beijing.volces.com/api/plan/v3`。
- 请求：`POST /chat/completions`。
- 模型：`glm-5.3-flash`。
- 输入：`assets/reference/apple.jpg`，Base64 JPEG，搭配物体识别文字提示。
- 结果：成功返回最终回答，识别主体为苹果，描述红色主体、黄橙色果洼与略扁圆形状，并说明图片中未出现篮子。
- `finish_reason`：`stop`。
- 用量：输入 6939 tokens，输出 286 tokens，总计 7225 tokens；输出中推理 176 tokens。
- 未保存密钥、完整请求体或隐藏推理内容。

## 后续集成验证（同日更新）

后续已完成 MCP 工具发现、真实场景/截图探针、临时预览与场景操作检查。用户在桌面上实测拖放后确认：“已成功加入苹果，并能撤回”。新版入口采用拖放，不占用粘贴快捷键。

场景集成检查确认取消保留原场景、旧预览版本被拒绝、重复确认不重复导入、撤回恢复原对象和变换。8 项状态/错误控制单元测试通过。完整实现与尚未覆盖的项目见 [开发状态](development-status.md)，不以单图 API 测试代替完整验收。

## 新版 Agent 与上传前验证（同日后续）

上述 8 项是历史固定流程记录；当前 AgentController 已有 12 项测试，上传前全部通过，TypeScript 检查、Vite/esbuild 构建及 Python AST 解析通过。真实复合自然语言工具调用、事务与层级撤回另有检查，见 [技术交接](session-handoff-2026-10-25.md)。

用户曾误点“已完成对话、预览和应用”，明确作废该回执；之后实际操作新版并反馈“整体下来除了比较慢没有问题”。本机事件日志确认拖放、推荐、预览、确认应用完成，见 [去私密数据的本轮摘要](evidence/desktop-flow-2026-10-25.json)。用户本轮没有输入复合自然语言的日志，不据此宣称所有对话功能已由用户逐项验收。
