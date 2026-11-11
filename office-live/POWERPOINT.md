# PowerPoint 图文接入与修订链

## 2026-11-03 当前版本

共用 Word 的四态浮窗、单条默认推荐、输入要求、完成反馈和固定轻量选项。按 ⌥⌘V 保存当前页与选中对象，后续点击或焦点变化不改目标；未结束任务拒绝重新捕获。模型准备完整图文候选，校验完成后直接写入；继续调整保留旧版直至新候选完成，支持 V2→V1→V0。任务结束后释放锚点和草稿，版本记录不跨重启恢复，每任务最多 20 版。

`prepare_powerpoint_images` 继续用于纯图片；`prepare_powerpoint_edit` 支持 `replacements` 图片映射与 `texts` 单段文字改写。范围仍是当前任务选择的对象，不允许模型传路径、坐标或代码。候选必须包括上一版要保留的全部修改，模型使用当前真实对象编号；宿主和目标适配器重映射图片替换后产生的新 ID，撤销再恢复上一版映射。

文字仅支持字体／字样统一的单段文字框，保留实际字体、字号和字样。混合字样、换行、字段、链接和动画明确拒绝。中文需要已显式设置中文字体：Mac 宿主在没有明确东亚字体时可能切换为默认字体，仅回写字体名称不足以保证显示一致，因此准备阶段拒绝此类对象并提示先设置字体。接口依据见 [ShapeFont](https://learn.microsoft.com/en-us/javascript/api/powerpoint/powerpoint.shapefont?view=powerpoint-js-preview)。

图片的矩形／椭圆几何在本任务版本中保存；第二轮用已重建的图片编号时仍应用原遮罩。椭圆 contain 按图片四角位于椭圆内的比例缩放，避免画面被裁切或伸出圆框。结束任务后的原始遮罩语义恢复不在本轮范围。

宿主协议 v2 增加 revision 与写入阶段。明确 `mutationStarted=false` 时保留上一版的可用状态；写入开始后失去确认则冻结，不自动重放。多对象图片与文字修改包含多个 Office 调用，不保证数据库式原子回滚。首份 PPTX 备份保留，后续每版另有准备快照。

真实模型／Office.js 已在独立 25 页合成稿完成：标题＋双图、第二版标题＋完整显示、V2→V1→V0；原头像、其他文字、位置、字体与层级恢复。最终恢复页与原页平均通道渲染差为 0.01503 / 255，非文件字节相同。154 项后端（10 跳过）和 58 项桌面检查通过。PPT 物理快捷键及 PowerPoint 自带 ⌘Z 本轮未验收；Word 物理快捷键由用户亲手确认。

证据：[Office 验收记录](../docs/evidence/office-workflow-verified-2026-11-03.json)；行为覆盖：[验收矩阵](../docs/office-workflow-checklist.md)。新复验脚本为 `scripts/office-revision-check.ts`，用独立资料库与合成稿，自带本机服务，不能与常规服务并行。

## 10 月版本的历史说明

以下保留旧接口与验收过程，其中“三条建议／预览确认／仅图片／单次撤销”已由上述当前版本替代。

2026-10-29：用户已授权加载并实测。正式加载项已连接，真实文稿捕获、三条模型建议、独立预览、双图写回和妥帖撤回均已验证；系统全局快捷键和光标浮窗仍待用户实际按键确认。

选中同一页的普通图片或空白矩形／椭圆头像框，按 ⌥⌘V，先输入要求，再看三个独立建议；打开真实 PPTX 预览，确认后替换。支持多图匹配、居中裁切填满 cover、完整放入 contain。当前不支持自动去背、文字修改、任意鼠标落点拖放或复杂组合／动画对象。

## 接口与部署

`powerpoint.xml` / `powerpoint.html` 与 Word、Excel 共用 OfficeBridge、EditableTarget 和任务浮窗。要求 PowerPointApi 1.10（[微软支持矩阵](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/powerpoint/powerpoint-api-requirement-sets)：Mac 16.105 起支持）。运行时检查能力；不引用 beta CDN 或预览版 addPicture。使用稳定的 Common API 图片插入和形状选择、删除、层级 API。

用户已确认 ReadWriteDocument 权限，清单已放在 `~/Library/Containers/com.microsoft.Powerpoint/Data/Documents/wef/tuotie-powerpoint.xml`，在 PowerPoint「开始 → 加载项」中打开。不要重复请求同一授权。本机已有 localhost 证书已通过只读信任校验，本轮未重复改信任。连接仅监听 127.0.0.1，校验 Host／Origin／随机令牌，按宿主隔离会话。

清单允许面板先打开，运行时严格检查 1.10；不支持时只显示兼容性说明，不连接文稿命令桥。实机 PowerPoint 16.110.2、Office LTSC Standard for Mac 2024 已通过 1.10 检查，不能直接套用 Windows LTSC 的接口上限判断 Mac。开发加载项卡片被 AX 错报为 disabled，实际可从搜索框按两次 Tab 聚焦卡片，再按 Return 打开。

## 上下文与目标

Capture 保存文稿会话、slideId、选中 shapeId 与完整未保存 PPTX 快照。上下文含全部页面文字（含组合内和表格）、备注、图表缓存标签／数值、图片资源标识；当前页真实渲染图也输入模型。母版内部、嵌入文件、音视频和其他页图片的视觉语义没有完整解析，不把这一版称为全部对象的语义理解。

Python 只解析／处理固定操作，不运行模型代码。模型只能引用本次选区对象与本包已有图片；不能传坐标、文件路径或 XML 扩大编辑范围。快照上限 32 MB，模型文字上下文 22 万字符；超限拒绝，不截断冒充完整读取。桥接 JSON 上限 64 MB。

## 预览、确认和撤回

`office/presentation.py` 生成独立图片预览，未改变的 ZIP 条目保留原字节。既有图片按原裁切和变换准备可撤回备份；空位保留原形状，在同位置叠入图片，撤回时移除新增图片。确认前重新核对全文上下文和目标页渲染；加载项再次检查目标页版本，再创建全部新图，最后退休被替换的原图片并恢复层级。

写入或删图后失去确认时冻结目标，不重放。撤回要求目标页未继续编辑；普通图片以保存的原像素、裁切、位置和层级恢复，原图片对象 ID 会改变。动画、链接、复杂遮罩、颜色／透明度效果和独立描边会被拒绝，不能宣称任意样式无损。

多图替换包含多个 Office API 调用，不具备数据库式原子提交保证。创建阶段失败会清理已创建的新图；退休阶段失败明确报未确认。整份原稿 PPTX 备份保存在本机，界面提供「打开原稿备份」。

## 验证与接续

合成 25 页测试已覆盖末页／备注读取、保留 01 原头像和其他页字节、两个不同对象的图片预览、越权对象／未知图片拒绝、版本冲突、重复写入拦截。PowerPoint 已实际打开原稿与独立预览，无修复提示；预览中 02 换为 A、03 空位放入 B、01 保留。

真实加载项读取同一页选中的图片与椭圆空位，返回正确对象编号；导出 25 页，末页 FULL-DECK-25 与备注 NOTES-25 都存在。真实模型返回三条建议，并生成 A 裁切填满、B 完整放入的双图预览。PowerPoint 实际打开预览，无修复提示；确认时先切到第 2 页，写回仍准确落在原第 1 页。保存实机应用结果后校验原头像与其余 24 页上下文未变；妥帖撤回恢复橙色图片与原椭圆空位，其他页仍一致。

该轮通过本机接口发起真实 Office.js 命令；自动化键盘未触发 Carbon 全局快捷键，不能把接口验收记作 ⌥⌘V 浮窗端到端通过。已请用户亲手按键确认。冲突和结果不确定保护仍以现有回归测试验证，本轮没有新的实机冲突测试。详见 `../docs/evidence/powerpoint-live-verified-2026-10-29.json`。全包提交会按原有交互归档任务开始时的内容，测试使用合成材料，没有修改用户文稿。

独立文件检查：用运行目录的 Office Python 执行 `scripts/powerpoint-fixture.py <独立目录>`，再执行 `node --import tsx scripts/powerpoint-preview-check.ts <同一目录>`。后者只生成独立文件，不冒充已连接 PowerPoint。主要逻辑：`src/targets/powerpoint-live.ts`、`office-live/powerpoint-adapter.js`、`office/presentation.py`。
