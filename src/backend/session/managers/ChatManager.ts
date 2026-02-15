/**
 * ChatManager
 *
 * Manages AI chat conversations with per-day chat history.
 * Each day has its own chat history that persists to MongoDB.
 */

import { SyncedManager, synced, rpc } from "../../../lib/sync";
import {
  getChatHistory,
  addChatMessage,
  clearChatHistory,
  type ChatMessageI,
} from "../../models";
import {
  createProviderFromEnv,
  isProviderAvailable,
  type AgentProvider,
  type UnifiedMessage,
} from "../../services/llm";
import type { TranscriptSegment } from "./TranscriptManager";
import type { NoteData } from "./NotesManager";
import { TimeManager } from "./TimeManager";

// =============================================================================
// Types
// =============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// =============================================================================
// Manager
// =============================================================================

export class ChatManager extends SyncedManager {
  @synced messages = synced<ChatMessage[]>([]);
  @synced isTyping = false;
  @synced loadedDate = "";

  private provider: AgentProvider | null = null;
  private timeManager: TimeManager | null = null;

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private getTimeManager(): TimeManager {
    if (!this.timeManager) {
      const timezone = (this._session as any).appSession?.settings?.getMentraOS(
        "userTimezone",
      ) as string | undefined;
      this.timeManager = new TimeManager(timezone);
    }
    return this.timeManager;
  }

  private getProvider(): AgentProvider | null {
    if (this.provider) return this.provider;

    if (!isProviderAvailable("gemini") && !isProviderAvailable("anthropic")) {
      console.warn("[ChatManager] No AI provider available");
      return null;
    }

    try {
      this.provider = createProviderFromEnv();
      return this.provider;
    } catch (error) {
      console.error("[ChatManager] Failed to create AI provider:", error);
      return null;
    }
  }

  private getContext(): string {
    const transcriptManager = (this._session as any)?.transcript;
    const notesManager = (this._session as any)?.notes;

    const segments: TranscriptSegment[] = transcriptManager?.segments ?? [];
    const notes: NoteData[] = notesManager?.notes ?? [];

    let context = "";

    // Add recent transcript (last 50 segments)
    if (segments.length > 0) {
      const recentSegments = segments.slice(-50);
      const transcriptText = recentSegments.map((s) => s.text).join(" ");
      context += `## Recent Transcript\n${transcriptText}\n\n`;
    }

    // Add recent notes (last 5)
    if (notes.length > 0) {
      const recentNotes = notes.slice(0, 5);
      context += `## Recent Notes\n`;
      recentNotes.forEach((note) => {
        context += `### ${note.title}\n${note.summary || note.content}\n\n`;
      });
    }

    return context;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async hydrate(): Promise<void> {
    const userId = this._session?.userId;
    if (!userId) return;

    try {
      const today = this.getTimeManager().today();
      await this.loadDateChat(today);
    } catch (error) {
      console.error("[ChatManager] Failed to hydrate:", error);
    }
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  /**
   * Load chat history for a specific date
   */
  @rpc
  async loadDateChat(date: string): Promise<ChatMessage[]> {
    const userId = this._session?.userId;
    if (!userId) {
      this.messages.set([]);
      this.loadedDate = date;
      return [];
    }

    try {
      console.log(`[ChatManager] Loading chat history for ${date}`);

      const history = await getChatHistory(userId, date);

      if (history && history.messages.length > 0) {
        const loadedMessages: ChatMessage[] = history.messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }));

        this.messages.set(loadedMessages);
        this.loadedDate = date;

        console.log(
          `[ChatManager] Loaded ${loadedMessages.length} messages for ${date}`,
        );

        return loadedMessages;
      } else {
        this.messages.set([]);
        this.loadedDate = date;
        return [];
      }
    } catch (error) {
      console.error(`[ChatManager] Failed to load chat for ${date}:`, error);
      this.messages.set([]);
      this.loadedDate = date;
      return [];
    }
  }

  /**
   * Send a message and get AI response
   */
  @rpc
  async sendMessage(content: string): Promise<ChatMessage> {
    const userId = this._session?.userId;
    const currentDate = this.loadedDate || this.getTimeManager().today();

    // Add user message
    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: "user",
      content,
      timestamp: new Date(),
    };
    this.messages.mutate((m) => m.push(userMessage));

    // Persist user message
    if (userId) {
      const dbMessage: ChatMessageI = {
        id: userMessage.id,
        role: userMessage.role,
        content: userMessage.content,
        timestamp: userMessage.timestamp,
      };
      await addChatMessage(userId, currentDate, dbMessage);
    }

    // Check for AI provider
    const provider = this.getProvider();
    if (!provider) {
      const errorMessage: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content:
          "I'm sorry, but AI chat is not available. Please configure an AI provider (GEMINI_API_KEY or ANTHROPIC_API_KEY).",
        timestamp: new Date(),
      };
      this.messages.mutate((m) => m.push(errorMessage));

      // Persist error message
      if (userId) {
        const dbMessage: ChatMessageI = {
          id: errorMessage.id,
          role: errorMessage.role,
          content: errorMessage.content,
          timestamp: errorMessage.timestamp,
        };
        await addChatMessage(userId, currentDate, dbMessage);
      }

      return errorMessage;
    }

    this.isTyping = true;

    try {
      // Build context
      const context = this.getContext();

      // Build conversation history (last 10 messages)
      const recentMessages = this.messages.slice(-10);
      const conversationHistory: UnifiedMessage[] = recentMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Add current message with context
      const messagesForAI: UnifiedMessage[] = [
        ...conversationHistory.slice(0, -1),
        {
          role: "user" as const,
          content: `${context ? `Context:\n${context}\n\n` : ""}User question: ${content}`,
        },
      ];

      const response = await provider.chat(messagesForAI, {
        tier: "fast",
        maxTokens: 2048,
        systemPrompt: `You are a helpful assistant for a notes app. You have access to the user's recent transcripts and notes.

Your role is to:
- Answer questions about the user's transcripts and notes
- Help summarize or find information in the recorded content
- Provide helpful suggestions based on what was discussed
- Be concise but thorough

If you don't have enough context to answer a question, say so and ask for clarification.`,
      });

      const responseText =
        typeof response.content === "string"
          ? response.content
          : response.content
              .filter((c) => c.type === "text")
              .map((c) => (c as any).text)
              .join("");

      const assistantMessage: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content: responseText,
        timestamp: new Date(),
      };

      this.messages.mutate((m) => m.push(assistantMessage));

      // Persist assistant message
      if (userId) {
        const dbMessage: ChatMessageI = {
          id: assistantMessage.id,
          role: assistantMessage.role,
          content: assistantMessage.content,
          timestamp: assistantMessage.timestamp,
        };
        await addChatMessage(userId, currentDate, dbMessage);
      }

      return assistantMessage;
    } catch (error) {
      console.error("[ChatManager] Chat failed:", error);

      const errorMessage: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: "assistant",
        content:
          "I'm sorry, I encountered an error processing your request. Please try again.",
        timestamp: new Date(),
      };

      this.messages.mutate((m) => m.push(errorMessage));

      // Persist error message
      if (userId) {
        const dbMessage: ChatMessageI = {
          id: errorMessage.id,
          role: errorMessage.role,
          content: errorMessage.content,
          timestamp: errorMessage.timestamp,
        };
        await addChatMessage(userId, currentDate, dbMessage);
      }

      return errorMessage;
    } finally {
      this.isTyping = false;
    }
  }

  /**
   * Clear chat history for the current date
   */
  @rpc
  async clearHistory(): Promise<void> {
    const userId = this._session?.userId;
    const currentDate = this.loadedDate || this.getTimeManager().today();

    this.messages.set([]);

    if (userId) {
      await clearChatHistory(userId, currentDate);
    }
  }
}
