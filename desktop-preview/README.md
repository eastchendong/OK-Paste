# 妥帖基本组件库 · 桌面应用

这个目录提供可直接在 macOS 桌面上操作的妥帖悬浮界面。它加载仓库中的 [`components-preview.html`](../components-preview.html)，保留其中的标识、图标、元素尺寸、排版、文案、动画与交互代码。桌面宿主负责透明窗口、鼠标穿透、真实系统背景材质，并启动本仓库的剪贴板服务。普通网页仍是交互与排版的基准。

当前应用入口与合并验收范围见 [APP 接入状态](../docs/app-integration-2026-11-04.md)。Figma 使用实时矢量插件；剪映接入暂时禁用。

本机已配置 Blender 普通启动后的自动连接；Figma 插件运行后自动接通/重连，插件被关闭时仍需再打开一次。其他机器的配置及关闭方法见 [自动连接](../docs/run.md#自动连接2026-11-04)。

在这台 Mac 的现有仓库里：

```sh
cd desktop-preview
zsh build.sh
open ~/Applications/妥帖.app
```

应用将复制内容保存在 `~/Library/Application Support/Tuotie/runtime/.local/clipboard/`。原生 macOS 划词不需要浏览器扩展：辅助功能开启后，实际选中文字才出现 **加入内容包** 单按钮，保存参考并写系统剪贴板；默认 **Alt+C** 直接复制当前选区。当前暂时隐藏 **设为目标位置**，空白插入光标、普通点击和鼠标停留不触发操作条。底层目标接口保留供后续恢复，Word／Excel／PowerPoint 的 **⌥⌘V** 入口独立保留。

**跨应用加入内容：⌘⌥C（Command + Option + C）**。在微信、Codex、文本编辑等应用里选中文字，或在原应用中选中／打开可复制的图片，再按快捷键。妥帖仅在本次快捷键触发时让前台应用执行标准复制，等待剪贴板产生新内容，再保存文字或真实图片字节与应用来源；不依赖划词 AX 选区接口。普通 ⌘C 仅复制，不自动加入内容包。应用未提供复制内容、选区为空、切换了前台应用或权限缺失时会提示失败，不采集旧剪贴板。图片上限 6 MB，文字上限 10 万字；不支持的文件类型不会作为文字路径加入。

设置只显示辅助功能授权状态，并提供用户主动打开系统设置的入口。不会在启动或划词时调用系统权限请求接口。浏览器扩展仍是可选的 DOM／图片／视频增强入口，没有在用户的 Chrome 自动安装。未完成来源重启后仍在，成功应用或复制生成结果后整包归档；取消、失败保留，生成中新增来源留给下一任务。

顶部 **妥帖小人图标 → 设置…** 可配置 OpenAI 兼容的 Base URL、模型名称与 API Key，以及 加入内容包、显示／收起、归档、打开设置、停止任务的快捷键。点击绑定按钮后按组合键，Delete 清除、Esc 取消，点「保存设置」生效。Key 不回显，保存在本机 `.env.local`，下次模型请求读取新值。原生快捷键保存后即时生效；可选扩展在回到网页时刷新绑定。

应用已包含与小人一致的 macOS 图标，菜单栏采用可随系统明暗适配的轮廓。模型连接采用 Chat Completions，详细字段与 DeepSeek 默认配置见 [模型接口](../docs/model-api.md)。

顶部菜单只提供真实业务：显示内容包、查看归档、选择系统剪贴板／留在妥帖／Blender／Office 文件目标、打开当前目标、停止任务、撤销和设置。示例页和组件目录仍在仓库中，已移出产品菜单。`build.sh` 准备 Application Support 运行目录并安装 `~/Applications/妥帖.app`；不要另开旧版 `pnpm start`。启动不依赖 Desktop 仓库路径。详细步骤见 [运行说明](../docs/run.md)。

真实 Blender 操作：点击推荐或输入自然语言后，在独立场景生成预览；点「应用」才提交，点「取消」保留正式场景。提交后的「撤回」会调用真实场景撤回。生成中的停止也会取消预览。另已接通 DOCX/XLSX/PPTX 文件工具：先在仓库根目录执行 `pnpm run setup:office`，再用菜单「选择目标文档、幻灯片或表格…」选择已保存文件。同一浮窗依据文件上下文生成建议，在独立副本预览，确认应用后可精确撤回。这不读取原生编辑器的未保存内容或实时选区；原生前台流程仍待验收。

## 组员从 GitHub 预览

使用 Apple Silicon Mac（macOS 13 或更新版本）：

1. 首次使用时，从 [项目 GitHub 仓库](https://github.com/eastchendong/OK-Paste) 克隆仓库；已有本地副本时拉取最新的 `main`。也可以使用 GitHub Desktop 完成克隆或拉取。
2. 在本地仓库中找到 `desktop-preview/preview/TuotieDesktopPreview-macos-arm64.zip`，双击解压。
3. 双击解压得到的 `TuotieDesktopPreview.app`，体验既有版本的组件交互。该 ZIP 是拆分前已有的构建。

首次克隆的终端操作示例：

```sh
git clone https://github.com/eastchendong/OK-Paste.git
cd OK-Paste
```

若已克隆，在现有仓库目录更新：

```sh
git pull origin main
```

预览不需要安装 Node、Blender 或编译工具。未配置身份的独立审查包可显式采用 ad-hoc 签名；日常安装构建必须使用固定证书身份。本机开发身份不等于 Apple Developer ID 或公证，不能据此声称跨电脑免 Gatekeeper 检查。

## 修改组件后重新构建

先退出正在运行的旧版，再从仓库根目录执行：

```sh
cd desktop-preview
zsh build.sh
```

构建需要 Node、已安装的仓库依赖、uv，以及本机 Command Line Tools 或 Xcode 自带的 Swift 编译器；生成的应用与压缩包位于 `preview/`。`build/` 是可重建产物，不进入 Git；修改 Swift 后重建并重启程序。HTML／JS 调整可只运行 `node ../scripts/prepare-desktop-runtime.mjs`，再重启同一个已安装宿主；界面从 Application Support 的 `runtime/ui/` 加载，不重新签名 app。

仅验证编译并更新仓库 ZIP 时使用 `zsh build.sh --package-only`。该模式不会同步 Application Support、安装应用或改动已运行服务，适合合并检查。

需要运行共享接口检查时，从仓库根目录执行：

```sh
cd desktop-preview
npm ci
npm test
```

这套测试依赖单独锁定在本目录，不修改现有 Electron / Blender 原型的依赖。测试检查生成、停止、撤回、保留及推荐与内容包的联合折叠；视觉和鼠标操作仍需在桌面程序中验收。

启动后，小人按任务状态改变站位与动画：空闲停在边缘；待粘贴守在内容包右上；处理中移到较高位置并持续反馈；完成后显示一句结果和下一步。点击小人直接收起或展开下方内容，后台任务继续。Word、Excel、PowerPoint 的生成结果直接写入原软件，完成反馈区只提供撤销与继续调整，不再显示独立预览或二次应用；其他目标继续遵循各自事务边界。归档后的来源可用于后续调整，但不重新堆回活动内容包。当前聚焦位置显示在包内底部。

## 开发签名与上下文边界

日常安装在编译前检查固定身份，禁止静默 `--sign -`。`scripts/desktop-signing.mjs` 优先读取 `TUOTIE_CODESIGN_IDENTITY`，然后读取 `~/Library/Application Support/Tuotie/signing/identity.json`，最后兼容 `.local/codesign-identity`。候选签名必须有效；若旧安装版已有证书DR，新包必须满足同一要求，否则拒绝覆盖。构建不创建证书、不改信任或TCC，缺少身份时应先完成初始化。直接给 `prepare-desktop-runtime.mjs` 传 App 路径时，也会在资源写入前和复制前只读验证候选证书签名及旧版 DR；无 App 参数的纯资源同步不受影响。

有 Developer ID / 开发证书可直接使用其精确指纹。没有现成身份时，显式运行 `python3 scripts/setup-desktop-signing.py --create`（从仓库根目录）创建一次本机专用叶证书：CA:false、仅codeSigning、独立钥匙串；不重新生成已有身份，不修改login/system钥匙串信任或默认搜索列表。专用链解锁秘密不是macOS登录密码，只保存在当前用户0700目录中的0600文件，不提交Git。

本机 codesign 工具对未信任身份会拒绝签名。需要对此持久变更明确授权后，才执行 `python3 scripts/setup-desktop-signing.py --trust-code-signing`：仅当前用户、仅该证书的codeSign策略，不增加TLS/SSL信任。该步骤不应由普通构建自动运行；自动审批拒绝时不能换工具或绕过。首次从旧ad-hoc迁移仍可能需最终一次AX登记；之后用两个不同原生版本的DR互验及实际AX留存确认，不保证证书更换或系统重置后永不再询问。

专用钥匙串只在签名期间临时加入用户搜索列表，结束时移除自身临时项并保留其他工具新增的条目；并发锁或恢复失败会拒绝安装。强制终止/断电后如发现残留锁，先检查其中 owner 信息和实际进程，不自动删除不明锁或重建身份。本机已完成一次迁移，并实际验证两个不同原生版本更新后辅助功能授权保留。

仅审查、不安装时可显式运行 `TUOTIE_CODESIGN_IDENTITY=- zsh build.sh --package-only`。普通HTML/JS/TS更新继续只同步runtime，复用原宿主签名。

签名检查：从仓库根目录运行 `pnpm run test:desktop-signing`。Apple依据：[TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements/)、[TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html)。

默认推荐随整个活动包、前台应用和可读取上下文刷新；标记 Start from here 时以标记目标为准，同时保留当前聚焦位置显示。普通应用生成待粘贴文字并在确认后复制，随后由用户在目标应用正常粘贴。Office/Figma 的 ⌥⌘V 使用已捕获的实时目标；选择已保存 Office 文件的独立副本流程也保留。剪映当前禁用，详见 [剪映状态](../jianying/README.md)。

来源一栏可点击：快捷键和右键扩展采集的网页保留实际页面 URL，点击返回原页面；本地文件返回文件。没有可读取地址的 App 显示「返回应用」，只能唤起原 App，不能保证定位到具体微信消息。更新前未保存网址的旧记录不按标题猜测地址，重新采集后才能带上准确网页链接。

## Codex 的接入入口

桌面浮层中的 `window.TuotieUI` 是共享界面的调用入口，版本为 `1`。通过 `WKWebView.evaluateJavaScript` 调用它；不要复制旧 React/Storybook 或 `native/TuotieUI` 中的外观实现。

```js
TuotieUI.configure({
  sources: [{
    id: 'report-1', kind: 'text', title: '行业趋势摘录', type: '文字',
    origin: '研究资料页', sourceKind: 'web', url: '', detail: '来源内容'
  }],
  targetLabels: { 'draft-section-2': '发展背景下方' },
  manualGeneration: true
});
TuotieUI.dispatch({ type: 'source/add', id: 'report-1' });
TuotieUI.dispatch({ type: 'target/set', id: 'draft-section-2' });
TuotieUI.subscribe(message => {
  if (message.event === 'generationRequested') {
    // 在业务流程中调用自己的生成服务，完成时再送回结果。
  }
});
TuotieUI.dispatch({ type: 'generation/start', instruction: '请补充行业背景' });
// 业务流程收到 generationRequested 并完成生成后：
TuotieUI.dispatch({ type: 'generation/finish', text: '业务流程生成的正文' });
```

原生宿主同时收到名为 `tuotie` 的 WebKit 消息，其中 `type: 'ui-event'` 表示组件事件；`type: 'geometry'` 只供透明窗口维护可点击区域和背景材质。`getState()` 返回可序列化的当前状态。`subscribe(listener)` 返回取消订阅函数。

| 操作 | `dispatch` 类型与字段 |
| --- | --- |
| 素材 | `source/add`、`source/select`、`source/remove`，均传 `id` |
| 目标 | `target/set` 传 `id`；`target/clear` |
| 方向与生成 | `direction/choose` 传 `index`；`generation/start` 可传 `instruction`；`generation/finish` 传 `text`；`generation/stop` |
| 完成后 | `result/undo`、`result/keep` |
| 组件状态 | `bundle/toggle`、`selection/show`、`draft/set` 传 `role` 和结构化 `parts`；`reset` 可传 `mode` |

`manualGeneration: true` 会停用 HTML 的 7 秒演示计时，发出 `generationRequested`；组员完成生成后再发送 `generation/finish`。生成中补充要求发出 `generationSupplemented`，停止发出 `generationStopped`，保留发出 `resultKept`。输入草稿的正式值是 `parts` 数组，文字为 `{kind:'text', value}`，引用为 `{kind:'source'|'target', id}`；不要从显示文字反解析引用 ID。

## 预览与业务能力的边界

菜单里明确标记为演示的素材、目标和生成文案仍是组件测试数据。实时模式由 `desktop-live.js` 接入真实剪贴板、Blender 和已保存 Office 文件，不能把演示菜单的效果算作业务验收。任意原生应用的实时选区与屏幕定位仍未完整接通。

对照要点和状态转移见 [`INTERACTION_CONTRACT.md`](INTERACTION_CONTRACT.md)。不得以“macOS 原生化”为由调整 HTML 的组件形状、尺寸、配色、Logo、文案布局或操作结果。

## 实现说明

- `Sources/main.swift`：透明浮动窗口、非组件区域鼠标穿透、macOS 26 的白色调色动态玻璃背景（旧系统回退到 `NSVisualEffectView`）、原生预览菜单。白色调色避免彩色桌面把内容包染灰；文字和交互仍由上层共享界面绘制。
- `desktop-overlay.js`：仅在桌面浮层加载，隐藏演示画布，复用 HTML 的渲染与交互，并暴露 `TuotieUI`。
- `build.sh`：把当前 HTML 与宿主打包为本地 `.app`。
- `../scripts/build-desktop-icons.mjs`：从共享 companion SVG 生成应用包与菜单栏图标源文件，随组件同步运行。`assets/AppIcon.svg`、`assets/StatusIcon.svg` 为生成物；`make-icons.swift` 渲染 ICNS 尺寸及 18pt @2x 模板图标，不另画角色。

macOS 的 `WKWebView` 在透明 HTML 下仍会绘制白色底。桌面宿主使用 WebKit 的 `drawsBackground` KVC 键关闭它，已在本机运行检查。这个键不是公开的稳定 SDK 接口；若准备分发到 App Store，先评估其兼容性并更换受支持的透明渲染方案。

### 原生玻璃状态检查

`npm run test:native-glass` 检查真实 AppKit 材质在不同尺寸、父级明暗外观和激活通知下保持 active／behindWindow。浮层采用状态固定的原生磨砂材质，避免点击头像激活窗口后切换为另一种玻璃外观；这项自动检查不替代真实桌面背景上的视觉验收。

### 紧凑划词工具条

当前单按钮工具条为 102×32 点，优先放在选区下方 6 点，下方空间不足才向上翻转。`npm run test:selection-placement` 检查多行范围、插入光标、屏幕边缘、多显示器和无法读取选区位置时的回退。网页前端 0.3.4 同步单按钮与空选区不显示的交互，已有旧页面需刷新。
