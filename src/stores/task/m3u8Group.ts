import { defineStore } from 'pinia'
import type { M3u8Group, SegmentStatus } from '@/shared/types'

export const useM3u8GroupStore = defineStore('m3u8Group', {
  state: () => ({
    /** Map of groupId → M3u8Group */
    groups: {} as Record<string, M3u8Group>,
  }),
  getters: {
    /** Return a group by its ID, or undefined if not found. */
    getGroup: (state) => (groupId: string) => state.groups[groupId],
    /** Number of groups in each status. */
    countByStatus: (state) => {
      const counts: Record<M3u8Group['status'], number> = {
        downloading: 0,
        merging: 0,
        completed: 0,
        failed: 0,
        partial: 0,
      }
      for (const group of Object.values(state.groups)) {
        counts[group.status]++
      }
      return counts
    },
  },
  actions: {
    /**
     * Create a new m3u8 group.
     * @param videoName Base name for the final output (without extension).
     * @param finalPath Absolute path where the merged MP4 will be written.
     * @param tempDir Absolute path to the temporary directory for segments.
     * @param ffmpegPath Configured ffmpeg executable path.
     * @param segmentUrls Array of absolute URLs for the .ts segments.
     * @returns The created group's ID.
     */
    createGroup({
      videoName,
      finalPath,
      tempDir,
      ffmpegPath,
      segmentUrls,
    }: {
      videoName: string
      finalPath: string
      tempDir: string
      ffmpegPath: string
      segmentUrls: string[]
    }): string {
      const groupId = Array.from(window.crypto.getRandomValues(new Uint8Array(8)), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      const segmentGids: string[] = new Array(segmentUrls.length).fill('') // placeholder, will be filled by registerSegments
      const segments: SegmentStatus[] = segmentUrls.map((url, idx) => ({
        index: idx,
        url,
        aria2Gid: '',
        filePath: '', // will be set when we know the segment's local path
        status: 'pending',
        bytesDownloaded: 0,
        totalBytes: 0,
        retryCount: 0,
      }))
      this.groups[groupId] = {
        groupId,
        videoName,
        finalPath,
        tempDir,
        segmentGids,
        ffmpegPath,
        status: 'downloading',
        segments,
      }
      return groupId
    },
    /**
     * Register an aria2 GID for a specific segment index.
     * Called after each aria2.addUri succeeds.
     */
    registerSegment(groupId: string, segmentIndex: number, aria2Gid: string, segmentFilePath: string) {
      const group = this.groups[groupId]
      if (!group) return
      group.segmentGids[segmentIndex] = aria2Gid
      const seg = group.segments[segmentIndex]
      if (seg) {
        seg.aria2Gid = aria2Gid
        seg.filePath = segmentFilePath
        seg.status = 'downloading'
        // Preserve existing retryCount
      }
    },
    /**
     * Update the status of a segment (called from aria2 task monitor events).
     */
    updateSegmentStatus(
      groupId: string,
      aria2Gid: string,
      status: SegmentStatus['status'],
      bytesDownloaded: number,
      totalBytes: number,
      errorCode?: number,
    ) {
      const group = this.groups[groupId]
      if (!group) return
      // Find segment by aria2Gid
      const segIdx = group.segmentGids.indexOf(aria2Gid)
      if (segIdx === -1) return
      const seg = group.segments[segIdx]
      if (!seg) return
      seg.status = status
      seg.bytesDownloaded = bytesDownloaded
      seg.totalBytes = totalBytes
      if (errorCode !== undefined) seg.errorCode = errorCode
      // Preserve existing retryCount
      // If any segment failed, we could set group status to failed immediately,
      // but we wait for all segments to finish (some may still be downloading).
      // The group status will be determined in allSegmentsCompleted.
    },
    /**
     * Called when the user wants to retry a specific failed segment.
     * This will trigger a new aria2.addUri call for that segment only.
     * The frontend should call this action to get a fresh aria2 GID,
     * then invoke aria2.addUri again.
     */
    retrySegment(
      groupId: string,
      segmentIndex: number,
    ): { url: string; aria2Gid: string; filePath: string; canRetry: boolean; retryCount: number } | null {
      const group = this.groups[groupId]
      if (!group) return null
      const seg = group.segments[segmentIndex]
      if (!seg) return null
      // Increment retry count
      seg.retryCount += 1
      // Check if we've exceeded max retries (5)
      const canRetry = seg.retryCount <= 5
      // Reset segment to pending so the frontend knows to re-submit.
      // Actual status update will happen when frontend calls registerSegment after addUri
      seg.status = 'pending'
      seg.bytesDownloaded = 0
      seg.totalBytes = 0
      seg.errorCode = undefined
      // Note: we do NOT change aria2Gid here; the frontend will generate a new one.
      // The frontend should call this, then wait F=3秒 delay, then call aria2.addUri,
      // then call registerSegment with the new GID.
      return {
        url: seg.url,
        aria2Gid: seg.aria2Gid, // current GID (may be empty or old)
        filePath: seg.filePath,
        canRetry, // true if retry attempts remain
        retryCount: seg.retryCount,
      }
    },
    /**
     * Returns true if all segments have reached a terminal state (completed or failed).
     */
    allSegmentsTerminal(groupId: string): boolean {
      const group = this.groups[groupId]
      if (!group) return false
      return group.segments.every((s) => s.status === 'completed' || s.status === 'failed')
    },
    /**
     * Returns true if all segments are completed (none failed).
     */
    allSegmentsCompleted(groupId: string): boolean {
      const group = this.groups[groupId]
      if (!group) return false
      return group.segments.every((s) => s.status === 'completed')
    },
    /**
     * Returns true if any segment failed.
     */
    hasAnyFailed(groupId: string): boolean {
      const group = this.groups[groupId]
      if (!group) return false
      return group.segments.some((s) => s.status === 'failed')
    },
    /**
     * Called when all segments have finished downloading.
     * Sets group status to 'merging' (frontend will call merge_m3u8_segments).
     */
    setMerging(groupId: string) {
      const group = this.groups[groupId]
      if (!group) return
      group.status = 'merging'
    },
    /**
     * Called after merge_m3u8_segments succeeds.
     */
    setCompleted(groupId: string) {
      const group = this.groups[groupId]
      if (!group) return
      group.status = 'completed'
    },
    /**
     * Called when merge_m3u8_segments fails.
     * The group status becomes 'failed' but we keep the temp dir for user retry.
     */
    setFailed(groupId: string) {
      const group = this.groups[groupId]
      if (!group) return
      group.status = 'failed'
    },
    /**
     * Called when some segments failed but the user wants to proceed with a partial merge
     * (skip missing segments). This is optional; we expose it for the UI.
     */
    setPartial(groupId: string) {
      const group = this.groups[groupId]
      if (!group) return
      group.status = 'partial'
    },
    /**
     * Generic status setter used by the submit composable.
     * Delegates to the type-safe individual methods.
     */
    setGroupStatus(groupId: string, status: M3u8Group['status']) {
      const group = this.groups[groupId]
      if (!group) return
      group.status = status
    },
    /**
     * Remove a group from the store (called when the task is removed from the UI).
     */
    removeGroup(groupId: string) {
      delete this.groups[groupId]
    },
  },
})
