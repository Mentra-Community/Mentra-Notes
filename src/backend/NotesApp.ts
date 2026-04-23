/**
 * NotesApp - All-day transcription and AI-powered note generation
 *
 * Main application class that extends MentraOS AppServer.
 * Manages user sessions and routes events to the appropriate managers.
 *
 * Architecture:
 * - NotesApp handles MentraOS lifecycle (onSession, onStop)
 * - Each user gets a NotesSession that contains all managers
 * - Managers handle specific responsibilities (transcripts, notes, settings)
 */

import { AppServer, AppSession } from "@mentra/sdk";
import { sessions, NotesSession } from "./session";
import { TimeManager } from "./session/managers/TimeManager";
import { connectDB, disconnectDB } from "./services/db";


export interface NotesAppConfig {
  packageName: string;
  apiKey: string;
  port: number;
  cookieSecret?: string;
}

/**
 * NotesApp - All-day transcription and note generation
 *
 * Handles glasses connections and manages transcription
 * for users who want to capture and organize their day.
 */
export class NotesApp extends AppServer {
  constructor(config: NotesAppConfig) {
    super({
      packageName: config.packageName,
      apiKey: config.apiKey,
      port: config.port,
      cookieSecret: config.cookieSecret,
    });

    // Connect to MongoDB on startup
    this.initDatabase();
  }

  /**
   * Initialize database connection
   */
  private async initDatabase(): Promise<void> {
    try {
      await connectDB();
    } catch (error) {
      console.error("[NotesApp] Failed to connect to database:", error);
      // Continue without DB - app will work with in-memory storage
    }
  }

  /**
   * Called when a user connects their glasses to Notes
   */
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string,
  ): Promise<void> {
    console.log(`\n📝 Notes session started for ${userId}`);

    // Get user's timezone from MentraOS settings (if set)
    const timezone = session.settings.getMentraOS<string>('userTimezone');
    // Initialize TimeManager with user's timezone
    const timeManager = new TimeManager(timezone);
    // Get or create NotesSession for this user (may already exist from webview)
    const notesSession = await sessions.getOrCreate(userId);
    // Set the AppSession (glasses are now connected) — wires DisplayManager
    notesSession.setAppSession(session);
    notesSession.display.showStatus("| Notes Running");

    // Log device capabilities
    const caps = session.capabilities;
    if (caps) {
      console.log(`   Device: ${caps.modelName}`);
      console.log(`   Microphone: ${caps.hasMicrophone ? "✅" : "❌"}`);
      console.log(`   Display: ${caps.hasDisplay ? "✅" : "❌"}`);
    }

    // Subscribe to transcription events
    session.events.onTranscription(async (data) => {
      // Route to NotesSession for processing
      notesSession.onTranscription(data.text, data.isFinal, data.speakerId);

      if (data.isFinal) {
        console.log(
          `Today's date: ${timeManager.today()} | EOD: ${timeManager.endOfDay()} | UTC: ${timeManager.now()}`,
        );
        // Check and run batch if day has passed
        await notesSession.r2.checkAndRunBatch();
      }
    });

    console.log(`✅ Notes ready for ${userId}\n`);
  }

  /**
   * Called when a user disconnects from Notes
   */
  protected async onStop(
    sessionId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    console.log(`👋 Notes session ended for ${userId}: ${reason}`);

    // Remove session so next connect triggers a fresh hydrate()
    await sessions.remove(userId);
  }

  /**
   * Graceful shutdown - disconnect from database
   */
  async shutdown(): Promise<void> {
    console.log("[NotesApp] Shutting down...");

    // Clean up all user sessions
    for (const userId of sessions.getActiveUserIds()) {
      await sessions.remove(userId);
    }

    // Disconnect from database
    await disconnectDB();

    console.log("[NotesApp] Shutdown complete");
  }

  /**
   * Get a NotesSession by userId (for API routes)
   */
  getSession(userId: string): NotesSession | undefined {
    return sessions.get(userId);
  }

  /**
   * Get all active user IDs
   */
  getActiveUserIds(): string[] {
    return sessions.getActiveUserIds();
  }

  /**
   * Get count of active sessions
   */
  getActiveSessionCount(): number {
    return sessions.getActiveUserIds().length;
  }
}
