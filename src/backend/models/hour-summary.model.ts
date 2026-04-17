/**
 * HourSummary Model
 *
 * Stores AI-generated summaries for each hour of a user's day.
 * Used for quick overviews and glasses display.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// =============================================================================
// Interfaces
// =============================================================================

export interface HourSummaryI extends Document {
  userId: string;
  date: string; // YYYY-MM-DD
  hour: number; // 0-23
  hourLabel: string; // "9 AM", "2 PM", etc.
  summary: string; // AI-generated summary
  segmentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const HourSummarySchema = new Schema<HourSummaryI>(
  {
    userId: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true },
    hour: { type: Number, required: true },
    hourLabel: { type: String, required: true },
    summary: { type: String, required: true },
    segmentCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Compound index for efficient user + date + hour queries
HourSummarySchema.index({ userId: 1, date: 1, hour: 1 }, { unique: true });

// Text index on summary (which contains both title line + body) powers search.
// Falls back to $regex at query time if the index isn't built yet.
HourSummarySchema.index({ summary: "text" });

// =============================================================================
// Model
// =============================================================================

export const HourSummary: Model<HourSummaryI> =
  mongoose.models.HourSummary ||
  mongoose.model<HourSummaryI>("HourSummary", HourSummarySchema);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Save or update an hour summary
 */
export async function saveHourSummary(
  userId: string,
  date: string,
  hour: number,
  hourLabel: string,
  summary: string,
  segmentCount: number,
): Promise<HourSummaryI> {
  const result = await HourSummary.findOneAndUpdate(
    { userId, date, hour },
    {
      $set: {
        hourLabel,
        summary,
        segmentCount,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        userId,
        date,
        hour,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );

  return result;
}

/**
 * Get all hour summaries for a user and date
 */
export async function getHourSummaries(
  userId: string,
  date: string,
): Promise<HourSummaryI[]> {
  return HourSummary.find({ userId, date }).sort({ hour: 1 });
}

/**
 * Get a specific hour summary
 */
export async function getHourSummary(
  userId: string,
  date: string,
  hour: number,
): Promise<HourSummaryI | null> {
  return HourSummary.findOne({ userId, date, hour });
}

/**
 * Delete all hour summaries for a user + date.
 * Called when a day's transcript is trashed so titles don't reappear on reload.
 */
export async function deleteHourSummariesForDate(
  userId: string,
  date: string,
): Promise<number> {
  const result = await HourSummary.deleteMany({ userId, date });
  return result.deletedCount ?? 0;
}

/**
 * Text-search a user's hour summaries. Uses Mongo `$text` when the index is
 * available; falls back to a case-insensitive regex across `summary` so the
 * search still works on environments where the text index hasn't been built.
 */
export async function searchHourSummaries(
  userId: string,
  query: string,
  limit: number = 10,
): Promise<Array<HourSummaryI & { score?: number }>> {
  const q = query.trim();
  if (!q) return [];

  // $text defaults to OR across words, which makes gibberish queries like
  // "smart camera asdfd" match any doc containing "smart" or "camera". Wrap
  // each word in quotes so Mongo requires all of them (logical AND).
  const words = q.split(/\s+/).filter(Boolean);
  const strictQuery = words.map((w) => `"${w.replace(/"/g, '\\"')}"`).join(" ");

  try {
    const results = await HourSummary.find(
      { userId, $text: { $search: strictQuery } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(limit)
      .lean();
    return results as unknown as Array<HourSummaryI & { score?: number }>;
  } catch (err) {
    console.warn("[HourSummary] $text search failed, falling back to regex:", err);
  }

  // Fallback: regex that requires all words to appear somewhere in `summary`
  // (order-independent), using a lookahead chain. Keeps the AND-semantics of
  // the $text path when the text index isn't available.
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(escaped.map((w) => `(?=.*${w})`).join(""), "is");
  const results = await HourSummary.find({
    userId,
    summary: { $regex: regex },
  })
    .sort({ date: -1, hour: -1 })
    .limit(limit)
    .lean();

  return results as unknown as Array<HourSummaryI & { score?: number }>;
}
