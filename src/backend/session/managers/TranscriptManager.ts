/**
 * TranscriptManager
 *
 * Manages transcript segments, interim text, and hour summaries.
 * Handles both real-time transcription and historical transcript loading.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  getOrCreateDailyTranscript,
  getAvailableDates,
  appendTranscriptSegments,
  saveHourSummary,
  getHourSummaries,
  type TranscriptSegmentI,
} from "../../models";
import type { R2TranscriptSegment } from "../../services/r2Upload.service";
import {
  createProviderFromEnv,
  type AgentProvider,
  type UnifiedMessage,
} from "../../services/llm";
import {
  getUserState,
  createUserState,
  updateTranscriptionBatchEndOfDay,
} from "../../services/userState.service";
import { TimeManager } from "./TimeManager";
import type { FileManager } from "./FileManager";
import { get } from "http";

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

// =============================================================================
// Manager
// =============================================================================

export class TranscriptManager extends SyncedManager {
  @synced segments = synced<TranscriptSegment[]>([]);
  @synced interimText = "";
  @synced isRecording = false;
  @synced hourSummaries = synced<HourSummary[]>([]);
  @synced currentHourSummary = "";
  @synced loadedDate = "";
  @synced availableDates = synced<string[]>([]);
  @synced isLoadingHistory = false;
  @synced isSyncingPhoto = false;

  private segmentIndex = 0;
  private provider: AgentProvider | null = null;
  private pendingSegments: TranscriptSegmentI[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private rollingSummaryTimer: ReturnType<typeof setInterval> | null = null;
  private lastSummaryHour: number = -1;
  private lastSummarySegmentCount: number = 0;
  private userStateInitialized = false;
  private timeManager: TimeManager | null = null;
  private transcriptionBatchEndOfDay: Date | null = null;

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getProvider(): AgentProvider {
    if (!this.provider) {
      this.provider = createProviderFromEnv();
    }
    return this.provider;
  }

  private getTimeManager(): TimeManager {
    // Always resolve the latest timezone — it may change when glasses connect
    const settingsTimezone = (this._session as any)?.settings?.timezone as string | null;
    const appTimezone = (this._session as any).appSession?.settings?.getMentraOS(
      "userTimezone",
    ) as string | undefined;
    const currentTimezone = settingsTimezone || appTimezone || undefined;

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

      // Load saved hour summaries
      const savedSummaries = await getHourSummaries(userId, today);
      if (savedSummaries.length > 0) {
        const loadedSummaries: HourSummary[] = savedSummaries.map((s) => ({
          id: `summary_${s.date}_${s.hour}`,
          date: s.date,
          hour: s.hour,
          hourLabel: s.hourLabel,
          summary: s.summary,
          segmentCount: s.segmentCount,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
        this.hourSummaries.set(loadedSummaries);
      }

      // Load or create transcriptionBatchEndOfDay from MongoDB
      const defaultEndOfDay = new Date(this.getTimeManager().endOfDay());
      console.log(
        `[TranscriptManager] Ensuring UserState exists for ${userId}, default EOD: ${defaultEndOfDay.toISOString()}`,
      );
      const timezone = (this._session as any).appSession?.settings?.getMentraOS(
        "userTimezone",
      ) as string | undefined;
      const userState = await createUserState(userId, defaultEndOfDay, timezone);

      // Use the DB value — it may be older than today if there are unbatched transcripts
      this.transcriptionBatchEndOfDay = userState.transcriptionBatchEndOfDay;
      this.userStateInitialized = true;
      console.log(
        `[TranscriptManager] Loaded batch end of day from DB: ${this.transcriptionBatchEndOfDay}`,
      );

      // Catch up on any missed batches (e.g. old transcripts from previous days)
      await this.setBatchDate();

      this.startRollingSummaryTimer();
    } catch (error) {
      console.error("[TranscriptManager] Failed to hydrate:", error);
    }
  }

  async persist(): Promise<void> {
    if (this.pendingSegments.length === 0) return;

    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();
      const toSave = [...this.pendingSegments];
      this.pendingSegments = [];

      await appendTranscriptSegments(userId, today, toSave);
      console.log(
        `[TranscriptManager] Persisted ${toSave.length} segments for ${userId}`,
      );
    } catch (error) {
      console.error("[TranscriptManager] Failed to persist:", error);
    }
  }

  destroy(): void {
    this.stopRollingSummaryTimer();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  // ===========================================================================
  // Rolling Summary Timer
  // ===========================================================================

  private startRollingSummaryTimer(): void {
    if (this.rollingSummaryTimer) return;

    this.updateRollingSummary();

    this.rollingSummaryTimer = setInterval(
      () => {
        this.updateRollingSummary();
      },
      5 * 60 * 1000,
    );

    console.log("[TranscriptManager] Rolling summary timer started");
  }

  private stopRollingSummaryTimer(): void {
    if (this.rollingSummaryTimer) {
      clearInterval(this.rollingSummaryTimer);
      this.rollingSummaryTimer = null;
    }
  }

  private async updateRollingSummary(): Promise<void> {
    const now = new Date();
    const timeManager = this.getTimeManager();
    const currentHour = timeManager.currentHour();
    const today = timeManager.today();

    const hourSegments = this.segments.filter((seg) => {
      const segHour = timeManager.hourFrom(seg.timestamp);
      const segDateStr = timeManager.toDateString(new Date(seg.timestamp));
      return segDateStr === today && segHour === currentHour;
    });

    const hourChanged = currentHour !== this.lastSummaryHour;
    const significantNewSegments =
      hourSegments.length >= this.lastSummarySegmentCount + 5;

    if (hourSegments.length === 0) {
      if (hourChanged) {
        this.currentHourSummary = `${timeManager.formatHour(currentHour)} - Waiting for activity...`;
        this.lastSummaryHour = currentHour;
        this.lastSummarySegmentCount = 0;
      }
      return;
    }

    if (!hourChanged && !significantNewSegments) {
      return;
    }

    try {
      const summary = await this.generateHourSummary(currentHour);
      this.currentHourSummary = summary.summary;
      this.lastSummaryHour = currentHour;
      this.lastSummarySegmentCount = hourSegments.length;
    } catch (error) {
      console.error(
        "[TranscriptManager] Failed to update rolling summary:",
        error,
      );
      this.currentHourSummary = `${timeManager.formatHour(currentHour)} - ${hourSegments.length} segments recorded`;
    }
  }

  getCurrentHourSummary(): string {
    if (this.currentHourSummary) {
      return this.currentHourSummary;
    }
    const timeManager = this.getTimeManager();
    const hour = timeManager.currentHour();
    return `${timeManager.formatHour(hour)} - Starting...`;
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

    if (!isFinal) {
      this.interimText = text;
      return;
    }

    this.interimText = "";
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

    // Notify FileManager on first segment (transcript started)
    if (!wasRecording) {
      const fileManager = this.getFileManager();
      if (fileManager) {
        const today = this.getTimeManager().today();
        fileManager.onTranscriptStarted(today);
      }
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
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  @rpc
  async refreshHourSummary(): Promise<string> {
    await this.updateRollingSummary();
    return this.currentHourSummary;
  }

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
      return {
        segments: [...this.segments],
        hourSummaries: [...this.hourSummaries],
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

          // R2 doesn't store hour summaries, but they may exist in MongoDB
          let loadedSummaries: HourSummary[] = [];
          try {
            const savedSummaries = await getHourSummaries(userId, date);
            if (savedSummaries.length > 0) {
              loadedSummaries = savedSummaries.map((s) => ({
                id: `summary_${s.date}_${s.hour}`,
                date: s.date,
                hour: s.hour,
                hourLabel: s.hourLabel,
                summary: s.summary,
                segmentCount: s.segmentCount,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
              }));
              console.log(
                `[TranscriptManager] ✓ Loaded ${loadedSummaries.length} hour summaries from MongoDB for ${date}`,
              );
            }
          } catch (err) {
            console.error(
              `[TranscriptManager] Failed to load hour summaries from MongoDB for ${date}:`,
              err,
            );
          }

          this.segments.set(loadedSegments);
          this.loadedDate = date;
          this.hourSummaries.set(loadedSummaries);
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
      this.hourSummaries.set([]);
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
    this.hourSummaries.set([]);
    this.currentHourSummary = "";
    this.lastSummaryHour = -1;
    this.lastSummarySegmentCount = 0;
  }

  @rpc
  async generateHourSummary(hour?: number): Promise<HourSummary> {
    const timeManager = this.getTimeManager();
    const targetHour = hour ?? timeManager.currentHour();
    const targetDate = this.loadedDate || timeManager.today();

    const hourSegments = this.segments.filter((seg) => {
      const segHour = timeManager.hourFrom(seg.timestamp);
      const segDateStr = timeManager.toDateString(new Date(seg.timestamp));
      return segDateStr === targetDate && segHour === targetHour;
    });

    if (hourSegments.length === 0) {
      const summary: HourSummary = {
        id: `summary_${targetDate}_${targetHour}`,
        date: targetDate,
        hour: targetHour,
        hourLabel: timeManager.formatHour(targetHour),
        summary: "No activity recorded during this hour.",
        segmentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return summary;
    }

    const transcriptText = hourSegments.map((s) => s.text).join(" ");

    const provider = this.getProvider();
    const messages: UnifiedMessage[] = [
      {
        role: "user",
        content: `Summarize this hour's activity:\n\n${transcriptText}`,
      },
    ];

    try {
      const response = await provider.chat(messages, {
        tier: "fast",
        maxTokens: 200,
        systemPrompt: `You write hour summaries for a personal notes app. Output a TITLE on line 1, then a BODY on line 2.

FORMAT:
Line 1: Short title (2-4 words, noun phrase, no punctuation)
Line 2: 1-2 sentences in PAST TENSE describing what happened. Be specific and punchy.

RULES:
- Title is a noun phrase like "Product Launch Sync" or "Bug Fixes"
- Body uses past tense: "Fixed", "Debugged", "Reviewed", "Discussed"
- NO filler: skip "also", "additionally", "as well"
- Include specific names, numbers, technical terms mentioned
- Keep body under 150 characters`,
      });

      const responseText =
        typeof response.content === "string"
          ? response.content
          : response.content
              .filter((c) => c.type === "text")
              .map((c) => (c as any).text)
              .join("");

      const summary: HourSummary = {
        id: `summary_${targetDate}_${targetHour}`,
        date: targetDate,
        hour: targetHour,
        hourLabel: timeManager.formatHour(targetHour),
        summary: responseText,
        segmentCount: hourSegments.length,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Persist to database
      const userId = this._session?.userId;
      if (userId) {
        try {
          await saveHourSummary(
            userId,
            targetDate,
            targetHour,
            summary.hourLabel,
            summary.summary,
            summary.segmentCount,
          );
        } catch (err) {
          console.error(
            "[TranscriptManager] Failed to save hour summary:",
            err,
          );
        }
      }

      // Update local state
      this.hourSummaries.mutate((summaries) => {
        const existingIndex = summaries.findIndex(
          (s) => s.date === targetDate && s.hour === targetHour,
        );
        if (existingIndex >= 0) {
          summaries[existingIndex] = summary;
        } else {
          summaries.push(summary);
        }
      });

      return summary;
    } catch (error) {
      console.error(
        "[TranscriptManager] Failed to generate hour summary:",
        error,
      );
      throw error;
    }
  }
  /**
   * Check if batch date has passed, and if so trigger R2 upload and update to new end of day
   */
  async setBatchDate(): Promise<void> {
    const passed = await this.checkBatchDate();
    if (passed) {
      const userId = this._session?.userId;
      if (!userId) return;

      const timeManager = this.getTimeManager();
      // Get timezone from TimeManager (which resolves to system default if not set)
      const timezone = timeManager.getTimezone();

      // Use the stored cutoff timestamp - batch all segments up to this time
      const cutoffTimestamp = this.transcriptionBatchEndOfDay;
      if (!cutoffTimestamp) {
        console.error(`[setBatchDate] No cutoff timestamp available`);
        return;
      }

      const cutoffISO = cutoffTimestamp.toISOString();
      console.log(
        `[setBatchDate] Batch cutoff crossed, uploading transcripts up to ${cutoffISO}`,
      );

      // Trigger R2 upload via CloudflareR2Manager
      const r2Manager = (this._session as any)?.r2;
      if (r2Manager) {
        const batchResult = await r2Manager.triggerBatch(
          userId,
          cutoffISO,
          timezone,
        );

        if (batchResult.success) {
          // Delete processed segments from MongoDB (pass timezone for date-based cleanup)
          const deletedCount = await r2Manager.cleanupProcessedSegments(
            cutoffISO,
            timezone,
          );
          console.log(
            `[setBatchDate] Cleaned up ${deletedCount} segments from MongoDB`,
          );

          // Update batch cutoff on success
          const newEndOfDay = new Date(this.getTimeManager().endOfDay());

          await updateTranscriptionBatchEndOfDay(userId, newEndOfDay);
          console.log(
            `[setBatchDate] R2 batch successful, updated cutoff: ${newEndOfDay}`,
          );
        } else {
          console.error(
            `[setBatchDate] R2 batch failed, keeping old cutoff for retry:`,
            batchResult.error,
          );
        }
      } else {
        // No R2 manager available, just update the cutoff
        console.warn(
          `[setBatchDate] No R2Manager available, skipping R2 upload`,
        );
        const newEndOfDay = new Date(this.getTimeManager().endOfDay());
        await updateTranscriptionBatchEndOfDay(userId, newEndOfDay);
      }
    }
  }

  /**
   * Check if the current UTC time has passed the batch end of day
   * Fetches fresh data from MongoDB every time
   * Returns true if batch has expired (day has changed), false otherwise
   */
  async checkBatchDate(): Promise<boolean> {
    const userId = this._session?.userId;
    if (!userId) {
      console.log("[checkBatchDate] No userId available");
      return false;
    }

    // Fetch fresh from MongoDB every time
    const userState = await getUserState(userId);
    if (!userState?.transcriptionBatchEndOfDay) {
      console.log("[checkBatchDate] Batch date not set in DB");
      return false;
    }

    const batchEndOfDay = userState.transcriptionBatchEndOfDay;
    this.transcriptionBatchEndOfDay = batchEndOfDay; // Update local cache

    const timeManager = this.getTimeManager();
    const currentUTC = timeManager.now();
    console.log(
      `[checkBatchDate] Current UTC: ${currentUTC} | Batch End: ${batchEndOfDay.toISOString()}`,
    );

    if (currentUTC > batchEndOfDay.toISOString()) {
      console.log(
        "[checkBatchDate] PASSED - Current UTC time has passed batch end of day",
      );
      return true;
    } else {
      console.log(
        "[checkBatchDate] NOT PASSED - Current UTC time has NOT passed batch end of day",
      );
      return false;
    }
  }
}
