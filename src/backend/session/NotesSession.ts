/**
 * NotesSession - Notes app session using the sync library
 *
 * Uses @manager decorator for automatic wiring:
 * - Injects session reference into managers
 * - Infers manager name from property key
 * - Auto-registers with session
 *
 * One session per user - created when any client (webview or glasses) connects.
 */

import { SyncedSession, SessionManager, manager } from "../../lib/sync";
import {
  TranscriptManager,
  NotesManager,
  ChatManager,
  SettingsManager,
  CloudflareR2Manager,
  FileManager,
  PhotoManager,
} from "./managers";
import { InputManager } from "./managers/InputManager";
import { createUserState } from "../services/userState.service";
import { TimeManager } from "./managers/TimeManager";
import type { AppSession } from "@mentra/sdk";

export class NotesSession extends SyncedSession {
  // Managers - @manager decorator handles all wiring automatically
  @manager transcript = new TranscriptManager();
  @manager notes = new NotesManager();
  @manager chat = new ChatManager();
  @manager settings = new SettingsManager();
  @manager r2 = new CloudflareR2Manager();
  @manager file = new FileManager();
  @manager photo = new PhotoManager();
  @manager input = new InputManager();

  // MentraOS AppSession - null if no glasses connected (not synced)
  private _appSession: AppSession | null = null;

  // ===========================================================================
  // Client Connection - Refresh FileManager on connect
  // ===========================================================================

  /**
   * Override addClient - no longer refreshes FileManager on every connect
   * to avoid glitchy filter state changes. Initial hydration handles everything.
   */
  addClient(ws: any): void {
    super.addClient(ws);
    // Note: FileManager is hydrated once during session creation.
    // We no longer re-hydrate on every client connect to avoid
    // race conditions with user filter selections.
  }

  // ===========================================================================
  // AppSession Management (glasses connection)
  // ===========================================================================

  get appSession(): AppSession | null {
    return this._appSession;
  }

  get hasGlassesConnected(): boolean {
    return this._appSession !== null;
  }

  /**
   * Called when glasses connect via MentraOS
   */
  setAppSession(appSession: AppSession): void {
    const wasHeadless = this._appSession === null;
    this._appSession = appSession;

    if (wasHeadless) {
      console.log(
        `[NotesSession] Glasses connected for ${this.userId} - full mode`,
      );
      // Broadcast state change
      this.broadcastStateChange("session", "hasGlassesConnected", true);
      // Wire up button + touch listeners for this user's session
      this.input.setup(appSession);

      // Now that glasses are connected, persist the user's IANA timezone
      const timezone = appSession.settings.getMentraOS<string>("userTimezone");
      if (timezone) {
        const timeManager = new TimeManager(timezone);
        const endOfDay = new Date(timeManager.endOfDay());
        createUserState(this.userId, endOfDay, timezone).catch((err) =>
          console.error(`[NotesSession] Failed to update timezone:`, err),
        );
      }

      // Note: FileManager is hydrated once during session creation.
      // We no longer re-hydrate on glasses connect to avoid
      // race conditions with user filter selections.
    }
  }

  /**
   * Called when glasses disconnect
   */
  clearAppSession(): void {
    if (this._appSession === null) return;

    this._appSession = null;

    // Reset recording state since glasses are disconnected
    this.transcript.stopRecording();

    console.log(
      `[NotesSession] Glasses disconnected for ${this.userId} - headless mode`,
    );
    this.broadcastStateChange("session", "hasGlassesConnected", false);
    this.broadcastStateChange("session", "isRecording", false);
  }

  // ===========================================================================
  // Transcription Handling
  // ===========================================================================

  /**
   * Handle incoming transcription from glasses
   */
  onTranscription(text: string, isFinal: boolean, speakerId?: string): void {
    // Add to transcript
    this.transcript.addSegment(text, isFinal, speakerId);

    // Show on glasses display based on display mode
    if (this._appSession) {
      this.updateGlassesDisplay(text);
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Clean up resources when session is disposed
   */
  async dispose(): Promise<void> {
    // Clean up transcript manager timers
    this.transcript.destroy();

    // Call parent dispose (persists data, clears clients)
    await super.dispose();
  }

  /**
   * Update glasses display based on current display mode
   */
  private updateGlassesDisplay(transcriptText: string): void {
    if (!this._appSession) return;

    const mode = this.settings.glassesDisplayMode;

    switch (mode) {
      case "off":
        // Don't show anything on glasses
        break;

      case "live_transcript":
        // Show real-time transcription (original behavior)
        if (this.settings.showLiveTranscript) {
          this._appSession.dashboard.content.write(transcriptText);
        }
        break;

      case "hour_summary":
        // Show the rolling hour summary instead of raw text
        // Only update on final segments to avoid flickering
        const summary = this.transcript.getCurrentHourSummary();
        this._appSession.dashboard.content.write(`📝 ${summary}`);
        break;

      case "key_points":
        // Future: Show only AI-detected important moments
        // For now, treat as "off" until we implement key point detection
        break;

      default:
        // Fallback to live transcript
        if (this.settings.showLiveTranscript) {
          this._appSession.dashboard.content.write(transcriptText);
        }
    }
  }

  // ===========================================================================
  // Override getSnapshot to include session-level state
  // ===========================================================================

  getSnapshot(): Record<string, any> {
    const snapshot = super.getSnapshot();

    // Add session-level state
    snapshot.hasGlassesConnected = this.hasGlassesConnected;
    snapshot.hasActiveSession = true; // Session exists if we're here
    snapshot.isRecording = this.transcript.isRecording;

    return snapshot;
  }
}

// Session manager instance
export const sessions = new SessionManager<NotesSession>(
  (userId) => new NotesSession(userId),
);
