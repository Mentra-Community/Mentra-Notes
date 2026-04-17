# Issue 20 — Remove Conversations UI, Auto-Generate Notes on Conversation End

**Status:** Planned
**Date:** 2026-04-16
**Branch context:** `version-4/refactor-apr-14-26`

---

## 1. Goal

Simplify the Mentra Notes experience by removing the frontend "Conversations" tab entirely. The background conversation detector (triage pipeline + state machine) stays exactly as it is, but the moment the state machine finalizes a conversation, the system auto-generates an AI note — no manual "Generate Note" step, no UI list of conversations.

The home page becomes a **Transcripts-only** view that reuses the existing `TranscriptList` component under new header typography.

---

## 2. Context — Current State

### Frontend (what users see today)
`HomePage.tsx` has a two-tab UI:
- **Conversations tab** — a list of detected conversations with AI summaries. Tap → `ConversationDetailPage` → tap "Generate Note" → `GeneratingNotePage` → the note is created.
- **Transcripts tab** — day-by-day transcript list (via `TranscriptList`).

Plus: multi-select, merge drawer, export drawers, email drawers, favourite/archive/trash filters, empty-trash drawer, filter drawer, GlobalAIChat, CalendarView, FABMenu (Ask AI / Add Note / Stop mic / Resume mic).

### Backend (what already exists and we keep)
The conversation pipeline is unchanged by this work:
1. `TranscriptionManager` → chunks buffered (~40s).
2. `TriageClassifier` → auto-skipped / filler / meaningful.
3. `ConversationTracker` state machine — `IDLE → PENDING → TRACKING → PAUSED → (ended)`.
4. On end (7 consecutive silent chunks) → `ConversationTracker.endConversation()` fires the `onConversationEnd` callback.
5. `ConversationManager` already listens and **auto-generates the AI *summary*** (short title + 2–3 sentences) via `generateAISummary(conv)`.

### The gap
Auto-summary runs, but the full structured **AI Note** (100–500-word HTML document with title) is only created when the user taps "Generate Note" in `GeneratingNotePage`. This manual step is what we're removing.

---

## 3. Proposed Change — One-Sentence Summary

> Hook `notesManager.generateNote(...)` into the existing `onConversationEnd` path so a full AI note is created automatically the instant a conversation ends, and strip the Conversations tab from the home page.

---

## 4. Key Files & Line Numbers

### Backend (auto-note generation)
| File | Lines | Role |
|---|---|---|
| `src/backend/core/auto-conversation/ConversationTracker.ts` | 559–598 | `endConversation()` — fires `onConversationEnd` callback |
| `src/backend/session/managers/ConversationManager.ts` | 100–111 | Existing listener — currently only calls `generateAISummary`. **We add auto-note here.** |
| `src/backend/session/managers/NotesManager.ts` | 293–499 | `generateNote(title, startTime, endTime)` RPC — reusable as-is |

### Frontend (UI strip)
| File | Role |
|---|---|
| `src/frontend/pages/home/HomePage.tsx` | Heavy refactor — drop conversation logic, keep transcripts |
| `src/frontend/components/layout/Shell.tsx` (line 78) | Rename bottom-nav tab label `Conversations` → `Transcripts` |
| `src/frontend/App.tsx` (line 160) | `<Toaster />` from `sonner` already mounted — reuse for failure toasts |

### Files to delete (dead after this change)
- `src/frontend/pages/home/components/ConversationList.tsx`
- `src/frontend/pages/home/components/ConversationRow.tsx`
- `src/frontend/pages/home/components/CalendarView.tsx`
- `src/frontend/pages/home/components/FABMenu.tsx`
- `src/frontend/pages/home/components/GlobalAIChat.tsx`
- `src/frontend/components/shared/ConversationFilterDrawer.tsx`
- `src/frontend/pages/day/components/tabs/ConversationsTab.tsx`

### Routes that stay alive (deprecated but reachable by deep link)
- `/conversation/:id` → `ConversationDetailPage`
- `/conversation/:id/transcript` → `ConversationTranscriptPage`
- `/conversation/:id/generating` → `GeneratingNotePage`

These are no longer linked from Home, but old deep links resolve.

---

## 5. Decisions Captured (from 2026-04-16 conversation)

| # | Question | Decision |
|---|---|---|
| 1 | Existing conversations in DB? | Hide UI, keep routes alive so old deep links still work |
| 2 | Still create `Conversation` entity in DB? | Yes — unchanged |
| 3 | When does auto-note fire? | Instantly on state-machine "ended" transition |
| 4 | LLM failure handling? | Show `sonner` toast on frontend |
| 5 | User opt-out setting? | Ignore — always on |
| 6 | Bottom nav change? | Don't replace nav — just rename "Conversations" label to "Transcripts" |
| 7 | Paused/Resume mic strip from Paper design? | Don't build it — deprecate stop/resume entirely |
| 8 | Rebuild TranscriptList? | No — reuse existing component |
| 9 | Overflow / "…" menu in top-right? | Don't build |
| 10 | Delete dormant conversation components? | Yes — delete |
| 11 | Calendar view? | Remove |
| 12 | Multi-select / merge / export machinery? | Delete |

---

## 6. Backend Implementation Steps

### Step 6.1 — Extend the `onConversationEnd` handler
**File:** `src/backend/session/managers/ConversationManager.ts` (around lines 100–111)

Current flow (sketch):
```
onConversationEnd(conv) {
  conv.generatingSummary = true;
  this.broadcast(...);
  this.generateAISummary(conv);   // fire-and-forget, non-blocking
}
```

New flow:
```
onConversationEnd(conv) {
  conv.generatingSummary = true;
  this.broadcast(...);

  // 1) Summary (existing)
  const summaryPromise = this.generateAISummary(conv);

  // 2) Auto-note (new) — await summary title first so the note has a sensible title
  summaryPromise
    .then(() => this.notesManager.generateNote(conv.title, conv.startTime, conv.endTime))
    .then((note) => {
      conv.noteId = note.id;
      this.broadcast(...);  // notify frontend of linked note
    })
    .catch((err) => {
      logger.error("Auto-note generation failed", err);
      this.broadcastToast("Couldn't auto-generate note from conversation");
    });
}
```

Open implementation detail: verify the actual shape of `generateAISummary`'s return — if it already resolves with the final title we can chain; if not, we await summary completion by polling `conv.title` or refactor to return a Promise<string>. **To confirm during implementation.**

### Step 6.2 — Toast broadcast channel
If no existing "toast" SSE event exists, add a lightweight one:
- Server: `broadcastToast(message: string)` emits an SSE event `{ type: "toast", message, variant: "error" }`.
- Client: subscribe in the existing SSE listener and call `toast.error(message)` from `sonner`.

### Step 6.3 — Guard against double-generation
If a conversation already has a `noteId` (user previously generated a note before this change shipped), **skip** auto-generation.

---

## 7. Frontend Implementation Steps

### Step 7.1 — Shell bottom-nav rename
**File:** `src/frontend/components/layout/Shell.tsx` line 78
`"Conversations"` → `"Transcripts"`. Keep icon and route as-is (route still points at HomePage; the page is now a transcripts-only view).

### Step 7.2 — HomePage strip-down
**File:** `src/frontend/pages/home/HomePage.tsx`

**Remove:**
- All `conversation` state, memos, handlers (lines ~140–573).
- Multi-select state for conversations + transcripts (keep none — transcripts get no multi-select either since we're simplifying).
- `useState`s: `isAllNotesView`, `isFilterOpen`, `viewMode`, `showGlobalChat`, `showEmptyTrashConfirm`, `timeFilter`, `convSortBy`, `convDateRange`, `convShowFilter`, `convCustomStart`, `convCustomEnd`, `activeTimeFilter`, `renderedFilter`, `tabOpacity`, all merge/export/email drawer state.
- Calendar view branch (entire `if (viewMode === "calendar")` block).
- Empty-trash confirmation drawer.
- Filter drawer, GlobalAIChat, all ExportDrawer / EmailDrawer usages.
- Tab-switcher UI (Conversations / Transcripts toggle buttons), filter pills, filter button, SelectionHeader, MultiSelectBar.
- FABMenu render.

**Keep / adapt:**
- `useMentraAuth` + `useSynced<SessionI>` for session + userId.
- `availableDates`, `files`, `isRecording`, `transcriptionPaused` derived from session (used by TranscriptList).
- Loading skeleton fallback.

**New render tree (roughly):**
```
<div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
  <div className="flex flex-col pt-13 pb-3 gap-0.5 px-6">
    <div className="text-[11px] ... uppercase text-[#DC2626] font-bold tracking-widest">
      Mentra Notes
    </div>
    <div className="text-[30px] ... text-[#1C1917] font-extrabold tracking-tight">
      Transcripts
    </div>
    <div className="text-[14px] text-[#A8A29E] font-red-hat">
      {availableDates.length} {availableDates.length === 1 ? "day" : "days"} of transcripts
    </div>
  </div>
  <div className="flex-1 overflow-hidden px-6">
    <div className="h-full overflow-y-auto pb-32">
      <TranscriptList
        availableDates={availableDates}
        files={files}
        isRecording={isRecording}
        transcriptionPaused={transcriptionPaused}
        onSelect={(dateStr) => setLocation(`/transcript/${dateStr}`)}
        isSelecting={false}
        selectedDates={new Set()}
        onToggleSelect={() => {}}
        longPressProps={{}}
      />
    </div>
  </div>
</div>
```

> Typography values from Paper design: header title uses `font-extrabold` at 30–34px with tracking `-0.02em`; eyebrow uses `11px` uppercase tracking `1.5px` in `#DC2626`. Match the tokens the existing app uses (`font-red-hat`) rather than the raw `Red_Hat_Display` Paper export to stay consistent with the rest of the app.

### Step 7.3 — Delete dead components
Remove the 7 files listed in §4 (Files to delete). Grep each import path before deleting to confirm no stragglers.

### Step 7.4 — Toast wiring
In whichever existing component subscribes to SSE session events (likely `useSynced` or a parent provider), add handler for the `toast` event type → call `toast.error(message)` from `sonner`. (If an existing error-toast path exists, reuse it instead of adding a new event type.)

---

## 8. Edge Cases to Watch For

1. **Conversation ended with very short transcript** — if the conversation has <N words of usable transcript, `generateNote` could produce a garbage note. Add a minimum-length guard (e.g., skip auto-note if combined chunk text under 50 words) → still create the `Conversation` row, just no linked note.
2. **LLM timeout / rate limit** — toast should be user-friendly, not "HTTP 429". Map errors to a generic message.
3. **Network dropped mid-generation** — note creation is server-side, so a flaky client doesn't matter. Server persists the note either way; frontend reconciles on reconnect via SSE.
4. **Concurrent conversations ending simultaneously** — unlikely in a single-user session, but the fire-and-forget `.then` chain is independent per conversation, so no ordering issues.
5. **Pre-existing DB conversations (no `noteId`)** — on first load after this ships, should we backfill auto-notes for them? **Decision: no backfill.** They stay as-is; users can still reach them via deep link and manually generate if needed.
6. **Home tab label collision** — the nav now says "Transcripts" and routes to `/` (HomePage). The existing `/transcript/:dateStr` route is unaffected. Make sure the active-state highlighting still works — check `Shell.tsx` `useLocation` pattern.
7. **Calendar deep links** — if anything in the app links to a calendar view, those break. Grep for `setViewMode("calendar")` / `/calendar` route.
8. **Conversation SSE events still firing** — the backend will keep broadcasting conversation create/update/end events. The frontend can safely ignore them now (or unsubscribe). Leaving them subscribed is fine — just unused. Only clean up the listener if it's doing meaningful work on the client (re-rendering lists we no longer show = wasted cycles but not buggy).
9. **Day page (`/day/:date`) currently has a Conversations tab** — `pages/day/components/tabs/ConversationsTab.tsx`. Deleting this file requires removing its import and tab entry from the day page's tab list.

---

## 9. Testing Plan

### Manual
- [ ] Speak a meaningful conversation → wait 7+ silent chunks → confirm:
  - [ ] `Conversation` row persists in DB.
  - [ ] AI note appears under Notes view within seconds of conversation ending.
  - [ ] Conversation's `noteId` field is populated.
- [ ] Force LLM failure (disconnect / mock 500) → confirm `sonner` toast fires with user-friendly message.
- [ ] Very short conversation (<50 words) → confirm no garbage note is generated.
- [ ] Open old deep link `/conversation/<existing-id>` → page still loads.
- [ ] HomePage renders cleanly: header, transcripts list, bottom nav says "Transcripts", no console errors.
- [ ] Day page loads without the Conversations tab and doesn't crash.

### Regression
- [ ] Transcripts tab list, selection, navigation to transcript detail page — unchanged behavior.
- [ ] Settings page, Notes page, Search page — no broken imports from deleted files.
- [ ] Onboarding flow — unaffected.

---

## 10. Rollout / Order of Work

Suggested commit order (each commit independently reviewable):
1. **Backend:** Add auto-note trigger + toast broadcast event.
2. **Frontend:** Subscribe to toast event, call `toast.error`.
3. **Frontend:** Rename Shell nav label.
4. **Frontend:** Gut HomePage down to Transcripts-only.
5. **Frontend:** Delete dead files + remove imports from day page tabs.
6. **Manual QA** per §9.

---

## 11. Out of Scope (for this issue)

- Any change to the triage pipeline, chunk buffering, or state machine thresholds.
- Any change to how the AI note is *generated* (prompt, format, length).
- Calendar feature replacement.
- Multi-select/export workflows anywhere else in the app.
- Paper design's Paused/Resume mic strip, overflow menu, and replacement bottom nav.
- Settings toggle to opt out of auto-note generation.

---

## 12. Open Questions to Resolve During Implementation

1. Does `generateAISummary` currently return a Promise<string> with the title? If not, refactor to return Promise so we can chain cleanly (vs. racing on `conv.title`).
2. Is there already a generic "toast" SSE event type, or do we add a new one?
3. Day page tabs — how many tabs remain after removing Conversations? If only one, collapse the tab bar entirely.

---

## 13. Design Reference (Paper export, 2026-04-16)

Source: https://app.paper.design/file/01KPBRQRHRBZCWW8R5CSKT3CZE/1-0/DR-0

**Notes on how to interpret this reference vs. what we actually build:**
- **Header typography** (eyebrow + "Transcripts" title) → implement.
- **Paused / Resume mic strip** → **do NOT implement** (per decision #7).
- **Paper's own bottom nav** → **do NOT implement**. We keep the existing `Shell.tsx` nav and only rename the `Conversations` label to `Transcripts`.
- **Top-right overflow "…" pill** → **do NOT implement** (per decision #9).
- **Main content area** (the placeholder image in the Paper export) → render the existing `TranscriptList` component.

```tsx
/**
 * from Paper
 * https://app.paper.design/file/01KPBRQRHRBZCWW8R5CSKT3CZE/1-0/DR-0
 * on Apr 16, 2026
 */
export default function () {
  return (
    <div className="[font-synthesis:none] flex overflow-clip w-98.25 h-213 flex-col relative bg-[#FCFBFA] antialiased text-xs/4">
      <div className="flex flex-col pt-13 pb-3 gap-0.5 px-6">
        <div className="tracking-[1.5px] uppercase inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[11px]/3.5">
          Mentra Notes
        </div>
        <div className="[letter-spacing:-0.5px] inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Black','Red_Hat_Display',system-ui,sans-serif] font-black text-[34px]/10.5">
          Transcripts
        </div>
      </div>
      <div className="flex w-98.25 items-center justify-between py-4 px-6 bg-[#F5F3F0] border-b border-b-solid border-b-[#E8E5E1]">
        <div className="flex items-center gap-2.5">
          <div className="rounded-[5px] bg-[#B0AAA2] shrink-0 size-2.5" />
          <div className="flex flex-col gap-px">
            <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-sm/4.5">
              Paused
            </div>
            <div className="inline-block text-[#9C958D] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[11px]/3.5">
              Microphone off
            </div>
          </div>
        </div>
        <div className="flex items-center rounded-3xl py-2.5 px-5 gap-1.75 bg-[#D32F2F]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          </svg>
          <div className="inline-block text-white font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[13px]/4">
            Resume
          </div>
        </div>
      </div>
      <div className="flex flex-col grow shrink basis-[0%] overflow-clip items-center justify-center">
        <div className="w-98.25 h-179 bg-cover bg-center shrink-0" style={{ backgroundImage: 'url(https://app.paper.design/file-assets/01KPBRQRHRBZCWW8R5CSKT3CZE/01KP6JCW0FYPYT4A2V5BS720E0.png)' }} />
      </div>
      <div className="flex min-h-20 items-start justify-around py-2.5 px-7.5 w-98.25 h-20 absolute left-0 top-193 bg-white border-t border-t-solid border-t-[#E8E5E1]">
        <div className="flex flex-col items-center gap-1">
          <div className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F] shrink-0" />
          <svg width="21" height="21" fill="none" stroke="#D32F2F" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          <div className="inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[10px]/3">
            Transcripts
          </div>
        </div>
        <div className="flex flex-col items-center pt-[2.5px] gap-1">
          <svg width="21" height="21" fill="none" stroke="#B8B2A9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div className="inline-block text-[#B8B2A9] font-['RedHatDisplay-Regular_Medium','Red_Hat_Display',system-ui,sans-serif] font-medium text-[10px]/3">
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
