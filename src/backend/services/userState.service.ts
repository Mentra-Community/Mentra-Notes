/**
 * UserState Service
 *
 * Handles user state operations, particularly transcription batch end-of-day tracking.
 */

import { UserState, type UserStateI } from "../models/userState.model";

/**
 * Get or create user state
 * If user doesn't exist, creates a new record with the provided batch end time
 */
export async function createUserState(
  userEmail: string,
  transcriptionBatchEndOfDay: Date,
  timezone?: string | null
): Promise<UserStateI> {
  let userState = await UserState.findOne({ userEmail });

  if (!userState) {
    userState = await UserState.create({
      userEmail,
      transcriptionBatchEndOfDay,
      timezone: timezone ?? null,
    });
    console.log( `[UserStateService] Created new UserState for ${userEmail} with EOD: ${transcriptionBatchEndOfDay.toISOString()}, timezone: ${timezone ?? "not set"}` );
  } else {
    // Update timezone if provided and different
    if (timezone && userState.timezone !== timezone) {
      userState.timezone = timezone;
      await userState.save();
      console.log( `[UserStateService] Updated timezone for ${userEmail}: ${timezone}` );
    }
    console.log( `[UserStateService] Found existing UserState for ${userEmail} with EOD: ${userState.transcriptionBatchEndOfDay.toISOString()}` );
  }

  return userState;
}

/**
 * Get user state by email
 */
export async function getUserState(userEmail: string): Promise<UserStateI | null> {
  return UserState.findOne({ userEmail });
}

/**
 * Update transcription batch end time
 */
export async function updateTranscriptionBatchEndOfDay(
  userEmail: string,
  transcriptionBatchEndOfDay: Date
): Promise<UserStateI | null> {
  return UserState.findOneAndUpdate(
    { userEmail },
    { transcriptionBatchEndOfDay },
    { new: true }
  );
}
