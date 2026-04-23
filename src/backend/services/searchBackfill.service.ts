/**
 * searchBackfill.service — One-time backfill of the TranscriptSegmentSearch
 * collection from R2 for existing users.
 *
 * The live-ingest hook in TranscriptManager only covers new segments going
 * forward. Anything already in R2 from before issue #26 shipped needs to be
 * walked once and inserted. We stamp `userSettings.searchBackfilledAt` on
 * completion so we only run once per user.
 */

import {
  listR2TranscriptDates,
  fetchTranscriptFromR2,
} from "./r2Fetch.service";
import {
  bulkUpsertSearchSegments,
  type UpsertSegmentInput,
} from "../models/transcript-segment-search.model";
import {
  getOrCreateUserSettings,
  updateUserSettings,
} from "../models/user-settings.model";
import {
  DailyTranscript,
  type TranscriptSegmentI,
} from "../models/daily-transcript.model";
import type { R2TranscriptSegment } from "./r2Upload.service";

export interface BackfillResult {
  userId: string;
  datesProcessed: number;
  segmentsIndexed: number;
  skipped: boolean; // true if already backfilled
  error?: string;
}

// In-memory gate so a double-click on the search page doesn't kick off two
// parallel backfills for the same user.
const inFlight = new Map<string, Promise<BackfillResult>>();

/**
 * Run the backfill once per user. Idempotent: the bulk upsert is keyed on
 * (userId, date, segIndex) so re-running is a no-op beyond writes.
 */
export async function backfillUserSearchIndex(userId: string): Promise<BackfillResult> {
  const existing = inFlight.get(userId);
  if (existing) return existing;

  const run = (async (): Promise<BackfillResult> => {
    const settings = await getOrCreateUserSettings(userId);
    if (settings.searchBackfilledAt) {
      return { userId, datesProcessed: 0, segmentsIndexed: 0, skipped: true };
    }

    console.log(`[SearchBackfill] Starting for ${userId}`);
    let datesProcessed = 0;
    let segmentsIndexed = 0;

    try {
      // Phase 1: MongoDB DailyTranscripts — covers today's live segments AND
      // any unbatched historical days still in Mongo. Users who used the app
      // before issue #26 shipped have 0 search-index rows for these days.
      const mongoSettings = { userId: userId };
      const mongoDocs = await DailyTranscript.find(mongoSettings, {
        date: 1,
        segments: 1,
      }).lean();
      console.log(
        `[SearchBackfill] MongoDB: found ${mongoDocs.length} DailyTranscript docs`,
      );

      // Resolve timezone once for hour calculation
      const userSettings = await getOrCreateUserSettings(userId);
      const timezone = userSettings.timezone ?? undefined;

      for (const doc of mongoDocs) {
        const date = doc.date;
        const segments = (doc.segments ?? []) as TranscriptSegmentI[];
        const inputs = buildSearchInputsFromMongo(userId, date, segments, timezone);
        if (inputs.length > 0) {
          const written = await bulkUpsertSearchSegments(inputs);
          segmentsIndexed += written;
        }
        datesProcessed++;
      }

      // Phase 2: R2 — older, batched-out days.
      const dateList = await listR2TranscriptDates(userId);
      if (!dateList.success) {
        throw new Error(`Failed to list R2 dates: ${dateList.error?.message}`);
      }

      for (const date of dateList.dates) {
        const fetched = await fetchTranscriptFromR2({ userId, date });
        if (!fetched.success || !fetched.data) {
          console.warn(`[SearchBackfill] Skipping ${date}: ${fetched.error?.message}`);
          continue;
        }

        const inputs = buildSearchInputs(userId, date, fetched.data.segments, fetched.data.timezone);
        if (inputs.length > 0) {
          const written = await bulkUpsertSearchSegments(inputs);
          segmentsIndexed += written;
        }
        datesProcessed++;

        // Light throttle so a 90-day backfill doesn't nail the DB for a
        // freshly-awake user.
        await new Promise((r) => setTimeout(r, 25));
      }

      await updateUserSettings(userId, { searchBackfilledAt: new Date() });
      console.log(
        `[SearchBackfill] Done for ${userId}: ${datesProcessed} dates, ${segmentsIndexed} segments`,
      );
      return { userId, datesProcessed, segmentsIndexed, skipped: false };
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`[SearchBackfill] Failed for ${userId}:`, msg);
      return { userId, datesProcessed, segmentsIndexed, skipped: false, error: msg };
    } finally {
      inFlight.delete(userId);
    }
  })();

  inFlight.set(userId, run);
  return run;
}

/**
 * Whether the UI should show the "still indexing older days…" banner.
 */
export async function getBackfillStatus(userId: string): Promise<{
  backfilled: boolean;
  inProgress: boolean;
  backfilledAt: Date | null;
}> {
  const settings = await getOrCreateUserSettings(userId);
  return {
    backfilled: !!settings.searchBackfilledAt,
    inProgress: inFlight.has(userId),
    backfilledAt: settings.searchBackfilledAt ?? null,
  };
}

function buildSearchInputsFromMongo(
  userId: string,
  date: string,
  segments: TranscriptSegmentI[],
  timezone: string | undefined,
): UpsertSegmentInput[] {
  const out: UpsertSegmentInput[] = [];
  for (const s of segments) {
    if (s.type === "photo") continue;
    if (!s.isFinal) continue;
    if (!s.text || !s.text.trim()) continue;
    const ts = s.timestamp instanceof Date ? s.timestamp : new Date(s.timestamp);
    if (Number.isNaN(ts.getTime())) continue;
    out.push({
      userId,
      date,
      hour: hourInTimezone(ts, timezone),
      segIndex: s.index,
      text: s.text,
      timestamp: ts,
      speakerId: s.speakerId,
    });
  }
  return out;
}

function buildSearchInputs(
  userId: string,
  date: string,
  segments: R2TranscriptSegment[],
  timezone: string,
): UpsertSegmentInput[] {
  const out: UpsertSegmentInput[] = [];
  for (const s of segments) {
    if (s.type === "photo") continue;
    if (!s.isFinal) continue;
    if (!s.text || !s.text.trim()) continue;

    const ts = new Date(s.timestamp);
    if (Number.isNaN(ts.getTime())) continue;

    out.push({
      userId,
      date,
      hour: hourInTimezone(ts, timezone),
      segIndex: s.index,
      text: s.text,
      timestamp: ts,
      speakerId: s.speakerId,
    });
  }
  return out;
}

function hourInTimezone(ts: Date, timezone: string | undefined): number {
  if (timezone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(ts);
    return parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  }
  return ts.getHours();
}
