# Plan: Transcript Phrase Search — Exact text search over segments w/ highlight deep-link

## TL;DR of the feature (as I understood it)

Add a **third branch** to the existing Search page: search the literal text of
transcript segments (the things the user actually said), not the AI hour
summaries. Search must be **exact phrase / exact word** — NOT semantic. No
embeddings, no vector index, no LLM — classic string matching only.

Result rows render with the **matched segment highlighted in yellow**, plus a
small window of **before/after** segments for context. Tapping a row opens
`/transcript/{date}` at the exact segment — the target segment is
**highlighted in yellow for ~2s** then fades back to normal.

## Locked decisions (from user)

1. **Substring match**, not word-boundary. `"cat"` matches inside `"category"`. More forgiving; user preference.
2. **Infinite-scroll pagination**, 50 results per page, **no per-day cap**. Repeated phrases ("okay") can dominate — user scrolls past them.
3. **Min query length = 3 chars** for the transcript-sentence branch.
4. **Backfill existing R2 history** into the new search collection on deploy. Show a "still indexing older days…" hint while it runs.
5. **New dedicated section** in the Search UI: `Transcript sentences · N` below the existing hour-summary `Transcripts` section.
6. **Ignore photo segments entirely** — `type: "photo"` is not indexed and not returned. Raw transcript text only.

## Where this plugs into what already exists

- Search UI: [src/frontend/pages/search/SearchPage.tsx](../../src/frontend/pages/search/SearchPage.tsx)
  already has two sections — `Notes` (semantic) and `Transcripts` (hour-summary text).
  We add a **third section**: `Transcript sentences` (or just extend the
  Transcripts section with a sub-group — see UX decision below).
- Search API: [src/backend/api/router.ts](../../src/backend/api/router.ts) — `GET /api/search` already wires `semanticSearch()`. We extend its output.
- Search service: [src/backend/core/semantic-search/search.service.ts](../../src/backend/core/semantic-search/search.service.ts) — add a new `searchTranscriptSegments()` branch, merged into the `Promise.all`.
- Data sources the segments live in — **two places, must both be searched**:
  1. **MongoDB**: [DailyTranscript](../../src/backend/models/daily-transcript.model.ts) — today + any days not yet batched to R2.
  2. **R2**: `transcripts/{userId}/{date}/transcript.json` — batched older days. See [r2Fetch.service.ts](../../src/backend/services/r2Fetch.service.ts) + [r2Batch.service.ts](../../src/backend/services/r2Batch.service.ts).
- Transcript view (jump target): [TranscriptPage.tsx](../../src/frontend/pages/transcript/TranscriptPage.tsx) + [TranscriptTab.tsx](../../src/frontend/pages/day/components/tabs/TranscriptTab.tsx). Already supports `#hour-N` hash → expand + scroll that hour. We extend with `#seg-<id>` for segment-level scroll + yellow flash.

---

## Edge cases you should know about — THIS IS THE WHOLE POINT OF THE DOC

### A. What "exact phrase" actually means (define before coding)

1. **Substring match** (locked). `"cat"` matches `"category"`. No word-boundary regex. Simplest, most forgiving.
2. **Case insensitive.** Lowercase both query and target before matching.
3. **Phrase vs multi-word.** If the user types `"smart glasses are cool"` — treat as a literal phrase match (whitespace-flexible). Current hour-summary search splits on spaces and ANDs the words (order-independent); for transcripts that would give misleading "matches" where the words are 20 minutes apart. **Phrase-order-preserving** is what you want here. Collapse runs of whitespace to `\s+`.
4. **Punctuation.** Raw ASR segments often have or omit punctuation depending on the provider. Strip or soft-match punctuation: `"let's go"` should match `"lets go"` and `"let's go,"`. Normalize both sides: lowercase, strip non-alphanumerics into spaces, collapse whitespace, then substring-match.
5. **Numbers / symbols.** `"$100"` after normalization becomes `"100"` — will match `"100 bucks"`. Document it.
6. **Diacritics / unicode.** Strip accents on both query and target (`é` → `e`) to avoid silent misses. Use `String.prototype.normalize("NFD").replace(/\p{Diacritic}/gu, "")`.
7. **Empty / whitespace-only query.** Must no-op; already handled upstream in `doSearch` but re-check.
8. **Min length = 3 chars** (locked) for the transcript-segment branch only. Notes + hour summaries stay at their existing behavior.
9. **Very long query (>200 chars).** Cap length before regex to avoid a ReDoS-shaped slowdown.
10. **Special regex chars in user input.** MUST escape — `.*+?^${}()|[]\` — the current title-search code already has this pattern, copy it.

### B. Data source & pagination — this is the biggest risk

11. **Today's segments live only in MongoDB** (`DailyTranscript.segments`). Older days get batched to R2 via `batchTranscriptsToR2()` and **deleted from Mongo** (`deleteProcessedSegments`). So a naive Mongo-only search will silently miss everything older than ~1 day. → Search MUST hit BOTH stores and merge.
12. **No text index on `DailyTranscript.segments.text`** today. Adding `{ "segments.text": "text" }` indexes the whole subdoc array — Mongo's $text on array-of-subdocs works but has gotchas (no phrase-order control, OR across words). For **phrase-exact**, Mongo $text is actually the wrong tool. Use `$regex` with an anchored escaped phrase against segments, per-doc — acceptable perf because `{userId, date}` prefix already narrows hard.
13. **R2 search strategy.** R2 has no server-side full-text search. Options:
    - (a) **On-demand per-date scan**: list all dates for user, fetch each `transcript.json`, regex client-side (inside the backend). Ugly and slow — 30 days × ~200KB each = 6MB per query. Don't.
    - (b) **Mirror R2 segments back into Mongo** with a search-only collection `TranscriptSegmentSearch { userId, date, hour, segIndex, text, ts }` + `{ userId, text: "text" }` index. Written on batch-to-R2, deleted on trash. This is the clean solution.
    - (c) **Elastic/Meili/Typesense sidecar.** Overkill for now.
    → **Recommend (b)**. We already keep `HourSummary` in Mongo even though raw segments go to R2 — follow the same pattern: keep a derived search index in Mongo, keep the blob in R2 for retrieval. Call out the storage cost — each segment is ~50–200 bytes of text. 3 months × 8h/day × ~500 segments/h ≈ 360k rows per active user. Fine for Mongo, must have `{userId: 1, date: -1}` + text index.
14. **Backfill problem.** Existing users already have historical data in R2 that was never written to the new search collection. Ship a one-time backfill job that reads R2 for each user and populates `TranscriptSegmentSearch`. Until the backfill runs, **search over old R2 days returns nothing** — need a feature-flag or "searching historical data may be incomplete" banner.
15. **Write consistency.** When a segment is appended live → also insert into search collection. When a day is batched to R2 → keep the search-collection rows (don't delete them just because they left `DailyTranscript`). When a user trashes a date → delete both the `DailyTranscript`, R2 object, AND the search-collection rows (see [wipeAllUserData.service.ts](../../src/backend/services/wipeAllUserData.service.ts) for the cascade pattern).
16. **Photo segments** (`type: "photo"`) — locked: **ignored entirely**. Not indexed, not returned, not shown. Only real transcript text.

### C. Segment granularity — sentence vs segment

17. **ASR returns "segments"**, not sentences. A segment might be one word, a short phrase, or a full sentence depending on silence detection. The user's spec says "highlight the sentence" — but we don't actually have sentences, we have segments. Two choices:
    - Treat **each segment as the match unit** (simpler, matches how `TranscriptTab` already renders).
    - Do sentence-segmentation (split on `.?!` with common-abbreviation guards) and highlight the sentence inside a segment.
    → Go with **segment as the unit** for v1. The UI already draws segments as discrete cards, and a "sentence" will typically == a segment. Document this and punt sentence-level highlighting as a followup.
18. **Context = before / after.** Grab the prior and next final segments in the same `date` for the context preview. If the segment is the first or last of the day, there is no before/after — render gracefully.
19. **Interim segments** (`isFinal: false`) must NEVER appear in results. They're unstable + duplicated by their final version.
20. **Multiple matches in one segment.** Highlight all instances, not just the first (regex global).
21. **Matches spanning two segments.** ASR sometimes splits sentences mid-phrase. v1: don't try to stitch across segments — a phrase that straddles two segments simply won't match. Note this as a known limitation; fix later with a sliding-window concat if it turns out to bite.

### D. Deduping / ranking / pagination

22. **Same phrase repeated** throughout the day ("okay", "yeah") → result set can be 500 rows of the same phrase. Locked: **no dedupe, no per-day cap**. Rely on infinite-scroll pagination — the user just scrolls past if they hit a wall of repeats. Simpler than clustering, matches search-as-you-scroll mental model.
23. **Pagination**: `GET /api/search?q=…&offset=0&limit=50` on the transcript-sentence branch. Response includes `{ results, hasMore, nextOffset }`. Frontend uses `IntersectionObserver` on a sentinel at the bottom of the section; when it enters the viewport and `hasMore`, fetch the next page and append. Cancel in-flight page fetches on query change (reuse existing `AbortController`). Notes + hour-summaries stay un-paginated (small result sets).
24. **Cross-day ranking.** `HourSummary` search uses Mongo text score. For phrase search there's no natural score — use **recency (newest first)** as the default sort, which is also what pagination needs to be stable (sort key is `{ timestamp: -1, segIndex: -1 }`).
25. **Stable pagination under live writes.** If new segments arrive mid-session while the user is paginating through old results, offset-based pagination can double-show or skip rows. Acceptable for v1 given how rarely matches will collide with live ingest; note as known caveat. Cursor-based pagination (`cursor = last_timestamp_segIndex`) is the fix if it bites.
26. **Section-internal scoring only.** Results render in their own section, so we don't need to cross-rank against notes/hour-summaries. Inside the section, sort by recency.

### E. Deep-link + yellow flash UX

25. **URL format.** Current deep-link is `/transcript/{date}#hour-N`. Extend to `/transcript/{date}#seg-<segmentId>`. Keep `#hour-N` working for hour-summary results.
26. **Segment id stability.** Check that `segment.id` is stable between writes and reads — for today's in-memory segments, live session generates an id. For hydrated-from-DB segments, the Mongo-side uses `index` as the ordering key, not an id (there's no `_id` on the sub-doc since `_id: false` on the schema). We may need to derive a stable id `"${date}-${index}"` that both the search result + the rendered segment agree on. **Audit this before shipping — if ids drift, the deep-link lands on the wrong row or not at all.**
27. **Target hour must expand first.** The hour is collapsed by default on TranscriptPage. Reuse the `targetHour` prop flow in [TranscriptTab.tsx:488–514](../../src/frontend/pages/day/components/tabs/TranscriptTab.tsx#L488-L514), then scroll to the `data-seg-id` element inside that hour.
28. **Timing**: segment hydration is async. The scroll-and-flash effect must wait for (a) session synced, (b) date loaded (`loadedDate === dateString`), (c) segments rendered, (d) hour expanded. Use the same `lastTargetHourRef` pattern already present.
29. **The yellow flash itself.** `bg-yellow-200` for ~1.5s then CSS transition back to transparent. Don't block scrolling on it. Re-trigger if the user returns to the same URL (i.e. clear the ref when the hash changes, not just on mount).
30. **Back-button round-trip.** User goes Search → Transcript (flash) → back → Search. Search state must be preserved so they can tap the next result. The current SearchPage uses local state that wipes on unmount — consider keeping the recent query in `sessionStorage` or routing history state. At minimum, the user's typed query must not be lost.
31. **If the date's transcript load fails** (R2 miss, network error), land the user on an empty transcript page with a toast "Couldn't load transcript for {date}" rather than silently showing nothing.
32. **Transcript got deleted after the search happened.** Race: user searches, gets a hit; meanwhile another tab trashes that date. Click → 404. Handle gracefully: empty state + toast.
33. **Segment got re-ordered / edited.** Today's in-memory list mutates as more segments come in. If the deep-link points to `seg-index-42` on today's transcript, index 42 might refer to a different segment 5 minutes later if anything shifts. Use a per-segment id that's timestamp-based, not positional. (Reinforces #26.)

### F. Privacy / data-protection

34. **Transcripts are sensitive.** `HourSummary` stores AI summaries (already sensitive) but raw transcripts expose EVERY word the user said near their glasses — including third parties. Make sure the search endpoint is authed (already is via `authMiddleware`) and that the backfill job does not ship logs with raw transcript text to observability.
35. **Deleted data must actually be gone.** When a user trashes a date or wipes all data, the search-index collection must be wiped too — otherwise phrase search returns ghosts. Update [wipeAllUserData.service.ts](../../src/backend/services/wipeAllUserData.service.ts) and the per-date trash path.
36. **Multi-user isolation.** Every query MUST include `{ userId }`. Same as existing collections, easy to forget on a new model — add a unit test.
37. **Logging.** `console.log` in `search.service.ts` currently logs the raw query string. That's PII for transcripts (`"did you sleep with her"`). Scrub query text from logs in production or gate behind a debug flag.

### G. Performance

38. **Regex across a large collection is scan-y.** The search-index Mongo collection needs indexes: `{ userId: 1, date: -1 }` and a text index on `text` (`{ userId: 1, text: "text" }` compound is NOT supported for text in the same way — use separate indexes and rely on filter ordering). For phrase queries, Mongo `$text` runs an OR across words and can't enforce order — so do a two-stage: `$text` to narrow the candidate set, then in-memory regex for exact substring-ordered match. This keeps queries O(matches_per_word) not O(all_segments).
39. **Single-word queries** skip the two-stage dance — `$text` alone is fine since there's no phrase-order to preserve. Optimization for the common case.
40. **Debounce.** SearchPage already debounces at 400ms — good. Make sure the heavier transcript branch doesn't starve on rapid keystrokes; abort in-flight fetch via `AbortController` (already wired).
41. **Pagination** (see D.23). 50 per page, `hasMore` flag, infinite-scroll sentinel. User can walk through the whole result set if they want.
42. **Cold R2 backfill** of 3 months of history for a heavy user could be tens of thousands of writes. Run in batches with a throttle; don't block user-facing requests.
43. **"Still indexing older days…" banner** shown on SearchPage while the per-user backfill is in progress (persist a `backfilledAt` timestamp per user; while null, show banner).

### H. UI details

42. **Result row layout.** Before-sentence (muted) · **matched sentence with yellow highlight inside match word** · after-sentence (muted). Date + time of the segment below. Clicking = go.
43. **Highlight HTML injection.** Don't `dangerouslySetInnerHTML` user-generated text. Split on the match, render `<mark className="bg-yellow-200">` for matched spans. (The note-content rendering already strips HTML — mirror that defense.)
44. **Empty state.** If user types a 3+ char query and no transcript matches: keep showing the existing "Nothing found" dot-art. Don't add a separate state per section.
45. **Section placement (locked)**: new third section `Transcript sentences · N` below the existing hour-summary `Transcripts` section. Two-section split keeps intent clear — hour-summary matches are topical, phrase matches are literal.
46. **"Spec phrase match only" vs the existing "hour summary match"** may be confusing to users. The UX copy should hint at the difference — e.g. hour-summary rows say "Today, 11 AM · 16 min", sentence rows say "Today, 11:23 AM · said". Think about the language.
47. **Long segment text.** Truncate in the preview (~120 chars window around the match), not the whole segment, so the match is always visible mid-row.
48. **Accessibility.** `<mark>` is semantic + screen-reader friendly. On the transcript page the flashed element should `aria-live="polite"` announce "Jumped to matched phrase" or similar.

### I. Pre-existing bugs that might bite this feature

49. The `_searchConversations` dead code in `search.service.ts` — fine, ignore.
50. `titleSearchNotes` uses `$regex` without a regex index — fine for small note counts but O(n); your new branch on a potentially huge segment collection MUST avoid full-collection regex. Use `$text` prefilter (see #38).
51. Current `searchHourSummaries` wraps each word in quotes to force AND — it still doesn't enforce order. Phrase order is the new thing here, don't copy its query-construction naively.

---

## Proposed implementation outline

### Backend
1. New model [src/backend/models/transcript-segment-search.model.ts](../../src/backend/models/transcript-segment-search.model.ts):
   - Fields: `userId`, `date`, `hour`, `segIndex`, `segId` (stable `${date}-${index}`), `text`, `timestamp`, `speakerId?`.
   - NOT indexed: photo segments (skip at write time entirely — see locked decision #6).
   - Indexes: `{ userId: 1, date: -1, segIndex: 1 }`, `{ userId: 1, text: "text" }`.
   - Helpers: `upsertSearchSegment`, `bulkUpsertSearchSegments`, `deleteSearchSegmentsForDate`, `searchSegmentsByPhrase(userId, phrase, offset, limit)` — single-word: `$text` alone; multi-word: `$text` prefilter then in-memory substring-ordered filter. Returns `{ rows, hasMore }`.
2. Live ingest hook: in [TranscriptManager.ts](../../src/backend/session/managers/TranscriptManager.ts) — wherever final segments are persisted to `DailyTranscript`, also write to `TranscriptSegmentSearch` (skip `type: "photo"`).
3. R2 batch hook: in [r2Batch.service.ts](../../src/backend/services/r2Batch.service.ts) — `deleteProcessedSegments` removes from `DailyTranscript` but must NOT touch `TranscriptSegmentSearch` rows (they stay for search).
4. Backfill job: `src/backend/scripts/backfill-transcript-search.ts` — iterate R2 per user per date, upsert search rows, skip photos. Store `backfilledAt` on the user-settings doc. Throttled, resumable.
5. Search service additions: `searchTranscriptSegments()` in [search.service.ts](../../src/backend/core/semantic-search/search.service.ts) — returns a new `SearchResult` variant + paging metadata:
   ```ts
   | { type: "transcript-sentence"; id: string; date: string; hour: number;
       segId: string; text: string; before?: string; after?: string;
       matchRanges: [start: number, end: number][]; timestamp: string; }
   ```
6. API change [router.ts](../../src/backend/api/router.ts): accept `offset` param; response shape becomes `{ results, transcriptSentences: { rows, hasMore, nextOffset } }` (or keep a flat `results` array and return a separate `pagination` block — pick the cleaner shape when implementing).
7. Trash/wipe cascade: update [wipeAllUserData.service.ts](../../src/backend/services/wipeAllUserData.service.ts), day-trash path in [file.model.ts](../../src/backend/models/file.model.ts) flow, removing matching `TranscriptSegmentSearch` rows.

### Frontend
8. [SearchPage.tsx](../../src/frontend/pages/search/SearchPage.tsx): new section `Transcript sentences · N`. Row component renders `<mark>` for match ranges, shows before/after muted, date+time below. Click → `setLocation(\`/transcript/${date}#seg-${segId}\`)`. `IntersectionObserver` sentinel at bottom of section triggers next-page fetch while `hasMore`. Enforce 3-char min before firing. Show "still indexing older days…" banner when `backfilledAt` is null.
9. [TranscriptPage.tsx](../../src/frontend/pages/transcript/TranscriptPage.tsx): parse `#seg-<id>`, compute its hour (from segment lookup after hydrate), pass `targetHour` + new `targetSegId` to `TranscriptTab`.
10. [TranscriptTab.tsx](../../src/frontend/pages/day/components/tabs/TranscriptTab.tsx): extend the `targetHour` effect — after scrolling hour header to top, also scroll `[data-seg-id="..."]` into view and add a short-lived `.flash-yellow` class (~1.5s) via `useEffect`. Add `data-seg-id` to `SegmentRow`.

### Acceptance

- Typing `"tokyo trip"` returns raw-segment hits even when the hour-summary doesn't mention Tokyo.
- Result rows show yellow-highlighted match + 1 sentence before & after.
- Tapping opens the correct date, expands the correct hour, scrolls to the exact segment, yellow-flashes ~1.5s.
- Searching a 3-month-old phrase works after the backfill runs.
- Trashing a day removes its sentences from future searches.

### Out of scope

- Semantic phrase search ("find moments like …").
- Cross-segment phrase stitching.
- Sentence-level splitting inside a segment.
- Speaker filters / time-of-day filters.
- Exporting matched snippets.
