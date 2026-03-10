/**
 * NoteGenerator (Stage 4)
 *
 * When a conversation ends, generates a structured note from all its chunks.
 * Uses a stronger LLM model (smart tier) for higher quality output.
 *
 * Generated note structure:
 * - Title
 * - Participants
 * - Summary (2-3 paragraphs)
 * - Key Points
 * - Decisions Made
 * - Action Items
 */

import type { ConversationI } from "../../models/conversation.model";
import { updateConversation } from "../../models/conversation.model";
import { getChunksByConversationId } from "../../models/transcript-chunk.model";
import { createNote } from "../../models/note.model";
import { AUTO_NOTES_CONFIG } from "./config";
import { createProviderFromEnv, type AgentProvider } from "../llm";

export type NoteGenerationCallback = (
  conversation: ConversationI,
  event: "generating" | "completed" | "failed",
  noteId?: string,
) => void;

export class NoteGenerator {
  private provider: AgentProvider | null = null;
  private _onNoteGeneration: NoteGenerationCallback | null = null;

  constructor() {
    try {
      this.provider = createProviderFromEnv();
    } catch (error) {
      console.error("[NoteGenerator] No LLM provider available:", error);
    }
  }

  onNoteGeneration(callback: NoteGenerationCallback): void {
    this._onNoteGeneration = callback;
  }

  /**
   * Generate a structured note from a completed conversation.
   * Retries once on failure per the plan.
   */
  async generate(conversation: ConversationI): Promise<string | null> {
    if (!this.provider) {
      console.error("[NoteGenerator] No LLM provider, cannot generate note");
      await this.markFailed(conversation);
      return null;
    }

    this._onNoteGeneration?.(conversation, "generating");

    // Fetch all chunks for this conversation
    const chunks = await getChunksByConversationId(
      conversation._id!.toString(),
    );

    if (chunks.length === 0) {
      console.warn(
        `[NoteGenerator] No chunks found for conversation ${conversation._id}`,
      );
      await this.markFailed(conversation);
      return null;
    }

    // Assemble full transcript
    const transcript = chunks
      .map((c) => {
        const time = new Date(c.startTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
        return `[${time}] ${c.text}`;
      })
      .join("\n\n");

    // Try generation (with one retry on failure)
    let noteId: string | null = null;
    try {
      noteId = await this.generateNote(conversation, transcript);
    } catch (error) {
      console.error(
        `[NoteGenerator] First attempt failed for conversation ${conversation._id}:`,
        error,
      );

      // Retry after delay
      await new Promise((resolve) =>
        setTimeout(resolve, AUTO_NOTES_CONFIG.NOTE_GENERATION_RETRY_DELAY_MS),
      );

      try {
        noteId = await this.generateNote(conversation, transcript);
      } catch (retryError) {
        console.error(
          `[NoteGenerator] Retry failed for conversation ${conversation._id}:`,
          retryError,
        );
        await this.markFailed(conversation);
        return null;
      }
    }

    return noteId;
  }

  private async generateNote(
    conversation: ConversationI,
    transcript: string,
  ): Promise<string> {
    const prompt = `You are analyzing a conversation transcript captured from smart glasses. Generate a structured note from this conversation.

Conversation date: ${conversation.date}
Started: ${new Date(conversation.startTime).toLocaleTimeString("en-US")}
${conversation.endTime ? `Ended: ${new Date(conversation.endTime).toLocaleTimeString("en-US")}` : ""}

Full transcript:
---
${transcript}
---

Generate a structured note with the following sections. Use markdown formatting:

# [Title - max 5 words, descriptive]

## Participants
[List speakers if identifiable, otherwise "Speaker 1, Speaker 2, etc."]

## Summary
[2-3 paragraph overview of what was discussed]

## Key Points
[Bulleted list of important facts, information shared]

## Decisions Made
[Bulleted list of any decisions. Write "None identified" if no clear decisions were made]

## Action Items
[Bulleted list with owners if identifiable. Write "None identified" if no action items]

Be concise but thorough. Focus on capturing the substance of the conversation.`;

    const response = await this.provider!.chat(
      [{ role: "user", content: prompt }],
      {
        tier: AUTO_NOTES_CONFIG.NOTE_GENERATION_MODEL_TIER,
        maxTokens: AUTO_NOTES_CONFIG.NOTE_GENERATION_MAX_TOKENS,
        temperature: 0.3,
      },
    );

    const noteContent =
      response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("")
        .trim() || "";

    if (!noteContent) {
      throw new Error("LLM returned empty response");
    }

    // Extract title from the first line (# Title)
    const titleMatch = noteContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : "Conversation Note";

    // Extract summary for the note summary field
    const summaryMatch = noteContent.match(
      /## Summary\n([\s\S]*?)(?=\n## |$)/,
    );
    const summary = summaryMatch
      ? summaryMatch[1].trim().substring(0, 300)
      : "";

    // Create the note using the existing Note model
    const note = await createNote(conversation.userId, {
      title,
      content: noteContent,
      summary,
      date: conversation.date,
      isAIGenerated: true,
      transcriptRange: {
        startTime: conversation.startTime,
        endTime: conversation.endTime || new Date(),
      },
    });

    // Link note to conversation
    await updateConversation(conversation._id!.toString(), {
      noteId: note._id!.toString(),
      title,
      noteGenerationFailed: false,
    });

    console.log(
      `[NoteGenerator] Generated note "${title}" for conversation ${conversation._id}`,
    );

    this._onNoteGeneration?.(
      conversation,
      "completed",
      note._id!.toString(),
    );

    return note._id!.toString();
  }

  private async markFailed(conversation: ConversationI): Promise<void> {
    await updateConversation(conversation._id!.toString(), {
      noteGenerationFailed: true,
    });

    this._onNoteGeneration?.(conversation, "failed");

    console.error(
      `[NoteGenerator] Marked conversation ${conversation._id} as noteGenerationFailed`,
    );
  }
}
