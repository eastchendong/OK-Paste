# Figma MCP 适配

**2026-11-04：实验模块保留，产品默认入口已改为 [Figma 实时矢量插件](../figma-live/README.md)。** 本目录的文字、图片和布局副本工具及独立 MCP 检查保留，尚未迁入实时目标的版本链；桌面聚焦不会启动它，产品菜单也不再引导安装它。后续扩展应加入统一入口，不能同时抢占默认 Figma 任务。

妥帖自带一个本机 stdio MCP server 和 Figma Plugin API 插件，独立于 Codex 内的 Figma 连接。它不借用 Codex 的账户、OAuth 凭据或私有接口。模型只看到当前实际连接的设计能力。

## 独立开发检查

1. 在 `prototype/` 显式执行 `pnpm run setup:figma-mcp`，输出到 `.local/figma-mcp-plugin/`，使用独立的开发插件身份。已有清单里的真实 ID 会保留。默认 `setup:figma` 属于新版实时插件，不再调用本模块。
2. 在 Figma 桌面端登记/导入这个独立开发插件，通过开发脚本或 MCP 客户端启动 `scripts/figma-mcp.ts`。运行资源同步不会自动安装或启动旧插件；已存在的 `.local/figma-plugin/` 保留。不要将本机生成的插件、连接码提交 Git 或发给组员。
3. 在要编辑的文件运行「妥帖 MCP」，保持插件打开。当前页选区、有限节点树和几何／填充／文字参与推荐；空选区从当前页新设计开始。
4. 独立工具测试通过 `figma_begin_preview` 在原稿旁建立副本，调用受限的图文工具，导出真实 PNG 后再 `figma_commit_preview`。当前产品 UI 不暴露这条实验流程；不要把它当作新版矢量模式的功能。
5. `figma_undo` 移除本次方案。若已被继续编辑则拒绝覆盖；关闭插件或失去连接时不宣称成功。

## 实现

- `src/figma/client.ts` 用官方 MCP TypeScript SDK 连接 `scripts/figma-mcp.ts`；不是直接把 JSON 请求冒充 MCP。
- MCP 进程只监听 loopback 47723。插件通过 `localhost:47723` 与本机通道往返，使用本机随机连接码和单文件连接约束，不要求 Figma 远程 API Key。
- `figma/plugin/code.js` 是插件源码，setup 编译到 ES2017。UI 使用 Figma 的消息中继，不假定 `event.source === parent`，也不依赖沙盒没有提供的 `crypto.randomUUID()`。
- 创建容器、矩形、文字、放入实际内容包图片，以及修改文字／填充／几何；仅允许编辑本次预览的后代。编辑文字先加载真实字体，创建中文文字优先可用中文字体。
- 编辑既有选区时先调用 `figma_inspect_preview` 获取副本节点 ID；原稿 ID 不可写。桌面进程复用同一 MCP 连接，切换 Figma 窗口不会重复占用端口。
- 当前提供单个选区节点的副本或空画板；多选没有合并编辑语义。节点树限制 300 节点和五层深度，并标识截断，不能声称读到了整个文件。撤回校验节点树中的内容／填充／几何，不是所有高级 Figma 属性的完整版本锁。
- 本轮没有接入图像生成、复杂效果、变量／组件库修改、Figma Slides 或 FigJam。后续可以扩充工具，不通过任意 JavaScript 绕过事务边界。

官方接口依据：[Plugin API](https://developers.figma.com/docs/plugins/)、[清单与开发网络权限](https://developers.figma.com/docs/plugins/manifest/)。本插件是妥帖本机适配器，不宣称是 Figma 官方远程 MCP 服务。

## 验证

`tests/figma-mcp.test.ts` 继续覆盖独立 stdio MCP／HTTP 往返、插件作用域、提交/撤回、断连、连接码、第二文件冲突以及沙盒消息／中文字体。`tests/figma-agent.test.ts` 现覆盖正式的实时入口，确保不会意外启动本模块。测试使用合成夹具，不替代实机验证。

2026-10-30 已在真实 Figma 桌面文件加载插件，经妥帖 stdio MCP 创建中文卡片、导出预览、保留再撤回；顶层节点数从 138 恢复到 138。预览与记录见 `../docs/evidence/figma-mcp-native-2026-10-30.*`。此记录验证工具链，不代表模型能复刻任意设计或已完成用户通过浮窗发起任务的全链路。
