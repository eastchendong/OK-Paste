# 模型连接与 OpenAI 兼容接口

在 macOS 顶部妥帖小人图标 → 设置中填写：

- **API Base URL**：默认 `https://api.deepseek.com`，也接受以 `/chat/completions` 结尾的完整地址。
- **模型名称**：默认 `deepseek-flash`。使用其他服务时填写其模型 ID。来源图片需要视觉输入，Agent 执行需要 function tools。
- **API Key**：对应服务的 Key。留空保留同一地址现有的 Key；更换地址后不沿用旧 Key。本地无认证服务可以留空。

保存到本机 Application Support/Tuotie/runtime/.env.local，权限 0600。下一次模型请求会读新地址、模型和 Key。公开的 `/v1/settings` 只返回快捷键，不返回密钥。新字段为 `OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_API_KEY`；旧 `ARK_*` 继续兼容，新字段优先，包括显式空 Key。

本轮实现 **Chat Completions**，没有实现 Responses API。请求使用 `messages`、`image_url`、function `tools`，工具结果按 `tool_call_id` 回传。OpenAI 官方请求使用 `max_completion_tokens`；传统兼容服务使用 `max_tokens`。原有方舟 GLM Plan 仍保留已验证的 `reasoning_effort: low`，普通兼容服务不带这项参数，也不回传方舟专属 reasoning_content。

DeepSeek 默认值见[官方模型文档](https://api-docs.deepseek.com/quick_start/pricing/)。协议依据：[OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。`tests/openai-compatible.test.ts` 用真实本机 HTTP 服务检查多模态输入、function tool 往返、配置热更新和密钥脱敏；这些是协议合约检查，不代表对每家服务、每个模型或 OpenAI 官方账户的远端验收。

开发者原有 `configure_ark_key.py` / `check_vision.py` 仍是特定方舟的辅助工具；普通用户使用设置窗口，无需修改代码。设置窗口不发起连接测试；后续任务使用新配置。
