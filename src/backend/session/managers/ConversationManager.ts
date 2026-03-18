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
import { getChunksByConversationId } from "../../models/transcript-chunk.model";
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
    const frontendConv = await this.toFrontendConversation(conv);

    this.conversations.mutate((list) => {
      const idx = list.findIndex((c) => c.id === (conv._id!.toString()));
      if (idx >= 0) {
        list[idx] = frontendConv;
      } else {
        // New conversation — add to beginning (newest first)
        list.unshift(frontendConv);
      }
    });

    if (event === "started" || event === "resumed") {
      this.activeConversationId = conv._id!.toString();
    } else if (event === "ended") {
      this.activeConversationId = null;
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
      const chunks = await getChunksByConversationId(convId);
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

      const prompt = `You are summarizing a conversation captured from smart glasses. Respond with EXACTLY this format:

TITLE: <a short, descriptive title for the conversation, max 5 words>

<1-2 sentence overview of what was discussed>

<bullet points covering: key topics, important details, any decisions made, and action items (if any)>

Keep it concise and useful. Skip bullet categories that don't apply. The title should capture the main topic.

Transcript:
---
${transcript}
---

Respond now:`;

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
      chunks,
    };
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
