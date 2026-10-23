# 学习通本地 Agent

浏览器扩展与本机 AI 服务组成的学习通辅助工具，当前版本 **0.2.8**。支持课程任务识别、练习处理、讨论回复和章节导航，实际完成状态以平台回执为准。

## 安装与运行

完整步骤见 [部署文档](DEPLOYMENT.md)。

1. 安装 Node.js 22 或更高版本，下载并解压本仓库。
2. 默认后端需要已登录的 Codex CLI，也可在扩展配置 DeepSeek 或兼容 API。
3. Windows 双击 `start.cmd` 启动本机服务。
4. Chrome 打开 `chrome://extensions/`，启用开发者模式，加载本项目的 `extension` 文件夹。
5. 将首次启动生成的 `data/token.txt` 配对令牌填入扩展并保存，刷新课程页面。
6. 进入具体章节，在弹窗确认服务连接后开始。可关闭自动提交及自动发布讨论，并随时停止。

服务默认仅监听 `127.0.0.1:18765`，不需要部署到公网。项目无 npm 外部运行依赖。

## 功能与限制

- 单选、多选、判断、文字填空和简答；保留代码缩进，可选择题目未指定时的编程语言。
- 本地或配置的题库辅助查找，答案经过校验；低置信度、不支持的题型和未知字体暂停处理。
- 媒体正常播放与静音维护，部分 PDF 模块逐页浏览；导航以平台完成标记为准。
- 已适配讨论模板的回复生成与发布；保存提交意图，回执不明时避免重复提交。
- 本地保存配置和进度；已完成章节支持导航和受限的一次刷新恢复。

AI 输出不保证正确。图片题、验证码和未适配模板可能需要人工处理；本地测试不代表所有真实课程已验证。

## 配置与数据

配置模板见 [.env.example](.env.example)，安装、更新、后台启动和排查见 [DEPLOYMENT.md](DEPLOYMENT.md)。扩展 AI 设置保存于 `data/provider.json`，优先于环境默认值。

`data/` 包含配对令牌、课程信息和模型请求，仅留在本机；`.env` 可能包含 API 密钥，不要提交或分享。题干、选项及相关上下文会发送给你选择的 AI 或题库后端。

## 验证

```powershell
node --test test/*.test.mjs
```

2026-10-23 发布准备：Node.js 24.20.0 下 **58 项单元测试通过**。没有调用付费模型或向真实课程提交。

浏览器隔离夹具 `test/*-fixtures.mjs` 当前使用相邻 `rea-runtime/node_modules` 中的 Playwright，运行服务不需要该工具。结果 JSON 为历史检查记录，不能作为真实平台完成证明。官方编辑器和真实字体测试依赖未发布的本地资源，缺少时应跳过；合成字体检查可运行 `node test/font-fixtures.mjs --without-live-font`。

## 发布包

```powershell
python scripts/package-release.py
```

生成上一级目录的版本 ZIP 和 `release-files.json`，校验归档完整性、SHA-256 及当前配对令牌排除。排除本机配置、运行数据、真实课程截图与 `live-*` 记录。

第三方资源来源及许可证见 [THIRD_PARTY_LICENSES.md](extension/vendor/THIRD_PARTY_LICENSES.md)。
