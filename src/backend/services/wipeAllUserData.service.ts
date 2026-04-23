/**
 * wipeAllUserData.service — Fresh-install wipe for a single user.
 *
 * Deletes every user-scoped collection EXCEPT UserSettings (preserved).
 * Caller is responsible for resetting in-memory manager state after this runs.
 */

import {
  Note,
  DailyTranscript,
  HourSummary,
  Folder,
  ChatHistory,
  Conversation,
  TranscriptChunk,
  File as FileModel,
  TranscriptSegmentSearch,
} from "../models";

export interface WipeResult {
  notes: number;
  transcripts: number;
  hourSummaries: number;
  folders: number;
  chatHistories: number;
  conversations: number;
  transcriptChunks: number;
  files: number;
  searchSegments: number;
}

export async function wipeAllUserData(userId: string): Promise<WipeResult> {
  const [
    notesRes,
    transcriptsRes,
    hourSummariesRes,
    foldersRes,
    chatRes,
    conversationsRes,
    chunksRes,
    filesRes,
    searchRes,
  ] = await Promise.all([
    Note.deleteMany({ userId }),
    DailyTranscript.deleteMany({ userId }),
    HourSummary.deleteMany({ userId }),
    Folder.deleteMany({ userId }),
    ChatHistory.deleteMany({ userId }),
    Conversation.deleteMany({ userId }),
    TranscriptChunk.deleteMany({ userId }),
    FileModel.deleteMany({ userId }),
    TranscriptSegmentSearch.deleteMany({ userId }),
  ]);

  return {
    notes: notesRes.deletedCount ?? 0,
    transcripts: transcriptsRes.deletedCount ?? 0,
    hourSummaries: hourSummariesRes.deletedCount ?? 0,
    folders: foldersRes.deletedCount ?? 0,
    chatHistories: chatRes.deletedCount ?? 0,
    conversations: conversationsRes.deletedCount ?? 0,
    transcriptChunks: chunksRes.deletedCount ?? 0,
    files: filesRes.deletedCount ?? 0,
    searchSegments: searchRes.deletedCount ?? 0,
  };
}
