/**
 * SummaryManager
 *
 * Manages hour summaries — rolling timer, LLM generation, and summary state.
 * Read-only consumer of transcript segments (reads via session reference).
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  saveHourSummary,
  getHourSummaries,
} from "../../models";
import {
  createProviderFromEnv,
  type AgentProvider,
  type UnifiedMessage,
} from "../../services/llm";
import { TimeManager } from "./TimeManager";
import type { TranscriptSegment, HourSummary } from "./TranscriptManager";

// =============================================================================
// Manager
// =============================================================================

export class SummaryManager extends SyncedManager {
  @synced hourSummaries = synced<HourSummary[]>([]);
  @synced currentHourSummary = "";

  private lastSummaryHour: number = -1;
  private lastSummarySegmentCount: number = 0;
  private rollingSummaryTimer: ReturnType<typeof setInterval> | null = null;
  private provider: AgentProvider | null = null;
  private timeManager: TimeManager | null = null;

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

  private getTranscriptSegments(): TranscriptSegment[] {
    return (this._session as any)?.transcript?.segments ?? [];
  }

  private getLoadedDate(): string {
    return (this._session as any)?.transcript?.loadedDate ?? "";
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();

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

      // Seed lastSummaryHour from existing data so the rolling timer doesn't
      // think the hour just changed and re-finalize an already-saved hour.
      // Pick the highest hour we already have a summary for today.
      const todayHoursWithSummary = (this.hourSummaries as unknown as HourSummary[])
        .filter((s) => s.date === today)
        .map((s) => s.hour);
      if (todayHoursWithSummary.length > 0) {
        this.lastSummaryHour = Math.max(...todayHoursWithSummary);
      }

      this.startRollingSummaryTimer();

      // Backfill any past hours of today that have segments but no saved
      // summary. Runs in the background — frontend will see titles stream in
      // via @synced as each LLM call completes.
      this.backfillMissingHourSummaries(today).catch((err) =>
        console.error(`[SummaryManager] Today backfill failed:`, err),
      );
    } catch (error) {
      console.error("[SummaryManager] Failed to hydrate:", error);
    }
  }

  destroy(): void {
    this.stopRollingSummaryTimer();
    this.provider = null;
    this.timeManager = null;
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

    console.log("[SummaryManager] Rolling summary timer started");
  }

  private stopRollingSummaryTimer(): void {
    if (this.rollingSummaryTimer) {
      clearInterval(this.rollingSummaryTimer);
      this.rollingSummaryTimer = null;
    }
  }

  private async updateRollingSummary(): Promise<void> {
    const timeManager = this.getTimeManager();
    const currentHour = timeManager.currentHour();
    const today = timeManager.today();
    const segments = this.getTranscriptSegments();

    const hourSegments = segments.filter((seg) => {
      const segHour = timeManager.hourFrom(seg.timestamp);
      const segDateStr = timeManager.toDateString(new Date(seg.timestamp));
      return segDateStr === today && segHour === currentHour;
    });

    const hourChanged = currentHour !== this.lastSummaryHour;
    const significantNewSegments =
      hourSegments.length - this.lastSummarySegmentCount >= 5;

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

    // Hour just rolled over — generate a final summary for the previous hour
    // so it persists in MongoDB instead of being lost when we move on. Without
    // this, past hours of "today" never get a title shown in the UI.
    if (hourChanged && this.lastSummaryHour >= 0 && this.lastSummaryHour !== currentHour) {
      const prevHour = this.lastSummaryHour;
      this.generateHourSummary(prevHour).catch((err) =>
        console.error(`[SummaryManager] Failed to finalize summary for hour ${prevHour}:`, err),
      );
    }

    try {
      const summary = await this.generateHourSummary(currentHour);
      this.currentHourSummary = summary.summary;
      this.lastSummaryHour = currentHour;
      this.lastSummarySegmentCount = hourSegments.length;
    } catch (error) {
      console.error(
        "[SummaryManager] Failed to update rolling summary:",
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
  // Public Methods (called by TranscriptManager)
  // ===========================================================================

  /**
   * Load summaries for a specific date (called by TranscriptManager.loadDateTranscript)
   */
  async loadSummariesForDate(date: string): Promise<HourSummary[]> {
    const userId = this._session?.userId;
    if (!userId) return [];

    try {
      const savedSummaries = await getHourSummaries(userId, date);
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
        console.log(
          `[SummaryManager] Loaded ${loadedSummaries.length} hour summaries for ${date}`,
        );
        return loadedSummaries;
      }
    } catch (err) {
      console.error(
        `[SummaryManager] Failed to load hour summaries for ${date}:`,
        err,
      );
    }

    this.hourSummaries.set([]);
    return [];
  }

  /**
   * Backfill any hours that have segments but no saved summary.
   * Called after a historical date loads, so titles get generated lazily and
   * persist for next time. Runs LLM calls sequentially to keep load light.
   *
   * Assumes `this.segments` already holds the date's segments and `loadedDate`
   * has been set, since `generateHourSummary` reads from those.
   */
  async backfillMissingHourSummaries(date: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    const timeManager = this.getTimeManager();
    const segments = this.getTranscriptSegments();

    // Bucket segments by hour for this date
    const hoursWithSegments = new Set<number>();
    for (const seg of segments) {
      const segDateStr = timeManager.toDateString(new Date(seg.timestamp));
      if (segDateStr !== date) continue;
      hoursWithSegments.add(timeManager.hourFrom(seg.timestamp));
    }

    if (hoursWithSegments.size === 0) return;

    // For today, skip the current hour — it's still active and the rolling
    // timer will own it. Only finalize past hours.
    const today = timeManager.today();
    const currentHour = timeManager.currentHour();
    const isToday = date === today;

    const existing = new Set(
      this.hourSummaries
        .filter((s) => s.date === date)
        .map((s) => s.hour),
    );

    const missing: number[] = [];
    for (const h of hoursWithSegments) {
      if (existing.has(h)) continue;
      if (isToday && h === currentHour) continue;
      missing.push(h);
    }

    if (missing.length === 0) return;

    console.log(
      `[SummaryManager] Backfilling ${missing.length} hour summaries for ${date}: ${missing.sort((a, b) => a - b).join(", ")}`,
    );

    // Sequential generation to avoid hammering the LLM on large days
    for (const hour of missing.sort((a, b) => a - b)) {
      try {
        await this.generateHourSummary(hour);
      } catch (err) {
        console.error(
          `[SummaryManager] Backfill failed for ${date} hour ${hour}:`,
          err,
        );
      }
    }
  }

  /**
   * Clear all summary state (called by TranscriptManager.clear)
   */
  clear(): void {
    this.hourSummaries.set([]);
    this.currentHourSummary = "";
    this.lastSummaryHour = -1;
    this.lastSummarySegmentCount = 0;
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
  async generateHourSummary(hour?: number): Promise<HourSummary> {
    const timeManager = this.getTimeManager();
    const targetHour = hour ?? timeManager.currentHour();
    const loadedDate = this.getLoadedDate();
    const targetDate = loadedDate || timeManager.today();
    const segments = this.getTranscriptSegments();

    const hourSegments = segments.filter((seg) => {
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
            "[SummaryManager] Failed to save hour summary:",
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
        "[SummaryManager] Failed to generate hour summary:",
        error,
      );
      throw error;
    }
  }
}
