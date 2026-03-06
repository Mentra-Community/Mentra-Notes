# Automatic Conversation Notes — Implementation Plan

Owner: Aryan
Priority: High — Core product differentiator

---

## Overview

The system listens to a continuous transcript stream, classifies chunks as meaningful or filler, tracks conversations in real-time, and generates structured notes when conversations end. Built on a 40-second heartbeat cycle with 5 pipeline stages.

---

## What Already Exists

- `TranscriptManager` — accumulates transcript segments (interim + final), stores daily transcripts, generates hour summaries
- `DailyTranscript` model — stores segments grouped by user's timezone day
- `HourSummary` model — AI-generated hourly summaries
- `Note` model — both manual and AI-generated notes
- `NotesManager` — AI note generation + manual notes
- LLM abstraction layer (`services/llm/`) — Gemini + Anthropic support
- WebSocket sync (`@ballah/synced`) — real-time state broadcast to frontend

---

## Step-by-Step Build Order

### Phase 1: Buffer System & Chunk Storage

**Goal:** Get 40-second chunks flowing and persisting.

#### Step 1.1 — Create Chunk Database Model
- New file: `src/backend/models/transcript-chunk.model.ts`
- Schema fields:
  - `userId: string`
  - `chunkIndex: number` (sequential per day)
  - `text: string` (raw transcript text for this 40s window)
  - `wordCount: number`
  - `startTime: Date`
  - `endTime: Date`
  - `date: string` (YYYY-MM-DD, user's timezone)
  - `classification: 'pending' | 'filler' | 'meaningful' | 'auto-skipped'`
  - `conversationId: string | null` (links to which conversation this chunk belongs to, if any)
  - `metadata: object` (flexible field for debug info)
- Index on `{ userId, date, chunkIndex }`

#### Step 1.2 — Create ChunkBuffer Class
- New file: `src/backend/session/managers/ChunkBufferManager.ts`
- Responsibilities:
  - Accumulate incoming transcript segments from `TranscriptManager` into a rolling buffer
  - Every 40 seconds, package buffer contents into a chunk
  - Handle sentence boundaries — if a sentence is mid-flow at the 40s mark, include the full sentence in the current chunk
  - Persist every chunk to DB (including filler — needed for Stage 5 safety pass)
  - Emit event / call callback when a new chunk is ready
- Uses a `setInterval` (40s) as the heartbeat
- Reads from `TranscriptManager`'s existing segment accumulation

#### Step 1.3 — Wire ChunkBuffer into NotesSession
- Modify `src/backend/session/NotesSession.ts`:
  - Instantiate `ChunkBufferManager`
  - Feed transcript data from `TranscriptManager` into the buffer
  - Start/stop the 40s heartbeat with session lifecycle

#### Step 1.4 — Test the Buffer
- Verify chunks are being created every ~40 seconds
- Verify sentence boundary handling works
- Verify chunks persist to MongoDB
- Verify chunk index increments correctly per day

---

### Phase 2: Triage Classifier (Stage 2)

**Goal:** Classify each chunk as auto-skip, filler, or meaningful.

#### Step 2.1 — Create Triage Classifier
- New file: `src/backend/services/auto-notes/TriageClassifier.ts`
- Logic:
  1. **Auto-skip check** (no LLM call needed):
     - Under 4 words AND no high-signal keywords → mark `auto-skipped`
     - Even short chunks with important keywords go to LLM (e.g., "Cancel the deal.")
  2. **LLM classification**:
     - Send chunk text + domain context to LLM
     - Prompt returns: `FILLER` or `MEANINGFUL`
     - If `MEANINGFUL`: pull previous 2 chunks from DB for context, pass to Stage 3

#### Step 2.2 — Create Domain Context Configuration
- New file: `src/backend/services/auto-notes/domain-config.ts`
- Define room context profiles:
  - `medical`: patient names, medications, vitals, procedures
  - `engineering`: deploy, sprint, bug, migration, deadline
  - `home`: user-configured keywords
  - `general`: sensible defaults
- Store active profile in user settings (extend `UserSettings` model)
- Inject domain context into every classifier prompt

#### Step 2.3 — Create Configurable Parameters Store
- New file: `src/backend/services/auto-notes/config.ts`
- All tunable parameters in one place:
  ```
  BUFFER_INTERVAL_MS = 40_000
  PRE_FILTER_WORD_MIN = 4
  SILENCE_PAUSE_CHUNKS = 1
  SILENCE_END_CHUNKS = 3
  CONTEXT_LOOKBACK_CHUNKS = 2
  SUMMARY_MAX_WORDS = 300
  RESUMPTION_WINDOW_MS = 30 * 60 * 1000
  CHUNK_RETENTION_HOURS = 24
  ```

#### Step 2.4 — Wire Triage into the Pipeline
- When `ChunkBufferManager` emits a new chunk:
  - Run it through `TriageClassifier`
  - Update chunk's `classification` field in DB
  - If `MEANINGFUL` → forward to Stage 3 (conversation tracker)

---

### Phase 3: Conversation Tracker (Stage 3)

**Goal:** Track active conversations, handle continuations, new topics, and session end.

#### Step 3.1 — Create Conversation Model
- New file: `src/backend/models/conversation.model.ts`
- Schema fields:
  - `userId: string`
  - `date: string` (YYYY-MM-DD)
  - `title: string` (generated after conversation ends)
  - `status: 'active' | 'paused' | 'ended'`
  - `startTime: Date`
  - `endTime: Date | null`
  - `chunkIds: string[]` (ordered list of chunk IDs in this conversation)
  - `runningSummary: string` (compressed every 3 chunks)
  - `pausedAt: Date | null`
  - `resumedFrom: string | null` (ID of conversation this was resumed from)
  - `noteId: string | null` (link to generated note)

#### Step 3.2 — Create ConversationTracker
- New file: `src/backend/services/auto-notes/ConversationTracker.ts`
- State machine with states: `IDLE`, `TRACKING`, `PAUSED`
- On each incoming meaningful chunk:
  - If `IDLE` → start new conversation, transition to `TRACKING`
  - If `TRACKING` → classify chunk as:
    - `CONTINUATION` — same topic, append to conversation
    - `NEW_CONVERSATION` — close current, start new
    - `FILLER` — transition to `PAUSED` (1 silent chunk = pause)
  - If `PAUSED`:
    - Next chunk is on-topic → resume conversation (back to `TRACKING`)
    - Next chunk is filler → increment silence counter
    - 3 consecutive silent/filler chunks (2 min) → end conversation permanently
- LLM prompt for classification includes: current running summary + new chunk + domain context

#### Step 3.3 — Running Summary Compression
- Every 3 chunks added to a conversation:
  - Send full running summary + last 3 chunks to LLM
  - Compress to under 300 words
  - Preserve: names, numbers, decisions, action items
  - Update `runningSummary` field on Conversation document

#### Step 3.4 — Resumption Detection
- When a new meaningful chunk arrives and there's no active conversation:
  - Check DB for conversations with `status: 'paused'` or `status: 'ended'` in the last 30 minutes
  - Send chunk + previous conversation's summary to LLM: "Is this a continuation of the previous conversation?"
  - If yes → reopen that conversation instead of creating a new one
  - Update `resumedFrom` field

#### Step 3.5 — Wire Tracker into Pipeline
- Modify the triage output handler:
  - `MEANINGFUL` chunks → `ConversationTracker.processChunk()`
  - Tracker manages its own state machine
  - When conversation ends → trigger Stage 4

---

### Phase 4: Note Generation (Stage 4)

**Goal:** Generate structured notes from completed conversations.

#### Step 4.1 — Create Note Generator
- New file: `src/backend/services/auto-notes/NoteGenerator.ts`
- When a conversation ends:
  1. Fetch all chunks belonging to this conversation from DB
  2. Assemble full transcript text (ordered by chunkIndex)
  3. Send to stronger LLM (e.g., Gemini Pro or Claude Sonnet) with prompt to generate:
     - **Title** (e.g., "Client Deadline Acceleration")
     - **Participants** (Speaker 1, Speaker 2, etc.)
     - **Summary** (2-3 paragraph overview)
     - **Key Points** (bulleted list of facts discussed)
     - **Decisions Made** (bulleted list)
     - **Action Items** (with owners if identifiable)
  4. Create a `Note` document using existing `Note` model
  5. Link note back to Conversation document (`noteId` field)
  6. Mark note as `type: 'auto'` to distinguish from manual notes

#### Step 4.2 — Integrate with Existing NotesManager
- Use existing `NotesManager` to create and sync the note
- The note should appear in the frontend alongside manual notes
- Tag auto-generated notes visually (e.g., "Auto" badge)

#### Step 4.3 — Wire Note Generation into Pipeline
- When `ConversationTracker` ends a conversation → call `NoteGenerator.generate(conversationId)`
- Handle errors gracefully (LLM timeout, etc.) — retry once, then log and move on

---

### Phase 5: Safety Pass (Stage 5) — DO LATER, ONLY IF NEEDED

**Goal:** End-of-day review to catch missed conversations and discard false positives.

#### Step 5.1 — Create Safety Pass Service
- New file: `src/backend/services/auto-notes/SafetyPass.ts`
- Runs once at end of day (triggered by `TimeManager` EOD detection)
- **Job A — Review Captured Conversations:**
  - For each conversation captured today: send summary + sample chunks to LLM
  - LLM returns: `KEEP` or `DISCARD`
  - Discarded conversations: mark note as `discarded: true` (soft delete)
- **Job B — Scan Filler for Missed Conversations:**
  - Fetch all chunks for the day classified as `filler` or `auto-skipped`
  - Send sequential batches to LLM: "Do any of these consecutive filler chunks actually form a meaningful conversation?"
  - If yes → run those chunks through Stage 4 (note generation)
  - Also check for fragmentation: two separate conversations that are actually the same topic → flag for merge

---

### Phase 6: Feedback Loop — DO LATER

**Goal:** Collect user feedback to improve classification over time.

#### Step 6.1 — Add Feedback UI
- Add thumbs-up / thumbs-down buttons to auto-generated note cards in frontend
- New field on `Note` model: `feedback: 'positive' | 'negative' | null`
- New field on `Note` model: `feedbackComment: string | null` (optional text)

#### Step 6.2 — Create Feedback Model / Extend Note Model
- Store feedback in the Note document itself (simplest approach)
- API endpoint: `PATCH /api/notes/:id/feedback` with `{ rating: 'positive' | 'negative', comment?: string }`

#### Step 6.3 — Log Feedback
- Just persist to DB for now — data collection only
- No action taken on feedback yet (Phase 2 of feedback loop)

---

## File Map (New Files)

```
src/backend/
├── models/
│   ├── transcript-chunk.model.ts       (Phase 1)
│   └── conversation.model.ts           (Phase 3)
├── services/
│   └── auto-notes/
│       ├── config.ts                   (Phase 2)
│       ├── domain-config.ts            (Phase 2)
│       ├── TriageClassifier.ts         (Phase 2)
│       ├── ConversationTracker.ts      (Phase 3)
│       ├── NoteGenerator.ts            (Phase 4)
│       └── SafetyPass.ts              (Phase 5)
└── session/
    └── managers/
        └── ChunkBufferManager.ts       (Phase 1)
```

## Files to Modify

```
src/backend/session/NotesSession.ts     — instantiate ChunkBufferManager, wire pipeline
src/backend/models/note.model.ts        — add feedback fields, auto-note type
src/backend/models/user-settings.model.ts — add domain context profile
src/shared/types.ts                     — add new types for chunks, conversations, feedback
src/frontend/ (NoteCard, DayPage)       — auto badge + feedback buttons (Phase 6)
```

---

## Immediate First Steps (Start Here)

1. Create `src/backend/services/auto-notes/config.ts` with all configurable parameters
2. Create `src/backend/models/transcript-chunk.model.ts`
3. Create `src/backend/session/managers/ChunkBufferManager.ts`
4. Wire `ChunkBufferManager` into `NotesSession.ts`
5. Test that chunks are flowing and persisting every 40 seconds

Once the buffer is solid, move to the triage classifier (Phase 2).
