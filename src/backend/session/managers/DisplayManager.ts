import type { AppSession } from "@mentra/sdk";
import { SyncedManager } from "../../../lib/sync";
import type { SettingsManager } from "./SettingsManager";
import type { SummaryManager } from "./SummaryManager";

/**
 * DisplayManager — owns all writes to the glasses display.
 *
 * Holds the AppSession reference and renders based on the user's
 * `glassesDisplayMode` setting. Other managers/session code should
 * route all dashboard writes through here instead of touching
 * `appSession.dashboard.content` directly.
 */
export class DisplayManager extends SyncedManager {
  private _appSession: AppSession | null = null;

  /** Called from NotesSession.setAppSession when glasses connect. */
  setup(appSession: AppSession): void {
    this._appSession = appSession;
  }

  /** Called from NotesSession.clearAppSession when glasses disconnect. */
  clear(): void {
    this._appSession = null;
  }

  /** One-off status line (e.g. "Notes Running", "Notes - Recording"). */
  showStatus(text: string): void {
    if (!this._appSession) return;
    this._appSession.dashboard.content.write(text);
  }

  /** Render a transcript segment according to the current display mode. */
  showTranscript(transcriptText: string): void {
    if (!this._appSession) return;

    const settings = (this._session as any).settings as SettingsManager;
    const summary = (this._session as any).summary as SummaryManager;
    const mode = settings.glassesDisplayMode;

    switch (mode) {
      case "off":
        break;

      case "live_transcript":
        if (settings.showLiveTranscript) {
          this._appSession.dashboard.content.write(transcriptText);
        }
        break;

      case "hour_summary": {
        const hourSummary = summary.getCurrentHourSummary();
        this._appSession.dashboard.content.write(`📝 ${hourSummary}`);
        break;
      }

      case "key_points":
        // Future: show only AI-detected important moments.
        break;

      default:
        if (settings.showLiveTranscript) {
          this._appSession.dashboard.content.write(transcriptText);
        }
    }
  }
}
