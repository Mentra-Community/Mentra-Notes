# Homepage Conversations UI Refactor

Owner: Aryan
Priority: Medium — UI-only, no schema/backend changes

---

## Overview

Redesign the HomePage from a **day-based folder list** to a **conversation-based list** matching the new Paper designs. The core change is: instead of grouping by day and showing folder cards, we show individual conversations grouped by day sections (Today, Yesterday, date headers). No backend or schema changes — we already have `ConversationManagerI` with `Conversation[]` on the session.

---

## What Already Exists (DO NOT TOUCH)

- `ConversationManagerI` — exposes `conversations: Conversation[]` and `activeConversationId`
- `Conversation` interface — has `id`, `title`, `status`, `startTime`, `endTime`, `chunks`, `runningSummary`, `aiSummary`, `generatingSummary`
- `FileManagerI` — existing file/folder state (keep for filter logic, archive, trash)
- `TranscriptManager.isRecording` — recording status
- All backend managers, models, RPCs — untouched
- Router structure — untouched

---

## Design States (from Paper)

### State 1: Empty (no conversations)
- Header: "MENTRA NOTES" brand label (red, uppercase, tracking-widest) + "Conversations" title (30px extrabold)
- Subtitle: "No conversations yet"
- Center: chat bubble icon in rounded square + "Start a conversation" message + description text
- Bottom pill: "Microphone active · Listening" (red indicator, shown when `isRecording`)
- Top-right: overflow menu button (3 dots + collapse)
- FAB: red "+" button (bottom-right, above tab bar)
- Tab bar: Conversations (active/filled), Search, Notes, Settings

### State 2: Populated conversations list
- Same header with "Conversations" title
- **Filter bar**: filter icon button + list/calendar view toggle (pill segmented control)
- **Filter pills**: "All" (active/dark) and "Today" (inactive/gray)
- **Day section headers**: "TODAY", "YESTERDAY", "FRI MAR 6" (uppercase, tracking-widest, muted)
- **Conversation rows** (each row):
  - Left: time (hour:minute bold) + AM/PM below
  - Center: conversation title (16px semibold) + metadata row (duration badge "16 min" + speaker names "You, Sarah, Mike")
  - Right: chevron
  - Active conversation: red time + red "Transcribing now" badge with audio bars animation + red bottom border
- FAB + top-right menu + tab bar (same as empty state)

### State 3: Swipe-to-manage (conversation row)
- Swipe left reveals: Archive (black bg) + Delete (red bg) action buttons
- Shows icon + label for each action

### State 4: FAB expanded (floating action menu)
- FAB becomes X (close)
- Stacked action pills above FAB:
  - "Ask AI" + star icon (white bg, shadow)
  - "Add manual note" + document icon (white bg, shadow)
  - "Stop transcribing" + mic icon (red bg — only when recording)

---

## Data Mapping

| Design element | Source | Notes |
|---|---|---|
| Conversation title | `conversation.title` | From ConversationManagerI |
| Time (2:10 PM) | `conversation.startTime` | Format with date-fns |
| Duration (16 min) | `conversation.startTime` + `conversation.endTime` | Calculate diff, null endTime = active |
| "Transcribing now" | `conversation.status === "active"` | Red styling + audio bars |
| Speaker names | Not in schema yet | Use placeholder or omit for now |
| Day grouping | `conversation.date` | Group by YYYY-MM-DD, compare to today/yesterday |
| "All" / "Today" filter | Frontend-only state | Filter conversations by date |
| Archive/Delete swipe | `file.archiveFile()` / existing trash RPCs | Wire to existing FileManager RPCs |
| "Ask AI" action | Opens GlobalAIChat | Already exists |
| "Add manual note" | Navigate to `/day/{today}/note/new` or equivalent | Existing flow |
| "Stop transcribing" | Existing transcript stop RPC | Only shown when recording |
| Microphone active pill | `session.transcript.isRecording` | Already available |

---

## Implementation Steps

### Step 1: Create ConversationList component
**File:** `src/frontend/pages/home/components/ConversationList.tsx`

Replace `FolderList` usage in HomePage with a new `ConversationList` that:
- Takes `conversations: Conversation[]`, `isRecording: boolean`, `onSelectConversation`
- Groups conversations by day (Today / Yesterday / formatted date)
- Renders day section headers (uppercase, tracking-widest, muted text)
- Renders conversation rows with: time | title + metadata | chevron
- Active conversation row gets red styling + "Transcribing now" badge
- Keep the existing `FolderList` file intact (don't delete it — may be needed for folder view mode)

### Step 2: Create ConversationRow component
**File:** `src/frontend/pages/home/components/ConversationRow.tsx`

Individual conversation row:
- Time column (fixed width): formatted hour:minute + AM/PM
- Content column (flex grow): title + metadata row (duration pill + speaker count placeholder)
- Chevron right
- Active state: red text color for time, red "Transcribing now" badge with animated audio bars
- Swipe-to-reveal: Archive + Delete action buttons (use touch events or a swipe library)

### Step 3: Update HomePage header
**File:** `src/frontend/pages/home/HomePage.tsx`

- Replace current header with new design:
  - Brand label: "MENTRA NOTES" (red, 11px, uppercase, tracking-widest, Red Hat Display font)
  - Title: "Conversations" (30px, extrabold, Red Hat Display)
  - Subtitle: count text like "Today · 6 conversations" (only when populated)
- Right side: filter button + list/calendar segmented control toggle
- Add filter pills row below header: "All" (active) / "Today"
- Top-right: overflow/collapse menu (absolute positioned)

### Step 4: Update empty state
**File:** `src/frontend/pages/home/HomePage.tsx`

Match Paper empty design:
- Centered chat bubble icon in rounded square (64px)
- "Start a conversation" bold heading
- Description text about background listening
- "Microphone active · Listening" pill (red, shown when `isRecording`)

### Step 5: Create FAB menu component
**File:** `src/frontend/pages/home/components/FABMenu.tsx`

- Default: red "+" FAB button (bottom-right, 52px, rounded-2xl, red shadow)
- Expanded: X close button + stacked action pills animating in from below
  - "Ask AI" — triggers GlobalAIChat
  - "Add manual note" — navigates to note creation
  - "Stop transcribing" — only shown when recording, stops transcript
- Backdrop overlay when expanded
- Smooth animation (motion/react)

### Step 6: Wire up HomePage to use conversations
**File:** `src/frontend/pages/home/HomePage.tsx`

- Read `session.conversation.conversations` instead of (or alongside) `session.file.files`
- Pass conversations to ConversationList
- Handle conversation selection → navigate to conversation detail or day page
- Keep existing filter/view logic working alongside new conversation view

### Step 7: Add tab bar
**File:** `src/frontend/components/shared/TabBar.tsx` (or in layout)

- Fixed bottom bar: Conversations, Search, Notes, Settings
- Active state: filled icon + semibold label (dark)
- Inactive: outlined icon + medium label (muted)
- This may already exist or be part of the router layout — check before creating

---

## Design Tokens (from Paper)

```
Font: Red Hat Display, system-ui, sans-serif
Background: #FAFAF9 (warm off-white)
Text primary: #1C1917
Text muted: #A8A29E
Text secondary: #78716C
Accent red: #DC2626
Accent red light: #FEE2E2
Active bg dark: #1C1917
Surface: #F5F5F4
Border: #E7E5E4
Border active: #FEE2E2 (red tint for active conversation)

Brand label: 11px, uppercase, tracking-widest, bold, red
Page title: 30px, -0.03em tracking, extrabold
Section header: 11px, uppercase, tracking-widest, bold, muted
Conversation title: 16px, semibold
Time: 14px, semibold
Duration badge: 11px, medium, in rounded pill with #F5F5F4 bg
Tab label: 10px, active=semibold, inactive=medium
```

---

## What NOT to Do

- Do NOT change any backend code, schemas, or models
- Do NOT change the router structure
- Do NOT remove existing components — add new ones alongside
- Do NOT implement conversation detection logic (that's issue #1)
- Do NOT implement speaker identification (not in schema yet)
- Do NOT add new RPCs or manager methods
- Do NOT change the sync/websocket layer
