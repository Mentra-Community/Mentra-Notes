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
  type TranscriptSegmentI,
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

      // Merge and dedupe dates, sort descending
      const allDates = Array.from(new Set([...mongoDbDates, ...r2Dates]));
      allDates.sort((a, b) => b.localeCompare(a));
      console.log(`[TranscriptManager] All available dates:`, allDates);
      this.availableDates.set(allDates);

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
      }
    } catch (error) {
      console.error("[TranscriptManager] Failed to persist:", error);
    }
  }

  destroy(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
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
      if (!wasRecording) {
        fileManager.onTranscriptStarted(today);
      }
      fileManager.onSegmentAdded(today, this.segments.length);
    }

    // Ensure today appears in availableDates for the Transcripts tab
    if (!wasRecording && !this.availableDates.includes(today)) {
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

          // Delegate summary loading to SummaryManager
          const summaryManager = this.getSummaryManager();
          const loadedSummaries = summaryManager
            ? await summaryManager.loadSummariesForDate(date)
            : [];

          this.segments.set(loadedSegments);
          this.loadedDate = date;
          this.isLoadingHistory = false;

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

      // Not found in R2
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
      throw error;
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

}
