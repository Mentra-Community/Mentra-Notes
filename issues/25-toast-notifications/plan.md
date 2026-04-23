# Issue 25 — Toast Notifications for Email & Copy Actions

## Problem

Today, user feedback for email-send and copy-to-clipboard actions is inconsistent across the app:

- **4 of 9 call sites** have no feedback at all (silent success, silent failure).
- **4 of 9** surface errors only inside an EmailDrawer — nothing confirms success.
- **1 of 9** ([TranscriptPage.tsx:196-214](../../src/frontend/pages/transcript/TranscriptPage.tsx#L196-L214)) already uses Sonner correctly — this is the reference implementation.

Users triggering "Email" or "Copy" from any page should get a clear, consistent confirmation that the action succeeded or failed.

## Goal

Wire up **one** shared toast component — used everywhere — that:

1. Confirms success (`"Copied to clipboard"`, `"Email sent"`, etc.) in **green**.
2. Confirms failure (`"Failed to copy"`, `"Couldn't send email"`) in **red**.
3. Appears at the **top of the screen**, sliding down.
4. Matches the existing UI (Red Hat Display font, radius, shadow).
5. Is a shared component in [src/frontend/components/shared/](../../src/frontend/components/shared/) so every page uses the same thing.

## Non-Goals

- Not replacing Sonner — Sonner is already installed (`v2.0.7`) and wired in [App.tsx:171](../../src/frontend/App.tsx#L171). We wrap it, we don't rebuild it.
- Not handling every notification type (info, warning, loading) — just **success** and **error** for now. Add more later if needed.
- Not changing the existing EmailDrawer error UI — the in-drawer error state stays; the toast is additive.

---

## Design Spec

### Visual

| Token         | Success                        | Error                          |
| ------------- | ------------------------------ | ------------------------------ |
| Color         | `#34c759` (`--color-resolved`) | `#d4183d` (`--destructive`)    |
| Icon          | `CheckCircle2` (lucide-react)  | `AlertCircle` (lucide-react)   |
| Text color    | white on colored bg            | white on colored bg            |

- **Font:** Red Hat Display (project default — inherits from `--font-red-hat`)
- **Border radius:** `rounded-md` (matches project `--radius`)
- **Shadow:** `0px 4px 16px rgba(0,0,0,0.08)` (matches dropdown shadow pattern)
- **Padding:** Match Sonner defaults; 12px 16px
- **Width:** Auto, max ~360px

### Position & Motion

- **Position:** `top-center` (flip Sonner's current `bottom-center` in [App.tsx:171](../../src/frontend/App.tsx#L171))
- **Entrance:** Slide down from top + fade in, ~300ms ease-out (matches [index.css](../../src/frontend/index.css) keyframe conventions)
- **Exit:** Fade out, ~200ms ease-in
- **Duration:** 3s default for success, 5s for error (errors need more read time)
- **Dismissible:** tap/click to dismiss early

### Dark Mode

Sonner's `theme={theme}` is already wired in [App.tsx:171](../../src/frontend/App.tsx#L171). Colors above are already used consistently in both modes via [sega.css](../../src/frontend/styles/sega.css), so no extra work needed.

---

## API Design

New shared module: `src/frontend/components/shared/toast.ts`

```ts
import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (message: string) => sonnerToast.success(message, { duration: 3000 }),
  error:   (message: string) => sonnerToast.error(message,   { duration: 5000 }),
};
```

Colors are applied via a single `<Toaster />` config in `App.tsx` using Sonner's `toastOptions.classNames` (tied to `--color-resolved` and `--destructive`). This keeps call sites simple:

```ts
import { toast } from "@/components/shared/toast";

toast.success("Copied to clipboard");
toast.error("Failed to copy");
```

### Why a wrapper, not raw `sonner`?

- **One place** to change defaults (duration, position, style).
- **Stops drift** — call sites can't pass custom `position: "bottom-center"` etc. that break consistency.
- **Easier to swap** the underlying lib later if needed.

---

## Call Site Rollout — Checklist

### Clipboard Sites

- [x] [HomePage.tsx:91](../../src/frontend/pages/home/HomePage.tsx#L91) — batch transcript copy. Wrapped in try/catch, toast on success/error.
- [x] [NotesPage.tsx:144](../../src/frontend/pages/notes/NotesPage.tsx#L144) — batch notes copy. Wrapped in try/catch, toast on success/error.
- [x] [NotePage.tsx:254](../../src/frontend/pages/note/NotePage.tsx#L254) — single note copy. Wrapped in try/catch, toast on success/error.
- [x] [TranscriptPage.tsx:196-214](../../src/frontend/pages/transcript/TranscriptPage.tsx#L196-L214) — single transcript copy. Migrated to shared `toast` wrapper (dropped hard-coded `position`).

### Email Sites

- [x] [HomePage.tsx:144](../../src/frontend/pages/home/HomePage.tsx#L144) — batch transcript email. Success toast after fetch resolves (`"Email sent to {to}"`). Drawer still handles errors inline.
- [x] [TranscriptPage.tsx:241](../../src/frontend/pages/transcript/TranscriptPage.tsx#L241) — single transcript email. Success toast.
- [x] [NotesPage.tsx:169](../../src/frontend/pages/notes/NotesPage.tsx#L169) — batch notes email. Success toast.
- [x] [NotePage.tsx:298](../../src/frontend/pages/note/NotePage.tsx#L298) — single note email. Success toast.
- [x] [SettingsPage.tsx:227-243](../../src/frontend/pages/settings/SettingsPage.tsx#L227-L243) — export-all ZIP email. **Banner removed**, toast only (per user direction: keep toasts consistent; don't fire many). Error still handled by the drawer's inline state.

### Global Config

- [x] [App.tsx:171](../../src/frontend/App.tsx#L171) — flipped to `position="top-center"`, `toastOptions.classNames` sets success green (`#34c759`) and error red (`#d4183d`). `App.tsx` auto-note error toast also migrated to shared wrapper.

---

## Open Questions

1. **EmailDrawer in-drawer error box** — keep it *and* fire a toast, or replace with a toast only? Keeping both is safer (user might have already scrolled past the toast) but adds UI noise. **Default: keep both** until user feedback says otherwise.
2. **Per-success-message wording** — should success messages be specific (`"Transcript copied"`, `"Note copied"`, `"Email sent to you@x.com"`) or generic (`"Copied to clipboard"`, `"Email sent"`)? **Default: specific for emails (include recipient), generic for copies.**
3. **Offline / network error** — when a fetch fails with no response (offline), the current drawer shows `"Failed to send email"`. Toast should say the same. No special offline handling needed for this issue.

---

## Acceptance

- [ ] `src/frontend/components/shared/toast.ts` exists and exports `{ success, error }`.
- [ ] `App.tsx` Toaster position is `top-center` with success/error color classes applied.
- [ ] All 9 call sites in the checklist above fire the correct toast on both success and error paths.
- [ ] No direct `sonner` imports remain in page files — everything goes through the shared wrapper.
- [ ] Manual smoke test: trigger copy + email from each of the 5 pages (Home, Transcript, Notes, Note, Settings) in both light and dark mode; confirm success and error colors are correct and toast appears at top.
