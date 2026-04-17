# Plan: Note Detail Page Redesign — Read-Only, Bare-Bones

## Goal

Replace the current note detail/edit surface (`/note/{id}`) with a read-only, bare-bones layout matching the new Paper design. No inline editing, no folder assignment, no filter-related metadata. Keep the two-line "From" conversation link — but **only in development**.

## What changes

### Remove / unhook

- **Inline edit affordances** — the rich text editor / edit mode / save button are gone. The page is purely read-only now. Tapping the note just shows it.
- **Folder section / assign-to-folder UI** — gone. Don't surface `folderId` here.
- **Filter-related metadata** (favourite star / archived badge / AI vs Manual badge) — gone from this page, same as the Notes list redesign.
- **Bottom tab bar** — hidden for the full time the user is on this route, via the existing `useTabBar().setHidden(true)` pattern we wired into `Shell.tsx` (same trick TranscriptPage/HomePage use during multi-select).
- Any other chrome from the old detail page (swipe gestures, conversation jump buttons, edit toolbar) that isn't in the new Paper spec.

### Keep

- **Header row**: back chevron (navigates to `/notes`) + "Note" label. Tapping the chevron returns to the Notes list.
- **Two action icons in the title row**: Share/Export (arrow-out-of-box) and Delete (trash). Wire these to:
  - Export → open the existing `ExportDrawer` with `itemType="note"` + `count=1` → clipboard / email (same single-note flow as multi-select, just scoped to this one note).
  - Delete → same permanent-delete confirm drawer as NotesPage's batch delete, but for this single note. After confirm, call `permanentlyDeleteNote(id)` and navigate back to `/notes`.
- **Title** — big extrabold 26px, `tracking-[-0.5px]`, shows `note.title` (fallback "Untitled Note").
- **Created-at line** — `Today, 2:10 PM` / `Yesterday, 2:10 PM` / `Mar 12, 2:10 PM` — same formatter as NoteRow. No weekday names. Color `#9C958D`.
- **Summary section** — `Summary` bold header + the note's `summary` or `content` text. If `content` is HTML, strip tags but preserve paragraphs (split on `\n` / `</p>` to produce separate `<div>` blocks like the Paper spec shows two stacked paragraphs). If the note has no `summary`, render the stripped `content`.
- **Key Decisions section** — optional. Only render when we have parseable bullet points. See "Parsing Key Decisions" below.
- **From (dev only)** — below the timestamp line, render `From: {conversation title}` linked to `/conversation/{conversationId}` (or no link if conversations page is dead — just text). **Guard with `import.meta.env.DEV === true`** so it strictly never renders in staging/prod builds. Find the linked conversation by `conversations.find((c) => c.noteId === note.id)`.

### Parsing Key Decisions

The Paper spec shows a "Key Decisions" section with bullet points. Today's notes don't have an explicit field for this. Options:

1. **(Preferred) Parse from `content` HTML** — if the note's `content` contains a section whose heading matches `/key decisions|decisions|action items/i`, extract the `<ul><li>` or `<ol><li>` children under it. Render each as a bullet. Skip the section if none found.
2. Alternatively, split `content` on `\n` — if lines start with `- ` / `• `, treat as bullets and render.

Whatever lives in the HTML content today is what we surface. If nothing matches, the Key Decisions block is omitted (not shown empty).

### Bottom-nav hiding

- Call `useTabBar().setHidden(true)` in a `useEffect` on NoteDetailPage mount; cleanup calls `setHidden(false)` on unmount.
- Same approach as already used in NotesPage selection mode. No changes needed to `Shell.tsx`.

## Files to touch

**Frontend**
- `src/frontend/pages/notes/NoteDetailPage.tsx` (or wherever `/note/{id}` currently renders — confirm path during implementation) — rewrite to read-only Paper layout. Keep the file name + route intact; just replace the render body.
- Reuse existing components:
  - `ExportDrawer` (already supports `itemType="note"` and we just hid the conversation toggles last change).
  - `EmailDrawer` (already wired).
  - Confirm drawer — small local component, copy lifted from NotesPage's delete confirm.
- `src/frontend/components/layout/Shell.tsx` — **no change**, already exposes `useTabBar()`.

**Backend** — no changes. We only read existing fields.

## Open questions

See the "Followups" chat — a few things I want to confirm before coding.

## Acceptance

- Route `/note/{id}` renders the new Paper-inspired read-only layout.
- **Bottom tab bar is hidden while on this route**, restored on exit.
- Header has a back chevron and the "Note" label.
- Title row has Share (export) + Delete (trash) icons, both functional.
- Title, timestamp, Summary section, and (optional) Key Decisions bullets render per spec.
- No inline editing. No folder picker. No favourite star. No AI/Manual badge.
- `From: …` conversation link renders ONLY when `import.meta.env.DEV === true`.
- Permanent delete navigates back to `/notes`.
- Export opens the existing ExportDrawer with Clipboard / Email destinations (Linked Conversation toggles stay hidden for notes, per last change).

## Paper reference (target design)

```tsx
/**
 * from Paper
 * https://app.paper.design/file/01KPBRQRHRBZCWW8R5CSKT3CZE/1-0/4S-0
 * on Apr 17, 2026
 */
export default function () {
  return (
    <div className="[font-synthesis:none] flex overflow-clip w-98.25 h-213 flex-col bg-[#FCFBFA] antialiased text-xs/4">
      <div className="flex items-center justify-between pt-7 px-6">
        <div className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-lg/5.5">
            Note
          </div>
        </div>
      </div>
      <div className="flex flex-col grow shrink basis-[0%] px-6 overflow-clip">
        <div className="flex flex-col pb-3.5 gap-1.5 pt-2">
          <div className="flex items-center gap-1.5 w-86.25 justify-center p-0">
            <div className="[letter-spacing:-0.5px] inline-block flex-1 text-[#1A1A1A] font-['RedHatDisplay-Regular_ExtraBold','Red_Hat_Display',system-ui,sans-serif] font-extrabold text-[26px]/8">
              Client Deadline Shift
            </div>
            <div className="flex gap-3 w-fit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <polyline points="16 6 12 2 8 6" />
                <line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
          </div>
          <div className="inline-block text-[#9C958D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4">
            Today, 2:10 PM
          </div>
        </div>
        <div className="flex flex-col pt-5 gap-2.5">
          <div className="flex items-center gap-2">
            <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold w-17 text-[15px]/5.5">
              Summary
            </div>
          </div>
          <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[15px]/5.5">
            The client needs the delivery moved up by 2 weeks due to an internal launch commitment. Backend ownership needs to shift from the current team to a dedicated sprint team. Alex will handle the handoff coordination and resource allocation by end of week.
          </div>
          <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[15px]/5.5">
            The client needs the delivery moved up by 2 weeks due to an internal launch commitment. Backend ownership needs to shift from the current team to a dedicated sprint team. Alex will handle the handoff coordination and resource allocation by end of week.
          </div>
        </div>
        <div className="flex flex-col pt-6 gap-2.5">
          <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[15px]/5.5">
            Key Decisions
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-2.5">
              <div className="w-1.25 h-1.25 shrink-0 mt-1.75 rounded-[3px] bg-[#1C1917]" />
              <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[15px]/5.5">
                Move delivery timeline up by 2 weeks
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-1.25 h-1.25 shrink-0 mt-1.75 rounded-[3px] bg-[#1C1917]" />
              <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[15px]/5.5">
                Reassign backend to dedicated sprint team
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <div className="w-1.25 h-1.25 shrink-0 mt-1.75 rounded-[3px] bg-[#1C1917]" />
              <div className="inline-block text-[#1C1917] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[15px]/5.5">
                Keep frontend scope unchanged
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```
