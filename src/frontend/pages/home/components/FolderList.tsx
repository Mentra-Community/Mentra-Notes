/**
 * FolderList - Displays the list of days/folders
 *
 * Shows each day with:
 * - Date (Today, Yesterday, or formatted date)
 * - Note count badge
 * - Transcript duration/segment indicator
 * - Active transcribing indicator
 *
 * Header is now handled by HomePage.
 */

import { format, isToday, isYesterday } from "date-fns";
import { clsx } from "clsx";
import { ChevronRight, Mic } from "lucide-react";
import { TranscribingIndicator } from "../../../components/shared/TranscribingIndicator";

export interface DailyFolder {
  id: string;
  date: Date;
  dateString: string;
  isToday: boolean;
  isTranscribing: boolean;
  noteCount: number;
  transcriptCount: number;
  transcriptHourCount: number;
  hasTranscript?: boolean; // For historical dates with transcripts
}

interface FolderListProps {
  folders: DailyFolder[];
  onSelectFolder: (folder: DailyFolder) => void;
}

export function FolderList({ folders, onSelectFolder }: FolderListProps) {
  const formatFolderDate = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "EEEE");
  };

  const formatSubDate = (date: Date) => {
    if (isToday(date) || isYesterday(date)) {
      return format(date, "EEEE, MMM d");
    }
    return format(date, "MMM d");
  };

  // Group folders by month
  const groupedFolders = folders.reduce(
    (acc, folder) => {
      const monthKey = format(folder.date, "MMMM yyyy");
      if (!acc[monthKey]) {
        acc[monthKey] = [];
      }
      acc[monthKey].push(folder);
      return acc;
    },
    {} as Record<string, DailyFolder[]>,
  );

  const monthKeys = Object.keys(groupedFolders);

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-zinc-950">
      {monthKeys.map((monthKey, monthIndex) => (
        <div key={monthKey}>
          {/* Month divider - skip for current month if it's the first */}
          {monthIndex > 0 && (
            <div className="px-4 py-3 border-zinc-200 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                {monthKey}
              </span>
            </div>
          )}

          {groupedFolders[monthKey].map((folder) => (
            <button
              key={folder.id}
              onClick={() => onSelectFolder(folder)}
              className="w-full text-left py-[16px] px-6 border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-white dark:hover:bg-zinc-900/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Main date */}
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-zinc-900 dark:text-white">
                      {formatFolderDate(folder.date)}
                    </span>
                  </div>
                  {/* Sub date */}
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {formatSubDate(folder.date)}
                  </span>
                </div>

                {/* Right side indicators */}
                <div className="flex items-center gap-3">
                  {/* Transcribing indicator */}
                  {folder.isTranscribing && <TranscribingIndicator size="sm" />}

                  {/* Note count badge */}
                  {folder.noteCount > 0 && !folder.isTranscribing && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-full">
                      {folder.noteCount}{" "}
                      {folder.noteCount === 1 ? "Note" : "Notes"}
                    </span>
                  )}

                  {/* Transcript indicator */}
                  {(folder.hasTranscript || folder.transcriptCount > 0) &&
                    !folder.isTranscribing && (
                      <div className="flex items-center gap-1 text-zinc-400">
                        <Mic size={14} />
                        {folder.transcriptHourCount > 0 && (
                          <span className="text-xs">
                            {folder.transcriptHourCount}h
                          </span>
                        )}
                      </div>
                    )}

                  <ChevronRight
                    size={16}
                    className="text-zinc-300 dark:text-zinc-600"
                  />
                </div>
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
