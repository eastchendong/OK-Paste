# 浅蓝六边形 · 动效初版

用户于 2026-11-06 选用浅蓝六边形，用于原型与后续视频。当前交付为桌面浮窗角色和工作／成功两种动效，可直接打开 `prototype/companion-motion-preview.html` 评审。

## 设计与参考

角色、帽子、工具、星点和像素烟花来自原项目 [Figma IP 状态板](https://www.figma.com/design/OYmXBbfDyz3btW5Gw1uMJ4/?node-id=374-192)。八个只读 SVG 导出保持原始路径、填色与 root dimensions，来源节点和 SHA 保存在 `ui/assets/companion/manifest.json`；使用分层组合承接动作，不修改设计稿。Figma 当时没有动画轨道，当前动作是本轮新制作。

按用户提供的 [Prompt Motion](https://prompt-motion.com/) 查找方法，实际阅读并采用其收录的 [HTML Demo](https://prompt-motion.com/mengto-a7f4679) [SKILL.md](https://raw.githubusercontent.com/MengTo/Skills/main/agent-skills/web-design/html-demo/SKILL.md)：复用真实组件、单一时间源、可暂停和逐帧审阅、隐藏暂停、响应式与减少动态效果。也阅读 [Cinetic 动作规则](https://raw.githubusercontent.com/Leonxlnx/cinetic/main/skills/cinetic/references/craft-rules.md) 作为节奏参考；没有运行其 Remotion/HyperFrames 制片流程或安装第三方执行代码。

## 动作

| 状态 | 时间 | 行为 |
| --- | --- | --- |
| 待机 | 静态 | 保留原稿轮廓、黑眼与笑脸 |
| 工作 | 2400ms循环 | 小幅蓄力、身体左右摆动、工具两次摆动，帽子延迟跟随，末尾留短暂停顿后衔接起点 |
| 成功 | 1450ms一次 | 压低蓄力、小跳、落地缓冲、轻摇并落稳；派对帽跟随，像素烟花和星点短暂出现后淡出 |

真实尺寸为48pt布局框，64pt内部舞台整体缩放；保留 Figma 道具比例。庆祝配件允许在布局框外绘制，完成态的dock右边缘留14pt，真实WebKit确认850/950ms可见烟花不裁切；Office原12pt边距与飞行目的地不变。外层 dock 的560ms落点飞行／320ms返回由原模块控制，角色运动只写内部分层，互不覆盖。

## 状态与维护

- `ui/components/companion.js` 定义唯一角色结构，CSS定义布局／道具显隐，`companion-motion.js` 定义动作与时间。真实浮窗、目录和独立预览复用这些源码，生成 HTML 不单独修改。
- `setPose(root,pose,{eventKey,animate})` 对相同事件去重；工作切换时取消旧轨道。`seek/pause/resume/dispose` 使用同一套轨道。预览的统一时间驱动两种尺寸，不维护另一套模拟动画。
- 实际 `generating` 播工作，真实完成且没有错误／不确定回执才播成功。首次恢复完成态为静态。停止调整／撤销会标记保留旧版，并取消当前庆祝；失败恢复旧 `done` 也不庆祝。后续正常新任务可再次庆祝。
- 隐藏或离屏暂停，返回不追加不可见期间的时间。系统减少动态效果直接显示完整静态姿态，关闭后不追播旧庆祝；缺少 WAAPI/IntersectionObserver 使用静态降级。
- 目标软件内不绘制角色产品反馈；桌面高亮、虚拟 cursor 与遮罩继续遵守 `desktop-overlay-sop.md`。
- 纯资源更新：运行 `scripts/prepare-desktop-runtime.mjs`，复制本地SVG到`runtime/ui/assets/`，再重开既有宿主；不重签、不改TCC。未来原生打包也复制这些资产，离线可用。

## 验证与范围

新增8项引擎检查、4项实际UI集成检查，与既有回归合计121项通过；覆盖防重播、旧轨道取消、统一seek、隐藏／离屏、减少动态、运行路径资产、取消／撤销与错误旧版本。真实WKWebView生成17张固定帧，检查两尺寸同帧、重复时间一致、工作首尾一致、48pt、340/390pt无横滚、完整静态姿态；另外实际可见的非激活测试panel验证工作自动播放推进、成功自然结束在1450ms且不重播、隐藏／离屏返回确实继续而不追赶。仅离屏加载的隐藏窗口会冻结document.timeline，不能用它证明自动播放。`npm run test:companion-motion --prefix desktop-preview` 同时运行动作与边缘回归；后者验证可见烟花、Office边距及真实active flight不被改动。既有收集和Office布局也通过。本机截图和原始报告位于忽略目录 `.local/companion-motion-check/`。

已同步运行资源并重开 `~/Applications/妥帖.app`，实际截图确认浅蓝角色。没有在日常工程中伪造生成或测试写入。此证据不代表新角色已随真实模型完整走完所有目标软件的物理操作；该链路保留既有待验边界。音效、宣传视频、更多表情、原生应用／状态栏品牌图标和发布ZIP未包含在此次角色动效初版；Figma无写入，当前未提交或推送。

去私密的 [验收记录](evidence/companion-motion-2026-11-06.json) 保存自动播放、边缘与运行资源一致性结果；不包含真实采集内容、模型密钥或原始应用日志。

## 同日：预览页不显示角色的交付修正

用户反馈看不到预览中的小人。此前页面依赖相邻SVG文件，并在JavaScript执行后才插入两处角色；单独复制／隔离预览会丢素材，脚本禁用时初始容器也为空。没有取得用户当时的预览URL，不能把这两个脆弱点当作已证明的唯一原因。

独立动效预览现在嵌入八个原SVG的base64数据，构建时通过同一真实组件预渲染两处角色；即使脚本关闭也能看见完整静态姿态，窄屏无脚本时居中缩至160pt，正常浏览器继续使用相同运动轨道。真实dock的本地资产策略不变。新增两项回归：HTML移入无素材目录且禁脚本时原SVG字节不变、两处22张图完整；启脚本后可切成功并seek400ms且无异常。另提供聊天内的真实角色动效预览，避免再次依赖本地链接的打开方式。
