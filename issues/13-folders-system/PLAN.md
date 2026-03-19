Go for it.# Issue 13: Folders System — Notes Organization

## Overview

Add a folder system to organize notes. Users can create folders with a name and color, and assign any note to exactly one folder. Every new user gets two default folders: "Personal" and "Work". Folders are manageable (rename, delete, change color). Notes are assigned to folders via a dropdown selector on the note editor page.

## Data Model

### Folder Schema (`folder.model.ts`)

```ts
{
  id: string;           // unique ID
  userId: string;       // owner
  name: string;         // e.g. "Work Notes"
  color: "red" | "gray" | "blue";  // one of 3 options
  createdAt: Date;
  updatedAt: Date;
}
```

**MongoDB collection:** `folders`

**Color hex mapping:**
- `red` → `#DC2626`
- `gray` → `#78716C`
- `blue` → `#2563EB`

### Note Schema Change

Add optional `folderId` field to existing `Note` interface:

```ts
// in shared/types.ts — Note interface
folderId?: string;  // ID of folder this note belongs to (null = no folder)
```

Also add to the Mongoose note model schema.

## Default Folders

On first session creation (or when user has 0 folders), auto-create:

| Name | Color |
|------|-------|
| Personal | blue |
| Work | red |

**Where:** In `NotesManager` or a new `FoldersManager` initialization, triggered during session setup. Check `folders.countDocuments({ userId })` — if 0, seed defaults.

## Backend Implementation

### New Files

| File | Purpose |
|------|---------|
| `src/backend/models/folder.model.ts` | Mongoose schema + CRUD functions: `createFolder`, `getFolders`, `updateFolder`, `deleteFolder` |
| `src/backend/session/managers/FoldersManager.ts` | Synced manager exposing folders state + methods to frontend |

### Model Functions (`folder.model.ts`)

```ts
createFolder(userId: string, name: string, color: FolderColor): Promise<Folder>
getFolders(userId: string): Promise<Folder[]>
updateFolder(userId: string, folderId: string, updates: { name?: string; color?: FolderColor }): Promise<Folder | null>
deleteFolder(userId: string, folderId: string): Promise<void>
// When a folder is deleted, unset folderId on all notes that reference it
```

### FoldersManager (synced manager)

Exposes to frontend via sync system:
- **State:** `folders: Folder[]`
- **Methods:** `createFolder(name, color)`, `updateFolder(folderId, updates)`, `deleteFolder(folderId)`

Register in session setup alongside existing managers (NotesManager, ConversationManager, etc.)

### Note Model Changes

- Add `folderId` to note Mongoose schema (optional String, default null)
- Add/update model function: `updateNote` already exists — ensure it can set `folderId`
- When a folder is deleted, run: `Note.updateMany({ userId, folderId }, { $unset: { folderId: 1 } })`

### Shared Types (`shared/types.ts`)

```ts
type FolderColor = "red" | "gray" | "blue";

interface Folder {
  id: string;
  name: string;
  color: FolderColor;
  createdAt: Date;
  updatedAt: Date;
}

// Add to SessionI or create FoldersSyncedI:
interface FoldersSyncedI {
  folders: Folder[];
  createFolder(name: string, color: FolderColor): Promise<Folder>;
  updateFolder(folderId: string, updates: { name?: string; color?: FolderColor }): Promise<Folder | null>;
  deleteFolder(folderId: string): Promise<void>;
}
```

Add `folderId?: string` to existing `Note` interface.

## Frontend Implementation

### 1. Note Editor — Folder Dropdown (`/note/:id`)

Add a folder selector bar at the bottom of the note editor (above keyboard area or below content).

**Collapsed state (from Paper design):**
```
┌─────────────────────────────────┐
│ 📁  No folder               ▼  │
└─────────────────────────────────┘
```
- Rounded pill, `bg-[#F5F5F4]`, folder icon + label + chevron down
- Label shows current folder name or "No folder"

**Expanded state (dropdown):**
- List of all user folders, each showing: color dot + folder name
- "No folder" option at top to unassign
- Tapping a folder calls `session.notes.updateNote(noteId, { folderId })` and closes dropdown

**File:** Add `FolderPicker` component at `src/frontend/pages/note/FolderPicker.tsx`

### 2. CollectionsPage Updates

Replace placeholder `PLACEHOLDER_FOLDERS` with real data from `session.folders.folders`.

- Folder cards show real name, color bar, and note count
- Note count: derive from `notes.filter(n => n.folderId === folder.id).length`
- "New Folder" button → opens a create folder modal/sheet

### 3. Create Folder Flow

Simple inline creation (modal or bottom sheet):
- Text input for name
- 3 color swatches to pick from (red, gray, blue)
- "Create" button
- Calls `session.folders.createFolder(name, color)`

**File:** `src/frontend/pages/notes/CreateFolderSheet.tsx`

### 4. Folder Detail Page (`/folder/:id`)

Reuses the NotesPage layout but filtered:
- Header: folder icon (colored) + folder name as title
- Subtitle: "X notes"
- List: only notes where `note.folderId === folderId`
- Same NoteRow components with swipe-to-delete/archive
- Edit button in header → rename/change color/delete folder

**File:** `src/frontend/pages/notes/FolderPage.tsx`
**Route:** `/folder/:id`

### 5. Folder Management (Edit/Delete)

On FolderPage header, an edit/settings button opens options:
- Rename folder (text input)
- Change color (3 swatches)
- Delete folder (confirmation prompt — notes are unassigned, not deleted)

## File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `src/backend/models/folder.model.ts` | Mongoose model + CRUD |
| `src/backend/session/managers/FoldersManager.ts` | Synced manager |
| `src/frontend/pages/note/FolderPicker.tsx` | Dropdown on note editor |
| `src/frontend/pages/notes/CreateFolderSheet.tsx` | Create folder modal |
| `src/frontend/pages/notes/FolderPage.tsx` | Folder detail view |

### Modified Files

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `Folder`, `FolderColor`, `FoldersSyncedI`, add `folderId?` to `Note` |
| `src/backend/models/index.ts` | Export folder model functions |
| `src/backend/models/note.model.ts` | Add `folderId` to schema |
| `src/backend/session/managers/NotesManager.ts` | Ensure `updateNote` handles `folderId` |
| `src/backend/session/Session.ts` (or equivalent) | Register FoldersManager |
| `src/frontend/router.tsx` | Add `/folder/:id` route |
| `src/frontend/pages/notes/CollectionsPage.tsx` | Replace placeholders with real folder data |
| `src/frontend/pages/notes/NotesFABMenu.tsx` | Wire "Create folder" to open CreateFolderSheet |
| `src/frontend/pages/note/NotePage.tsx` | Add FolderPicker component |

## Implementation Order

1. **Backend model** — `folder.model.ts` with Mongoose schema + CRUD
2. **Shared types** — Add `Folder`, `FolderColor` types, `folderId` to `Note`
3. **Note model update** — Add `folderId` field to note schema
4. **FoldersManager** — Synced manager with default folder seeding
5. **Register manager** — Wire into session setup
6. **FolderPicker** — Dropdown component on NotePage
7. **CollectionsPage** — Replace placeholders with real data
8. **CreateFolderSheet** — Create folder UI
9. **FolderPage** — Folder detail view with filtered notes
10. **Folder management** — Rename, recolor, delete actions
