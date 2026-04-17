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
import { getAllConversations, deleteConversation, updateConversation, createConversation } from "../../models/conversation.model";
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
  // Monotonic counter + message pair; frontend watches counter to trigger a toast.
  @synced lastAutoNoteErrorSeq = 0;
  @synced lastAutoNoteErrorMessage: string | null = null;

  // Pipeline components (not synced)
  private triageClassifier: TriageClassifier | null = null;
  private conversationTracker: ConversationTracker | null = null;
  private llmProvider: AgentProvider | null = null;
  private timeManager: TimeManager | null = null;
  private segmentCache = new Map<string, any[]>(); // Cache R2 segments by date

  // =========================================================================
  // Lifecycle
  // =========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();

      // Load all conversations (across all days) for the homepage
      // Skip segments during hydration — they're loaded on-demand when viewing detail
      const allDbConversations = await getAllConversations(userId);
      const frontendConversations = await Promise.all(
        allDbConversations.map((c) => this.toFrontendConversation(c, { skipSegments: true })),
      );

      // Clear stuck generatingSummary flags and retry missing summaries
      const needsSummary: ConversationI[] = [];
      for (const conv of frontendConversations) {
        if (conv.generatingSummary && conv.status === "ended") {
          conv.generatingSummary = false;
          updateConversation(conv.id, { generatingSummary: false }).catch(() => {});
        }
        // Collect ended conversations with chunks but no summary for retry
        if (conv.status === "ended" && !conv.aiSummary && conv.chunks.length > 0) {
          const dbConv = allDbConversations.find((c) => c._id?.toString() === conv.id);
          if (dbConv) needsSummary.push(dbConv);
        }
      }

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
        // Summary first (for a sensible title), then auto-generate the note.
        this.generateAISummary(conv)
          .then(() => this.autoGenerateNoteForConversation(convId))
          .catch(() => {});
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

      // Retry AI summaries for conversations that failed previously (non-blocking)
      if (needsSummary.length > 0) {
        console.log(`[ConvManager] Retrying AI summary for ${needsSummary.length} conversations`);
        for (const conv of needsSummary) {
          this.generateAISummary(conv).catch(() => {});
        }
      }
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
    this.segmentCache.clear();
    this.provisionalTitleInFlight.clear();
    this.llmProvider = null;
    this.timeManager = null;
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
        isFavourite: false,
        isArchived: false,
        isTrashed: false,
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
      const convId = conv._id!.toString();
      await updateConversation(convId, { generatingSummary: false }).catch(() => {});
      this.conversations.mutate((list) => {
        const idx = list.findIndex((c) => c.id === convId);
        if (idx >= 0) list[idx].generatingSummary = false;
      });
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
      // For merged conversations (many chunkIds spanning multiple time ranges),
      // use chunkIds directly. For normal conversations, use time range to include filler chunks.
      let chunks: TranscriptChunkI[];
      if (conv.chunkIds.length > 0) {
        const { TranscriptChunk } = await import("../../models/transcript-chunk.model");
        chunks = await TranscriptChunk.find({ _id: { $in: conv.chunkIds } }).sort({ startTime: 1 });
      } else {
        const endTime = conv.endTime ?? new Date();
        chunks = await getChunksByTimeRange(conv.userId, conv.startTime, endTime);
      }
      if (chunks.length === 0) {
        console.warn(`[ConvManager] No chunks for conversation ${convId}, skipping summary`);
        await updateConversation(convId, { generatingSummary: false });
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) list[idx].generatingSummary = false;
        });
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

      const isMerged = conv.chunkIds.length > 0 && chunks.length > 5;
      const mergeNote = isMerged
        ? "\nNote: This is a merged conversation combining multiple discussions. The title should capture the overall theme across all topics discussed, not just one subtopic.\n"
        : "";

      const prompt = `Summarize this conversation. Respond with EXACTLY this format:

TITLE: <max 5 words>

<2-3 sentences max. Key points and decisions only. Be extremely concise.>
${mergeNote}
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
  // Auto-Note Generation (runs after AI summary on conversation end)
  // =========================================================================

  private async autoGenerateNoteForConversation(convId: string): Promise<void> {
    try {
      // Re-read the conversation so we have the final title from summary + any
      // state mutations that happened while the summary was running.
      const { getConversationById } = await import("../../models/conversation.model");
      const conv = await getConversationById(convId);
      if (!conv) return;

      // Guard: if the conversation already has a note, don't double-generate.
      if (conv.noteId) return;

      // Guard: no chunks = nothing to generate from.
      if (!conv.chunkIds || conv.chunkIds.length === 0) return;

      // Minimum transcript length guard — avoid garbage notes from trivial conversations.
      const { TranscriptChunk } = await import("../../models/transcript-chunk.model");
      const chunks = await TranscriptChunk.find({ _id: { $in: conv.chunkIds } });
      const totalWords = chunks.reduce((sum, c) => sum + (c.wordCount ?? 0), 0);
      if (totalWords < 50) {
        console.log(`[ConvManager] Skipping auto-note for ${convId}: only ${totalWords} words`);
        return;
      }

      const notesManager = (this._session as any)?.notes;
      if (!notesManager?.generateNote) {
        console.warn("[ConvManager] NotesManager unavailable, cannot auto-generate note");
        return;
      }

      const title = conv.title || undefined;
      const startTime = conv.startTime;
      const endTime = conv.endTime ?? new Date();

      const note = await notesManager.generateNote(title, startTime, endTime);

      if (note?.id) {
        await updateConversation(convId, { noteId: note.id });
        this.conversations.mutate((list) => {
          const idx = list.findIndex((c) => c.id === convId);
          if (idx >= 0) list[idx].noteId = note.id;
        });
        console.log(`[ConvManager] Auto-note generated for ${convId}: "${note.title}"`);
      }
    } catch (err) {
      console.error(`[ConvManager] Auto-note generation failed for ${convId}:`, err);
      this.lastAutoNoteErrorSeq = (this.lastAutoNoteErrorSeq ?? 0) + 1;
      this.lastAutoNoteErrorMessage = "Couldn't auto-generate note from conversation";
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
  async loadConversationSegments(conversationId: string): Promise<ConversationSegment[]> {
    const conv = (this.conversations as unknown as Conversation[]).find((c) => c.id === conversationId);
    if (!conv) return [];

    // Already loaded
    if (conv.segments && conv.segments.length > 0) return conv.segments;

    // Find the DB conversation to get the time range
    const userId = this._session?.userId;
    if (!userId) return [];

    const allConvs = await getAllConversations(userId);
    const dbConv = allConvs.find((c) => c._id?.toString() === conversationId);
    if (!dbConv) return [];

    const segments = await this.getSegmentsForConversation(dbConv);

    // Update synced state so the frontend gets the segments
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].segments = segments;
    });

    return segments;
  }

  @rpc
  async linkNoteToConversation(conversationId: string, noteId: string): Promise<void> {
    await updateConversation(conversationId, { noteId });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].noteId = noteId;
    });
  }

  @rpc
  async favouriteConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isFavourite: true, isArchived: false, isTrashed: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) { list[idx].isFavourite = true; list[idx].isArchived = false; list[idx].isTrashed = false; }
    });
  }

  @rpc
  async unfavouriteConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isFavourite: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].isFavourite = false;
    });
  }

  @rpc
  async archiveConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isArchived: true, isFavourite: false, isTrashed: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) { list[idx].isArchived = true; list[idx].isFavourite = false; list[idx].isTrashed = false; }
    });
  }

  @rpc
  async unarchiveConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isArchived: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].isArchived = false;
    });
  }

  @rpc
  async trashConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isTrashed: true, isFavourite: false, isArchived: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) { list[idx].isTrashed = true; list[idx].isFavourite = false; list[idx].isArchived = false; }
    });
  }

  @rpc
  async untrashConversation(conversationId: string): Promise<void> {
    await updateConversation(conversationId, { isTrashed: false });
    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === conversationId);
      if (idx >= 0) list[idx].isTrashed = false;
    });
  }

  @rpc
  async emptyTrash(): Promise<number> {
    const trashed = (this.conversations as unknown as Conversation[])
      .filter((c) => c.isTrashed);

    console.log(`[ConvManager] Emptying trash: ${trashed.length} conversations`);

    for (const conv of trashed) {
      console.log(`[ConvManager] Deleting trashed conversation: ${conv.id} — "${conv.title}" (${conv.date})`);
      await deleteConversation(conv.id);
    }

    this.conversations.set(
      (this.conversations as unknown as Conversation[]).filter((c) => !c.isTrashed),
    );

    console.log(`[ConvManager] Trash emptied: ${trashed.length} conversations permanently deleted`);
    return trashed.length;
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

  // ── Batch operations for multi-select ──

  @rpc
  async batchFavouriteConversations(ids: string[]): Promise<void> {
    for (const id of ids) await this.favouriteConversation(id);
  }

  @rpc
  async batchTrashConversations(ids: string[]): Promise<void> {
    for (const id of ids) await this.trashConversation(id);
  }

  @rpc
  async exportConversationsAsText(ids: string[]): Promise<string> {
    const parts: string[] = [];
    for (const id of ids) {
      const conv = (this.conversations as unknown as Conversation[]).find((c) => c.id === id);
      if (!conv) continue;
      parts.push(`# ${conv.title || "Untitled Conversation"}\n${conv.aiSummary || conv.runningSummary || "No summary available"}`);
    }
    return parts.join("\n\n---\n\n");
  }

  @rpc
  async mergeConversations(conversationIds: string[], trashOriginals: boolean): Promise<string> {
    if (conversationIds.length < 2) throw new Error("Need at least 2 conversations to merge");
    if (conversationIds.length > 10) throw new Error("Cannot merge more than 10 conversations at once");

    const userId = this._session?.userId;
    if (!userId) throw new Error("No user session");

    console.log(`[ConvManager] Merging ${conversationIds.length} conversations for ${userId}`);

    // 1. Load and validate all source conversations from DB
    const { default: mongoose } = await import("mongoose");
    const ConversationModel = mongoose.model("Conversation");
    const sourceConvs: ConversationI[] = [];
    for (const id of conversationIds) {
      const conv = await ConversationModel.findById(id) as ConversationI | null;
      if (!conv) throw new Error(`Conversation ${id} not found`);
      if (conv.status !== "ended") throw new Error(`Conversation ${id} is not ended (status: ${conv.status})`);
      sourceConvs.push(conv);
    }

    // 2. Sort source conversations by startTime (chronological)
    sourceConvs.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // 3. Collect all chunk IDs from source conversations' stored arrays (not DB query,
    // because previous merges may have reassigned chunk conversationId)
    const allChunkIds: string[] = [];
    const seenChunkIds = new Set<string>();
    for (const conv of sourceConvs) {
      for (const chunkId of conv.chunkIds) {
        const id = chunkId.toString();
        if (!seenChunkIds.has(id)) {
          seenChunkIds.add(id);
          allChunkIds.push(id);
        }
      }
    }

    // 4. Determine merged conversation date/time range
    // startTime/endTime span the full range (needed for AI summary to find chunks)
    // For list positioning: we store the actual range but set startTime slightly after
    // the latest source so it appears right after it in the descending sort
    const earliestConv = sourceConvs[0];
    const latestConv = sourceConvs[sourceConvs.length - 1];
    const mergedDate = latestConv.date;
    const actualStartTime = earliestConv.startTime;
    const actualEndTime = latestConv.endTime ?? new Date();
    // 5. Create the merged conversation with actual time range (for chunk queries)
    const mergedConv = await createConversation({
      userId,
      date: mergedDate,
      startTime: actualStartTime,
    });
    const mergedId = mergedConv._id!.toString();

    // 6. Update merged conversation with full data
    await updateConversation(mergedId, {
      status: "ended",
      endTime: actualEndTime,
      chunkIds: allChunkIds,
      runningSummary: "",
      noteId: null,
      silenceCount: 0,
    } as any);

    // 7. Reassign all chunks to the merged conversation
    const { TranscriptChunk } = await import("../../models/transcript-chunk.model");
    await TranscriptChunk.updateMany(
      { _id: { $in: allChunkIds } },
      { $set: { conversationId: mergedId } },
    );

    console.log(`[ConvManager] Merged conversation ${mergedId} created with ${allChunkIds.length} chunks`);

    // 8. Add merged conversation to frontend state FIRST (so AI summary sync can find it)
    const initialFrontendConv = await this.toFrontendConversation(
      (await ConversationModel.findById(mergedId)) as ConversationI,
      { skipSegments: true },
    );
    this.conversations.mutate((list) => {
      list.unshift(initialFrontendConv);
    });

    // 9. Generate AI summary + title (syncs to frontend via mutate internally)
    const freshConv = await ConversationModel.findById(mergedId) as ConversationI;
    if (freshConv) {
      await this.generateAISummary(freshConv);
    }

    // 10. If trashOriginals, trash source conversations
    if (trashOriginals) {
      for (const conv of sourceConvs) {
        await this.trashConversation(conv._id!.toString());
      }
    }

    const finalTitle = (await ConversationModel.findById(mergedId) as ConversationI)?.title || "Merged Conversation";
    console.log(`[ConvManager] Merge complete: "${finalTitle}" — ${mergedId} (${allChunkIds.length} chunks, ${sourceConvs.length} sources${trashOriginals ? ", originals trashed" : ""})`);
    return mergedId;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private async toFrontendConversation(
    conv: ConversationI,
    options?: { skipSegments?: boolean },
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

    // Get transcript segments — skip during bulk hydration (loaded on-demand)
    const segments: ConversationSegment[] = options?.skipSegments
      ? []
      : await this.getSegmentsForConversation(conv);

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
      isFavourite: conv.isFavourite ?? false,
      isArchived: conv.isArchived ?? false,
      isTrashed: conv.isTrashed ?? false,
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

      // 3. Try R2 (historical segments migrated to cloud storage) — skip for today
      const today = this.getTimeManager().today();
      if (conv.date !== today) {
        // Check cache first
        if (this.segmentCache.has(conv.date)) {
          const cached = this.segmentCache.get(conv.date)!;
          if (cached.length > 0) return filterAndMap(cached);
        }

        const r2Manager = (this._session as any)?.r2;
        if (r2Manager) {
          try {
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
              // Cache for other conversations on the same date
              this.segmentCache.set(conv.date, mapped);
              return filterAndMap(mapped);
            }
          } catch {
            // R2 fetch failed — cache empty to avoid retrying
            this.segmentCache.set(conv.date, []);
          }
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
