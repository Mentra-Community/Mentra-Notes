/**
 * Database Connection Management
 *
 * Handles MongoDB connection lifecycle.
 * Models are in backend/models/ folder.
 */

import mongoose from "mongoose";

let isConnected = false;

/**
 * Connect to MongoDB
 */
export async function connectDB(): Promise<void> {
  if (isConnected) {
    return;
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn("[DB] MONGODB_URI not set - database features disabled");
    return;
  }

  try {
    await mongoose.connect(uri, {
      dbName: "notes",
    });
    isConnected = true;
    console.log("[DB] ✅ Connected to MongoDB");
  } catch (error) {
    console.error("[DB] Connection failed:", error);
    throw error;
  }
}

/**
 * Disconnect from MongoDB
 */
export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    console.log("[DB] Disconnected from MongoDB");
  } catch (error) {
    console.error("[DB] Disconnect failed:", error);
  }
}

/**
 * Check if connected to database
 */
export function isDBConnected(): boolean {
  return isConnected;
}
