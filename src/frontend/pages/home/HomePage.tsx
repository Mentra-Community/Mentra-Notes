/**
 * HomePage - Main landing page showing the list of days/folders
 *
 * Features:
 * - Filter dropdown (All Files / Archived / Trash)
 * - View modes (Folders / All Notes / Favorites)
 * - Calendar view toggle
 * - Global AI chat trigger (sparkles icon)
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import {
  Calendar,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  Trash2,
  Archive,
  Star,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, FileFilter } from "../../../shared/types";
import { FolderList } from "./components/FolderList";
import type { DailyFolder } from "./components/FolderList";
import {
  FilterDrawer,
  type FilterType,
  type ViewType,
} from "../../components/shared/FilterDrawer";
import { CalendarView } from "./components/CalendarView";
import { GlobalAIChat } from "./components/GlobalAIChat";
import { Drawer } from "vaul";
import { HomePageSkeleton } from "../../components/shared/SkeletonLoader";
import { useFeatureFlag } from "../../lib/posthog";

export function HomePage() {
  const { userId } = useMentraAuth();
  const { session, isConnected, reconnect } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();

  // Local UI state - only for things that can't be derived from backend
  // Note: "all_notes" view is frontend-only, so we track if user explicitly chose it
  const [isAllNotesView, setIsAllNotesView] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [showGlobalChat, setShowGlobalChat] = useState(false);
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
  const { enabled: newMentraUI } = useFeatureFlag('new-mentraos-ui-miniapps');
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);

  // Derive data from session - now using FileManager as source of truth
  const files = session?.file?.files ?? [];
  const isRecording = session?.transcript?.isRecording ?? false;
  const notes = session?.notes?.notes ?? [];

  // Get activeFilter from backend state - this is the source of truth
  const backendFilter = session?.file?.activeFilter ?? "all";

  // Derive activeView from backend filter (favourites) or local state (all_notes)
  // This ensures the view state survives navigation for filter-based views
  const activeView: ViewType = isAllNotesView
    ? "all_notes"
    : backendFilter === "favourites"
      ? "favorites"
      : "folders";
  const activeFilter: FilterType = backendFilter === "favourites" ? "all" : backendFilter as FilterType;

  // Debug: Log filter state on every render
  console.log(`[HomePage] Render - backendFilter: ${backendFilter}, activeView: ${activeView}, activeFilter: ${activeFilter}, files: ${files.length}`);

  // Transform FileData to DailyFolder format
  const folders = useMemo((): DailyFolder[] => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    return files.map((file) => {
      const [year, month, day] = file.date.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      const isToday = file.date === today;

      return {
        id: file.date,
        date: dateObj,
        dateString: file.date,
        isToday,
        isTranscribing: isToday && isRecording,
        noteCount: file.noteCount,
        transcriptCount: file.transcriptSegmentCount,
        transcriptHourCount: file.transcriptHourCount ?? 0,
        hasTranscript: file.hasTranscript,
      };
    });
  }, [files, isRecording]);

  // Filter counts - from session (computed on backend)
  const fileCounts = session?.file?.counts ?? { all: 0, archived: 0, trash: 0, favourites: 0 };
  const filterCounts = useMemo(
    () => ({
      all: fileCounts.all,
      archived: fileCounts.archived,
      trash: fileCounts.trash,
      allNotes: notes.length,
      favorites: fileCounts.favourites,
    }),
    [fileCounts, notes],
  );

  // Handle filter change - call FileManager RPC
  // Backend's activeFilter state will sync back to update the UI
  const handleFilterChange = async (filter: FilterType) => {
    // Clear all_notes view when changing filter
    setIsAllNotesView(false);

    // Map FilterType to FileFilter
    const fileFilter: FileFilter =
      filter === "archived" ? "archived" : filter === "trash" ? "trash" : "all";

    // Call RPC to update files - backend state will sync back
    if (session?.file) {
      await session.file.setFilter(fileFilter);
    }
  };

  // Handle view change - call FileManager RPC for favorites
  const handleViewChange = async (view: ViewType) => {
    if (view === "all_notes") {
      // all_notes is frontend-only view
      setIsAllNotesView(true);
    } else if (view === "favorites") {
      setIsAllNotesView(false);
      // Set filter to favourites - backend state will sync back
      if (session?.file) {
        await session.file.setFilter("favourites");
      }
    } else {
      // "folders" view - clear all_notes flag, filter is set by handleFilterChange
      setIsAllNotesView(false);
    }
  };

  // Get filter label for display
  const getFilterLabel = (): string => {
    if (activeView === "all_notes") return "All Notes";
    if (activeView === "favorites") return "Favorites";
    switch (activeFilter) {
      case "archived":
        return "Archived";
      case "trash":
        return "Trash";
      default:
        return "All Files";
    }
  };

  const handleSelectFolder = (folder: DailyFolder) => {
    setLocation(`/day/${folder.dateString}`);
  };

  const handleGlobalChat = () => {
    setShowGlobalChat(true);
  };

  const handleCalendarToggle = async () => {
    if (viewMode === "list") {
      // Entering calendar — reset filter to "All Files"
      setIsAllNotesView(false);
      if (session?.file) {
        await session.file.setFilter("all");
      }
      setViewMode("calendar");
    } else {
      setViewMode("list");
    }
  };

  const handleEmptyTrashClick = () => {
    setShowEmptyTrashConfirm(true);
  };

  const handleEmptyTrashConfirm = async () => {
    if (!session?.file) return;

    setShowEmptyTrashConfirm(false);
    setIsEmptyingTrash(true);
    try {
      const result = await session.file.emptyTrash();
      console.log(`[HomePage] Empty trash result:`, result);
      if (result.errors.length > 0) {
        console.error(`[HomePage] Errors during empty trash:`, result.errors);
      }
    } catch (error) {
      console.error(`[HomePage] Failed to empty trash:`, error);
    } finally {
      setIsEmptyingTrash(false);
    }
  };

  // Loading state - no session yet
  if (!session) {
    return <HomePageSkeleton />;
  }

  // Empty state
  if (folders.length === 0) {
    return (
      <div className="flex h-full flex-col bg-zinc-50 dark:bg-black">
        {/* Header */}
        <div className="px-6 pt-4 pb-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsFilterOpen(true)}
              className="flex items-center gap-1.5 group -ml-2 px-2 py-1 min-h-11 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
            >
              <h1 className="text-xl font-normal text-zinc-900 dark:text-white tracking-tight">
                {getFilterLabel()}
              </h1>
              <ChevronDown
                size={20}
                className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors mt-0.5"
              />
            </button>

            <div className="flex items-center gap-1 ">
              <button
                onClick={handleCalendarToggle}
                className=" w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <Calendar size={20} strokeWidth={1.5} />
              </button>

            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-zinc-400 gap-4 p-8 bg-white dark:bg-black">
          <div className="p-4 bg-zinc-100 dark:bg-zinc-900 rounded-2xl">
            {activeFilter === "trash" ? (
              <Trash2 size={32} />
            ) : activeFilter === "archived" ? (
              <Archive size={32} />
            ) : activeView === "favorites" ? (
              <Star size={32} />
            ) : (
              <FolderOpen size={32} />
            )}
          </div>
          <div className="text-center max-w-sm">
            <p className="font-medium text-zinc-600 dark:text-zinc-400">
              {activeFilter === "trash"
                ? "Trash is empty"
                : activeFilter === "archived"
                  ? "No archived files"
                  : activeView === "favorites"
                    ? "No favorites yet"
                    : "No files yet"}
            </p>
            <p className="text-sm text-zinc-400 dark:text-zinc-600 mt-1">
              {activeFilter === "trash"
                ? "Files you delete will appear here."
                : activeFilter === "archived"
                  ? "Files you archive will appear here."
                  : activeView === "favorites"
                    ? "Mark files as favorites to see them here."
                    : "Notes and transcriptions will appear here once you start recording with your glasses connected."}
            </p>
            {activeFilter === "all" && activeView === "folders" && !isConnected && (
              <button
                onClick={reconnect}
                className="mt-4 px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Connect
              </button>
            )}
          </div>
        </div>

        <FilterDrawer
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
          activeFilter={activeFilter}
          activeView={activeView}
          onFilterChange={handleFilterChange}
          onViewChange={handleViewChange}
          counts={filterCounts}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-zinc-50 dark:bg-black overflow-hidden">
      {/* Header */}
      {viewMode === "calendar" ? (
        /* Calendar mode header — matches Settings page style */
        <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 py-3 bg-white dark:bg-zinc-950">
          <div className="flex items-center">
            <button
              onClick={handleCalendarToggle}
              className="p-2 -ml-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 transition-colors pl-6"
            >
              <ChevronLeft size={24} />
            </button>
            <h1 className="text-xl font-normal text-zinc-900 dark:text-white tracking-tight">
              Calendar
            </h1>
          </div>
        </div>
      ) : (
        /* List mode header — filter dropdown + actions */
        <div className="pt-4 pb-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setIsFilterOpen(true)}
              className="flex items-center gap-1.5 group  px-2 py-1 min-w-31 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors  pr-[20px] pl-6"
            >
              <h1 className="text-xl font-normal text-zinc-900 dark:text-white tracking-tight">
                {getFilterLabel()}
              </h1>
              <ChevronDown
                size={20}
                className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-200 transition-colors mt-0.5"
              />
            </button>

            <div className="flex items-center gap-1 ">
              {/* Empty Trash button - only shown when viewing trash */}
              {activeFilter === "trash" && filterCounts.trash > 0 && (
                <button
                  onClick={handleEmptyTrashClick}
                  disabled={isEmptyingTrash}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors disabled:opacity-50"
                >
                  {isEmptyingTrash ? (
                    <Loader2 size={20} strokeWidth={1.5} className="animate-spin" />
                  ) : (
                    <Trash2 size={20} strokeWidth={1.5} />
                  )}
                </button>
              )}

              <button
                onClick={handleCalendarToggle}
                className={clsx(" pr-6  py-2 pl-5", newMentraUI && "mr-[100px]")}
              >
                <Calendar size={20} strokeWidth={1.5} />
              </button>
{/*
              <button
                onClick={handleGlobalChat}
                className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
              >
                <motion.div
                  animate={{
                    filter: [
                      "drop-shadow(0px 0px 0px rgba(34, 197, 94, 0))",
                      "drop-shadow(0px 0px 6px rgba(34, 197, 94, 0.6))",
                      "drop-shadow(0px 0px 0px rgba(34, 197, 94, 0))",
                    ],
                    color: ["#71717a", "#22c55e", "#71717a"],
                  }}
                  transition={{
                    repeat: Infinity,
                    duration: 4,
                    ease: "easeInOut",
                  }}
                  className="text-current"
                >
                  <Sparkles size={20} strokeWidth={1.5} />
                </motion.div>
              </button> */}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={viewMode}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1, ease: "easeInOut" }}
            className="h-full"
          >
            {viewMode === "list" ? (
              <FolderList folders={folders} onSelectFolder={handleSelectFolder} />
            ) : (
              <CalendarView
                folders={folders}
                onSelectDate={(dateString) => setLocation(`/day/${dateString}`)}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Filter Drawer */}
      <FilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        activeFilter={activeFilter}
        activeView={activeView}
        onFilterChange={handleFilterChange}
        onViewChange={handleViewChange}
        counts={filterCounts}
      />

      {/* Global AI Chat */}
      <GlobalAIChat
        isOpen={showGlobalChat}
        onClose={() => setShowGlobalChat(false)}
      />

      {/* Empty Trash Confirmation */}
      <Drawer.Root
        open={showEmptyTrashConfirm}
        onOpenChange={(open) => !open && setShowEmptyTrashConfirm(false)}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
          <Drawer.Content className="bg-white dark:bg-zinc-900 flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-zinc-100 dark:border-zinc-800">
            {/* Handle */}
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700 mt-4 mb-2" />

            {/* Content */}
            <div className="px-6 pb-8 pt-4">
              <Drawer.Title className="text-lg font-semibold text-zinc-900 dark:text-white text-center">
                Empty Trash?
              </Drawer.Title>
              <Drawer.Description className="text-sm text-zinc-500 dark:text-zinc-400 text-center mt-3">
                You are about to permanently delete all {filterCounts.trash} items in trash.
                This will remove all transcripts, notes, and chat history.
                You will not be able to recover them.
              </Drawer.Description>

              {/* Actions */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowEmptyTrashConfirm(false)}
                  className="flex-1 py-3 rounded-xl font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmptyTrashConfirm}
                  className="flex-1 py-3 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  Delete All
                </button>
              </div>
            </div>

            {/* Safe area padding for mobile */}
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
