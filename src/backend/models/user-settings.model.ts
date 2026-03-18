/**
 * UserSettings Model
 *
 * Stores user preferences and configuration for the Notes app.
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// =============================================================================
// Interfaces
// =============================================================================

export interface UserSettingsI extends Document {
  userId: string;
  showTranscriptOnGlasses: boolean;
  showLiveTranscript: boolean;
  glassesDisplayMode: "off" | "live_transcript" | "hour_summary" | "key_points";
  superCollapsed: boolean;
  displayName?: string;
  timezone?: string;
  // Onboarding
  onboardingCompleted: boolean;
  role?: string;
  company?: string;
  priorities?: string[];
  contacts?: string[];
  topics?: string[];
  transcriptionPaused: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Schema
// =============================================================================

const UserSettingsSchema = new Schema<UserSettingsI>(
  {
    userId: { type: String, required: true, unique: true },
    showTranscriptOnGlasses: { type: Boolean, default: true },
    showLiveTranscript: { type: Boolean, default: true },
    glassesDisplayMode: {
      type: String,
      enum: ["off", "live_transcript", "hour_summary", "key_points"],
      default: "live_transcript",
    },
    superCollapsed: { type: Boolean, default: false },
    displayName: { type: String },
    timezone: { type: String },
    // Onboarding
    onboardingCompleted: { type: Boolean, default: false },
    role: { type: String },
    company: { type: String },
    priorities: { type: [String], default: [] },
    contacts: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    transcriptionPaused: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// =============================================================================
// Model
// =============================================================================

export const UserSettings: Model<UserSettingsI> =
  mongoose.models.UserSettings ||
  mongoose.model<UserSettingsI>("UserSettings", UserSettingsSchema);

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get or create user settings
 */
export async function getOrCreateUserSettings(
  userId: string,
): Promise<UserSettingsI> {
  let settings = await UserSettings.findOne({ userId });

  if (!settings) {
    settings = await UserSettings.create({
      userId,
      showTranscriptOnGlasses: true,
      showLiveTranscript: true,
      glassesDisplayMode: "live_transcript",
    });
  }

  return settings;
}

/**
 * Get user settings (returns null if not found)
 */
export async function getUserSettings(
  userId: string,
): Promise<UserSettingsI | null> {
  return UserSettings.findOne({ userId });
}

/**
 * Update user settings
 */
export async function updateUserSettings(
  userId: string,
  data: Partial<{
    showTranscriptOnGlasses: boolean;
    showLiveTranscript: boolean;
    glassesDisplayMode: "off" | "live_transcript" | "hour_summary" | "key_points";
    superCollapsed: boolean;
    displayName: string;
    timezone: string;
    onboardingCompleted: boolean;
    role: string;
    company: string;
    priorities: string[];
    contacts: string[];
    topics: string[];
    transcriptionPaused: boolean;
  }>,
): Promise<UserSettingsI | null> {
  return UserSettings.findOneAndUpdate(
    { userId },
    { $set: data },
    { new: true, upsert: true },
  );
}
