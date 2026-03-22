/**
 * ConversationTracker (Stage 3)
 *
 * State machine that tracks active conversations from meaningful chunks.
 *
 * States: IDLE → PENDING → TRACKING → PAUSED → (back to TRACKING or END)
 *
 * On each meaningful chunk:
 * - IDLE: move to PENDING (buffer chunk, don't create DB conversation yet)
 * - PENDING: buffer chunks until MIN_CHUNKS_TO_CONFIRM reached, then promote to TRACKING
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
import { createProviderFromEnv, type AgentProvider } from "../../services/llm";

export type TrackerState = "IDLE" | "PENDING" | "TRACKING" | "PAUSED";

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

  // PENDING state buffer — chunks waiting for confirmation
  private pendingChunks: TranscriptChunkI[] = [];
  private pendingSilenceCount: number = 0;

  // Consecutive filler counter for TRACKING state (reset on meaningful chunk)
  private trackingFillerCount: number = 0;

  private _onConversationEnd: ConversationEndCallback | null = null;
  private _onConversationUpdate: ConversationUpdateCallback | null = null;

  constructor(domainProfile: DomainProfile = "general") {
    this.domainProfile = domainProfile;

    try {
      this.provider = createProviderFromEnv();
    } catch (error) {
      console.error("[Tracker] No LLM provider available:", error);
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
        `[Tracker] Cleared active conversation: ${conversationId}`,
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
      case "PENDING":
        await this.handlePendingMeaningful(chunk);
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
   * IDLE + meaningful chunk: Check for resumable conversations, or move to PENDING.
   */
  private async handleIdleMeaningful(chunk: TranscriptChunkI): Promise<void> {
    console.log(
      `[Tracker] State: IDLE | received meaningful chunk #${chunk.chunkIndex} (${chunk.wordCount} words)`,
    );

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

    // Move to PENDING — buffer the chunk, don't create DB conversation yet
    this.pendingChunks = [chunk];
    this.pendingSilenceCount = 0;
    this.state = "PENDING";

    console.log(
      `[Tracker] IDLE → PENDING | first meaningful chunk buffered (1/${AUTO_NOTES_CONFIG.MIN_CHUNKS_TO_CONFIRM})`,
    );
  }

  /**
   * PENDING + meaningful chunk: Buffer until MIN_CHUNKS_TO_CONFIRM, then promote to TRACKING.
   */
  private async handlePendingMeaningful(chunk: TranscriptChunkI): Promise<void> {
    this.pendingChunks.push(chunk);
    this.pendingSilenceCount = 0; // Reset silence on meaningful chunk

    const count = this.pendingChunks.length;
    const needed = AUTO_NOTES_CONFIG.MIN_CHUNKS_TO_CONFIRM;

    if (count < needed) {
      console.log(
        `[Tracker] State: PENDING | meaningful chunk #${chunk.chunkIndex} buffered (${count}/${needed})`,
      );
      return;
    }

    // Reached threshold — promote to TRACKING
    console.log(
      `[Tracker] State: PENDING | meaningful chunk #${chunk.chunkIndex} buffered (${count}/${needed}) — confirming conversation`,
    );

    await this.promoteToTracking();
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
    console.log(
      `[Tracker] State: TRACKING | chunk #${chunk.chunkIndex} classified as ${decision}`,
    );

    switch (decision) {
      case "CONTINUATION":
        this.trackingFillerCount = 0; // Reset filler counter on meaningful content
        await this.addChunkToConversation(chunk);
        break;

      case "NEW_CONVERSATION":
        this.trackingFillerCount = 0;
        // End current conversation, go to PENDING (requires confirmation like any new conversation)
        await this.endConversation();
        this.pendingChunks = [chunk];
        this.pendingSilenceCount = 0;
        this.state = "PENDING";
        console.log(
          `[Tracker] TRACKING → PENDING | new topic detected, buffering chunk (1/${AUTO_NOTES_CONFIG.MIN_CHUNKS_TO_CONFIRM})`,
        );
        break;

      case "FILLER":
        this.trackingFillerCount++;
        console.log(
          `[Tracker] State: TRACKING | LLM classified as FILLER ${this.trackingFillerCount}/${AUTO_NOTES_CONFIG.SILENCE_PAUSE_CHUNKS}`,
        );
        if (this.trackingFillerCount >= AUTO_NOTES_CONFIG.SILENCE_PAUSE_CHUNKS) {
          await this.pauseConversation();
          this.trackingFillerCount = 0;
        }
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
      console.log(
        `[Tracker] State: PAUSED | chunk #${chunk.chunkIndex} is continuation — resuming`,
      );
      await this.resumeConversation(this.activeConversation, chunk);
    } else {
      console.log(
        `[Tracker] State: PAUSED | chunk #${chunk.chunkIndex} is new topic — ending paused, going to PENDING`,
      );
      // Different topic — end the paused conversation, require confirmation for new one
      await this.endConversation();
      this.pendingChunks = [chunk];
      this.pendingSilenceCount = 0;
      this.state = "PENDING";
      console.log(
        `[Tracker] PAUSED → PENDING | new topic buffered (1/${AUTO_NOTES_CONFIG.MIN_CHUNKS_TO_CONFIRM})`,
      );
    }
  }

  /**
   * Handle filler chunks — used for silence detection.
   */
  private async handleFiller(_chunk: TranscriptChunkI): Promise<void> {
    if (this.state === "IDLE") return; // Nothing to do

    if (this.state === "PENDING") {
      this.pendingSilenceCount++;
      console.log(
        `[Tracker] State: PENDING | silence ${this.pendingSilenceCount}/${AUTO_NOTES_CONFIG.PENDING_SILENCE_THRESHOLD}`,
      );

      if (this.pendingSilenceCount >= AUTO_NOTES_CONFIG.PENDING_SILENCE_THRESHOLD) {
        const discardedCount = this.pendingChunks.length;
        this.pendingChunks = [];
        this.pendingSilenceCount = 0;
        this.state = "IDLE";
        console.log(
          `[Tracker] PENDING → IDLE | pending conversation discarded (${discardedCount} chunks never confirmed)`,
        );
      }
      return;
    }

    if (!this.activeConversation) return;

    if (this.state === "TRACKING") {
      this.trackingFillerCount++;
      console.log(
        `[Tracker] State: TRACKING | filler ${this.trackingFillerCount}/${AUTO_NOTES_CONFIG.SILENCE_PAUSE_CHUNKS}`,
      );
      if (this.trackingFillerCount >= AUTO_NOTES_CONFIG.SILENCE_PAUSE_CHUNKS) {
        // Enough consecutive fillers → pause
        await this.pauseConversation();
        this.trackingFillerCount = 0;
      }
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
        `[Tracker] State: PAUSED | silence ${newSilenceCount}/${AUTO_NOTES_CONFIG.SILENCE_END_CHUNKS}`,
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

  /**
   * Promote pending chunks to a real conversation in the DB.
   * Called when MIN_CHUNKS_TO_CONFIRM is reached.
   */
  private async promoteToTracking(): Promise<void> {
    const chunks = this.pendingChunks;
    if (chunks.length === 0) return;

    const firstChunk = chunks[0];

    // Pull preceding chunks as context preamble
    const preambleCount = AUTO_NOTES_CONFIG.CONTEXT_PREAMBLE_CHUNKS;
    const recentChunks = await getRecentChunks(
      firstChunk.userId,
      firstChunk.date,
      preambleCount + chunks.length,
    );

    const pendingIds = new Set(chunks.map((c) => c._id?.toString()));
    const candidatePreamble = recentChunks.filter(
      (c) =>
        !pendingIds.has(c._id?.toString()) &&
        !c.conversationId,
    ).slice(-preambleCount);

    // Filter preamble: only include chunks related to the conversation
    const preambleChunks = await this.filterRelevantPreamble(candidatePreamble, chunks);

    const startTime = preambleChunks.length > 0
      ? preambleChunks[0].startTime
      : firstChunk.startTime;

    const conversation = await createConversation({
      userId: firstChunk.userId,
      date: firstChunk.date,
      startTime,
    });

    this.activeConversation = conversation;
    this.state = "TRACKING";

    // Add preamble chunks first
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

    if (candidatePreamble.length > 0) {
      console.log(
        `[Tracker] Preamble: ${preambleChunks.length}/${candidatePreamble.length} chunks were relevant`,
      );
    }

    // Add all buffered pending chunks
    for (const pendingChunk of chunks) {
      await this.addChunkToConversation(pendingChunk);
    }

    // Clear pending buffer
    this.pendingChunks = [];
    this.pendingSilenceCount = 0;

    console.log(
      `[Tracker] PENDING → TRACKING | conversation created: ${conversation._id} (${conversation.chunkIds.length} chunks)`,
    );

    this._onConversationUpdate?.(conversation, "started");
  }

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
    const candidatePreamble = recentChunks.filter(
      (c) =>
        c._id?.toString() !== chunk._id?.toString() &&
        !c.conversationId,
    ).slice(-preambleCount); // Take the most recent N

    // Filter preamble: only include chunks related to the conversation
    const preambleChunks = await this.filterRelevantPreamble(candidatePreamble, [chunk]);

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

    if (candidatePreamble.length > 0) {
      console.log(
        `[Tracker] Preamble: ${preambleChunks.length}/${candidatePreamble.length} chunks were relevant`,
      );
    }

    // Add the triggering meaningful chunk
    await this.addChunkToConversation(chunk);

    console.log(
      `[Tracker] IDLE → TRACKING | conversation created: ${conversation._id} (${conversation.chunkIds.length} chunks)`,
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
    this.trackingFillerCount = 0; // Reset filler counter on resume

    await this.addChunkToConversation(chunk);

    console.log(
      `[Tracker] PAUSED → TRACKING | conversation ${conversation._id} resumed`,
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
      `[Tracker] TRACKING → PAUSED | conversation ${this.activeConversation._id} paused (silenceCount: 1)`,
    );

    this._onConversationUpdate?.(this.activeConversation, "paused");
  }

  private async endConversation(): Promise<void> {
    if (!this.activeConversation) return;

    const prevState = this.state;
    const now = new Date();
    await updateConversation(this.activeConversation._id!.toString(), {
      status: "ended",
      endTime: now,
    });

    this.activeConversation.status = "ended";
    this.activeConversation.endTime = now;

    const duration = this.activeConversation.startTime
      ? Math.round((now.getTime() - new Date(this.activeConversation.startTime).getTime()) / 1000)
      : 0;
    const durationStr = duration >= 60
      ? `${Math.floor(duration / 60)}m ${duration % 60}s`
      : `${duration}s`;
    console.log(
      `[Tracker] ${prevState} → IDLE | conversation ${this.activeConversation._id} ended (${this.activeConversation.chunkIds.length} chunks, ${durationStr})`,
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

    // Append chunk text to running summary
    const updatedSummary = this.activeConversation.runningSummary
      ? `${this.activeConversation.runningSummary}\n${chunk.text}`
      : chunk.text;

    await updateConversation(this.activeConversation._id!.toString(), {
      runningSummary: updatedSummary,
    });
    this.activeConversation.runningSummary = updatedSummary;

    // Check if summary needs compression
    const chunksSinceCompression = (this.activeConversation.chunksSinceCompression || 0);
    if (
      chunksSinceCompression >= AUTO_NOTES_CONFIG.SUMMARY_COMPRESSION_INTERVAL &&
      this.getWordCount(updatedSummary) > AUTO_NOTES_CONFIG.SUMMARY_MAX_WORDS
    ) {
      await this.compressSummary();
    }

    this._onConversationUpdate?.(this.activeConversation, "chunk_added");
  }

  /**
   * Compress the running summary using an LLM call.
   */
  private async compressSummary(): Promise<void> {
    if (!this.activeConversation || !this.provider) return;

    const summary = this.activeConversation.runningSummary;
    const wordCount = this.getWordCount(summary);
    const targetWords = Math.floor(AUTO_NOTES_CONFIG.SUMMARY_MAX_WORDS / 2);

    console.log(
      `[Tracker] Summary compression triggered (conv ${this.activeConversation._id}, ${wordCount} words → compressing to ~${targetWords})`,
    );

    try {
      const response = await this.provider.chat(
        [{
          role: "user",
          content: `Compress this conversation summary to ~${targetWords} words while preserving all key facts, decisions, names, numbers, and action items. Remove redundancy and filler.\n\nSummary:\n${summary}`,
        }],
        {
          tier: AUTO_NOTES_CONFIG.SUMMARY_MODEL_TIER,
          maxTokens: AUTO_NOTES_CONFIG.SUMMARY_MAX_TOKENS,
          temperature: 0.1,
        },
      );

      const compressed =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim() || summary;

      const compressedWordCount = this.getWordCount(compressed);

      await updateConversation(this.activeConversation._id!.toString(), {
        runningSummary: compressed,
        chunksSinceCompression: 0,
      });
      this.activeConversation.runningSummary = compressed;
      this.activeConversation.chunksSinceCompression = 0;

      console.log(
        `[Tracker] Summary compressed: ${wordCount} → ${compressedWordCount} words`,
      );
    } catch (error) {
      console.error("[Tracker] Summary compression failed:", error);
      // Non-fatal — just reset counter so we try again later
      await updateConversation(this.activeConversation._id!.toString(), {
        chunksSinceCompression: 0,
      });
      this.activeConversation.chunksSinceCompression = 0;
    }
  }

  private getWordCount(text: string): number {
    return text.split(/\s+/).filter((w) => w.length > 0).length;
  }

  /**
   * Filter preamble chunks to only include those relevant to the conversation.
   * Uses a single LLM call to check all candidates at once.
   * Falls back to including all candidates if no LLM is available.
   */
  private async filterRelevantPreamble(
    candidates: TranscriptChunkI[],
    conversationChunks: TranscriptChunkI[],
  ): Promise<TranscriptChunkI[]> {
    if (candidates.length === 0) return [];
    if (!this.provider) return candidates; // No LLM — include all

    const conversationText = conversationChunks.map((c) => c.text).join("\n");
    const candidateList = candidates
      .map((c, i) => `[${i + 1}] "${c.text}"`)
      .join("\n");

    const prompt = `You are checking whether preceding transcript chunks are related to a conversation that just started.

Conversation so far:
"${conversationText}"

Preceding chunks (captured before the conversation started):
${candidateList}

For each chunk, respond with its number ONLY if it is related to the conversation topic. Unrelated fragments, background noise, or different topics should be excluded.

Respond with a comma-separated list of numbers (e.g. "1,3") or "NONE" if none are related.`;

    try {
      const response = await this.provider.chat(
        [{ role: "user", content: prompt }],
        {
          tier: AUTO_NOTES_CONFIG.TRACKER_MODEL_TIER,
          maxTokens: 32,
          temperature: 0.1,
        },
      );

      const text =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim()
          .toUpperCase() || "NONE";

      if (text.includes("NONE")) {
        console.log(`[Tracker] Preamble filter: none relevant`);
        return [];
      }

      // Parse numbers from response
      const numbers = text.match(/\d+/g)?.map(Number) || [];
      const relevant = candidates.filter((_, i) => numbers.includes(i + 1));

      console.log(
        `[Tracker] Preamble filter: kept ${relevant.length}/${candidates.length} (indices: ${numbers.join(",")})`,
      );

      return relevant;
    } catch (error) {
      console.error("[Tracker] Preamble relevance check failed:", error);
      return candidates; // Fail-open: include all
    }
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
      console.error("[Tracker] LLM classification failed:", error);
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

    const prompt = `A conversation was paused briefly. New speech has arrived. Is this still part of the same conversation session?

IMPORTANT: Be very lenient. Real conversations naturally drift between subtopics, go on tangents, and circle back. Only answer NO if the new speech is clearly about a COMPLETELY UNRELATED subject with zero connection to anything discussed before (e.g., switching from a work meeting to ordering food). Topic shifts, new questions, tangents, greetings, and asides within the same social context should all be YES.

Previous conversation summary:
"${conversation.runningSummary || "(no summary yet)"}"

New speech:
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
      console.error("[Tracker] Resumption check failed:", error);
      return true; // Default to continuation on error — better to merge than to split
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
        `[Tracker] Recovered state: ${this.state} | conversation: ${conversation._id}`,
      );
    }
  }
}
