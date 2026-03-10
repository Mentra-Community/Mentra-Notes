/**
 * Conversation Model
 *
 * Tracks detected conversations from the auto-notes pipeline.
 * Each conversation has a state machine lifecycle: active → paused → ended.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// =============================================================================
// Interfaces
// =============================================================================

export type ConversationStatus = "active" | "paused" | "ended";

export interface ConversationI extends Document {
  userId: string;
  date: string; // YYYY-MM-DD
  title: string;
  status: ConversationStatus;
  startTime: Date;
  endTime: Date | null;
  chunkIds: string[]; // Ordered list of chunk IDs in this conversation
  runningSummary: string; // Compressed every 3 chunks
  aiSummary: string; // AI-generated summary after conversation ends
  generatingSummary: boolean; // True while AI summary is being generated
  pausedAt: Date | null;
  resumedFrom: string | null; // ID of conversation this was resumed from
  noteId: string | null; // Link to generated note
  noteGenerationFailed: boolean;
  silenceCount: number; // Consecutive silent/filler chunks
  chunksSinceCompression: number; // Chunks since last summary compression
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const ConversationSchema = new Schema<ConversationI>(
  {
    userId: { type: String, required: true },
    date: { type: String, required: true },
    title: { type: String, default: "" },
    status: {
      type: String,
      enum: ["active", "paused", "ended"],
      default: "active",
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date, default: null },
    chunkIds: [{ type: String }],
    runningSummary: { type: String, default: "" },
    aiSummary: { type: String, default: "" },
    generatingSummary: { type: Boolean, default: false },
    pausedAt: { type: Date, default: null },
    resumedFrom: { type: String, default: null },
    noteId: { type: String, default: null },
    noteGenerationFailed: { type: Boolean, default: false },
    silenceCount: { type: Number, default: 0 },
    chunksSinceCompression: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Indexes
ConversationSchema.index({ userId: 1, date: 1, status: 1 });
ConversationSchema.index({ userId: 1, status: 1, updatedAt: -1 });

// =============================================================================
// Model
// =============================================================================

export const Conversation: Model<ConversationI> =
  mongoose.models.Conversation ||
  mongoose.model<ConversationI>("Conversation", ConversationSchema);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new conversation
 */
export async function createConversation(
  data: Pick<ConversationI, "userId" | "date" | "startTime"> &
    Partial<Pick<ConversationI, "resumedFrom">>,
): Promise<ConversationI> {
  return Conversation.create({
    userId: data.userId,
    date: data.date,
    startTime: data.startTime,
    status: "active",
    title: "",
    chunkIds: [],
    runningSummary: "",
    pausedAt: null,
    resumedFrom: data.resumedFrom || null,
    noteId: null,
    noteGenerationFailed: false,
    silenceCount: 0,
    chunksSinceCompression: 0,
  });
}

/**
 * Get active or paused conversations for a user (for resumption check)
 */
export async function getResumableConversations(
  userId: string,
  since: Date,
): Promise<ConversationI[]> {
  return Conversation.find({
    userId,
    status: "paused",
    updatedAt: { $gte: since },
  }).sort({ updatedAt: -1 });
}

/**
 * Get all conversations for a user's day
 */
export async function getConversationsByDate(
  userId: string,
  date: string,
): Promise<ConversationI[]> {
  return Conversation.find({ userId, date }).sort({ startTime: -1 });
}

/**
 * Get a single conversation by ID
 */
export async function getConversationById(
  conversationId: string,
): Promise<ConversationI | null> {
  return Conversation.findById(conversationId);
}

/**
 * Update conversation fields
 */
export async function updateConversation(
  conversationId: string,
  update: Partial<ConversationI>,
): Promise<ConversationI | null> {
  return Conversation.findByIdAndUpdate(
    conversationId,
    { $set: update },
    { new: true },
  );
}

/**
 * Append a chunk ID to a conversation
 */
export async function appendChunkToConversation(
  conversationId: string,
  chunkId: string,
): Promise<void> {
  await Conversation.updateOne(
    { _id: conversationId },
    {
      $push: { chunkIds: chunkId },
      $inc: { chunksSinceCompression: 1 },
      $set: { silenceCount: 0 }, // Reset silence counter on meaningful chunk
    },
  );
}

/**
 * Delete a conversation and its associated chunks
 */
export async function deleteConversation(
  conversationId: string,
): Promise<boolean> {
  const conv = await Conversation.findByIdAndDelete(conversationId);
  if (conv) {
    // Also delete associated transcript chunks
    const { TranscriptChunk } = await import("./transcript-chunk.model");
    await TranscriptChunk.deleteMany({ conversationId });
  }
  return !!conv;
}

/**
 * Get conversations with active/paused status (for crash recovery on startup)
 */
export async function getActiveConversations(
  userId: string,
): Promise<ConversationI[]> {
  return Conversation.find({
    userId,
    status: { $in: ["active", "paused"] },
  });
}
