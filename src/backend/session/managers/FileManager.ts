/**
 * FileManager
 *
 * Manages files (folders/dates) - the single source of truth for the folder list.
 * Handles syncing with R2 dates and maintaining denormalized counts.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  getFiles,
  getOrCreateFile,
  updateFile,
  bulkCreateFiles,
  incrementNoteCount,
  updateFileTranscript,
  getAvailableDates,
  deleteFile as deleteFileFromDb,
  deleteDailyTranscript,
  deleteNotesByDate,
  deleteChatHistory,
  type FileI,
} from "../../models";
import { deleteFromR2 } from "../../services/r2Upload.service";
import { TimeManager } from "./TimeManager";

// =============================================================================
// Types
// =============================================================================

export interface FileData {
  id: string;
  date: string;
  noteCount: number;
  transcriptSegmentCount: number;
  hasTranscript: boolean;
  hasNotes: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  isFavourite: boolean;
  r2Key?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type FileFilter = "all" | "archived" | "trash" | "favourites";

export interface FileCounts {
  all: number;
  archived: number;
  trash: number;
  favourites: number;
}

// =============================================================================
// Manager
// =============================================================================

export class FileManager extends SyncedManager {
  @synced files = synced<FileData[]>([]);
  @synced isLoading = false;
  @synced activeFilter: FileFilter = "all";
  @synced counts: FileCounts = { all: 0, archived: 0, trash: 0, favourites: 0 };

  // Track if initial hydration has completed to avoid resetting filter on reconnects
  private _initialHydrationDone = false;

  // Lock to prevent concurrent hydrations/filter operations from racing
  private _operationInProgress: Promise<void> | null = null;

  // Track the last known "today" date to detect midnight rollover
  private _lastKnownToday: string | null = null;

  // TimeManager instance for timezone-aware date operations
  private _timeManager: TimeManager | null = null;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    // Skip if initial hydration is done - don't re-hydrate on reconnects
    // This prevents the glitchy behavior when clients connect/disconnect
    if (this._initialHydrationDone) {
      console.log(`[FileManager] Skipping hydration for ${userId} - already hydrated`);
      return;
    }

    // Wait for any in-progress operation to complete
    if (this._operationInProgress) {
      console.log(`[FileManager] Waiting for in-progress operation to complete...`);
      await this._operationInProgress;
      return; // Another hydration completed, we're done
    }

    this.isLoading = true;
    console.log(`[FileManager] Starting hydration for ${userId}`);

    try {
      // Step 1: Load existing File records from MongoDB
      const dbFiles = await getFiles(userId, {
        isTrashed: false,
        isArchived: false,
      });
      const existingDates = new Set(dbFiles.map((f) => f.date));
      console.log(`[FileManager] Found ${dbFiles.length} existing File records in MongoDB`);
      console.log(`[FileManager] Existing File dates:`, Array.from(existingDates));

      // Step 2: Get R2 available dates (for historical transcripts)
      const r2Manager = (this._session as any)?.r2;
      let r2Dates: string[] = [];
      if (r2Manager) {
        r2Dates = await r2Manager.loadR2AvailableDates();
        console.log(`[FileManager] R2 transcript dates (${r2Dates.length}):`, r2Dates);
      } else {
        console.log(`[FileManager] No R2 manager available`);
      }

      // Step 3: Get MongoDB transcript dates (DailyTranscript collection)
      let mongoDbDates: string[] = [];
      mongoDbDates = await getAvailableDates(userId);
      console.log(`[FileManager] MongoDB DailyTranscript dates (${mongoDbDates.length}):`, mongoDbDates);

      // Step 4: Always include today's date (so File record exists for current day)
      const today = this.today();
      console.log(`[FileManager] Today's date: ${today}`);

      // Step 4.5: Clean up future dates (e.g. "2026-02-16" when today is "2026-02-15")
      // These can appear from stale batch end-of-day calculations
      const futureMongoDates = mongoDbDates.filter((d) => d > today);
      if (futureMongoDates.length > 0) {
        console.log(`[FileManager] Cleaning up ${futureMongoDates.length} future dates:`, futureMongoDates);
        for (const date of futureMongoDates) {
          // Delete the DailyTranscript for this future date
          await deleteDailyTranscript(userId, date);
          // Delete the File record if it exists
          if (existingDates.has(date)) {
            await deleteFileFromDb(userId, date, true);
            existingDates.delete(date);
          }
          console.log(`[FileManager] Removed future date: ${date}`);
        }
        // Remove future dates from the list
        mongoDbDates = mongoDbDates.filter((d) => d <= today);
      }

      // Step 5: Find dates that need File records created
      const allDates = new Set([...r2Dates, ...mongoDbDates, today]);
      const missingDates = Array.from(allDates).filter(
        (d) => !existingDates.has(d),
      );
      console.log(`[FileManager] Combined unique dates: ${allDates.size}`);
      console.log(`[FileManager] Missing File records to create: ${missingDates.length}`, missingDates);

      // Step 5: Bulk create missing File records
      if (missingDates.length > 0) {
        console.log(`[FileManager] Creating ${missingDates.length} new File records...`);
        await bulkCreateFiles(userId, missingDates);

        // Mark R2 dates as having transcripts
        for (const date of missingDates) {
          if (r2Dates.includes(date)) {
            console.log(`[FileManager] Marking ${date} as R2 transcript`);
            await updateFileTranscript(userId, date, {
              r2Key: `transcripts/${userId}/${date}.json`,
            });
          } else if (mongoDbDates.includes(date)) {
            console.log(`[FileManager] Marking ${date} as MongoDB transcript`);
            await updateFileTranscript(userId, date, {});
          }
        }
      }

      // Step 6: Clean up orphaned File records (no transcript data and no notes)
      const orphanedDates = Array.from(existingDates).filter((d) => {
        // Keep if it has transcript data in R2 or MongoDB
        if (allDates.has(d)) return false;
        // Keep if it has notes
        const file = dbFiles.find((f) => f.date === d);
        if (file && file.noteCount > 0) return false;
        // Otherwise it's orphaned
        return true;
      });

      if (orphanedDates.length > 0) {
        console.log(`[FileManager] Cleaning up ${orphanedDates.length} orphaned File records:`, orphanedDates);
        for (const date of orphanedDates) {
          await deleteFileFromDb(userId, date, true);
        }
      }

      // Step 7: Reload files based on current filter
      // On initial hydration, use "all" filter
      // On subsequent hydrations (reconnects), preserve the current filter
      if (!this._initialHydrationDone) {
        this.activeFilter = "all";
        this._initialHydrationDone = true;
        // Initialize the last known today so midnight detection works
        this._lastKnownToday = today;
      }

      // Load files based on current activeFilter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      console.log(`[FileManager] ✓ Hydration complete: ${files.length} files for ${userId} (filter: ${this.activeFilter})`);
      console.log(`[FileManager] Final files:`, files.map(f => ({ date: f.date, hasTranscript: f.hasTranscript, r2Key: f.r2Key, noteCount: f.noteCount })));
    } catch (error) {
      console.error("[FileManager] Failed to hydrate:", error);
    } finally {
      this.isLoading = false;
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get TimeManager instance for timezone-aware date operations.
   * Uses user's timezone from settings if available.
   */
  private getTimeManager(): TimeManager {
    if (!this._timeManager) {
      const timezone = (this._session as any).appSession?.settings?.getMentraOS(
        "userTimezone",
      ) as string | undefined;
      this._timeManager = new TimeManager(timezone);
    }
    return this._timeManager;
  }

  private today(): string {
    return this.getTimeManager().today();
  }

  private toFileData(file: FileI): FileData {
    return {
      id: file._id?.toString() || file.date,
      date: file.date,
      noteCount: file.noteCount,
      transcriptSegmentCount: file.transcriptSegmentCount,
      hasTranscript: file.hasTranscript,
      hasNotes: file.hasNotes,
      isArchived: file.isArchived,
      isTrashed: file.isTrashed,
      isFavourite: file.isFavourite,
      r2Key: file.r2Key,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    };
  }

  /**
   * Refresh counts for all filter categories
   */
  private async refreshCounts(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    const [allFiles, archivedFiles, trashedFiles, favouriteFiles] = await Promise.all([
      getFiles(userId, { isArchived: false, isTrashed: false }),
      getFiles(userId, { isArchived: true, isTrashed: false }),
      getFiles(userId, { isTrashed: true }),
      getFiles(userId, { isFavourite: true, isTrashed: false }),
    ]);

    this.counts = {
      all: allFiles.length,
      archived: archivedFiles.length,
      trash: trashedFiles.length,
      favourites: favouriteFiles.length,
    };
  }

  /**
   * Ensure today's file exists in the database.
   * This handles midnight rollover - when the date changes, we need to create
   * a new File record for the new day.
   *
   * @returns true if a new file was created, false if it already existed
   */
  private async ensureTodayFileExists(): Promise<boolean> {
    const userId = this._session?.userId;
    if (!userId) return false;

    const today = this.today();

    // Check if date has changed since last check
    if (this._lastKnownToday === today) {
      return false; // No date change, nothing to do
    }

    console.log(`[FileManager] Date check - last known: ${this._lastKnownToday}, current: ${today}`);
    this._lastKnownToday = today;

    // Check if today's file already exists in our local state
    const existsLocally = this.files.some((f) => f.date === today);
    if (existsLocally) {
      return false;
    }

    // Create today's file in database if it doesn't exist
    console.log(`[FileManager] Creating file for new day: ${today}`);
    const file = await getOrCreateFile(userId, today);

    // Add to local state if we're viewing "all" filter
    if (this.activeFilter === "all") {
      const fileData = this.toFileData(file);
      this.files.mutate((files) => {
        // Check again to avoid duplicates
        if (!files.some((f) => f.date === today)) {
          files.unshift(fileData); // Add at the beginning (most recent)
        }
      });
    }

    // Update counts
    await this.refreshCounts();

    return true;
  }

  // ===========================================================================
  // Public Methods (called by other managers)
  // ===========================================================================

  /**
   * Called by NotesManager when a note is created
   */
  async onNoteCreated(noteDate: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    await incrementNoteCount(userId, noteDate, 1);

    // Update local state
    this.files.mutate((files) => {
      const idx = files.findIndex((f) => f.date === noteDate);
      if (idx >= 0) {
        files[idx].noteCount++;
        files[idx].hasNotes = true;
      } else {
        // File doesn't exist locally, refresh it
        this.refreshFile(noteDate);
      }
    });
  }

  /**
   * Called by NotesManager when a note is deleted
   */
  async onNoteDeleted(noteDate: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    await incrementNoteCount(userId, noteDate, -1);

    // Update local state
    this.files.mutate((files) => {
      const idx = files.findIndex((f) => f.date === noteDate);
      if (idx >= 0) {
        files[idx].noteCount = Math.max(0, files[idx].noteCount - 1);
        files[idx].hasNotes = files[idx].noteCount > 0;
      }
    });
  }

  /**
   * Called by TranscriptManager when transcript recording starts
   */
  async onTranscriptStarted(date: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    await getOrCreateFile(userId, date, { hasTranscript: true });

    // Update local state
    this.files.mutate((files) => {
      const idx = files.findIndex((f) => f.date === date);
      if (idx >= 0) {
        files[idx].hasTranscript = true;
      } else {
        this.refreshFile(date);
      }
    });
  }

  /**
   * Called by R2Manager after batch upload
   */
  async onTranscriptArchived(
    date: string,
    r2Key: string,
    segmentCount: number,
  ): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    await updateFileTranscript(userId, date, { r2Key, segmentCount });

    // Update local state
    this.files.mutate((files) => {
      const idx = files.findIndex((f) => f.date === date);
      if (idx >= 0) {
        files[idx].r2Key = r2Key;
        files[idx].transcriptSegmentCount = segmentCount;
        files[idx].hasTranscript = true;
      }
    });
  }

  /**
   * Refresh a single file from DB
   */
  private async refreshFile(date: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    const file = await getOrCreateFile(userId, date);
    const fileData = this.toFileData(file);

    this.files.mutate((files) => {
      const idx = files.findIndex((f) => f.date === date);
      if (idx >= 0) {
        files[idx] = fileData;
      } else {
        files.push(fileData);
        files.sort((a, b) => b.date.localeCompare(a.date));
      }
    });
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  /**
   * Force refresh files from database (useful after direct DB changes)
   */
  @rpc
  async refreshFiles(): Promise<FileData[]> {
    await this.hydrate();
    return [...this.files];
  }

  @rpc
  async getFilesRpc(filter?: FileFilter): Promise<FileData[]> {
    const userId = this._session?.userId;
    if (!userId) return [];

    // Ensure today's file exists (handles midnight rollover)
    // Only check when loading "all" filter to avoid unnecessary DB calls
    const effectiveFilter = filter || this.activeFilter;
    if (effectiveFilter === "all") {
      await this.ensureTodayFileExists();
    }

    const filterOptions: {
      isArchived?: boolean;
      isTrashed?: boolean;
      isFavourite?: boolean;
    } = {};

    switch (effectiveFilter) {
      case "archived":
        filterOptions.isArchived = true;
        filterOptions.isTrashed = false;
        break;
      case "trash":
        filterOptions.isTrashed = true;
        break;
      case "favourites":
        filterOptions.isFavourite = true;
        filterOptions.isTrashed = false;
        break;
      default: // "all"
        filterOptions.isArchived = false;
        filterOptions.isTrashed = false;
    }

    const files = await getFiles(userId, filterOptions);
    return files.map((f) => this.toFileData(f));
  }

  @rpc
  async setFilter(filter: FileFilter): Promise<FileData[]> {
    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      this.activeFilter = filter;
      const files = await this.getFilesRpc(filter);
      this.files.set(files);
      return files;
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async archiveFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      // Mutually exclusive: clear favourite and trash when archiving
      const file = await updateFile(userId, date, {
        isArchived: true,
        isFavourite: false,
        isTrashed: false,
      });
      if (!file) return null;

      console.log(`[FileManager] Archived file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async unarchiveFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      const file = await updateFile(userId, date, { isArchived: false });
      if (!file) return null;

      console.log(`[FileManager] Unarchived file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async trashFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      // Mutually exclusive: clear favourite and archive when trashing
      const file = await updateFile(userId, date, {
        isTrashed: true,
        isFavourite: false,
        isArchived: false,
      });
      if (!file) return null;

      console.log(`[FileManager] Trashed file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async restoreFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      const file = await updateFile(userId, date, { isTrashed: false });
      if (!file) return null;

      console.log(`[FileManager] Restored file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);
      console.log(`[FileManager] After restore - activeFilter: ${this.activeFilter}, files count: ${files.length}`);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async favouriteFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      // Mutually exclusive: clear archive and trash when favouriting
      const file = await updateFile(userId, date, {
        isFavourite: true,
        isArchived: false,
        isTrashed: false,
      });
      if (!file) return null;

      console.log(`[FileManager] Favourited file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async unfavouriteFile(date: string): Promise<FileData | null> {
    const userId = this._session?.userId;
    if (!userId) return null;

    // Wait for any in-progress operation to complete first
    if (this._operationInProgress) {
      await this._operationInProgress;
    }

    // Create a new operation promise
    let resolveOperation: () => void;
    this._operationInProgress = new Promise((resolve) => {
      resolveOperation = resolve;
    });

    try {
      const file = await updateFile(userId, date, { isFavourite: false });
      if (!file) return null;

      console.log(`[FileManager] Unfavourited file ${date}, refreshing list (filter: ${this.activeFilter})`);

      // Refresh the list based on current filter
      const files = await this.getFilesRpc(this.activeFilter);
      this.files.set(files);

      // Update counts
      await this.refreshCounts();

      return this.toFileData(file);
    } finally {
      resolveOperation!();
      this._operationInProgress = null;
    }
  }

  @rpc
  async permanentlyDeleteFile(date: string): Promise<boolean> {
    const userId = this._session?.userId;
    if (!userId) return false;

    const success = await deleteFileFromDb(userId, date, true);

    if (success) {
      this.files.set(this.files.filter((f) => f.date !== date));
    }

    return success;
  }

  /**
   * Fully purge a date - deletes both DailyTranscript AND File records
   * Use this when you want to completely remove a date from the system
   * Note: This does NOT delete from R2 (cloud storage)
   */
  @rpc
  async purgeDate(date: string): Promise<{ deletedTranscript: boolean; deletedFile: boolean }> {
    const userId = this._session?.userId;
    if (!userId) {
      return { deletedTranscript: false, deletedFile: false };
    }

    console.log(`[FileManager] Purging date ${date} for user ${userId}`);

    // Delete DailyTranscript record
    const deletedTranscript = await deleteDailyTranscript(userId, date);
    console.log(`[FileManager] DailyTranscript deleted: ${deletedTranscript}`);

    // Delete File record
    const deletedFile = await deleteFileFromDb(userId, date, true);
    console.log(`[FileManager] File deleted: ${deletedFile}`);

    // Update local state
    if (deletedFile) {
      this.files.set(this.files.filter((f) => f.date !== date));
    }

    return { deletedTranscript, deletedFile };
  }

  /**
   * Empty trash - permanently delete all trashed files
   * Deletes: File records, DailyTranscript, Notes, Chat history, and R2 transcripts
   */
  @rpc
  async emptyTrash(): Promise<{
    deletedCount: number;
    errors: string[];
  }> {
    const userId = this._session?.userId;
    if (!userId) {
      return { deletedCount: 0, errors: ["No user session"] };
    }

    console.log(`[FileManager] Emptying trash for user ${userId}`);

    // Get all trashed files
    const trashedFiles = await getFiles(userId, { isTrashed: true });
    console.log(`[FileManager] Found ${trashedFiles.length} trashed files to delete`);

    const errors: string[] = [];
    let deletedCount = 0;

    for (const file of trashedFiles) {
      const date = file.date;
      console.log(`[FileManager] Deleting all data for ${date}...`);

      try {
        // 1. Delete from R2 (if exists)
        if (file.r2Key) {
          const r2Result = await deleteFromR2({ userId, date });
          if (!r2Result.success) {
            console.warn(`[FileManager] Failed to delete R2 for ${date}:`, r2Result.error);
            // Continue anyway - R2 deletion is not critical
          }
        }

        // 2. Delete notes for this date
        const deletedNotes = await deleteNotesByDate(userId, date);
        console.log(`[FileManager] Deleted ${deletedNotes} notes for ${date}`);

        // 3. Delete chat history for this date
        await deleteChatHistory(userId, date);
        console.log(`[FileManager] Deleted chat history for ${date}`);

        // 4. Delete DailyTranscript
        await deleteDailyTranscript(userId, date);
        console.log(`[FileManager] Deleted DailyTranscript for ${date}`);

        // 5. Delete File record
        await deleteFileFromDb(userId, date, true);
        console.log(`[FileManager] Deleted File record for ${date}`);

        deletedCount++;
      } catch (error) {
        const errorMsg = `Failed to delete ${date}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`[FileManager] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    // Clear local files state (we're viewing trash, so it should be empty now)
    if (this.activeFilter === "trash") {
      this.files.set([]);
    }

    // Update counts
    await this.refreshCounts();

    console.log(`[FileManager] Empty trash complete: ${deletedCount} deleted, ${errors.length} errors`);
    return { deletedCount, errors };
  }
}
