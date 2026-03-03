/**
 * PhotoManager
 *
 * Captures photos from MentraOS smart glasses, uploads to R2, and
 * adds them as photo segments in the transcript.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import type { AppSession } from "@mentra/sdk";
import { uploadPhotoToR2 } from "../../services/r2Upload.service";
import { analyzeImage } from "../../services/llm/gemini";
import { TimeManager } from "./TimeManager";

// =============================================================================
// Types
// =============================================================================

export type PhotoSize = "small" | "medium" | "large";

// =============================================================================
// Manager
// =============================================================================

export class PhotoManager extends SyncedManager {
  @synced isCapturing = false;

  private timeManager: TimeManager | null = null;

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getAppSession(): AppSession | null {
    return (this._session as any)?.appSession ?? null;
  }

  private getTimeManager(): TimeManager {
    if (!this.timeManager) {
      const timezone = this.getAppSession()?.settings?.getMentraOS(
        "userTimezone",
      ) as string | undefined;
      this.timeManager = new TimeManager(timezone);
    }
    return this.timeManager;
  }

  private getTranscriptManager() {
    return (this._session as any)?.transcript ?? null;
  }

  // ===========================================================================
  // Photo Capture + Upload
  // ===========================================================================

  /**
   * Take a photo, upload to R2, analyze it, and add as a transcript segment.
   * Called from InputManager on single_tap.
   */
  async takePhoto(): Promise<void> {
    const appSession = this.getAppSession();
    if (!appSession) {
      console.warn("[PhotoManager] Cannot take photo - no glasses connected");
      return;
    }

    if (this.isCapturing) {
      console.warn("[PhotoManager] Capture already in progress, skipping");
      return;
    }

    const transcript = this.getTranscriptManager();
    const userId = this._session?.userId;
    if (!userId) return;

    this.isCapturing = true;

    try {
      const photo = await appSession.camera.requestPhoto({ size: "large" });
      console.log(`[PhotoManager] Photo captured: ${photo.filename} (${photo.size} bytes)`);

      const todayDate = this.getTimeManager().today();
      const timezone = this.getAppSession()?.settings?.getMentraOS("userTimezone") as string | undefined;

      // Signal frontend that a photo is being synced
      if (transcript) transcript.isSyncingPhoto = true;

      const result = await uploadPhotoToR2({
        userId,
        date: todayDate,
        buffer: photo.buffer,
        mimeType: photo.mimeType,
        timestamp: photo.timestamp,
        timezone,
      });

      if (result.success) {
        console.log(`[PhotoManager] Photo uploaded to R2: ${result.url}`);

        // Analyze the image for a description (non-blocking — segment is added either way)
        let description: string | undefined;
        try {
          description = await analyzeImage(photo.buffer.toString("base64"), photo.mimeType);
          console.log(`[PhotoManager] Photo description: ${description}`);
        } catch (err) {
          console.warn(`[PhotoManager] Image analysis failed, saving without description:`, err);
        }

        if (transcript) {
          transcript.addPhotoSegment(result.url!, photo.mimeType, timezone, description);
        }
      } else {
        console.error(`[PhotoManager] Photo R2 upload failed: ${result.error?.message}`);
      }

      if (transcript) transcript.isSyncingPhoto = false;
    } catch (error) {
      console.error(`[PhotoManager] Photo capture/upload error:`, error);
      if (transcript) transcript.isSyncingPhoto = false;
    } finally {
      this.isCapturing = false;
    }
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  /**
   * Capture a photo and return its base64-encoded data.
   *
   * @param size - "small" (fast), "medium" (default), "large" (high-res)
   * @returns Base64 string of the captured image, or null if capture failed
   */
  @rpc
  async capturePhoto(size: PhotoSize = "small"): Promise<string | null> {
    const appSession = this.getAppSession();
    if (!appSession) {
      console.warn("[PhotoManager] Cannot capture photo - no glasses connected");
      return null;
    }

    if (this.isCapturing) {
      console.warn("[PhotoManager] Capture already in progress, skipping");
      return null;
    }

    this.isCapturing = true;

    try {
      console.log(`[PhotoManager] Requesting photo (size: ${size})...`);

      const photo = await appSession.camera.requestPhoto({ size });
      const base64 = photo.buffer.toString("base64");

      console.log(
        `[PhotoManager] Photo captured: ${photo.filename} (${photo.size} bytes)`,
      );

      return base64;
    } catch (error) {
      console.error("[PhotoManager] Failed to capture photo:", error);
      return null;
    } finally {
      this.isCapturing = false;
    }
  }
}
