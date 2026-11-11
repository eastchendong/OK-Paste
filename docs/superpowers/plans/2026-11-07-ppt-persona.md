# PPT 画像补齐 Implementation Plan
> For agentic workers: use superpowers:executing-plans.
Goal: 当前页入口完成两张人像去背填入，并保留撤销。
Architecture: adapter 识别严格局部范围，target 提供人物去背参数，独立 Vision helper 处理图片，复用旧事务。
Tech Stack: TypeScript, Office.js, macOS Vision, existing Python PPTX preparation.
Spec: ../specs/2026-11-07-ppt-persona-design.md
## Global Constraints
不提交已有未提交改动或密钥；旧选择对象流程兼容；未明确目标不写入。
## Review Focus
- 页面结构不符合时拒绝；参考头像不可成为目标。
- 两张图片分别映射，缺失或重复不得写入。
- 去背失败没有部分写入。
- 翻页后仍固定原页，手改后版本保护。
- 结束释放，撤销保留已有头像与文字。
## Tasks
- [ ] 为 adapter 无选区入口及非匹配页面编写失败测试；实现独立画像空位识别模块并接入 capture。
- [ ] 为 target 画像模式的工具参数/完整双图映射编写测试；实现单条推荐及去背、contain，保留普通对象流程。
- [ ] 实现本机 Vision 去背 helper，编译并用带背景人物照片验证透明输出。
- [ ] 运行 TS、adapter/target/UI 回归；准备独立示例 PPT 与素材，同步运行版，按真实结果记录实测边界。
