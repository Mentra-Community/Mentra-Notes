/**
 * ConversationManager
 *
 * Synced manager that exposes auto-detected conversations to the frontend.
 * Bridges between the auto-notes pipeline (ConversationTracker)
 * and the frontend's Conversations tab.
 *
 * Also orchestrates the full pipeline: Buffer → Triage → Track.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import { getAllConversations, deleteConversation, updateConversation } from "../../models/conversation.model";
import { getChunksByConversationId, getChunksByTimeRange } from "../../models/transcript-chunk.model";
import { getDailyTranscript } from "../../models";
import type { ConversationI } from "../../models/conversation.model";
import type { TranscriptChunkI } from "../../models/transcript-chunk.model";
import { TriageClassifier } from "../../classifier/TriageClassifier";
import { ConversationTracker } from "../../core/auto-conversation/ConversationTracker";
import { createProviderFromEnv, type AgentProvider } from "../../services/llm";
import type { ChunkBufferManager } from "./ChunkBufferManager";
import { TimeManager } from "./TimeManager";
import type {
  Conversation,
  ConversationChunk,
  ConversationSegment,
} from "../../../shared/types";

// =============================================================================
// Manager
// =============================================================================

export class ConversationManager extends SyncedManager {
  @synced conversations = synced<Conversation[]>([]);
  @synced activeConversationId: string | null = null;
  @synced isHydrated = false;

  // Pipeline components (not synced)
  private triageClassifier: TriageClassifier | null = null;
  private conversationTracker: ConversationTracker | null = null;
  private llmProvider: AgentProvider | null = null;
  private timeManager: TimeManager | null = null;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();

      // Load all conversations (across all days) for the homepage
      const allDbConversations = await getAllConversations(userId);
      const frontendConversations = await Promise.all(
        allDbConversations.map((c) => this.toFrontendConversation(c)),
      );
      this.conversations.set(frontendConversations);

      // Find active conversation (only today's can be active)
      const todayConversations = allDbConversations.filter((c) => c.date === today);
      const active = todayConversations.find((c) => c.status === "active");
      this.activeConversationId = active
        ? (active._id!.toString())
        : null;

      // Initialize pipeline components
      this.triageClassifier = new TriageClassifier();
      this.conversationTracker = new ConversationTracker();

      try {
        this.llmProvider = createProviderFromEnv();
      } catch (error) {
        console.warn("[ConvManager] No LLM provider for summaries:", error);
      }

      // Wire up callbacks
      this.conversationTracker.onConversationUpdate((conv, event) => {
        this.onConversationUpdate(conv, event);
      });

      this.conversationTracker.onConversationEnd((conv) => {
        // Set generatingSummary before broadcasting "ended" to prevent
        // a brief flash of "Untitled Conversation" on the frontend
        const convId = conv._id!.toString();
        conv.generatingSummary = true;
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) list[idx].generatingSummary = true;
        });
        this.onConversationUpdate(conv, "ended");
        this.generateAISummary(conv);
      });

      // Auto-end any stale active/paused conversations from before this restart
      // (they'll never get silence chunks to end naturally)
      const staleConversations = todayConversations.filter(
        (c: ConversationI) => c.status === "active" || c.status === "paused",
      );
      for (const conv of staleConversations) {
        const convId = conv._id!.toString();
        console.log(
          `[ConvManager] Auto-ending stale conversation: ${convId} (was ${conv.status})`,
        );
        await updateConversation(convId, {
          status: "ended",
          endTime: new Date(),
        });
        conv.status = "ended";
        conv.endTime = new Date();

        // Update frontend state
        const frontendConv = await this.toFrontendConversation(conv);
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) list[idx] = frontendConv;
        });

        // Generate AI summary if it has chunks
        if (conv.chunkIds.length > 0 && !conv.aiSummary) {
          this.generateAISummary(conv);
        }
      }
      this.activeConversationId = null;

      console.log(
        `[ConvManager] Hydrated: ${frontendConversations.length} conversations for ${today} (auto-ended ${staleConversations.length} stale)`,
      );
    } catch (error) {
      console.error("[ConvManager] Failed to hydrate:", error);
    } finally {
      this.isHydrated = true;
    }
  }

  async persist(): Promise<void> {
    // State is persisted to MongoDB in real-time via the pipeline components
  }

  destroy(): void {
    this.triageClassifier = null;
    this.conversationTracker = null;
  }

  // =========================================================================
  // Pipeline Wiring (called by NotesSession)
  // =========================================================================

  /**
   * Connect the ChunkBufferManager to the pipeline.
   * Called during NotesSession initialization.
   */
  wireChunkBuffer(chunkBuffer: ChunkBufferManager): void {
    chunkBuffer.onChunkReady((chunk) => {
      this.processChunk(chunk);
    });
  }

  /**
   * Process a chunk through the full pipeline: Triage → Track
   */
  private async processChunk(chunk: TranscriptChunkI): Promise<void> {
    if (!this.triageClassifier || !this.conversationTracker) {
      console.warn("[ConvManager] Pipeline not initialized");
      return;
    }

    try {
      // Stage 2: Triage
      const classification = await this.triageClassifier.classify(chunk);

      // Stage 3: Track
      await this.conversationTracker.processChunk(chunk, classification);
    } catch (error) {
      console.error(
        "[ConvManager] Pipeline error for chunk:",
        error,
      );
    }
  }

  // =========================================================================
  // Pipeline Callbacks
  // =========================================================================

  private async onConversationUpdate(
    conv: ConversationI,
    event: string,
  ): Promise<void> {
    const convId = conv._id!.toString();

    if (event === "chunk_added") {
      // For chunk updates, do a lightweight sync instead of re-fetching all chunks from DB
      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === convId);
        if (idx >= 0) {
          list[idx].runningSummary = conv.runningSummary;
          list[idx].status = conv.status;
        }
      });

      // Fire provisional title generation every 3 chunks (fire-and-forget)
      const chunkCount = conv.chunkIds.length;
      if (chunkCount > 0 && chunkCount % 3 === 0 && conv.status === "active") {
        this.generateProvisionalTitle(conv).catch(() => {});
      }
    } else if (event === "started") {
      // Set an initial title from the first few words of the summary so the UI is never blank
      const initialTitle = conv.title || (conv.runningSummary?.trim()
        ? conv.runningSummary.trim().split(/\s+/).slice(0, 5).join(" ") + "..."
        : "New Conversation");

      // New conversation — build frontend object inline (no DB query needed, conv was just created)
      const frontendConv: Conversation = {
        id: convId,
        userId: conv.userId,
        date: conv.date,
        title: initialTitle,
        status: conv.status,
        startTime: conv.startTime,
        endTime: conv.endTime,
        runningSummary: conv.runningSummary,
        aiSummary: conv.aiSummary || "",
        generatingSummary: conv.generatingSummary || false,
        noteId: conv.noteId || null,
        chunks: [],
        segments: [],
      };
      this.conversations.mutate((list) => {
        list.unshift(frontendConv);
      });

      // Persist the initial title so it's never blank in the DB
      if (!conv.title && initialTitle) {
        updateConversation(convId, { title: initialTitle }).catch(() => {});
      }
    } else {
      // For paused/resumed/ended — do the full conversion (status change, need chunks)
      const frontendConv = await this.toFrontendConversation(conv);

      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === convId);
        if (idx >= 0) {
          list[idx] = frontendConv;
        }
      });
    }

    if (event === "started" || event === "resumed") {
      this.activeConversationId = convId;
      // Generate title immediately — we already have meaningful chunks by the time a conversation starts
      if (event === "started" && conv.runningSummary?.trim()) {
        this.generateProvisionalTitle(conv).catch(() => {});
      }
    } else if (event === "ended") {
      this.activeConversationId = null;
    }
  }

  // =========================================================================
  // Provisional Title Generation (mid-conversation, every 3 chunks)
  // =========================================================================

  // Guard: prevent concurrent provisional title calls for the same conversation
  private provisionalTitleInFlight = new Set<string>();

  private async generateProvisionalTitle(conv: ConversationI): Promise<void> {
    if (!this.llmProvider) return;

    const convId = conv._id!.toString();
    if (this.provisionalTitleInFlight.has(convId)) return;

    const summary = conv.runningSummary?.trim();
    if (!summary) return;

    this.provisionalTitleInFlight.add(convId);
    try {
      const response = await this.llmProvider.chat(
        [{
          role: "user",
          content: `Generate a short title (max 5 words) for this in-progress conversation. Respond with ONLY the title, no punctuation, no quotes.\n\nConversation so far:\n${summary}`,
        }],
        { tier: "fast", maxTokens: 24, temperature: 0.3 },
      );

      const title = response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("")
        .trim()
        .replace(/^["']|["']$/g, ""); // strip any surrounding quotes

      if (!title) return;

      // Only update if conversation is still active and title actually changed
      const existing = (this.conversations as unknown as Conversation[]).find((c) => c.id === convId);
      if (!existing || existing.status !== "active" || existing.title === title) return;

      await updateConversation(convId, { title });
      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === convId);
        if (idx >= 0) list[idx].title = title;
      });

      console.log(`[ConvManager] Provisional title for ${convId}: "${title}"`);
    } catch (error) {
      console.error(`[ConvManager] Provisional title failed for ${convId}:`, error);
    } finally {
      this.provisionalTitleInFlight.delete(convId);
    }
  }

  // =========================================================================
  // AI Summary Generation
  // =========================================================================

  private async generateAISummary(conv: ConversationI): Promise<void> {
    if (!this.llmProvider) {
      console.warn("[ConvManager] No LLM provider, skipping AI summary");
      return;
    }

    const convId = conv._id!.toString();

    // Mark as generating
    await updateConversation(convId, { generatingSummary: true });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === convId);
      if (idx >= 0) list[idx].generatingSummary = true;
    });

    try {
      // Fetch ALL chunks in the conversation's time range (not just linked ones),
      // so filler/skipped segments between meaningful ones are included in the summary transcript.
      const endTime = conv.endTime ?? new Date();
      const chunks = await getChunksByTimeRange(conv.userId, conv.startTime, endTime);
      if (chunks.length === 0) {
        console.warn(`[ConvManager] No chunks for conversation ${convId}, skipping summary`);
        await updateConversation(convId, { generatingSummary: false });
        return;
      }

      const transcript = chunks
        .map((c) => {
          const time = new Date(c.startTime).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          });
          return `[${time}] ${c.text}`;
        })
        .join("\n\n");

      const prompt = `Summarize this conversation from smart glasses. Respond with EXACTLY this format:

TITLE: <max 5 words>

<2-3 sentences max. Key points and decisions only. Be extremely concise.>

Transcript:
---
${transcript}
---`;

      const response = await this.llmProvider.chat(
        [{ role: "user", content: prompt }],
        {
          tier: "fast",
          maxTokens: 512,
          temperature: 0.3,
        },
      );

      const rawText =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim() || "";

      // Parse title from "TITLE: ..." line
      let title = "";
      let aiSummary = rawText;
      const titleMatch = rawText.match(/^TITLE:\s*(.+)/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
        aiSummary = rawText.replace(/^TITLE:\s*.+\n*/m, "").trim();
      }

      if (aiSummary) {
        const updates: Record<string, any> = { aiSummary, generatingSummary: false };
        if (title) updates.title = title;

        await updateConversation(convId, updates);
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) {
            list[idx].aiSummary = aiSummary;
            list[idx].generatingSummary = false;
            if (title) list[idx].title = title;
          }
        });
        console.log(`[ConvManager] AI summary complete for ${convId}: "${title}"`);
      } else {
        await updateConversation(convId, { generatingSummary: false });
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) list[idx].generatingSummary = false;
        });
        console.warn(`[ConvManager] LLM returned empty summary for ${convId}`);
      }
    } catch (error) {
      console.error(`[ConvManager] AI summary generation failed for ${convId}:`, error);
      await updateConversation(convId, { generatingSummary: false }).catch(() => {});
      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === convId);
        if (idx >= 0) list[idx].generatingSummary = false;
      });
    }
  }

  // =========================================================================
  // Pipeline Control
  // =========================================================================

  /**
   * Immediately end any active or paused conversation and trigger AI summary.
   * Called when the user stops transcription — we treat it as a hard conversation end.
   */
  async forceEndActiveConversation(): Promise<void> {
    const activeId = this.activeConversationId;
    if (!activeId) return;

    console.log(`[ConvManager] Force-ending active conversation: ${activeId} (transcription stopped)`);

    const now = new Date();
    await updateConversation(activeId, { status: "ended", endTime: now });

    // Build a temporary conv object to extract segments before the tracker is cleared
    const tempConv = {
      startTime: undefined as Date | undefined,
      endTime: now,
      status: "ended" as const,
    };
    // Find the start time from the existing frontend conversation
    const existingConv = (this.conversations as unknown as Conversation[]).find((c) => c.id === activeId);
    if (existingConv) {
      tempConv.startTime = existingConv.startTime;
    }

    // Get transcript segments for this conversation's time range
    const segments = await this.getSegmentsForConversation(tempConv as any);

    // Update frontend state immediately — include segments so they don't disappear
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === activeId);
      if (idx >= 0) {
        list[idx].status = "ended";
        list[idx].endTime = now;
        list[idx].generatingSummary = true;
        list[idx].segments = segments;
      }
    });

    this.activeConversationId = null;

    // Reset tracker to IDLE so it doesn't fire stale callbacks
    if (this.conversationTracker) {
      this.conversationTracker.clearActiveConversation(activeId);
    }

    // Trigger AI summary generation
    const conv = await import("../../models/conversation.model").then((m) =>
      m.getConversationById(activeId)
    );
    if (conv && conv.chunkIds.length > 0) {
      this.generateAISummary(conv).catch(() => {});
    } else if (conv) {
      await updateConversation(activeId, { generatingSummary: false });
      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === activeId);
        if (idx >= 0) list[idx].generatingSummary = false;
      });
    }
  }

  // =========================================================================
  // RPC Methods
  // =========================================================================

  @rpc
  async deleteConversation(conversationId: string): Promise<void> {
    // If deleting the conversation the tracker is actively working on,
    // reset the tracker to IDLE so it doesn't keep updating a deleted record
    if (this.conversationTracker) {
      this.conversationTracker.clearActiveConversation(conversationId);
    }

    await deleteConversation(conversationId);

    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list.splice(idx, 1);
    });

    if (this.activeConversationId === conversationId) {
      this.activeConversationId = null;
    }

    console.log(`[ConvManager] Deleted conversation: ${conversationId}`);
  }

  @rpc
  async linkNoteToConversation(conversationId: string, noteId: string): Promise<void> {
    await updateConversation(conversationId, { noteId });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].noteId = noteId;
    });
  }

  /**
   * Clear noteId from any conversation that references the given note.
   * Called when a note is deleted so the "Generate Note" button reappears.
   */
  clearNoteLink(noteId: string): void {
    this.conversations.mutate((list) => {
      for (const conv of list) {
        if (conv.noteId === noteId) {
          conv.noteId = null;
          updateConversation(conv.id, { noteId: null }).catch(() => {});
        }
      }
    });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async toFrontendConversation(
    conv: ConversationI,
  ): Promise<Conversation> {
    // Load chunks for this conversation
    const dbChunks = await getChunksByConversationId(conv._id!.toString());
    const chunks: ConversationChunk[] = dbChunks.map((c) => ({
      id: c._id!.toString(),
      text: c.text,
      startTime: c.startTime,
      endTime: c.endTime,
      wordCount: c.wordCount,
    }));

    // Get transcript segments (with speaker IDs) from the conversation's time range
    const segments: ConversationSegment[] = await this.getSegmentsForConversation(conv);

    return {
      id: conv._id!.toString(),
      userId: conv.userId,
      date: conv.date,
      title: conv.title || "",
      status: conv.status,
      startTime: conv.startTime,
      endTime: conv.endTime,
      runningSummary: conv.runningSummary,
      aiSummary: conv.aiSummary || "",
      generatingSummary: conv.generatingSummary || false,
      noteId: conv.noteId || null,
      chunks,
      segments,
    };
  }

  /**
   * Pull transcript segments from TranscriptManager that fall within
   * the conversation's start→end time range. These have speaker IDs.
   *
   * For today's conversations, reads from in-memory segments.
   * For historical conversations, fetches from MongoDB, then R2.
   */
  private async getSegmentsForConversation(conv: ConversationI): Promise<ConversationSegment[]> {
    const startMs = new Date(conv.startTime).getTime();
    const endMs = conv.endTime ? new Date(conv.endTime).getTime() : Date.now();

    const filterAndMap = (
      segments: { text: string; timestamp: Date; isFinal: boolean; speakerId?: string; type?: string; id?: string }[],
    ): ConversationSegment[] =>
      segments
        .filter((s) => {
          if (!s.isFinal || s.type === "photo") return false;
          const ts = new Date(s.timestamp).getTime();
          return ts >= startMs && ts <= endMs;
        })
        .map((s, i) => ({
          id: s.id || `seg_${conv.date}_${i}`,
          text: s.text,
          timestamp: s.timestamp,
          speakerId: s.speakerId,
        }));

    // 1. Try in-memory segments (works for today's loaded date)
    const transcriptManager = (this._session as any)?.transcript;
    if (transcriptManager) {
      const loadedDate = transcriptManager.loadedDate as string | undefined;
      if (loadedDate === conv.date) {
        const allSegments = transcriptManager.segments as import("./TranscriptManager").TranscriptSegment[];
        const filtered = filterAndMap(allSegments);
        if (filtered.length > 0) return filtered;
      }
    }

    const userId = this._session?.userId;
    if (!userId || !conv.date) return [];

    try {
      // 2. Try MongoDB (segments not yet migrated to R2)
      const dailyTranscript = await getDailyTranscript(userId, conv.date);
      if (dailyTranscript?.segments?.length) {
        const filtered = filterAndMap(dailyTranscript.segments as any[]);
        if (filtered.length > 0) return filtered;
      }

      // 3. Try R2 (historical segments migrated to cloud storage)
      const r2Manager = (this._session as any)?.r2;
      if (r2Manager) {
        const r2Data = await r2Manager.fetchTranscript(conv.date);
        if (r2Data?.segments?.length) {
          const mapped = r2Data.segments.map((seg: any, idx: number) => ({
            id: `seg_${seg.index || idx + 1}`,
            text: seg.text,
            timestamp: new Date(seg.timestamp),
            isFinal: seg.isFinal,
            speakerId: seg.speakerId,
            type: seg.type,
          }));
          return filterAndMap(mapped);
        }
      }
    } catch (error) {
      console.error("[ConversationManager] Failed to load historical segments:", error);
    }

    return [];
  }

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
