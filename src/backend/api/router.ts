/**
 * Notes App API Router
 *
 * Simplified API for the Notes app - focuses on transcripts, notes, and settings.
 * Most real-time state is handled via WebSocket sync, but these endpoints
 * provide REST access for specific operations.
 */

import { Hono } from "hono";
import { createAuthMiddleware } from "@mentra/sdk";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { sessions } from "../session";
import {
  getOrCreateDailyTranscript,
  getDailyTranscript,
  Note as NoteModel,
  UserSettings,
  File as FileModel,
  getFiles,
  updateFile,
} from "../models";
import { rewriteR2Urls } from "../../shared/constants";

// Environment
const API_KEY = process.env.MENTRAOS_API_KEY || "";
const PACKAGE_NAME = process.env.PACKAGE_NAME || "";
const COOKIE_SECRET = process.env.COOKIE_SECRET || API_KEY;

export const api = new Hono();

// =============================================================================
// Auth Middleware
// =============================================================================

const authMiddleware = createAuthMiddleware({
  apiKey: API_KEY,
  packageName: PACKAGE_NAME,
  cookieSecret: COOKIE_SECRET,
});

/**
 * Get userId from auth context
 */
function getUserId(c: any): string | null {
  return c.get("userId") || null;
}

/**
 * Require auth - returns userId or throws
 */
function requireAuth(c: any): string {
  const userId = getUserId(c);
  if (!userId) {
    throw { error: "Unauthorized", status: 401 };
  }
  return userId;
}

/**
 * Require session - returns session or throws
 */
function requireSession(c: any) {
  const userId = requireAuth(c);

  const session = sessions.get(userId);
  if (!session) {
    throw { error: "No active session", status: 404 };
  }

  return { userId, session };
}

/** Derive base URL from the incoming request headers */
function getBaseUrl(c: any): string {
  const origin = c.req.header("origin");
  if (origin) return origin;

  const host = c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;

  return process.env.BASE_URL || "https://localhost:3000";
}

/** Strip dangerous HTML patterns from email content */
function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<input[^>]*\/?>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "");
}

// =============================================================================
// Health Check
// =============================================================================

api.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    activeSessions: sessions.getActiveUserIds().length,
  });
});

// =============================================================================
// Auto-Notes Pipeline Test (DEV ONLY)
// =============================================================================

/**
 * Simulate transcript input to test the auto-notes pipeline.
 * Injects fake transcript segments into a user's session as if glasses were speaking.
 *
 * Usage:
 *   # Single segment:
 *   curl -X POST http://localhost:3000/api/test/simulate-transcript \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId":"test@example.com","text":"We need to move the deadline to next Friday and notify all stakeholders."}'
 *
 *   # Full conversation (multiple segments injected rapidly):
 *   curl -X POST http://localhost:3000/api/test/simulate-conversation \
 *     -H "Content-Type: application/json" \
 *     -d '{"userId":"test@example.com"}'
 */
api.post("/test/simulate-transcript", async (c) => {
  const { userId, text } = await c.req.json();
  if (!userId || !text) {
    return c.json({ error: "userId and text required" }, 400);
  }

  const session = sessions.get(userId);
  if (!session) {
    return c.json({ error: `No active session for ${userId}. Connect via WebSocket first.` }, 404);
  }

  // Simulate a final transcript segment
  session.onTranscription(text, true);

  return c.json({
    success: true,
    message: `Injected segment into ${userId}'s session`,
    chunkBufferRunning: session.chunkBuffer.isRunning,
  });
});

api.post("/test/simulate-conversation", async (c) => {
  const { userId } = await c.req.json();
  if (!userId) {
    return c.json({ error: "userId required" }, 400);
  }

  const session = sessions.get(userId);
  if (!session) {
    return c.json({ error: `No active session for ${userId}. Connect via WebSocket first.` }, 404);
  }

  // A realistic multi-turn conversation about a project deadline
  const segments = [
    "So I wanted to talk about the Q2 launch timeline. We're currently targeting March 28th for the beta release.",
    "Right, but the design team just told me they need another week on the onboarding flow. The current mockups aren't tested yet.",
    "That's a problem. If we push the beta by a week, that puts us right up against the investor demo on April 8th.",
    "What if we launch the beta without the new onboarding? We can use the existing flow and swap it out in a patch.",
    "I think that works. Let's do it. Sarah can keep working on onboarding in parallel, and we'll ship it as a day-one patch.",
    "Agreed. So the plan is: beta on March 28th with existing onboarding, new onboarding patch by April 3rd, investor demo April 8th.",
    "Perfect. I'll update the project board and send a Slack summary to the team. Can you loop in Sarah on the timeline change?",
    "Will do. I'll set up a quick sync with her this afternoon. Anything else?",
    "No, that's it. Good meeting. Let's regroup on Friday to check progress.",
  ];

  // Inject all segments quickly — the 40-second buffer will batch them into a chunk
  for (const text of segments) {
    session.onTranscription(text, true);
  }

  return c.json({
    success: true,
    message: `Injected ${segments.length} segments into ${userId}'s session. The chunk buffer will emit a chunk in ~40 seconds.`,
    chunkBufferRunning: session.chunkBuffer.isRunning,
    tip: "Watch the server logs for [ChunkBufferManager], [TriageClassifier], [ConversationTracker], and [NoteGenerator] output.",
  });
});

// =============================================================================
// Auth Status
// =============================================================================

api.get("/auth/status", authMiddleware, (c) => {
  const userId = getUserId(c);
  return c.json({
    authenticated: !!userId,
    userId: userId || null,
  });
});

// =============================================================================
// Transcript Endpoints
// =============================================================================

/**
 * GET /transcripts/today - Get today's transcript
 */
api.get("/transcripts/today", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const session = sessions.get(userId);

    // Get today's date in local format
    const now = new Date();
    const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Prefer session data if available
    if (session) {
      const segments = session.transcript.segments;
      return c.json({
        date: todayDate,
        segments: segments.map((s: any) => ({
          id: s.id,
          text: s.text,
          timestamp: s.timestamp,
          isFinal: s.isFinal,
          speakerId: s.speakerId,
        })),
        count: segments.length,
      });
    }

    // Fallback to DB
    const transcript = await getOrCreateDailyTranscript(userId, todayDate);
    return c.json({
      date: todayDate,
      segments: transcript.segments || [],
      count: transcript.segments?.length || 0,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * GET /transcripts/:date - Get transcript for a specific date
 */
api.get("/transcripts/:date", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const date = c.req.param("date");

    const transcript = await getOrCreateDailyTranscript(userId, date);
    return c.json({
      date,
      segments: transcript.segments || [],
      count: transcript.segments?.length || 0,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * DELETE /transcripts/today - Clear today's transcript
 */
api.delete("/transcripts/today", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);

    await session.transcript.clear();

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

// =============================================================================
// Notes Endpoints
// =============================================================================

/**
 * GET /notes - Get all notes
 */
api.get("/notes", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const session = sessions.get(userId);

    // Prefer session data
    if (session) {
      return c.json({
        notes: session.notes.notes.map((n: any) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          summary: n.summary,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          transcriptRange: n.transcriptRange,
        })),
        count: session.notes.notes.length,
      });
    }

    // Fallback to DB
    const notes = await NoteModel.find({ userId }).sort({ createdAt: -1 });
    return c.json({
      notes: notes.map((n: any) => ({
        id: n._id.toString(),
        title: n.title,
        content: n.content,
        summary: n.summary,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
      count: notes.length,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * GET /notes/:id - Get a specific note
 */
api.get("/notes/:id", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const noteId = c.req.param("id");
    const session = sessions.get(userId);

    // Check session first
    if (session) {
      const note = session.notes.notes.find((n: any) => n.id === noteId);
      if (note) {
        return c.json({
          id: note.id,
          title: note.title,
          content: note.content,
          summary: note.summary,
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
          transcriptRange: note.transcriptRange,
        });
      }
    }

    // Fallback to DB
    const note = await NoteModel.findOne({ _id: noteId, userId });
    if (!note) {
      return c.json({ error: "Note not found" }, 404);
    }

    return c.json({
      id: note._id.toString(),
      title: note.title,
      content: note.content,
      summary: note.summary,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * POST /notes/generate - Generate a note from transcript
 */
api.post("/notes/generate", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);

    const body = await c.req.json().catch(() => ({}));
    const { title, startTime, endTime } = body;

    const note = await session.notes.generateNote(
      title,
      startTime ? new Date(startTime) : undefined,
      endTime ? new Date(endTime) : undefined,
    );

    return c.json({
      id: note.id,
      title: note.title,
      content: note.content,
      summary: note.summary,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      transcriptRange: note.transcriptRange,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * POST /notes - Create a manual note
 */
api.post("/notes", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);

    const body = await c.req.json();
    const { title, content } = body;

    if (!title || !content) {
      return c.json({ error: "title and content required" }, 400);
    }

    const note = await session.notes.createManualNote(title, content);

    return c.json({
      id: note.id,
      title: note.title,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * PUT /notes/:id - Update a note
 */
api.put("/notes/:id", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);
    const noteId = c.req.param("id");

    const body = await c.req.json();
    const { title, content, summary } = body;

    const note = await session.notes.updateNote(noteId, {
      title,
      content,
      summary,
    });

    return c.json({
      id: note.id,
      title: note.title,
      content: note.content,
      summary: note.summary,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * DELETE /notes/:id - Delete a note
 */
api.delete("/notes/:id", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);
    const noteId = c.req.param("id");

    await session.notes.deleteNote(noteId);

    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

// =============================================================================
// Settings Endpoints
// =============================================================================

/**
 * GET /settings - Get user settings
 */
api.get("/settings", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const session = sessions.get(userId);

    const defaultSettings = {
      showLiveTranscript: true,
      displayName: null,
    };

    // Prefer session data
    if (session) {
      return c.json({
        showLiveTranscript: session.settings.showLiveTranscript,
        displayName: session.settings.displayName,
      });
    }

    // Fallback to DB
    const dbSettings = await UserSettings.findOne({ userId });
    if (dbSettings) {
      return c.json({
        showLiveTranscript:
          dbSettings.showLiveTranscript ?? defaultSettings.showLiveTranscript,
        displayName: dbSettings.displayName ?? defaultSettings.displayName,
      });
    }

    return c.json(defaultSettings);
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * PUT /settings - Update user settings
 */
api.put("/settings", authMiddleware, async (c) => {
  try {
    const { session } = requireSession(c);

    const body = await c.req.json();
    const { showLiveTranscript, displayName } = body;

    await session.settings.updateSettings({
      showLiveTranscript,
      displayName,
    });

    return c.json({
      success: true,
      settings: {
        showLiveTranscript: session.settings.showLiveTranscript,
        displayName: session.settings.displayName,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

// =============================================================================
// File Endpoints (Flags: archived, trashed, favourite)
// =============================================================================

/**
 * GET /files - Get all files for a user (with optional filters)
 */
api.get("/files", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);

    // Parse query params for filters
    const isArchived = c.req.query("isArchived");
    const isTrashed = c.req.query("isTrashed");
    const isFavourite = c.req.query("isFavourite");

    const filter: {
      isArchived?: boolean;
      isTrashed?: boolean;
      isFavourite?: boolean;
    } = {};

    if (isArchived !== undefined) {
      filter.isArchived = isArchived === "true";
    }
    if (isTrashed !== undefined) {
      filter.isTrashed = isTrashed === "true";
    }
    if (isFavourite !== undefined) {
      filter.isFavourite = isFavourite === "true";
    }

    const files = await getFiles(userId, filter);

    return c.json({
      files: files.map((f) => ({
        id: f._id.toString(),
        date: f.date,
        noteCount: f.noteCount,
        transcriptSegmentCount: f.transcriptSegmentCount,
        hasTranscript: f.hasTranscript,
        hasNotes: f.hasNotes,
        isArchived: f.isArchived,
        isTrashed: f.isTrashed,
        isFavourite: f.isFavourite,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      })),
      count: files.length,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * GET /files/:date - Get a specific file by date
 */
api.get("/files/:date", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const date = c.req.param("date");

    const file = await FileModel.findOne({ userId, date });

    if (!file) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json({
      id: file._id.toString(),
      date: file.date,
      noteCount: file.noteCount,
      transcriptSegmentCount: file.transcriptSegmentCount,
      hasTranscript: file.hasTranscript,
      hasNotes: file.hasNotes,
      isArchived: file.isArchived,
      isTrashed: file.isTrashed,
      isFavourite: file.isFavourite,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

/**
 * PATCH /files/:date - Update file flags (archived, trashed, favourite)
 */
api.patch("/files/:date", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const date = c.req.param("date");

    const body = await c.req.json();
    const { isArchived, isTrashed, isFavourite } = body;

    // Build updates object with only provided fields
    const updates: {
      isArchived?: boolean;
      isTrashed?: boolean;
      isFavourite?: boolean;
    } = {};

    if (isArchived !== undefined) {
      updates.isArchived = isArchived;
    }
    if (isTrashed !== undefined) {
      updates.isTrashed = isTrashed;
    }
    if (isFavourite !== undefined) {
      updates.isFavourite = isFavourite;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    const file = await updateFile(userId, date, updates);

    if (!file) {
      return c.json({ error: "File not found" }, 404);
    }

    return c.json({
      success: true,
      file: {
        id: file._id.toString(),
        date: file.date,
        isArchived: file.isArchived,
        isTrashed: file.isTrashed,
        isFavourite: file.isFavourite,
        updatedAt: file.updatedAt,
      },
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

// =============================================================================
// Session Status
// =============================================================================

/**
 * GET /session/status - Get current session status
 */
api.get("/session/status", authMiddleware, (c) => {
  try {
    const userId = requireAuth(c);
    const session = sessions.get(userId);

    if (!session) {
      return c.json({
        hasSession: false,
        isConnected: false,
        hasGlassesConnected: false,
        isRecording: false,
        transcriptCount: 0,
        notesCount: 0,
      });
    }

    return c.json({
      hasSession: true,
      isConnected: true,
      hasGlassesConnected: session.hasGlassesConnected,
      isRecording: session.transcript.isRecording,
      transcriptCount: session.transcript.segments.length,
      notesCount: session.notes.notes.length,
    });
  } catch (err: any) {
    return c.json({ error: err.error || "Internal error" }, err.status || 500);
  }
});

// =============================================================================
// Photo Proxy (serves R2 images to the browser)
// =============================================================================

/**
 * GET /photos/:date/:filename - Proxy photo from R2
 * The browser can't access R2 directly (requires auth), so we stream it through.
 */
api.get("/photos/:date/:filename", authMiddleware, async (c) => {
  try {
    const userId = requireAuth(c);
    const date = c.req.param("date");
    const filename = c.req.param("filename");

    const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
    const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      return c.json({ error: "R2 not configured" }, 500);
    }

    const key = `transcripts/${userId}/${date}/photos/${filename}`;

    const s3Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });

    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: bucketName, Key: key }),
    );

    if (!response.Body) {
      return c.json({ error: "Photo not found" }, 404);
    }

    const contentType = response.ContentType || "image/png";
    const bodyBytes = await response.Body.transformToByteArray();

    return new Response(bodyBytes, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err: any) {
    if (err.name === "NoSuchKey") {
      return c.json({ error: "Photo not found" }, 404);
    }
    console.error("[Photo Proxy] Error:", err);
    return c.json({ error: "Failed to fetch photo" }, 500);
  }
});

// =============================================================================
// Email Endpoints
// =============================================================================

/**
 * POST /email/send - Send notes email (supports multiple notes in one email)
 */
api.post("/email/send", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { to, cc, sessionDate, sessionStartTime, sessionEndTime, notes } = body;

    if (!to) {
      return c.json({ error: "\"to\" email address is required" }, 400);
    }
    if (!Array.isArray(notes) || notes.length === 0) {
      return c.json({ error: "notes array is required and must not be empty" }, 400);
    }

    // Validate each note item
    for (const note of notes) {
      if (!note.noteId || typeof note.noteContent !== "string") {
        return c.json({ error: "Each note must have noteId and noteContent" }, 400);
      }
    }

    // Sanitize note content for email
    const sanitizedNotes = notes.map((note: any) => ({
      ...note,
      noteTitle: sanitizeEmailHtml(note.noteTitle),
      noteContent: sanitizeEmailHtml(note.noteContent),
    }));

    const { sendNotesEmail } = await import("../services/resend.service");
    const baseUrl = getBaseUrl(c);
    const result = await sendNotesEmail({
      to,
      cc: cc || undefined,
      sessionDate: sessionDate || "Unknown Date",
      sessionStartTime: sessionStartTime || "",
      sessionEndTime: sessionEndTime || "",
      notes: sanitizedNotes,
      baseUrl,
    });

    return c.json({ success: true, data: result });
  } catch (err: any) {
    console.error("[Email Send] Error:", err);
    return c.json({ error: "Failed to send email" }, 500);
  }
});

// =============================================================================
// Note Download Endpoints (linked from emails)
// =============================================================================

/**
 * GET /notes/:id/download/:format - Download a note as TXT, PDF, or DOCX
 */
api.get("/notes/:id/download/:format", async (c) => {
  try {
    const noteId = c.req.param("id");
    const format = c.req.param("format");
    const token = c.req.query("token");

    // Verify signed token
    const { verifyDownloadToken } = await import("../services/signedUrl.service");
    if (!token || !verifyDownloadToken(noteId, token)) {
      return c.json({ error: "Invalid or expired download link" }, 403);
    }

    if (!["txt", "pdf", "docx"].includes(format)) {
      return c.json({ error: "Invalid format. Use txt, pdf, or docx" }, 400);
    }

    // Try session first, then DB
    let noteData: { title: string; content: string; date?: string; isAIGenerated?: boolean; createdAt?: Date } | null = null;

    for (const uid of sessions.getActiveUserIds()) {
      const session = sessions.get(uid);
      if (!session) continue;
      const found = session.notes.notes.find((n: any) => n.id === noteId);
      if (found) {
        noteData = found;
        break;
      }
    }

    if (!noteData) {
      const dbNote = await NoteModel.findById(noteId);
      if (dbNote) {
        noteData = {
          title: dbNote.title,
          content: dbNote.content,
          date: dbNote.date,
          isAIGenerated: dbNote.isAIGenerated,
          createdAt: dbNote.createdAt as Date,
        };
      }
    }

    if (!noteData) {
      return c.json({ error: "Note not found" }, 404);
    }

    const { generateTxt, generatePdf, generateDocx } = await import("../services/noteExport.service");

    const noteDate = noteData.date
      ? new Date(noteData.date + "T00:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
      : undefined;
    const noteTimestamp = noteData.createdAt
      ? new Date(noteData.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
      : undefined;
    const noteType = noteData.isAIGenerated ? "AI Generated" : "Manual";

    // Rewrite private R2 URLs to public URLs so images can be fetched
    const publicContent = rewriteR2Urls(noteData.content);

    const exportData = {
      title: noteData.title,
      content: publicContent,
      sessionDate: noteDate,
      noteType,
      noteTimestamp,
    };

    const safeTitle = noteData.title.replace(/[^a-zA-Z0-9-_ ]/g, "").substring(0, 50).trim() || "note";

    if (format === "txt") {
      const buffer = generateTxt(exportData);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${safeTitle}.txt"`,
        },
      });
    }

    if (format === "pdf") {
      const pdfBytes = await generatePdf(exportData);
      return new Response(new Uint8Array(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeTitle}.pdf"`,
        },
      });
    }

    if (format === "docx") {
      const docxBuffer = await generateDocx(exportData);
      return new Response(new Uint8Array(docxBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${safeTitle}.docx"`,
        },
      });
    }

    return c.json({ error: "Invalid format" }, 400);
  } catch (err: any) {
    console.error("[Note Download] Error:", err);
    return c.json({ error: "Failed to generate download" }, 500);
  }
});

// =============================================================================
// Transcript Email & Download Endpoints
// =============================================================================

/**
 * POST /transcript/email - Send transcript via email
 */
api.post("/transcript/email", authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { to, cc, userId, date, sessionDate, sessionStartTime, sessionEndTime, segments } = body;

    if (!to) {
      return c.json({ error: '"to" email address is required' }, 400);
    }
    if (!userId || !date) {
      return c.json({ error: "userId and date are required" }, 400);
    }
    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      return c.json({ error: "segments array is required" }, 400);
    }

    // Validate each segment
    for (const seg of segments) {
      if (typeof seg.timestamp !== "string" || typeof seg.text !== "string") {
        return c.json({ error: "Each segment must have timestamp and text strings" }, 400);
      }
    }

    const { sendTranscriptEmail } = await import("../services/resend.service");
    const transcriptId = `${userId}:${date}`;
    const baseUrl = getBaseUrl(c);

    const result = await sendTranscriptEmail({
      to,
      cc: cc || undefined,
      transcriptId,
      sessionDate: sessionDate || date,
      sessionStartTime: sessionStartTime || "",
      sessionEndTime: sessionEndTime || "",
      segments,
      baseUrl,
    });

    return c.json({ success: true, data: result });
  } catch (err: any) {
    console.error("[Transcript Email] Error:", err);
    return c.json({ error: "Failed to send email" }, 500);
  }
});

/**
 * GET /transcripts/:transcriptId/download/:format - Download transcript as TXT, PDF, or DOCX
 * transcriptId format: userId:YYYY-MM-DD
 */
api.get("/transcripts/:transcriptId/download/:format", async (c) => {
  try {
    const transcriptId = c.req.param("transcriptId");
    const format = c.req.param("format");
    const token = c.req.query("token");

    // Verify signed token
    const { verifyDownloadToken } = await import("../services/signedUrl.service");
    if (!token || !verifyDownloadToken(transcriptId, token)) {
      return c.json({ error: "Invalid or expired download link" }, 403);
    }

    if (!["txt", "pdf", "docx"].includes(format)) {
      return c.json({ error: "Invalid format. Use txt, pdf, or docx" }, 400);
    }

    // Parse composite ID
    const colonIdx = transcriptId.indexOf(":");
    if (colonIdx === -1) {
      return c.json({ error: "Invalid transcript ID" }, 400);
    }
    const userId = transcriptId.substring(0, colonIdx);
    const date = transcriptId.substring(colonIdx + 1);

    // Try 3 sources: in-memory session → MongoDB → R2
    let segments: { text: string; timestamp: Date; isFinal: boolean; type?: string }[] = [];

    // 1. In-memory session (today's live transcript)
    const session = sessions.get(userId);
    if (session) {
      const liveSegs = session.transcript.segments || [];
      const dateSegs = liveSegs.filter((s: any) => {
        if (!s.timestamp) return false;
        const iso = s.timestamp instanceof Date ? s.timestamp.toISOString() : String(s.timestamp);
        return iso.slice(0, 10) === date;
      });
      if (dateSegs.length > 0) {
        segments = dateSegs.filter((s: any) => s.isFinal && s.type !== "photo");
      }
    }

    // 2. MongoDB
    if (segments.length === 0) {
      const transcript = await getDailyTranscript(userId, date);
      const dbSegs = (transcript?.segments || []).filter(
        (s) => s.isFinal && s.type !== "photo"
      );
      if (dbSegs.length > 0) {
        segments = dbSegs;
      }
    }

    // 3. R2 (historical transcripts)
    if (segments.length === 0) {
      const { fetchTranscriptFromR2 } = await import("../services/r2Fetch.service");
      const r2Result = await fetchTranscriptFromR2({ userId, date });
      if (r2Result.success && r2Result.data?.segments) {
        segments = r2Result.data.segments
          .filter((s) => s.isFinal && s.type !== "photo")
          .map((s) => ({
            text: s.text,
            timestamp: new Date(s.timestamp),
            isFinal: s.isFinal,
            type: s.type,
          }));
      }
    }

    if (segments.length === 0) {
      return c.json({ error: "No transcript segments found" }, 404);
    }

    // Format segments for export
    const formattedSegments = segments.map((s) => ({
      timestamp: new Date(s.timestamp).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
      text: s.text,
    }));

    const sessionDate = new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const firstTime = new Date(segments[0].timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const lastTime = new Date(segments[segments.length - 1].timestamp).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const sessionTimeRange = `${firstTime} \u2014 ${lastTime}`;

    const exportData = {
      sessionDate,
      sessionTimeRange,
      segments: formattedSegments,
    };

    const safeDate = date.replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `Transcript-${safeDate}`;

    const {
      generateTranscriptTxt,
      generateTranscriptPdf,
      generateTranscriptDocx,
    } = await import("../services/transcriptExport.service");

    if (format === "txt") {
      const buffer = generateTranscriptTxt(exportData);
      return new Response(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.txt"`,
        },
      });
    }

    if (format === "pdf") {
      const pdfBytes = await generateTranscriptPdf(exportData);
      return new Response(new Uint8Array(pdfBytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}.pdf"`,
        },
      });
    }

    if (format === "docx") {
      const docxBuffer = await generateTranscriptDocx(exportData);
      return new Response(new Uint8Array(docxBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}.docx"`,
        },
      });
    }

    return c.json({ error: "Invalid format" }, 400);
  } catch (err: any) {
    console.error("[Transcript Download] Error:", err);
    return c.json({ error: "Failed to generate download" }, 500);
  }
});

// =============================================================================
// Catch-all for unknown routes
// =============================================================================

api.all("*", (c) => {
  return c.json(
    {
      error: "Not Found",
      path: c.req.path,
      method: c.req.method,
    },
    404,
  );
});
