# dev 归档与 main 可合并性 · 2026-11-07

## 本轮范围

用户要求 update to dev and check merge ability with main。归档 DeepSeek Flash 默认模型/共享本机Key入口与工具回传规范化、强制结构化规划、Blender共享可编辑任务输入框/减少重复规划与截屏/自动纠正上限/一次应用，以及相应回归、脱敏证据和分发ZIP。

本机.env.local、.local、仓库外credentials、原始模型消息/采集、根docs/literature和prototype/video未跟踪素材不纳入。已跟踪的进展文字保留；历史“未提交/未切换”以最新顶部交接为准。此次不更新运行版，也不修改用户文稿或Blender工程。

## 检查

- 最终后端50文件325项通过，排除会改系统剪贴板的clipboard.test.ts；桌面158项通过。
- TypeScript、前端/Electron构建、UI生成一致性、git diff --check通过。
- ZIP中的HTML/live JS/overlay JS与源文件一致，无.env/.local/node_modules；提交内容及包内凭据检查通过。
- 原生WebKit、固定签名构建和真实DeepSeek+隔离Blender预览/应用/撤回的证据沿用本轮已记录结果，不重复消耗API或操作宿主。

## main 合并关系

fresh fetch：origin/dev基线89ca624，origin/main为381b267。main已在dev历史中，无main独有提交。Git merge-tree预检没有冲突，可将main快进到最终dev提交；当前不存在需要解决的合并冲突。

归档新增提交后复核main仍是dev祖先、merge-tree无冲突，并回读远端dev确认推送结果。最终提交哈希以git log和远端refs为准。

本轮只更新dev并检查main。main保持381b267；未合并或推送main、未强推、未改写/删除分支。后续同步main不需要再解决这批代码冲突，但仍应先fresh fetch检查是否有新提交。
