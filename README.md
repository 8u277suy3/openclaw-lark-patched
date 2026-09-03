# openclaw-lark-patched

飞书官方 `@larksuite/openclaw-lark` 插件的**自维护补丁副本**。

- **基线版本**：`@larksuite/openclaw-lark@2026.7.16`（npm tarball，未改动的原件可用 `npm pack @larksuite/openclaw-lark@2026.7.16` 重新获取）
- **运行环境**：OpenClaw 2026.8.2（2.0 系）
- **补丁状态**：2026-09-03 由外部 Kimi 手工打补丁（4 个文件），本仓库收录补丁后的完整插件 + 补丁 diff 存档
- **许可**：沿用上游 MIT（见 `LICENSE`，版权归 larksuite）

## 为什么需要补丁

官方插件发布时面向 OpenClaw 1.x SDK。OpenClaw 2.0（2026.8.1）重构了插件 SDK：

1. 移除了裸 `openclaw/plugin-sdk` 导出（需改为子路径 `.../core`）；
2. `channel-runtime` 子路径并入 `channel-outbound`；
3. Node ≥22 的语法检测会把**含 `import.meta` 的文件判定为 ESM**，导致 CJS 运行时 `require()` 拿到空命名空间。

不打补丁时插件在 2.0 下无法加载。详见 [PATCHES.md](./PATCHES.md)。

## 与官方插件的关系及更新策略

上游 npm 包只发布了编译产物（无公开 TS 源码仓库同步维护），因此本仓库维护的是 **dist 级副本**：

- 日常：直接修改 `src/**/*.js` 编译产物（本插件为 CommonJS，无构建步骤，改完重启网关即生效）；
- 官方发布新版时：`npm pack @larksuite/openclaw-lark@<新版本>` 解包替换工作树，再按 `patches/*.diff` 重放兼容性补丁；
- `patches/bak/` 保留了打补丁前的 4 个原始文件，可随时回滚。

## 部署方式（本机）

本副本即当前生产在跑的代码，位于：

```
~\.openclaw\npm\projects\larksuite-openclaw-lark-b3091cd05f__openclaw-generation__g-ee3c47544aa3ea3b\node_modules\@larksuite\openclaw-lark
```

改动本仓库后同步该目录并重启网关即可。

## 目录结构

与上游 npm 包一致（`index.js` + `src/` + `skills/` + `bin/`），另加：

- `patches/` — 4 个补丁的 diff 存档 + 说明
- `PATCHES.md` — 补丁明细与重放方法
