# 苹果验证素材

| 文件 | 用途 | 来源与许可 |
| --- | --- | --- |
| [reference/apple.jpg](reference/apple.jpg) | 网页采集的红苹果参考照片，2418 × 2192，原图未修改 | Abhijit Tembhekar，[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Red_Apple.jpg)，[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| [models/apple.glb](models/apple.glb) | 固定插入资产；低多边形苹果，带颜色贴图 | Kenney，[Food Kit 2.0](https://kenney.nl/assets/food-kit)，[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [models/apple-preview.png](models/apple-preview.png) | 模型包自带的 64 × 64 预览图 | 同模型 |
| [models/apple-render.png](models/apple-render.png) | 本机 Blender 导入后渲染的 512 × 512 预览 | 基于 Kenney 模型渲染 |
| [models/apple-info.json](models/apple-info.json) | 导入验证、材质与包围盒记录 | 本机验证结果 |
| [models/KENNEY-LICENSE.txt](models/KENNEY-LICENSE.txt) | 模型包原始许可文本 | 原样保留 |

图片署名：**“Red Apple” — Abhijit Tembhekar / Wikimedia Commons / CC BY 2.0；未修改。** 分享或展示该照片时保留此署名与许可链接。

模型包原始 GLB 引用外部 `Textures/colormap.png`。交付的 `apple.glb` 已将原贴图嵌入同一 GLB 文件，几何、UV 和材质参数不变；搬运这个文件即可带走材质。来源、原始与成品 SHA-256、转换说明见 [manifest.json](manifest.json)。

初始苹果验证用例采用映射：识别出苹果参考图 → 使用 `models/apple.glb`。当前自然语言 Agent 可按确认的要求使用此资产或程序化创建其他几何，不再把映射作为所有意图的规则。照片是实物照片，模型是低多边形风格；不模拟照片重建，不代表照片到三维的生成质量。

已在独立的 Blender 5.2.3 LTS 后台进程实际导入并渲染：1 个网格、252 个顶点、1 个材质，内嵌 512 × 512 贴图成功载入。导入后的尺寸约为 `0.1963 × 0.1963 × 0.1908` Blender 单位；场景单位与苹果目标大小仍需在放置时明确配置。后续 MCP 与桌面放置已验证，最新结果见 [开发状态](../docs/development-status.md)。

在 Chrome 中打开上方 Commons 来源页，找到苹果图片并复制，即可作为后续网页输入测试。Blender 中通过 File → Import → glTF 2.0 导入 `models/apple.glb`。
