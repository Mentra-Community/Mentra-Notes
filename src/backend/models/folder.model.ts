/**
 * Folder Model
 *
 * Stores user-created folders for organizing notes.
 * Each folder has a name and a color (red, gray, or blue).
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// =============================================================================
// Interfaces
// =============================================================================

export type FolderColor = "red" | "gray" | "blue";

export interface FolderI extends Document {
  userId: string;
  name: string;
  color: FolderColor;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const FolderSchema = new Schema<FolderI>(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    color: { type: String, enum: ["red", "gray", "blue"], default: "gray" },
  },
  { timestamps: true },
);

FolderSchema.index({ userId: 1, createdAt: -1 });

// =============================================================================
// Model
// =============================================================================

export const Folder: Model<FolderI> =
  mongoose.models.Folder || mongoose.model<FolderI>("Folder", FolderSchema);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a new folder
 */
export async function createFolder(
  userId: string,
  data: { name: string; color: FolderColor },
): Promise<FolderI> {
  return Folder.create({
    userId,
    name: data.name,
    color: data.color,
  });
}

/**
 * Get all folders for a user
 */
export async function getFolders(userId: string): Promise<FolderI[]> {
  return Folder.find({ userId }).sort({ createdAt: 1 });
}

/**
 * Update a folder
 */
export async function updateFolder(
  userId: string,
  folderId: string,
  data: Partial<{ name: string; color: FolderColor }>,
): Promise<FolderI | null> {
  return Folder.findOneAndUpdate(
    { _id: folderId, userId },
    { $set: data },
    { new: true },
  );
}

/**
 * Delete a folder
 */
export async function deleteFolder(
  userId: string,
  folderId: string,
): Promise<boolean> {
  const result = await Folder.deleteOne({ _id: folderId, userId });
  return result.deletedCount > 0;
}

/**
 * Seed default folders for a new user (Personal + Work)
 */
export async function seedDefaultFolders(userId: string): Promise<FolderI[]> {
  const existing = await Folder.countDocuments({ userId });
  if (existing > 0) return getFolders(userId);

  const defaults = [
    { userId, name: "Personal", color: "blue" as FolderColor },
    { userId, name: "Work", color: "red" as FolderColor },
  ];
  await Folder.insertMany(defaults);
  return getFolders(userId);
}
