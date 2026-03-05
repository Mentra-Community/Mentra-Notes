/**
 * NoteCard - Displays a note preview in the masonry notes grid
 *
 * Shows:
 * - Note title
 * - Clean plain-text preview (HTML stripped)
 * - AI Generated (green) or Manual (gray) badge
 * - Time range for AI notes, creation time for manual
 *
 * Reference: figma-design/src/app/components/tabs/NotesTab.tsx L36-70
 */

import { clsx } from "clsx";
import { Check } from "lucide-react";
import type { Note } from "../../../../shared/types";

interface NoteCardProps {
  note: Note;
  onClick: () => void;
  selectionMode?: boolean;
  isSelected?: boolean;
}

/**
 * Strip HTML tags and decode entities to get plain text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ") // Collapse whitespace
    .trim();
}

/**
 * Check if content is placeholder or empty
 */
function isPlaceholderContent(content: string | undefined): boolean {
  if (!content) return true;
  const stripped = stripHtml(content).toLowerCase();
  return (
    stripped === "" ||
    stripped === "tap to edit this note..." ||
    stripped === "tap to start writing..." ||
    stripped === "start writing..." ||
    stripped === "no content"
  );
}

/**
 * Get clean preview text from note content
 */
function getPreviewText(note: Note): string {
  // Try content first (user-edited), then summary (AI-generated)
  // Check both explicitly since empty string "" is falsy
  let rawContent = "";

  if (note.content && !isPlaceholderContent(note.content)) {
    rawContent = note.content;
  } else if (note.summary && !isPlaceholderContent(note.summary)) {
    rawContent = note.summary;
  }

  if (!rawContent) {
    return "";
  }

  const plainText = stripHtml(rawContent);

  if (!plainText || isPlaceholderContent(plainText)) {
    return "";
  }

  // Truncate to ~100 chars
  if (plainText.length > 100) {
    return plainText.substring(0, 100).trim() + "...";
  }

  return plainText;
}

export function NoteCard({ note, onClick, selectionMode = false, isSelected = false }: NoteCardProps) {
  // Use the isAIGenerated field, fallback to checking transcriptRange for old notes
  const isAIGenerated = note.isAIGenerated ?? !!note.transcriptRange;
  const previewText = getPreviewText(note);
  const hasContent = previewText.length > 0;

  const formatTime = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  // Get time range display for AI notes
  const getTimeRangeDisplay = (): string | null => {
    if (!isAIGenerated) return null;
    if (note.transcriptRange?.startTime && note.transcriptRange?.endTime) {
      const start = formatTime(note.transcriptRange.startTime);
      const end = formatTime(note.transcriptRange.endTime);
      return `${start} - ${end}`;
    }
    // Fallback to just creation time for AI notes without range
    if (note.createdAt) {
      return formatTime(note.createdAt);
    }
    return null;
  };

  const timeRangeDisplay = getTimeRangeDisplay();

  return (
    <div
      onClick={onClick}
      className={clsx(
        "relative w-full bg-white dark:bg-zinc-900 shadow-sm rounded-2xl p-4 cursor-pointer transition-all duration-200 flex flex-col gap-2",
        selectionMode && !isSelected && "animate-note-shake",
        selectionMode ? "border-2" : "border-2",
        !selectionMode && "hover:border-zinc-300 dark:hover:border-zinc-700",
        isSelected
          ? "border-zinc-900 dark:border-white"
          : "border-zinc-100 dark:border-zinc-800",
      )}
    >
      {/* Selection circle */}
      {selectionMode && (
        <div
          className={clsx(
            "absolute -top-2 -right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center z-10 transition-colors",
            isSelected
              ? "bg-zinc-900 border-zinc-900 dark:bg-white dark:border-white shadow-sm"
              : "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600",
          )}
        >
          {isSelected && <Check size={14} className="text-white dark:text-zinc-900" strokeWidth={3} />}
        </div>
      )}

      {/* Title */}
      <h3 className="font-semibold text-sm leading-snug text-zinc-900 dark:text-white line-clamp-2">
        {note.title || "Untitled Note"}
      </h3>

      {/* Preview */}
      <div
        className={clsx(
          "text-xs leading-relaxed line-clamp-[8]",
          hasContent
            ? "text-zinc-500 dark:text-zinc-400"
            : "text-zinc-400 dark:text-zinc-500 italic",
        )}
      >
        {hasContent ? previewText : "Tap to edit this note..."}
      </div>

      {/* Metadata Footer */}
      <div className="mt-auto pt-2 flex flex-wrap gap-1.5 items-center border-t border-zinc-100 dark:border-zinc-800">
        {/* Badge */}
        {isAIGenerated ? (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
            AI Generated
          </span>
        ) : (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Manual
          </span>
        )}

        {/* Time range or creation time */}
        {timeRangeDisplay && isAIGenerated && (
          <span className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500">
            {timeRangeDisplay}
          </span>
        )}

        {/* Creation time for manual notes */}
        {!isAIGenerated && note.createdAt && (
          <span className="text-[9px] font-medium text-zinc-400 dark:text-zinc-500">
            {formatTime(note.createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}
