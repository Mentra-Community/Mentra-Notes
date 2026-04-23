/**
 * Managers Index
 *
 * Re-exports all synced managers for the Notes session.
 */

export { TimeManager } from "./TimeManager";
export { TranscriptManager, type TranscriptSegment, type HourSummary } from "./TranscriptManager";
export { SummaryManager } from "./SummaryManager";
export { NotesManager, type NoteData } from "./NotesManager";
export { ChatManager, type ChatMessage } from "./ChatManager";
export { SettingsManager, type GlassesDisplayMode } from "./SettingsManager";
export { CloudflareR2Manager, type BatchStatus, type BatchInfo } from "./CloudflareR2Manager";
export { FileManager, type FileData, type FileFilter } from "./FileManager";
export { PhotoManager, type PhotoSize } from "./PhotoManager";
export { ChunkBufferManager } from "./ChunkBufferManager";
export { ConversationManager } from "./ConversationManager";
export { FoldersManager, type FolderData } from "./FoldersManager";
export { DisplayManager } from "./DisplayManager";
