# Plan: Settings Page Redesign — Export / Delete All

## Goal

Replace the current `/settings` surface with the new Paper-inspired layout: profile card + **Export** section containing exactly two actions (Export all data, Delete all data). Remove the onboarding reset button and the persistent-transcription toggle — the new settings surface is minimal and focused on data ownership.

The **Timezone** line stays — same place it is now — just inline, rendered as the user's local/stored timezone string.

## What changes

### Remove / unhook

- **"Reset onboarding" row** — gone. No longer exposed in Settings.
- **"Persistent transcription" toggle** (entire "Recording" section) — gone from Settings UI. The underlying `showLiveTranscript` setting stays in the backend, we just stop surfacing it here.
- **Dark Mode toggle** (already commented out) — stays removed.
- **Profile row chevron** — removed. Profile row is informational only, not tappable.

### Keep / change

- **Header** — "MENTRA NOTES" red kicker + big "Settings" title (same warm stone bg `#FCFBFA`, same type scale as Paper spec).
- **Profile row** — avatar + display name + `role · company` subtitle. **No chevron**, no tap target — it's purely informational.
- **Export section** — section header `EXPORT` in red-hat bold tracking kicker, then two rows:
  1. **Export all data** — subtitle "Download transcripts and notes as a ZIP file" + chevron → opens Export-All confirm drawer.
  2. **Delete all data** — red title (`#D32F2F`) + subtitle "Permanently remove all transcripts and notes" → opens Delete-All confirm drawer with 10-second safety gate.
- **Timezone** — inline line under a `TIMEZONE` section header: `{savedTimezone}` with the same "Days and times are shown in your local timezone" helper text (replace the placeholder in the Paper spec with the real stored value from `session.settings.timezone`).
- **Version footer** — same `Mentra Notes v{ver}` line, centered, light color.

### Export All — behavior

- One option only: a ZIP containing **transcripts + notes** as **plain `.txt` files** (no Markdown, no JSON, no folders, no conversations).
  - `transcripts/YYYY-MM-DD.txt` — one file per day, full transcript for that day.
  - `notes/{note-title-or-id}.txt` — one file per note, title as first line, body below.
- Tapping the row opens a bottom drawer (`vaul` Drawer, same pattern as `ExportDrawer`) with:
  - Title: "Export all data"
  - Body: "A ZIP file of plain-text transcripts and notes will be prepared and downloaded."
  - Primary button: **Export** (kicks off backend job → returns a signed URL / triggers browser download).
  - Secondary: Cancel.
- No destination picker, no toggles. It's a single action.

### Delete All — behavior (safety-gated)

Delete is irreversible, so we gate it with a 10-second forced wait **and** an explicit confirmation checkbox.

Drawer contents:
- Title: "Delete all data"
- Body: "This will permanently remove all your transcripts and notes. This cannot be undone."
- **Checkbox** — labeled "I understand my data will be permanently deleted." Disabled until the 10-second countdown completes.
- **Countdown line** — "You can confirm in Ns…" counting down from 10 → 0. Starts ticking the moment the drawer opens. When it hits 0 the checkbox becomes tappable.
- **Primary button**: `Delete everything`
  - Disabled while countdown is running OR checkbox is unticked.
  - Enabled only when countdown == 0 AND checkbox is checked.
  - Red destructive style (same `#DC2626` palette as FolderPage delete).
- **Secondary**: Cancel (always enabled, closes drawer, resets state).

State resets (checkbox unticked, countdown back to 10) every time the drawer is re-opened — user can't bypass the wait by opening/closing quickly.

On confirm: fire a new backend RPC `deleteAllUserData(userId)` that wipes **everything like a fresh install** — notes + transcripts + hour summaries + conversations + folders + any cached search/vector data — **except** the `settings` document (keep display name, role, company, timezone, onboarding flag, etc. exactly as-is). After wipe, **stay on the Settings page**; close the drawer and show a transient success toast/banner ("All data deleted"). Do not navigate away.

## Files to touch

**Frontend**
- `src/frontend/pages/settings/SettingsPage.tsx` — rewrite to Paper layout. Strip onboarding reset, persistent transcription toggle. Keep profile + timezone. Add Export section with the two rows + drawers.
- `src/frontend/components/shared/ExportAllDrawer.tsx` (new) — simple bottom drawer, single Export action. Or fold into SettingsPage as a local component if small enough.
- `src/frontend/components/shared/DeleteAllDrawer.tsx` (new) — bottom drawer with 10s countdown + checkbox + gated delete button.

**Backend**
- `src/backend/session/managers/SettingsManager.ts` (or wherever the user-level RPCs live) — add:
  - `exportAllData()` → streams/returns a ZIP of transcripts + notes.
  - `deleteAllUserData()` → transactional wipe across collections.
- New backend route for the ZIP download if current RPC channel can't stream binary.

## Decisions (confirmed)

1. **Profile row chevron** — removed. Profile is informational.
2. **Export ZIP format** — plain `.txt` files (`transcripts/YYYY-MM-DD.txt` + `notes/{title}.txt`).
3. **Persistent transcription toggle** — fully removed from Settings UI.
4. **Delete All scope** — fresh-install wipe: notes + transcripts + hour summaries + conversations + folders + any vector/search cache. **Settings document is preserved** (display name, role, company, timezone, onboarding flag).
5. **Post-delete navigation** — stay on `/settings`; close drawer, show success toast, no redirect.

## Acceptance

- Route `/settings` renders the new Paper-inspired layout with profile, Export section (two rows), Timezone, version footer.
- Onboarding reset + persistent transcription toggle no longer visible.
- Tapping **Export all data** opens the single-option export drawer; confirming downloads a ZIP of transcripts + notes.
- Tapping **Delete all data** opens the gated confirm drawer:
  - 10-second countdown visibly ticks down.
  - Checkbox is unticked and disabled until countdown == 0.
  - Delete button is disabled until both: countdown == 0 AND checkbox checked.
  - Re-opening the drawer resets countdown + checkbox.
- On confirm, `deleteAllUserData` runs; drawer closes, success toast appears, page stays on `/settings`. Settings document (profile/timezone/onboarding) is untouched; all other user data is wiped.
- Timezone line shows the stored `settings.timezone`.
- No changes to the bottom tab bar behavior on this route.

## Paper reference (target design)

```tsx
/**
 * from Paper
 * https://app.paper.design/file/01KPBRQRHRBZCWW8R5CSKT3CZE/1-0/AJ-0
 * on Apr 17, 2026
 */
export default function () {
  return (
    <div className="[font-synthesis:none] flex overflow-clip w-98.25 h-213 flex-col pt-4.75 pb-0 bg-[#FCFBFA] antialiased text-xs/4 px-0">
      <div className="flex flex-col pt-6.5 pb-4 gap-0.5 px-6">
        <div className="tracking-[1.5px] uppercase inline-block text-[#D32F2F] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-[11px]/3.5">
          Mentra Notes
        </div>
        <div className="[letter-spacing:-0.5px] inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Black','Red_Hat_Display',system-ui,sans-serif] font-black text-[34px]/10.5">
          Settings
        </div>
      </div>
      <div className="flex items-center py-3 px-6 gap-3.5">
        <div className="flex items-center justify-center rounded-3xl bg-[#EBE7E1] shrink-0 size-12">
          <div className="inline-block text-[#6B655D] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-lg/5.5">
            PP
          </div>
        </div>
        <div className="flex flex-col grow shrink basis-[0%] gap-0.5">
          <div className="inline-block text-[#1A1A1A] font-['RedHatDisplay-Regular_Bold','Red_Hat_Display',system-ui,sans-serif] font-bold text-base/5">
            Parth Pawar
          </div>
          <div className="inline-block text-[#9C958D] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-[13px]/4">
            Product Manager · Mentra
          </div>
        </div>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
      <div className="flex flex-col pt-2 px-6">
        <div className="tracking-[1px] uppercase text-[#9C958D] font-sans py-3 text-[11px]/3.5">
          Export
        </div>
        <div className="flex justify-between items-center py-4 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col gap-0.5">
            <div className="text-[#1A1A1A] font-sans text-[15px]/4.5">
              Export all data
            </div>
            <div className="text-[#9C958D] font-sans text-xs/4">
              Download transcripts and notes as a ZIP file
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: '0' }}>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
        <div className="flex justify-between items-center py-4 border-t border-t-solid border-t-[#F0EDEA]">
          <div className="flex flex-col gap-0.5">
            <div className="text-[#D32F2F] font-sans text-[15px]/4.5">
              Delete all data
            </div>
            <div className="text-[#9C958D] font-sans text-xs/4">
              Permanently remove all transcripts and notes
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-center h-99.75 items-end pt-89.5 pb-6 shrink-0 px-6">
        <div className="inline-block self-stretch text-[#B0AAA2] font-['RedHatDisplay-Regular','Red_Hat_Display',system-ui,sans-serif] text-xs/4">
          Mentra Notes v0.1.0
        </div>
      </div>
      <div className="flex w-98.25 min-h-20 items-start justify-around pt-2.5 pb-5.5 bg-white border-t border-t-solid border-t-[#E8E5E1] px-7.5">
        {/* bottom tab bar — already handled by Shell.tsx, not duplicated here */}
      </div>
    </div>
  );
}
```
