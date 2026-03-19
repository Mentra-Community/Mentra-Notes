/**
 * FolderPage - Shows notes within a specific folder
 *
 * Similar to NotesPage but filtered to a single folder.
 * Header shows folder icon (colored) + folder name.
 */

import { useState, useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, isToday, isYesterday } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, Note, FolderColor } from "../../../shared/types";
import { NoteRow } from "./NoteRow";

const FOLDER_COLOR_MAP: Record<FolderColor, string> = {
  red: "#DC2626",
  gray: "#78716C",
  blue: "#2563EB",
};

/** Strip HTML tags and return first ~40 words */
function stripHtmlAndTruncate(html: string | undefined, maxWords = 40): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").slice(0, maxWords);
  return words.length >= maxWords ? words.join(" ") + "..." : words.join(" ");
}

export function FolderPage() {
  const { id: folderId } = useParams<{ id: string }>();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();

  const folders = session?.folders?.folders ?? [];
  const notes = session?.notes?.notes ?? [];
  const folder = folders.find((f) => f.id === folderId);

  const folderNotes = useMemo(() => {
    return notes.filter((n) => n.folderId === folderId);
  }, [notes, folderId]);

  const handleSelectNote = (note: Note) => {
    setLocation(`/note/${note.id}`);
  };

  const handleDeleteNote = async (note: Note) => {
    if (!session?.notes?.deleteNote) return;
    await session.notes.deleteNote(note.id);
  };

  const handleArchiveNote = async (note: Note) => {
    if (!session?.file?.archiveFile) return;
    await session.file.archiveFile(note.date);
  };

  const formatNoteDate = (note: Note): string => {
    const [year, month, day] = note.date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    if (isToday(dateObj)) return "Today";
    if (isYesterday(dateObj)) return "Yesterday";
    return format(dateObj, "EEE MMM d");
  };

  const folderColor = folder ? FOLDER_COLOR_MAP[folder.color] : "#78716C";

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
        <button
          onClick={() => setLocation("/collections")}
          className="flex items-center gap-1 text-left"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat font-medium">
            Collections
          </span>
        </button>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-3">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                stroke={folderColor}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <div className="flex flex-col gap-0.5">
              <div className="text-[28px] tracking-[-0.03em] leading-8 text-[#1C1917] font-red-hat font-extrabold">
                {folder?.name || "Folder"}
              </div>
              <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                {folderNotes.length} {folderNotes.length === 1 ? "note" : "notes"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes list */}
      <div className="flex flex-col flex-1 overflow-y-auto pt-4 px-6 pb-32">
        {folderNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <div className="text-[14px] leading-5 text-[#A8A29E] font-red-hat text-center">
              No notes in this folder yet
            </div>
          </div>
        ) : (
          folderNotes.map((note, i) => {
            const isLast = i === folderNotes.length - 1;
            return (
              <NoteRow
                key={note.id}
                note={note}
                fromLabel={null}
                formatNoteDate={formatNoteDate}
                stripHtmlAndTruncate={stripHtmlAndTruncate}
                onSelect={handleSelectNote}
                onArchive={handleArchiveNote}
                onDelete={handleDeleteNote}
                isLast={isLast}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
