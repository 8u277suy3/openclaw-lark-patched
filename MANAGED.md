# openclaw-lark-patched — 维护说明

> 本文件为仓库维护说明；README.md 为本副本的总览说明。

## 仓库性质

飞书官方 `@larksuite/openclaw-lark` 插件的自维护 **dist 级副本**。

- 基线：`@larksuite/openclaw-lark@2026.7.16`（npm tarball，可用 `npm pack @larksuite/openclaw-lark@2026.7.16` 重新获取比对）
- 运行环境：OpenClaw 2026.8.2（2.0 系）
- 补丁：2026-09-03 由外部 Kimi 手工应用（4 个文件）；本仓库收录补丁后的完整代码 + diff 存档
- 许可：沿用上游 MIT（版权归 larksuite）

## 为什么需要补丁

官方插件面向 OpenClaw 1.x SDK。2.0（2026.8.1）重构了插件 SDK：

1. 移除裸 `openclaw/plugin-sdk` 导出 → 必须改用子路径；
2. `plugin-sdk/channel-runtime` 子路径并入 `plugin-sdk/channel-outbound`；
3. Node ≥22 语法检测会把**含 `import.meta` 的文件判定为 ESM**，使 CJS 运行时 `require()` 拿到空命名空间。

不补丁则插件在 2.0 下无法加载（或运行时静默异常）。

## 补丁明细（4 处，diff 见 `patches/*.diff`）

| # | 文件 | 变更 | 目的 |
|---|------|------|------|
| 1 | `index.js` | `require("openclaw/plugin-sdk")` → `require("openclaw/plugin-sdk/core")` | 2.0 移除裸导出 |
| 2 | `src/card/reply-dispatcher.js` | `openclaw/plugin-sdk/channel-runtime` → `openclaw/plugin-sdk/channel-outbound` | 8.2 子路径合并（已验证 `createReplyPrefixContext`/`createTypingCallbacks` 可用） |
| 3 | `src/core/token-store.js` | `createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url)` → `createRequire(__filename)` | 消除 import.meta，避免 Node22 误判 ESM |
| 4 | `src/core/version.js` | 删除 `fileURLToPath(import.meta.url)` 推导 `__dirname`，直接用 CJS 内建 `__filename`/`__dirname` | 同上 |

打补丁前的原始文件备份在 `patches/bak/`。

## 功能移植：对标 openclaw-lark-2（2026-09-03，v2026.7.16-p1）

自 Mirr0ch1/openclaw-lark-2@cca892b（2026.9.4）按文件粒度移植 8 项能力，共改 28 个文件（+4 新增）：

| 能力 | 落点 |
|------|------|
| F1 PIN 消息操作（pin/unpin/list-pins）| `src/messaging/outbound/pins.js` + actions.js 挂接 |
| F2 多图合并一条 post（multiImageMode，默认 post，失败回退逐张）| `src/messaging/outbound/multi-image-mode.js` + deliver/send 挂接 + config-schema |
| F3 footer 第 7 项 provider | `src/core/footer-config.js` + `card/builder.js` |
| F4 工具调用动态展示默认开 | `card/tool-use-config.js` |
| F5 群聊流式卡片（replyMode.group 体验对齐）| `card/streaming-card-controller.js` |
| F6 ask_user 按钮卡片（含“其他答案”、群聊全员可交互）| `card/ask-user-gateway-card.js` + dispatch/handler/event-handlers/monitor 挂接 |
| — 删除 feishu_ask_user_question（阿訫令：引发工具调用错误循环）| `src/tools/ask-user-question.*` 已删；index.js/plugin.json 同步移除注册与契约 |
| F7 SSRF 全量防护 | `src/core/ssrf.js` + feishu-fetch/raw-request/lark-client/uat-client/device-flow/oauth/mcp-shared/media 共 10 文件 |
| F8 vitest 测试基座 | `tests/` 10 文件 97 用例全绿（本地需 junction 链接宿主 openclaw：`node_modules/openclaw` → `%APPDATA%/npm/node_modules/openclaw`） |

验证：fork 自带测试套件对本移植 **97/97 通过**；`node --check` 全部语法 OK；index.js 可加载（id=openclaw-lark 保持身份不变，UA 保持 openclaw-lark/…）。

注意：fork 对 4 个 kimi 补丁文件做了自己的等价修复（index plugin-sdk/core、reply-dispatcher→channel-message、token-store/version 去 import.meta）；移植后以 fork 版本为准，kimi 补丁语义被覆盖保留。

## 更新策略

- 日常改动：直接修改 `src/**/*.js` 编译产物（CommonJS、无构建步骤，同步部署目录后重启网关生效）；
- 官方发新版：解包新 tarball 替换工作树 → 重放 `patches/*.diff`（kimi 4 处，大部分已被 fork 移植版覆盖）+ 重新应用 `scripts/check-tools.js` 验证 → 回归；
- 除以上 4 文件外，工作树与 2026.7.16 原件**逐字节一致**（426 文件哈希核对）。

## 本机部署位置（生产实例）

```
%USERPROFILE%\.openclaw\npm\projects\larksuite-openclaw-lark-b3091cd05f__openclaw-generation__g-ee3c47544aa3ea3b\node_modules\@larksuite\openclaw-lark
```

改动本仓库后同步该目录并重启网关。
