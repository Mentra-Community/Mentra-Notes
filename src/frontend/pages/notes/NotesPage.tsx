/**
 * NotesPage - All notes view with filters
 *
 * Shows all notes across all days with filter pills:
 * All, Favourites, Manual, AI + show filter from drawer (Archived, Trash)
 * Loading animation on filter switch, empty state with dot art.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useLocation, useSearch } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { AnimatePresence, motion } from "motion/react";
import { format, isToday, isYesterday } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import { useMultiSelect } from "../../hooks/useMultiSelect";
import type { SessionI, Note } from "../../../shared/types";
import { NoteRow } from "./NoteRow";
import { NotesFABMenu } from "./NotesFABMenu";
import {
  NotesFilterDrawer,
  type NoteSortBy,
  type NoteShowFilter,
} from "../../components/shared/NotesFilterDrawer";
import { LoadingState } from "../../components/shared/LoadingState";
import { BottomDrawer } from "../../components/shared/BottomDrawer";
import { SelectionHeader } from "../../components/shared/SelectionHeader";
import { MultiSelectBar, type MultiSelectAction, ExportIcon, MoveIcon, FavoriteIcon, DeleteIcon } from "../../components/shared/MultiSelectBar";
import { ExportDrawer, type ExportOptions } from "../../components/shared/ExportDrawer";
import { EmailDrawer } from "../../components/shared/EmailDrawer";

type NoteFilter = "all" | "manual" | "ai";

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

export function NotesPage() {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const search = useSearch();
  const initialShowFilter = (() => {
    const f = new URLSearchParams(search).get("filter");
    if (f === "favourites" || f === "archived" || f === "trash") return f;
    return "all" as const;
  })();
  const [activeFilter, setActiveFilter] = useState<NoteFilter>("all");
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [sortBy, setSortBy] = useState<NoteSortBy>("recent");
  const [showFilter, setShowFilter] = useState<NoteShowFilter>(initialShowFilter);
  const [filterLoading, setFilterLoading] = useState(false);
  const filterLoadingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFilterRef = useRef<{ sortBy: NoteSortBy; showFilter: NoteShowFilter } | null>(null);
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [showExportDrawer, setShowExportDrawer] = useState(false);
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);
  const [pendingExportOptions, setPendingExportOptions] = useState<ExportOptions | null>(null);

  const multiSelect = useMultiSelect();

  const notes = session?.notes?.notes ?? [];
  const conversations = session?.conversation?.conversations ?? [];
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;

  // Build a map of conversation titles by date for "From: ..." labels
  const conversationTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of conversations) {
      if (conv.title && conv.date) {
        if (!map.has(conv.date)) {
          map.set(conv.date, conv.title);
        }
      }
    }
    return map;
  }, [conversations]);

  // Filter notes — two-level: show filter + pill filter
  const filteredNotes = useMemo(() => {
    let result = [...notes];

    // Show filter (mutually exclusive states)
    if (showFilter === "favourites") {
      result = result.filter((n) => n.isFavourite);
    } else if (showFilter === "archived") {
      result = result.filter((n) => n.isArchived);
    } else if (showFilter === "trash") {
      result = result.filter((n) => n.isTrashed);
    } else {
      // "all" — hide archived and trashed
      result = result.filter((n) => !n.isTrashed && !n.isArchived);
    }

    // Pill filters (AI/Manual) — applied on top
    if (activeFilter === "manual") {
      result = result.filter((n) => !n.isAIGenerated);
    } else if (activeFilter === "ai") {
      result = result.filter((n) => n.isAIGenerated);
    }

    // Sort
    if (sortBy === "oldest") {
      result.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [notes, activeFilter, showFilter, sortBy]);

  const trashedNoteCount = useMemo(() => {
    return notes.filter((n) => n.isTrashed).length;
  }, [notes]);

  const handleFilterApply = useCallback(({ sortBy: newSortBy, showFilter: newShowFilter }: { sortBy: NoteSortBy; showFilter: NoteShowFilter }) => {
    setIsFilterOpen(false);
    pendingFilterRef.current = { sortBy: newSortBy, showFilter: newShowFilter };
    setFilterLoading(true);
    if (filterLoadingRef.current) clearTimeout(filterLoadingRef.current);
    filterLoadingRef.current = setTimeout(() => {
      const pending = pendingFilterRef.current;
      if (pending) {
        setSortBy(pending.sortBy);
        setShowFilter(pending.showFilter);
        pendingFilterRef.current = null;
      }
      setFilterLoading(false);
    }, 3000);
  }, []);

  useEffect(() => {
    return () => { if (filterLoadingRef.current) clearTimeout(filterLoadingRef.current); };
  }, []);

  const handleSelectNote = (note: Note) => {
    setLocation(`/note/${note.id}`);
  };

  const handleArchiveNote = async (note: Note) => {
    if (!session?.notes) return;
    if (note.isArchived) {
      await session.notes.unarchiveNote(note.id);
    } else {
      await session.notes.archiveNote(note.id);
    }
  };

  const handleTrashNote = async (note: Note) => {
    if (!session?.notes) return;
    if (note.isTrashed) {
      await session.notes.untrashNote(note.id);
    } else {
      await session.notes.trashNote(note.id);
    }
  };

  const handlePermanentlyDeleteNote = async (note: Note) => {
    if (!session?.notes?.permanentlyDeleteNote) return;
    await session.notes.permanentlyDeleteNote(note.id);
  };

  const handleEmptyTrash = async () => {
    setShowEmptyTrashConfirm(false);
    if (!session?.notes?.emptyNoteTrash) return;
    await session.notes.emptyNoteTrash();
  };

  const handleAddNote = async () => {
    if (!session?.notes?.createManualNote) return;
    const note = await session.notes.createManualNote("", "");
    if (note?.id) {
      setLocation(`/note/${note.id}`);
    }
  };

  // Exit selection mode on filter change
  useEffect(() => {
    multiSelect.cancel();
  }, [activeFilter, showFilter]);

  // ── Multi-select action handlers ──

  const handleBatchFavourite = useCallback(async () => {
    if (!session?.notes) return;
    const selectedNotes = filteredNotes.filter((n) => multiSelect.selectedIds.has(n.id));
    const allFav = selectedNotes.every((n) => n.isFavourite);
    for (const note of selectedNotes) {
      if (allFav) {
        await session.notes.unfavouriteNote(note.id);
      } else if (!note.isFavourite) {
        await session.notes.favouriteNote(note.id);
      }
    }
    multiSelect.cancel();
  }, [session, multiSelect, filteredNotes]);

  const handleBatchTrash = useCallback(async () => {
    if (!session?.notes) return;
    for (const id of multiSelect.selectedIds) {
      await session.notes.trashNote(id);
    }
    multiSelect.cancel();
  }, [session, multiSelect]);

  /** Find the linked conversation for a note */
  const findLinkedConversation = useCallback((note: Note) => {
    if (!note.isAIGenerated) return null;
    return conversations.find((c) => c.noteId === note.id) || null;
  }, [conversations]);

  /** Build plain text for clipboard export (async — may load transcript segments) */
  const handleBatchExport = useCallback(async (options: ExportOptions) => {
    if (!session?.notes) return;

    if (options.destination === "email") {
      setPendingExportOptions(options);
      setShowEmailDrawer(true);
      return;
    }

    // Clipboard
    const selectedNotes = filteredNotes.filter((n) => multiSelect.selectedIds.has(n.id));
    const textParts: string[] = [];

    for (const note of selectedNotes) {
      const parts: string[] = [];
      const content = stripHtmlAndTruncate(note.content, 9999);
      const [year, month, day] = note.date.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dateLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      const createdAt = note.createdAt ? new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
      const typeLabel = note.isAIGenerated ? "AI Generated" : "Manual";
      const fromConv = note.isAIGenerated ? conversationTitleMap.get(note.date) : null;

      let meta = `Date: ${dateLabel}`;
      if (createdAt) meta += `\nCreated: ${createdAt}`;
      meta += `\nType: ${typeLabel}`;
      if (fromConv) meta += `\nFrom: ${fromConv}`;

      parts.push(`# ${note.title || "Untitled Note"}\n${meta}\n\n${content}`);

      // Linked Conversation
      if (options.includeLinkedNote) {
        const conv = findLinkedConversation(note);
        if (conv) {
          const summary = conv.aiSummary || conv.runningSummary || "No summary";
          const startTime = new Date(conv.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const endTime = conv.endTime ? new Date(conv.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "ongoing";
          parts.push(`\n## Linked Conversation: ${conv.title || "Untitled"}\nTime: ${startTime} – ${endTime}\n\n${summary}`);

          // Conversation Transcript (sub-option)
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
            if (transcriptText) {
              parts.push(`\n### Transcript\n${transcriptText}`);
            }
          }
        }
      }

      textParts.push(parts.join("\n"));
    }

    const text = textParts.join("\n\n---\n\n");
    await navigator.clipboard.writeText(text);
    multiSelect.cancel();
  }, [session, multiSelect, filteredNotes, conversationTitleMap, findLinkedConversation]);

  const handleEmailSend = useCallback(async (to: string, cc: string) => {
    const selectedNotes = filteredNotes.filter((n) => multiSelect.selectedIds.has(n.id));
    if (selectedNotes.length === 0) return;
    const options = pendingExportOptions;

    const firstNote = selectedNotes[0];
    const [year, month, day] = firstNote.date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    const sessionDate = dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const startTime = firstNote.createdAt
      ? new Date(firstNote.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";

    const emailNotes: Array<{
      noteId: string;
      noteTimestamp: string;
      noteTitle: string;
      noteContent: string;
      noteType: string;
    }> = [];

    for (const note of selectedNotes) {
      // Build content with optional linked conversation + transcript
      let contentHtml = note.content || "";

      if (options?.includeLinkedNote) {
        const conv = findLinkedConversation(note);
        if (conv) {
          const summary = conv.aiSummary || conv.runningSummary || "No summary";
          const convStart = new Date(conv.startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
          const convEnd = conv.endTime ? new Date(conv.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "ongoing";
          contentHtml += `<hr/><h3>Linked Conversation: ${conv.title || "Untitled"}</h3><p style="color:#A8A29E;font-size:12px;">${convStart} – ${convEnd}</p><p>${summary}</p>`;

          if (options?.includeTranscript) {
            let transcriptHtml = "";
            try {
              if (session?.conversation?.loadConversationSegments) {
                const segments = await session.conversation.loadConversationSegments(conv.id);
                if (segments && segments.length > 0) {
                  transcriptHtml = segments.map((s) => {
                    const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                    return `<tr><td style="color:#A8A29E;font-size:12px;padding:2px 8px 2px 0;vertical-align:top;white-space:nowrap;">[${time}]</td><td style="font-size:13px;padding:2px 0;">${s.text}</td></tr>`;
                  }).join("");
                  contentHtml += `<h4>Transcript</h4><table cellpadding="0" cellspacing="0" border="0">${transcriptHtml}</table>`;
                }
              }
            } catch { /* segments not available */ }
          }
        }
      }

      emailNotes.push({
        noteId: note.id,
        noteTimestamp: note.createdAt
          ? new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
          : "",
        noteTitle: note.title || "Untitled Note",
        noteContent: contentHtml,
        noteType: note.isAIGenerated ? "AI Generated" : "Manual",
      });
    }

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
        sessionEndTime: "",
        notes: emailNotes,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
    multiSelect.cancel();
  }, [filteredNotes, multiSelect, pendingExportOptions, findLinkedConversation]);

  const noteSelectActions = useMemo((): MultiSelectAction[] => {
    const actions: MultiSelectAction[] = [
      { icon: <ExportIcon />, label: "Export", onClick: () => setShowExportDrawer(true) },
      { icon: <FavoriteIcon />, label: "Favorite", onClick: handleBatchFavourite },
    ];
    if (showFilter !== "trash") {
      actions.push({ icon: <DeleteIcon />, label: "Trash", onClick: handleBatchTrash, variant: "danger" });
    }
    return actions;
  }, [handleBatchFavourite, handleBatchTrash, showFilter]);

  const exportItemLabel = useMemo(() => {
    if (multiSelect.count === 1) {
      const note = filteredNotes.find((n) => multiSelect.selectedIds.has(n.id));
      return note?.title || "Untitled Note";
    }
    return `${multiSelect.count} notes selected`;
  }, [multiSelect.count, multiSelect.selectedIds, filteredNotes]);

  const formatNoteDate = (note: Note): string => {
    const [year, month, day] = note.date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    if (isToday(dateObj)) return "Today";
    if (isYesterday(dateObj)) return "Yesterday";
    return format(dateObj, "EEE MMM d");
  };

  const getFromLabel = (note: Note): string | null => {
    if (!note.isAIGenerated) return null;
    const convTitle = conversationTitleMap.get(note.date);
    if (convTitle) return `From: ${convTitle} · ${formatNoteDate(note)}`;
    return formatNoteDate(note);
  };

  const filters: { key: NoteFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "manual", label: "Manual" },
    { key: "ai", label: "AI" },
  ];

  // --- Empty state ---
  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold">
              MENTRA NOTES
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
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="text-[32px] leading-10 text-[#1C1917] font-red-hat font-extrabold">
                Notes
              </div>
              <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                0 notes
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#F5F5F4] shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
                <div className="flex items-center justify-center w-[34px] h-[30px] rounded-lg bg-[#1C1917] shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <line x1="4" y1="6" x2="20" y2="6" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                    <line x1="4" y1="12" x2="20" y2="12" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                    <line x1="4" y1="18" x2="20" y2="18" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <button onClick={() => setLocation("/collections")} className="flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="14" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="3" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="14" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Empty center content */}
        <div className="flex flex-col items-center grow px-8 gap-8 justify-center">
          <div className="flex flex-col items-center gap-5">
            <div className="flex items-center justify-center w-[72px] h-[72px] rounded-[22px] bg-[#F5F5F4] shrink-0">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="text-[20px] leading-6 text-[#1C1917] font-red-hat font-extrabold">
                No notes yet
              </div>
              <div className="text-[14px] leading-5 text-center text-[#A8A29E] font-red-hat">
                Your notes will show up here
              </div>
            </div>
          </div>

          {/* Action cards */}
          <div className="flex flex-col w-full max-w-[329px] gap-2.5">
            <button onClick={handleAddNote} className="flex items-center rounded-2xl gap-3.5 bg-[#F5F5F4] p-4 text-left">
              <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#FAFAF9] size-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <div className="flex flex-col grow shrink basis-0 gap-0.5">
                <div className="text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-bold">Write a note</div>
                <div className="text-[12px] leading-4 text-[#78716C] font-red-hat">Tap + to create a manual note</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button onClick={() => setLocation("/")} className="flex items-center rounded-2xl gap-3.5 bg-[#FEE2E2] p-4 text-left">
              <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#FAFAF9] size-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div className="flex flex-col grow shrink basis-0 gap-0.5">
                <div className="text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-bold">Generate AI note</div>
                <div className="text-[12px] leading-4 text-[#78716C] font-red-hat">From any conversation</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        <NotesFABMenu onAddNote={handleAddNote} onAskAI={() => setLocation("/")} onCreateFolder={() => setLocation("/collections")} />
      </div>
    );
  }

  // --- Populated state ---
  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header — swaps between normal and selection mode */}
      {multiSelect.isSelecting ? (
        <div className="shrink-0 pt-3">
          <SelectionHeader
            count={multiSelect.count}
            onCancel={multiSelect.cancel}
            onSelectAll={() => multiSelect.selectAll(filteredNotes.map((n) => n.id))}
          />
        </div>
      ) : (
        <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold">
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
          <div className="flex items-end justify-between">
            <div className="flex flex-col gap-0.5">
              <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold">
                Notes
              </div>
              <div className="text-[14px] leading-[18px] text-[#A8A29E] font-red-hat">
                {filteredNotes.length} {filteredNotes.length === 1 ? "note" : "notes"}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Filter button */}
              <button
                onClick={() => setIsFilterOpen(true)}
                className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#F5F5F4] shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {/* List/Grid toggle */}
              <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
                <div className="flex items-center justify-center w-[34px] h-[30px] rounded-lg bg-[#1C1917] shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <line x1="4" y1="6" x2="20" y2="6" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                    <line x1="4" y1="12" x2="20" y2="12" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                    <line x1="4" y1="18" x2="20" y2="18" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <button onClick={() => setLocation("/collections")} className="flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="14" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="3" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                    <rect x="14" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filter pills — hidden during selection */}
      {!multiSelect.isSelecting && (
        <div className="flex items-center pt-4 gap-2 px-6 shrink-0 overflow-x-auto">
          {filters.map((f) => {
            const isActive = showFilter === "all" && activeFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => {
                  setShowFilter("all");
                  setActiveFilter(f.key);
                }}
                className={`flex items-center rounded-[20px] py-[7px] px-4 shrink-0 ${
                  isActive ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
                }`}
              >
                <span className={`text-[13px] leading-4 font-red-hat ${isActive ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"}`}>
                  {f.label}
                </span>
              </button>
            );
          })}
          {/* Show filter tag from drawer (archived/trash) */}
          {(showFilter === "favourites" || showFilter === "archived" || showFilter === "trash") && (
            <button
              onClick={() => setShowFilter("all")}
              className="flex items-center rounded-[20px] py-[7px] px-4 shrink-0 bg-[#1C1917]"
            >
              <span className="text-[13px] leading-4 text-[#FAFAF9] font-red-hat font-semibold">
                {showFilter === "favourites" ? "Favourites" : showFilter === "archived" ? "Archived" : "Trash"}
              </span>
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-4 px-6 pb-32">
        {filterLoading ? (
          <div className="flex flex-col items-center justify-center h-full">
            <LoadingState size={100} cycleMessages />
          </div>
        ) : filteredNotes.length === 0 ? (
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
              {showFilter === "trash"
                ? "Your trash is empty"
                : showFilter === "archived"
                  ? "No archived notes"
                  : showFilter === "favourites"
                    ? "No favourite notes yet"
                    : "Try adjusting your filters"}
            </div>
          </div>
        ) : (
          <>
            {/* Trash header */}
            {showFilter === "trash" && trashedNoteCount > 0 && (
              <div className="flex items-center justify-between pb-3">
                <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat font-medium">
                  {trashedNoteCount} {trashedNoteCount === 1 ? "note" : "notes"} in trash
                </span>
                <button
                  onClick={() => setShowEmptyTrashConfirm(true)}
                  className="text-[13px] leading-4 text-[#DC2626] font-red-hat font-semibold"
                >
                  Empty Trash
                </button>
              </div>
            )}
            <AnimatePresence initial={false}>
              {filteredNotes.map((note, i) => {
                const fromLabel = getFromLabel(note);
                const isLast = i === filteredNotes.length - 1;
                const isTrashed = note.isTrashed;

                return (
                  <motion.div
                    key={note.id}
                    layout
                    initial={false}
                    exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <NoteRow
                      note={note}
                      fromLabel={fromLabel}
                      formatNoteDate={formatNoteDate}
                      stripHtmlAndTruncate={stripHtmlAndTruncate}
                      onSelect={handleSelectNote}
                      onArchive={handleArchiveNote}
                      onDelete={isTrashed ? handlePermanentlyDeleteNote : handleTrashNote}
                      archiveLabel={note.isArchived ? "Unarchive" : "Archive"}
                      deleteLabel={isTrashed ? "Delete" : "Trash"}
                      isLast={isLast}
                      isSelecting={multiSelect.isSelecting}
                      isSelected={multiSelect.selectedIds.has(note.id)}
                      onToggleSelect={() => multiSelect.toggleItem(note.id)}
                      longPressHandlers={multiSelect.longPressProps(note.id)}
                    />
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </>
        )}
      </div>

      {/* FAB Menu — hidden during selection */}
      {!multiSelect.isSelecting && (
        <NotesFABMenu onAddNote={handleAddNote} onAskAI={() => setLocation("/")} onCreateFolder={() => setLocation("/collections")} />
      )}

      {/* Multi-select bottom bar */}
      <AnimatePresence>
        {multiSelect.isSelecting && (
          <MultiSelectBar actions={noteSelectActions} />
        )}
      </AnimatePresence>

      {/* Export Drawer */}
      <ExportDrawer
        isOpen={showExportDrawer}
        onClose={() => setShowExportDrawer(false)}
        itemType="note"
        itemLabel={exportItemLabel}
        count={multiSelect.count}
        onExport={handleBatchExport}
        missingNoteCount={filteredNotes.filter((n) => multiSelect.selectedIds.has(n.id) && !findLinkedConversation(n)).length}
      />

      {/* Email Drawer (opened after ExportDrawer selects "email") */}
      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => { setShowEmailDrawer(false); setPendingExportOptions(null); }}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel={multiSelect.count === 1 ? "Note" : `${multiSelect.count} Notes`}
      />

      {/* Filter Drawer */}
      <NotesFilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        sortBy={sortBy}
        showFilter={showFilter}
        onApply={handleFilterApply}
      />

      {/* Empty Trash Confirmation */}
      <BottomDrawer isOpen={showEmptyTrashConfirm} onClose={() => setShowEmptyTrashConfirm(false)}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-[18px] leading-[22px] text-[#1C1917] font-red-hat font-bold text-center">
            Empty Trash?
          </div>
          <div className="text-[14px] leading-5 text-[#A8A29E] font-red-hat text-center">
            Your notes will be permanently deleted. This cannot be undone.
          </div>
          <div className="flex gap-3 w-full mt-3">
            <button
              onClick={() => setShowEmptyTrashConfirm(false)}
              className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-medium bg-[#F5F5F4] text-[#78716C]"
            >
              Cancel
            </button>
            <button
              onClick={handleEmptyTrash}
              className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-bold bg-[#DC2626] text-white"
            >
              Delete All
            </button>
          </div>
        </div>
      </BottomDrawer>
    </div>
  );
}
