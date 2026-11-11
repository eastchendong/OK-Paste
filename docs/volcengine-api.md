# 火山方舟 Agent Plan 视觉调用

核对日期：2026-10-25。用户已确认使用 **Agent Plan**；本项目按套餐的专属入口配置。

已使用本机隐藏输入框保存的 Key 完成一次真实视觉请求，成功识别苹果；详见 [验证记录](verification.md)。

## 模型与接口

用户指定的模型为 **GLM-5.3-Flash**。Agent Plan 官方配置使用 **`glm-5.3-flash`**，输入模态包含 `text` 与 `image`。

```text
Base URL: https://ark.cn-beijing.volces.com/api/plan/v3
完整地址: https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions
Authorization: Bearer <AGENT_PLAN_API_KEY>
model: glm-5.3-flash
```

本节记录原有默认方舟连接。用户于 2026-10-28 新要求兼容 OpenAI 标准后，已移除固定地址和模型校验；可在原生设置中选择其他服务。方舟的这组默认值继续保留，其 Key 仍须来自对应服务。新连接说明见 [OpenAI 兼容配置](model-api.md)。

图片使用 `messages[].content[]`，其中一项为 `{"type":"image_url","image_url":{"url":"data:image/jpeg;base64,..."}}`，另一项为 `{"type":"text","text":"..."}`。本地照片直接编码，不必上传公开图床。本项目参考照片约 563 KiB；验证脚本采用单张小于 10 MB 的 JPEG。

`check_vision.py` 只做初期单图苹果识别。当前桌面 Agent 则同时传来源图、真实视口、对象清单和鼠标射线上下文：先用 `present_plan` 工具返回可修改计划，确认后模型通过 MCP 多轮查询、看图与通用 bpy 操作执行，不再局限于固定放置脚本。不把二维截图估计当成准确三维坐标。

## 密钥入口

从仓库根目录运行：

```bash
python3 prototype/scripts/configure_ark_key.py
```

macOS 会显示隐藏输入框。输入不会发送到聊天，脚本不会输出密钥；保存到 `prototype/.env.local`，权限为 `600`，该文件已加入 Git 忽略。此文件为本机明文配置，不是加密密钥库。尚未准备好时可取消，原配置保持不变。

## 验证命令

```bash
# 只检查本地图片、请求结构和模型配置，不发请求、不消耗额度
python3 prototype/scripts/check_vision.py

# 配置密钥后，向 Agent Plan 发送一次真实图片理解请求，消耗套餐额度
python3 prototype/scripts/check_vision.py --send
```

该单图脚本仅使用 Python 标准库，无需安装 SDK；它与桌面 Agent 的完整请求不同。当前 TypeScript Agent 使用 `reasoning_effort: low`、`max_tokens: 8192`、120 秒单次请求超时；不将该模型当作可关闭思考的模型。计划使用工具参数 Schema，执行使用实际 MCP 工具定义并内部保留多轮协议所需的 reasoning_content，不将隐藏推理写入日志或仓库。最终内容为空、输出预算耗尽或请求失败时不认定验证通过。真实请求结果另记录在本目录的验证记录中，不保存密钥或完整请求体。

## 官方依据

- [Agent Plan 接入其他工具](https://docs.volcengine.com/docs/ark/agent-plan-personal-other-tools?lang=en)：OpenAI 兼容 Base URL 和套餐专属 API Key。
- [Agent Plan 接入 Pi](https://docs.volcengine.com/docs/ark/agent-plan-personal-pi?lang=en)：`glm-5.3-flash` 的模型名及 `text`、`image` 输入配置。
- [Agent Plan 接入 OpenCode](https://docs.volcengine.com/docs/ark/agent-plan-personal-opencode?lang=en)：Chat / Responses 接口与模型图片输入配置。
- [图片理解](https://console.volcengine.com/ark/region:cn-beijing/docs/image-understanding)：Base64 与 Chat API 图片消息格式。
- [深度思考](https://docs.volcengine.com/docs/ark/deep-thinking?lang=en)：思考与 reasoning effort 参数；变更模型时重新核对支持范围。
