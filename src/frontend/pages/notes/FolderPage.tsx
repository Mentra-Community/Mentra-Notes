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
import {
  DropdownMenu,
  type DropdownMenuOption,
} from "../../components/shared/DropdownMenu";
import { BottomDrawer } from "../../components/shared/BottomDrawer";

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
    return notes.filter((n) => n.folderId === folderId && !n.isTrashed);
  }, [notes, folderId]);

  const handleSelectNote = (note: Note) => {
    setLocation(`/note/${note.id}`);
  };

  const handleTrashNote = async (note: Note) => {
    if (!session?.notes?.trashNote) return;
    await session.notes.trashNote(note.id);
  };

  const handleArchiveNote = async (note: Note) => {
    if (!session?.notes) return;
    if (note.isArchived) {
      await session.notes.unarchiveNote(note.id);
    } else {
      await session.notes.archiveNote(note.id);
    }
  };

  const formatNoteDate = (note: Note): string => {
    const [year, month, day] = note.date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    if (isToday(dateObj)) return "Today";
    if (isYesterday(dateObj)) return "Yesterday";
    return format(dateObj, "EEE MMM d");
  };

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDeleteFolder = async () => {
    if (!session?.folders?.deleteFolder || !folderId) return;
    setShowDeleteConfirm(false);
    await session.folders.deleteFolder(folderId);
    setLocation("/collections");
  };

  const folderColor = folder ? FOLDER_COLOR_MAP[folder.color] : "#78716C";

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setLocation("/collections")}
              className="shrink-0 p-1 -ml-1"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#1C1917"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div className="flex flex-col gap-0.5">
              <div className="text-[28px] tracking-[-0.03em] leading-8 text-[#1C1917] font-red-hat font-extrabold flex flex-row items-center gap-2">
                {folder?.name || "Folder"}
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="shrink-0"
                >
                  <path
                    d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                    stroke={folderColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                  />
                </svg>
              </div>
              <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                {folderNotes.length}{" "}
                {folderNotes.length === 1 ? "note" : "notes"}
              </div>
            </div>
          </div>
          <DropdownMenu
            options={
              [
                {
                  id: "delete",
                  label: "Delete folder",
                  danger: true,
                  icon: (
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#DC2626"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  ),
                  onClick: () => setShowDeleteConfirm(true),
                },
              ] satisfies DropdownMenuOption[]
            }
          />
        </div>
      </div>

      {/* Notes list */}
      <div className="flex flex-col flex-1 overflow-y-auto pt-4 px-6 pb-32">
        {folderNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#D6D3D1"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <div className="text-[14px] leading-5 text-[#A8A29E] font-red-hat text-center">
              No notes in this folder yet
            </div>
          </div>
        ) : (
          folderNotes.map((note) => {
            return (
              <NoteRow
                key={note.id}
                note={note}
                meta={formatNoteDate(note)}
                stripHtmlAndTruncate={stripHtmlAndTruncate}
                onSelect={handleSelectNote}
              />
            );
          })
        )}
      </div>

      {/* Delete folder confirmation */}
      <BottomDrawer
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="text-[18px] leading-[22px] text-[#1C1917] font-red-hat font-bold text-center">
            Delete folder?
          </div>
          <div className="text-[14px] leading-5 text-[#A8A29E] font-red-hat text-center">
            Your notes won't be deleted — they'll just be removed from this
            folder.
          </div>
          <div className="flex gap-3 w-full mt-3">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-medium bg-[#F5F5F4] text-[#78716C]"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteFolder}
              className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-bold bg-[#DC2626] text-white"
            >
              Delete
            </button>
          </div>
        </div>
      </BottomDrawer>
    </div>
  );
}
