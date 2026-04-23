/**
 * NotesTab - Displays notes for a specific day
 *
 * Shows:
 * - Masonry grid of note cards (manual and AI-generated)
 */

import { useNavigation } from "../../../../navigation/NavigationStack";
import { clsx } from "clsx";
import { FileText } from "lucide-react";
import Masonry, { ResponsiveMasonry } from "react-responsive-masonry";
import type { Note } from "../../../../../shared/types";
import { NoteCard } from "../NoteCard";

interface NotesTabProps {
  notes: Note[];
  isLoading?: boolean;
  selectionMode?: boolean;
  selectedNoteIds?: Set<string>;
  onToggleSelection?: (noteId: string) => void;
}

export function NotesTab({ notes, isLoading = false, selectionMode = false, selectedNoteIds, onToggleSelection }: NotesTabProps) {
  const { push } = useNavigation();

  const handleNoteClick = (note: Note) => {
    if (selectionMode && onToggleSelection) {
      onToggleSelection(note.id);
      return;
    }
    push(`/note/${note.id}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-4 pt-6">
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl space-y-3"
              >
                <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                <div className="space-y-2">
                  <div className="h-3 w-full bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                  <div className="h-3 w-5/6 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
                </div>
                <div className="h-3 w-1/3 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (notes.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="flex flex-col items-center justify-center h-64 text-center px-6 mt-12">
          <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mb-4 text-zinc-300 dark:text-zinc-600">
            <FileText size={24} />
          </div>
          <h3 className="text-zinc-900 dark:text-white font-medium mb-1">
            No notes yet
          </h3>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-6 max-w-[240px]">
            Create a note manually or generate one from the transcript using the
            pencil button below.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-32">
      <div className={clsx("p-6 pt-6", selectionMode && "pt-6")}>
        {/* Masonry Grid */}
        <ResponsiveMasonry columnsCountBreakPoints={{ 350: 2, 750: 3 }}>
          <Masonry gutter="10px">
            {notes.map((note) => (
              <div key={note.id} className="w-full">
                <NoteCard
                  note={note}
                  onClick={() => handleNoteClick(note)}
                  selectionMode={selectionMode}
                  isSelected={selectedNoteIds?.has(note.id) ?? false}
                />
              </div>
            ))}
          </Masonry>
        </ResponsiveMasonry>
      </div>
    </div>
  );
}
