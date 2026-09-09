# Motrix Next M3U8/HLS Support Implementation Plan

## Overview
为 Motrix Next 添加 m3u8/HLS 视频流下载支持，用户粘贴 m3u8 链接后自动解析分片、通过 aria2 下载、最后用 ffmpeg 合并为 MP4。

## Progress: ~75%

---

## ✅ 已完成

### 1. M3U8 Detection and Classification
**文件**: `src/shared/utils/batchHelpers.ts`
- `detectExternalInputKind` 中添加了 `.m3u8` 扩展名检测
- `BatchItemKind` 联合类型中添加了 `'m3u8'` (types.ts:548)
- 测试: `batchHelpers.test.ts` 中有 2 个检测用例

### 2. M3U8 Processing Route
**文件**: `src/stores/app.ts`
- `routeExternalDownloadInput` 中添加了 `kind === 'm3u8'` 处理
- 通过 `autoSubmitExtensionUrl` 提交，重处理委托给 `submitManualUris`

### 3. Task Submission (Core Flow)
**文件**: `src/composables/useAddTaskSubmit.ts`
- URI 分类: 分离 m3u8 / magnet / regular URIs
- 播放列表下载: `invoke('fetch_remote_bytes', ...)` 支持 proxy/headers
- 播放列表解析: `parseM3U8Playlist` 提取 .ts 分片 URL
- 临时目录: `prepareM3u8TempDir` 创建安全临时目录
- 分片下载: 每个 .ts 分片通过 `taskStore.addUri` 单独提交
- 进度监控: `waitForSegmentsCompletion` 轮询 aria2 状态
- 重试逻辑: 失败分片触发 `RETRY_NEEDED` 错误流，3 秒延迟，最多 5 次重试
- 合并: 调用 Rust `merge_m3u8_segments` 命令

### 4. M3U8 Parser Utility
**文件**: `src/shared/utils/m3u8Parser.ts`
- `parseM3U8Playlist(content, baseUri)` - 解析播放列表，处理相对/绝对 URL，支持 #EXT-X-KEY
- `prepareM3u8TempDir(dir, baseName, tsUris)` - 创建临时目录，生成零填充文件名

### 5. M3U8 Group Store
**文件**: `src/stores/task/m3u8Group.ts`
- Pinia store 管理 m3u8 下载分组
- Actions: `createGroup`, `registerSegment`, `updateSegmentStatus`, `retrySegment`, `setGroupStatus`, `removeGroup`
- Getters: `getGroup`, `countByStatus`, `allSegmentsTerminal`, `allSegmentsCompleted`, `hasAnyFailed`

### 6. Backend Commands (Rust)
**文件**:
- `src-tauri/src/commands/m3u8.rs` - `merge_m3u8_segments` Tauri 命令 (292 行)
  - 收集 .ts 文件，写 ffmpeg concat filelist，spawn ffmpeg，合并后删除临时目录
  - 5 个单元测试
- `src-tauri/src/commands/ffmpeg.rs` - `check_ffmpeg` 命令 (128 行)
  - 探测 ffmpeg 可执行文件，验证输出
  - 4 个单元测试
- `src-tauri/src/commands/net.rs` - `fetch_remote_bytes` 用于下载播放列表
- `src-tauri/src/error.rs` - `AppError::Ffmpeg` 和 `AppError::M3u8` 错误变体
- `src-tauri/src/commands/mod.rs` + `lib.rs` - 模块注册

### 7. Types, Config, i18n
- `src/shared/types.ts` - `SegmentStatus`, `M3u8Group` 类型定义
- `src/shared/constants.ts` - `ffmpegPath` 默认值
- `src/shared/configKeys.ts` - `ffmpeg-path` 在 `userKeys` 中
- 27 个语言文件 - ffmpeg 相关 i18n 键已添加

---

## ✅ 已完成 (2026-09-09)

### P0: ffmpeg 路径 UI
**文件**: `src/components/preference/Advanced.vue`, `src/composables/useAdvancedPreference.ts`
- Advanced 设置页新增 ffmpeg 路径输入框 + 浏览/测试按钮
- 测试按钮调用 Rust `check_ffmpeg` 命令验证路径
- 夹具: `useAdvancedPreference.test.ts` 全部 8 个 `AdvancedForm` 补齐 `ffmpegPath`
- i18n: `scripts/inject-ffmpeg-locale-keys.py` 批量写入 27 个 locale

### P1: m3u8 Segments 标签页 (方块网格)
**文件**:
- `src/components/task/TaskSegmentGraphic.vue` - Canvas 方块网格组件，含 failed→红色 与 click→`retry(index)` 处理
- `src/components/task/detail/TaskDetailSegments.vue` - Segments 标签页 (TaskSegmentGraphic + NDescriptions 进度摘要)
- `src/components/task/TaskDetail.vue` - `TabDef.m3u8Only`、`visibleTabs` 过滤、`isM3u8` 计算属性、Segments tab 内容
- `src/composables/useTaskCardModel.ts` - m3u8 状态徽章 (downloading/merging/completed/failed)
- `TaskItem.test.ts` - 补 `setActivePinia(createPinia())` 修复 useM3u8GroupStore 无活跃 Pinia 报错
- 颜色映射: pending→`--m3-surface-container`, downloading→`--m3-status-active`, completed→`--m3-status-success`, failed→`--m3-error`

### P1: m3u8 组级通知
**文件**: `src/composables/useAddTaskSubmit.ts`, `src/composables/useTaskNotifyHandlers.ts`
- `handleM3u8MergeComplete` / `handleM3u8Failure` 处理合并完成/下载失败通知 (toast + `send_app_system_notification`)
- `M3u8NotifyDeps` + `makeM3u8Deps` 工厂
- m3u8 分片任务抑制: 按 `M3U8_TEMP_DIR_PREFIX` (`.motrix-m3u8-`) 前缀过滤，分片完成/错误不触发独立通知
- Rust `monitor.rs` 新增 `is_m3u8_segment_task` 过滤 + 4 个测试
- i18n: `scripts/add-m3u8-notify-locale-keys.py` 批量写入 27 个 locale 的 6 个通知键
- 测试: `useTaskNotifyHandlers.test.ts` 新增 8 个用例 (抑制 ×2, 合并成功 ×2, 合并失败 ×2, 失败 ×2)

---

## ✅ 已修复的 Bug (2026-09-09)

### Bug 1: `setGroupStatus` 方法缺失
- **问题**: `useAddTaskSubmit.ts` 调用 `m3u8GroupStore.setGroupStatus()`，但 store 中没有此方法
- **修复**: 在 `m3u8Group.ts:205` 添加通用 `setGroupStatus(groupId, status)` 方法

### Bug 2: 前端/Rust 参数不匹配
- **问题**: 前端发送 `{ tempDir, outputFile, cleanupTempDir }`，但 Rust 期望 `{ tempDir, finalPath, ffmpegPath }`
- **修复**: 两处 `invoke('merge_m3u8_segments', ...)` 调用改为 `{ tempDir, finalPath, ffmpegPath }`
- **同时修复**: `hasAnyFailed` 属性访问改为方法调用 `m3u8GroupStore.hasAnyFailed(groupId)`

### Bug 3: 重复的 `parseM3U8Playlist`
- **问题**: `useAddTaskSubmit.ts` 中有一个未使用的本地副本 (482-512 行)
- **修复**: 删除本地副本，保留从 `@/shared/utils/m3u8Parser` 的导入

### 额外 Bug: `createGroup()` 缺少参数
- **问题**: `m3u8GroupStore.createGroup()` 无参数，但 store 要求 `{ videoName, finalPath, tempDir, ffmpegPath, segmentUrls }`
- **修复**: 补全所有必需参数

### Bug 5: 重试计数永不递增 (无限 RETRY_NEEDED 循环)
- **问题**: `retrySegment()` 不递增重试计数，导致失败分片无限重试
- **修复**: 递增计数并更新 `retryCount`，达到上限后置 `failed` 并触发 `M3u8SubmitFailure(max-retries)` 流程

### Bug 6: 编译错误 (`useAddTaskSubmit.ts` / `TaskDetail.vue` / 测试)
- **问题**: 重复 `const mergedFilePath` 声明; `'auto-file-renaming': false` 布尔值传入 `string | string[]` 参数; `SegmentStatus` 未导入; 测试夹具缺 `ffmpegPath`
- **修复**: 删除重复声明、改传 `'false'` 字符串、补导入、补齐全部 8 个夹具

---

## ✅ 环境修复与验证 (2026-09-09)

- **环境**: node_modules 因跨平台拷贝损坏 (`@rollup/rollup-win32-x64-msvc` 缺失等); 已按用户选择安装 Node 22.13.0 (`nvm use 22.13.0`)，绕过坏 corepack 直接运行 `pnpm.mjs` 重装 (需 `$env:CI="true"`)，锁文件未变
- `npx vue-tsc --noEmit` 通过
- `vitest run` 全量通过: **100 文件 / 2378 测试 / 0 失败** (CI=true)
- `prettier --check "src/**/*.{ts,vue,css,json}"` 通过 (locale `.js` 不在 format 范围内，属既有约定)
- `vite build` 通过 (25s, 退出码 0)
- 注: `task.test.ts` 的 addMagnetUri 完整性测试在并行全量下偶发 10s 超时 (单跑 ~3.6s 通过)，属既有 flake，与 m3u8 改动无关
- **阻塞**: `cargo check` 无法在本机运行 (cargo 不在 PATH)；Rust 侧改动需在含 Rust 工具链的环境验证

---

## ❌ 待完成

### P2: 可配置选项
- 分片并发数 (当前硬编码)
- 分片下载超时时间
- 分片重试次数 (当前硬编码为 5)
- 自动清理临时分片文件

### P2: 前端测试
- `m3u8Parser.ts` 单元测试
- `submitManualUris` m3u8 流程测试
- `m3u8Group` store actions 测试
- 边缘情况: 无效 URL, 不可访问分片, 加密 HLS

### P3: 直播流 vs 点播流
- 当前未区分，需要检测 `#EXT-X-STREAM-INF` 并拒绝直播流

---

## Technical Details

### M3U8 Parsing Logic
- 处理标签: #EXTINF, #EXT-X-KEY, #EXT-X-MAP 等
- 支持相对路径解析 (new URL(trimmed, baseUrl))
- 支持加密段落 (检测 #EXT-X-KEY)

### Aria2 Integration
- 每个 .ts 分片单独 addUri 提交
- 设置 `auto-file-renaming=false` 保持文件名
- 临时目录作为 `dir` 参数

### Error Handling
- 单个分片失败: 触发 RETRY_NEEDED 错误流
- 重试: 3 秒延迟，最多 5 次
- 合并失败: 保留临时目录供用户手动恢复

### ffmpeg Merge Flow
- 收集 .ts 文件，按文件名排序
- 写 ffmpeg concat demuxer filelist
- spawn: `ffmpeg -y -f concat -safe 0 -i filelist.txt -c copy output.mp4`
- 成功后删除临时目录

---

## Files Summary

| 文件 | 状态 | 说明 |
|------|------|------|
| `src/shared/utils/batchHelpers.ts` | ✅ | m3u8 检测 |
| `src/shared/utils/m3u8Parser.ts` | ✅ | 播放列表解析 |
| `src/stores/task/m3u8Group.ts` | ✅ | m3u8 分组 store |
| `src/composables/useAddTaskSubmit.ts` | ✅ | 核心提交流程 (已修复 Bug) |
| `src/stores/app.ts` | ✅ | 外部输入路由 |
| `src-tauri/src/commands/m3u8.rs` | ✅ | ffmpeg 合并命令 |
| `src-tauri/src/commands/ffmpeg.rs` | ✅ | ffmpeg 检测命令 |
| `src-tauri/src/error.rs` | ✅ | 错误类型 |
| `src/shared/types.ts` | ✅ | 类型定义 |
| `src/shared/constants.ts` | ✅ | 默认配置 |
| `src/shared/configKeys.ts` | ✅ | 持久化键 |
| 27 个语言文件 | ✅ | i18n |
| `src/components/task/TaskSegmentGraphic.vue` | ✅ | 方块网格组件 (P1) |
| `src/components/task/detail/TaskDetailSegments.vue` | ✅ | Segments 标签页 (P1) |
| `src/components/task/TaskDetail.vue` | ✅ | 添加 Segments tab (P1) |
| `src/composables/useTaskCardModel.ts` / `TaskItem.vue` | ✅ | m3u8 状态徽章 (P1) |
| `src/composables/useTaskNotifyHandlers.ts` | ✅ | m3u8 组级通知 (P1) |
| `src-tauri/src/services/monitor.rs` | ✅ | 分片通知抑制 (需 cargo check) |
| 偏好设置 UI (Advanced.vue) | ✅ | ffmpeg 路径配置 (P0) |
| 前端测试文件 | ✅ | 通知/提交流程测试 (P2 部分) |
