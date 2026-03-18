# Plan: Live Conversation UX — Title Generation + "Transcribing Now" Badge

## Overview

When a conversation is detected, the UI should:
1. Animate the new card into the list (slide down + fade in)
2. Show "Generating title..." as a placeholder while no title exists
3. Generate a **provisional title** mid-conversation (after every 3 chunks), updating live
4. Show a **wave animation badge** ("Transcribing now") while status is `active`
5. On conversation end, run a final title + summary generation pass

---

## Work Items

### Backend

#### 1. Mid-conversation title generation in `ConversationManager`
- After every 3 meaningful chunks are added to an active conversation, call a fast LLM to produce a provisional title from `runningSummary`
- Store the result in `conversation.title` and broadcast via WebSocket (already handled by `conversations.mutate`)
- This reuses the same `runningSummary` compression timing (already fires every 3 chunks) — hook into that callback rather than adding a second timer
- Keep the final title generation at conversation end (via `generateAISummary`) as-is — it will overwrite the provisional one with a more accurate result

#### 2. Track `generatingTitle` state separately from `generatingSummary`
- Currently `generatingSummary: true` covers both "generating title" and "generating full summary"
- After the change, mid-conversation we need a way to show "Generating title..." without implying the full summary is being generated
- **Option A:** Add a `generatingTitle: boolean` field to the `Conversation` model + shared type
- **Option B:** Derive it from `title === "" && status !== "ended" && !generatingSummary`
- Option B is simpler and avoids a schema migration — prefer this

#### 3. No changes needed to ConversationTracker or pipeline
- Title generation is purely a `ConversationManager` concern — the tracker already calls `onConversationUpdate` on each chunk addition

---

### Frontend

#### 4. New "Transcribing now" badge (replace "Live" green dot)
- Replace the current `StatusBadge` `active` case with the design from the screenshot:
  - Pill shape, soft red/pink background
  - Animated sound wave (3–4 bars, staggered height animation)
  - Text: "Transcribing now"
- Keep "Paused" and "Ended" badges as-is

#### 5. Card entrance animation
- In `ConversationsTab`, new cards already use `AnimatePresence` + `motion.div` with `opacity: 0 → 1`
- Extend to: `y: 20 → 0` + `opacity: 0 → 1` for a slide-up feel
- Auto-scroll to the new card when `status === "active"` and it's newly added (use a `useEffect` watching `conversations.length` or the first `activeConversationId` change)

#### 6. Title placeholder rendering
- In `ConversationCard`, the title display logic already handles the no-title case
- Update the condition to use the derived `generatingTitle` logic:
  - `title === ""` and `status === "active"` → show spinner + "Generating title..."
  - `title === ""` and `status === "ended"` and `!generatingSummary` → show "Untitled Conversation"
  - `title !== ""` → show title (even mid-conversation — updates live as provisional titles arrive)
- The title should NOT reset to spinner when a provisional title is already showing

---

## Edge Cases & Issues

### Title Generation

| # | Issue | Risk | Mitigation |
|---|-------|------|-----------|
| T1 | **Race condition: final summary overwrites provisional title** with a worse one | Low — final pass uses full transcript, should be better | Final pass prompt explicitly says "use full transcript"; accept the overwrite |
| T2 | **LLM latency on title generation blocks chunk processing** | Medium — title gen is async but shares LLM quota | Run title gen as fire-and-forget (don't await in chunk processing path) |
| T3 | **Provisional title generated on chunk 3 but conversation ends before chunk 6** | Low — only 3 chunks, title may be vague | Acceptable; final summary will fix it |
| T4 | **Empty runningSummary at chunk 3** (e.g. compression hasn't run yet) | Low — runningSummary starts filling from chunk 1 | Fall back to using raw chunk texts if runningSummary is empty |
| T5 | **Title generates while `generatingSummary: true`** (race at end of conversation) | Low — `generateAISummary` sets `generatingSummary: true` before broadcasting "ended" | Mid-conv title gen should check `status !== "ended"` before running |

### Animation / UI

| # | Issue | Risk | Mitigation |
|---|-------|------|-----------|
| A1 | **New card animates in every time the conversation list re-renders** (e.g. title update) | High — `AnimatePresence` re-mounts if key changes | Key must be `conversation.id` (stable), not index or title — already correct |
| A2 | **Auto-scroll fires on every title update**, not just on new conversation | Medium — scroll locks user mid-read | Only scroll when a genuinely new conversation ID appears (compare previous list length or IDs) |
| A3 | **Wave animation defined inside component body** causes re-render loops (similar to `THINKING_WORDS` issue in Mentra-AI-2) | High | Define animation keyframes as module-level constants outside the component |
| A4 | **Card slides in then immediately snaps** if `AnimatePresence initial={false}` is set | Medium — `initial={false}` suppresses mount animations | Remove `initial={false}` from `AnimatePresence` in `ConversationsTab`, or handle conditionally for first load vs live updates |
| A5 | **Entrance animation replays for all cards on tab switch** (conversations tab unmounts/remounts) | Medium — jarring on tab switch | Use `initial={false}` on `AnimatePresence` but override `initial` on newly added cards only — track "seen" IDs in a ref |

### State / Sync

| # | Issue | Risk | Mitigation |
|---|-------|------|-----------|
| S1 | **Server restart auto-ends stale conversations**, triggering `generateAISummary` for a conversation that already has a provisional title — title may be regenerated with a different value | Low | `generateAISummary` only overwrites title if LLM returns one — acceptable |
| S2 | **WebSocket reconnect causes snapshot re-apply**, re-rendering all cards with `initial` animations if not guarded | Medium | Guard with the "seen IDs" ref approach from A5 |
| S3 | **Conversation deleted while title is generating** — `conversations.mutate` tries to find a deleted ID | Low — already handled with `idx >= 0` guard in existing code | No change needed |
| S4 | **Multiple rapid chunk updates** (chunks 3, 6, 9 all fire title gen within seconds of each other) may cause out-of-order title updates | Low — LLM responses arrive in order they were requested for small payloads | Debounce or use a `generatingTitle` flag to skip if one is already in-flight |

### Homepage / Navigation

| # | Issue | Risk | Mitigation |
|---|-------|------|-----------|
| H1 | **`todayConversationCount` on HomePage** counts all today conversations including ended ones — the count shown near the time stamp should not change unexpectedly as new conversations start | Low | Count is derived from `conversations` array already — will naturally increment when new conversation arrives |
| H2 | **ConversationList on HomePage** may not auto-scroll to the new live conversation if user is scrolled down | Medium | Same auto-scroll logic from A2 — scroll to top (newest) when a new `active` conversation is added |

---

## Implementation Order

1. **Backend:** Add provisional title generation after every 3 chunks in `ConversationManager` (fire-and-forget, uses `runningSummary`)
2. **Frontend:** Update title placeholder logic (derive `generatingTitle` from fields, no schema change)
3. **Frontend:** Replace `StatusBadge` `active` case with wave animation ("Transcribing now")
4. **Frontend:** Fix card entrance animation (add `y` translation, guard "seen IDs" to prevent replay)
5. **Frontend:** Add auto-scroll to new active conversation
6. **Test:** Simulate a conversation via `POST /api/test/simulate-conversation` and verify full flow end-to-end
