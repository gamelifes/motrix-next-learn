# Motrix Next M3U8/HLS Support Implementation Plan

## Overview
This plan details the implementation of m3u8/HLS video stream support in Motrix Next, enabling users to download m3u8 playlists and automatically merge ts segments into a complete video file.

## Implementation Steps

### 1. M3U8 Detection and Classification
**修改文件**: `/src/shared/utils/batchHelpers.ts`

#### 中文步骤:
1. 在 `detectExternalInputKind` 函数中添加对 `.m3u8` 扩展名的检测
2. 当检测到 m3u8 URL 时，返回特殊的 BatchItemKind 类型（例如 'm3u8'）
3. 确保此检测发生在 HTTP/HTTPS URL 检查之后，但在那些特殊处理（如 .torrent）之前

#### English Steps:
1. Add `.m3u8` extension detection in the `detectExternalInputKind` function
2. When an m3u8 URL is detected, return a special BatchItemKind type (e.g., 'm3u8')
3. Ensure this detection occurs after HTTP/HTTPS URL checking but before special handling (like .torrent)

### 2. M3U8 Special Processing
**修改文件**: `/src/stores/app.ts`

#### 中文步骤:
1. 在 `routeExternalDownloadInput` 函数中添加对 m3u8 类型的处理
2. 当检测到 m3u8 URL 时：
   - 下载 m3u8 播放列表内容
   - 解析播放列表以提取所有 .ts 分片 URL
   - 处理相对路径（转换为绝对 URL）
   - 处理加密的 HLS（如果需要）
   - 创建多个 BatchItem，每个对应一个 .ts 分片
   - 或者创建一个特殊的 BatchItem，包含所有分片信息用于后处理
3. 根据用户设置决定是自动提交还是显示添加任务对话框
4. 处理直播流 vs 点播流的不同处理方式

#### English Steps:
1. Add m3u8 type handling in the `routeExternalDownloadInput` function
2. When an m3u8 URL is detected:
   - Download the m3u8 playlist content
   - Parse the playlist to extract all .ts segment URLs
   - Handle relative paths (convert to absolute URLs)
   - Handle encrypted HLS (if needed)
   - Create multiple BatchItems, each corresponding to a .ts segment
   - OR create a special BatchItem containing all segment information for post-processing
3. Based on user settings, decide whether to auto-submit or show the Add Task dialog
4. Handle live streams vs VOD streams differently

### 3. Task Submission for M3U8
**修改文件**: `/src/composables/useAddTaskSubmit.ts`

#### 中文步骤:
1. 在 `submitManualUris` 函数中添加对 m3u8 类型的处理
2. 创建专门的 m3u8 提交函数：
   - 对于每个 m3u8 URL，下载并解析播放列表
   - 提取所有 .ts 分片 URL
   - 使用 aria2 的 `addUri` 方法一次性提交所有分片作为一个任务
   - 设置适当的选项以确保文件正确合并（如 `continue=true`）
   - 处理文件命名：使用 m3u8 URL 的基础名称或用户提供的名称
3. 在 `buildEngineOptions` 函数中添加 m3u8 特定选项处理
4. 确保错误处理和重试机制适用于分片下载

#### English Steps:
1. Add m3u8 type handling in the `submitManualUris` function
2. Create a dedicated m3u8 submission function:
   - For each m3u8 URL, download and parse the playlist
   - Extract all .ts segment URLs
   - Use aria2's `addUri` method to submit all segments as a single task
   - Set appropriate options to ensure proper file merging (e.g., `continue=true`)
   - Handle file naming: use the m3u8 URL's basename or user-provided name
3. Add m3u8-specific options handling in the `buildEngineOptions` function
4. Ensure error handling and retry mechanisms apply to segment downloads

### 4. Aria2 Integration Enhancement
**修改文件**: `/src-tauri/src/commands/aria2.rs`

#### 中文步骤:
1. 考虑添加特殊的命令来处理 m3u8 任务（如果需要额外的aria2功能）
2. 确保现有的 `aria2_add_uri` 命令可以正确处理大量的分片 URL
3. 添加日志和监控以跟踪 m3u8 下载进度
4. 考虑实现进度报告：根据已下载的分片数量计算总进度

#### English Steps:
1. Consider adding special commands to handle m3u8 tasks (if extra aria2 functionality is needed)
2. Ensure the existing `aria2_add_uri` command can correctly handle large numbers of segment URLs
3. Add logging and monitoring to track m3u8 download progress
4. Consider implementing progress reporting: calculate overall progress based on downloaded segments

### 5. UI/UX Enhancements
**修改文件**: 
- `/src/components/task/AddTask.vue` (可能需要特殊指示)
- `/src/components/task/detail/TaskDetail*.vue` (显示下载进度)

#### 中文步骤:
1. 在任务详情视图中添加 m3u8 特殊标识
2. 显示分片下载进度（已下载分片/总分片）
3. 添加完成后自动合并的指示
4. 考虑添加取消单个分片下载的选项（虽然通常不推荐）
5. 在通知中显示 m3u8 下载完成信息

#### English Steps:
1. Add m3u8 special identification in task detail views
2. Show segment download progress (downloaded segments/total segments)
3. Add indication of automatic merging after completion
4. Consider adding option to cancel individual segment downloads (though not usually recommended)
5. Display m3u8 download completion information in notifications

### 6. Configuration and Settings
**修改文件**:
- `/src/shared/constants.ts` (添加默认值)
- `/src/stores/preference.ts` (如果需要用户可配置选项)

#### 中文步骤:
1. 添加 m3u8 下载相关的配置选项（如果需要）：
   - 最大同时分片下载数
   - 分片下载超时时间
   - 是否自动清理临时分片文件
   - 分片重试次数
2. 在常量文件中添加相关默认值
3. 确保这些设置能够正确地传递到底层下载逻辑

#### English Steps:
1. Add m3u8 download-related configuration options (if needed):
   - Maximum concurrent segment downloads
   - Segment download timeout
   - Whether to automatically clean up temporary segment files
   - Segment retry count
2. Add related default values in the constants file
3. Ensure these settings are correctly passed down to the underlying download logic

### 7. Testing and Verification
**创建/修改文件**:
- `/src/shared/utils/__tests__/batchHelpers.test.ts` (添加 m3u8 检测测试)
- `/src/stores/__tests__/app.test.ts` (添加外部输入处理测试)
- `/src/composables/__tests__/useAddTaskSubmit.test.ts` (添加提交测试)

#### 中文步骤:
1. 编写单元测试以验证 m3u8 URL 检测
2. 编写集成测试以验证 m3u8 处理流程
3. 创建端到端测试使用样本 m3u8 流
4. 验证生成的文件是正确合并的且可以播放
5. 测试各种边缘情况：
   - 无效的 m3u8 URL
   - 不可访问的分片
   - 直播流 vs 点播流
   - 加密的 HLS 流

#### English Steps:
1. Write unit tests to verify m3u8 URL detection
2. Write integration tests to verify the m3u8 processing flow
3. Create end-to-end tests using sample m3u8 streams
4. Verify that generated files are correctly merged and playable
5. Test various edge cases:
   - Invalid m3u8 URLs
   - Inaccessible segments
   - Live streams vs VOD streams
   - Encrypted HLS streams

## Technical Details

### M3U8 Parsing Logic
- 处理标签如 #EXTINF, #EXT-X-KEY, #EXT-X-MAP 等
- 支持相对路径解析
- 处理加密段落（如果实施）
- 支持变分辨率流（如果需要）

### Aria2 Integration Points
- 使用现有的 `addUri` 方法一次性提交所有分片
- 利用 aria2 的内置文件合并能力
- 设置合适的选项：`continue=true`, `auto-file-renaming=false` 等
- 考虑使用 aria2 的片段下载特性（如果可用）

### Error Handling and Recovery
- 单个分片失败的重试机制
- 部分下载的断点续传能力
- 下载完成后的验证（文件大小，可选的完整性检查）
- 清理临时文件的选项

## Files to Modify

1. `/src/shared/utils/batchHelpers.ts` - M3U8 detection
2. `/src/stores/app.ts` - External input processing for M3U8
3. `/src/composables/useAddTaskSubmit.ts` - Task submission logic for M3U8
4. `/src-tauri/src/commands/aria2.rs` - Optional Aria2 integration enhancements
5. UI components for displaying M3U8-specific information
6. Test files for verification

## Dependencies and Considerations

- No new external dependencies required (uses existing fetch/http capabilities)
- Leverages existing aria2 functionality for segment downloading and merging
- Should work with existing proxy, header, and authentication systems
- Need to consider memory usage for large playlists (many segments)
- Live streams may require different handling (continuous downloading vs fixed set)

## Estimated Complexity
- Medium complexity due to integration with existing systems
- Most changes are localized to specific functions
- Heavy reuse of existing patterns and code flows
- Primary challenge is robust M3U8 parsing and error handling