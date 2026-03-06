# TranscriptManager Refactor: Extract SummaryManager & BatchManager

## Problem

`TranscriptManager` (~450 lines) is doing three jobs:
1. **Segment storage** — adding, persisting, loading transcript segments
2. **AI hour summaries** — rolling timer, LLM calls, summary state
3. **Batch scheduling** — checking cutoff dates, triggering R2 uploads, MongoDB cleanup

This makes the class hard to reason about and will get worse as auto-conversation-notes adds more logic on top. The summary and batch concerns should be extracted into their own managers.

---

## Extraction 1: `SummaryManager`

### What moves out of TranscriptManager

**Synced state:**
- `hourSummaries: HourSummary[]`
- `currentHourSummary: string`

**Private state:**
- `lastSummaryHour: number`
- `lastSummarySegmentCount: number`
- `rollingSummaryTimer: ReturnType<typeof setInterval>`
- `provider: AgentProvider` (only used by summary generation)

**Methods:**
- `generateHourSummary(hour?)` — @rpc, called from frontend
- `refreshHourSummary()` — @rpc, called from frontend
- `updateRollingSummary()` — private, called by timer
- `startRollingSummaryTimer()` — private
- `stopRollingSummaryTimer()` — private
- `getCurrentHourSummary()` — public
- `getProvider()` — private helper

### How SummaryManager reads segments

SummaryManager is a **read-only consumer** of segments. It needs:
- `this.segments` (filtered by hour/date) for summary generation
- `this.loadedDate` to know the current date context

Pattern: access via `(this._session as any)?.transcript.segments` — same cross-manager pattern every other manager uses.

### New file: `src/backend/session/managers/SummaryManager.ts`

```typescript
export class SummaryManager extends SyncedManager {
  // Synced state (pushed to frontend)
  @synced hourSummaries = synced<HourSummary[]>([]);
  @synced currentHourSummary = "";

  // Private state
  private lastSummaryHour: number = -1;
  private lastSummarySegmentCount: number = 0;
  private rollingSummaryTimer: ReturnType<typeof setInterval> | null = null;
  private provider: AgentProvider | null = null;

  // Lifecycle
  async hydrate(): Promise<void> { /* load saved summaries from DB */ }
  destroy(): void { /* stop timer */ }

  // RPCs (frontend-callable)
  @rpc async generateHourSummary(hour?: number): Promise<HourSummary> { ... }
  @rpc async refreshHourSummary(): Promise<string> { ... }

  // Called by TranscriptManager or internally
  startRollingSummaryTimer(): void { ... }
  stopRollingSummaryTimer(): void { ... }

  // Private
  private getProvider(): AgentProvider { ... }
  private getTimeManager(): TimeManager { ... }
  private getTranscriptSegments(): TranscriptSegment[] { ... }  // reads from transcript manager
  private getLoadedDate(): string { ... }  // reads from transcript manager
  private async updateRollingSummary(): Promise<void> { ... }
}
```

### Registration in NotesSession

```typescript
export class NotesSession extends SyncedSession {
  @manager settings = new SettingsManager();
  @manager transcript = new TranscriptManager();
  @manager summary = new SummaryManager();      // NEW
  @manager notes = new NotesManager();
  @manager chat = new ChatManager();
  @manager r2 = new CloudflareR2Manager();
  @manager file = new FileManager();
  @manager photo = new PhotoManager();
  @manager input = new InputManager();
}
```

### Frontend impact

**Current references (must update):**
- `DayPage.tsx:157` — `session?.transcript?.hourSummaries` → `session?.summary?.hourSummaries`
- `DayPage.tsx:632` — `session?.transcript?.generateHourSummary` → `session?.summary?.generateHourSummary`
- `shared/types.ts` — Move `hourSummaries`, `currentHourSummary`, `generateHourSummary`, `refreshHourSummary` from `TranscriptManagerI` to new `SummaryManagerI`

**loadDateTranscript return type changes:**
Currently returns `{ segments, hourSummaries }`. Two options:

**Option A (recommended): TranscriptManager delegates to SummaryManager**
- `loadDateTranscript` still returns `{ segments, hourSummaries }` for backward compat
- Internally calls `(this._session as any)?.summary.loadSummariesForDate(date)`
- Frontend code that calls `loadDateTranscript` doesn't break

**Option B: Separate the calls**
- `loadDateTranscript` returns only `{ segments }`
- Frontend calls `summary.loadSummariesForDate(date)` separately
- Cleaner separation but more frontend changes

### Edge cases and gotchas

1. **Hydration order matters.** SummaryManager.hydrate() loads saved summaries from MongoDB. It does NOT need segments (those are loaded by TranscriptManager). No ordering dependency — both can hydrate independently. Note: `@manager` decorator uses a `Set` internally, and JS Sets preserve insertion order. TypeScript decorators fire top-to-bottom. So declaration order in NotesSession = hydration order. This is already relied upon (settings must hydrate first for timezone).

2. **Rolling timer reads live segments.** `updateRollingSummary()` filters `transcript.segments` by current hour. Since it reads via session reference, it always gets the latest segments. No stale data risk.

3. **`loadDateTranscript` currently sets `hourSummaries` directly.** When viewing a historical date, TranscriptManager loads both segments and summaries, then sets `this.hourSummaries`. After extraction, TranscriptManager should call `summary.loadSummariesForDate(date)` or SummaryManager should expose a method that TranscriptManager delegates to.

4. **`clear()` currently resets summary state.** TranscriptManager.clear() zeroes out `hourSummaries`, `currentHourSummary`, `lastSummaryHour`, `lastSummarySegmentCount`. After extraction, TranscriptManager.clear() should call `summary.clear()`.

5. **Timer lifecycle.** `startRollingSummaryTimer` is called at end of `hydrate()`, `stopRollingSummaryTimer` in `destroy()`. After extraction, SummaryManager owns both — start in its own `hydrate()`, stop in its own `destroy()`.

6. **`getCurrentHourSummary()` is called by glasses display in `NotesSession.updateGlassesDisplay()` (line 190).** Currently: `this.transcript.getCurrentHourSummary()`. Must change to `this.summary.getCurrentHourSummary()`. This is the only caller.

7. **`NotesSession.dispose()` only calls `this.transcript.destroy()`.** The base `SyncedSession.dispose()` does NOT call `destroy()` on all managers — it only calls `persist()`. After extraction, `NotesSession.dispose()` must also call `this.summary.destroy()` to stop the rolling timer. Alternatively, add `destroy()` to the `SyncedManager` base class and have `SyncedSession.dispose()` call it on all managers. **Recommendation:** just add `this.summary.destroy()` to `NotesSession.dispose()` — simpler, no framework changes.

8. **FileManager queries HourSummary model directly from MongoDB.** `FileManager.getFilesRpc()` runs a `HourSummary.aggregate()` query to get hour counts per date. It does NOT go through TranscriptManager or SummaryManager. This is fine — it's a read-only DB query, no coordination needed. But be aware: SummaryManager and FileManager both talk to the HourSummary collection independently.

9. **Timezone logic duplication.** TranscriptManager has a complex `getTimeManager()` that resolves timezone from two sources (settings + glasses MentraOS) and recreates TimeManager when timezone changes. SummaryManager will need identical logic. **Fix:** extract a shared helper:
   ```typescript
   // In a shared utility or on SyncedManager base
   function resolveTimezone(session: SyncedSession): string | undefined {
     const settings = (session as any)?.settings?.timezone;
     const glasses = (session as any).appSession?.settings?.getMentraOS("userTimezone");
     return settings || glasses || undefined;
   }
   ```
   Both TranscriptManager and SummaryManager use this instead of duplicating.

10. **`loadDateTranscript` return type includes `hourSummaries`.** The frontend calls this as an RPC and the synced state auto-updates. The return value itself is not destructured in `DayPage.tsx` (line 242 just calls it as a promise). The real sync happens via the `@synced` decorator broadcasting state changes. So the return type can stay as-is for Option A — TranscriptManager reads summaries from SummaryManager and includes them in the response, and meanwhile SummaryManager's `@synced hourSummaries` pushes the update to the frontend independently.

---

## Extraction 2: Move batch logic into `CloudflareR2Manager`

### Why R2Manager, not a new BatchManager

The batch logic is R2 upload orchestration. `CloudflareR2Manager` already owns:
- `triggerBatch()` — the actual upload
- `cleanupProcessedSegments()` — MongoDB deletion after upload
- `isBatching` state

What's currently stranded in TranscriptManager is the **scheduling** layer:
- `setBatchDate()` — checks if cutoff passed, calls r2.triggerBatch, updates UserState
- `checkBatchDate()` — reads UserState from MongoDB, compares to now
- `transcriptionBatchEndOfDay` — the cached cutoff timestamp

This is R2 batch scheduling — it belongs with the R2 batch execution.

### What moves into CloudflareR2Manager

**From TranscriptManager:**
- `setBatchDate()` → rename to `checkAndRunBatch()`
- `checkBatchDate()` → rename to `isBatchDue()`
- `transcriptionBatchEndOfDay` private field
- `userStateInitialized` private field
- The UserState initialization logic from `hydrate()` (lines 209-226)

**New R2Manager methods:**
```typescript
export class CloudflareR2Manager extends SyncedManager {
  // ... existing fields ...

  private transcriptionBatchEndOfDay: Date | null = null;
  private userStateInitialized = false;

  async hydrate(): Promise<void> {
    // Load/create UserState, set transcriptionBatchEndOfDay
    // Then run checkAndRunBatch() to catch up on missed batches
  }

  /**
   * Check if batch cutoff passed; if so, upload to R2 and update UserState.
   * Called on every final transcript segment and during hydrate.
   */
  async checkAndRunBatch(): Promise<void> { ... }

  /**
   * Check if current UTC time has passed the batch end-of-day.
   * Fetches fresh from MongoDB every time.
   */
  async isBatchDue(): Promise<boolean> { ... }
}
```

### Call sites that change

1. **`TranscriptManager.hydrate()`** — Remove UserState init + `setBatchDate()` call. R2Manager.hydrate() handles this now.

2. **`NotesApp.ts:95`** — `notesSession.transcript.setBatchDate()` → `notesSession.r2.checkAndRunBatch()`

3. **TranscriptManager no longer imports** `getUserState`, `createUserState`, `updateTranscriptionBatchEndOfDay`.

### Edge cases and gotchas

1. **Hydration order.** R2Manager currently hydrates 5th (after transcript). With batch logic moving in, R2Manager.hydrate() needs `userId` and a timezone. Timezone comes from SettingsManager (1st). Batch scheduling reads UserState from MongoDB — no dependency on transcript segments. **But:** the current `TranscriptManager.hydrate()` calls `setBatchDate()` at line 226, AFTER loading segments and summaries. Moving this to R2Manager.hydrate() means it runs in position 5 instead of position 2. This is actually fine — `setBatchDate` only reads UserState and triggers R2 upload of whatever's already in MongoDB. It doesn't need today's segments to be in memory.

2. **`checkAndRunBatch` needs TimeManager.** R2Manager already has a `getTimeManager()` helper but it currently reaches through `session.transcript.getTimeManager()`. After this refactor, R2Manager must create its own TimeManager instance using the shared timezone resolver (see SummaryManager gotcha #9). Don't depend on transcript's TimeManager — that's fragile coupling.

3. **`setBatchDate` uses `this.getTimeManager().endOfDay()` and `.getTimezone()`.** These must move with it. R2Manager should have its own timezone resolution (read from settings like other managers do).

4. **`NotesApp.ts` calls `setBatchDate()` on every final transcription event.** This is a hot path. `isBatchDue()` hits MongoDB every time (fetches fresh UserState). Consider adding a simple time-based guard: skip the check if last check was <60 seconds ago. This is a pre-existing concern, not introduced by the refactor, but worth noting.

5. **R2Manager.hydrate() currently has no implementation.** Adding a `hydrate()` that calls `createUserState()` and `checkAndRunBatch()` is new behavior. Make sure it handles the case where MongoDB is unreachable gracefully (wrap in try/catch, log, continue — same pattern TranscriptManager uses).

6. **`setBatchDate` triggers `r2Manager.triggerBatch()` internally.** After moving into R2Manager, this becomes a `this.triggerBatch()` call — simpler and removes the cross-manager hop. But the `cleanupProcessedSegments` call that follows is already on R2Manager too, so this actually becomes cleaner.

---

---

## Questions to resolve before implementing

### Q1: Should `loadDateTranscript` keep returning `{ segments, hourSummaries }`?

**Decision: Option A** — Keep the return type, have TranscriptManager read from SummaryManager internally. Zero frontend changes.

### Q2: Where should the shared timezone resolver live?

**Decision: Option C** — Duplicate the `getTimeManager()` helper in each manager that needs it (TranscriptManager, SummaryManager, R2Manager). Simple and self-contained.

**Important: Fix timezone priority order during duplication.** The current code is wrong — it checks `settingsTimezone` (MongoDB) first, then `appTimezone` (MentraOS SDK). The correct priority is:
1. **MentraOS SDK timezone** (glasses) — most authoritative, real-time from hardware
2. **User settings timezone** (MongoDB) — fallback when glasses aren't connected

Each manager's `getTimeManager()` should use:
```typescript
const currentTimezone = appTimezone || settingsTimezone || undefined;
//                      ^^^ SDK first    ^^^ settings fallback
```

### Q3: Should we add `destroy()` to the SyncedManager base class?

**Decision: Option B** — Add `destroy()` to SyncedManager base and call it for all managers in `SyncedSession.dispose()`. This prevents memory leaks by design — no manager with timers/intervals can be forgotten. If a manager doesn't need cleanup, the base no-op `destroy()` is harmless.

Changes needed in `sync.ts`:
```typescript
// In SyncedManager base class
export abstract class SyncedManager {
  async hydrate(): Promise<void> {}
  async persist(): Promise<void> {}
  destroy(): void {}  // NEW — override in managers that use timers/intervals
}

// In SyncedSession.dispose()
async dispose(): Promise<void> {
  // IMPORTANT: persist BEFORE destroy — destroy kills timers, and some managers
  // (e.g. TranscriptManager) have pending data that persist() needs to flush.
  await this.persist();
  // Now safe to destroy (stop timers, clean up resources)
  for (const mgr of this._managers.values()) {
    mgr.destroy();
  }
  this._clients.clear();
}
```

**Why persist before destroy:** TranscriptManager has a `saveTimer` that buffers `pendingSegments` for 30s. `destroy()` kills that timer. If we destroy first, `persist()` still works (it reads `pendingSegments` directly), but the ordering is fragile — a future manager might clear state in `destroy()`. Persisting first is the safe default.

Then remove the explicit `this.transcript.destroy()` call from `NotesSession.dispose()` — the base class handles it now.

---

## Implementation Order

### Phase 0: Prep work (do first, minimal behavior changes)

1. Add `destroy(): void {}` to `SyncedManager` base class in `sync.ts`
2. Update `SyncedSession.dispose()` to persist first, THEN call `destroy()` on all managers (persist before destroy — see Q3 rationale)
3. Remove the explicit `this.transcript.destroy()` from `NotesSession.dispose()` (base handles it now)
4. Fix timezone priority in TranscriptManager's `getTimeManager()`: change `settingsTimezone || appTimezone` → `appTimezone || settingsTimezone` (SDK first, settings fallback)
5. Remove unused `import { get } from "http"` in TranscriptManager (line 31 — dead import)

### Phase 1: Extract SummaryManager (lower risk, more contained)

1. Create `SummaryManager.ts` with all summary logic
2. Create `SummaryManagerI` in `shared/types.ts`
3. Register `@manager summary` in `NotesSession.ts` — declare AFTER transcript (so it hydrates after segments are loaded, even though it doesn't strictly need them for hydrate — just safer)
4. Export from `managers/index.ts`
5. Update TranscriptManager:
   - Remove summary synced fields (`hourSummaries`, `currentHourSummary`), private state (`lastSummaryHour`, `lastSummarySegmentCount`, `rollingSummaryTimer`, `provider`), and all summary methods
   - In `hydrate()`: remove hour summary loading block (SummaryManager.hydrate handles it)
   - In `loadDateTranscript()`: delegate summary loading to `(this._session as any)?.summary?.loadSummariesForDate(date)` — still return `{ segments, hourSummaries }` by reading from SummaryManager
   - In `clear()`: call `(this._session as any)?.summary?.clear()` to reset summary state
   - In `destroy()`: remove `stopRollingSummaryTimer()` (SummaryManager.destroy handles it)
   - Remove `getProvider()` helper (moves to SummaryManager)
6. Update `NotesSession.ts`:
   - `updateGlassesDisplay()` line 190: `this.transcript.getCurrentHourSummary()` → `this.summary.getCurrentHourSummary()`
   - `dispose()`: no changes needed — Phase 0 already made `SyncedSession.dispose()` call `destroy()` on all managers automatically
7. Update frontend:
   - `DayPage.tsx:157` — `session?.transcript?.hourSummaries` → `session?.summary?.hourSummaries`
   - `DayPage.tsx:632` — `session?.transcript?.generateHourSummary` → `session?.summary?.generateHourSummary`
   - `shared/types.ts` — move `hourSummaries`, `currentHourSummary`, `generateHourSummary`, `refreshHourSummary` from `TranscriptManagerI` to new `SummaryManagerI`. Also add `summary: SummaryManagerI` to the `SessionI` interface (required for frontend type safety — `useSynced<SessionI>` needs it)
8. Test: verify hour summaries still appear on day page, rolling timer still fires, historical summaries load, glasses "hour_summary" mode still works

### Phase 2: Move batch logic into R2Manager (more call-site changes)

1. Add batch fields + methods to `CloudflareR2Manager`:
   - `private transcriptionBatchEndOfDay: Date | null`
   - `private userStateInitialized: boolean`
   - `async checkAndRunBatch(): Promise<void>` (was `setBatchDate`)
   - `async isBatchDue(): Promise<boolean>` (was `checkBatchDate`)
2. Add `hydrate()` to R2Manager with UserState init — wrap in try/catch for MongoDB failure resilience
3. Give R2Manager its own TimeManager using the shared timezone resolver (Phase 0). Remove its current `getTimeManager()` that reaches through `session.transcript`
4. Update TranscriptManager:
   - Remove `setBatchDate`, `checkBatchDate`, `transcriptionBatchEndOfDay`, `userStateInitialized`
   - Remove UserState init block from `hydrate()` (lines 209-226)
   - Remove `getUserState`, `createUserState`, `updateTranscriptionBatchEndOfDay` imports
5. Update `NotesApp.ts:95` — `notesSession.transcript.setBatchDate()` → `notesSession.r2.checkAndRunBatch()`
6. Test: verify batch still triggers at end of day, unbatched transcripts catch up on hydrate, `forceBatch` RPC still works

---

## Files touched

| File | Phase | Change |
|------|-------|--------|
| `lib/sync.ts` | 0 | Add `destroy()` to SyncedManager base, call in `SyncedSession.dispose()` |
| `managers/TranscriptManager.ts` | 0+1+2 | Fix timezone priority, remove dead import, remove ~200 lines of summary + batch code |
| `managers/SummaryManager.ts` | 1 | **NEW** — all summary logic (~200 lines), own `getTimeManager()` with correct SDK-first priority |
| `managers/CloudflareR2Manager.ts` | 2 | Add ~100 lines of batch scheduling, own `getTimeManager()` with correct SDK-first priority |
| `managers/index.ts` | 1 | Export SummaryManager |
| `session/NotesSession.ts` | 0+1 | Remove explicit `transcript.destroy()` from `dispose()`, add `@manager summary`, update `updateGlassesDisplay()` |
| `shared/types.ts` | 1 | Add `SummaryManagerI`, slim `TranscriptManagerI` |
| `frontend/pages/day/DayPage.tsx` | 1 | Update `session?.transcript?.hourSummaries` → `session?.summary?.hourSummaries` (2 lines) |
| `backend/NotesApp.ts` | 2 | `transcript.setBatchDate()` → `r2.checkAndRunBatch()` |

## Result

After refactor:
- **TranscriptManager** (~250 lines): segment CRUD, loading, persisting. Single responsibility.
- **SummaryManager** (~200 lines): hour summaries, rolling timer, LLM calls. Reads segments, doesn't write them.
- **CloudflareR2Manager** (~350 lines): R2 uploads + batch scheduling + segment cleanup. Complete ownership of the archive pipeline.
