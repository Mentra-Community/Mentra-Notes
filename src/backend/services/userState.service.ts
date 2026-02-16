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
    let needsSave = false;

    // Update timezone if provided and different
    if (timezone && userState.timezone !== timezone) {
      userState.timezone = timezone;
      needsSave = true;
      console.log( `[UserStateService] Updated timezone for ${userEmail}: ${timezone}` );
    }

    // Fix stale batch end date — if the stored EOD is in the past OR doesn't match
    // today's expected EOD, correct it to the caller's computed value
    const storedEOD = userState.transcriptionBatchEndOfDay.toISOString();
    const expectedEOD = transcriptionBatchEndOfDay.toISOString();
    const nowISO = new Date().toISOString();

    if (storedEOD < nowISO) {
      // Batch end is in the past — stale from a previous day
      console.log( `[UserStateService] Fixing stale EOD for ${userEmail}: ${storedEOD} -> ${expectedEOD} (was in the past)` );
      userState.transcriptionBatchEndOfDay = transcriptionBatchEndOfDay;
      needsSave = true;
    } else if (storedEOD !== expectedEOD && storedEOD > expectedEOD) {
      // Batch end is further in the future than expected — also wrong
      console.log( `[UserStateService] Fixing future EOD for ${userEmail}: ${storedEOD} -> ${expectedEOD} (was too far ahead)` );
      userState.transcriptionBatchEndOfDay = transcriptionBatchEndOfDay;
      needsSave = true;
    }

    if (needsSave) {
      await userState.save();
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
