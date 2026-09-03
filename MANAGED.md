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

## 更新策略

- 日常改动：直接修改 `src/**/*.js` 编译产物（CommonJS、无构建步骤，同步部署目录后重启网关生效）；
- 官方发新版：解包新 tarball 替换工作树 → 按 `patches/*.diff` 重放上面 4 处（通常仍需全部）→ 回归验证；
- 除以上 4 文件外，工作树与 2026.7.16 原件**逐字节一致**（426 文件哈希核对）。

## 本机部署位置（生产实例）

```
%USERPROFILE%\.openclaw\npm\projects\larksuite-openclaw-lark-b3091cd05f__openclaw-generation__g-ee3c47544aa3ea3b\node_modules\@larksuite\openclaw-lark
```

改动本仓库后同步该目录并重启网关。
