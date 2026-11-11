# wanyiran1107 → dev 合并记录

日期：2026-11-07。用户明确授权合并，并指定双方功能取舍。

## 整合范围

- dev 基线：381b267；合入：6c79be7（共同祖先 2703537）。保留双方历史，以双亲 merge commit 归档。
- 采用 wanyiran 的独立首轮推荐、input-live 输入框、DeepSeek DirectExecutor、动态后续建议、Figma 三场景推荐、实际执行素材绑定、面板恢复和卡片 @ 引用。
- 保留 dev 的 ResultOverlay 原生窗口、PackDragVisual/pack-drag-motion、Blender 快捷键/真实落点/自动连接/程序化建模、图片 MIME 修复、固定签名及安装校验、剪映禁用和实验 Figma MCP 隔离。
- 将本机浅蓝六边形 SVG、角色动作、应用/菜单栏图标和构建资源接入合并结果。原未跟踪 docs/、literature/、prototype/video/ 不纳入。
- 12 个分支冲突与本地变更交叉冲突已逐项解决；生成物由 ui 真值重新构建。修正快捷键异步恢复后的前台核对，防止捕获旧 Blender 窗口；普通输入框捕获也遵守禁用宿主规则。

## Word 高亮原则

移除 Range.highlight/removeHighlight、WordApi 1.8 高亮开关，保留新的章节/段号文案和固定范围修订。新增回归验证移动光标后的修订和撤销不会在 Word 内绘制产品反馈。

本轮没有可靠的 Word 结果几何适配，因此不显示 Word 结果框，不使用旧点击点/当前光标假装插入片段。未来须由 adapter 返回真实结果几何和窗口/任务身份，统一交给现有 ResultOverlay；不能恢复文档内高亮。此项属于待接入能力，不宣称 Word 桌面高亮已完成。

## 验证

- 后端完整回归：50 文件、317 项通过，排除会操作系统剪贴板的 clipboard.test.ts；随后增加禁用宿主输入路径回归，input-paste + word-adapter 共10项通过。
- 桌面：156 项通过，含动态推荐/面板恢复/新 IP/胶囊拖动/固定签名。旧拖动测试补齐新角色 dockBot 的真实结构几何夹具，断言保持飞行坐标与原生命中行为。
- TypeScript、前端/Electron 构建、UI 生成一致性、diff 检查通过。
- package-only 原生构建与固定证书签名验证通过；ZIP 中 UI 和角色 SVG 与源文件一致，无 .local/.env/node_modules。
- 原生 ResultOverlay：真实 panel 穿透/非激活、负坐标、区域镂空和生命周期检查通过；PackDragVisual 五帧渲染通过；WebKit IP 边缘布局、Office 网格及飞行检查通过。
- 输入草稿 Swift 检查覆盖 UTF-16/Unicode、版本替换、原选区恢复及手改拒绝，结果以本轮执行日志为准。

## 部署与边界

本轮更新源码和仓库分发 ZIP，未安装到日常宿主或重启服务，也未修改用户文稿、设计稿、内容包、权限或模型配置。DeepSeek 使用独立本机推荐配置；无 Key 时沿用旧执行路径，提交不含 Key。

没有新增真实 Office/Figma/普通输入框写回或模型语义验收。保留上游普通输入框实机未通过、动态推荐质量缺陷及快速执行候选测速的既有边界。Word 几何接入、跨 App/多屏/物理交互仍按各自记录验收。

合并前 tracked 内容完整备份保留在 stash（pre-merge-wanyiran1107-local-tracked-2026-11-07），不清理该备份。只更新 dev，main 保持原提交。
