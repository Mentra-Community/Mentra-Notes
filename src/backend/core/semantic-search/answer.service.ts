/**
 * Answer Service (Phase 3)
 *
 * Generates AI quick answers from semantic search results.
 * Uses the existing LLM provider infrastructure.
 */

import { createProviderFromEnv } from "../../services/llm";
import type { SearchResult } from "./search.service";

/**
 * Generate a concise AI answer based on search results.
 */
export async function generateAnswer(
  query: string,
  searchResults: SearchResult[],
): Promise<string> {
  const top = searchResults.slice(0, 5);

  const context = top
    .map((r, i) => {
      const label = r.type === "note" ? "Note" : "Transcript";
      const body = r.type === "note" ? (r.content || r.summary) : r.summary;
      return `[${i + 1}] ${label}: "${r.title}" (${r.date})\n${body}`;
    })
    .join("\n\n");

  try {
    const provider = createProviderFromEnv();
    const response = await provider.chat(
      [
        {
          role: "user",
          content: `Question: ${query}\n\nContext:\n${context}`,
        },
      ],
      {
        tier: "fast",
        maxTokens: 512,
        systemPrompt:
          "You are a helpful assistant. Answer the user's question based ONLY on the provided context. If the context doesn't contain enough information, say so. Be concise — 1-3 sentences.",
      },
    );

    const text =
      typeof response.content === "string"
        ? response.content
        : response.content
            .filter((c) => c.type === "text")
            .map((c) => (c as any).text)
            .join("");

    return text.trim() || "I couldn't find enough information to answer that.";
  } catch (error) {
    console.error("[AnswerService] Failed to generate answer:", error);
    return "Unable to generate an answer at this time.";
  }
}
