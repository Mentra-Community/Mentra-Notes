/**
 * TranscriptChunk Model
 *
 * Stores 40-second transcript chunks for the auto-notes pipeline.
 * Each chunk is classified by the triage stage and optionally linked to a conversation.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// =============================================================================
// Interfaces
// =============================================================================

export type ChunkClassification =
  | "pending"
  | "filler"
  | "meaningful"
  | "auto-skipped";

export interface TranscriptChunkI extends Document {
  userId: string;
  chunkIndex: number; // Sequential per day
  text: string;
  wordCount: number;
  startTime: Date;
  endTime: Date;
  date: string; // YYYY-MM-DD, user's timezone
  classification: ChunkClassification;
  conversationId: string | null;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const TranscriptChunkSchema = new Schema<TranscriptChunkI>(
  {
    userId: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    wordCount: { type: Number, required: true },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    date: { type: String, required: true },
    classification: {
      type: String,
      enum: ["pending", "filler", "meaningful", "auto-skipped"],
      default: "pending",
    },
    conversationId: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Compound index for efficient user + date + order queries
TranscriptChunkSchema.index({ userId: 1, date: 1, chunkIndex: 1 });

// For lookback queries (triage needs previous N chunks)
TranscriptChunkSchema.index({ userId: 1, date: 1, createdAt: -1 });

// For conversation assembly (get all chunks for a conversation)
TranscriptChunkSchema.index({ conversationId: 1, chunkIndex: 1 });

// For cleanup job (find chunks older than retention window)
TranscriptChunkSchema.index({ createdAt: 1 });

// =============================================================================
// Model
// =============================================================================

export const TranscriptChunk: Model<TranscriptChunkI> =
  mongoose.models.TranscriptChunk ||
  mongoose.model<TranscriptChunkI>("TranscriptChunk", TranscriptChunkSchema);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new transcript chunk
 */
export async function createTranscriptChunk(
  data: Omit<TranscriptChunkI, keyof Document | "createdAt" | "updatedAt">,
): Promise<TranscriptChunkI> {
  return TranscriptChunk.create(data);
}

/**
 * Get the next chunk index for a user's day
 */
export async function getNextChunkIndex(
  userId: string,
  date: string,
): Promise<number> {
  const lastChunk = await TranscriptChunk.findOne({ userId, date })
    .sort({ chunkIndex: -1 })
    .select({ chunkIndex: 1 });
  return lastChunk ? lastChunk.chunkIndex + 1 : 0;
}

/**
 * Get recent chunks for context lookback
 */
export async function getRecentChunks(
  userId: string,
  date: string,
  count: number,
): Promise<TranscriptChunkI[]> {
  return TranscriptChunk.find({ userId, date })
    .sort({ chunkIndex: -1 })
    .limit(count)
    .then((chunks) => chunks.reverse()); // Return in chronological order
}

/**
 * Update a chunk's classification
 */
export async function updateChunkClassification(
  chunkId: string,
  classification: ChunkClassification,
  conversationId?: string,
): Promise<void> {
  const update: any = { classification };
  if (conversationId !== undefined) {
    update.conversationId = conversationId;
  }
  await TranscriptChunk.updateOne({ _id: chunkId }, { $set: update });
}

/**
 * Get all chunks for a conversation
 */
export async function getChunksByConversationId(
  conversationId: string,
): Promise<TranscriptChunkI[]> {
  return TranscriptChunk.find({ conversationId }).sort({ chunkIndex: 1 });
}

/**
 * Delete chunks older than the retention window
 */
export async function deleteOldChunks(olderThan: Date): Promise<number> {
  const result = await TranscriptChunk.deleteMany({
    createdAt: { $lt: olderThan },
  });
  return result.deletedCount;
}

/**
 * Get all chunks for a user's day
 */
export async function getChunksByDate(
  userId: string,
  date: string,
): Promise<TranscriptChunkI[]> {
  return TranscriptChunk.find({ userId, date }).sort({ chunkIndex: 1 });
}
