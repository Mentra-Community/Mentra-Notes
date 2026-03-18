/**
 * TriageClassifier (Stage 2)
 *
 * Classifies each 40-second chunk as:
 * - auto-skipped: under word minimum with no high-signal keywords
 * - filler: LLM says it's background noise / small talk
 * - meaningful: LLM says it's substantive conversation worth tracking
 */

import type { TranscriptChunkI } from "../models/transcript-chunk.model";
import {
  getRecentChunks,
  updateChunkClassification,
} from "../models/transcript-chunk.model";
import { AUTO_NOTES_CONFIG } from "../core/auto-conversation/config";
import {
  containsHighSignalKeyword,
  getDomainPromptContext,
  type DomainProfile,
} from "../core/auto-conversation/domain-config";
import {
  createProviderFromEnv,
  type AgentProvider,
} from "../services/llm";

export type TriageResult = "auto-skipped" | "filler" | "meaningful";

export class TriageClassifier {
  private provider: AgentProvider | null = null;
  private domainProfile: DomainProfile;

  constructor(domainProfile: DomainProfile = "general") {
    this.domainProfile = domainProfile;

    try {
      this.provider = createProviderFromEnv();
    } catch (error) {
      console.error(
        "[Triage] No LLM provider available, will auto-skip all chunks:",
        error,
      );
    }
  }

  /**
   * Update the domain profile (e.g., when user changes room context)
   */
  setDomainProfile(profile: DomainProfile): void {
    this.domainProfile = profile;
  }

  /**
   * Classify a chunk. Updates the chunk's classification in DB and returns the result.
   */
  async classify(chunk: TranscriptChunkI): Promise<TriageResult> {
    // -----------------------------------------------------------------------
    // Stage 2a: Auto-skip check (no LLM needed)
    // -----------------------------------------------------------------------
    if (chunk.wordCount === 0 || !chunk.text.trim()) {
      // Silence signals (no _id) are treated as filler so the tracker can
      // detect silence patterns and pause/end conversations.
      // Persisted empty chunks are auto-skipped as before.
      if (!chunk._id) {
        return "filler";
      }
      await updateChunkClassification(chunk._id.toString(), "auto-skipped");
      return "auto-skipped";
    }

    if (
      chunk.wordCount < AUTO_NOTES_CONFIG.PRE_FILTER_WORD_MIN &&
      !containsHighSignalKeyword(chunk.text, this.domainProfile)
    ) {
      console.log(
        `[Triage] Chunk #${chunk.chunkIndex}: auto-skipped (${chunk.wordCount} words, below minimum, no keywords)`,
      );
      await updateChunkClassification(chunk._id!.toString(), "auto-skipped");
      return "auto-skipped";
    }

    // -----------------------------------------------------------------------
    // Stage 2b: LLM classification
    // -----------------------------------------------------------------------
    if (!this.provider) {
      // No LLM → conservative: treat as meaningful
      await updateChunkClassification(chunk._id!.toString(), "meaningful");
      return "meaningful";
    }

    try {
      // Get previous chunks for context
      const previousChunks = await getRecentChunks(
        chunk.userId,
        chunk.date,
        AUTO_NOTES_CONFIG.CONTEXT_LOOKBACK_CHUNKS + 1, // +1 because the current chunk is included
      );
      // Remove the current chunk from context
      const contextChunks = previousChunks.filter(
        (c) => c._id?.toString() !== chunk._id?.toString(),
      );

      const contextText = contextChunks
        .map((c) => `[Previous chunk]: ${c.text}`)
        .join("\n");

      const domainContext = getDomainPromptContext(this.domainProfile);

      const prompt = `You are a transcript triage classifier for smart glasses worn by a single user. Your job is to decide if a transcript chunk is worth tracking as a conversation.

Default to MEANINGFUL when in doubt. Only classify as FILLER if the chunk is clearly worthless to capture.

Domain context: ${domainContext}

${contextText ? `Recent context:\n${contextText}\n\n` : ""}Current chunk to classify:
"${chunk.text}"

FILLER (only these cases):
- Pure background noise, music, or transcription artifacts with no real words
- Unambiguous one-way broadcast audio (TV, radio, podcast) with zero user participation
- Single-word or near-empty acknowledgments with nothing else ("yeah", "okay", "mmhmm", "uh huh" alone)
- Completely empty filler sounds with no content ("um", "uh", "like" repeated with nothing else)

MEANINGFUL (everything else, including):
- Any real conversation the user is part of, regardless of topic — work, personal, casual, plants, hobbies, anything
- Small talk, casual chat, or social exchanges — these are real conversations worth capturing
- Questions, answers, opinions, stories, plans, or updates of any kind
- Greetings and introductions that open a conversation
- Even short but real statements ("she quit", "Thursday at nine", "let's do it")

IMPORTANT: Topic does not determine filler. A conversation about plants, the weekend, or someone's dog is MEANINGFUL — it is a real human conversation. Only classify FILLER for audio that has no conversational content at all.

Respond with exactly one word: FILLER or MEANINGFUL`;

      const response = await this.provider.chat(
        [{ role: "user", content: prompt }],
        {
          tier: AUTO_NOTES_CONFIG.TRIAGE_MODEL_TIER,
          maxTokens: AUTO_NOTES_CONFIG.TRIAGE_MAX_TOKENS,
          temperature: 0.1,
        },
      );

      const responseText =
        response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("")
          .trim()
          .toUpperCase() || "MEANINGFUL";

      const classification: TriageResult = responseText.includes("FILLER")
        ? "filler"
        : "meaningful";

      console.log(
        `[Triage] Chunk #${chunk.chunkIndex}: ${classification} (LLM: ${responseText}, ${chunk.wordCount} words)`,
      );

      await updateChunkClassification(chunk._id!.toString(), classification);
      return classification;
    } catch (error) {
      console.error(
        `[Triage] LLM classification failed for chunk #${chunk.chunkIndex}, defaulting to meaningful:`,
        error,
      );
      // Fail-open: treat as meaningful
      await updateChunkClassification(chunk._id!.toString(), "meaningful");
      return "meaningful";
    }
  }
}
