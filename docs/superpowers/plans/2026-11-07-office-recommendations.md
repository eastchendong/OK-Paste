# Office 首次推荐 Implementation Plan
> For agentic workers: use superpowers:executing-plans.
Goal: Excel 两个 P0、PPT 头像补齐一个 P0 接入原浮窗首次推荐。
Architecture: 复用 recommendation core/provider；适配结构化工作簿/当前页证据，模板由场景类型注入。PPT page capture 为只读，不扩大选区。
Tech Stack: TypeScript, Office.js, existing DeepSeek provider.
Spec: ../specs/2026-11-07-office-recommendations-design.md
## Global Constraints
仅推荐；执行链保持原有授权；不实现去背；不提交其他已有改动。
## Review Focus
空工作表/已有表头、PPT 非画像页、无图片、空选区不可写入、失败不调用旧规划兜底。
## Tasks
- [ ] 添加 Excel/PPT 输入适配和模板注入失败测试。
- [ ] 扩展单次推荐 contract 的场景类型与模板，适配结构化目标证据。
- [ ] 添加 PPT 当前页只读捕获测试，保留旧对象选择与写入校验。
- [ ] 运行回归、真实 API 及运行版检查，记录耗时和未实测部分。
