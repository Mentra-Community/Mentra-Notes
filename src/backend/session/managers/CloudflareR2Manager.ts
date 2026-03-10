/**
 * CloudflareR2Manager
 *
 * Manages R2 cloud storage uploads, batch scheduling, and transcript fetching.
 * Owns the complete archive pipeline: scheduling, upload, and cleanup.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  batchTranscriptsToR2,
  deleteProcessedSegments,
  type TranscriptBatchResult,
} from "../../services/r2Batch.service";
import {
  fetchTranscriptFromR2,
  listR2TranscriptDates,
} from "../../services/r2Fetch.service";
import type { R2BatchData } from "../../services/r2Upload.service";
import {
  getUserState,
  createUserState,
  updateTranscriptionBatchEndOfDay,
} from "../../services/userState.service";
import { TimeManager } from "./TimeManager";
import type { FileManager } from "./FileManager";

// =============================================================================
// Types
// =============================================================================

export type BatchStatus = "none" | "in_progress" | "success" | "failed";

export interface BatchInfo {
  date: string;
  status: BatchStatus;
  segmentCount: number;
  r2Url?: string;
  error?: string;
  timestamp: string;
}

// =============================================================================
// Manager
// =============================================================================

export class CloudflareR2Manager extends SyncedManager {
  @synced isBatching = false;
  @synced lastBatchDate = "";
  @synced lastBatchStatus: BatchStatus = "none";
  @synced lastBatchSegmentCount = 0;
  @synced lastBatchUrl = "";
  @synced lastBatchError = "";
  @synced r2AvailableDates: string[] = [];

  // Batch scheduling state (moved from TranscriptManager)
  private transcriptionBatchEndOfDay: Date | null = null;
  private userStateInitialized = false;
  private timeManager: TimeManager | null = null;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const defaultEndOfDay = new Date(this.getTimeManager().endOfDay());
      console.log(
        `[R2Manager] Ensuring UserState exists for ${userId}, default EOD: ${defaultEndOfDay.toISOString()}`,
      );
      const timezone = this.getTimeManager().getTimezone();
      const userState = await createUserState(userId, defaultEndOfDay, timezone === "UTC" ? undefined : timezone);

      this.transcriptionBatchEndOfDay = userState.transcriptionBatchEndOfDay;
      this.userStateInitialized = true;
      console.log(
        `[R2Manager] Loaded batch end of day from DB: ${this.transcriptionBatchEndOfDay}`,
      );

      // Catch up on any missed batches (e.g. old transcripts from previous days)
      await this.checkAndRunBatch();
    } catch (error) {
      console.error("[R2Manager] Failed to hydrate batch scheduling:", error);
    }
  }

  // ===========================================================================
  // Batch Scheduling (moved from TranscriptManager)
  // ===========================================================================

  /**
   * Check if batch cutoff passed; if so, upload to R2 and update UserState.
   * Called on every final transcript segment and during hydrate.
   */
  async checkAndRunBatch(): Promise<void> {
    const passed = await this.isBatchDue();
    if (passed) {
      const userId = this._session?.userId;
      if (!userId) return;

      const timeManager = this.getTimeManager();
      const timezone = timeManager.getTimezone();

      const cutoffTimestamp = this.transcriptionBatchEndOfDay;
      if (!cutoffTimestamp) {
        console.error(`[R2Manager] No cutoff timestamp available`);
        return;
      }

      const cutoffISO = cutoffTimestamp.toISOString();
      console.log(
        `[R2Manager] Batch cutoff crossed, uploading transcripts up to ${cutoffISO}`,
      );

      const batchResult = await this.triggerBatch(
        userId,
        cutoffISO,
        timezone,
      );

      if (batchResult.success) {
        const deletedCount = await this.cleanupProcessedSegments(
          cutoffISO,
          timezone,
        );
        console.log(
          `[R2Manager] Cleaned up ${deletedCount} segments from MongoDB`,
        );

        const newEndOfDay = new Date(this.getTimeManager().endOfDay());
        await updateTranscriptionBatchEndOfDay(userId, newEndOfDay);
        console.log(
          `[R2Manager] R2 batch successful, updated cutoff: ${newEndOfDay}`,
        );
      } else {
        console.error(
          `[R2Manager] R2 batch failed, keeping old cutoff for retry:`,
          batchResult.error,
        );
      }
    }
  }

  /**
   * Check if current UTC time has passed the batch end-of-day.
   * Fetches fresh from MongoDB every time.
   */
  async isBatchDue(): Promise<boolean> {
    const userId = this._session?.userId;
    if (!userId) {
      console.log("[R2Manager] isBatchDue: No userId available");
      return false;
    }

    const userState = await getUserState(userId);
    if (!userState?.transcriptionBatchEndOfDay) {
      console.log("[R2Manager] isBatchDue: Batch date not set in DB");
      return false;
    }

    const batchEndOfDay = userState.transcriptionBatchEndOfDay;
    this.transcriptionBatchEndOfDay = batchEndOfDay;

    const timeManager = this.getTimeManager();
    const currentUTC = timeManager.now();
    console.log(
      `[R2Manager] isBatchDue: Current UTC: ${currentUTC} | Batch End: ${batchEndOfDay.toISOString()}`,
    );

    if (currentUTC > batchEndOfDay.toISOString()) {
      console.log(
        "[R2Manager] isBatchDue: PASSED - Current UTC time has passed batch end of day",
      );
      return true;
    } else {
      console.log(
        "[R2Manager] isBatchDue: NOT PASSED - Current UTC time has NOT passed batch end of day",
      );
      return false;
    }
  }

  // ===========================================================================
  // Batch Trigger
  // ===========================================================================

  /**
   * Trigger R2 batch upload for transcripts up to the cutoff timestamp
   * Called by TranscriptManager when batch cutoff is crossed
   *
   * @param userId - User's ID
   * @param cutoffTimestamp - Timestamp to batch up to (ISO string, e.g. 2026-02-05T16:54:59.000Z)
   * @param timezone - User's timezone for metadata
   * @returns Batch result
   */
  async triggerBatch(
    userId: string,
    cutoffTimestamp: string,
    timezone: string,
  ): Promise<TranscriptBatchResult> {
    if (this.isBatching) {
      console.log(`[R2Manager] Batch already in progress, skipping`);
      return {
        success: false,
        date: cutoffTimestamp,
        segmentCount: 0,
        batchedDates: [],
        segmentsByDate: {},
        error: new Error("Batch already in progress"),
      };
    }

    console.log(
      `[R2Manager] Triggering batch for ${userId} up to ${cutoffTimestamp}`,
    );

    this.isBatching = true;
    this.lastBatchStatus = "in_progress";
    this.lastBatchError = "";

    try {
      const result = await batchTranscriptsToR2({
        userId,
        cutoffTimestamp,
        timezone,
      });

      this.isBatching = false;
      this.lastBatchDate = cutoffTimestamp;
      this.lastBatchSegmentCount = result.segmentCount;

      if (result.success) {
        this.lastBatchStatus = "success";
        this.lastBatchUrl = result.r2Url || "";
        console.log(
          `[R2Manager] Batch successful: ${result.segmentCount} segments uploaded across ${result.batchedDates.length} dates`,
        );

        // Notify FileManager about each archived transcript date
        const fileManager = this.getFileManager();
        if (fileManager && result.batchedDates.length > 0) {
          for (const date of result.batchedDates) {
            const r2Key = `transcripts/${userId}/${date}.json`;
            const segmentCount = result.segmentsByDate[date] || 0;
            console.log(`[R2Manager] Notifying FileManager about ${date} (${segmentCount} segments)`);
            await fileManager.onTranscriptArchived(date, r2Key, segmentCount);
          }
        }
      } else {
        this.lastBatchStatus = "failed";
        this.lastBatchError = result.error?.message || "Unknown error";
        console.error(`[R2Manager] Batch failed:`, result.error);
      }

      return result;
    } catch (error) {
      this.isBatching = false;
      this.lastBatchStatus = "failed";
      this.lastBatchError =
        error instanceof Error ? error.message : String(error);

      console.error(`[R2Manager] Batch error:`, error);

      return {
        success: false,
        date: cutoffTimestamp,
        segmentCount: 0,
        batchedDates: [],
        segmentsByDate: {},
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  // ===========================================================================
  // RPC Methods (callable from frontend)
  // ===========================================================================

  /**
   * Manually trigger a batch upload (admin/debug feature)
   */
  @rpc
  async forceBatch(cutoffDate?: string): Promise<BatchInfo> {
    const userId = this._session?.userId;
    if (!userId) {
      return {
        date: cutoffDate || "",
        status: "failed",
        segmentCount: 0,
        error: "No user session",
        timestamp: new Date().toISOString(),
      };
    }

    // Get timezone from settings manager
    const settingsManager = this.getSettingsManager();
    const timezone = settingsManager?.timezone || "UTC";

    // Get TimeManager for date if not provided
    const timeManager = this.getTimeManager();
    const batchDate = cutoffDate || timeManager.today();

    const result = await this.triggerBatch(userId, batchDate, timezone);

    return {
      date: batchDate,
      status: result.success ? "success" : "failed",
      segmentCount: result.segmentCount,
      r2Url: result.r2Url,
      error: result.error?.message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get current batch status
   */
  @rpc
  async getBatchStatus(): Promise<BatchInfo> {
    return {
      date: this.lastBatchDate,
      status: this.lastBatchStatus,
      segmentCount: this.lastBatchSegmentCount,
      r2Url: this.lastBatchUrl || undefined,
      error: this.lastBatchError || undefined,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Delete processed segments from MongoDB after confirming R2 upload
   * This is a separate step to allow verification before deletion
   */
  @rpc
  async cleanupProcessedSegments(cutoffTimestamp: string, timezone?: string): Promise<number> {
    const userId = this._session?.userId;
    if (!userId) {
      console.error(`[R2Manager] No user session for cleanup`);
      return 0;
    }

    // Pass timezone through - r2Batch.service will use system default if undefined
    const tz = timezone || this.getSettingsManager()?.timezone || undefined;

    return deleteProcessedSegments({ userId, cutoffTimestamp, timezone: tz });
  }

  // ===========================================================================
  // R2 Fetch Methods
  // ===========================================================================

  /**
   * Fetch transcript data from R2 for a specific date
   * Returns the R2BatchData if found, null otherwise
   */
  async fetchTranscript(date: string): Promise<R2BatchData | null> {
    const userId = this._session?.userId;
    if (!userId) {
      console.error(`[R2Manager] No user session for fetch`);
      return null;
    }

    console.log(`[R2Manager] fetchTranscript(${date}) for user ${userId}`);
    const result = await fetchTranscriptFromR2({ userId, date });

    if (result.success && result.data) {
      console.log(`[R2Manager] ✓ Found R2 transcript for ${date}: ${result.data.segments?.length || 0} segments`);
      return result.data;
    } else {
      console.log(`[R2Manager] ✗ No R2 transcript found for ${date}`, result.error || '');
      return null;
    }
  }

  /**
   * Get list of dates that have transcripts in R2
   * Called during hydrate to populate folder list
   */
  async loadR2AvailableDates(): Promise<string[]> {
    const userId = this._session?.userId;
    if (!userId) {
      console.log(`[R2Manager] loadR2AvailableDates: No userId`);
      return [];
    }

    console.log(`[R2Manager] Loading available R2 dates for ${userId}...`);
    const result = await listR2TranscriptDates(userId);
    if (result.success) {
      console.log(`[R2Manager] ✓ Found ${result.dates.length} R2 dates:`, result.dates);
      this.r2AvailableDates = result.dates;
      return result.dates;
    }
    console.log(`[R2Manager] ✗ Failed to list R2 dates:`, result.error || 'unknown error');
    return [];
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  private getSettingsManager(): { timezone: string | null } | null {
    const session = this._session as any;
    return session?.settings || null;
  }

  private getTimeManager(): TimeManager {
    const settingsTimezone = (this._session as any)?.settings?.timezone as string | null;
    const appTimezone = (this._session as any).appSession?.settings?.getMentraOS(
      "userTimezone",
    ) as string | undefined;
    const currentTimezone = appTimezone || settingsTimezone || undefined;

    if (!this.timeManager || (this as any)._lastTimezone !== currentTimezone) {
      this.timeManager = new TimeManager(currentTimezone);
      (this as any)._lastTimezone = currentTimezone;
    }
    return this.timeManager;
  }

  private getFileManager(): FileManager | null {
    return (this._session as any)?.file || null;
  }
}
