# 妥帖 / OK Paste · 项目记忆

## 2026-11-11 · macOS arm64 预览包更新

从 `cbdfcd9` 的干净源码重新构建并替换 `desktop-preview/preview/TuotieDesktopPreview-macos-arm64.zip`。已校验 arm64 架构、ad-hoc 签名、ZIP 完整性与包内资源。SHA-256 为 `cf77c0b446467ba77ba67aa93b3a8e6fcacce280b902b1bd7dfad8bbaa59ddab`。

## 2026-11-11 · 独立仓库构建恢复

补齐原生拖放、结果定位与反馈协议的源码，以及配套的桌面和后端测试、更新脚本。真实密钥、本机运行数据、未跟踪的 Blender 工程及安装证据留在原工作区。默认连接仍为 DeepSeek 官方 `https://api.deepseek.com`，模型为 `deepseek-flash`。

在只含 Git 文件的临时目录中，从锁文件安装依赖后通过 `pnpm build`。Vitest 360 项通过、11 项跳过，桌面共享测试 165 项通过，Blender 合成事务测试 9 项通过。原生拖放、结果浮层组件检查与 macOS arm64 审查包构建通过，签名及 ZIP 完整性已验证。

## 2026-11-11 · 独立仓库初始快照

从课程仓库提取 Git 已跟踪的原型文件，使用工作区的当前内容建立首个提交。默认模型连接为 DeepSeek 官方 `https://api.deepseek.com` 和 `deepseek-flash`。旧课程仓库历史、未跟踪文件、本机密钥和运行数据留在原处。

初始提交只迁移当时已跟踪的原型文件，随后补齐了构建依赖。

早期产品决策与实机检查见 [当前交接](docs/current-handoff.md)、[开发状态](docs/development-status.md) 与原课程仓库的项目记忆。
