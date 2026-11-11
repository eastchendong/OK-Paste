# DeepSeek 多轮图片请求排查 · 2026-11-07

## 已修复的请求兼容问题

DeepSeek 非流式返回的工具调用包含 `index`。原实现直接重放 provider 的 tool_calls 对象。现在在统一请求边界重建标准 `id/type/function.name/function.arguments`，并保留工具结果的 call ID 与图片字节；同时覆盖通用 ModelGateway、快速执行的候选纠正回合。没有新增业务重试、删图、伪造工具调用或改变目标执行/撤销协议。

HTTP 夹具会返回带 index 的真实工具响应，并拒绝客户端在后续请求重发该字段。该检查及字段/图片不变性检查通过。

## 真实调用结果与限制

官方模型目录 HTTP200，包含 deepseek-flash。首轮图片工具调用、普通工具调用和JSON推荐均有成功记录。同一份已成功回复清理额外字段后，多轮图片请求实际 HTTP200 一次。

但原字段图片请求503，后续清理字段的图片请求也503；通用网关多轮请求超时。独立后台 Blender 的首轮规划尚未进入工具历史就503，服务明确返回 Service is too busy。因此不能断言之前所有500都由index导致，也不能把一次成功当作整体稳定。服务繁忙和请求超时仍阻塞完整 Blender 验收。

本轮320项后端检查、TypeScript、前端/Electron构建、UI一致性通过，追加33项HTTP/网关/执行器定向检查通过。真实请求仅使用合成图和隔离场景，没有操作日常工程。隔离后台与事务按脚本finally清理。

最后一次顺序复验中，隔离 Blender 规划已成功（约36秒），但随后首轮建模执行仍HTTP503；失败发生在工具执行前，finally取消预览并关闭独立后台，没有提交场景。日常服务复核 healthy/idle、canUndo=false、mutationUncertain=false。

## 运行版门槛

按用户要求：多轮图像与隔离 Blender 验证通过后才切换日常宿主。当前未更新runtime、未安装/重启App，保留原运行模型。已完成的默认DeepSeek/shared Key配置和格式修复均在本地，尚未commit/push；Key仅存忽略配置和仓库外私有文件。

官方依据：[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/)、[Vision](https://api-docs.deepseek.com/guides/vision/)。脱敏证据见 [JSON](evidence/deepseek-multimodal-2026-11-07.json)。原始合成请求和进程日志留在忽略的.local，不纳入公开证据。
