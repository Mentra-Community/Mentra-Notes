/**
 * Search Service
 *
 * Search over notes (semantic vector search) and transcripts (text search
 * over hour-summary titles + bodies). Returns a merged result set.
 *
 * The Conversation branch is intentionally disconnected — the conversation
 * visualization feature is deprecated user-facing, but the embeddings still
 * generate in the background (see conversation.model). The `searchConversations`
 * helper below is kept so we can re-enable it with a single diff if needed.
 */

import { generateEmbedding } from "../../services/embedding.service";
import { Note } from "../../models/note.model";
import { Conversation } from "../../models/conversation.model";
import { searchHourSummaries } from "../../models/hour-summary.model";

export type SearchResult =
  | {
      id: string;
      type: "note";
      title: string;
      summary: string;
      date: string;
      score: number;
      content?: string;
    }
  | {
      id: string;
      type: "transcript";
      title: string;
      summary: string;
      date: string;
      hour: number;
      hourLabel: string;
      score: number;
    };

/**
 * Perform search across notes (semantic) and transcript hour summaries (text).
 */
export async function semanticSearch(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  console.log(`[SearchService] Searching for "${query}" (userId: ${userId}, limit: ${limit})`);

  const queryEmbedding = await generateEmbedding(query);
  console.log(`[SearchService] Generated query embedding (${queryEmbedding.length} dims)`);

  const [noteResults, transcriptResults] = await Promise.all([
    searchNotes(userId, query, queryEmbedding, limit),
    searchTranscripts(userId, query, limit),
  ]);

  console.log(
    `[SearchService] Notes: ${noteResults.length}, Transcripts: ${transcriptResults.length}`,
  );

  // Different scoring scales (vector 0-1 vs text score). The frontend presents
  // them in separate sections so we don't need a unified ranking — return both,
  // each sorted within its own group, capped to `limit` per type.
  const NOTE_MIN_SCORE = 0.6;
  const notes = noteResults
    .filter((r) => r.score >= NOTE_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const transcripts = transcriptResults
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  console.log(
    `[SearchService] After filtering: ${notes.length} notes, ${transcripts.length} transcripts`,
  );

  return [...notes, ...transcripts];
}

async function searchNotes(
  userId: string,
  query: string,
  queryVector: number[],
  limit: number,
): Promise<Array<Extract<SearchResult, { type: "note" }>>> {
  // Run vector semantic search and an exact/partial title regex in parallel,
  // then merge: title hits are boosted so when the user types a note's actual
  // title it reliably lands at the top, even if its embedding drift would
  // otherwise rank it below a loosely-related note.
  const [vectorResults, titleResults] = await Promise.all([
    vectorSearchNotes(userId, queryVector, limit),
    titleSearchNotes(userId, query, limit),
  ]);

  const byId = new Map<string, Extract<SearchResult, { type: "note" }>>();
  for (const n of vectorResults) byId.set(n.id, n);
  for (const n of titleResults) {
    const existing = byId.get(n.id);
    if (existing) {
      // Keep the richer record from vector search but boost score
      byId.set(n.id, { ...existing, score: Math.max(existing.score, n.score) });
    } else {
      byId.set(n.id, n);
    }
  }
  return [...byId.values()];
}

async function vectorSearchNotes(
  userId: string,
  queryVector: number[],
  limit: number,
): Promise<Array<Extract<SearchResult, { type: "note" }>>> {
  try {
    const results = await Note.aggregate([
      {
        $vectorSearch: {
          index: "notes_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: 50,
          limit,
          filter: { userId },
        },
      },
      {
        $project: {
          title: 1,
          summary: 1,
          content: 1,
          date: 1,
          createdAt: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);

    return results.map((r) => ({
      id: r._id.toString(),
      type: "note" as const,
      title: r.title || "",
      summary: r.summary || "",
      date: r.date || "",
      score: r.score,
      content: r.content,
    }));
  } catch (error: any) {
    console.error("[SearchService] Notes vector search failed:", error?.message || error);
    console.error("[SearchService] Full error:", JSON.stringify(error, null, 2));
    return [];
  }
}

async function titleSearchNotes(
  userId: string,
  query: string,
  limit: number,
): Promise<Array<Extract<SearchResult, { type: "note" }>>> {
  const q = query.trim();
  if (!q) return [];
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await Note.find({
      userId,
      title: { $regex: escaped, $options: "i" },
    })
      .limit(limit)
      .lean();

    const lowerQ = q.toLowerCase();
    return docs.map((d: any) => {
      const titleLower = String(d.title || "").toLowerCase();
      // Boost exact title > starts-with > contains. Use a score well above the
      // vector-search scale (0-1) so title hits outrank pure semantic matches.
      let score = 1.5;
      if (titleLower === lowerQ) score = 3;
      else if (titleLower.startsWith(lowerQ)) score = 2.2;

      return {
        id: d._id.toString(),
        type: "note" as const,
        title: d.title || "",
        summary: d.summary || "",
        date: d.date || "",
        score,
        content: d.content,
      };
    });
  } catch (error: any) {
    console.error("[SearchService] Notes title search failed:", error?.message || error);
    return [];
  }
}

async function searchTranscripts(
  userId: string,
  query: string,
  limit: number,
): Promise<Array<Extract<SearchResult, { type: "transcript" }>>> {
  try {
    const rows = await searchHourSummaries(userId, query, limit);
    return rows.map((r: any) => {
      // `summary` stores "Title\nBody" — split for a cleaner UI. Fall back to
      // the whole string if the LLM didn't include a newline.
      const lines = String(r.summary || "").split("\n").filter((l) => l.trim());
      const title = lines[0]?.trim() || r.hourLabel || "Transcript";
      const body = lines.slice(1).join(" ").trim();

      return {
        id: `${r.date}_${r.hour}`,
        type: "transcript" as const,
        title,
        summary: body || title,
        date: r.date,
        hour: r.hour,
        hourLabel: r.hourLabel,
        score: typeof r.score === "number" ? r.score : 0,
      };
    });
  } catch (error: any) {
    console.error("[SearchService] Transcript search failed:", error?.message || error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Deprecated: Conversation search. Not called from `semanticSearch`. Kept so
// we can revive it later by adding it back to the `Promise.all` above.
// ---------------------------------------------------------------------------

// Retained for future use, intentionally unused.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _searchConversations(
  userId: string,
  queryVector: number[],
  limit: number,
): Promise<Array<{
  id: string;
  type: "conversation";
  title: string;
  summary: string;
  date: string;
  score: number;
}>> {
  try {
    const results = await Conversation.aggregate([
      {
        $vectorSearch: {
          index: "conversations_vector_index",
          path: "embedding",
          queryVector,
          numCandidates: 50,
          limit,
          filter: { userId },
        },
      },
      {
        $project: {
          title: 1,
          aiSummary: 1,
          date: 1,
          startTime: 1,
          score: { $meta: "vectorSearchScore" },
        },
      },
    ]);

    return results.map((r) => ({
      id: r._id.toString(),
      type: "conversation" as const,
      title: r.title || "",
      summary: r.aiSummary || "",
      date: r.date || "",
      score: r.score,
    }));
  } catch (error: any) {
    console.error("[SearchService] Conversations vector search failed:", error?.message || error);
    return [];
  }
}
