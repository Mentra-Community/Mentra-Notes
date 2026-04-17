/**
 * Models Index
 *
 * Re-exports all mongoose models and their types/helpers.
 */

// Daily Transcript
export {
  DailyTranscript,
  type DailyTranscriptI,
  type TranscriptSegmentI,
  getOrCreateDailyTranscript,
  getDailyTranscript,
  appendTranscriptSegments,
  getAvailableDates,
  getTranscriptSummaries,
  deleteDailyTranscript,
} from "./daily-transcript.model";

// Hour Summary
export {
  HourSummary,
  type HourSummaryI,
  saveHourSummary,
  getHourSummaries,
  getHourSummary,
  deleteHourSummariesForDate,
} from "./hour-summary.model";

// Note
export {
  Note,
  type NoteI,
  createNote,
  getNotes,
  getNoteById,
  updateNote,
  deleteNote,
  getNotesByDateRange,
  deleteNotesByDate,
  unassignNotesFromFolder,
  deleteTrashedNotes,
} from "./note.model";

// Folder
export {
  Folder,
  type FolderI,
  type FolderColor,
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder,
  seedDefaultFolders,
} from "./folder.model";

// User Settings
export {
  UserSettings,
  type UserSettingsI,
  getOrCreateUserSettings,
  getUserSettings,
  updateUserSettings,
} from "./user-settings.model";

// Chat History
export {
  ChatHistory,
  type ChatHistoryI,
  type ChatMessageI,
  getChatHistory,
  getOrCreateChatHistory,
  addChatMessage,
  addChatMessages,
  clearChatHistory,
  deleteChatHistory,
  getChatHistoryDates,
} from "./chat-history.model";

// Conversation (auto-notes pipeline)
export {
  Conversation,
  type ConversationI,
  type ConversationStatus,
  createConversation,
  getResumableConversations,
  getConversationsByDate,
  getAllConversations,
  getConversationById,
  updateConversation,
  appendChunkToConversation,
  getActiveConversations,
} from "./conversation.model";

// Transcript Chunk (auto-notes pipeline)
export {
  TranscriptChunk,
  type TranscriptChunkI,
  type ChunkClassification,
  createTranscriptChunk,
  getNextChunkIndex,
  getRecentChunks,
  updateChunkClassification,
  getChunksByConversationId,
  deleteOldChunks,
  getChunksByDate,
} from "./transcript-chunk.model";

// File (source of truth for folders)
export {
  File,
  type FileI,
  getOrCreateFile,
  getFile,
  getFiles,
  updateFile,
  incrementNoteCount,
  updateFileTranscript,
  bulkCreateFiles,
  deleteFile,
} from "./file.model";
