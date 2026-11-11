# Office 实时接口与本机验收

## 2026-11-03 固定位置与 PPT 图文版本

用户确认一次唤起固定一个目标。点击文稿其他位置、跨应用切换不会重定向；输入区显示已保存位置和结束入口，结束后才能换位置。Word 实际快捷键由用户两次确认；生成、轻量调整和两次撤销实机通过。段首纯文字默认按独立段落插入，明确行内需求可指定 inline；候选只含新增片段，重复前后原文会被拒绝。

PowerPoint 已支持受限单段文字与图片联合修改、保留旧版直至新候选完成及 V2→V1→V0；真实模型与宿主在独立 25 页合成稿验收。文字保留字体／字号／字样，中文需要已显式固定字体；椭圆遮罩跨本任务版本保留。完整范围见 [PPT 文档](POWERPOINT.md)、[验收矩阵](../docs/office-workflow-checklist.md)。Office 自带 ⌘Z、新 PPT 物理快捷键和跨重启撤销未验收或实现。

## Word v2 图文与逐级撤销（2026-11-02，已实机验证）

源码新增 `prepare_word_patch`，支持有序文字段落与 PNG/JPEG 图片、字重／斜体／下划线／字号／颜色／对齐。每次提供完整候选版本，只写本次妥帖创建的范围，不支持对任意原文选区改格式。旧 `prepare_word_insertion` 继续负责简单文字。

继续调整保留上一版直到新候选完成；使用同一范围的一次替换命令写入。连续撤销 V2→V1→V0，文档其他部分的修改不被回滚。写入前拒绝正文冲突和自有范围的手动编辑；写入后回读保存真实 OOXML。已发出写入但未收到成功回包时，结果不确定并冻结，不自动补偿或重试；这不是跨 Office 操作的原子事务承诺。

用户已明确授权保留旧文稿结果并切换新版；旧任务正常结束，运行服务与协议 v2 加载项已更新，现有证书和读写授权沿用。图文／段落格式只在段首或空行开放，宿主写入前检查实际起点；段落中间仍可插入纯文字。

独立合成文稿已完成真实 Word 图文插入／连续替换／V2→V1→V0，回读原正文和格式恢复一致。真实模型生成蓝色加粗 16 磅标题、正文和图片，第二轮改到 18 磅并保留图片，两次撤销后恢复原稿。停止／模型失败保留旧版、手工修改拒绝覆盖与不确定写入冻结由自动检查覆盖；本轮未重测全局快捷键及 Word 原生 ⌘Z。Word 会重新生成内部绘图标识，验证不承诺整个文件字节相同。证据见 [验证记录](../docs/evidence/word-v2-verified-2026-11-02.json)，架构与限制见 [Agent Core v2](../docs/agent-core-v2.md)。

复验脚本为 `scripts/word-revision-check.ts`，参数必须是文件名以 `Word-v2-验收-` 开头的独立测试稿绝对路径；正文还需匹配脚本内的合成测试标题和插入点。它自带本机服务，不能与常规服务同时运行。默认包含真实模型调用，`--host-only --no-pause` 仅执行宿主验证；测试来源在独立目录中，不使用日常内容包。

接口依据：[Microsoft Word.Range insertOoxml / getOoxml](https://learn.microsoft.com/en-us/javascript/api/word/word.range?view=office-js)。

以下保留 10 月版本的历史验收说明；其中“三个建议／仅纯文字／单次撤销”不再代表当前源码行为。

PowerPoint 图片接入和当前验收边界见 [POWERPOINT.md](POWERPOINT.md)。用户已授权并加载，真实全文读取、三条模型建议、双图预览／写回／撤回已验证；全局快捷键浮窗仍待用户实际按键确认。

此目录同时保留独立探针和正式加载项。2026-10-29 已安装正式「妥帖 · Word」加载项，并通过真实 Word 正文读取、未保存文字进入模型、固定光标插入、撤回和冲突拒绝测试；系统全局快捷键与弹窗视觉仍待用户实际按键确认。探针页面与正式能力的证据分开记录。

## 验证目标

1. 在 Word 新建独立空白文稿，粘贴 `word-fixture.txt`，另加一行随机文字，不保存。
2. 面板读取正文与选区，检查未保存文字也在返回中。
3. 定位唯一测试句，检查 Word 高亮与返回选区一致。
4. 替换测试句，重新读取全文，确认其他内容不变。
5. 在 Word 正文执行原生 ⌘Z，再读全文并检查原有格式。反向替换不能替代撤销验收。

探针只允许正文首行为指定测试标题的文稿，替换前还要核对当前选区。所有数据留在加载项页面内，不调用模型、不上传文稿、不改文件、不模拟键盘。这里的“正文”不包括页眉、页脚、批注等全部文档组成；鼠标落点映射也尚未测试。

## 本机前置条件

- 本机 Word 16.110.2 已可编辑。此轮未修改账户或订阅。
- 独立探针资源保留在 `.local/office-live-probe`；正式加载项的证书位于 `.local/office-live`，已按用户授权设为 SSL／localhost 信任。探针 `serve.mjs` 也使用 47722，不要与正式加载项服务同时启动。
- 使用系统已信任、匹配 localhost 的开发证书。需要新增信任时先说明并请求授权，不能关闭证书验证或绕过安全警告。证书／私钥放在忽略的 `.local`，不提交仓库。
- `word-probe.xml` 申请 `ReadWriteDocument`。尚未复制到 Word 加载项目录；正式加载前应确认用户授权。无需安装第三方 MCP 或新增运行依赖。

按[微软 Mac 侧载说明](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)，清单位于 `~/Library/Containers/com.microsoft.Word/Data/Documents/wef`，随后在 Word 的加载项菜单中打开。不要为了刷新加载项退出仍有用户未保存文稿的整个 Word。

API 依据：[Word.Document.getSelection](https://learn.microsoft.com/en-au/javascript/api/word/word.document?view=word-js-1.7)、[Word.Range](https://learn.microsoft.com/javascript/api/word/word.range?view=word-js-preview)。最小接口要求 WordApi 1.1，面板运行时检查支持情况。Office.js 由微软官方 CDN 加载；加载官方运行库不代表上传正文。

## Word 插入功能（2026-10-29 核心实机验证通过）

正式入口为 `word.xml` / `word.html`，探针仍单独保留。已获得正式接口在 Word 中读取、生成预览、插入和撤回的实机证据；尚不能把这些接口检查表述成完整快捷键手势已经验收。

- 开发用证书放 `prototype/.local/office-live/localhost-{key,cert}.pem`；准备运行目录时复制到同名私有目录。不会自动改变系统信任。
- 本机服务以 HTTPS `localhost:47722` 提供加载项和随机令牌保护的命令桥。只监听 127.0.0.1；核对 Host、Origin 和令牌。没有外部网站调用 Word 读写的 CORS 接口。文档任务期间，47721 上来自浏览器 Origin 的 Agent 请求被拒绝。
- 使用微软 Mac 侧载目录加载 `word.xml`（申请 ReadWriteDocument，WordApi 1.3）。首次加载与新增证书信任需要明确确认。
- 在当前文稿打开加载项并保持面板运行，点击正文放置**空的插入光标**，按 ⌥⌘V。非空选区会被拒绝，不默认替换。
- 加载项保存 tracked Range，并读取完整主文档正文、所有正文段落、光标前后及所在章节。正文上下文超过 18 万字符时明确报错；不静默截断冒充全文。页眉、页脚、批注、文本框未包含在这一版正文范围中。
- 桌面弹窗第一行为要求输入，随后三个独立建议。普通内容包没有输入框；原 Blender 等目标的建议保留。
- 复用 FileRunner 和现有模型执行链，只允许 `prepare_word_insertion` 生成并校验完整纯文字。生成完成后立即核对正文 OOXML 并插入保存位置；界面不再显示独立预览或二次应用。模型不直接操作 Word。
- 插入回包不确定时冻结该目标，不自动重复写入。撤回只删除本次保存的 inserted Range，若该段被继续编辑则拒绝；不是调用一次全局 ⌘Z。
- 弹窗位置优先取 macOS 辅助功能的插入光标边界；Word 未暴露边界时靠近最后点击位置，并显示说明。**屏幕坐标只决定面板位置，实际写入始终依据 Word Range。**

主要文件：`src/office-live/bridge.ts`（传输）、`office-live/word-adapter.js`（Word API）、`src/targets/word-live.ts`（统一编辑目标）、`Sources/WordInsertionPoint.swift`（弹窗位置）。没有引入新的运行依赖或通用 Computer Use 执行器。

自动检查：`tests/word-live.test.ts`、`tests/word-bridge.test.ts`、`desktop-preview/tests/word-paste.mjs`。这些不替代实机验证：未保存正文读取、准确插入、用户光标移动后的固定位置、格式与后文保留、冲突拒绝、撤回、三条真实模型建议都需 Word 联调确认。

## Excel 选区编辑（2026-10-29 待实机侧载）

- 在 Excel 选择一个连续矩形单元格区域后按 ⌥⌘V。单元格内部处于输入状态时，桌面宿主先让 Excel 正常提交当前输入，再读取仍然选中的单元格区域。
- Excel 加载项通过 `Workbook.getSelectedRange()` 保存 tracked Range；屏幕坐标只放置弹窗，不决定写回地址。多重不连续选区由 Office API 明确拒绝。
- 上下文包含当前工作簿所有工作表的 values-only 有效区域，以及保存选区的地址、公式、显示文字和数字格式。有效区域超过 5 万格、序列化上下文超过 22 万字符或选区超过 1 万格时明确拒绝，不截取局部内容冒充完整工作簿。
- 三条建议仍使用同一套内容包与模型链路。每次修改必须返回与选区完全同行同列的二维矩阵；校验完成后立即写入 Excel。公式使用 A1 形式且以 `=` 开头。
- 写入前重新比较所有工作表的公式、选区地址和数字格式；发生变化就拒绝本轮结果。写回只设置保存 Range 的 `formulas`，保留既有单元格格式。写回结果不确定时冻结重试，避免重复修改。
- 撤回只在选区仍等于本次写入结果时恢复捕获时的公式／值；用户继续编辑后拒绝覆盖。

2026-11-03：Excel 已采用独立候选与逐级撤销，不再先撤旧版再生成。支持明确区分纯文字和公式，回读计算错误；普通区域保留格式，合并／数组／溢出／结构化表／受保护区域先拒绝。清单和运行时要求 ExcelApi 1.13，以检查复杂区域。独立合成稿真实模型两版修改及两次撤销通过，见 [工作流与边界](../docs/excel-figma-workflow.md)。

接口依据：[Workbook.getSelectedRange](https://learn.microsoft.com/en-us/javascript/api/excel/excel.workbook?view=excel-js-preview)、[Worksheet.getUsedRangeOrNullObject](https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet?view=excel-js-preview)、[Range.formulas、合并区域、数组与 track](https://learn.microsoft.com/en-us/javascript/api/excel/excel.range?view=excel-js-preview)。

主要文件：`office-live/excel.xml`、`office-live/excel-adapter.js`、`src/targets/excel-live.ts`。自动检查：`tests/excel-adapter.test.ts`、`tests/excel-live.test.ts`、`tests/excel-paste-agent.test.ts` 和 `desktop-preview/tests/word-paste.mjs`。本机已建立独立合成工作簿“工作簿1”的 A1:C4 测试表；加载项未侧载、开发证书未信任，因此真实 API 读写、三条模型建议、确认写回和安全撤回仍待授权后验收。

### 本轮真实结果与修正

- 用户明确授权后，将 `word.xml` 放入 Word 的 wef 开发目录；证书仅添加当前用户的 SSL／localhost 信任约束，有效至 2026-11-28。macOS `security verify-cert` 成功，Word 原生加载项实际显示“已连接”。没有关闭证书验证。
- 用独立测试内容目录 `.local/word-live-e2e/clipboard` 和合成文稿 `word-live-test-2026-10-29.docx` 验证。临时内容包仅两份合成资料；结束后已停用测试服务、恢复原内容目录，未把本轮测试资料混入用户收藏。
- 真实模型给出三个独立方向；随后生成的正文准确包含仅存在于未保存编辑器中的 `E2E-1029-1951`，该标记不在内容包里。预览期间 Word 没有插入生成内容。
- 在确认前把当前光标移到文末，确认后仍准确插到原“【插入位置】”之后；只插入一次，移除生成段后与插入前的全部文字完全相同。撤回后再次逐字相等，保留未保存标记。
- 再次生成预览后修改正文，应用被明确拒绝，来源保留在活动包；测试后已清理冲突标记。
- 修正 Mac Office 返回普通文件路径时无法匹配的问题；空范围不再用 getFirst 或逐段 getRange 定位，主文档文本序列可一致映射时提供段落索引，结构不一致时返回 -1，仍提供保存 Range 的准确前后文，不猜测索引。
- Word 每次导出的包元数据与 XML 顺序不同。推荐缓存改为正文／段落的逻辑指纹；应用和撤回将 OOXML 按命名空间、属性与包部件规范化，保留文字、空格、内容和格式差异，排除属性顺序、docProps 时间、校对／视图／修订标识等编辑元数据。
- 后端兼容 `word-paste` 与 `office-paste` 两代本机请求标记；界面保留 openWordPaste 到 openOfficePaste 的别名，避免新服务／界面与旧宿主混用失效。浏览器 Origin 仍不得发起 Word 任务。
- 当前正等待用户在测试文稿里亲手按 ⌥⌘V 的弹窗反馈。自动化工具向后台 App 发出的按键不等于系统全局热键触发，不能据此声称完整手势已跑通。
