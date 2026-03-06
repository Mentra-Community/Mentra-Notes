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

1. **Hydration order matters.** SummaryManager.hydrate() loads saved summaries from MongoDB. It does NOT need segments (those are loaded by TranscriptManager). No ordering dependency — both can hydrate independently.

2. **Rolling timer reads live segments.** `updateRollingSummary()` filters `transcript.segments` by current hour. Since it reads via session reference, it always gets the latest segments. No stale data risk.

3. **`loadDateTranscript` currently sets `hourSummaries` directly.** When viewing a historical date, TranscriptManager loads both segments and summaries, then sets `this.hourSummaries`. After extraction, TranscriptManager should call `summary.loadSummariesForDate(date)` or SummaryManager should expose a method that TranscriptManager delegates to.

4. **`clear()` currently resets summary state.** TranscriptManager.clear() zeroes out `hourSummaries`, `currentHourSummary`, `lastSummaryHour`, `lastSummarySegmentCount`. After extraction, TranscriptManager.clear() should call `summary.clear()`.

5. **Timer lifecycle.** `startRollingSummaryTimer` is called at end of `hydrate()`, `stopRollingSummaryTimer` in `destroy()`. After extraction, SummaryManager owns both — start in its own `hydrate()`, stop in its own `destroy()`.

6. **`getCurrentHourSummary()` is used by glasses display.** Verify where it's called — if only from TranscriptManager, add a pass-through or have the caller reference SummaryManager directly.

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

1. **Hydration order.** R2Manager.hydrate() needs `userId` and a timezone. Timezone comes from SettingsManager. Since the session hydrates managers **sequentially in declaration order** and settings is declared first, this is safe. But verify: does R2Manager need to hydrate AFTER TranscriptManager? Currently no — the batch check is independent of loaded segments.

2. **`checkAndRunBatch` needs TimeManager.** R2Manager already has a `getTimeManager()` helper that reaches through `session.transcript`. After this refactor, R2Manager should create its own TimeManager instance (same pattern TranscriptManager uses) instead of depending on TranscriptManager's.

3. **`setBatchDate` uses `this.getTimeManager().endOfDay()` and `.getTimezone()`.** These must move with it. R2Manager should have its own timezone resolution (read from settings like other managers do).

4. **The `await this.setBatchDate()` in hydrate runs AFTER segments are loaded.** This is fine — setBatchDate doesn't read segments, it only reads UserState and triggers R2 upload of whatever's in MongoDB. The ordering doesn't matter.

5. **`NotesApp.ts` calls `setBatchDate()` on every final transcription event.** This is a hot path. `isBatchDue()` hits MongoDB every time (fetches fresh UserState). Consider adding a simple time-based guard: skip the check if last check was <60 seconds ago. This is a pre-existing concern, not introduced by the refactor, but worth noting.

---

## Implementation Order

### Phase 1: Extract SummaryManager (lower risk, more contained)

1. Create `SummaryManager.ts` with all summary logic
2. Create `SummaryManagerI` in `shared/types.ts`
3. Register `@manager summary` in `NotesSession.ts`
4. Export from `managers/index.ts`
5. Update TranscriptManager:
   - Remove summary synced fields, private state, methods
   - In `hydrate()`: remove summary loading (SummaryManager.hydrate handles it)
   - In `loadDateTranscript()`: delegate summary loading to `summary.loadSummariesForDate(date)`
   - In `clear()`: call `(this._session as any)?.summary?.clear()`
   - In `destroy()`: remove timer stop (SummaryManager.destroy handles it)
6. Update frontend:
   - `DayPage.tsx` — reference `session?.summary?.hourSummaries` and `session?.summary?.generateHourSummary`
   - `shared/types.ts` — move summary fields to `SummaryManagerI`
7. Test: verify hour summaries still appear on day page, rolling timer still fires, historical summaries load

### Phase 2: Move batch logic into R2Manager (more call-site changes)

1. Add batch fields + methods to `CloudflareR2Manager`
2. Add `hydrate()` to R2Manager with UserState init
3. Update TranscriptManager:
   - Remove `setBatchDate`, `checkBatchDate`, `transcriptionBatchEndOfDay`, `userStateInitialized`
   - Remove UserState init from `hydrate()`
   - Remove UserState service imports
4. Update `NotesApp.ts:95` — `transcript.setBatchDate()` → `r2.checkAndRunBatch()`
5. Give R2Manager its own TimeManager resolution (don't depend on transcript's)
6. Test: verify batch still triggers at end of day, unbatched transcripts catch up on hydrate

---

## Files touched

| File | Phase | Change |
|------|-------|--------|
| `managers/SummaryManager.ts` | 1 | **NEW** — all summary logic |
| `managers/TranscriptManager.ts` | 1+2 | Remove ~200 lines of summary + batch code |
| `managers/CloudflareR2Manager.ts` | 2 | Add ~100 lines of batch scheduling |
| `managers/index.ts` | 1 | Export SummaryManager |
| `session/NotesSession.ts` | 1 | Add `@manager summary` |
| `shared/types.ts` | 1 | Add `SummaryManagerI`, slim `TranscriptManagerI` |
| `frontend/pages/day/DayPage.tsx` | 1 | Update summary references |
| `backend/NotesApp.ts` | 2 | `transcript.setBatchDate()` → `r2.checkAndRunBatch()` |

## Result

After refactor:
- **TranscriptManager** (~250 lines): segment CRUD, loading, persisting. Single responsibility.
- **SummaryManager** (~200 lines): hour summaries, rolling timer, LLM calls. Reads segments, doesn't write them.
- **CloudflareR2Manager** (~350 lines): R2 uploads + batch scheduling + segment cleanup. Complete ownership of the archive pipeline.
