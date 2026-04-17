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
