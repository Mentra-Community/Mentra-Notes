# Multi-Select & Share/Export Feature

## Overview

Add long-press multi-select to **Notes**, **Conversations**, and **Transcripts** lists. Selected items can be batch exported (clipboard, text file, native share), moved to folders (notes only), favorited, or deleted. Tapping "Export" opens a bottom drawer with content toggles and export destination options.

**Edge case:** Active/paused conversations (`status !== "ended"`) cannot be selected — they're still recording.

---

## Screens

### A. Multi-Select Mode (Notes)
- Long-press any note row → enters selection mode
- Header becomes: `Cancel` | `{n} selected` | `Select All`
- Each row shows animated checkbox (left side), swipe gestures disabled
- Bottom action bar: **Export** | **Move** | **Favorite** | **Delete**

### B. Multi-Select Mode (Conversations)
- Same long-press trigger, same header
- **Cannot select** conversations where `status === "active" || status === "paused"`
- Bottom action bar: **Export** | **Favorite** | **Delete** (no Move)

### C. Multi-Select Mode (Transcripts)
- Long-press any transcript date row → enters selection mode
- Same header pattern
- Bottom action bar: **Export** | **Delete**
- No favorite or move (transcripts are date-based files, not individual items)

### D. Export Drawer
- Title: "Export Note" (single) / "Export {n} Notes" (batch)
- Subtitle: note title (single) or note count summary
- **Included in Export** section:
  - Toggle: "Note Content" — summary, decisions, action items (default ON)
  - Toggle: "Linked Transcript" — full conversation with speaker labels (default OFF)
- **Export To** section:
  - Clipboard | Text File | Share (native share sheet)
- "Export Note" button at bottom

For conversations: same drawer but toggles are "Conversation Summary" + "Full Transcript"
For transcripts: single toggle "Transcript Content" (always on), no linked content

---

## Implementation Tasks

### Task 1: Create `useMultiSelect` hook

**New file:** `src/frontend/hooks/useMultiSelect.ts`

```ts
import { useState, useCallback, useRef } from "react";

interface UseMultiSelectReturn<T = string> {
  /** Whether selection mode is active */
  isSelecting: boolean;
  /** Set of selected item IDs */
  selectedIds: Set<T>;
  /** Number of selected items */
  count: number;
  /** Enter selection mode and select the first item */
  startSelecting: (id: T) => void;
  /** Toggle an item's selection state */
  toggleItem: (id: T) => void;
  /** Select all items from a given list */
  selectAll: (allIds: T[]) => void;
  /** Exit selection mode and clear selection */
  cancel: () => void;
  /** Long-press handler factory — returns onTouchStart/onTouchEnd props */
  longPressProps: (id: T, disabled?: boolean) => {
    onTouchStart: () => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
  };
}
```

**Behavior:**
- `longPressProps(id, disabled?)` returns touch handlers that trigger `startSelecting(id)` after 500ms hold
- Moving finger cancels the long-press (prevents conflict with scroll/swipe)
- `disabled` param prevents selection (for active conversations)
- Once in selection mode, tapping a row calls `toggleItem(id)` instead of navigating
- If `selectedIds` becomes empty after a toggle, auto-exit selection mode
- `selectAll(ids)` selects everything in the filtered list
- `cancel()` clears everything and exits selection mode

**Implementation detail:** Use `useRef` for the timeout ID to avoid re-renders during the hold period. Clear timeout on `touchMove` and `touchEnd`.

---

### Task 2: Create `MultiSelectBar` component

**New file:** `src/frontend/components/shared/MultiSelectBar.tsx`

A fixed bottom bar that replaces the tab bar during selection mode.

```ts
interface MultiSelectBarProps {
  actions: Array<{
    icon: ReactNode;
    label: string;
    onClick: () => void;
    variant?: "default" | "danger";
  }>;
}
```

**Layout:**
- Fixed to bottom, same height as tab bar (72px + safe area)
- White background with top border `#F5F5F4`
- Actions evenly spaced as icon + label columns
- "Delete" action uses `#DC2626` (red) for icon and label
- Slides up with `motion` animation when entering selection mode

**Actions by context:**

| Context | Export | Move | Favorite | Delete |
|---------|--------|------|----------|--------|
| Notes | yes | yes | yes | yes |
| Conversations | yes | no | yes | yes |
| Transcripts | yes | no | no | yes |

---

### Task 3: Create `ExportDrawer` component

**New file:** `src/frontend/components/shared/ExportDrawer.tsx`

Uses existing `BottomDrawer` (vaul) as the base.

```ts
interface ExportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /** "note" | "conversation" | "transcript" */
  itemType: "note" | "conversation" | "transcript";
  /** Title of the single item, or count for batch */
  itemLabel: string;
  /** Number of items being exported */
  count: number;
  /** Callback when export is triggered */
  onExport: (options: ExportOptions) => Promise<void>;
}

interface ExportOptions {
  includeContent: boolean;
  includeTranscript: boolean;
  destination: "clipboard" | "textFile" | "share";
}
```

**UI Structure:**
1. Drag handle bar
2. Title row: "Export Note" / "Export 3 Notes" + X close button
3. Subtitle: item title or "{n} notes selected"
4. Section label: "INCLUDED IN EXPORT" (uppercase, 12px, `#A8A29E`)
5. Toggle row: "Note Content" / subtitle / toggle switch (blue when on)
6. Divider
7. Toggle row: "Linked Transcript" / subtitle / toggle switch
8. Section label: "EXPORT TO"
9. Three option cards in a row: Clipboard (default selected, black border) | Text File | Share
10. Full-width "Export Note" button (`#1C1917` bg, white text, rounded-xl)

**Toggle switch:** Custom component — 48x28px pill, blue (#3B82F6) when on, gray (#E7E5E4) when off, white circle knob.

**Export To cards:** 88x88px, rounded-xl border, icon + label. Selected state has 2px black border.

---

### Task 4: Create `SelectionHeader` component

**New file:** `src/frontend/components/shared/SelectionHeader.tsx`

Replaces the page header when in selection mode.

```ts
interface SelectionHeaderProps {
  count: number;
  onCancel: () => void;
  onSelectAll: () => void;
}
```

**Layout:**
- `Cancel` (red, left) | `{n} selected` (center, bold) | `Select All` (right)
- Same horizontal padding as existing headers (24px)
- Font: Red Hat Display, 15px, weight 500 (Cancel/Select All), 600 (count)
- Animated swap with the normal header using `AnimatePresence`

---

### Task 5: Modify `NoteRow.tsx` for multi-select

**File:** `src/frontend/pages/notes/NoteRow.tsx`

**Changes:**
1. Add props: `isSelecting: boolean`, `isSelected: boolean`, `onLongPress: () => void`, `onToggleSelect: () => void`
2. When `isSelecting`:
   - Show animated checkbox on the left (slide in from left, 40px width)
   - Checkbox: 24x24 rounded-full, red fill (#DC2626) + white checkmark when selected, gray border (#D6D3D1) when unselected
   - Disable swipe gestures (don't call `useSwipeToReveal` handlers)
   - Tapping the row calls `onToggleSelect()` instead of `onSelect(note)`
   - Row background: light red tint (`#FEF2F2`) when selected
3. When not `isSelecting`:
   - Normal behavior (navigate on tap, swipe for actions)
   - Attach long-press handlers from `useMultiSelect.longPressProps`

**Animation:** Checkbox slides in with `motion.div` — `initial={{ width: 0, opacity: 0 }}`, `animate={{ width: 40, opacity: 1 }}`. Use `layout` prop on the content area for smooth shift.

---

### Task 6: Modify `ConversationRow.tsx` for multi-select

**File:** `src/frontend/pages/home/components/ConversationRow.tsx`

**Same pattern as NoteRow** with one key difference:

- Add `canSelect` prop derived from conversation status:
  ```ts
  const canSelect = conversation.status === "ended";
  ```
- If `isSelecting && !canSelect`: row appears dimmed (opacity 0.4), checkbox hidden, not tappable
- Long-press on active/paused conversations does nothing (disabled in `longPressProps`)

---

### Task 7: Modify `TranscriptList.tsx` for multi-select

**File:** `src/frontend/pages/home/components/TranscriptList.tsx`

**Changes:**
1. Add props: `isSelecting`, `selectedDates: Set<string>`, `onLongPress: (date: string) => void`, `onToggleSelect: (date: string) => void`
2. When `isSelecting`:
   - Show checkbox on left of each transcript row
   - Tapping toggles selection instead of navigating
   - Active/live transcript rows (today + recording) cannot be selected (dimmed)
3. When not selecting: normal behavior with long-press handlers attached

---

### Task 8: Wire up `NotesPage.tsx`

**File:** `src/frontend/pages/notes/NotesPage.tsx`

**Changes:**
1. Import and use `useMultiSelect` hook
2. Conditionally render `SelectionHeader` vs normal header based on `isSelecting`
3. Pass selection props down to each `NoteRow`
4. Conditionally render `MultiSelectBar` vs bottom tab bar
5. Hide FAB menu during selection mode
6. Hide filter pills during selection mode

**Action handlers:**
- **Export:** Open `ExportDrawer` with selected note IDs
- **Move:** Open existing folder picker (or a new simple drawer listing folders)
- **Favorite:** Batch call `session.notes.favouriteNote(id)` for each selected ID, then exit selection
- **Delete:** Batch call `session.notes.trashNote(id)` for each selected ID, then exit selection

---

### Task 9: Wire up `HomePage.tsx` (Conversations tab)

**File:** `src/frontend/pages/home/HomePage.tsx`

**Changes:**
1. Import and use `useMultiSelect` hook
2. When conversations tab is active and `isSelecting`:
   - Show `SelectionHeader`
   - Show `MultiSelectBar` with Export / Favorite / Delete
   - Hide FAB menu
3. Pass selection props to `ConversationList` → `ConversationRow`
4. Filter out active/paused conversations from `selectAll`

**Action handlers:**
- **Export:** Open `ExportDrawer` with selected conversation IDs
- **Favorite:** Batch `session.conversation.favouriteConversation(id)`
- **Delete:** Batch `session.conversation.trashConversation(id)`

---

### Task 10: Wire up `HomePage.tsx` (Transcripts tab)

**File:** `src/frontend/pages/home/HomePage.tsx`

**Changes:**
1. Use a separate `useMultiSelect` instance for transcripts (or share one with tab awareness)
2. Pass selection props to `TranscriptList`
3. Show `MultiSelectBar` with Export / Delete only

**Action handlers:**
- **Export:** Open `ExportDrawer` with selected transcript dates
- **Delete:** Batch delete transcript files for selected dates

---

### Task 11: Backend — Batch export RPC

**File:** `src/backend/session/managers/NotesManager.ts`

Add new RPC methods:

```ts
@rpc
async batchTrashNotes(noteIds: string[]): Promise<void> {
  for (const id of noteIds) {
    await this.trashNote(id);
  }
}

@rpc
async batchFavouriteNotes(noteIds: string[]): Promise<void> {
  for (const id of noteIds) {
    await this.favouriteNote(id);
  }
}

@rpc
async batchMoveNotes(noteIds: string[], folderId: string): Promise<void> {
  for (const id of noteIds) {
    await this.updateNote(id, { folderId });
  }
}

@rpc
async exportNotesAsText(noteIds: string[], includeTranscript: boolean): Promise<string> {
  // Compile all selected notes into a single text block
  // For each note: title, date, content (stripped HTML)
  // If includeTranscript: append linked conversation transcript
  // Return the combined string
}
```

**File:** `src/backend/session/managers/ConversationManager.ts`

```ts
@rpc
async batchTrashConversations(ids: string[]): Promise<void> {
  for (const id of ids) {
    await this.trashConversation(id);
  }
}

@rpc
async batchFavouriteConversations(ids: string[]): Promise<void> {
  for (const id of ids) {
    await this.favouriteConversation(id);
  }
}

@rpc
async exportConversationsAsText(ids: string[], includeTranscript: boolean): Promise<string> {
  // Compile selected conversations into text
  // Summary + optionally full transcript segments
}
```

---

### Task 12: Export logic (frontend)

**File:** `src/frontend/components/shared/ExportDrawer.tsx` (inside `onExport` handler)

**Clipboard:**
```ts
const text = await session.notes.exportNotesAsText(noteIds, includeTranscript);
await navigator.clipboard.writeText(text);
// Show toast: "Copied to clipboard"
```

**Text File:**
```ts
const text = await session.notes.exportNotesAsText(noteIds, includeTranscript);
const blob = new Blob([text], { type: "text/plain" });
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = `notes-export-${new Date().toISOString().split("T")[0]}.txt`;
a.click();
URL.revokeObjectURL(url);
```

**Share (native):**
```ts
const text = await session.notes.exportNotesAsText(noteIds, includeTranscript);
if (navigator.share) {
  await navigator.share({ title: "Exported Notes", text });
} else {
  // Fallback to clipboard
  await navigator.clipboard.writeText(text);
}
```

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **Create** | `src/frontend/hooks/useMultiSelect.ts` | Long-press + selection state hook |
| **Create** | `src/frontend/components/shared/MultiSelectBar.tsx` | Bottom action bar |
| **Create** | `src/frontend/components/shared/ExportDrawer.tsx` | Export drawer with toggles + destinations |
| **Create** | `src/frontend/components/shared/SelectionHeader.tsx` | Cancel / count / Select All header |
| **Modify** | `src/frontend/pages/notes/NoteRow.tsx` | Add checkbox, long-press, select mode |
| **Modify** | `src/frontend/pages/notes/NotesPage.tsx` | Wire up multi-select + actions |
| **Modify** | `src/frontend/pages/home/components/ConversationRow.tsx` | Add checkbox, block active conversations |
| **Modify** | `src/frontend/pages/home/components/TranscriptList.tsx` | Add checkbox, long-press, select mode |
| **Modify** | `src/frontend/pages/home/HomePage.tsx` | Wire up both conversation + transcript select |
| **Modify** | `src/backend/session/managers/NotesManager.ts` | Batch RPCs + export text |
| **Modify** | `src/backend/session/managers/ConversationManager.ts` | Batch RPCs + export text |

---

## Implementation Order

1. **Task 1** — `useMultiSelect` hook (foundation, everything depends on this)
2. **Task 4** — `SelectionHeader` (simple, needed by pages)
3. **Task 2** — `MultiSelectBar` (needed by pages)
4. **Task 3** — `ExportDrawer` (needed by export action)
5. **Task 5** — `NoteRow` modifications
6. **Task 8** — `NotesPage` wiring (first full flow — test here)
7. **Task 11** — Backend batch RPCs
8. **Task 12** — Export logic
9. **Task 6** — `ConversationRow` modifications
10. **Task 9** — `HomePage` conversations wiring
11. **Task 7** — `TranscriptList` modifications
12. **Task 10** — `HomePage` transcripts wiring

---

## Edge Cases

- **Active/paused conversations** — cannot be selected, appear dimmed in selection mode
- **Live transcript (today + recording)** — cannot be selected
- **Empty selection** — auto-exits selection mode
- **Filter change during selection** — clear selection and exit selection mode
- **Tab switch during selection** — clear selection and exit selection mode
- **Navigating away** — clear selection (useEffect cleanup)
- **Single item export** — drawer shows item title as subtitle
- **Batch export** — drawer shows "{n} items selected" as subtitle
- **No transcript linked** — "Linked Transcript" toggle disabled (grayed out) with "No transcript linked" subtitle
- **Clipboard API unavailable** — fallback to `document.execCommand("copy")` or show error
- **`navigator.share` unavailable** — hide "Share" option, show only Clipboard + Text File
