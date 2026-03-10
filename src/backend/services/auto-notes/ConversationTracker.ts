/**
 * ConversationTracker (Stage 3)
 *
 * State machine that tracks active conversations from meaningful chunks.
 *
 * States: IDLE → TRACKING → PAUSED → (back to TRACKING or END)
 *
 * On each meaningful chunk:
 * - IDLE: start new conversation (or resume paused one)
 * - TRACKING: classify as CONTINUATION / NEW_CONVERSATION / FILLER
 * - PAUSED: resume if on-topic, or increment silence counter
 *
 * When silence reaches threshold → end conversation → trigger note generation.
 */

import type { TranscriptChunkI } from "../../models/transcript-chunk.model";
import {
  updateChunkClassification,
  getRecentChunks,
} from "../../models/transcript-chunk.model";
import {
  createConversation,
  getResumableConversations,
  updateConversation,
  appendChunkToConversation,
  type ConversationI,
} from "../../models/conversation.model";
import { AUTO_NOTES_CONFIG } from "./config";
import { getDomainPromptContext, type DomainProfile } from "./domain-config";
import { createProviderFromEnv, type AgentProvider } from "../llm";

export type TrackerState = "IDLE" | "TRACKING" | "PAUSED";

export type TrackingDecision =
  | "CONTINUATION"
  | "NEW_CONVERSATION"
  | "FILLER";

export type ConversationEndCallback = (conversation: ConversationI) => void;
export type ConversationUpdateCallback = (
  conversation: ConversationI,
  event: "started" | "chunk_added" | "paused" | "resumed" | "ended",
) => void;

export class ConversationTracker {
  private state: TrackerState = "IDLE";
  private activeConversation: ConversationI | null = null;
  private provider: AgentProvider | null = null;
  private domainProfile: DomainProfile;

  private _onConversationEnd: ConversationEndCallback | null = null;
  private _onConversationUpdate: ConversationUpdateCallback | null = null;

  constructor(domainProfile: DomainProfile = "general") {
    this.domainProfile = domainProfile;

    try {
      this.provider = createProviderFromEnv();
    } catch (error) {
      console.error("[ConversationTracker] No LLM provider available:", error);
    }
  }

  // =========================================================================
  // Configuration
  // =========================================================================

  onConversationEnd(callback: ConversationEndCallback): void {
    this._onConversationEnd = callback;
  }

  onConversationUpdate(callback: ConversationUpdateCallback): void {
    this._onConversationUpdate = callback;
  }

  setDomainProfile(profile: DomainProfile): void {
    this.domainProfile = profile;
  }

  getState(): TrackerState {
    return this.state;
  }

  getActiveConversation(): ConversationI | null {
    return this.activeConversation;
  }

  /**
   * Force-clear the active conversation (e.g. after user deletes it).
   * Resets the tracker to IDLE without triggering any callbacks or DB updates.
   */
  clearActiveConversation(conversationId: string): boolean {
    if (
      this.activeConversation &&
      this.activeConversation._id?.toString() === conversationId
    ) {
      this.activeConversation = null;
      this.state = "IDLE";
      console.log(
        `[ConversationTracker] Cleared active conversation: ${conversationId}`,
      );
      return true;
    }
    return false;
  }

  // =========================================================================
  // Main Entry Point
  // =========================================================================

  /**
   * Process a chunk that has been classified as meaningful by the triage stage.
   * Also handles filler chunks to track silence patterns.
   */
  async processChunk(
    chunk: TranscriptChunkI,
    classification: "meaningful" | "filler" | "auto-skipped",
  ): Promise<void> {
    if (classification === "auto-skipped") {
      // Auto-skipped chunks don't affect conversation state at all
      return;
    }

    if (classification === "filler") {
      await this.handleFiller(chunk);
      return;
    }

    // classification === "meaningful"
    switch (this.state) {
      case "IDLE":
        await this.handleIdleMeaningful(chunk);
        break;
      case "TRACKING":
        await this.handleTrackingMeaningful(chunk);
        break;
      case "PAUSED":
        await this.handlePausedMeaningful(chunk);
        break;
    }
  }

  // =========================================================================
  // State Handlers
  // =========================================================================

  /**
   * IDLE + meaningful chunk: Check for resumable conversations, then start new or resume.
   */
  private async handleIdleMeaningful(chunk: TranscriptChunkI): Promise<void> {
    // Check for resumable paused conversations
    const resumptionWindow = new Date(
      Date.now() - AUTO_NOTES_CONFIG.RESUMPTION_WINDOW_MS,
    );
    const resumable = await getResumableConversations(
      chunk.userId,
      resumptionWindow,
    );

    if (resumable.length > 0 && this.provider) {
      // Ask LLM if this is a continuation of a paused conversation
      const mostRecent = resumable[0];
      const isContinuation = await this.checkResumption(chunk, mostRecent);

      if (isContinuation) {
        await this.resumeConversation(mostRecent, chunk);
        return;
      }
    }

    // Start a new conversation
    await this.startNewConversation(chunk);
  }

  /**
   * TRACKING + meaningful chunk: Classify as continuation, new conversation, or filler.
   */
  private async handleTrackingMeaningful(
    chunk: TranscriptChunkI,
  ): Promise<void> {
    if (!this.activeConversation) {
      // Shouldn't happen, but handle gracefully
      await this.startNewConversation(chunk);
      return;
    }

    const decision = await this.classifyChunkInContext(chunk);

    switch (decision) {
      case "CONTINUATION":
        await this.addChunkToConversation(chunk);
        break;

      case "NEW_CONVERSATION":
        // End current conversation, start new one
        await this.endConversation();
        await this.startNewConversation(chunk);
        break;

      case "FILLER":
        await this.pauseConversation();
        break;
    }
  }

  /**
   * PAUSED + meaningful chunk: Check if it's a resumption or new topic.
   */
  private async handlePausedMeaningful(
    chunk: TranscriptChunkI,
  ): Promise<void> {
    if (!this.activeConversation) {
      await this.startNewConversation(chunk);
      return;
    }

    // Check if this is a continuation of the paused conversation
    const isContinuation = await this.checkResumption(
      chunk,
      this.activeConversation,
    );

    if (isContinuation) {
      await this.resumeConversation(this.activeConversation, chunk);
    } else {
      // Different topic — end the paused conversation, start new
      await this.endConversation();
      await this.startNewConversation(chunk);
    }
  }

  /**
   * Handle filler chunks — used for silence detection.
   */
  private async handleFiller(chunk: TranscriptChunkI): Promise<void> {
    if (this.state === "IDLE") return; // Nothing to do

    if (!this.activeConversation) return;

    if (this.state === "TRACKING") {
      // First filler chunk → pause
      await this.pauseConversation();
      return;
    }

    if (this.state === "PAUSED") {
      // Increment silence counter
      const newSilenceCount = (this.activeConversation.silenceCount || 0) + 1;
      await updateConversation(this.activeConversation._id!.toString(), {
        silenceCount: newSilenceCount,
      });
      this.activeConversation.silenceCount = newSilenceCount;

      console.log(
        `[ConversationTracker] Silence count: ${newSilenceCount}/${AUTO_NOTES_CONFIG.SILENCE_END_CHUNKS}`,
      );

      if (newSilenceCount >= AUTO_NOTES_CONFIG.SILENCE_END_CHUNKS) {
        // 3 consecutive silent chunks → end conversation permanently
        await this.endConversation();
      }
    }
  }

  // =========================================================================
  // Conversation Lifecycle
  // =========================================================================

  private async startNewConversation(
    chunk: TranscriptChunkI,
  ): Promise<void> {
    // Pull preceding chunks as context preamble
    const preambleCount = AUTO_NOTES_CONFIG.CONTEXT_PREAMBLE_CHUNKS;
    const recentChunks = await getRecentChunks(
      chunk.userId,
      chunk.date,
      preambleCount + 1, // +1 because the current chunk may be included
    );

    // Filter out the current chunk and any already assigned to another conversation
    const preambleChunks = recentChunks.filter(
      (c) =>
        c._id?.toString() !== chunk._id?.toString() &&
        !c.conversationId,
    ).slice(-preambleCount); // Take the most recent N

    // Use the earliest preamble chunk's startTime as conversation start
    const startTime = preambleChunks.length > 0
      ? preambleChunks[0].startTime
      : chunk.startTime;

    const conversation = await createConversation({
      userId: chunk.userId,
      date: chunk.date,
      startTime,
    });

    this.activeConversation = conversation;
    this.state = "TRACKING";

    // Add preamble chunks first (preserves chronological order in transcript)
    for (const preamble of preambleChunks) {
      await appendChunkToConversation(
        conversation._id!.toString(),
        preamble._id!.toString(),
      );
      await updateChunkClassification(
        preamble._id!.toString(),
        preamble.classification as any,
        conversation._id!.toString(),
      );
      conversation.chunkIds.push(preamble._id!.toString());
    }

    if (preambleChunks.length > 0) {
      console.log(
        `[ConversationTracker] Added ${preambleChunks.length} preamble chunks as context`,
      );
    }

    // Add the triggering meaningful chunk
    await this.addChunkToConversation(chunk);

    console.log(
      `[ConversationTracker] Started new conversation: ${conversation._id}`,
    );

    this._onConversationUpdate?.(conversation, "started");
  }

  private async resumeConversation(
    conversation: ConversationI,
    chunk: TranscriptChunkI,
  ): Promise<void> {
    await updateConversation(conversation._id!.toString(), {
      status: "active",
      pausedAt: null,
      silenceCount: 0,
    });

    conversation.status = "active";
    conversation.pausedAt = null;
    conversation.silenceCount = 0;

    this.activeConversation = conversation;
    this.state = "TRACKING";

    await this.addChunkToConversation(chunk);

    console.log(
      `[ConversationTracker] Resumed conversation: ${conversation._id}`,
    );

    this._onConversationUpdate?.(conversation, "resumed");
  }

  private async pauseConversation(): Promise<void> {
    if (!this.activeConversation) return;

    const now = new Date();
    await updateConversation(this.activeConversation._id!.toString(), {
      status: "paused",
      pausedAt: now,
      silenceCount: 1, // The filler chunk that triggered the pause counts as 1
    });

    this.activeConversation.status = "paused";
    this.activeConversation.pausedAt = now;
    this.activeConversation.silenceCount = 1;
    this.state = "PAUSED";

    console.log(
      `[ConversationTracker] Paused conversation: ${this.activeConversation._id}`,
    );

    this._onConversationUpdate?.(this.activeConversation, "paused");
  }

  private async endConversation(): Promise<void> {
    if (!this.activeConversation) return;

    const now = new Date();
    await updateConversation(this.activeConversation._id!.toString(), {
      status: "ended",
      endTime: now,
    });

    this.activeConversation.status = "ended";
    this.activeConversation.endTime = now;

    console.log(
      `[ConversationTracker] Ended conversation: ${this.activeConversation._id} (${this.activeConversation.chunkIds.length} chunks)`,
    );

    const endedConversation = this.activeConversation;

    // Reset state
    this.activeConversation = null;
    this.state = "IDLE";

    // Notify listeners
    this._onConversationUpdate?.(endedConversation, "ended");

    // Trigger note generation
    if (
      endedConversation.chunkIds.length > 0 &&
      this._onConversationEnd
    ) {
      this._onConversationEnd(endedConversation);
    }
  }

  private async addChunkToConversation(
    chunk: TranscriptChunkI,
  ): Promise<void> {
    if (!this.activeConversation) return;

    const chunkId = chunk._id!.toString();
    await appendChunkToConversation(
      this.activeConversation._id!.toString(),
      chunkId,
    );
    await updateChunkClassification(chunkId, "meaningful", this.activeConversation._id!.toString());

    this.activeConversation.chunkIds.push(chunkId);

    // Append chunk text to running summary (no LLM calls during live conversation)
    const updatedSummary = this.activeConversation.runningSummary
      ? `${this.activeConversation.runningSummary}\n${chunk.text}`
      : chunk.text;

    await updateConversation(this.activeConversation._id!.toString(), {
      runningSummary: updatedSummary,
    });
    this.activeConversation.runningSummary = updatedSummary;

    this._onConversationUpdate?.(this.activeConversation, "chunk_added");
  }

  // =========================================================================
  // LLM Helpers
  // =========================================================================

  /**
   * Classify a chunk in the context of the current conversation.
   */
  private async classifyChunkInContext(
    chunk: TranscriptChunkI,
  ): Promise<TrackingDecision> {
    if (!this.provider || !this.activeConversation) {
      return "CONTINUATION"; // Default: keep going
    }

    const domainContext = getDomainPromptContext(this.domainProfile);

    const prompt = `You are a conversation tracker. You're monitoring an ongoing conversation and a new chunk of transcript has arrived.

Domain context: ${domainContext}

Current conversation summary:
"${this.activeConversation.runningSummary || "(just started)"}"

New chunk:
"${chunk.text}"

Classify this new chunk as one of:
- CONTINUATION: Same conversation topic, continue tracking
- NEW_CONVERSATION: Clearly a different topic/conversation has started
- FILLER: Background noise, small talk, or silence that interrupts the conversation

Respond with exactly one word: CONTINUATION, NEW_CONVERSATION, or FILLER`;

    try {
      const response = await this.provider.chat(
        [{ role: "user", content: prompt }],
        {
          tier: AUTO_NOTES_CONFIG.TRACKER_MODEL_TIER,
          maxTokens: AUTO_NOTES_CONFIG.TRACKER_MAX_TOKENS,
          temperature: 0.1,
        },
      );

      const text =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim()
          .toUpperCase() || "CONTINUATION";

      if (text.includes("NEW_CONVERSATION")) return "NEW_CONVERSATION";
      if (text.includes("FILLER")) return "FILLER";
      return "CONTINUATION";
    } catch (error) {
      console.error("[ConversationTracker] LLM classification failed:", error);
      return "CONTINUATION"; // Fail-safe: keep tracking
    }
  }

  /**
   * Check if a new chunk is a continuation of a paused/ended conversation.
   */
  private async checkResumption(
    chunk: TranscriptChunkI,
    conversation: ConversationI,
  ): Promise<boolean> {
    if (!this.provider) return false;

    const prompt = `A conversation was paused. A new chunk of speech has arrived. Is this a continuation of the previous conversation?

Previous conversation summary:
"${conversation.runningSummary || "(no summary yet)"}"

New chunk:
"${chunk.text}"

Respond with exactly YES or NO.`;

    try {
      const response = await this.provider.chat(
        [{ role: "user", content: prompt }],
        {
          tier: AUTO_NOTES_CONFIG.TRACKER_MODEL_TIER,
          maxTokens: 16,
          temperature: 0.1,
        },
      );

      const text =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim()
          .toUpperCase() || "NO";

      return text.includes("YES");
    } catch (error) {
      console.error("[ConversationTracker] Resumption check failed:", error);
      return false;
    }
  }

  // =========================================================================
  // Crash Recovery
  // =========================================================================

  /**
   * Reconstruct tracker state from DB on startup.
   * Call this during hydration to recover from server crashes.
   */
  async recoverState(userId: string): Promise<void> {
    const { getActiveConversations } = await import(
      "../../models/conversation.model"
    );
    const activeConversations = await getActiveConversations(userId);

    if (activeConversations.length > 0) {
      // Take the most recent active/paused conversation
      const conversation = activeConversations[0];
      this.activeConversation = conversation;
      this.state =
        conversation.status === "active" ? "TRACKING" : "PAUSED";

      console.log(
        `[ConversationTracker] Recovered state: ${this.state}, conversation: ${conversation._id}`,
      );
    }
  }
}
