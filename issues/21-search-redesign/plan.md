# Plan: Search Page Redesign — Notes (semantic) + Transcripts (text) only

## Goal

Rewrite the Search tab to match the new Paper design and shift its data model:

- **Notes**: keep semantic vector search (current behavior).
- **Transcripts**: search hour-summary titles + bodies via Mongo `$text` search.
- **Conversations**: stop showing in search results. Keep the embedding pipeline + vector index intact (don't drop the columns/indexes), but disconnect from the search service so they no longer appear.
- **Filter pills**: remove entirely. One unified results list, sectioned by type.
- **UI**: match the Paper spec (see screenshot in chat / new typography & spacing).

## Why

Conversation visualization is being deprecated as a user-facing feature. We've already replaced its surface with hour-summary titles per hour of transcripts (see [TranscriptTab.tsx](../../src/frontend/pages/day/components/tabs/TranscriptTab.tsx)). Search needs to follow that same shift — when the user searches, they should land on **the hour of transcript** that matched, not a synthetic "conversation" object.

## Scope

### Backend

1. **`src/backend/core/semantic-search/search.service.ts`**
   - Remove call to `searchConversations()` from `semanticSearch()`. Leave the function in the file (commented-out or kept as dead code with a clear deprecation comment) so it's easy to re-enable later if we change our minds.
   - Add `searchHourSummaries(userId, query, limit)` using `HourSummary.find()` with a Mongo `$text` index (or `$regex` fallback if index doesn't exist yet).
   - Update `SearchResult` discriminated union: replace `type: "conversation"` with `type: "transcript"`.
   - New `transcript` result shape includes `date` (YYYY-MM-DD) + `hour` (0-23) so the frontend can deep-link.
   - Merging: notes (vector score) + transcripts (text score) are on different scales — normalize or just rank within their groups and present sectioned (sectioned matches the new UI anyway).

2. **`src/backend/models/hour-summary.model.ts`**
   - Add a Mongo text index on `summary` (which holds both title line + body): `HourSummarySchema.index({ summary: "text" })`.
   - Add helper `searchHourSummaries(userId, query, limit)` that runs `HourSummary.find({ userId, $text: { $search: query } }).sort({ score: { $meta: "textScore" } }).limit(limit)`.
   - Fallback path if `$text` index isn't built yet: regex `{ summary: { $regex: query, $options: "i" } }`.

3. **`src/backend/api/router.ts`** (`GET /api/search`)
   - No interface change — same query param, same JSON shape (just a new `type` value).
   - Remove `searchConversations` import path / leave dead.

### Frontend

4. **`src/frontend/pages/search/SearchPage.tsx`** — full rewrite:
   - **Header**: "MENTRA NOTES" eyebrow + giant "Search" title (matches new HomePage style — `text-[34px] font-black`).
   - **Search bar**: warm stone background `#F5F3F0` border `#E8E5E1` rounded-[14px], inline X clear button on the right (Paper spec uses an X line-icon, not a circled X).
   - **Filter pills**: remove. Delete `activeFilter`, `setActiveFilter`, `filteredResults`, `filters` array.
   - **Result count line**: small red `text-[13px] text-[#D32F2F]` "5 results".
   - **Sections**:
     - `Notes · N` (red bold uppercase eyebrow `tracking-[1.2px]`)
     - Each row: bold title, body preview, subtle date "Yesterday", chevron right. Border-top dividers `#F0EDEA`.
     - `Transcripts · N` section below, same row layout but title is `font-semibold` (not bold) per spec, and the date line includes time + duration: `Today, 11:05 AM · 16 min`.
   - **Tap behavior**:
     - Note row → `/note/{id}` (unchanged).
     - Transcript row → `/transcript/{date}#hour-{hour}` so TranscriptPage can scroll/expand that hour. (Need to implement the hash handling on TranscriptPage side too — see followup below.)
   - **Empty / initial states**: keep the existing recent-searches list and dot-art empty state, restyle to match the warm stone palette (`#FCFBFA` bg, `#B0AAA2` muted text).
   - Drop the `transcriptionPaused`/`isMicActive` references — not used in the new spec.

### Followup (TranscriptPage hour deep-link)

5. **`src/frontend/pages/transcript/TranscriptPage.tsx`** — read `window.location.hash` for `#hour-{N}` on mount, and when present:
   - After segments load, expand the matching hour and `scrollIntoView` on its sticky header.
   - Reuse the existing `headerRefs` map in [TranscriptTab.tsx](../../src/frontend/pages/day/components/tabs/TranscriptTab.tsx) and the `toggleHour()` API.

## Out of scope (do later, separately)

- Adding semantic embeddings to `HourSummary`. Text search is good enough for now and avoids the embedding-cost / backfill problem.
- Re-enabling Conversations in search results. (Keep the code paths mothballed but easy to revive.)
- Highlighting matched terms in result body previews.
- Hybrid scoring across notes + transcripts (current plan: present them in separate sections, no cross-rank).

## Files to touch

- `src/backend/core/semantic-search/search.service.ts` — drop conv branch, add transcript branch.
- `src/backend/models/hour-summary.model.ts` — add text index + helper.
- `src/backend/models/index.ts` — re-export new helper.
- `src/backend/api/router.ts` — update result-shape comment, no behavioral change.
- `src/frontend/pages/search/SearchPage.tsx` — rewrite.
- `src/frontend/pages/transcript/TranscriptPage.tsx` — handle `#hour-N` hash (followup; can ship search first and link to plain `/transcript/{date}` initially).

## Acceptance

- Searching "roadmap" returns notes (semantic match) + any hour-summary that contains "roadmap" in title/body — no conversations in results.
- Tapping a transcript result opens that day; ideally jumped to that hour.
- No filter pills present.
- New typography matches Paper screenshot.
- Conversations search code is dormant but recoverable in one diff.
- **Preserve existing dot-art "Nothing found" SVG** from current SearchPage (the `D94F3B` halftone circle pattern, ~80 lines of `<circle>` elements in the no-results branch). Do NOT replace it with a generic icon when porting to the new layout — keep that custom asset.

## Paper reference (target design)

```tsx
/**
 * from Paper
 * https://app.paper.design/file/01KPBRQRHRBZCWW8R5CSKT3CZE/1-0/81-0
 * on Apr 17, 2026
 */
export default function () {
  return (
    <div className="[font-synthesis:none] flex overflow-clip w-98.25 h-213 flex-col relative bg-[#FCFBFA] antialiased text-xs/4">
      <div className="flex flex-col pt-13 pb-4 gap-0.5 px-6">
        <div className="tracking-[1.5px] uppercase inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[11px]/3.5">
          Mentra Notes
        </div>
        <div className="[letter-spacing:-0.5px] inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Black','Red_Hat_Display',system-ui,sans-serif] font-black text-[34px]/10.5">
          Search
        </div>
      </div>
      <div className="pb-2 px-6">
        <div className="flex items-center justify-between rounded-[14px] py-3.25 px-4 bg-[#F5F3F0] border border-solid border-[#E8E5E1]">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C958D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[15px]/4.5">
              Q3 roadmap
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C958D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </div>
      </div>
      <div className="pb-1 px-6">
        <div className="inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[13px]/4">
          5 results
        </div>
      </div>
      <div className="flex flex-col grow shrink basis-[0%] px-6 overflow-clip">
        <div className="pt-3 pb-2">
          <div className="tracking-[1.2px] uppercase inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[11px]/3.5">
            Notes · 2
          </div>
        </div>
        <div className="flex items-center py-3 gap-2.5 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col grow shrink basis-[0%] gap-1">
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[15px]/4.5">
              Sprint Planning Notes
            </div>
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4.25">
              Defined Q3 sprint scope. Auth refactor moved to S2...
            </div>
            <div className="inline-block text-[#B0AAA2] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Yesterday
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="flex items-center py-3 gap-2.5 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col grow shrink basis-[0%] gap-1">
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[15px]/4.5">
              Product Roadmap Review
            </div>
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4.25">
              Q3 milestones reviewed. Analytics dashboard deprioritized...
            </div>
            <div className="inline-block text-[#B0AAA2] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Yesterday
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="pt-4 pb-2">
          <div className="tracking-[1.2px] uppercase inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[11px]/3.5">
            Transcripts · 3
          </div>
        </div>
        <div className="flex items-center py-3 gap-2.5 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col grow shrink basis-[0%] gap-1">
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_SemiBold','Red_Hat_Display',system-ui,sans-serif] font-semibold text-[15px]/4.5">
              Engineering planning sync
            </div>
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4">
              ...prioritize the mobile views for Q3...
            </div>
            <div className="inline-block text-[#B0AAA2] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Today, 11:05 AM · 16 min
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="flex items-center py-3 gap-2.5 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col grow shrink basis-[0%] gap-1">
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_SemiBold','Red_Hat_Display',system-ui,sans-serif] font-semibold text-[15px]/4.5">
              Product roadmap review
            </div>
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4">
              ...Q3 milestones, we should deprioritize...
            </div>
            <div className="inline-block text-[#B0AAA2] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Yesterday, 2:00 PM · 18 min
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="flex items-center py-3 gap-2.5 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col grow shrink basis-[0%] gap-1">
            <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_SemiBold','Red_Hat_Display',system-ui,sans-serif] font-semibold text-[15px]/4.5">
              Sprint planning session
            </div>
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4">
              ...what we can realistically ship for Q3...
            </div>
            <div className="inline-block text-[#B0AAA2] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Yesterday, 10:30 AM · 24 min
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </div>
      <div className="flex w-98.25 min-h-20 items-start justify-around pt-2.5 pb-5.5 bg-white border-t border-t-solid border-t-[#E8E5E1] px-7.5">
        <div className="flex flex-col items-center pt-[2.5px] gap-1">
          <svg width="21" height="21" fill="none" stroke="#B8B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <div className="inline-block text-[#B8B2A9] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[10px]/3">
            Transcripts
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F] shrink-0" />
          <svg width="21" height="21" fill="none" stroke="#D32F2F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div className="tracking-[0.2px] inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[10px]/3">
            Search
          </div>
        </div>
        <div className="flex flex-col items-center pt-[2.5px] gap-1">
          <svg width="21" height="21" fill="none" stroke="#B8B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <div className="inline-block text-[#B8B2A9] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[10px]/3">
            Notes
          </div>
        </div>
        <div className="flex flex-col items-center min-w-12.5 pt-[2.5px] gap-1">
          <svg width="21" height="21" fill="none" stroke="#B8B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <div className="inline-block text-[#B8B2A9] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[10px]/3">
            Settings
          </div>
        </div>
      </div>
      <div className="absolute top-4 right-4 flex items-center rounded-[999px] pr-1 pl-2.5 gap-1.5 bg-[#78716C1F] py-1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
          <circle cx="5" cy="12" r="2" fill="#52525B" />
          <circle cx="12" cy="12" r="2" fill="#52525B" />
          <circle cx="19" cy="12" r="2" fill="#52525B" />
        </svg>
        <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#78716C33] size-6">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <line x1="6" y1="12" x2="18" y2="12" stroke="#52525B" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}
```
