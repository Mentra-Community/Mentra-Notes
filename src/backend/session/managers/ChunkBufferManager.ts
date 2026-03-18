/**
 * ChunkBufferManager
 *
 * Accumulates transcript segments into 40-second chunks.
 * Each chunk is persisted to the database and forwarded to the triage pipeline.
 *
 * Heartbeat cycle:
 * 1. Every BUFFER_INTERVAL_MS, snapshot the accumulated text
 * 2. Wait up to SENTENCE_BOUNDARY_MAX_WAIT_MS for a sentence to finish
 * 3. Package into a TranscriptChunk and persist
 * 4. Call onChunkReady callback for downstream processing (triage → tracker → note gen)
 */

import { SyncedManager } from "../../../lib/sync";
import {
  createTranscriptChunk,
  getNextChunkIndex,
  type TranscriptChunkI,
} from "../../models/transcript-chunk.model";
import { AUTO_NOTES_CONFIG } from "../../core/auto-conversation/config";
import { TimeManager } from "./TimeManager";

export type ChunkReadyCallback = (chunk: TranscriptChunkI) => void;

export class ChunkBufferManager extends SyncedManager {
  // Internal buffer — not synced to frontend
  private buffer: string[] = [];
  private bufferStartTime: Date | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sentenceWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private timeManager: TimeManager | null = null;
  private chunkIndex: number = 0;
  private _onChunkReady: ChunkReadyCallback | null = null;
  private _isRunning = false;
  private _isSpeaking = false;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();
      this.chunkIndex = await getNextChunkIndex(userId, today);
      console.log(
        `[ChunkBuffer] Hydrated | next chunkIndex: ${this.chunkIndex}`,
      );
    } catch (error) {
      console.error("[ChunkBuffer] Failed to hydrate:", error);
    }
  }

  async persist(): Promise<void> {
    // Flush any remaining buffer content as a final chunk
    if (this.buffer.length > 0) {
      await this.flushBuffer();
    }
  }

  destroy(): void {
    this.stop();
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  /**
   * Set callback for when a new chunk is ready for pipeline processing
   */
  onChunkReady(callback: ChunkReadyCallback): void {
    this._onChunkReady = callback;
  }

  // =========================================================================
  // Start / Stop
  // =========================================================================

  /**
   * Start the 40-second heartbeat. Called when recording begins.
   */
  start(): void {
    if (this._isRunning) return;
    this._isRunning = true;

    console.log(
      `[ChunkBuffer] Starting heartbeat (${AUTO_NOTES_CONFIG.BUFFER_INTERVAL_MS / 1000}s interval)`,
    );

    this.heartbeatTimer = setInterval(() => {
      this.onHeartbeat();
    }, AUTO_NOTES_CONFIG.BUFFER_INTERVAL_MS);
  }

  /**
   * Stop the heartbeat. Called when recording stops or session disposes.
   */
  stop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.sentenceWaitTimer) {
      clearTimeout(this.sentenceWaitTimer);
      this.sentenceWaitTimer = null;
    }

    console.log(`[ChunkBuffer] Stopped heartbeat`);
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  // =========================================================================
  // Feed Transcript Data
  // =========================================================================

  /**
   * Called by NotesSession on every transcript event (interim + final).
   * Tracks whether the user is mid-sentence so we don't emit false silence signals.
   */
  markSpeaking(speaking: boolean): void {
    this._isSpeaking = speaking;
  }

  /**
   * Called by NotesSession when a final transcript segment arrives.
   * Accumulates text into the rolling buffer.
   */
  addText(text: string): void {
    if (!text.trim()) return;

    if (!this.bufferStartTime) {
      this.bufferStartTime = new Date();
    }

    this.buffer.push(text.trim());

    // If the heartbeat hasn't started yet (first text), start it
    if (!this._isRunning) {
      this.start();
    }
  }

  // =========================================================================
  // Heartbeat Logic
  // =========================================================================

  private async onHeartbeat(): Promise<void> {
    if (this.buffer.length === 0) {
      if (this._isSpeaking) {
        // User is mid-sentence (interim results flowing) — not real silence, skip
        console.log(`[ChunkBuffer] Skipping silence — user still speaking (interim results active)`);
        return;
      }
      // Empty buffer and no speech activity — emit silence signal
      await this.emitSilenceSignal();
      return;
    }

    const text = this.buffer.join(" ");

    // Check if the text ends at a sentence boundary
    if (AUTO_NOTES_CONFIG.SENTENCE_END_REGEX.test(text)) {
      // Clean cut — emit immediately
      await this.emitChunk(text);
      this.clearBuffer();
      return;
    }

    // Not at sentence boundary — wait up to MAX_WAIT for one
    await this.waitForSentenceBoundary(text);
  }

  private waitForSentenceBoundary(initialText: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const maxWait = AUTO_NOTES_CONFIG.SENTENCE_BOUNDARY_MAX_WAIT_MS;
      const checkInterval = 500; // Check every 500ms
      let elapsed = 0;

      const check = async () => {
        const currentText = this.buffer.join(" ");

        // Sentence boundary found, or max wait reached
        if (
          AUTO_NOTES_CONFIG.SENTENCE_END_REGEX.test(currentText) ||
          elapsed >= maxWait
        ) {
          if (this.sentenceWaitTimer) {
            clearTimeout(this.sentenceWaitTimer);
            this.sentenceWaitTimer = null;
          }
          await this.emitChunk(currentText || initialText);
          this.clearBuffer();
          resolve();
          return;
        }

        elapsed += checkInterval;
        this.sentenceWaitTimer = setTimeout(check, checkInterval);
      };

      this.sentenceWaitTimer = setTimeout(check, checkInterval);
    });
  }

  // =========================================================================
  // Chunk Emission
  // =========================================================================

  private async emitChunk(text: string): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    const now = new Date();
    const today = this.getTimeManager().today();
    const wordCount = text
      ? text.split(/\s+/).filter((w) => w.length > 0).length
      : 0;

    try {
      const chunk = await createTranscriptChunk({
        userId,
        chunkIndex: this.chunkIndex,
        text,
        wordCount,
        startTime: this.bufferStartTime || now,
        endTime: now,
        date: today,
        classification: "pending",
        conversationId: null,
        metadata: {},
      });

      this.chunkIndex++;

      const preview = text.length > 50 ? text.substring(0, 50) + "..." : text;
      console.log(
        `[ChunkBuffer] Chunk #${chunk.chunkIndex} emitted | ${wordCount} words | "${preview}"`,
      );

      // Forward to pipeline
      if (this._onChunkReady) {
        try {
          this._onChunkReady(chunk);
        } catch (error) {
          console.error(
            "[ChunkBuffer] Error in onChunkReady callback:",
            error,
          );
        }
      }
    } catch (error) {
      console.error("[ChunkBuffer] Failed to create chunk:", error);
    }
  }

  /**
   * Emit a synthetic silence chunk to the pipeline without persisting to DB.
   * This lets the ConversationTracker detect silence patterns (pause/end).
   */
  private async emitSilenceSignal(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId || !this._onChunkReady) return;

    const now = new Date();
    const today = this.getTimeManager().today();

    // Create an in-memory chunk object (not saved to DB)
    const silenceChunk = {
      _id: undefined,
      userId,
      chunkIndex: -1,
      text: "",
      wordCount: 0,
      startTime: now,
      endTime: now,
      date: today,
      classification: "pending" as const,
      conversationId: null,
      metadata: {},
    } as any;

    console.log(`[ChunkBuffer] Silence signal emitted`);

    try {
      this._onChunkReady(silenceChunk);
    } catch (error) {
      console.error("[ChunkBuffer] Error in silence signal callback:", error);
    }
  }

  clearBuffer(): void {
    this.buffer = [];
    this.bufferStartTime = null;
  }

  private async flushBuffer(): Promise<void> {
    if (this.buffer.length === 0) return;
    const text = this.buffer.join(" ");
    await this.emitChunk(text);
    this.clearBuffer();
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private getTimeManager(): TimeManager {
    const settingsTimezone = (this._session as any)?.settings?.timezone as
      | string
      | null;
    const currentTimezone = settingsTimezone || undefined;

    if (
      !this.timeManager ||
      (this as any)._lastTimezone !== currentTimezone
    ) {
      this.timeManager = new TimeManager(currentTimezone);
      (this as any)._lastTimezone = currentTimezone;
    }
    return this.timeManager;
  }
}
