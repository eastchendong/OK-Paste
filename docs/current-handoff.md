# 新 Agent 接手速读

## 2026-11-08：跨 App 结果 overlay 初版已安装，用户自行验收

用户明确要求停止代做实机验收，做好后由其自行检查；不要继续操作文稿、索要屏幕录制授权或把自动检查写成端到端通过。已增加 FileRunner 的统一成功回执与取消代次保护，Word／Excel／PPT／Figma／原生确认写入的输入框接入；Blender 保留真实只读投影。妥帖独立原生 Manager／AX 与本机截图定位／统一渲染及失效管理，使用新版 IP 蓝、薄荷、柔黄渐变轮廓、流动亮边及星光；无 App 内反馈绘制。

已空闲备份、复用固定签名安装并重开 `~/Applications/妥帖.app`，18 份选择性 runtime 补丁与签名候选二进制回读一致，health=true、idle、canUndo=false、新 runtimeSessionId。Figma 既有插件已备份并保留原 ID 更新，需重新运行；Office 加载项也需关闭重开加载新代码。没有同步未验证 Blender 事务模块，没有改本机 Key、内容包或用户工程，无 commit／push。

359 项后端（排除系统剪贴板套件）、165 项桌面、TS、Swift 全源、原生 panel 组件与 diff 检查通过；只读 Word AX 已取得真实行范围。**未做本轮真实写入后的跨 App 高亮验收。** Excel AX 不提供单元格，截图定位需妥帖屏幕录制权限；用户只确认打开 Accessibility，不能记为已开屏幕录制。重复／裁切／离屏、清空单元格、跨页长文字、仅格式或旧图片缩放等可能拒绝定位。保存文件与 Illustrator 实验路径仍缺可信屏幕区域适配，不能宣称全部功能已覆盖。详见 [实现与用户验收](cross-app-result-feedback-2026-11-08.md) 和 [安装证据](evidence/cross-app-result-feedback-installed-2026-11-08.json)。下方“仅规划”条目为历史。


## 2026-11-07：Office／Figma／general 原生内容包拖放（源码完成，未安装）

已接入共享原生接收层、真实落点捕获、窗口截图视觉通道与 nonce 取消／迟到保护。Office 走既有 Range／对象接口，Excel 地址交叉核对；PPT 空白页仍仅推荐。Figma 让插件原生 DropEvent 提供命中节点，不模拟画布点击、不取旧选区，仍限既有可编辑顶层画框。微信／Codex 等截图＋输入上下文，无法可靠绑定输入区则复制交付，不自动发送。

67项后端、165项桌面、TS／UI／Swift／原生组件及优化候选编译通过；没有本轮物理拖放或真实新链路写回。`scripts/update-native-drop-app.mjs --install` 实际尝试仍在服务访问时 EPERM，未安装／重启／更新 Figma 插件。候选已准备，未带入未验证 Blender 事务；不要重跑旧 text-drag prepare 而遗漏新增模块。详见 [实现与接续](native-pack-drop-2026-11-07.md)。结果动效的共享 Manager 重构仍属另一独立计划，未被本次拖放实现替代。

## 2026-11-07：用户要求本机跨App结果动效，当前仅规划

用户追加架构要求：不要局部优化。Overlay明确归属妥帖App，由妥帖统一Manager/窗口跟踪/结果区域协议/渲染器/生命周期管理，浮在任务对应App窗口上方；adapter只交事实与坐标。先建设共享架构，Word仅作为首个验收场景。已补入跨App结果反馈计划，未实施。

用户纠正：需要妥帖App demo中Office/Figma/Blender/其他成功功能对准实际修改区域的动效，视频不算实现；Word实用未高亮。源码确认仅SceneRunner返回resultFeedback，FileRunner缺少统一回执/区域接线，不能再宣称跨App已完成。要求更强的新版IP蓝/薄荷/柔黄折光、渐变轮廓与星光；独立原生overlay原则不变。已出计划prototype/docs/cross-app-result-feedback-plan-2026-11-07.md，Word真实范围屏幕映射先行、再适配各宿主、原生逐项验收，尚未实施或部署。


## 2026-11-07：Word／PowerPoint／Excel 妥帖侧栏已连接

用户要求安装并重试；三份正式清单原已正确侧载且与源码哈希一致，本轮通过各 App 开始页的 Add-ins 开发加载项入口启用，三者实际侧栏均显示“已连接”，现保持打开。没有重复安装、改信任或改用户文档。Excel 自动化 ⌥⌘V 打开系统选择性粘贴，已取消，空表选区恢复 A1；物理快捷键仍需用户确认，不能记为完整生成／写回通过。妥帖原生窗口空闲。证据见 [连接记录](evidence/office-addins-connected-2026-11-07.json)。

## 2026-11-07：内容框拖放与长邮件修复已安装

用户再次要求执行 fix，本轮本机服务访问已恢复；在 idle、无撤销／结果／待确认任务时执行 `scripts/update-text-drag-app.mjs --install`，exit 0，日常 App 与五份 runtime 补丁已更新并重开。此前 EPERM／未部署条目为旧会话历史，不再需要用户在终端安装。

已修正未写入的 input-live 捕获也被全局禁拖的问题：真实物理拖动经本机 preflight，仅释放无文字／无写入的旧位置；已有结果、运行、预览和未知写入保留并提示，竞争和迟到手势有保护。长邮件复制修复一并准备。51项后端、55项相关桌面、TS／UI／diff与原生优化编译通过；原生候选及五份补丁哈希一致，尚未实测更新后的物理拖放／微信粘贴。

**固定签名／身份连续性、补丁哈希与 App 内 JS 回读通过；新服务 health=true／idle／canUndo=false，原生 AX 显示“妥帖助手 · 空闲”。** 已备份并核对配置、内容包、排除的 Blender 模块未变。物理拖放／微信实际长文粘贴仍无本轮实测，不以安装或旧回归代替。勿再次运行旧候选安装或全量同步 src／blender。详见 [安装结果](text-drag-update-2026-11-07.md) 与 [脱敏证据](evidence/text-drag-installed-2026-11-07.json)。下方长邮件条目的未部署状态已由本条覆盖。

## 2026-11-07：微信长邮件结果生成成功，但被原生写入限制挡住

已依据运行记录定位（2453～4000字符、41～61行），并在源码将 keyboard-input 超过1200字／多行／制表符的结果在原生命令前完整转为复制；完成态保留全文和复制按钮，复制后继续调整保持手动粘贴，未知原生写入仍冻结。42项定向、163项桌面、TS／UI／构建／Swift／diff通过；全量后端有沙箱端口EPERM和Office超时（独立通过），未记全绿。

**未更新日常App／runtime，未验证修复后微信物理粘贴**：当前会话安装目录不可写，47721访问EPERM。没有改系统剪贴板、密钥、邮件或此前Blender工作。下一次有运行目录访问时仅同步本修复，不带入未完成真实bpy检查的Blender改动，复用固定签名和任务空闲检查。详见 [长邮件输入修复](long-email-input-2026-11-07.md)。

## 2026-11-07：Enter 新 IP 最终发布，旧缓存兼容已修复

20:26:23发布turn15，prod提交 `b1dbdff6f499f9e360bbc30867255cf2e786cfdc`，无未发布修改。新版14SVG使用独立版本目录，CSS经Vite内容哈希打包；已在刚才确实复现旧缓存错位的同一浏览器普通刷新，实际2秒品牌形象和22.6秒星光正确，无旧六边形/分层堆叠，15层解码、素材音乐就绪、无error/warn。最终截图与验收在本地忽略prototype/video/tuotie-demo-v4，任务全部完成。下方turn14发布/缓存待修为历史，不代表当前状态。


## 2026-11-07：Blender 应用与微调预览不一致

源码已补旧提交漏掉的World、相机选择、渲染／色彩设置，以及修改器／曲线／镜头等常见对象差异，带撤销和用户后改保护；只有设置的预览可应用并显示场景变化。多轮沿用同task和最新version，不是固定恢复首轮。

9项合成事务、42项后端定向、32项桌面和既有几何／自动连接、TS／构建／UI／diff通过。新增5项真实bpy用例尚未跑到，测试Blender在Metal初始化崩溃139；本机构建无OpenGL。**运行版未更新，不得宣称用户当前版本已修好**，先完成独立bpy验收；旧活动事务缺新增场景快照字段，禁止直接重载模块。未动用户工程／密钥／日常宿主，保留原有文档和未跟踪blend。详见 [一致性修正](blender-preview-commit-2026-11-07.md)。


## 2026-11-07：Enter 视频新版折角 IP 已检查并发布

20:11:39，同一项目固定Opus5.5完成turn13替换及turn14姿态时点修正，prod提交 `72f0025241cc8fe1270c8924eb54697a487d6844`，无未发布修改。14份SVG本地对远端源码SHA全匹配，15层解码；新版工作/星光/封面和Esc返回实际查看，48.1秒完成后立即idle，连续播放至结尾和Esc停止通过。正式页素材音乐就绪、无console error/warn。素材/JS/CSS/说明共19份完整提供Enter，记录在本地忽略的prototype/video/tuotie-demo-v4。原56秒脚本、48秒Word语气微调与真实软件截图保留；没有待运行任务。下方启动/待发布均为历史，不要重复发任务。


## 2026-11-07：Enter 视频新版折角 IP 同步已启动

用户要求将新版14SVG与现有七状态动效代码完整提供Enter，固定Opus5.5实施，检查后直接prod。已在唯一项目提交19份带SHA源码压缩包与适配要求，任务 `12df583b-f64f-420c-9028-3f6c22a13d85`；运行中，未发布新版IP。源包和实际prompt在 `prototype/video/tuotie-demo-v4/`（本地忽略目录）。影片时钟驱动seek、48秒文档语气微调、真实截图及音轨保持，Esc只取消返回；稳定后约10分钟查询。


## 2026-11-07：新版 IP 归档与 main 同步授权

- 用户明确要求将当前改动提交推送 dev，并在可合并时直接合并、推送 main；覆盖此前“只检查、不移动 main”的本轮限制。本次归档含新版折角 IP、七状态动效、图标构建与分发 ZIP、验收记录及本地资料忽略规则。
- fresh fetch 后 dev/origin/dev=c7759f7，main/origin/main=381b267；main 为 dev 祖先，merge-tree 无冲突，可快进。提交、推送与同步后的最终版本以实时 Git 为准；旧“源码未提交”仅保留历史状态。
- 本次复核构建/TypeScript/UI 一致性、160 项桌面检查、325 项后端检查及 diff 检查通过。后端首次高并发有一项 Office 用例 5 秒超时，降低至 4 workers 后完整 50 文件/325 项通过；排除会占用系统剪贴板的 clipboard 套件。
- ZIP 的 16 项界面与 SVG 资源和源码一致，无私有数据路径，变更文件与 ZIP 未匹配本机配置凭据。研究/论文/视频资料继续忽略；本次 Git 归档不重启 App、不改运行配置或用户工程。新版 IP 的实际部署与人工验收边界仍见 companion-v2-2026-11-07.md。

## 2026-11-07：新版折角 IP 与七状态动效已更新本机

- 以 Figma `ai 形象`（447:3／状态462:533）替换此前浅蓝六边形：14份原始本地SVG保留渐变、折角、滤镜和根尺寸，统一浮窗、应用图标、菜单栏与ZIP；远端原稿只读。
- 七状态为闲置眨眼、新资料点头、收到任务wink、思考气泡、工作视线左下→右上、成功跳舞星光、失败低头。真实状态驱动、单次事件去重、首轮资料恢复不误点头；保留取消/撤销/不确定回执边界和独立桌面overlay。独立HTML可暂停/seek，内嵌资产离线可见。
- 桌面160项、TS/前端/UI/diff、22帧实际WebKit及收集/Office/Blender/飞行布局检查通过；固定签名构建与连续性通过。图标改用现有Electron/Chromium渲染，解决AppKit丢滤镜和WebKit大图遮罩栅格问题，实际浮窗48pt保留原SVG。
- idle且无撤销时备份、安装并重开本机App，截图确认新版IP；health=true/idle/canUndo=false。运行版/安装包/ZIP资源匹配，配置与采集聚合hash未变，无重授权/改密钥/用户工程写入。源码未commit/push。详见 [新版IP说明](companion-v2-2026-11-07.md)。


更新：2026-11-07。这里是当前状态摘要；旧交接和日志用于追溯，不能把旧计划当成仍未完成的任务。

## 最新Git交付：dev归档与main合并检查

本轮DeepSeek/Blender/UI/单次应用等源码、脱敏证据和ZIP按用户要求归档并推送dev；旧“未commit/push”是历史快照。325后端/158桌面及构建/UI检查通过。fresh fetch后main=381b267为dev祖先，可无冲突快进；本轮只检查，不更新main。最终提交及远端状态以Git为准，见[检查记录](dev-main-merge-check-2026-11-07.md)。

## 最新交互：应用只确认一次

Blender点应用后等待回执即显示已应用/撤销/继续调整，结束改为可选关闭图标；迟到preview快照不会重现应用按钮。158项桌面/WebKit/UI检查及分发构建通过，本机UI已同步并重开原签名宿主；DeepSeek配置不变。当前源码未commit/push。

## 最新模型：DeepSeek Flash 已切换

用户最新要求直接切换后，runtime已使用官方deepseek-flash与共享本机Key，文本/识图实测通过；真实隔离Blender的模型+MCP预览→应用→撤回完整通过。规划强制结构化工具，实际执行保持多轮看图。内容包哈希、签名和权限保留。见[证据](evidence/deepseek-activated-2026-11-07.json)。下文“仍Ark/未切换”均为历史阶段，不再代表当前运行版。

## 最新本机版本：Blender共享任务面板

Blender已复用Word等应用的可编辑默认要求/任务/来源/调整界面，删除旧确认卡，优化重复规划和截屏；324后端/157桌面、WebKit/签名及真实隔离MCP预览/应用/撤回通过。本机已更新，**模型仍为原Ark/GLM，DeepSeek尚未切换**。见[本轮记录](blender-unified-composer-2026-11-07.md)。后文“不更新runtime”仅指此前模型切换尝试，不代表本轮UI未部署。

## 最新多轮图片排查

工具调用标准字段规范化已修复，320项回归通过；官方清理后多轮图片曾200，但后续仍503/超时，独立Blender首轮也提示服务繁忙。用户要求验证后才更新，**当前未切换运行版**。详见[排查记录](deepseek-multimodal-2026-11-07.md)，下方旧“待排查”以本条为准。

## 当前模型切换状态（2026-11-07）

源码默认DeepSeek Flash与共享Key已接好，本机私有配置已导入；319项后端及签名构建通过。官方API普通调用/推荐/首轮图像工具成功，多轮图片回传仍500，**日常runtime尚未切换**。新代码未commit/push；不要把已导入Key当作Blender视觉链验收通过。

## 本轮分支合并（2026-11-07）

`wanyiran1107` 的推荐/输入框/快速执行/动态调整/Figma 交互已整合；dev 桌面 overlay、拖动、签名、本地新 IP 保留。Word 文档内高亮已移除，可信结果几何接入仍待完成。日常运行版未切换，源码变化不代表已部署。详见 [合并记录](merge-wanyiran1107-2026-11-07.md)，下文历史提交/未提交状态以本条和实时 Git 为准。

## 先知道这些

- **最新视频工作：V3 turn12 已于 2026-11-07 18:14 完成复核并发布 prod。** [正式版](https://01459b4acdc74a2d985c895824010636.prod.enter.pro/)，提交 `a61b58cdb96692bd365caa54abfed65b95db1231`，固定Opus5.5。音效对齐/主片undo移除/22秒应用标签统一；播放暂停、跳转续播、Esc、正式页加载和无控制台错误通过。48秒仍是同文档语气微调。素材/prompt/验收在 `video/tuotie-demo-v3/`；没有待运行任务，不要重复生成或等待旧turn。
- 工作分支 **dev**；功能提交 `36f3484` 已推送 dev，并将 main 从 `63ae89d` 快进同步后推送，13 个历史提交保留；完成状态另以文档提交同步两分支，最新 HEAD 以 `git log` 为准。范围包括此前 Office/Figma 等历史，见 [合并记录](merge-main-2026-11-05.md)。根目录 docs/literature 仍为未跟踪用户资料。开始工作仍需检查 git status / log，不依赖本文判断实时状态。
- 用户明确取舍：**UI 优先 wanyiran；Figma 默认用她的 live 矢量插件；dev 的旧 Figma MCP 保留为实验模块；剪映/CapCut 暂时禁用**。合并冲突已解决，不要重新执行旧 merge plan，也不要恢复旧默认路由。
- 当前日常入口是 **Swift/AppKit 宿主 + 共享 HTML/JS + TypeScript 本机服务**。Electron/React 开发入口是历史实现，别用 `pnpm start` 启动日常版本。
- UI 真值是 `prototype/ui/`；生成物不要单独改。协议、任务、撤销在 `src/desktop-agent.ts`、`src/file-runner.ts`、`src/agent-core/`、`src/targets/`；Blender 独立流程在 `src/scene-runner.ts`。
- **最新产品硬约束：高亮／虚拟 cursor／遮罩由妥帖独立原生桌面 overlay 统一绘制，跨 App 复用。** 目标 adapter 只提供真实生成区域几何及窗口／任务身份，禁止在 Blender GPU、Figma canvas、Office 文档内部绘制产品反馈。虚拟 cursor 不移动系统鼠标、不合成点击、不改内容、不抢输入；参见 [桌面 overlay SOP](desktop-overlay-sop.md)。
- 用户提出 ChatGPT 虚拟 cursor／Tophat 作为参考；本机未发现可调用的 Tophat API，未验证其内部机制，不能宣称已集成。此前 Blender 内部 GPU 方案已被否定并移除；最终使用通用 `ResultOverlay.swift` 非激活/穿透 NSPanel，Blender 仅提供 `result_geometry.py` 真实坐标。新版本已固定签名安装并启动，见 [证据](evidence/desktop-overlay-2026-11-05.json)；其他 App 的真实区域适配与完整跨 App 体验仍待追加。
- 拖动动效源码：`ui/components/pack-drag-motion.js` + 原生 `desktop-preview/Sources/PackDragVisual.swift`。真实原生文件拖放不变；内容包收拢为缩略图/数量胶囊，成功后小人飞到落点，取消回到拖前实际位置。106 项桌面检查与 App 构建通过；物理 Esc/原生拖动完整体验仍待用户试用。最新版已安装，固定证书签名及跨原生版本辅助功能留存已验证，见 11 月 5 日证据。

## APP 当前能做到什么

| APP | 当前入口/能力 | 边界 |
| --- | --- | --- |
| Word / Excel / PowerPoint | 加载项 + ⌥⌘V 捕获目标，写入和继续调整/撤销 | 固定本任务范围；具体支持类型见 APP 接入记录，非任意文档无损编辑 |
| Figma | `figma-live/`，插件运行后自动连接，选 Frame 后 ⌥⌘V；矢量生成、实际看图、多版本撤销 | 顶层未锁定、无自动布局 Frame；暂不生成文字/位图 |
| dev 旧 Figma | `figma/`、`src/figma/`、`targets/figma.ts` 保留 | 实验工具，不是默认产品入口；旧版同样需要手动运行插件 |
| Blender | 内容包拖入/聚焦推荐，或 ⌥⌘V 冻结视口中心 → 确认 → 独立预览 → 应用/撤回；没有匹配 GLB 时程序化建模；可见结果区域交给通用桌面层标明 | 真实 MCP 路锥预览/应用/撤回通过；物理入口及最终遮罩完整链仍待体验。GLB 是可选资源，不保证任意碰撞/照片重建三维 |
| 已保存 Office 文件 | 菜单选文件 → 副本预览 → 确认写回 | 不代表读取未保存原生状态；下一包目标丢失问题已修复 |
| 普通文字应用 | 生成后确认复制，再由用户 ⌘V | 不自动发送、不宣称任意应用原位写入 |
| Illustrator | 保留实验矢量适配器 | 缺真实宿主验收 |
| 剪映 / CapCut | 明确 disabled，保留内容包 | 历史社区插件验收不等于当前产品已接入 |

普通 ⌘C 不自动加入内容包；跨应用采集用 ⌥⌘C。详情见 [APP 接入记录](app-integration-2026-11-04.md)。

## 本机已经配置，别重复折腾

- **固定签名迁移已完成并实测更新保留授权。** 本机身份在 `~/Library/Application Support/Tuotie/signing/identity.json`，用户已批准一次当前用户 codeSign 信任及失效 AX 记录删除重加。实际不同原生版本 A→B 后 AX 仍 true、未再次授权；当前是胶囊动效版 B。日常构建缺身份/身份不连续会停止，不退回 ad-hoc；复用证书、私钥和登记，不再重新初始化。普通 UI/TS 仍只同步 runtime。

- 应用：`~/Applications/妥帖.app`；运行资源：`~/Library/Application Support/Tuotie/runtime/`。源码更新不等于运行版更新。
- HTTP 服务 47721；Office/Figma HTTPS 桥 47722；Blender MCP 9876。检查真实响应，别仅凭进程存在就判断连接成功。
- Chrome 图片右键扩展 **0.1.2 已加载，用户采集成功**：稳定目录 `~/Library/Application Support/Tuotie/extensions/image-menu`。修复 RoadTrafficSigns 的真实 WebP 被标为 octet-stream 后误判，补 PNG/JPEG/GIF/WebP 签名识别，保留失败/大小边界。14 项检查、TypeScript 及实际 CDN 图片隔离落盘通过；用户重新加载后确认成功，日常包回读新增 9660 字节真实 WebP、来源及采集方式正确。无需重启 Chrome；以后更新只需重新加载。浏览器工具禁止进入扩展管理页，不能绕过。
- Blender 5.2 用户 startup 已安装自动连接模块。正常打开 Blender 后等待妥帖，启动顺序不限；不重置工程。后台渲染不启用，第二 Blender 实例不抢占端口。其他机器/新大版本执行 `pnpm run setup:blender-auto`。
- Figma 正式插件在 `~/figma-live-plugin/`，复用真实插件 ID 和现有 localhost 证书。**插件需要手动打开一次，运行后自动连接/重连；关闭插件不能后台继续。** 不要承诺 Figma 冷启动会自动运行插件。
- 复用辅助功能授权、签名和证书；用户不希望反复输入密码。只改 HTML/JS/TS 时同步 runtime 并重启原宿主，不必重签 app。
- `.env.local`、`.local/` 和运行目录内采集/日志不提交。根目录未跟踪 `docs/`、`literature/` 为已有用户内容，不要顺手 add 或删除。

## 最近验证与下一步

- **Enter 最新授权：每次完成后检查效果并直接 publish 到 prod，只给 prod 链接，不再询问发布确认。** 覆盖早前不发布/稳定后停止观察的安排，本轮恢复 V2 验收与生产发布；最终状态见 V2 `enter-run.json`。
- **Enter V2 已发布并验证：** [正式版](https://01459b4acdc74a2d985c895824010636.prod.enter.pro)。Opus5.5 turn7，56秒+3秒Esc，真实截图、明确Magic Copy文案、新字体/动效/完整音乐。正式构建与prod一致、无未发布修改，正式页播放和资源载入正常；音乐听感未直接聆听。见 [验收](../video/tuotie-demo-v2/REVIEW.md)。旧“不发布/稳定后停止”已被最新授权覆盖。
- V1 Enter样片曾于11月7日完成：[最终turn5预览](https://01459b4acdc74a2d985c895824010636-turn5.preview.enter.pro/)，个人workspace，5轮均Opus5.5。50秒主片＋3秒Esc补镜头；实际Chrome播放／暂停／重播／重复seek、Word撤销、Esc起终点和新封面已验，减少动态源码复核。见 [交付验收](../video/tuotie-demo-v1/REVIEW.md)。尚无MP4／正式配音／生产发布，不把网页概念片当原生物理链验收。00:13个人12640.87、团队21960.53 credits，另有待扣infra；项目共1863.56 credits。后续复用同项目；是否继续观察以本轮 V2 的停止要求为准。
- 应用包与 topbar 的旧云团遗漏已补齐：`scripts/build-desktop-icons.mjs` 从原始 companion SVG 自动生成两处图标，接入组件同步；包图标为浅蓝六边形，菜单栏为透明五官的单色模板。原固定签名构建、安装和 ZIP 均更新，三处资源哈希一致；重开后 healthy／idle，Finder 实际新图标及菜单可用性通过，明暗底色为离屏渲染检查，未更改系统主题或权限。当前未 commit/push。
- [制作包与运行状态](../video/tuotie-demo-v1/README.md)保存批准脚本、prompt、原素材与全部任务ID。创建响应解析曾失败但已找回唯一云端项目，禁止重复创建；后续在同项目继续。早期22:26的credits与计划中状态只是过程快照，最新交付／余额以上条和验收记录为准。
- 预览交付已修正：独立动效HTML内嵌原SVG并预渲染静态角色，脱离素材目录／禁脚本仍可见；窄屏无脚本时居中缩放。新增2项后桌面全量123项通过，另提供聊天内动作预览。没有取得用户原来预览URL，不断言故障的唯一环境原因；此次未重启日常宿主。
- 用户已选浅蓝六边形。真实 Figma 分层 SVG 已替换日常浮窗／组件目录旧云团；工作2400ms循环、成功1450ms一次，真实任务状态驱动，恢复／取消／撤销／失败旧版不误庆祝。121项桌面检查、真实WebKit动效／窄屏／布局检查通过；runtime同步并重开原固定签名宿主，截图确认新角色。可审查 [动效初版](../companion-motion-preview.html)，支持暂停／重播／拖进度；见 [实施说明](companion-motion-2026-11-06.md)。远端Figma未改，视频与音效仍待制作，当前新代码未commit/push。
- 本轮双入口、最多两项真实 ready 候选轻气泡、完成回焦及通用桌面层已安装；既有胶囊拖动／成功飞落点／Esc 返回保留。231 后端、109 桌面、TypeScript/UI/Swift/签名构建通过，独立原生窗口的穿透、映射、镂空和清理已检查。运行 health=true、Blender connected=true、idle、AX=true；[证据](evidence/desktop-overlay-2026-11-05.json)。仍需用户物理拖放/快捷键、桌面层覆盖真实生成结果的完整体验及其他 App 区域适配。
- 历史自动检查：210 后端（11 月 4 日）、106 桌面（11 月 5 日）通过；本轮提交前已重新通过 231 后端、109 桌面、3 签名初始化与 TypeScript/UI 一致性。最终构建部署及仍待体验的范围见上条与 [合并检查](merge-main-2026-11-05.md)。
- 真实 Figma 已观察到妥帖关闭→等待→重启后自行已连接，未改设计稿。
- 用户真实拖入交通标志已进入规划，暴露缺少匹配模型时过度澄清/偏向苹果的问题。本轮修复通用建模能力说明、拖放意图和焦点/重试恢复；21 项相关检查、TypeScript、真实模型+独立后台 Blender 的交通标志/空资产苹果建模与取消恢复通过。后台测试不是新版原生拖放或 MCP 传输全链验收；下一步由用户在运行版重拖参考验证。已同步两份运行源码并由既有宿主自动重启 Node 服务，health=true、源码哈希一致；宿主签名、权限、工程和内容包保留。
- Office/Figma 的模型实机证据主要来自 11 月 3 日；合并后没有重新验收所有 APP 的整条原生链。Illustrator 仍是缺口。旧 Figma 图文能力是否迁入正式协议是后续可选工作，不是已经完成。
- 测试涉及系统剪贴板，别同时跑两套源码快照的测试；`.local` 已排除于 Vitest 发现范围。

## 常用命令与阅读顺序

命令均从 `prototype/` 执行：

```bash
pnpm test
pnpm --dir desktop-preview test
pnpm exec tsc --noEmit
pnpm run ui:check
node scripts/prepare-desktop-runtime.mjs  # 同步运行资源，随后重启原宿主
node scripts/prepare-figma-plugin.mjs ~/figma-live-plugin
# 仅重建分发物：cd desktop-preview && zsh build.sh --package-only
```

继续改代码前：读根 [PROJECT_MEMORY.md](../PROJECT_MEMORY.md) 顶部，再读 [10 月 28 日交接](session-handoff-2026-10-28.md)；涉及 Agent/Blender 必须保留 [10 月 25 日实现边界](session-handoff-2026-10-25.md)。具体启动和关闭自动接入见 [run.md](run.md)，完整历史和证据索引见 [development-status.md](development-status.md)。新进展更新本页摘要与记忆/状态，历史记录不用反复重写。早期记录中的 `prototype/` 对应本仓库根目录，PPT 资料位于原课程仓库。
