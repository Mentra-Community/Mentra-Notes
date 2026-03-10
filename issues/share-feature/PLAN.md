# Production Readiness Plan — Notes-Isaiah

## Overview

This plan addresses all issues found during the production audit of the diff against `origin/dev`. Issues are grouped into implementation tasks ordered by priority.

---

## Task 1: Add auth middleware to email & download endpoints

**Why:** Email send endpoints (`POST /email/send`, `POST /transcript/email`) and download endpoints (`GET /notes/:id/download/:format`, `GET /transcripts/:transcriptId/download/:format`) have NO authentication. Anyone can send emails through our Resend account or download any user's notes/transcripts.

**File:** `src/backend/api/router.ts`

### 1a. Add `authMiddleware` to email endpoints

**Line 684** — Change:
```ts
api.post("/email/send", async (c) => {
```
To:
```ts
api.post("/email/send", authMiddleware, async (c) => {
```

**Line 829** — Change:
```ts
api.post("/transcript/email", async (c) => {
```
To:
```ts
api.post("/transcript/email", authMiddleware, async (c) => {
```

### 1b. Add signed token system for download URLs

Download links are clicked from emails (no auth cookie), so we need a different approach: **HMAC-signed URLs**.

**Create new file:** `src/backend/services/signedUrl.service.ts`

```ts
import { createHmac } from "crypto";

const SECRET = process.env.COOKIE_SECRET || process.env.MENTRAOS_API_KEY || "fallback-secret";

// Token expires after 7 days
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generate a signed token for a download URL.
 * Format: {expiresAt_hex}.{hmac_hex}
 */
export function generateDownloadToken(resourceId: string): string {
  const expiresAt = Date.now() + EXPIRY_MS;
  const payload = `${resourceId}:${expiresAt}`;
  const hmac = createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${expiresAt.toString(16)}.${hmac}`;
}

/**
 * Verify a signed download token.
 * Returns true if valid and not expired.
 */
export function verifyDownloadToken(resourceId: string, token: string): boolean {
  try {
    const [expiresHex, hmac] = token.split(".");
    if (!expiresHex || !hmac) return false;

    const expiresAt = parseInt(expiresHex, 16);
    if (Date.now() > expiresAt) return false;

    const payload = `${resourceId}:${expiresAt}`;
    const expected = createHmac("sha256", SECRET).update(payload).digest("hex");
    return hmac === expected;
  } catch {
    return false;
  }
}
```

**In `src/backend/services/resend.service.ts`:**

Import and use `generateDownloadToken` when building download URLs:

```ts
import { generateDownloadToken } from "./signedUrl.service";
```

**Notes email** — download URLs are built entirely in `buildNoteCardHtml` (JS, no template placeholder), so just append the token:

In `buildNoteCardHtml` (line 34), change:
```ts
const downloadBase = `${BASE_URL}/api/notes/${note.noteId}/download`;
```
To:
```ts
const token = generateDownloadToken(note.noteId);
const downloadBase = `${BASE_URL}/api/notes/${note.noteId}/download`;
```

Then update the 3 download links in the return template to append `?token=${token}`:
```
href="${downloadBase}/pdf?token=${token}"
href="${downloadBase}/txt?token=${token}"
href="${downloadBase}/docx?token=${token}"
```

**Transcript email** — download URLs use `{{downloadBase}}` as an HTML template placeholder in `transcript-email.html`. Since the token needs to be per-format URL, replace the single `{{downloadBase}}` with 3 separate placeholders in the HTML template:

In `src/public/resend-email-template/transcript-email.html`, change the 3 download links from:
```html
<a href="{{downloadBase}}/pdf" ...>PDF</a>
...
<a href="{{downloadBase}}/txt" ...>TXT</a>
...
<a href="{{downloadBase}}/docx" ...>Word</a>
```
To:
```html
<a href="{{downloadPdf}}" ...>PDF</a>
...
<a href="{{downloadTxt}}" ...>TXT</a>
...
<a href="{{downloadDocx}}" ...>Word</a>
```

Then in `buildTranscriptEmailHtml` (line 180), replace:
```ts
const downloadBase = `${BASE_URL}/api/transcripts/${transcriptId}/download`;
```
With:
```ts
const token = generateDownloadToken(transcriptId);
const downloadBase = `${BASE_URL}/api/transcripts/${transcriptId}/download`;
const downloadPdf = `${downloadBase}/pdf?token=${token}`;
const downloadTxt = `${downloadBase}/txt?token=${token}`;
const downloadDocx = `${downloadBase}/docx?token=${token}`;
```

And update the template replacements from:
```ts
.replaceAll("{{downloadBase}}", downloadBase)
```
To:
```ts
.replaceAll("{{downloadPdf}}", downloadPdf)
.replaceAll("{{downloadTxt}}", downloadTxt)
.replaceAll("{{downloadDocx}}", downloadDocx)
```

**In `src/backend/api/router.ts` download endpoints:**

Add token verification at the start of each download handler:

For note download (line 720):
```ts
api.get("/notes/:id/download/:format", async (c) => {
  try {
    const noteId = c.req.param("id");
    const format = c.req.param("format");
    const token = c.req.query("token");

    // Verify signed token
    const { verifyDownloadToken } = await import("../services/signedUrl.service");
    if (!token || !verifyDownloadToken(noteId, token)) {
      return c.json({ error: "Invalid or expired download link" }, 403);
    }
    // ... rest of handler
```

For transcript download (line 868):
```ts
api.get("/transcripts/:transcriptId/download/:format", async (c) => {
  try {
    const transcriptId = c.req.param("transcriptId");
    const format = c.req.param("format");
    const token = c.req.query("token");

    const { verifyDownloadToken } = await import("../services/signedUrl.service");
    if (!token || !verifyDownloadToken(transcriptId, token)) {
      return c.json({ error: "Invalid or expired download link" }, 403);
    }
    // ... rest of handler
```

### 1c. Scope note download session search to authenticated user

**Line 732-740** in `router.ts` — The note download loops through ALL active sessions. Since we're using signed tokens (not auth), we keep the loop but this is acceptable because the token gates access. However, if we later add auth, scope to:
```ts
// Only check the user's own session, not all sessions
const session = sessions.get(userId);
if (session) {
  const found = session.notes.notes.find((n: any) => n.id === noteId);
  if (found) noteData = found;
}
```

For now with signed URLs, the current approach is acceptable.

---

## Task 2: Derive BASE_URL from request + update env.example

**Why:** The current `BASE_URL` defaults to a dev ngrok URL (`https://general.dev.tpa.ngrok.app`). The server can't auto-detect its public URL (it only sees `localhost:3000`), but we can derive it from the `Origin` or `Host` header of the incoming request when the email endpoint is called — the browser already knows the correct origin.

**File:** `src/backend/services/resend.service.ts`

Remove the module-level `BASE_URL` constant (line 7):
```ts
// DELETE THIS LINE:
const BASE_URL = process.env.BASE_URL || "https://general.dev.tpa.ngrok.app";
```

Instead, **pass `baseUrl` as a parameter** to the email builder functions. Derive it in the router from the request.

Update `buildNoteCardHtml` signature to accept `baseUrl`:
```ts
function buildNoteCardHtml(note: NoteItem, baseUrl: string): string {
```

Update `buildNotesEmailHtml` to accept and pass `baseUrl`:
```ts
function buildNotesEmailHtml({
  sessionDate, sessionStartTime, sessionEndTime, notes, baseUrl,
}: Omit<SendNotesEmailRequest, "to" | "cc"> & { baseUrl: string }) {
  const noteCards = notes.map((n) => buildNoteCardHtml(n, baseUrl)).join("\n");
  // ...
}
```

Same for `sendNotesEmail`, `buildTranscriptEmailHtml`, `sendTranscriptEmail` — add `baseUrl` parameter.

**File:** `src/backend/api/router.ts`

Add a helper to extract the base URL from the request:
```ts
function getBaseUrl(c: any): string {
  // Try Origin header first (set by browser on same-origin requests)
  const origin = c.req.header("origin");
  if (origin) return origin;

  // Fallback to Host header + protocol
  const host = c.req.header("host");
  const proto = c.req.header("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;

  // Last resort fallback
  return process.env.BASE_URL || "https://localhost:3000";
}
```

Then in each email endpoint, pass it through:
```ts
const baseUrl = getBaseUrl(c);
const result = await sendNotesEmail({ to, cc, sessionDate, sessionStartTime, sessionEndTime, notes, baseUrl });
```

**File:** `env.example`

`BASE_URL` is no longer required, but keep it as an optional override. Add the missing env vars:

```env
# =============================================================================
# Cloudflare R2 - For storing transcripts and photos
# =============================================================================

CLOUDFLARE_R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
CLOUDFLARE_R2_BUCKET_NAME=mentra-notes
CLOUDFLARE_R2_ACCESS_KEY_ID=your_r2_access_key
CLOUDFLARE_R2_SECRET_ACCESS_KEY=your_r2_secret_key

# =============================================================================
# Email (Resend) - For sending notes and transcripts via email
# =============================================================================

RESEND_API_KEY=re_your_resend_api_key

# Optional: Override the base URL for download links in emails.
# If not set, automatically derived from the request Origin/Host header.
# BASE_URL=https://your-app-domain.com
```

---

## Task 3: Remove error details leak (all endpoints)

**Why:** `details: String(err)` and `err.message` in error responses can leak internal stack traces, file paths, or API keys to the client.

**File:** `src/backend/api/router.ts`

**Line 709** — Remove `details`:
```ts
return c.json({ error: err.message || "Failed to send email", details: String(err) }, 500);
```
To:
```ts
return c.json({ error: "Failed to send email" }, 500);
```

**Line 818** — Download endpoint:
```ts
return c.json({ error: err.message || "Failed to generate download" }, 500);
```
To:
```ts
return c.json({ error: "Failed to generate download" }, 500);
```

**Line 860** — Remove `details`:
```ts
return c.json({ error: err.message || "Failed to send email", details: String(err) }, 500);
```
To:
```ts
return c.json({ error: "Failed to send email" }, 500);
```

**Line 1009** — Download endpoint:
```ts
return c.json({ error: err.message || "Failed to generate download" }, 500);
```
To:
```ts
return c.json({ error: "Failed to generate download" }, 500);
```

Keep the `console.error` calls — those log to server only.

---

## Task 4: Validate & sanitize email inputs

**Why:** The `notes` array from the request body is passed directly to `sendNotesEmail` without validation. Malformed input could inject arbitrary HTML into emails. Transcript `seg.text` is also interpolated raw into email HTML with no escaping.

**File:** `src/backend/api/router.ts`

### 4a. Validate notes array

After line 693 (the `notes.length === 0` check), add:

```ts
// Validate each note item
for (const note of notes) {
  if (!note.noteId || !note.noteTitle || typeof note.noteContent !== "string") {
    return c.json({ error: "Each note must have noteId, noteTitle, and noteContent" }, 400);
  }
}
```

### 4b. Sanitize note content (proper HTML sanitization)

Script-tag-only stripping is insufficient — email HTML injection can happen via `<img onerror="...">`, `<a href="javascript:...">`, `<style>`, etc. Since `noteContent` is rich HTML from TipTap, use a more complete sanitization:

```ts
/** Strip dangerous HTML patterns from email content */
function sanitizeEmailHtml(html: string): string {
  return html
    // Remove script tags
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // Remove event handlers (onclick, onerror, onload, etc.)
    .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/\s+on\w+\s*=\s*[^\s>]+/gi, "")
    // Remove javascript: URLs
    .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"')
    .replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""')
    // Remove style tags (can be used for CSS injection/phishing)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Remove iframes
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    // Remove form elements
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, "")
    .replace(/<input[^>]*\/?>/gi, "")
    .replace(/<button[^>]*>[\s\S]*?<\/button>/gi, "");
}
```

Add this function near the top of `router.ts` and use it:

```ts
const sanitizedNotes = notes.map((note: any) => ({
  ...note,
  noteTitle: sanitizeEmailHtml(note.noteTitle),
  noteContent: sanitizeEmailHtml(note.noteContent),
}));
```

Pass `sanitizedNotes` instead of `notes` to `sendNotesEmail`.

### 4c. Validate transcript segments

For transcript email endpoint (line 840), add:

```ts
for (const seg of segments) {
  if (typeof seg.timestamp !== "string" || typeof seg.text !== "string") {
    return c.json({ error: "Each segment must have timestamp and text strings" }, 400);
  }
}
```

### 4d. HTML-escape transcript text in email template

**File:** `src/backend/services/resend.service.ts`

Transcript `seg.text` and `seg.timestamp` are plain text but interpolated raw into HTML. Add an `escapeHtml` helper and use it in `buildTranscriptRowsHtml`:

```ts
/** Escape plain text for safe HTML interpolation */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

In `buildTranscriptRowsHtml` (line 152), change:
```ts
${seg.timestamp}
```
to:
```ts
${escapeHtml(seg.timestamp)}
```

And:
```ts
${seg.text}
```
to:
```ts
${escapeHtml(seg.text)}
```

---

## Task 5: Remove dead `framer-motion` dependency

**File:** `package.json`

Remove line 42:
```json
"framer-motion": "^11.18.2",
```

The codebase uses `motion/react` (from the `motion` package on line 45). `framer-motion` is the old package name and is unused dead weight.

After editing, run: `bun install`

---

## Task 6: Fix NotePage email sending

**File:** `src/frontend/pages/note/NotePage.tsx`

**Lines 389-433** — The "Send Email" menu button sends directly without the EmailDrawer, hardcodes `to: userId || ""` (user's own email only), and has no CC support.

Replace the inline email send with opening the EmailDrawer:

1. Add state at the top of the component (after line 49):
```ts
const [showEmailDrawer, setShowEmailDrawer] = useState(false);
```

2. Add import for EmailDrawer:
```ts
import { EmailDrawer } from "../../components/shared/EmailDrawer";
```

3. Replace the email button onClick (lines 389-433) with:
```ts
onClick={() => {
  setShowMenu(false);
  setShowEmailDrawer(true);
}}
```

4. Add the EmailDrawer component and `handleEmailSend` callback:
```tsx
const handleEmailSend = useCallback(async (to: string, cc: string) => {
  if (!note) return;
  const ccList = cc ? cc.split(",").filter(Boolean) : undefined;
  const dateStr = note.date || "";
  const noteDate = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const sessionDate = noteDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const createdAt = note.createdAt ? new Date(note.createdAt) : new Date();
  const noteTimestamp = createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const startTime = note.transcriptRange?.startTime
    ? new Date(note.transcriptRange.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : noteTimestamp;
  const endTime = note.transcriptRange?.endTime
    ? new Date(note.transcriptRange.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    : "";

  const res = await fetch("/api/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      to,
      cc: ccList,
      sessionDate,
      sessionStartTime: startTime,
      sessionEndTime: endTime,
      notes: [{
        noteId: note.id,
        noteTimestamp,
        noteTitle: editTitle || note.title,
        noteContent: editor?.getHTML() || note.content,
        noteType: note.isAIGenerated ? "AI Generated" : "Manual",
      }],
    }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "Failed to send email");
}, [note, editTitle, editor]);
```

5. Add the EmailDrawer component before the closing `</div>` of the return (before line 540):
```tsx
<EmailDrawer
  isOpen={showEmailDrawer}
  onClose={() => setShowEmailDrawer(false)}
  onSend={handleEmailSend}
  defaultEmail={userId || ""}
  itemLabel="Note"
/>
```

---

## Task 7: Remove dead `{{baseUrl}}` replacement

**File:** `src/backend/services/resend.service.ts`

**Line 91** — Remove this line (the template no longer contains `{{baseUrl}}`):
```ts
.replaceAll("{{baseUrl}}", BASE_URL)
```

---

## Task 8: Add Resend API key guard

**Why:** `new Resend(process.env.RESEND_API_KEY)` runs at module load time. If the env var isn't set, `new Resend(undefined)` creates a client that fails at send time with an unhelpful error.

**File:** `src/backend/services/resend.service.ts`

After line 5 (`const resend = new Resend(...)`), add:

```ts
if (!process.env.RESEND_API_KEY) {
  console.warn("[Resend] RESEND_API_KEY not set — email sending will fail");
}
```

---

## Task 9: Extract shared R2 URL rewrite constants

**Create file:** `src/shared/constants.ts`

```ts
/** Private R2 storage URL prefix (used internally by S3 client) */
export const R2_PRIVATE_URL_PREFIX =
  "https://3c764e987404b8a1199ce5fdc3544a94.r2.cloudflarestorage.com/mentra-notes/";

/** Public R2 CDN URL prefix (accessible from browsers and email clients) */
export const R2_PUBLIC_URL_PREFIX =
  "https://pub-b5f134142a0f4fbdb5c05a2f75fc8624.r2.dev/";

/** Rewrite private R2 URLs to public CDN URLs */
export function rewriteR2Urls(content: string): string {
  return content.replaceAll(R2_PRIVATE_URL_PREFIX, R2_PUBLIC_URL_PREFIX);
}
```

Then update the 3 files that duplicate this logic:

**`src/backend/api/router.ts` (line 770-773):**
```ts
import { rewriteR2Urls } from "../../shared/constants";
// ...
const publicContent = rewriteR2Urls(noteData.content);
```

**`src/frontend/pages/note/NotePage.tsx` (lines 133-138):**
```ts
import { rewriteR2Urls } from "../../../shared/constants";
// ...
const rewritePhotoUrls = useCallback((html: string): string => {
  return rewriteR2Urls(html);
}, []);
```

**`src/frontend/pages/day/components/tabs/TranscriptTab.tsx` (lines 40-41):**
```ts
import { R2_PRIVATE_URL_PREFIX, R2_PUBLIC_URL_PREFIX } from "../../../../../shared/constants";
// Remove the local const declarations and use the imports instead
```

---

## Task 10: Remove console.log from export services

**File:** `src/backend/services/noteExport.service.ts`

Remove these lines:
- **Line 388:** `console.log("[DOCX] Found", imageUrls.length, "images in content");`
- **Line 389:** `if (imageUrls.length > 0) console.log("[DOCX] Image URLs:", imageUrls);`
- **Line 397:** `console.log("[DOCX] Fetched image:", url, "size:", img.buffer.length, "type:", img.type);`
- **Line 400:** `console.log("[DOCX] Failed to fetch image:", url);`
- **Line 503:** `console.log("[DOCX] Embedding image:", url, "type:", imgType, "bufferLen:", imgData.buffer.length);`
- **Line 517:** `console.log("[DOCX] Image paragraph added successfully");`

Keep `console.error` lines (those are useful for debugging failures in production).

---

## Task 11: Fix `getOrCreateDailyTranscript` side effect in download

**Why:** A download request should not create a DB record as a side effect.

**File:** `src/backend/api/router.ts`

**Line 904** — `getDailyTranscript` already exists and is already imported at the top of `router.ts` via the models barrel export. It returns `null` if not found (no side effects).

Replace:
```ts
const transcript = await getOrCreateDailyTranscript(userId, date);
const dbSegs = (transcript.segments || []).filter(...)
```
With:
```ts
const transcript = await getDailyTranscript(userId, date);
const dbSegs = (transcript?.segments || []).filter(...)
```

Also add `getDailyTranscript` to the import at the top of the file (line 14) if not already there:
```ts
import {
  getOrCreateDailyTranscript,
  getDailyTranscript,  // <-- add this
  // ...
} from "../models";
```

---

## Task 12: Fix seed-test-data dates

**File:** `src/test/seed-test-data.ts`

**Lines 28-34** — Both `getToday()` and `getYesterday()` return `"2026-02-03"`, so the test doesn't actually test the R2 vs MongoDB distinction.

Change to dynamically compute:

```ts
function getToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

---

## Task 13: Improve PDF/TXT Unicode handling

**Why:** `toAscii()` strips all non-ASCII characters. Any accented characters, emoji, or CJK text will be silently dropped from exports.

**Files:**
- `src/backend/services/noteExport.service.ts`
- `src/backend/services/transcriptExport.service.ts`

### 13a. Load fonts once at module level (not per-call)

`@pdf-lib/fontkit` is already in package.json. Noto Sans fonts already exist at `src/public/fonts/`.

Add at the **top of each export service** (module level, loaded once):

```ts
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import { resolve } from "path";

// Load font buffers once at startup
const NOTO_REGULAR = readFileSync(resolve(import.meta.dir, "../../public/fonts/NotoSans-Regular.ttf"));
const NOTO_BOLD = readFileSync(resolve(import.meta.dir, "../../public/fonts/NotoSans-Bold.ttf"));
```

### 13b. Use Noto Sans in PDF generation

In `generatePdf` (noteExport) and `generateTranscriptPdf` (transcriptExport):

```ts
pdfDoc.registerFontkit(fontkit);
const font = await pdfDoc.embedFont(NOTO_REGULAR);
const fontBold = await pdfDoc.embedFont(NOTO_BOLD);
```

Remove the `toAscii()` calls — Noto Sans supports full Unicode. Use raw text directly.

### 13c. TXT export

Remove `toAscii()` calls in TXT generation — TXT is UTF-8, no encoding limitation.

### 13d. DOCX font

Change `"Helvetica Neue"` to `"Calibri"` (default Word font, available on all platforms) or `"Noto Sans"` in both export services.

---

## Task 14: Fix DOCX image aspect ratio

**File:** `src/backend/services/noteExport.service.ts`

**Line 510** — Currently hardcoded `{ width: 500, height: 350 }` regardless of actual image aspect ratio.

This is the current behavior — acceptable for initial prod launch. A proper fix would parse JPEG/PNG headers to extract dimensions, but that's a larger effort. **Skip for now.**

---

## Task 15: Verify `tw-animate-css` is configured

**File:** Check Tailwind config or `index.css` for `tw-animate-css` import.

The DropdownMenu uses `animate-in fade-in-0 zoom-in-95` classes. Verify these are working by checking that `tw-animate-css` is properly imported. It's in `package.json` as a dependency — confirm it's imported in the CSS or Tailwind config.

If not configured, add to `src/frontend/index.css`:
```css
@import "tw-animate-css";
```

---

## Future (not blocking launch)

### Rate limiting on email endpoints
Even with auth, an authenticated user could spam the email endpoint. Resend has its own rate limits, but a simple in-memory throttle (max 5 emails/minute/user) would be cheap to add later.

---

## Implementation Order

1. **Task 1a** — Add auth to email endpoints (5 min)
2. **Task 3** — Remove error details leak across all endpoints (5 min)
3. **Task 4** — Validate + sanitize email inputs + HTML-escape transcript text (15 min)
4. **Task 8** — Add Resend API key guard (2 min)
5. **Task 2** — Derive BASE_URL from request + update env.example (15 min)
6. **Task 5** — Remove dead framer-motion dep (2 min)
7. **Task 7** — Remove dead `{{baseUrl}}` replacement (1 min)
8. **Task 10** — Remove console.log from exports (5 min)
9. **Task 1b** — Signed download URLs (30 min, biggest task)
10. **Task 6** — Fix NotePage email with EmailDrawer (15 min)
11. **Task 9** — Extract shared R2 constants (10 min)
12. **Task 11** — Fix getOrCreateDailyTranscript side effect (5 min)
13. **Task 12** — Fix seed-test-data dates (2 min)
14. **Task 13** — Improve PDF Unicode handling (20 min)
15. **Task 14** — DOCX image aspect ratio (skip — acceptable for now)
16. **Task 15** — Verify tw-animate-css (2 min)
