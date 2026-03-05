/**
 * DayPage - Day detail view with tabs
 *
 * Displays a specific day's content with tabs for:
 * - Notes: List of notes for this day
 * - Transcript: Transcription segments grouped by hour
 * - Audio: Audio recordings (future)
 * - AI: AI chat interface for this day's content
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, parse } from "date-fns";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronLeft,
  Star,
  FileText,
  MessageSquare,
  // Headphones, // TODO: Enable when audio feature is implemented
  Sparkles,
  Archive,
  ArchiveRestore,
  Trash2,
  RotateCcw,
  ListCollapse,
  AlignJustify,
  Mail,
} from "lucide-react";
import { useSynced } from "../../hooks/useSynced";
import type {
  SessionI,
  Note,
  TranscriptSegment,
  HourSummary,
} from "../../../shared/types";
import { NotesTab } from "./components/tabs/NotesTab";
import { TranscriptTab } from "./components/tabs/TranscriptTab";
// import { AudioTab } from "./components/tabs/AudioTab"; // TODO: Enable when audio feature is implemented
import { AITab } from "./components/tabs/AITab";
import { TranscribingIndicator } from "../../components/shared/TranscribingIndicator";
import { DropdownMenu, type DropdownMenuOption } from "../../components/shared/DropdownMenu";
import { DayPageSkeleton } from "../../components/shared/SkeletonLoader";
import { useFeatureFlag } from "../../lib/posthog";

type TabType = "notes" | "transcript" | "audio" | "ai";

interface TabConfig {
  id: TabType;
  label: string;
  icon: typeof FileText;
}

const tabs: TabConfig[] = [
  { id: "transcript", label: "Transcript", icon: MessageSquare },
  { id: "notes", label: "Notes", icon: FileText },
  // { id: "audio", label: "Audio", icon: Headphones }, // TODO: Enable when audio feature is implemented
  // { id: "ai", label: "AI", icon: Sparkles },
];

export function DayPage() {
  const params = useParams<{ date: string }>();
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session, isConnected } = useSynced<SessionI>(userId || "");

  const newMentraUI = useFeatureFlag('new-mentraos-ui-miniapps');
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("tab") as TabType) || "transcript";
  });
  const lastLoadedDateRef = useRef<string | null>(null);
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  // Snapshot segment count when a historical date finishes loading,
  // so new live segments don't bleed into the old file's view
  const historicalSegmentCountRef = useRef<number | null>(null);

  // Super collapsed mode — optimistic local state + debounced server sync
  const serverCompactMode = session?.settings?.superCollapsed ?? false;
  const [optimisticCompact, setOptimisticCompact] = useState<boolean | null>(null);
  const compactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCompactMode = optimisticCompact ?? serverCompactMode;

  useEffect(() => {
    if (optimisticCompact !== null && serverCompactMode === optimisticCompact) {
      setOptimisticCompact(null);
    }
  }, [serverCompactMode, optimisticCompact]);

  const toggleCompactMode = useCallback(() => {
    const newValue = !isCompactMode;
    setOptimisticCompact(newValue);

    if (compactDebounceRef.current) clearTimeout(compactDebounceRef.current);
    compactDebounceRef.current = setTimeout(() => {
      session?.settings?.updateSettings({ superCollapsed: newValue });
    }, 300);
  }, [isCompactMode, session?.settings]);

  // Parse the date from URL params
  const dateString = params.date || "";
  const date = useMemo(() => {
    try {
      return parse(dateString, "yyyy-MM-dd", new Date());
    } catch {
      return new Date();
    }
  }, [dateString]);

  // Check if this is today
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const isToday = dateString === todayString;

  // Get data from session
  const allNotes = session?.notes?.notes ?? [];
  const allSegments = session?.transcript?.segments ?? [];
  const hourSummaries = session?.transcript?.hourSummaries ?? [];
  const interimText = session?.transcript?.interimText ?? "";
  const isRecording = session?.transcript?.isRecording ?? false;
  const isSyncingPhoto = session?.transcript?.isSyncingPhoto ?? false;
  const loadedDate = session?.transcript?.loadedDate ?? "";
  const files = session?.file?.files ?? [];

  // Data is loading when the server hasn't confirmed this date's data yet.
  // loadedDate is the source of truth for which date's segments are loaded.
  // isLoadingTranscript gates the transition period when switching dates.
  const isLoadingHistory = session?.transcript?.isLoadingHistory ?? false;
  const dateMatchesServer = loadedDate === dateString;
  const isActivelyLoading = isLoadingHistory || isLoadingTranscript;
  const isDataLoading = isActivelyLoading || !dateMatchesServer;

  // Find the file for this date to get favourite status
  const currentFile = useMemo(() => {
    return files.find((f) => f.date === dateString);
  }, [files, dateString]);
  const serverStarred = currentFile?.isFavourite ?? false;
  const isArchived = currentFile?.isArchived ?? false;
  const isTrashed = currentFile?.isTrashed ?? false;

  // Optimistic star toggle with debounce
  const [optimisticStarred, setOptimisticStarred] = useState<boolean | null>(null);
  const starDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isStarred = optimisticStarred ?? serverStarred;

  // Sync optimistic state back to server value once it catches up
  useEffect(() => {
    if (optimisticStarred !== null && serverStarred === optimisticStarred) {
      setOptimisticStarred(null);
    }
  }, [serverStarred, optimisticStarred]);

  const toggleStar = useCallback(() => {
    if (!session?.file) return;
    const newValue = !isStarred;
    setOptimisticStarred(newValue);

    if (starDebounceRef.current) clearTimeout(starDebounceRef.current);
    starDebounceRef.current = setTimeout(() => {
      if (newValue) {
        session.file.favouriteFile(dateString);
      } else {
        session.file.unfavouriteFile(dateString);
      }
    }, 300);
  }, [isStarred, session?.file, dateString]);

  // Get current hour for determining which hour is "in progress"
  const currentHour = new Date().getHours();

  // Load historical transcript when viewing a past date
  useEffect(() => {
    if (!session?.transcript?.loadDateTranscript) return;
    if (!dateString) return;

    // Skip if we already loaded this date
    if (lastLoadedDateRef.current === dateString) return;

    // Skip if it's already the loaded date on the server
    if (loadedDate === dateString) {
      lastLoadedDateRef.current = dateString;
      return;
    }

    // Load the transcript for this date
    console.log(`[DayPage] Loading transcript for ${dateString}`);
    lastLoadedDateRef.current = dateString;
    setIsLoadingTranscript(true);

    if (dateString === todayString) {
      // Switch back to today
      session.transcript.loadTodayTranscript()
        .catch((err) => {
          console.error("[DayPage] Failed to load today's transcript:", err);
        })
        .finally(() => setIsLoadingTranscript(false));
    } else {
      // Load historical date
      session.transcript.loadDateTranscript(dateString)
        .catch((err) => {
          console.error(
            `[DayPage] Failed to load transcript for ${dateString}:`,
            err,
          );
        })
        .finally(() => setIsLoadingTranscript(false));
    }
  }, [dateString, todayString, loadedDate, session?.transcript]);

  // Filter notes for this day using the note's date field
  // The date field stores the folder date (YYYY-MM-DD) that the note belongs to
  const dayNotes = useMemo(() => {
    return allNotes.filter((note) => {
      // Use the note's date field if available, otherwise fallback to createdAt for backward compatibility
      if (note.date) {
        return note.date === dateString;
      }
      // Fallback for old notes without date field
      const noteDate = note.createdAt ? new Date(note.createdAt) : new Date();
      const noteDateString = `${noteDate.getFullYear()}-${String(noteDate.getMonth() + 1).padStart(2, "0")}-${String(noteDate.getDate()).padStart(2, "0")}`;
      return noteDateString === dateString;
    });
  }, [allNotes, dateString]);

  // Snapshot segment count when a historical date finishes loading.
  // This prevents live transcription segments from bleeding into the old file's view.
  useEffect(() => {
    if (!isDataLoading && loadedDate === dateString) {
      if (isToday) {
        historicalSegmentCountRef.current = null; // no cap for today
      } else {
        historicalSegmentCountRef.current = allSegments.length;
      }
    }
  }, [isDataLoading, loadedDate, dateString, isToday, allSegments.length]);

  // Reset snapshot when navigating to a new date
  useEffect(() => {
    historicalSegmentCountRef.current = null;
  }, [dateString]);

  // Filter transcript segments for this day
  const daySegments = useMemo(() => {
    // While loading, return empty to prevent stale data from flashing
    if (isDataLoading) return [];

    // Server loaded data for this date
    if (loadedDate === dateString) {
      // For historical dates, cap to the snapshot count to prevent
      // live transcription segments from appearing in old files
      if (!isToday && historicalSegmentCountRef.current !== null) {
        return allSegments.slice(0, historicalSegmentCountRef.current);
      }
      return allSegments;
    }

    // Fallback: filter by extracting YYYY-MM-DD from the UTC ISO timestamp
    return allSegments.filter((segment) => {
      if (!segment.timestamp) return false;
      const iso = segment.timestamp instanceof Date
        ? segment.timestamp.toISOString()
        : String(segment.timestamp);
      return iso.slice(0, 10) === dateString;
    });
  }, [allSegments, dateString, loadedDate, isDataLoading, isToday]);

  if (!session) {
    return <DayPageSkeleton />;
  }

  const handleBack = () => {
    setLocation("/");
  };

  const formatHeaderDate = () => {
    return format(date, "MMMM d, yyyy");
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800">
        {/* Top row with back button and actions */}
        <div className={clsx("relative flex items-center justify-center  pt-4 pb-2", newMentraUI && "mr-[100px]")}>
          <button
            onClick={handleBack}
            className="absolute left-[0px]  py-2 pl-[24px] pr-[10px] rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 transition-colors "
          >
            <ChevronLeft size={24} className="-ml-[5px]" />
          </button>

          <h1 className="text-lg font-semibold text-zinc-900 dark:text-white">
            {formatHeaderDate()}
          </h1>

          <div className="absolute right-[0px] flex items-center gap-1 ">
            <button
              onClick={toggleStar}
              className={clsx(
                "py-2 rounded-lg transition-colors  w-[60px] flex justify-end items-end pr-[24px] ",
                isStarred
                  ? "text-yellow-500"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300",
              )}
            >
              <Star size={20} fill={isStarred ? "currentColor" : "none"} />
            </button>
            <DropdownMenu
              options={[
                {
                  id: "send-transcript",
                  label: "Send Transcript",
                  icon: Mail,
                  onClick: async () => {
                    if (daySegments.length === 0) {
                      alert("No transcript segments to send");
                      return;
                    }
                    const finalSegments = daySegments
                      .filter((s) => s.isFinal && s.type !== "photo")
                      .map((s) => ({
                        timestamp: new Date(s.timestamp).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }),
                        text: s.text,
                      }));
                    if (finalSegments.length === 0) {
                      alert("No final transcript segments to send");
                      return;
                    }
                    const noteDate = new Date(dateString + "T00:00:00");
                    const sessionDate = noteDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
                    const firstSeg = daySegments.find((s) => s.isFinal);
                    const lastSeg = [...daySegments].reverse().find((s) => s.isFinal);
                    const startTime = firstSeg
                      ? new Date(firstSeg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      : "";
                    const endTime = lastSeg
                      ? new Date(lastSeg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                      : "";
                    try {
                      const res = await fetch("/api/transcript/email", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({
                          to: "aryan@mentraglass.com",
                          userId,
                          date: dateString,
                          sessionDate,
                          sessionStartTime: startTime,
                          sessionEndTime: endTime,
                          segments: finalSegments,
                        }),
                      });
                      const data = await res.json();
                      alert(data.success ? "Transcript email sent!" : "Failed: " + data.error);
                    } catch (err) {
                      alert("Error sending transcript email");
                    }
                  },
                },
                ...(!isToday ? [
                  { type: "divider" } as const,
                  {
                    id: "archive",
                    label: isArchived ? "Unarchive" : "Archive",
                    icon: isArchived ? ArchiveRestore : Archive,
                    onClick: () => {
                      if (!session?.file) return;
                      if (isArchived) {
                        session.file.unarchiveFile(dateString);
                      } else {
                        session.file.archiveFile(dateString);
                      }
                    },
                  },
                  { type: "divider" } as const,
                  {
                    id: "trash",
                    label: isTrashed ? "Restore" : "Move to Trash",
                    icon: isTrashed ? RotateCcw : Trash2,
                    danger: !isTrashed,
                    onClick: () => {
                      if (!session?.file) return;
                      if (isTrashed) {
                        session.file.restoreFile(dateString);
                      } else {
                        session.file.trashFile(dateString);
                      }
                    },
                  },
                ] : []),
              ] as DropdownMenuOption[]}
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                `relative pb-3 text-sm font-medium transition-colors ${tab.id === "notes" ? "pr-2" : tab.id === "transcript" ? "pl-6" : ""}`,
                activeTab === tab.id
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300",
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="tab-underline"
                  className={clsx(
                    "absolute bottom-0 h-0.5 bg-zinc-900 dark:bg-white rounded-full",
                    tab.id === "notes" ? "left-0 right-2" : tab.id === "transcript" ? "left-6 right-0" : "left-0 right-0",
                  )}
                  transition={{ duration: 0.2, ease: "easeInOut" }}
                />
              )}
            </button>
          ))}

          {/* Compact mode toggle - only shown on transcript tab */}
          {activeTab === "transcript" && (
            <button
              onClick={toggleCompactMode}
              className={clsx(
                "ml-auto m-h-[12px] p-1 rounded pr-[24px] pl-[40px] flex ",
                isCompactMode
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300",
              )}
              title={isCompactMode ? "Show details" : "Compact view"}
            >
              {isCompactMode ? <ListCollapse size={15} /> : <AlignJustify size={15} />}
            </button>
          )}
          <button
            onClick={async () => {
              if (dayNotes.length === 0) {
                alert("No notes to email");
                return;
              }
              const note = dayNotes[0];
              const noteDate = new Date(dateString + "T00:00:00");
              const sessionDate = noteDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
              const createdAt = note.createdAt ? new Date(note.createdAt) : new Date();
              const noteTimestamp = createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
              const startTime = note.transcriptRange?.startTime
                ? new Date(note.transcriptRange.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                : noteTimestamp;
              const endTime = note.transcriptRange?.endTime
                ? new Date(note.transcriptRange.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
                : "";

              try {
                const res = await fetch("/api/email/send", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    to: "aryan@mentraglass.com",
                    noteId: note.id,
                    sessionDate,
                    sessionStartTime: startTime,
                    sessionEndTime: endTime,
                    noteTimestamp,
                    noteTitle: note.title,
                    noteContent: note.content,
                    noteType: note.isAIGenerated ? "AI Generated" : "Manual",
                  }),
                });
                const data = await res.json();
                if (data.success) {
                  alert("Email sent!");
                } else {
                  alert("Failed: " + data.error);
                }
              } catch (err) {
                alert("Error sending email");
              }
            }}
            className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Test Email
          </button>
        </div>
        

        {/* Recording indicator */}
        {isToday && isRecording && (
          <div className="px-6 py-2 bg-zinc-100 dark:bg-zinc-900 border-t border-zinc-100 dark:border-zinc-800">
            <TranscribingIndicator size="sm" />
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08, ease: "easeInOut" }}
            className="h-full"
          >
            {activeTab === "notes" && (
              <NotesTab notes={dayNotes} isLoading={isDataLoading} />
            )}
            {activeTab === "transcript" && (
              <TranscriptTab
                segments={daySegments}
                hourSummaries={hourSummaries}
                interimText={isToday ? interimText : ""}
                currentHour={isToday ? currentHour : undefined}
                dateString={dateString}
                timezone={session?.settings?.timezone ?? undefined}
                onGenerateSummary={session?.transcript?.generateHourSummary}
                isCompactMode={isCompactMode}
                isSyncingPhoto={isToday ? isSyncingPhoto : false}
                isLoading={isDataLoading}
              />
            )}
            {/* {activeTab === "audio" && <AudioTab />} */}
            {activeTab === "ai" && <AITab date={date} isLoading={isDataLoading} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
