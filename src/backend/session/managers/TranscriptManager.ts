/**
 * TranscriptManager
 *
 * Manages transcript segments, interim text, loading, and persisting.
 * Handles both real-time transcription and historical transcript loading.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  getOrCreateDailyTranscript,
  getAvailableDates,
  appendTranscriptSegments,
  bulkUpsertSearchSegments,
  type TranscriptSegmentI,
  type UpsertSegmentInput,
} from "../../models";
import type { R2TranscriptSegment } from "../../services/r2Upload.service";
import { TimeManager } from "./TimeManager";
import type { FileManager } from "./FileManager";
import type { SummaryManager } from "./SummaryManager";

// =============================================================================
// Types
// =============================================================================

export interface TranscriptSegment {
  id: string;
  text: string;
  timestamp: Date;
  isFinal: boolean;
  speakerId?: string;
  type?: "transcript" | "photo";
  photoUrl?: string;
  photoMimeType?: string;
  photoDescription?: string;
  timezone?: string;
}

export interface HourSummary {
  id: string;
  date: string;
  hour: number;
  hourLabel: string;
  summary: string;
  segmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const INTERIM_WORD_THRESHOLD = 50;

// =============================================================================
// Manager
// =============================================================================

export class TranscriptManager extends SyncedManager {
  @synced segments = synced<TranscriptSegment[]>([]);
  @synced interimText = "";
  @synced isRecording = false;
  @synced loadedDate = "";
  @synced availableDates = synced<string[]>([]);
  @synced isLoadingHistory = false;
  @synced isSyncingPhoto = false;
  @synced isHydrated = false;

  private segmentIndex = 0;
  private pendingSegments: TranscriptSegmentI[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private timeManager: TimeManager | null = null;
  private _forceFinalizedWordCount = 0;
  private _pendingForceFinalize = false; // true = threshold hit, waiting for next word to complete
  private _pendingForceFinalizeSnapshot = 0; // word count when threshold was hit
  private _onForceFinalize: ((text: string) => void) | null = null;

  /**
   * Register a callback for when interim text is force-finalized.
   * Used by NotesSession to feed force-finalized text into ChunkBuffer.
   */
  onForceFinalize(cb: (text: string) => void): void {
    this._onForceFinalize = cb;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getSummaryManager(): SummaryManager | null {
    return (this._session as any)?.summary || null;
  }

  private getTimeManager(): TimeManager {
    // Always resolve the latest timezone — it may change when glasses connect
    const settingsTimezone = (this._session as any)?.settings?.timezone as string | null;
    const appTimezone = (this._session as any).appSession?.settings?.getMentraOS(
      "userTimezone",
    ) as string | undefined;
    const currentTimezone = appTimezone || settingsTimezone || undefined;

    // Recreate TimeManager if timezone changed (e.g. glasses connected after hydration)
    if (!this.timeManager || (this as any)._lastTimezone !== currentTimezone) {
      this.timeManager = new TimeManager(currentTimezone);
      (this as any)._lastTimezone = currentTimezone;
    }
    return this.timeManager;
  }

  private getFileManager(): FileManager | null {
    return (this._session as any)?.file || null;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    // Reset the hydrated flag so clients show a loading state during re-hydrate
    // (e.g. when navigating back to today from a historical date).
    this.isHydrated = false;

    try {
      const today = this.getTimeManager().today();

      // Clear stale segments BEFORE async fetch so clients never see
      // yesterday's data with today's loadedDate
      if (this.loadedDate !== today) {
        this.segments.set([]);
      }
      this.loadedDate = today;

      // Load available dates from MongoDB
      const mongoDbDates = await getAvailableDates(userId);
      console.log(
        `[TranscriptManager] MongoDB dates for ${userId}:`,
        mongoDbDates,
      );

      // Load available dates from R2 via R2Manager
      const r2Manager = (this._session as any)?.r2;
      let r2Dates: string[] = [];
      if (r2Manager) {
        r2Dates = await r2Manager.loadR2AvailableDates();
        console.log(`[TranscriptManager] R2 dates:`, r2Dates);
      } else {
        console.log(`[TranscriptManager] No R2 manager available`);
      }

      // Merge and dedupe dates, always include today, sort descending
      const allDates = Array.from(new Set([today, ...mongoDbDates, ...r2Dates]));
      allDates.sort((a, b) => b.localeCompare(a));

      // Filter out trashed dates (check FileManager)
      const fileManager = (this._session as any)?.file;
      let visibleDates = allDates;
      if (fileManager) {
        try {
          const { getFiles } = await import("../../models/file.model");
          const trashedFiles = await getFiles(userId, { isTrashed: true });
          const trashedDateSet = new Set(trashedFiles.map((f: any) => f.date));
          visibleDates = allDates.filter((d) => !trashedDateSet.has(d));
        } catch {
          // If query fails, show all dates
        }
      }

      console.log(`[TranscriptManager] All available dates:`, visibleDates);
      this.availableDates.set(visibleDates);

      console.log(
        `[TranscriptManager] ========================================`,
      );
      console.log(
        `[TranscriptManager] FETCHING transcripts from MongoDB (TODAY)`,
      );
      console.log(`[TranscriptManager] Date: ${today}`);
      console.log(
        `[TranscriptManager] ========================================`,
      );

      const transcript = await getOrCreateDailyTranscript(userId, today);

      if (transcript.segments && transcript.segments.length > 0) {
        const loadedSegments: TranscriptSegment[] = transcript.segments.map(
          (seg, idx) => ({
            id: `seg_${idx + 1}`,
            text: seg.text,
            timestamp: seg.timestamp,
            isFinal: seg.isFinal,
            speakerId: seg.speakerId,
            type: seg.type,
            photoUrl: seg.photoUrl,
            photoMimeType: seg.photoMimeType,
            timezone: seg.timezone,
          }),
        );

        this.segments.set(loadedSegments);
        this.segmentIndex = loadedSegments.length;

        console.log(
          `[TranscriptManager] ✓ MongoDB fetch successful: ${loadedSegments.length} segments for ${today}`,
        );
      } else {
        console.log(
          `[TranscriptManager] ✓ MongoDB fetch successful: 0 segments for ${today}`,
        );
      }

    } catch (error) {
      console.error("[TranscriptManager] Failed to hydrate:", error);
    } finally {
      this.isHydrated = true;
    }
  }

  async persist(): Promise<void> {
    if (this.pendingSegments.length === 0) return;

    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const timeManager = this.getTimeManager();
      const toSave = [...this.pendingSegments];
      this.pendingSegments = [];

      // Group segments by their actual date (from timestamp) so segments
      // created before midnight don't get saved under the next day's date
      const segmentsByDate = new Map<string, TranscriptSegmentI[]>();
      for (const segment of toSave) {
        const segDate = segment.timestamp
          ? timeManager.toDateString(new Date(segment.timestamp))
          : timeManager.today();
        if (!segmentsByDate.has(segDate)) {
          segmentsByDate.set(segDate, []);
        }
        segmentsByDate.get(segDate)!.push(segment);
      }

      for (const [date, segments] of segmentsByDate) {
        await appendTranscriptSegments(userId, date, segments);
        console.log(
          `[TranscriptManager] Persisted ${segments.length} segments for ${userId} on ${date}`,
        );

        // Mirror final text-only segments into the phrase-search collection.
        // Skip photo segments entirely (decision locked in issue #26).
        const searchInputs: UpsertSegmentInput[] = segments
          .filter((s) => s.type !== "photo" && s.isFinal && s.text?.trim())
          .map((s) => {
            const ts = s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp);
            return {
              userId,
              date,
              hour: this.getHourInTimezone(ts, timeManager.getTimezone()),
              segIndex: s.index,
              text: s.text,
              timestamp: ts,
              speakerId: s.speakerId,
            };
          });
        if (searchInputs.length > 0) {
          try {
            await bulkUpsertSearchSegments(searchInputs);
          } catch (err) {
            console.error(
              `[TranscriptManager] Failed to mirror ${searchInputs.length} segments to search index:`,
              err,
            );
          }
        }
      }
    } catch (error) {
      console.error("[TranscriptManager] Failed to persist:", error);
    }
  }

  /**
   * Hour (0-23) in the user's timezone. Mirrors TranscriptTab's grouping so
   * segIndex → hour stays consistent between the DB, the search results,
   * and the rendered transcript page.
   */
  private getHourInTimezone(timestamp: Date, timezone: string | undefined): number {
    if (timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }).formatToParts(timestamp);
      return parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    }
    return timestamp.getHours();
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.pendingSegments = [];
    this._onForceFinalize = null;
    this.timeManager = null;
  }

  // ===========================================================================
  // Segment Management
  // ===========================================================================

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      await this.persist();
    }, 30000);
  }

  addSegment(text: string, isFinal: boolean, speakerId?: string): void {
    if (!text.trim()) return;

    const wasRecording = this.isRecording;
    this.isRecording = true;

    let isForceFinalize = false;

    if (!isFinal) {
      // Strip already-finalized words from the interim
      const interimWords = text.trim().split(/\s+/);

      // If the speech engine reset its buffer (fewer words than we've finalized),
      // it likely emitted a final we missed — reset and treat this as fresh
      if (this._forceFinalizedWordCount > 0 && interimWords.length < this._forceFinalizedWordCount) {
        console.log(`[TranscriptManager] Speech engine reset detected (got ${interimWords.length} words, expected >${this._forceFinalizedWordCount}). Resetting force-finalize state.`);
        this._forceFinalizedWordCount = 0;
        this._pendingForceFinalize = false;
        this._pendingForceFinalizeSnapshot = 0;
      }

      const cleanWords = interimWords.slice(this._forceFinalizedWordCount);
      const cleanInterim = cleanWords.join(" ");

      if (this._pendingForceFinalize) {
        // Threshold was hit on a previous interim — wait for the last word to complete
        // Once the word count grows (speech engine moved to next word), finalize
        if (interimWords.length > this._pendingForceFinalizeSnapshot) {
          // The last word from the snapshot is now complete — finalize up to it
          const finalizeWords = interimWords.slice(this._forceFinalizedWordCount, this._pendingForceFinalizeSnapshot);
          const finalizeText = finalizeWords.join(" ");
          console.log(`[TranscriptManager] Force-finalizing interim (${finalizeWords.length} words)`);
          this._forceFinalizedWordCount = this._pendingForceFinalizeSnapshot;
          this._pendingForceFinalize = false;
          this._pendingForceFinalizeSnapshot = 0;
          text = finalizeText;
          isForceFinalize = true;
          // Show remaining words as interim so UI doesn't flash empty
          this.interimText = interimWords.slice(this._forceFinalizedWordCount).join(" ");
        } else {
          // Still on the same last word — keep waiting
          this.interimText = cleanInterim;
          return;
        }
      } else if (cleanWords.length >= INTERIM_WORD_THRESHOLD) {
        // Threshold hit — mark pending and wait for next word to confirm last word is complete
        this._pendingForceFinalize = true;
        this._pendingForceFinalizeSnapshot = interimWords.length;
        this.interimText = cleanInterim;
        return;
      } else {
        this.interimText = cleanInterim;
        return;
      }
    } else {
      // Real final from speech engine — strip already-finalized words
      if (this._forceFinalizedWordCount > 0) {
        const finalWords = text.trim().split(/\s+/);
        text = finalWords.slice(this._forceFinalizedWordCount).join(" ");
      }
      this._forceFinalizedWordCount = 0;
      this._pendingForceFinalize = false;
      this._pendingForceFinalizeSnapshot = 0;

      // If all words were already force-finalized, nothing left to save
      if (!text.trim()) {
        this.interimText = "";
        return;
      }
    }

    // Only clear interimText for real finals — force-finalize already set it to remaining words
    if (!isForceFinalize) {
      this.interimText = "";
    }
    this.segmentIndex++;

    const segment: TranscriptSegment = {
      id: `seg_${this.segmentIndex}`,
      text: text.trim(),
      timestamp: new Date(),
      isFinal: true,
      speakerId,
      timezone: this.getTimeManager().getTimezone(),
    };

    this.segments.mutate((s) => s.push(segment));

    // Notify ChunkBuffer when force-finalizing so it gets the text
    if (isForceFinalize && this._onForceFinalize) {
      this._onForceFinalize(segment.text);
    }

    // Notify FileManager and update availableDates
    const today = this.getTimeManager().today();
    const fileManager = this.getFileManager();
    if (fileManager) {
      // Call on recording-start AND when today's file is missing/trashed so
      // we self-heal if the user deleted today mid-recording.
      const todayFile = fileManager.files.find((f: any) => f.date === today);
      if (!wasRecording || !todayFile || todayFile.isTrashed) {
        fileManager.onTranscriptStarted(today);
      }
      fileManager.onSegmentAdded(today, this.segments.length);
    }

    // Ensure today appears in availableDates for the Transcripts tab.
    // Run this on every segment (not just the first) so it self-heals if the
    // user deletes today's transcript while recording — the next segment
    // restores today to the list.
    if (!this.availableDates.includes(today)) {
      this.availableDates.mutate((dates) => {
        if (!dates.includes(today)) {
          dates.unshift(today);
        }
      });
    }

    this.pendingSegments.push({
      text: segment.text,
      timestamp: segment.timestamp,
      isFinal: segment.isFinal,
      speakerId: segment.speakerId,
      index: this.segmentIndex,
    });
    this.scheduleSave();
  }

  async addPhotoSegment(
    photoUrl: string,
    mimeType: string,
    timezone?: string,
    description?: string,
  ): Promise<void> {
    this.segmentIndex++;

    const segment: TranscriptSegment = {
      id: `seg_${this.segmentIndex}`,
      text: description || `[Photo captured]`,
      timestamp: new Date(),
      isFinal: true,
      type: "photo",
      photoUrl,
      photoMimeType: mimeType,
      photoDescription: description,
      timezone,
    };

    this.segments.mutate((s) => s.push(segment));

    this.pendingSegments.push({
      text: segment.text,
      timestamp: segment.timestamp,
      isFinal: true,
      index: this.segmentIndex,
      type: "photo",
      photoUrl,
      photoMimeType: mimeType,
      photoDescription: description,
      timezone,
    });

    // Persist photo segments immediately (don't wait 30s)
    await this.persist();
    console.log(`[TranscriptManager] Photo segment persisted: ${photoUrl}`);
  }

  stopRecording(): void {
    this.isRecording = false;
    this.interimText = "";
    this._forceFinalizedWordCount = 0;
    this._pendingForceFinalize = false;
    this._pendingForceFinalizeSnapshot = 0;
  }

  /**
   * Finalize any in-progress interim text as a final segment.
   * Called when transcription is paused so partial speech isn't lost.
   */
  finalizeInterim(): void {
    if (this.interimText.trim()) {
      console.log(`[TranscriptManager] Finalizing interim text: "${this.interimText.slice(0, 60)}"`);
      // interimText is already stripped of force-finalized words, so save it directly
      // Reset force-finalize state first so addSegment doesn't double-strip
      const textToSave = this.interimText.trim();
      this._forceFinalizedWordCount = 0;
      this._pendingForceFinalize = false;
      this._pendingForceFinalizeSnapshot = 0;
      this.addSegment(textToSave, true);
    }
    this.stopRecording();
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  @rpc
  async loadDateTranscript(
    date: string,
  ): Promise<{ segments: TranscriptSegment[]; hourSummaries: HourSummary[] }> {
    const userId = this._session?.userId;
    if (!userId) {
      console.log(`[TranscriptManager] loadDateTranscript(${date}): No userId`);
      return { segments: [], hourSummaries: [] };
    }

    const today = this.getTimeManager().today();
    console.log(
      `[TranscriptManager] loadDateTranscript(${date}) - today is ${today}`,
    );

    // TODAY: Return current in-memory segments (originally loaded from MongoDB during hydrate)
    if (date === today) {
      console.log(
        `[TranscriptManager] ========================================`,
      );
      console.log(
        `[TranscriptManager] FETCHING transcripts from MongoDB (TODAY)`,
      );
      console.log(`[TranscriptManager] Date: ${date}`);
      console.log(`[TranscriptManager] Segments: ${this.segments.length}`);
      console.log(
        `[TranscriptManager] ========================================`,
      );
      this.loadedDate = today;
      const summaryManager = this.getSummaryManager();
      return {
        segments: [...this.segments],
        hourSummaries: summaryManager ? [...summaryManager.hourSummaries] : [],
      };
    }

    // PAST DATE: Fetch from R2 (old transcripts are migrated there)
    console.log(`[TranscriptManager] ========================================`);
    console.log(
      `[TranscriptManager] FETCHING transcripts from R2 (HISTORICAL)`,
    );
    console.log(`[TranscriptManager] Date: ${date}`);
    console.log(`[TranscriptManager] ========================================`);
    this.isLoadingHistory = true;

    try {
      const r2Manager = (this._session as any)?.r2;
      if (r2Manager) {
        const r2Data = await r2Manager.fetchTranscript(date);

        if (r2Data && r2Data.segments && r2Data.segments.length > 0) {
          const loadedSegments: TranscriptSegment[] = r2Data.segments.map(
            (seg: R2TranscriptSegment, idx: number) => ({
              id: `seg_${seg.index || idx + 1}`,
              text: seg.text,
              timestamp: new Date(seg.timestamp), // R2 stores as ISO string
              isFinal: seg.isFinal,
              speakerId: seg.speakerId,
              type: seg.type,
              photoUrl: seg.photoUrl,
              photoMimeType: seg.photoMimeType,
              timezone: seg.timezone,
            }),
          );

          // Set segments + loadedDate FIRST so backfill's generateHourSummary
          // sees the right state when it runs
          this.segments.set(loadedSegments);
          this.loadedDate = date;
          this.isLoadingHistory = false;

          // Delegate summary loading to SummaryManager
          const summaryManager = this.getSummaryManager();
          let loadedSummaries = summaryManager
            ? await summaryManager.loadSummariesForDate(date)
            : [];

          // Backfill any hours that have segments but no saved summary, so
          // historical days get titles the first time they're opened. Fire and
          // forget — frontend will see new summaries stream in via @synced.
          if (summaryManager) {
            summaryManager
              .backfillMissingHourSummaries(date)
              .then(() => {
                // Re-read after backfill so the return value below isn't stale
                // for the *initial* response — note: the synced state will already
                // have streamed any new summaries to the client by this point.
                loadedSummaries = [...summaryManager.hourSummaries];
              })
              .catch((err) =>
                console.error(`[TranscriptManager] Backfill error for ${date}:`, err),
              );
          }

          console.log(
            `[TranscriptManager] ✓ R2 fetch successful: ${loadedSegments.length} segments for ${date}`,
          );

          return {
            segments: loadedSegments,
            hourSummaries: loadedSummaries,
          };
        } else {
          console.log(`[TranscriptManager] ✗ R2 returned no data for ${date}`);
        }
      } else {
        console.log(`[TranscriptManager] ✗ No R2 manager available`);
      }

      // Not found in R2 — also try MongoDB as last resort (segments not yet migrated)
      const { getDailyTranscript } = await import("../../models");
      const userId = this._session?.userId;
      if (userId) {
        const dailyTranscript = await getDailyTranscript(userId, date);
        if (dailyTranscript?.segments?.length) {
          const loadedSegments: TranscriptSegment[] = dailyTranscript.segments.map(
            (seg, idx) => ({
              id: `seg_${idx + 1}`,
              text: seg.text,
              timestamp: seg.timestamp,
              isFinal: seg.isFinal,
              speakerId: seg.speakerId,
              type: seg.type,
              photoUrl: seg.photoUrl,
              photoMimeType: seg.photoMimeType,
              timezone: seg.timezone,
            }),
          );
          this.segments.set(loadedSegments);
          this.loadedDate = date;
          this.isLoadingHistory = false;
          console.log(`[TranscriptManager] ✓ MongoDB fallback: ${loadedSegments.length} segments for ${date}`);

          const summaryManager = this.getSummaryManager();
          const loadedSummaries = summaryManager
            ? await summaryManager.loadSummariesForDate(date)
            : [];

          if (summaryManager) {
            summaryManager
              .backfillMissingHourSummaries(date)
              .catch((err) =>
                console.error(`[TranscriptManager] Backfill error for ${date}:`, err),
              );
          }

          return { segments: loadedSegments, hourSummaries: loadedSummaries };
        }
      }

      // Truly not found anywhere
      console.log(`[TranscriptManager] ✗ No transcript found for ${date}`);
      this.segments.set([]);
      this.loadedDate = date;
      this.getSummaryManager()?.loadSummariesForDate(date);
      this.isLoadingHistory = false;

      return { segments: [], hourSummaries: [] };
    } catch (error) {
      console.error(
        `[TranscriptManager] Failed to load transcript for ${date}:`,
        error,
      );
      this.isLoadingHistory = false;
      this.segments.set([]);
      this.loadedDate = date;
      return { segments: [], hourSummaries: [] };
    }
  }

  @rpc
  async loadTodayTranscript(): Promise<void> {
    const today = this.getTimeManager().today();
    if (this.loadedDate === today) {
      console.log(
        `[TranscriptManager] ========================================`,
      );
      console.log(
        `[TranscriptManager] FETCHING transcripts from MongoDB (TODAY)`,
      );
      console.log(`[TranscriptManager] Date: ${today} (already loaded)`);
      console.log(`[TranscriptManager] Segments: ${this.segments.length}`);
      console.log(
        `[TranscriptManager] ========================================`,
      );
      return;
    }
    console.log(`[TranscriptManager] ========================================`);
    console.log(
      `[TranscriptManager] FETCHING transcripts from MongoDB (TODAY)`,
    );
    console.log(`[TranscriptManager] Date: ${today} (re-hydrating)`);
    console.log(`[TranscriptManager] ========================================`);
    await this.hydrate();
  }

  @rpc
  async getRecentSegments(count: number = 50): Promise<TranscriptSegment[]> {
    return this.segments.slice(-count);
  }

  @rpc
  async getFullText(): Promise<string> {
    return this.segments.map((s) => s.text).join(" ");
  }

  @rpc
  async clear(): Promise<void> {
    this.segments.set([]);
    this.interimText = "";
    this.segmentIndex = 0;
    this.getSummaryManager()?.clear();
  }

  @rpc
  async removeDates(dates: string[]): Promise<void> {
    const dateSet = new Set(dates);
    this.availableDates.set(
      (this.availableDates as unknown as string[]).filter((d) => !dateSet.has(d))
    );
  }

}
