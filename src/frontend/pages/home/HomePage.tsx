/**
 * HomePage - Main landing page showing conversations
 *
 * Features:
 * - New Mentra Notes design with conversation-based list
 * - Filter pills (All / Today)
 * - List/Calendar view toggle
 * - FAB menu (Ask AI, Add note, Stop transcribing)
 * - Empty state with listening indicator
 * - Keeps all existing backend logic (filters, trash, archive, calendar)
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { ChevronLeft } from "lucide-react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, FileFilter, Conversation } from "../../../shared/types";
import type { DailyFolder } from "./components/FolderList";
import {
  FilterDrawer,
  type FilterType,
  type ViewType,
} from "../../components/shared/FilterDrawer";
import { CalendarView } from "./components/CalendarView";
import { GlobalAIChat } from "./components/GlobalAIChat";
import { ConversationList } from "./components/ConversationList";
import { FABMenu } from "./components/FABMenu";
import { TranscriptList } from "./components/TranscriptList";
import { Drawer } from "vaul";
import { HomePageSkeleton } from "../../components/shared/SkeletonLoader";

export function HomePage() {
  const { userId } = useMentraAuth();
  const { session, isConnected, reconnect } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const search = useSearch();

  // Local UI state
  const [isAllNotesView, setIsAllNotesView] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [showGlobalChat, setShowGlobalChat] = useState(false);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [timeFilter, setTimeFilter] = useState<"all" | "today">("all");
  const initialTab =
    new URLSearchParams(search).get("tab") === "transcripts"
      ? "transcripts"
      : ("conversations" as const);
  const [activeTimeFilter, setActiveTimeFilter] = useState<
    "conversations" | "transcripts"
  >(initialTab);
  // renderedFilter is what's actually shown — swaps after fade-out completes
  const [renderedFilter, setRenderedFilter] = useState<
    "conversations" | "transcripts"
  >(initialTab);
  const [tabOpacity, setTabOpacity] = useState(1);

  useEffect(() => {
    if (activeTimeFilter === renderedFilter) return;
    // Fade out
    setTabOpacity(0);
    const swap = setTimeout(() => {
      setRenderedFilter(activeTimeFilter);
      setTabOpacity(1);
    }, 150);
    return () => clearTimeout(swap);
  }, [activeTimeFilter]);

  // Derive data from session
  const files = session?.file?.files ?? [];
  const isRecording = session?.transcript?.isRecording ?? false;
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;
  const notes = session?.notes?.notes ?? [];
  const conversations = session?.conversation?.conversations ?? [];
  const isConversationsHydrated = session?.conversation?.isHydrated ?? false;
  const availableDates = session?.transcript?.availableDates ?? [];

  // Backend filter state
  const backendFilter = session?.file?.activeFilter ?? "all";
  const activeView: ViewType = isAllNotesView
    ? "all_notes"
    : backendFilter === "favourites"
      ? "favorites"
      : "folders";
  const activeFilter: FilterType =
    backendFilter === "favourites" ? "all" : (backendFilter as FilterType);

  // Transform FileData to DailyFolder format (kept for calendar view)
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

  const todayStr = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  const filteredConversations = useMemo(() => {
    if (timeFilter === "today") {
      return conversations.filter((c) => c.date === todayStr);
    }
    return conversations;
  }, [conversations, timeFilter, todayStr]);

  // Count today's conversations for subtitle
  const todayConversationCount = useMemo(() => {
    return conversations.filter((c) => c.date === todayStr).length;
  }, [conversations, todayStr]);

  // Filter counts
  const fileCounts = session?.file?.counts ?? {
    all: 0,
    archived: 0,
    trash: 0,
    favourites: 0,
  };
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

  // --- Handlers (all existing logic preserved) ---

  const handleFilterChange = async (filter: FilterType) => {
    setIsAllNotesView(false);
    const fileFilter: FileFilter =
      filter === "archived" ? "archived" : filter === "trash" ? "trash" : "all";
    if (session?.file) {
      await session.file.setFilter(fileFilter);
    }
  };

  const handleViewChange = async (view: ViewType) => {
    if (view === "all_notes") {
      setIsAllNotesView(true);
    } else if (view === "favorites") {
      setIsAllNotesView(false);
      if (session?.file) {
        await session.file.setFilter("favourites");
      }
    } else {
      setIsAllNotesView(false);
    }
  };

  const handleSelectConversation = useCallback((conversation: Conversation) => {
    setLocation(`/conversation/${conversation.id}`);
  }, [setLocation]);

  const handleGlobalChat = () => {
    setShowGlobalChat(true);
  };

  const handleAddNote = async () => {
    if (!session?.notes?.createManualNote) return;
    const note = await session.notes.createManualNote("", "");
    if (note?.id) {
      setLocation(`/note/${note.id}`);
    }
  };

  const handleStopTranscribing = () => {
    session?.settings?.updateSettings({ transcriptionPaused: true });
  };

  const handleResumeTranscribing = () => {
    session?.settings?.updateSettings({ transcriptionPaused: false });
  };

  const handleCalendarToggle = async () => {
    if (viewMode === "list") {
      setIsAllNotesView(false);
      if (session?.file) {
        await session.file.setFilter("all");
      }
      setViewMode("calendar");
    } else {
      setViewMode("list");
    }
  };

  const handleEmptyTrashConfirm = async () => {
    if (!session?.file) return;
    setShowEmptyTrashConfirm(false);
    try {
      const result = await session.file.emptyTrash();
      console.log(`[HomePage] Empty trash result:`, result);
      if (result.errors.length > 0) {
        console.error(`[HomePage] Errors during empty trash:`, result.errors);
      }
    } catch (error) {
      console.error(`[HomePage] Failed to empty trash:`, error);
    }
  };

  const handleArchiveConversation = useCallback(async (conversation: Conversation) => {
    if (session?.file) {
      await session.file.archiveFile(conversation.date);
    }
  }, [session?.file]);

  const handleDeleteConversation = useCallback(async (conversation: Conversation) => {
    if (session?.conversation) {
      await session.conversation.deleteConversation(conversation.id);
    }
  }, [session?.conversation]);

  // --- Loading state ---
  if (!session) {
    return <HomePageSkeleton />;
  }

  // --- Empty state (no conversations) ---
  if (isConversationsHydrated && conversations.length === 0) {
    return (
      <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col pt-6 gap-2 px-6">
          <div className="flex items-center gap-2">
            <div
              className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold`}
            >
              Mentra Notes
            </div>
            <div className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? 'bg-[#FEF2F2]' : 'bg-[#F5F5F4]'}`}>
              <div className={`shrink-0 rounded-full size-1.75 ${isMicActive ? 'bg-[#DC2626] animate-pulse' : 'bg-[#A8A29E]'}`} />
              {isMicActive ? (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </div>
          </div>
          <div
            className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold`}
          >
            Conversations
          </div>
          <div
            className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}
          >
            No conversations yet
          </div>
        </div>

        {/* Center content */}
        <div className="flex flex-col items-center justify-center grow px-10 gap-4">
          <div className="flex items-center justify-center shrink-0 rounded-[20px] bg-[#F5F5F4] size-16">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                stroke="#A8A29E"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div
            className={`text-[18px] leading-[22px] text-center text-[#1C1917] font-red-hat font-bold`}
          >
            Start a conversation
          </div>
          <div
            className={`text-[14px] leading-5 text-center text-[#A8A29E] font-red-hat`}
          >
            Mentra Notes is listening in the background. When it detects a
            conversation, it will appear here.
          </div>
          {isRecording && (
            <div className="flex items-center mt-1 rounded-[20px] py-2 px-4 gap-2 bg-[#FEF2F2]">
              <div className="shrink-0 rounded-sm bg-[#EF4444] size-2 animate-pulse" />
              <div
                className={`text-[13px] leading-4 text-[#DB2627] font-red-hat font-medium`}
              >
                Microphone active · Listening
              </div>
            </div>
          )}
          {!isConnected && (
            <button
              onClick={reconnect}
              className={`mt-2 px-5 py-2.5 bg-[#1C1917] text-[#FAFAF9] rounded-xl text-[14px] font-red-hat font-semibold`}
            >
              Connect
            </button>
          )}
        </div>

        {/* Top-right menu */}

        {/* FAB */}
        <FABMenu
          transcriptionPaused={transcriptionPaused}
          onAskAI={handleGlobalChat}
          onAddNote={handleAddNote}
          onStopTranscribing={handleStopTranscribing}
          onResumeTranscribing={handleResumeTranscribing}
        />

        {/* Global AI Chat */}
        <GlobalAIChat
          isOpen={showGlobalChat}
          onClose={() => setShowGlobalChat(false)}
        />

        {/* Filter Drawer (still needed for filter-based empty states) */}
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

  // --- Calendar view ---
  if (viewMode === "calendar") {
    return (
      <div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
        <div className="shrink-0 border-b border-[#E7E5E4] py-3 bg-[#FAFAF9]">
          <div className="flex items-center">
            <button
              onClick={handleCalendarToggle}
              className="p-2 -ml-2 min-w-11 min-h-11 flex items-center justify-center pl-6"
            >
              <ChevronLeft size={24} className="text-[#78716C]" />
            </button>
            <h1
              className={`text-xl text-[#1C1917] font-red-hat font-bold tracking-tight`}
            >
              Calendar
            </h1>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <CalendarView
            folders={folders}
            conversations={conversations}
            notes={notes}
            onSelectDate={() => {}}
          />
        </div>
      </div>
    );
  }

  // --- Populated state (conversations list) ---
  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-3 px-6 shrink-0" style={{ opacity: tabOpacity, transition: "opacity 0.15s ease-in-out" }}>
        <div className="flex items-center  gap-2">
          <div
            className={`text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-red-hat font-bold`}
          >
            Mentra Notes
          </div>
          <div className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? 'bg-[#FEF2F2]' : 'bg-[#F5F5F4]'}`}>
            <div className={`shrink-0 rounded-full size-1.75 ${isMicActive ? 'bg-[#DC2626] animate-pulse' : 'bg-[#A8A29E]'}`} />
            {isMicActive ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-0.5">
            <div
              className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold`}
            >
              {renderedFilter === "conversations" ? "Conversations" : "Transcripts"}
            </div>
            {renderedFilter === "conversations" && todayConversationCount > 0 && (
              <div className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}>
                Today · {todayConversationCount}{" "}
                {todayConversationCount === 1 ? "conversation" : "conversations"}
              </div>
            )}
            {renderedFilter === "transcripts" && availableDates.length > 0 && (
              <div className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}>
                {availableDates.length}{" "}
                {availableDates.length === 1 ? "day" : "days"} recorded
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Filter button */}
            <button
              onClick={() => setIsFilterOpen(true)}
              className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#F5F5F4] shrink-0"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"
                  stroke="#78716C"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {/* Conversations / Transcripts toggle */}
            <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
              {/* Conversations */}
              <button
                onClick={() => setActiveTimeFilter("conversations")}
                className={`flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 ${renderedFilter === "conversations" ? "bg-[#1C1917]" : ""}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={renderedFilter === "conversations" ? "#FAFAF9" : "#78716C"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              {/* Transcripts */}
              <button
                onClick={() => setActiveTimeFilter("transcripts")}
                className={`flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 ${renderedFilter === "transcripts" ? "bg-[#1C1917]" : ""}`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={renderedFilter === "transcripts" ? "#FAFAF9" : "#78716C"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6" />
                  <path d="M4 2h10" />
                  <rect x="4" y="18" width="16" height="4" rx="1" />
                  <rect x="4" y="6" width="16" height="4" rx="1" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      {renderedFilter === "conversations" && (
      <div className="flex items-center pt-4 gap-2 px-6 shrink-0" style={{ opacity: tabOpacity, transition: "opacity 0.15s ease-in-out" }}>
        <button
          onClick={() => setTimeFilter("all")}
          className={`flex items-center rounded-[20px] py-[7px] px-4 ${
            timeFilter === "all"
              ? "bg-[#1C1917]"
              : "bg-[#F5F5F4]"
          }`}
        >
          <span
            className={`text-[13px] leading-4 font-red-hat ${
              timeFilter === "all"
                ? "text-[#FAFAF9] font-semibold"
                : "text-[#78716C] font-medium"
            }`}
          >
            All
          </span>
        </button>
        <button
          onClick={() => setTimeFilter("today")}
          className={`flex items-center rounded-[20px] py-[7px] px-4 ${
            timeFilter === "today" ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
          }`}
        >
          <span
            className={`text-[13px] leading-4 font-red-hat ${
              timeFilter === "today"
                ? "text-[#FAFAF9] font-semibold"
                : "text-[#78716C] font-medium"
            }`}
          >
            Today
          </span>
        </button>
      </div>
      )}

      {/* Content area — single wrapper fades out/in on tab switch */}
      <div className="flex-1 overflow-hidden">
        <div
          className="h-full"
          style={{
            opacity: tabOpacity,
            transition: "opacity 0.15s ease-in-out",
          }}
        >
          {renderedFilter === "transcripts" ? (
            <div className="h-full overflow-y-auto px-6 pb-32">
              <TranscriptList
                availableDates={availableDates}
                files={files}
                isRecording={isRecording}
                transcriptionPaused={transcriptionPaused}
                onSelect={(dateStr) => setLocation(`/transcript/${dateStr}`)}
              />
            </div>
          ) : (
            <ConversationList
              conversations={filteredConversations}
              onSelectConversation={handleSelectConversation}
              onArchive={handleArchiveConversation}
              onDelete={handleDeleteConversation}
            />
          )}
        </div>
      </div>

      {/* FAB */}
      <FABMenu
        transcriptionPaused={transcriptionPaused}
        onAskAI={handleGlobalChat}
        onAddNote={handleAddNote}
        onStopTranscribing={handleStopTranscribing}
        onResumeTranscribing={handleResumeTranscribing}
      />

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
          <Drawer.Content className="bg-white flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-[#E7E5E4]">
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-[#D6D3D1] mt-4 mb-2" />
            <div className="px-6 pb-8 pt-4">
              <Drawer.Title
                className={`text-lg font-semibold text-[#1C1917] text-center font-red-hat`}
              >
                Empty Trash?
              </Drawer.Title>
              <Drawer.Description
                className={`text-sm text-[#A8A29E] text-center mt-3 font-red-hat`}
              >
                You are about to permanently delete all {filterCounts.trash}{" "}
                items in trash. This will remove all transcripts, notes, and
                chat history. You will not be able to recover them.
              </Drawer.Description>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowEmptyTrashConfirm(false)}
                  className={`flex-1 py-3 rounded-xl font-medium bg-[#F5F5F4] text-[#78716C] font-red-hat`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmptyTrashConfirm}
                  className={`flex-1 py-3 rounded-xl font-medium bg-[#DC2626] text-white font-red-hat`}
                >
                  Delete All
                </button>
              </div>
            </div>
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}

/** Top-right overflow/minimize menu (from Paper design) */
