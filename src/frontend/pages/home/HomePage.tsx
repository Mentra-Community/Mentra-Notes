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

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
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
import { TabBar } from "./components/TabBar";
import { Drawer } from "vaul";
import { HomePageSkeleton } from "../../components/shared/SkeletonLoader";

const FONT = "font-['Red_Hat_Display',system-ui,sans-serif]";

export function HomePage() {
  const { userId } = useMentraAuth();
  const { session, isConnected, reconnect } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();

  // Local UI state
  const [isAllNotesView, setIsAllNotesView] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [showGlobalChat, setShowGlobalChat] = useState(false);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [activeTimeFilter, setActiveTimeFilter] = useState<"all" | "today">("all");

  // Derive data from session
  const files = session?.file?.files ?? [];
  const isRecording = session?.transcript?.isRecording ?? false;
  const notes = session?.notes?.notes ?? [];
  const conversations = session?.conversation?.conversations ?? [];

  // Backend filter state
  const backendFilter = session?.file?.activeFilter ?? "all";
  const activeView: ViewType = isAllNotesView
    ? "all_notes"
    : backendFilter === "favourites"
      ? "favorites"
      : "folders";
  const activeFilter: FilterType = backendFilter === "favourites" ? "all" : backendFilter as FilterType;

  console.log(`[HomePage] Render - backendFilter: ${backendFilter}, activeView: ${activeView}, conversations: ${conversations.length}`);

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

  // Filter conversations by time filter
  const filteredConversations = useMemo(() => {
    if (activeTimeFilter === "today") {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      return conversations.filter((c) => c.date === todayStr);
    }
    return conversations;
  }, [conversations, activeTimeFilter]);

  // Count today's conversations for subtitle
  const todayConversationCount = useMemo(() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return conversations.filter((c) => c.date === todayStr).length;
  }, [conversations]);

  // Filter counts
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

  const handleTabNavigate = (tab: "conversations" | "search" | "notes" | "settings") => {
    switch (tab) {
      case "search":
        setLocation("/search");
        break;
      case "notes":
        // Navigate to today's day page (notes tab)
        const now = new Date();
        const todayStr2 = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        setLocation(`/day/${todayStr2}`);
        break;
      case "settings":
        setLocation("/settings");
        break;
      // "conversations" = already here
    }
  };

  const handleSelectConversation = (conversation: Conversation) => {
    // Navigate to the day page for this conversation's date
    setLocation(`/day/${conversation.date}`);
  };

  const handleGlobalChat = () => {
    setShowGlobalChat(true);
  };

  const handleAddNote = () => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setLocation(`/day/${todayStr}`);
  };

  const handleStopTranscribing = () => {
    // stopRecording RPC not available on TranscriptManagerI yet — no-op for now
    console.log("[HomePage] Stop transcribing requested (not yet implemented)");
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

  const handleArchiveConversation = async (conversation: Conversation) => {
    if (session?.file) {
      await session.file.archiveFile(conversation.date);
    }
  };

  const handleDeleteConversation = async (conversation: Conversation) => {
    if (session?.conversation) {
      await session.conversation.deleteConversation(conversation.id);
    }
  };

  // --- Loading state ---
  if (!session) {
    return <HomePageSkeleton />;
  }

  // --- Empty state (no conversations) ---
  if (conversations.length === 0) {
    return (
      <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col pt-6 gap-2 px-6">
          <div className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] ${FONT} font-bold`}>
            Mentra Notes
          </div>
          <div className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] ${FONT} font-extrabold`}>
            Conversations
          </div>
          <div className={`text-[14px] leading-[18px] text-[#A8A29E] ${FONT}`}>
            No conversations yet
          </div>
        </div>

        {/* Center content */}
        <div className="flex flex-col items-center justify-center grow px-10 gap-4">
          <div className="flex items-center justify-center shrink-0 rounded-[20px] bg-[#F5F5F4] size-16">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#A8A29E" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className={`text-[18px] leading-[22px] text-center text-[#1C1917] ${FONT} font-bold`}>
            Start a conversation
          </div>
          <div className={`text-[14px] leading-5 text-center text-[#A8A29E] ${FONT}`}>
            Mentra Notes is listening in the background. When it detects a conversation, it will appear here.
          </div>
          {isRecording && (
            <div className="flex items-center mt-1 rounded-[20px] py-2 px-4 gap-2 bg-[#FEF2F2]">
              <div className="shrink-0 rounded-sm bg-[#EF4444] size-2 animate-pulse" />
              <div className={`text-[13px] leading-4 text-[#DB2627] ${FONT} font-medium`}>
                Microphone active · Listening
              </div>
            </div>
          )}
          {!isConnected && (
            <button
              onClick={reconnect}
              className={`mt-2 px-5 py-2.5 bg-[#1C1917] text-[#FAFAF9] rounded-xl text-[14px] ${FONT} font-semibold`}
            >
              Connect
            </button>
          )}
        </div>

        {/* Top-right menu */}

        {/* FAB */}
        <FABMenu
          isRecording={isRecording}
          onAskAI={handleGlobalChat}
          onAddNote={handleAddNote}
          onStopTranscribing={handleStopTranscribing}
        />

        {/* Global AI Chat */}
        <GlobalAIChat isOpen={showGlobalChat} onClose={() => setShowGlobalChat(false)} />

        {/* Tab Bar */}
        <TabBar activeTab="conversations" onNavigate={handleTabNavigate} />

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
            <h1 className={`text-xl text-[#1C1917] ${FONT} font-bold tracking-tight`}>
              Calendar
            </h1>
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <CalendarView
            folders={folders}
            onSelectDate={(dateString) => setLocation(`/day/${dateString}`)}
          />
        </div>
        <TabBar activeTab="conversations" onNavigate={handleTabNavigate} />
      </div>
    );
  }

  // --- Populated state (conversations list) ---
  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-3 px-6 shrink-0">
        <div className={`text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] ${FONT} font-bold`}>
          Mentra Notes
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            <div className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] ${FONT} font-extrabold`}>
              Conversations
            </div>
            {todayConversationCount > 0 && (
              <div className={`text-[14px] leading-[18px] text-[#A8A29E] ${FONT}`}>
                Today · {todayConversationCount} {todayConversationCount === 1 ? "conversation" : "conversations"}
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
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* List/Calendar toggle */}
            <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
              {/* List view (active) */}
              <button
                className="flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 bg-[#1C1917]"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="3" y1="6" x2="21" y2="6" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="12" x2="21" y2="12" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  <line x1="3" y1="18" x2="21" y2="18" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
              {/* Calendar view (inactive) */}
              <button
                onClick={handleCalendarToggle}
                className="flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="4" width="18" height="18" rx="2" stroke="#78716C" strokeWidth="2" />
                  <line x1="3" y1="10" x2="21" y2="10" stroke="#78716C" strokeWidth="2" />
                  <line x1="8" y1="2" x2="8" y2="6" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  <line x1="16" y1="2" x2="16" y2="6" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center pt-4 gap-2 px-6 shrink-0">
        <button
          onClick={() => setActiveTimeFilter("all")}
          className={`flex items-center rounded-[20px] py-[7px] px-4 ${
            activeTimeFilter === "all" ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
          }`}
        >
          <span
            className={`text-[13px] leading-4 ${FONT} ${
              activeTimeFilter === "all" ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
            }`}
          >
            All
          </span>
        </button>
        <button
          onClick={() => setActiveTimeFilter("today")}
          className={`flex items-center rounded-[20px] py-[7px] px-4 ${
            activeTimeFilter === "today" ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
          }`}
        >
          <span
            className={`text-[13px] leading-4 ${FONT} ${
              activeTimeFilter === "today" ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
            }`}
          >
            Today
          </span>
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-hidden">
        <ConversationList
          conversations={filteredConversations}
          onSelectConversation={handleSelectConversation}
          onArchive={handleArchiveConversation}
          onDelete={handleDeleteConversation}
        />
      </div>



      {/* FAB */}
      <FABMenu
        isRecording={isRecording}
        onAskAI={handleGlobalChat}
        onAddNote={handleAddNote}
        onStopTranscribing={handleStopTranscribing}
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

      {/* Tab Bar */}
      <TabBar activeTab="conversations" onNavigate={handleTabNavigate} />

      {/* Global AI Chat */}
      <GlobalAIChat isOpen={showGlobalChat} onClose={() => setShowGlobalChat(false)} />

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
              <Drawer.Title className={`text-lg font-semibold text-[#1C1917] text-center ${FONT}`}>
                Empty Trash?
              </Drawer.Title>
              <Drawer.Description className={`text-sm text-[#A8A29E] text-center mt-3 ${FONT}`}>
                You are about to permanently delete all {filterCounts.trash} items in trash.
                This will remove all transcripts, notes, and chat history.
                You will not be able to recover them.
              </Drawer.Description>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowEmptyTrashConfirm(false)}
                  className={`flex-1 py-3 rounded-xl font-medium bg-[#F5F5F4] text-[#78716C] ${FONT}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleEmptyTrashConfirm}
                  className={`flex-1 py-3 rounded-xl font-medium bg-[#DC2626] text-white ${FONT}`}
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

