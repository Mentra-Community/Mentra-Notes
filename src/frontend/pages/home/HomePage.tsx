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

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { ChevronLeft } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useSynced } from "../../hooks/useSynced";
import { useMultiSelect } from "../../hooks/useMultiSelect";
import type { SessionI, Conversation } from "../../../shared/types";
import type { DailyFolder } from "./components/FolderList";
import {
  ConversationFilterDrawer,
  type SortBy,
  type DateRange,
  type ShowFilter,
} from "../../components/shared/ConversationFilterDrawer";
import { CalendarView } from "./components/CalendarView";
import { GlobalAIChat } from "./components/GlobalAIChat";
import { ConversationList } from "./components/ConversationList";
import { FABMenu } from "./components/FABMenu";
import { TranscriptList } from "./components/TranscriptList";
import { Drawer } from "vaul";
import { HomePageSkeleton } from "../../components/shared/SkeletonLoader";
import { LoadingState } from "../../components/shared/LoadingState";
import { SelectionHeader } from "../../components/shared/SelectionHeader";
import { MultiSelectBar, type MultiSelectAction, ExportIcon, FavoriteIcon, DeleteIcon } from "../../components/shared/MultiSelectBar";
import { ExportDrawer, type ExportOptions } from "../../components/shared/ExportDrawer";
import { EmailDrawer } from "../../components/shared/EmailDrawer";

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
  const [convSortBy, setConvSortBy] = useState<SortBy>("recent");
  const [convDateRange, setConvDateRange] = useState<DateRange>("all");
  const [convShowFilter, setConvShowFilter] = useState<ShowFilter>("all");
  const [convCustomStart, setConvCustomStart] = useState<string | undefined>();
  const [convCustomEnd, setConvCustomEnd] = useState<string | undefined>();
  const [filterLoading, setFilterLoading] = useState(false);
  const filterLoadingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Multi-select state (one for conversations, one for transcripts)
  const convSelect = useMultiSelect();
  const transcriptSelect = useMultiSelect();
  const [showConvExportDrawer, setShowConvExportDrawer] = useState(false);
  const [showTranscriptExportDrawer, setShowTranscriptExportDrawer] = useState(false);
  const [showConvEmailDrawer, setShowConvEmailDrawer] = useState(false);
  const [pendingConvExportOptions, setPendingConvExportOptions] = useState<ExportOptions | null>(null);
  const [showTranscriptEmailDrawer, setShowTranscriptEmailDrawer] = useState(false);
  const pendingTranscriptTextRef = useRef("");
  const pendingTranscriptDatesRef = useRef<string[]>([]);
  const [showTranscriptDeleteConfirm, setShowTranscriptDeleteConfirm] = useState(false);
  const [transcriptDeleteWarning, setTranscriptDeleteWarning] = useState("");

  // Derive data from session
  const files = session?.file?.files ?? [];
  const isRecording = session?.transcript?.isRecording ?? false;
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;
  const notes = session?.notes?.notes ?? [];
  const conversations = session?.conversation?.conversations ?? [];
  const isConversationsHydrated = session?.conversation?.isHydrated ?? false;
  const availableDates = session?.transcript?.availableDates ?? [];

  // Backend filter state (used by filterCounts)

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
    let result = [...conversations];

    // Time filter (today tab)
    if (timeFilter === "today") {
      result = result.filter((c) => c.date === todayStr);
    }

    // Date range filter
    if (convDateRange === "custom" && convCustomStart && convCustomEnd) {
      const start = new Date(convCustomStart + "T00:00:00").getTime();
      const end = new Date(convCustomEnd + "T23:59:59").getTime();
      result = result.filter((c) => {
        const t = new Date(c.startTime).getTime();
        return t >= start && t <= end;
      });
    } else if (convDateRange !== "all") {
      const now = new Date();
      let cutoff: Date;
      if (convDateRange === "today") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (convDateRange === "week") {
        cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      } else {
        cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      }
      result = result.filter(
        (c) => new Date(c.startTime).getTime() >= cutoff.getTime(),
      );
    }

    // Show filter
    if (convShowFilter === "favourites") {
      result = result.filter((c) => c.isFavourite);
    } else if (convShowFilter === "archived") {
      result = result.filter((c) => c.isArchived);
    } else if (convShowFilter === "trash") {
      result = result.filter((c) => c.isTrashed);
    } else {
      // "all" — hide archived and trashed
      result = result.filter((c) => !c.isTrashed && !c.isArchived);
    }

    // Sort
    if (convSortBy === "oldest") {
      result.sort(
        (a, b) =>
          new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
      );
    } else {
      result.sort(
        (a, b) =>
          new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
      );
    }

    return result;
  }, [
    conversations,
    timeFilter,
    todayStr,
    convDateRange,
    convShowFilter,
    convSortBy,
    convCustomStart,
    convCustomEnd,
  ]);

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

  const handleSelectConversation = useCallback(
    (conversation: Conversation) => {
      setLocation(`/conversation/${conversation.id}`);
    },
    [setLocation],
  );

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
    setShowEmptyTrashConfirm(false);
    try {
      // Empty conversation trash
      if (session?.conversation?.emptyTrash) {
        const count = await session.conversation.emptyTrash();
        console.log(`[HomePage] Deleted ${count} trashed conversations`);
      }
      // Empty file trash
      if (session?.file?.emptyTrash) {
        const result = await session.file.emptyTrash();
        console.log(`[HomePage] Empty file trash result:`, result);
      }
    } catch (error) {
      console.error(`[HomePage] Failed to empty trash:`, error);
    }
  };

  const trashedConversationCount = useMemo(() => {
    return conversations.filter((c) => c.isTrashed).length;
  }, [conversations]);

  const pendingFilterRef = useRef<{
    sortBy: SortBy;
    dateRange: DateRange;
    showFilter: ShowFilter;
    customStart?: string;
    customEnd?: string;
  } | null>(null);

  const handleFilterApply = useCallback(
    ({
      sortBy,
      dateRange,
      showFilter,
      customStart,
      customEnd,
    }: {
      sortBy: SortBy;
      dateRange: DateRange;
      showFilter: ShowFilter;
      customStart?: string;
      customEnd?: string;
    }) => {
      setIsFilterOpen(false);

      // Store pending filter, show spinner first
      pendingFilterRef.current = {
        sortBy,
        dateRange,
        showFilter,
        customStart,
        customEnd,
      };
      setFilterLoading(true);

      if (filterLoadingRef.current) clearTimeout(filterLoadingRef.current);
      filterLoadingRef.current = setTimeout(() => {
        // Apply the actual filter changes after spinner
        const pending = pendingFilterRef.current;
        if (pending) {
          setConvSortBy(pending.sortBy);
          setConvDateRange(pending.dateRange);
          setConvShowFilter(pending.showFilter);
          setConvCustomStart(pending.customStart);
          setConvCustomEnd(pending.customEnd);
          pendingFilterRef.current = null;
        }
        setFilterLoading(false);
      }, 1000);
    },
    [],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (filterLoadingRef.current) clearTimeout(filterLoadingRef.current);
    };
  }, []);

  const handleArchiveConversation = useCallback(
    async (conversation: Conversation) => {
      if (session?.conversation) {
        if (conversation.isArchived) {
          await session.conversation.unarchiveConversation(conversation.id);
        } else {
          await session.conversation.archiveConversation(conversation.id);
        }
      }
    },
    [session?.conversation],
  );

  const handleDeleteConversation = useCallback(
    async (conversation: Conversation) => {
      if (session?.conversation) {
        if (conversation.isTrashed) {
          await session.conversation.deleteConversation(conversation.id);
        } else {
          await session.conversation.trashConversation(conversation.id);
        }
      }
    },
    [session?.conversation],
  );

  // Exit selection on tab/filter change
  useEffect(() => {
    convSelect.cancel();
  }, [timeFilter, convShowFilter]);

  useEffect(() => {
    convSelect.cancel();
    transcriptSelect.cancel();
  }, [renderedFilter]);

  // ── Conversation multi-select handlers ──

  const handleConvBatchFavourite = useCallback(async () => {
    if (!session?.conversation) return;
    const selectedConvs = filteredConversations.filter((c) => convSelect.selectedIds.has(c.id));
    const allFav = selectedConvs.every((c) => c.isFavourite);
    for (const conv of selectedConvs) {
      if (allFav) {
        await session.conversation.unfavouriteConversation(conv.id);
      } else if (!conv.isFavourite) {
        await session.conversation.favouriteConversation(conv.id);
      }
    }
    convSelect.cancel();
  }, [session, convSelect, filteredConversations]);

  const handleConvBatchTrash = useCallback(async () => {
    if (!session?.conversation) return;
    for (const id of convSelect.selectedIds) {
      await session.conversation.trashConversation(id);
    }
    convSelect.cancel();
  }, [session, convSelect]);

  /** Build plain text for clipboard export */
  const buildConvExportText = useCallback(async (options: ExportOptions) => {
    const selectedConvs = filteredConversations.filter((c) => convSelect.selectedIds.has(c.id));
    const textParts: string[] = [];

    for (const conv of selectedConvs) {
      const parts: string[] = [];

      const startDate = new Date(conv.startTime);
      const dateLabel = startDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const startTimeLabel = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const endTimeLabel = conv.endTime
        ? new Date(conv.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "ongoing";
      const durationMin = conv.endTime
        ? Math.round((new Date(conv.endTime).getTime() - startDate.getTime()) / 60000)
        : null;

      if (options.includeContent) {
        let meta = `Date: ${dateLabel}\nTime: ${startTimeLabel} – ${endTimeLabel}`;
        if (durationMin !== null) meta += ` (${durationMin} min)`;
        parts.push(`# ${conv.title || "Untitled Conversation"}\n${meta}\n\n${conv.aiSummary || conv.runningSummary || "No summary"}`);
      }

      if (options.includeTranscript) {
        let transcriptText = "";
        try {
          if (session?.conversation?.loadConversationSegments) {
            const segments = await session.conversation.loadConversationSegments(conv.id);
            if (segments && segments.length > 0) {
              transcriptText = segments
                .map((s) => {
                  const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return `[${time}] ${s.text}`;
                })
                .join("\n");
            }
          }
        } catch { /* fallback below */ }
        if (!transcriptText && conv.chunks && conv.chunks.length > 0) {
          transcriptText = conv.chunks.map((c) => c.text).join("\n\n");
        }
        if (transcriptText) parts.push(`\n## Transcript\n${transcriptText}`);
      }

      if (options.includeLinkedNote && conv.noteId) {
        const linkedNote = notes.find((n) => n.id === conv.noteId);
        if (linkedNote) {
          const noteContent = (linkedNote.content || "")
            .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
          const noteCreated = linkedNote.createdAt
            ? new Date(linkedNote.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
            : "";
          parts.push(`\n## AI Note: ${linkedNote.title || "Untitled Note"}${noteCreated ? `\nGenerated: ${noteCreated}` : ""}\n\n${noteContent}`);
        }
      }

      if (parts.length > 0) textParts.push(parts.join("\n"));
    }
    return textParts.join("\n\n---\n\n");
  }, [filteredConversations, convSelect.selectedIds, notes, session]);

  const handleConvBatchExport = useCallback(async (options: ExportOptions) => {
    if (options.destination === "email") {
      setPendingConvExportOptions(options);
      setShowConvEmailDrawer(true);
      return;
    }

    // Clipboard
    const text = await buildConvExportText(options);
    await navigator.clipboard.writeText(text);
    convSelect.cancel();
  }, [convSelect, buildConvExportText]);

  const handleConvEmailSend = useCallback(async (to: string, cc: string) => {
    const selectedConvs = filteredConversations.filter((c) => convSelect.selectedIds.has(c.id));
    if (selectedConvs.length === 0) return;
    const options = pendingConvExportOptions;

    // Build notes array from conversations (using linked AI notes as the email note cards)
    const emailNotes: Array<{
      noteId: string;
      noteTimestamp: string;
      noteTitle: string;
      noteContent: string;
      noteType: string;
    }> = [];

    for (const conv of selectedConvs) {
      const startDate = new Date(conv.startTime);
      const timestamp = startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      // Build content parts based on toggled options
      const contentParts: string[] = [];

      if (options?.includeContent) {
        contentParts.push(conv.aiSummary || conv.runningSummary || "No summary available");
      }

      if (options?.includeTranscript && conv.chunks && conv.chunks.length > 0) {
        const transcriptText = conv.chunks.map((c) => c.text).join("\n\n");
        contentParts.push(`<h3>Transcript</h3><p>${transcriptText.replace(/\n/g, "<br/>")}</p>`);
      }

      if (options?.includeLinkedNote && conv.noteId) {
        const linkedNote = notes.find((n) => n.id === conv.noteId);
        if (linkedNote) {
          contentParts.push(`<h3>AI Note: ${linkedNote.title || "Untitled"}</h3>${linkedNote.content || ""}`);
        }
      }

      if (contentParts.length > 0) {
        emailNotes.push({
          noteId: conv.noteId || conv.id,
          noteTimestamp: timestamp,
          noteTitle: conv.title || "Untitled Conversation",
          noteContent: contentParts.join("<hr/>"),
          noteType: "Conversation",
        });
      }
    }

    if (emailNotes.length === 0) return;

    const firstConv = selectedConvs[0];
    const sessionDate = new Date(firstConv.startTime).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const startTime = new Date(firstConv.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const endTime = firstConv.endTime
      ? new Date(firstConv.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";

    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;

    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        cc: ccList,
        sessionDate,
        sessionStartTime: startTime,
        sessionEndTime: endTime,
        notes: emailNotes,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
    convSelect.cancel();
  }, [filteredConversations, convSelect, notes, pendingConvExportOptions]);

  const convSelectActions = useMemo((): MultiSelectAction[] => {
    const actions: MultiSelectAction[] = [
      { icon: <ExportIcon />, label: "Export", onClick: () => setShowConvExportDrawer(true) },
      { icon: <FavoriteIcon />, label: "Favorite", onClick: handleConvBatchFavourite },
    ];
    if (convShowFilter !== "trash") {
      actions.push({ icon: <DeleteIcon />, label: "Trash", onClick: handleConvBatchTrash, variant: "danger" });
    }
    return actions;
  }, [handleConvBatchFavourite, handleConvBatchTrash, convShowFilter]);

  const convExportLabel = useMemo(() => {
    if (convSelect.count === 1) {
      const conv = filteredConversations.find((c) => convSelect.selectedIds.has(c.id));
      return conv?.title || "Untitled Conversation";
    }
    return `${convSelect.count} conversations selected`;
  }, [convSelect.count, convSelect.selectedIds, filteredConversations]);

  const convMissingNoteCount = useMemo(() => {
    const selectedConvs = filteredConversations.filter((c) => convSelect.selectedIds.has(c.id));
    return selectedConvs.filter((c) => !c.noteId).length;
  }, [convSelect.selectedIds, filteredConversations]);

  // ── Transcript multi-select handlers ──

  const handleTranscriptBatchExport = useCallback(async (options: ExportOptions) => {
    if (!session?.transcript) return;

    const selectedDates = [...transcriptSelect.selectedIds];
    const textParts: string[] = [];

    for (const dateStr of selectedDates) {
      try {
        const result = await session.transcript.loadDateTranscript(dateStr);
        if (result?.segments && result.segments.length > 0) {
          const [year, month, day] = dateStr.split("-").map(Number);
          const dateObj = new Date(year, month - 1, day);
          const dateLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

          const segmentLines = result.segments.map((s) => {
            const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `[${time}] ${s.text}`;
          }).join("\n");

          textParts.push(`# Transcript — ${dateLabel}\n${segmentLines}`);
        }
      } catch (err) {
        console.error(`Failed to load transcript for ${dateStr}:`, err);
      }
    }

    const text = textParts.join("\n\n---\n\n");

    if (options.destination === "email") {
      // Store text for email handler, open email drawer
      pendingTranscriptTextRef.current = text;
      pendingTranscriptDatesRef.current = selectedDates;
      setShowTranscriptEmailDrawer(true);
      return;
    }

    await navigator.clipboard.writeText(text);
    transcriptSelect.cancel();
  }, [transcriptSelect, session]);

  const handleTranscriptEmailSend = useCallback(async (to: string, cc: string) => {
    const dates = pendingTranscriptDatesRef.current;
    if (dates.length === 0 || !session?.transcript) return;

    // Build one note card per date so each transcript day is its own section
    const emailNotes: Array<{
      noteId: string;
      noteTimestamp: string;
      noteTitle: string;
      noteContent: string;
      noteType: string;
    }> = [];

    let sessionDate = "";
    let firstStart = "";
    let lastEnd = "";

    for (const dateStr of dates) {
      const result = await session.transcript.loadDateTranscript(dateStr);
      if (!result?.segments?.length) continue;

      const [year, month, day] = dateStr.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dateLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      if (!sessionDate) sessionDate = dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const segmentLines = result.segments.map((s) => {
        const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        if (!firstStart) firstStart = time;
        lastEnd = time;
        return `<tr><td style="color:#A8A29E;font-size:13px;padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;">${time}</td><td style="color:#1C1917;font-size:14px;line-height:21px;padding:4px 0;">${s.text}</td></tr>`;
      }).join("");

      const segCount = result.segments.length;
      const startTime = new Date(result.segments[0].timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const endTime = new Date(result.segments[result.segments.length - 1].timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      emailNotes.push({
        noteId: `transcript-${dateStr}`,
        noteTimestamp: `${startTime} — ${endTime}`,
        noteTitle: dateLabel,
        noteContent: `<p style="margin:0 0 12px;color:#A8A29E;font-size:12px;">${segCount} segments</p><table cellpadding="0" cellspacing="0" border="0" width="100%">${segmentLines}</table>`,
        noteType: "Transcript",
      });
    }

    if (emailNotes.length === 0) return;

    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;

    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        cc: ccList,
        sessionDate: sessionDate || "Transcripts",
        sessionStartTime: firstStart,
        sessionEndTime: lastEnd,
        notes: emailNotes,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
    transcriptSelect.cancel();
  }, [session, transcriptSelect, userId]);

  const handleTranscriptDeleteRequest = useCallback(() => {
    const dates = [...transcriptSelect.selectedIds];
    // Check if any conversations exist on these dates
    const affectedConvs = conversations.filter((c) => {
      if (!c.startTime) return false;
      const convDate = new Date(c.startTime);
      const convDateStr = `${convDate.getFullYear()}-${String(convDate.getMonth() + 1).padStart(2, "0")}-${String(convDate.getDate()).padStart(2, "0")}`;
      return dates.includes(convDateStr);
    });

    if (affectedConvs.length > 0) {
      setTranscriptDeleteWarning(
        `${affectedConvs.length} ${affectedConvs.length === 1 ? "conversation" : "conversations"} will lose ${affectedConvs.length === 1 ? "its" : "their"} linked transcript. This cannot be undone.`
      );
    } else {
      setTranscriptDeleteWarning("This will permanently delete the transcript data. This cannot be undone.");
    }
    setShowTranscriptDeleteConfirm(true);
  }, [transcriptSelect.selectedIds, conversations]);

  const handleTranscriptBatchDeleteConfirmed = useCallback(async () => {
    if (!session?.file) return;
    const dates = [...transcriptSelect.selectedIds];
    for (const dateStr of dates) {
      await session.file.trashFile(dateStr);
    }
    await session.transcript?.removeDates(dates);
    setShowTranscriptDeleteConfirm(false);
    transcriptSelect.cancel();
  }, [transcriptSelect, session]);

  const transcriptSelectActions = useMemo(() => [
    { icon: <ExportIcon />, label: "Export", onClick: () => setShowTranscriptExportDrawer(true) },
    { icon: <DeleteIcon />, label: "Delete", onClick: handleTranscriptDeleteRequest, variant: "danger" as const },
  ], [handleTranscriptDeleteRequest]);

  const transcriptExportLabel = useMemo(() => {
    return `${transcriptSelect.count} transcript${transcriptSelect.count === 1 ? "" : "s"} selected`;
  }, [transcriptSelect.count]);

  // Which multi-select is active (depends on current tab)
  const activeSelect = renderedFilter === "conversations" ? convSelect : transcriptSelect;

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
            <div
              className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? "bg-[#FEF2F2]" : "bg-[#F5F5F4]"}`}
            >
              <div
                className={`shrink-0 rounded-full size-1.75 ${isMicActive ? "bg-[#DC2626] animate-pulse" : "bg-[#A8A29E]"}`}
              />
              {isMicActive ? (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#DC2626"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              ) : (
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#A8A29E"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                  <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </div>
          </div>
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold">
                Conversations
              </div>
              <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                No conversations yet
              </div>
            </div>
            {/* Conversations / Transcripts toggle */}
            <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
              <button
                onClick={() => setActiveTimeFilter("conversations")}
                className={`flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 ${renderedFilter === "conversations" ? "bg-[#1C1917]" : ""}`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={
                    renderedFilter === "conversations" ? "#FAFAF9" : "#78716C"
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              <button
                onClick={() => setActiveTimeFilter("transcripts")}
                className={`flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 ${renderedFilter === "transcripts" ? "bg-[#1C1917]" : ""}`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={
                    renderedFilter === "transcripts" ? "#FAFAF9" : "#78716C"
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 14h6" />
                  <path d="M4 2h10" />
                  <rect x="4" y="18" width="16" height="4" rx="1" />
                  <rect x="4" y="6" width="16" height="4" rx="1" />
                </svg>
              </button>
            </div>
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
        <ConversationFilterDrawer
          isOpen={isFilterOpen}
          onClose={() => setIsFilterOpen(false)}
          sortBy={convSortBy}
          dateRange={convDateRange}
          showFilter={convShowFilter}
          customStart={convCustomStart}
          customEnd={convCustomEnd}
          onApply={handleFilterApply}
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
      {/* Header — swaps between normal and selection mode */}
      {activeSelect.isSelecting ? (
        <div className="shrink-0 pt-3">
          <SelectionHeader
            count={activeSelect.count}
            onCancel={activeSelect.cancel}
            onSelectAll={() => {
              if (renderedFilter === "conversations") {
                const selectableIds = filteredConversations
                  .filter((c) => c.status === "ended")
                  .map((c) => c.id);
                convSelect.selectAll(selectableIds);
              } else {
                const selectableDates = availableDates.filter((d) => {
                  const today = new Date();
                  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                  const isLive = d === todayStr && isRecording && !transcriptionPaused;
                  return !isLive;
                });
                transcriptSelect.selectAll(selectableDates);
              }
            }}
          />
        </div>
      ) : (
      <div
        className="flex flex-col pt-3 gap-3 px-6 shrink-0"
        style={{ opacity: tabOpacity, transition: "opacity 0.15s ease-in-out" }}
      >
        <div className="flex items-center  gap-2">
          <div
            className={`text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-red-hat font-bold`}
          >
            Mentra Notes
          </div>
          <div
            className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? "bg-[#FEF2F2]" : "bg-[#F5F5F4]"}`}
          >
            <div
              className={`shrink-0 rounded-full size-1.75 ${isMicActive ? "bg-[#DC2626] animate-pulse" : "bg-[#A8A29E]"}`}
            />
            {isMicActive ? (
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#DC2626"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#A8A29E"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>
        </div>
        <div className="flex items-end justify-between">
          <div className="flex flex-col gap-0.5">
            <div
              className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold`}
            >
              {renderedFilter === "conversations"
                ? "Conversations"
                : "Transcripts"}
            </div>
            <div
              className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}
            >
              {renderedFilter === "conversations" ? (
                <>Today · {todayConversationCount}{" "}{todayConversationCount === 1 ? "conversation" : "conversations"}</>
              ) : (
                <>{availableDates.length} {availableDates.length === 1 ? "day" : "days"} of transcripts</>
              )}
            </div>
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
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={
                    renderedFilter === "conversations" ? "#FAFAF9" : "#78716C"
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
                </svg>
              </button>
              {/* Transcripts */}
              <button
                onClick={() => setActiveTimeFilter("transcripts")}
                className={`flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0 ${renderedFilter === "transcripts" ? "bg-[#1C1917]" : ""}`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={
                    renderedFilter === "transcripts" ? "#FAFAF9" : "#78716C"
                  }
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
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
      )}

      {/* Tab switcher — hidden during selection */}
      {!activeSelect.isSelecting && renderedFilter === "conversations" && (
        <div
          className="flex items-center pt-4 gap-2 px-6 shrink-0 overflow-x-auto"
          style={{
            opacity: tabOpacity,
            transition: "opacity 0.15s ease-in-out",
          }}
        >
          <button
            onClick={() => {
              setTimeFilter("all");
              setConvShowFilter("all");
            }}
            className={`flex items-center rounded-[20px] py-[7px] px-4 shrink-0 ${
              timeFilter === "all" && convShowFilter === "all"
                ? "bg-[#1C1917]"
                : "bg-[#F5F5F4]"
            }`}
          >
            <span
              className={`text-[13px] leading-4 font-red-hat ${
                timeFilter === "all" && convShowFilter === "all"
                  ? "text-[#FAFAF9] font-semibold"
                  : "text-[#78716C] font-medium"
              }`}
            >
              All
            </span>
          </button>
          <button
            onClick={() => {
              setTimeFilter("today");
              setConvShowFilter("all");
            }}
            className={`flex items-center rounded-[20px] py-[7px] px-4 shrink-0 ${
              timeFilter === "today" && convShowFilter === "all"
                ? "bg-[#1C1917]"
                : "bg-[#F5F5F4]"
            }`}
          >
            <span
              className={`text-[13px] leading-4 font-red-hat ${
                timeFilter === "today" && convShowFilter === "all"
                  ? "text-[#FAFAF9] font-semibold"
                  : "text-[#78716C] font-medium"
              }`}
            >
              Today
            </span>
          </button>
          {convShowFilter !== "all" && (
            <button
              onClick={() => {
                setConvShowFilter("all");
                setFilterLoading(true);
                if (filterLoadingRef.current)
                  clearTimeout(filterLoadingRef.current);
                filterLoadingRef.current = setTimeout(() => {
                  setFilterLoading(false);
                }, 3000);
              }}
              className="flex items-center rounded-[20px] py-[7px] px-4 shrink-0 bg-[#1C1917]"
            >
              <span className="text-[13px] leading-4 text-[#FAFAF9] font-red-hat font-semibold">
                {convShowFilter === "favourites"
                  ? "Favourites"
                  : convShowFilter === "archived"
                    ? "Archived"
                    : "Trash"}
              </span>
            </button>
          )}
          {convSortBy !== "recent" && (
            <button
              onClick={() => {
                setConvSortBy("recent");
              }}
              className="flex items-center gap-1.5 rounded-[20px] py-[7px] px-4 shrink-0 bg-[#F5F5F4]"
            >
              <span className="text-[13px] leading-4 text-[#78716C] font-red-hat font-medium">
                Oldest first
              </span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#78716C"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Content area — single wrapper fades out/in on tab switch */}
      <div className="flex-1 overflow-hidden px-6">
        <div
          className="h-full"
          style={{
            opacity: tabOpacity,
            transition: "opacity 0.15s ease-in-out",
          }}
        >
          {renderedFilter === "transcripts" ? (
            <div className="h-full overflow-y-auto px-0 pb-32">
              <TranscriptList
                availableDates={availableDates}
                files={files}
                isRecording={isRecording}
                transcriptionPaused={transcriptionPaused}
                onSelect={(dateStr) => setLocation(`/transcript/${dateStr}`)}
                isSelecting={transcriptSelect.isSelecting}
                selectedDates={transcriptSelect.selectedIds}
                onToggleSelect={(dateStr) => transcriptSelect.toggleItem(dateStr)}
                longPressProps={transcriptSelect.longPressProps}
              />
            </div>
          ) : filterLoading ? (
            <div className="flex flex-col items-center justify-center h-full">
              <LoadingState size={100} cycleMessages />
            </div>
          ) : filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-5">
              <svg width="140" height="130" viewBox="0 0 140 130" fill="none">
                <circle cx="30" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="38" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="46" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="54" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="62" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="70" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="78" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="86" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="94" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="102" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="110" cy="90" r="3" fill="#D94F3B66" />
                <circle cx="30" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="38" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="46" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="54" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="62" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="70" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="70" cy="66" r="2.5" fill="#D94F3B59" />
                <circle cx="70" cy="74" r="2" fill="#D94F3B59" />
                <circle cx="70" cy="82" r="2.5" fill="#D94F3B59" />

                <circle cx="78" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="86" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="94" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="102" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="110" cy="58" r="3" fill="#D94F3B59" />
                <circle cx="30" cy="66" r="3" fill="#D94F3B59" />
                <circle cx="30" cy="74" r="3" fill="#D94F3B59" />
                <circle cx="30" cy="82" r="3" fill="#D94F3B59" />
                <circle cx="110" cy="66" r="3" fill="#D94F3B59" />
                <circle cx="110" cy="74" r="3" fill="#D94F3B59" />
                <circle cx="110" cy="82" r="3" fill="#D94F3B59" />
                <circle cx="25" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="33" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="41" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="49" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="57" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="65" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="20" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="28" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="36" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="44" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="52" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="60" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="15" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="23" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="31" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="39" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="47" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="55" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="75" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="83" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="91" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="99" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="107" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="115" cy="51" r="2.5" fill="#D94F3B38" />
                <circle cx="80" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="88" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="96" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="104" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="112" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="120" cy="44" r="2.5" fill="#D94F3B29" />
                <circle cx="85" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="93" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="101" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="109" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="117" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="125" cy="37" r="2" fill="#D94F3B1A" />
                <circle cx="46" cy="68" r="2" fill="#D94F3B0F" />
                <circle cx="62" cy="72" r="1.5" fill="#D94F3B0D" />
                <circle cx="78" cy="66" r="1.5" fill="#D94F3B0D" />
                <circle cx="55" cy="78" r="1.5" fill="#D94F3B0A" />
                <circle cx="85" cy="76" r="1.5" fill="#D94F3B0A" />
                <circle cx="70" cy="82" r="2" fill="#D94F3B0A" />
              </svg>
              <div className="tracking-[0.01em] text-[#D94F3B8C] font-red-hat font-medium text-[18px] leading-[22px]">
                Nothing found
              </div>
              <div className="tracking-[0.02em] text-[#968C82B3] font-red-hat text-[13px] leading-4">
                {convShowFilter === "trash"
                  ? "Your trash is empty"
                  : convShowFilter === "archived"
                    ? "No archived conversations"
                    : convShowFilter === "favourites"
                      ? "No favourite conversations yet"
                      : "Try adjusting your search or filters"}
              </div>
            </div>
          ) : (
            <>
              {convShowFilter === "trash" && trashedConversationCount > 0 && (
                <div className="flex items-center justify-between px-6 py-3">
                  <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat font-medium">
                    {trashedConversationCount}{" "}
                    {trashedConversationCount === 1
                      ? "conversation"
                      : "conversations"}{" "}
                    in trash
                  </span>
                  <button
                    onClick={() => setShowEmptyTrashConfirm(true)}
                    className="text-[13px] leading-4 text-[#DC2626] font-red-hat font-semibold"
                  >
                    Empty Trash
                  </button>
                </div>
              )}
              <ConversationList
                conversations={filteredConversations}
                onSelectConversation={handleSelectConversation}
                onArchive={handleArchiveConversation}
                onDelete={handleDeleteConversation}
                isSelecting={convSelect.isSelecting}
                selectedIds={convSelect.selectedIds}
                onToggleSelect={(id) => convSelect.toggleItem(id)}
                longPressProps={convSelect.longPressProps}
              />
            </>
          )}
        </div>
      </div>

      {/* FAB — hidden during selection */}
      {!activeSelect.isSelecting && (
        <FABMenu
          transcriptionPaused={transcriptionPaused}
          onAskAI={handleGlobalChat}
          onAddNote={handleAddNote}
          onStopTranscribing={handleStopTranscribing}
          onResumeTranscribing={handleResumeTranscribing}
        />
      )}

      {/* Multi-select bottom bar */}
      <AnimatePresence>
        {convSelect.isSelecting && renderedFilter === "conversations" && (
          <MultiSelectBar actions={convSelectActions} />
        )}
        {transcriptSelect.isSelecting && renderedFilter === "transcripts" && (
          <MultiSelectBar actions={transcriptSelectActions} />
        )}
      </AnimatePresence>

      {/* Export Drawers */}
      <ExportDrawer
        isOpen={showConvExportDrawer}
        onClose={() => setShowConvExportDrawer(false)}
        itemType="conversation"
        itemLabel={convExportLabel}
        count={convSelect.count}
        onExport={handleConvBatchExport}
        missingNoteCount={convMissingNoteCount}
      />
      <ExportDrawer
        isOpen={showTranscriptExportDrawer}
        onClose={() => setShowTranscriptExportDrawer(false)}
        itemType="transcript"
        itemLabel={transcriptExportLabel}
        count={transcriptSelect.count}
        onExport={handleTranscriptBatchExport}
      />

      {/* Email Drawer (opened after ExportDrawer selects "email") */}
      <EmailDrawer
        isOpen={showConvEmailDrawer}
        onClose={() => { setShowConvEmailDrawer(false); setPendingConvExportOptions(null); }}
        onSend={handleConvEmailSend}
        defaultEmail={userId || ""}
        itemLabel={convSelect.count === 1 ? "Conversation" : `${convSelect.count} Conversations`}
      />
      <EmailDrawer
        isOpen={showTranscriptEmailDrawer}
        onClose={() => setShowTranscriptEmailDrawer(false)}
        onSend={handleTranscriptEmailSend}
        defaultEmail={userId || ""}
        itemLabel={transcriptSelect.count === 1 ? "Transcript" : `${transcriptSelect.count} Transcripts`}
      />

      {/* Transcript Delete Confirmation */}
      <Drawer.Root open={showTranscriptDeleteConfirm} onOpenChange={(open) => !open && setShowTranscriptDeleteConfirm(false)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[6px] z-50" />
          <Drawer.Content className="flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] outline-none">
            <div className="flex justify-center pt-3 pb-4">
              <div className="w-9 h-1 rounded-xs bg-[#D6D3D1] shrink-0" />
            </div>
            <Drawer.Title className="sr-only">Delete Transcripts</Drawer.Title>
            <Drawer.Description className="sr-only">Confirm transcript deletion</Drawer.Description>
            <div className="px-6 pb-10">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xl leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
                  Delete Transcripts?
                </span>
                <button onClick={() => setShowTranscriptDeleteConfirm(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="text-[14px] leading-5 text-[#78716C] font-red-hat pb-6">
                {transcriptDeleteWarning}
              </p>
              <button
                onClick={handleTranscriptBatchDeleteConfirmed}
                className="flex items-center justify-center w-full rounded-xl bg-[#DC2626] p-3.5 mb-3"
              >
                <span className="text-[16px] leading-5 text-white font-red-hat font-bold">
                  Delete Transcripts
                </span>
              </button>
              <button
                onClick={() => setShowTranscriptDeleteConfirm(false)}
                className="flex items-center justify-center w-full rounded-xl border border-[#E7E5E4] p-3.5"
              >
                <span className="text-[16px] leading-5 text-[#1C1917] font-red-hat font-bold">
                  Cancel
                </span>
              </button>
            </div>
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Filter Drawer */}
      <ConversationFilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        sortBy={convSortBy}
        dateRange={convDateRange}
        showFilter={convShowFilter}
        customStart={convCustomStart}
        customEnd={convCustomEnd}
        onApply={handleFilterApply}
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
                You are about to permanently delete {trashedConversationCount}{" "}
                {trashedConversationCount === 1
                  ? "conversation"
                  : "conversations"}
                . This cannot be undone. Are you sure?
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
