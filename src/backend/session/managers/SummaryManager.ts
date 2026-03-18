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

      this.startRollingSummaryTimer();
    } catch (error) {
      console.error("[SummaryManager] Failed to hydrate:", error);
    }
  }

  destroy(): void {
    this.stopRollingSummaryTimer();
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
