# Issue 19: Componentize Frontend — Extract SVGs & Split Large Components

Pure frontend cleanup. No backend changes. No logic changes. Just moving code into proper components.

---

## Part 1: Shared Icon Library

Create `/src/frontend/components/icons/` with reusable icon components. Each icon takes `size` (default 20) and `className` props.

### Icons to extract (6 patterns, 33+ duplicates):

| Icon | Occurrences | Files |
|------|-------------|-------|
| **StarIcon** | 7 | ConversationFilterDrawer, NotesFilterDrawer, NotePage, CollectionsPage, NotesPage, TutorialAINotes, ConversationDetailPage |
| **CloseIcon** (X) | 8+ | ExportDrawer, HomePage (×3), SearchPage, SkipDialog (×2), ContactsStep |
| **MicrophoneIcon** | 10 | FABMenu (×2), TranscriptList (×3), HomePage, SearchPage, CollectionsPage, NotesPage (×2) |
| **NoteIcon** (document) | 6 | NotesFilterDrawer, FABMenu, NotesPage, NotesFABMenu, WelcomeStep, ConversationDetailPage |
| **FolderIcon** | 5 | MultiSelectBar, FolderPicker, FolderPage, NotesFABMenu |
| **ArchiveIcon** / **TrashIcon** | 4+ | CollectionsPage, TutorialSwipe |

### Steps:
1. Create `components/icons/index.ts` barrel export
2. Create each icon component (StarIcon.tsx, CloseIcon.tsx, etc.)
3. Find-and-replace inline SVGs file by file — verify visually after each file

---

## Part 2: Split Large Components

### P0 — HomePage.tsx (1,469 lines → ~400 lines)

The biggest offender. Has 3 view modes, multi-select, export, and 12+ inline SVGs all in one file.

**Extract:**
- `components/ConversationListView.tsx` — conversation list with filters, sorting, date grouping
- `components/TranscriptListView.tsx` — transcript list with its own filters
- `components/HomeToolbar.tsx` — multi-select action bar (export, merge, favorite, delete)
- `components/HomeHeader.tsx` — top bar with search, filter toggle, view switcher

HomePage becomes an orchestrator: manages view state, passes handlers down.

### P1 — NotesPage.tsx (887 lines → ~400 lines)

**Extract:**
- `components/NoteFilterPanel.tsx` — show filter, pill filter, search input
- `components/FilteredNotesList.tsx` — renders filtered/sorted note rows
- `components/NotesToolbar.tsx` — multi-select bar (export, move to folder, delete)
- `hooks/useNoteFilters.ts` — filter state logic as a custom hook

### P1 — TranscriptTab.tsx (816 lines → ~400 lines)

**Extract:**
- `components/HourSection.tsx` — collapsible hour group with sticky header
- `components/TranscriptBanner.tsx` — interim text vs summary vs preview rendering
- `hooks/useHourGrouping.ts` — segment grouping + collapse state logic

### P2 — NotePage.tsx (782 lines → ~400 lines)

**Extract:**
- `components/NoteEditor.tsx` — TipTap editor with content
- `components/EditorToolbar.tsx` — formatting toolbar (bold, italic, lists, etc.)
- `components/NoteHeader.tsx` — title, timestamps, favorite/share/delete actions

### P2 — SearchPage.tsx (504 lines)

**Extract:**
- `components/SearchResultsList.tsx` — result rendering
- `components/RecentSearches.tsx` — recent search chips/list

### P3 — ConversationDetailPage.tsx (478 lines)

**Extract:**
- `components/ConversationHeader.tsx` — title, actions bar
- `components/ConversationActions.tsx` — favorite, delete, export actions

### P3 — ConversationsTab.tsx (491 lines)

**Extract:**
- `components/ConversationCard.tsx` — individual conversation card with expand/collapse

---

## Part 3: Onboarding SVG Cleanup

The onboarding components (WelcomeStep, TutorialAlwaysOn, TutorialAINotes, TutorialOrganize, TutorialSwipe, TutorialComplete, ContactsStep, SkipDialog) have ~40 inline SVGs total.

**Approach:** These are mostly unique illustrations, not shared icons. Extract only the ones that overlap with the shared icon library (star, close, mic, note icons). Leave tutorial-specific decorative SVGs inline — they're used once and extracting them adds indirection without reducing duplication.

---

## Rules

- No logic changes. No backend changes. Behavior stays identical.
- Follow existing architecture: page-specific components go in that page's `components/` folder. Only truly shared icons go in `components/icons/`.
- Verify visually after each extraction — no broken icons or missing props.
- Do Part 1 (icons) first since it touches many files. Then split components top-down by priority.
