import { Schema, model } from "mongoose";

const userStateSchema = new Schema({
  userEmail: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },

  transcriptionBatchEndOfDay: {
    type: Date,
    required: true,
    description: "Date and time when transcriptions are batched and sent to R2 Cloudflare (user's local timezone)",
  },

  timezone: {
    type: String,
    default: null,
    description: "User's IANA timezone (e.g. 'America/New_York')",
  },

  createdAt: {
    type: Date,
    default: Date.now,
  },

  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export const UserState = model("UserState", userStateSchema);
