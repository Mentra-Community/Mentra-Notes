/**
 * TranscriptSegmentSearch Model
 *
 * Flat, search-only mirror of every FINAL transcript segment the user has
 * spoken. Raw segments live either in DailyTranscript (recent) or R2 (older),
 * but phrase search needs a single queryable source — so this collection is
 * populated on live ingest AND from an R2 backfill job, and stays populated
 * even after segments migrate to R2.
 *
 * Photo segments are intentionally NOT indexed here (see issue #26 plan).
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import { HourSummary } from "./hour-summary.model";

// =============================================================================
// Interfaces
// =============================================================================

export interface TranscriptSegmentSearchI extends Document {
  userId: string;
  date: string; // YYYY-MM-DD in user's timezone
  hour: number; // 0-23 in user's timezone
  segIndex: number; // Position within the day
  segId: string; // Stable id: `${date}-${segIndex}` (matches deep-link #seg-<id>)
  text: string; // The segment's final text
  timestamp: Date;
  speakerId?: string;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const TranscriptSegmentSearchSchema = new Schema<TranscriptSegmentSearchI>(
  {
    userId: { type: String, required: true },
    date: { type: String, required: true },
    hour: { type: Number, required: true },
    segIndex: { type: Number, required: true },
    segId: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, required: true },
    speakerId: { type: String },
  },
  { timestamps: true },
);

// Unique per (user, date, segIndex) — idempotent upserts from live ingest + backfill
TranscriptSegmentSearchSchema.index(
  { userId: 1, date: 1, segIndex: 1 },
  { unique: true },
);

// For recency sort + pagination
TranscriptSegmentSearchSchema.index({ userId: 1, timestamp: -1 });

// Mongo text index for $text prefilter (narrows candidate set before the
// JS substring-ordered phrase filter runs)
TranscriptSegmentSearchSchema.index({ text: "text" });

// =============================================================================
// Model
// =============================================================================

export const TranscriptSegmentSearch: Model<TranscriptSegmentSearchI> =
  mongoose.models.TranscriptSegmentSearch ||
  mongoose.model<TranscriptSegmentSearchI>(
    "TranscriptSegmentSearch",
    TranscriptSegmentSearchSchema,
  );

// =============================================================================
// Helpers
// =============================================================================

export interface UpsertSegmentInput {
  userId: string;
  date: string;
  hour: number;
  segIndex: number;
  text: string;
  timestamp: Date;
  speakerId?: string;
}

export function buildSegId(date: string, segIndex: number): string {
  return `${date}-${segIndex}`;
}

/**
 * Upsert one segment. Called from live ingest in TranscriptManager.
 */
export async function upsertSearchSegment(
  input: UpsertSegmentInput,
): Promise<void> {
  const segId = buildSegId(input.date, input.segIndex);
  await TranscriptSegmentSearch.updateOne(
    { userId: input.userId, date: input.date, segIndex: input.segIndex },
    {
      $set: {
        hour: input.hour,
        segId,
        text: input.text,
        timestamp: input.timestamp,
        speakerId: input.speakerId,
      },
      $setOnInsert: {
        userId: input.userId,
        date: input.date,
        segIndex: input.segIndex,
      },
    },
    { upsert: true },
  );
}

/**
 * Bulk upsert. Used by the R2 backfill job.
 */
export async function bulkUpsertSearchSegments(
  inputs: UpsertSegmentInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const ops = inputs.map((i) => ({
    updateOne: {
      filter: { userId: i.userId, date: i.date, segIndex: i.segIndex },
      update: {
        $set: {
          hour: i.hour,
          segId: buildSegId(i.date, i.segIndex),
          text: i.text,
          timestamp: i.timestamp,
          speakerId: i.speakerId,
        },
        $setOnInsert: {
          userId: i.userId,
          date: i.date,
          segIndex: i.segIndex,
        },
      },
      upsert: true,
    },
  }));
  const res = await TranscriptSegmentSearch.bulkWrite(ops, { ordered: false });
  return (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
}

/**
 * Delete search rows for a date (cascade from day-trash / empty-trash).
 */
export async function deleteSearchSegmentsForDate(
  userId: string,
  date: string,
): Promise<number> {
  const res = await TranscriptSegmentSearch.deleteMany({ userId, date });
  return res.deletedCount ?? 0;
}

// =============================================================================
// Query — the phrase search itself
// =============================================================================

/**
 * Normalize a string the same way on both sides of the match:
 * lowercase, strip diacritics, collapse any non-alphanumeric into single spaces.
 * The result is what the substring-ordered match runs against.
 */
export function normalizeForPhraseMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Given a raw segment text and a normalized phrase, return the [start, end]
 * ranges inside the RAW text that correspond to matches of the phrase. We
 * walk the raw text once, maintaining a parallel "normalized cursor" so the
 * ranges map back to the original characters even with stripped punctuation.
 *
 * Returns an empty array if the phrase doesn't match.
 */
export function findMatchRanges(
  rawText: string,
  normalizedPhrase: string,
): Array<[number, number]> {
  if (!normalizedPhrase) return [];

  // Build a parallel string of the same length as rawText where each char is
  // either its normalized form or a space. That way rawText[i] aligns with
  // normalizedChars[i] positionally.
  const lowered = rawText.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  // NOTE: normalize("NFD") can produce combining marks at positions we then
  // strip, which shifts lengths. Rebuild index-by-index off the ORIGINAL text.
  const norm: string[] = new Array(rawText.length);
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    // A decomposed char can expand to >1 code unit; we only keep the base.
    const base = ch[0] || " ";
    norm[i] = /[a-z0-9]/.test(base) ? base : " ";
  }

  // Collapse runs of spaces in `norm` into a compact string, tracking
  // original indices so we can translate normalized positions back.
  let compact = "";
  const compactToOrig: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === " ") {
      if (!lastWasSpace) {
        compact += " ";
        compactToOrig.push(i);
        lastWasSpace = true;
      }
    } else {
      compact += c;
      compactToOrig.push(i);
      lastWasSpace = false;
    }
  }
  const compactTrimmed = compact.replace(/^\s+|\s+$/g, "");
  // Recompute index offset if we trimmed leading space.
  const leadTrim = compact.length - compact.replace(/^\s+/, "").length;
  const trimmedToOrig = compactToOrig.slice(leadTrim, leadTrim + compactTrimmed.length);

  const ranges: Array<[number, number]> = [];
  let from = 0;
  while (from <= compactTrimmed.length - normalizedPhrase.length) {
    const at = compactTrimmed.indexOf(normalizedPhrase, from);
    if (at === -1) break;
    const endIn = at + normalizedPhrase.length - 1;
    const origStart = trimmedToOrig[at];
    const origEnd = trimmedToOrig[endIn];
    if (origStart !== undefined && origEnd !== undefined) {
      ranges.push([origStart, origEnd + 1]);
    }
    from = at + Math.max(1, normalizedPhrase.length);
  }

  // Suppress lint for unused intermediate (was helpful during dev)
  void lowered;
  return ranges;
}

// ============================================================================
// Fuzzy matching (used only as fallback when exact match returns 0 results).
// ============================================================================

/**
 * Levenshtein distance between two strings, capped at `max`. Returns `max + 1`
 * if the distance exceeds `max` — saves us computing irrelevant large values.
 * Uses the classic two-row dynamic-programming approach.
 */
function levenshteinAtMost(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // early exit: no path stays within `max`
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Two words are "fuzzy-equal" at edit distance ≤1 when both are ≥3 chars.
 * Shorter words (1-2 chars) must match exactly to avoid matching EVERY
 * 3-letter word as a 1-char substitution away from the query.
 */
function wordsFuzzyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 3 || b.length < 3) return false;
  return levenshteinAtMost(a, b, 1) <= 1;
}

/**
 * Tokenize a normalized string into words.
 */
function tokenize(s: string): string[] {
  return s.split(" ").filter(Boolean);
}

/**
 * Find ranges in `rawText` that correspond to a fuzzy phrase match.
 *
 * Rules (locked with user):
 * - Each query word can be off by ≤1 edit (insertion/deletion/substitution)
 *   against the target word at the same position (min length 3 for fuzziness).
 * - For phrases of 3+ words: one extra word in the target OR one missing
 *   word in the query is allowed, but only at the edges — the matched span
 *   cannot skip a word in the middle.
 * - Word ORDER is preserved. Always.
 *
 * Returns [] if no fuzzy match found.
 */
export function findFuzzyMatchRanges(
  rawText: string,
  normalizedPhrase: string,
): Array<[number, number]> {
  if (!normalizedPhrase) return [];
  const queryWords = tokenize(normalizedPhrase);
  if (queryWords.length === 0) return [];

  // Build the same compact/trimmed representation + compact→orig index map
  // used by the exact matcher, but keep word boundaries so we can walk
  // word-by-word instead of char-by-char.
  const norm: string[] = new Array(rawText.length);
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    const base = ch[0] || " ";
    norm[i] = /[a-z0-9]/.test(base) ? base : " ";
  }

  // Walk target, emitting words with their original start/end indices.
  const targetWords: Array<{ word: string; origStart: number; origEnd: number }> = [];
  let wStart = -1;
  let wBuf = "";
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === " ") {
      if (wStart !== -1) {
        targetWords.push({ word: wBuf, origStart: wStart, origEnd: i });
        wStart = -1;
        wBuf = "";
      }
    } else {
      if (wStart === -1) wStart = i;
      wBuf += c;
    }
  }
  if (wStart !== -1) {
    targetWords.push({ word: wBuf, origStart: wStart, origEnd: rawText.length });
  }
  if (targetWords.length === 0) return [];

  // Phrase-level edge tolerance (decision A): for queries with 3+ words,
  // allow either dropping the first or last query word, OR padding the
  // target window by one word on either side. Implemented as: generate
  // acceptable query variants, try each at every target start position.
  const variants: string[][] = [queryWords];
  if (queryWords.length >= 3) {
    variants.push(queryWords.slice(1));           // missing first word in query
    variants.push(queryWords.slice(0, -1));       // missing last word in query
  }

  const ranges: Array<[number, number]> = [];

  // Try matching each variant against every possible starting window.
  for (const qw of variants) {
    const n = qw.length;
    // Scan every possible start; also try target-skip-at-edges variants
    // (target has one extra word at start or end).
    for (let start = 0; start + n <= targetWords.length; start++) {
      // Standard window: same length as the query variant.
      if (matchWordWindow(qw, targetWords, start, n)) {
        const r: [number, number] = [
          targetWords[start].origStart,
          targetWords[start + n - 1].origEnd,
        ];
        if (!rangeOverlaps(ranges, r)) ranges.push(r);
        continue;
      }
    }
    // Try padded-target windows (one extra word included at the start or end
    // of the target span — matches "missing word in query" via the other side).
    // Only meaningful when the ORIGINAL query had 3+ words.
    if (queryWords.length >= 3 && qw === queryWords) {
      for (let start = 0; start + n + 1 <= targetWords.length; start++) {
        // Target has n+1 words; try matching query against target[start+1..start+n]
        if (matchWordWindow(qw, targetWords, start + 1, n)) {
          const r: [number, number] = [
            targetWords[start].origStart,
            targetWords[start + n].origEnd,
          ];
          if (!rangeOverlaps(ranges, r)) ranges.push(r);
        }
        // ...or target[start..start+n-1]
        if (matchWordWindow(qw, targetWords, start, n)) {
          const r: [number, number] = [
            targetWords[start].origStart,
            targetWords[start + n].origEnd,
          ];
          if (!rangeOverlaps(ranges, r)) ranges.push(r);
        }
      }
    }
  }

  // Sort ranges by start, stable.
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges;
}

function matchWordWindow(
  query: string[],
  target: Array<{ word: string }>,
  start: number,
  n: number,
): boolean {
  for (let i = 0; i < n; i++) {
    if (!wordsFuzzyEqual(query[i], target[start + i].word)) return false;
  }
  return true;
}

function rangeOverlaps(existing: Array<[number, number]>, r: [number, number]): boolean {
  for (const [s, e] of existing) {
    if (r[0] < e && r[1] > s) return true;
  }
  return false;
}

/**
 * Cross-segment stitching for phrases longer than any single segment.
 *
 * Strategy: for each unmatched candidate, pull a small window of its neighbor
 * segments (prev2..next2) from Mongo in one batch query, then try to match
 * the normalized phrase inside the concatenation. On a hit, anchor the result
 * to whichever underlying segment contains the START of the match.
 */
async function stitchPhraseAcrossSegments(
  userId: string,
  normalizedPhrase: string,
  unmatched: TranscriptSegmentSearchI[],
  fuzzy: boolean = false,
): Promise<PhraseSearchRow[]> {
  const WINDOW = 4; // look up to N segments before/after
  const GLUE = " "; // joiner between segments — a single space matches the normalizer
  const matchFn = fuzzy ? findFuzzyMatchRanges : findMatchRanges;

  // Build a single $or query for all neighbor segments we might need.
  const neighborFilter: Array<{ userId: string; date: string; segIndex: number }> = [];
  const seenKey = new Set<string>();
  for (const c of unmatched) {
    for (let delta = -WINDOW; delta <= WINDOW; delta++) {
      const idx = c.segIndex + delta;
      if (idx < 0) continue;
      const key = `${c.date}|${idx}`;
      if (seenKey.has(key)) continue;
      seenKey.add(key);
      neighborFilter.push({ userId, date: c.date, segIndex: idx });
    }
  }
  if (neighborFilter.length === 0) return [];

  const neighbors = (await TranscriptSegmentSearch.find({
    $or: neighborFilter,
  })
    .lean()) as unknown as TranscriptSegmentSearchI[];

  // Bucket neighbors by (date, segIndex) for O(1) window assembly.
  const byKey = new Map<string, TranscriptSegmentSearchI>();
  for (const n of neighbors) byKey.set(`${n.date}|${n.segIndex}`, n);

  const out: PhraseSearchRow[] = [];
  const emittedSegIds = new Set<string>();

  for (const c of unmatched) {
    // Try progressively wider windows. Each window is an array of consecutive
    // segments; we concat their texts with " " and try to phrase-match.
    for (let span = 2; span <= WINDOW * 2 + 1; span++) {
      // Each span can start anywhere from (c.segIndex - span + 1) .. c.segIndex
      // so that the original candidate is always included.
      for (let startOffset = -(span - 1); startOffset <= 0; startOffset++) {
        const segs: TranscriptSegmentSearchI[] = [];
        let gap = false;
        for (let i = 0; i < span; i++) {
          const idx = c.segIndex + startOffset + i;
          if (idx < 0) { gap = true; break; }
          const s = byKey.get(`${c.date}|${idx}`);
          if (!s) { gap = true; break; }
          segs.push(s);
        }
        if (gap || segs.length < 2) continue;

        // Build concatenated raw text + a parallel map from concat-index → (segArrIdx, localIdx)
        let concat = "";
        const owners: number[] = [];
        for (let i = 0; i < segs.length; i++) {
          const raw = segs[i].text;
          if (i > 0) {
            concat += GLUE;
            owners.push(-1);
          }
          for (let k = 0; k < raw.length; k++) {
            concat += raw[k];
            owners.push(i);
          }
        }

        const ranges = matchFn(concat, normalizedPhrase);
        if (ranges.length === 0) continue;

        // Anchor the hit to whichever segment holds the start of the first match.
        const [firstStart] = ranges[0];
        const anchorArrIdx = owners[firstStart] >= 0 ? owners[firstStart] : owners.find((o) => o >= 0) ?? 0;
        const anchor = segs[anchorArrIdx];
        if (!anchor || emittedSegIds.has(anchor.segId)) break;
        emittedSegIds.add(anchor.segId);

        // Translate match ranges from concat coordinates → anchor-local coordinates.
        // For the UI highlight we only care about the portion of the match that
        // lies within the anchor segment.
        const localRanges: Array<[number, number]> = [];
        // Compute the global start index of the anchor within `concat`.
        let anchorStart = 0;
        let running = 0;
        for (let i = 0; i < segs.length; i++) {
          if (i === anchorArrIdx) { anchorStart = running; break; }
          running += segs[i].text.length + GLUE.length;
        }
        const anchorEnd = anchorStart + anchor.text.length;
        for (const [s, e] of ranges) {
          const clipStart = Math.max(s, anchorStart);
          const clipEnd = Math.min(e, anchorEnd);
          if (clipEnd > clipStart) {
            localRanges.push([clipStart - anchorStart, clipEnd - anchorStart]);
          }
        }
        // If the match starts in an earlier segment, still highlight the first
        // word of the anchor so the UI isn't blank — keep it simple.
        if (localRanges.length === 0 && anchor.text.length > 0) {
          localRanges.push([0, Math.min(anchor.text.length, 24)]);
        }

        out.push({
          segId: anchor.segId,
          date: anchor.date,
          hour: anchor.hour,
          segIndex: anchor.segIndex,
          text: anchor.text,
          timestamp: anchor.timestamp,
          speakerId: anchor.speakerId,
          matchRanges: localRanges,
        });
        // Stop widening windows once we found a match for this candidate.
        break;
      }
      if (emittedSegIds.size > 0 && emittedSegIds.has(
        (byKey.get(`${c.date}|${c.segIndex}`) ?? c).segId,
      )) break;
    }
  }

  return out;
}

export interface PhraseSearchRow {
  segId: string;
  date: string;
  hour: number;
  segIndex: number;
  text: string;
  timestamp: Date;
  speakerId?: string;
  matchRanges: Array<[number, number]>;
  before?: { text: string; segId: string };
  after?: { text: string; segId: string };
  /** AI-generated title for the segment's hour (from HourSummary). */
  hourTitle?: string;
}

export interface PhraseSearchResult {
  rows: PhraseSearchRow[];
  hasMore: boolean;
  nextOffset: number;
}

/**
 * Phrase search over segments.
 *
 * Two-stage to keep performance bounded on a potentially huge collection:
 *   1. Mongo `$text` narrows to docs containing each word (OR/AND per Mongo
 *      defaults — we pass a word-quoted query for implicit AND). Excludes
 *      trashed dates via the excludeDates filter.
 *   2. In JS, run the substring-ordered phrase match against the normalized
 *      text of each candidate. Keeps only true phrase hits.
 *
 * Sort is recency-first; pagination is offset-based (see plan D.25).
 */
export async function searchSegmentsByPhrase(params: {
  userId: string;
  query: string;
  offset: number;
  limit: number;
  excludeDates?: string[]; // trashed dates the UI shouldn't surface
}): Promise<PhraseSearchResult> {
  const { userId, query, offset, limit } = params;
  const excludeDates = params.excludeDates ?? [];

  const normalized = normalizeForPhraseMatch(query);
  if (!normalized) {
    return { rows: [], hasMore: false, nextOffset: offset };
  }

  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) {
    return { rows: [], hasMore: false, nextOffset: offset };
  }

  const dateFilter: Record<string, unknown> =
    excludeDates.length > 0 ? { date: { $nin: excludeDates } } : {};

  // Over-fetch so the in-JS phrase filter has room to find `limit` true matches
  // past `offset`. Cap hard to avoid runaway memory. Bumped from 1000 to 5000
  // because long phrases can scan a lot of candidates before finding exact hits.
  const CANDIDATE_CAP = Math.min(5000, Math.max(500, (offset + limit) * 10));

  // Mongo `$text` silently drops short / stop words ("i", "a", "on", etc.),
  // so a phrase that's mostly stop words can match zero candidates even when
  // it's literally present in the text. Pick the distinctive words (>=3 chars)
  // for the $text prefilter. If there aren't enough of those, skip $text and
  // use a plain regex-AND prefilter instead.
  const distinctiveWords = words.filter((w) => w.length >= 3);
  const useTextIndex = distinctiveWords.length >= 1;

  let candidates: TranscriptSegmentSearchI[] = [];
  if (useTextIndex) {
    // Long phrases are almost always split across multiple segments — no
    // single segment will contain ALL the distinctive words. We pick the
    // rarest 2 (longest) words, because Mongo $text with quoted phrases is
    // AND by default and we need the set of candidate segments to overlap
    // with the phrase's stitched neighborhood. The stitcher expands from
    // each candidate with a ±4 window.
    const textWords =
      words.length > 6
        ? [...distinctiveWords].sort((a, b) => b.length - a.length).slice(0, 2)
        : distinctiveWords;
    const textQuery = textWords
      .map((w) => `"${w.replace(/"/g, '\\"')}"`)
      .join(" ");
    try {
      candidates = (await TranscriptSegmentSearch.find(
        { userId, ...dateFilter, $text: { $search: textQuery } },
        { score: { $meta: "textScore" } } as any,
      )
        .sort({ timestamp: -1 })
        .limit(CANDIDATE_CAP)
        .lean()) as unknown as TranscriptSegmentSearchI[];
    } catch (err) {
      console.warn("[TranscriptSegmentSearch] $text failed, regex fallback:", err);
    }
  }

  // Regex-AND fallback: no $text, or $text errored, or every query word was a
  // stop word. Slower but always correct.
  //
  // For long phrases (>6 words) we DON'T require every word in a single
  // segment — the phrase is likely split across multiple segments and the
  // stitching step below will glue them back together. Instead we pick the
  // 4 most distinctive words (sorted by length as a cheap "rarity" proxy) and
  // require any segment contain all of those. That keeps the candidate set
  // bounded while still letting the stitcher see enough neighborhoods.
  if (candidates.length === 0) {
    const requireWords =
      words.length > 6
        ? [...distinctiveWords].sort((a, b) => b.length - a.length).slice(0, 2)
        : words;
    console.log(
      `[TranscriptSegmentSearch] Regex prefilter (useTextIndex=${useTextIndex}, distinctive=${distinctiveWords.length}, require=${requireWords.length}/${words.length})`,
    );
    if (requireWords.length === 0) {
      // Nothing to prefilter on — bail rather than full-scan.
      return { rows: [], hasMore: false, nextOffset: offset };
    }
    const escaped = requireWords.map((w) =>
      w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const regex = new RegExp(
      escaped.map((w) => `(?=[\\s\\S]*\\b${w})`).join(""),
      "i",
    );
    candidates = (await TranscriptSegmentSearch.find({
      userId,
      ...dateFilter,
      text: { $regex: regex },
    })
      .sort({ timestamp: -1 })
      .limit(CANDIDATE_CAP)
      .lean()) as unknown as TranscriptSegmentSearchI[];
  }

  // Last-ditch fallback: if the multi-word prefilter found nothing, try the
  // single rarest word alone. This hits the case where the phrase is split so
  // thoroughly that no single segment contains ANY pair of distinctive words.
  // Slow, but bounded by CANDIDATE_CAP and only runs when everything else failed.
  if (candidates.length === 0 && distinctiveWords.length > 0) {
    const rarest = [...distinctiveWords].sort((a, b) => b.length - a.length)[0];
    console.log(
      `[TranscriptSegmentSearch] Single-word fallback on "${rarest}"`,
    );
    const escaped = rarest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    candidates = (await TranscriptSegmentSearch.find({
      userId,
      ...dateFilter,
      text: { $regex: new RegExp(`\\b${escaped}`, "i") },
    })
      .sort({ timestamp: -1 })
      .limit(CANDIDATE_CAP)
      .lean()) as unknown as TranscriptSegmentSearchI[];
  }

  console.log(
    `[TranscriptSegmentSearch] query="${query}" words=${words.length} candidates=${candidates.length}`,
  );

  // Stage 2: true substring-ordered phrase filter.
  // First pass: try to match the phrase inside each candidate's own text.
  // Second pass: for any candidate that didn't match AND whose own text is
  // likely too short to hold the phrase, stitch with its neighbor segments
  // (prev + curr, curr + next, prev + curr + next) and anchor the hit to
  // whichever stitched segment contains the start of the match.
  const matches: PhraseSearchRow[] = [];
  const unmatchedForStitch: TranscriptSegmentSearchI[] = [];

  for (const c of candidates) {
    const ranges = findMatchRanges(c.text, normalized);
    if (ranges.length > 0) {
      matches.push({
        segId: c.segId,
        date: c.date,
        hour: c.hour,
        segIndex: c.segIndex,
        text: c.text,
        timestamp: c.timestamp,
        speakerId: c.speakerId,
        matchRanges: ranges,
      });
    } else if (words.length >= 2) {
      // Any multi-word phrase that didn't match in-segment is a candidate for
      // cross-segment stitching. Single-word queries only live in one segment
      // by definition, so stitching can't help them.
      unmatchedForStitch.push(c);
    }
  }

  if (unmatchedForStitch.length > 0) {
    const stitched = await stitchPhraseAcrossSegments(
      userId,
      normalized,
      unmatchedForStitch,
    );
    console.log(
      `[TranscriptSegmentSearch] Stitcher: ${unmatchedForStitch.length} candidates → ${stitched.length} stitched matches`,
    );
    for (const m of stitched) {
      // Dedupe against direct matches (same segId)
      if (!matches.some((existing) => existing.segId === m.segId)) {
        matches.push(m);
      }
    }
    // Re-sort by recency after stitched rows get interleaved
    matches.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }
  console.log(
    `[TranscriptSegmentSearch] Total matches after stage 2: ${matches.length}`,
  );

  // Stage 3 (fallback): fuzzy match. Only runs when exact match found nothing.
  // Same two passes (in-segment + stitched-across), but using fuzzy range
  // detection that tolerates ≤1 edit per word (min word length 3) and
  // missing/extra word at phrase edges for 3+ word queries.
  if (matches.length === 0) {
    console.log(`[TranscriptSegmentSearch] Exact returned 0 — trying fuzzy fallback`);
    const fuzzyMatches: PhraseSearchRow[] = [];
    const fuzzyUnmatched: TranscriptSegmentSearchI[] = [];
    for (const c of candidates) {
      const ranges = findFuzzyMatchRanges(c.text, normalized);
      if (ranges.length > 0) {
        fuzzyMatches.push({
          segId: c.segId,
          date: c.date,
          hour: c.hour,
          segIndex: c.segIndex,
          text: c.text,
          timestamp: c.timestamp,
          speakerId: c.speakerId,
          matchRanges: ranges,
        });
      } else if (words.length >= 2) {
        fuzzyUnmatched.push(c);
      }
    }
    if (fuzzyUnmatched.length > 0) {
      const stitched = await stitchPhraseAcrossSegments(
        userId,
        normalized,
        fuzzyUnmatched,
        /* fuzzy */ true,
      );
      console.log(
        `[TranscriptSegmentSearch] Fuzzy stitcher: ${fuzzyUnmatched.length} candidates → ${stitched.length} stitched matches`,
      );
      for (const m of stitched) {
        if (!fuzzyMatches.some((existing) => existing.segId === m.segId)) {
          fuzzyMatches.push(m);
        }
      }
    }
    fuzzyMatches.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    matches.push(...fuzzyMatches);
    console.log(
      `[TranscriptSegmentSearch] After fuzzy fallback: ${matches.length} matches`,
    );
  }

  // Slice into the requested page.
  const page = matches.slice(offset, offset + limit);
  const hasMore = matches.length > offset + limit;

  // Hydrate before/after context for the page. Single query per date+range,
  // but most pages will span few dates so this is cheap.
  if (page.length > 0) {
    const neighborFilter = page.flatMap((m) => [
      { userId, date: m.date, segIndex: m.segIndex - 1 },
      { userId, date: m.date, segIndex: m.segIndex + 1 },
    ]);
    const neighbors = (await TranscriptSegmentSearch.find({
      $or: neighborFilter,
    })
      .select({ date: 1, segIndex: 1, text: 1, segId: 1 })
      .lean()) as unknown as TranscriptSegmentSearchI[];
    const byKey = new Map<string, TranscriptSegmentSearchI>();
    for (const n of neighbors) byKey.set(`${n.date}|${n.segIndex}`, n);

    for (const m of page) {
      const before = byKey.get(`${m.date}|${m.segIndex - 1}`);
      const after = byKey.get(`${m.date}|${m.segIndex + 1}`);
      if (before) m.before = { text: before.text, segId: before.segId };
      if (after) m.after = { text: after.text, segId: after.segId };
    }

    // Hydrate the hour title (AI-generated summary's first line) so each
    // sentence row can show the surrounding topic at a glance.
    const hourKeys = page.map((m) => ({ userId, date: m.date, hour: m.hour }));
    const uniqueHourKeySet = new Set<string>();
    const hourLookup = hourKeys.filter((k) => {
      const key = `${k.date}|${k.hour}`;
      if (uniqueHourKeySet.has(key)) return false;
      uniqueHourKeySet.add(key);
      return true;
    });
    if (hourLookup.length > 0) {
      const summaries = (await HourSummary.find({ $or: hourLookup })
        .select({ date: 1, hour: 1, summary: 1 })
        .lean()) as unknown as Array<{ date: string; hour: number; summary: string }>;
      const titleByKey = new Map<string, string>();
      for (const s of summaries) {
        // Summary is stored as "Title\nBody" — take just the title line.
        const title = (s.summary || "").split("\n").find((l) => l.trim())?.trim();
        if (title) titleByKey.set(`${s.date}|${s.hour}`, title);
      }
      for (const m of page) {
        const t = titleByKey.get(`${m.date}|${m.hour}`);
        if (t) m.hourTitle = t;
      }
    }
  }

  return {
    rows: page,
    hasMore,
    nextOffset: offset + page.length,
  };
}
