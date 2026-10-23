# 安装与部署

本项目由浏览器扩展和本机 Node.js 服务组成，当前版本 0.2.8。服务与浏览器应运行在同一台电脑；以下 Windows 操作与仓库自带脚本对应。

## 环境要求

- Node.js 22 或更高版本，`node --version` 可用。
- Chrome 或兼容 Manifest V3 的 Chromium 浏览器。
- 默认 AI 后端需要已安装并登录的 Codex CLI；也可以在扩展中配置 DeepSeek 或兼容接口。
- Python 仅用于重建发布 ZIP，不是服务运行依赖。

项目没有 npm 外部运行依赖，无须安装相邻的 REA 工具即可运行。浏览器回归测试需要额外的 Playwright 环境。

## 首次安装

1. 将源码或发布包解压到固定目录，保留 `extension`、`lib`、`scripts` 等完整目录结构。
2. 如需环境配置，将 `.env.example` 复制为 `.env`；已有配置不要覆盖。默认使用本机 Codex 登录。
3. 双击 `start.cmd`，或在项目目录执行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Start`。这是本机后台服务启动方式。
4. Chrome 打开 `chrome://extensions/`，启用开发者模式，选择“加载已解压的扩展程序”，选择项目的 `extension` 目录。
5. 在本机打开 `data/token.txt`，将配对令牌填入扩展弹窗并保存。不要分享令牌或将它提交到 GitHub。
6. 刷新已打开的课程页，在扩展中确认服务已连接、版本一致，再选择具体课程章节开始使用。

如希望服务随 Windows 登录启动，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Install
```

脚本使用任务 `Codex-Chaoxing-Local-Agent`，监督服务退出后恢复。安装与启动请在正常用户环境进行。服务默认监听 `127.0.0.1:18765`，扩展协议使用固定端口，保持默认值。

## AI 配置

扩展保存的设置位于 `data/provider.json`，优先于 `.env` 默认值；修改后端时应先等待当前请求结束或停止任务。

兼容接口配置示例（占位值需要自行替换）：

```ini
AGENT_PROVIDER=http
AGENT_BASE_URL=https://your-provider.example/v1
AGENT_API_KEY=replace-with-your-key
AGENT_MODEL=replace-with-your-model
AGENT_RESPONSE_FORMAT=json_schema
PORT=18765
```

输出格式可选 `json_schema`、`json_object` 或 `text`，取决于服务能力；DeepSeek 预设默认使用 `json_object`。也可以直接通过扩展设置 AI 后端。题目与课程上下文会发送给所选后端。

修改 `.env` 后重启服务。保留已有代理与 `NO_PROXY` 设置；使用 hzvpn 稳定桥接的本机继续使用 `127.0.0.1:17891`，不要填入随节点变化的上游端口。本机服务请求应绕过代理。普通安装不要求配置该桥接。

## 状态、更新与故障排查

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/manage-service.ps1 -Action Restart
```

- 无法连接：先检查状态，再启动服务；查看 `data/service-stderr.log` 和 `data/service-lifecycle.log`。
- 配对失败：重新复制当前 `data/token.txt`；不要通过删除整个 data 目录解决问题。
- 模型错误：默认后端在正常终端运行 `codex login status` 检查登录；接口后端检查所选模型、地址及额度。
- 设置未生效：检查扩展是否已有保存配置，是否覆盖 `.env`；更新代码后重新加载扩展并刷新课程页。
- 端口占用：确认占用者；管理脚本不会停止不属于本项目的程序。
- 提交结果未知：先检查平台回执。仅在确定没有提交时使用扩展提供的当前页未确认记录处理功能，避免重复提交。

更新前停止托管并备份本机 `.env` 与 `data`，更新程序文件后重启服务、重新加载扩展及刷新页面。回退同样保留本机数据；备份包含私人内容，应仅留在本机。

## 验证与发布

```powershell
node --test test/*.test.mjs
python scripts/package-release.py
```

2026-10-23 本次发布准备使用 Node.js 24.20.0，58 项单元测试通过；没有调用付费模型或向真实课程提交。浏览器夹具的环境与命令见 README，历史结果不代表本轮重跑。

打包生成上一级目录中的版本 ZIP 与项目内的 `release-files.json`，校验每个文件 SHA-256、归档完整性和当前配对令牌排除。发布只使用白名单归档内容；不上传整个工作目录。`.env`、`data/`、真实课程截图及 `live-*` 联调记录不进入归档。第三方资源说明见 `extension/vendor/THIRD_PARTY_LICENSES.md`。
