/**
 * NotesPage - All notes view with filters
 *
 * Shows all notes across all days with filter pills:
 * All, Favorites, Manual, AI Generated
 * Empty state when no notes exist.
 */

import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, isToday, isYesterday } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, Note } from "../../../shared/types";


type NoteFilter = "all" | "favorites" | "manual" | "ai";

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
  const [activeFilter, setActiveFilter] = useState<NoteFilter>("all");

  const notes = session?.notes?.notes ?? [];
  const conversations = session?.conversation?.conversations ?? [];
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;

  // Build a map of conversation titles by date for "From: ..." labels
  const conversationTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const conv of conversations) {
      if (conv.title && conv.date) {
        // Store most recent conversation title per date
        if (!map.has(conv.date)) {
          map.set(conv.date, conv.title);
        }
      }
    }
    return map;
  }, [conversations]);

  // Filter notes
  const filteredNotes = useMemo(() => {
    switch (activeFilter) {
      case "manual":
        return notes.filter((n) => !n.isAIGenerated);
      case "ai":
        return notes.filter((n) => n.isAIGenerated);
      // TODO: "favorites" filter — no favorite field on Note yet
      case "favorites":
        return notes;
      default:
        return notes;
    }
  }, [notes, activeFilter]);

  const handleSelectNote = (note: Note) => {
    setLocation(`/note/${note.id}`);
  };

  const handleAddNote = async () => {
    if (!session?.notes?.createManualNote) return;
    const note = await session.notes.createManualNote("", "");
    if (note?.id) {
      setLocation(`/note/${note.id}`);
    }
  };

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

  // Filter pill config
  const filters: { key: NoteFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "favorites", label: "Favorites" },
    { key: "manual", label: "Manual" },
    { key: "ai", label: "AI Generated" },
  ];

  // --- Empty state ---
  if (notes.length === 0) {
    return (
      <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
        {/* Header */}
        <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
          <div className="flex items-center gap-2">
            <div className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold`}>
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
              <div className={`text-[32px] leading-10 text-[#1C1917] font-red-hat font-extrabold`}>
                Notes
              </div>
              <div className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}>
                0 notes
              </div>
            </div>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex items-center py-4 gap-2 px-6 shrink-0 overflow-x-auto">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setActiveFilter(f.key)}
              className={`flex items-center rounded-[20px] py-[7px] px-4 shrink-0 ${
                activeFilter === f.key ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
              }`}
            >
              <span
                className={`text-[13px] leading-4 font-red-hat ${
                  activeFilter === f.key ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
                }`}
              >
                {f.label}
              </span>
            </button>
          ))}
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
              <div className={`text-[20px] leading-6 text-[#1C1917] font-red-hat font-extrabold`}>
                No notes yet
              </div>
              <div className={`text-[14px] leading-5 text-center text-[#A8A29E] font-red-hat`}>
                Your notes will show up here
              </div>
            </div>
          </div>

          {/* Action cards */}
          <div className="flex flex-col w-full max-w-[329px] gap-2.5">
            <button
              onClick={handleAddNote}
              className="flex items-center rounded-2xl gap-3.5 bg-[#F5F5F4] p-4 text-left"
            >
              <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#FAFAF9] size-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </div>
              <div className="flex flex-col grow shrink basis-0 gap-0.5">
                <div className={`text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-bold`}>
                  Write a note
                </div>
                <div className={`text-[12px] leading-4 text-[#78716C] font-red-hat`}>
                  Tap + to create a manual note
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              onClick={() => setLocation("/")}
              className="flex items-center rounded-2xl gap-3.5 bg-[#FEE2E2] p-4 text-left"
            >
              <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#FAFAF9] size-10">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <div className="flex flex-col grow shrink basis-0 gap-0.5">
                <div className={`text-[14px] leading-[18px] text-[#1C1917] font-red-hat font-bold`}>
                  Generate AI note
                </div>
                <div className={`text-[12px] leading-4 text-[#78716C] font-red-hat`}>
                  From any conversation
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>

        {/* FAB */}
        <button
          onClick={handleAddNote}
          className="absolute bottom-[111px] right-6 flex items-center justify-center w-[52px] h-[52px] rounded-2xl bg-[#DC2626] shadow-[0px_4px_16px_#DC262640]"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

      </div>
    );
  }

  // --- Populated state ---
  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#DC2626] font-red-hat font-bold`}>
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
            <div className={`text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] font-red-hat font-extrabold`}>
              Notes
            </div>
            <div className={`text-[14px] leading-[18px] text-[#A8A29E] font-red-hat`}>
              {filteredNotes.length} {filteredNotes.length === 1 ? "note" : "notes"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Filter icon */}
            <div className="flex items-center justify-center w-[34px] h-[34px] rounded-[10px] bg-[#F5F5F4] shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {/* List/Grid toggle */}
            <div className="flex items-center rounded-[10px] py-[3px] px-[3px] bg-[#F5F5F4]">
              <div className="flex items-center justify-center w-[34px] h-[30px] rounded-lg bg-[#1C1917] shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <line x1="4" y1="6" x2="20" y2="6" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  <line x1="4" y1="12" x2="20" y2="12" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                  <line x1="4" y1="18" x2="20" y2="18" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </div>
              <div className="flex items-center justify-center w-[34px] h-[30px] rounded-lg shrink-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                  <rect x="14" y="3" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                  <rect x="3" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                  <rect x="14" y="14" width="7" height="7" rx="1" stroke="#78716C" strokeWidth="2" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center pt-4 gap-2 px-6 shrink-0">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`flex items-center rounded-[20px] py-[7px] px-4 shrink-0 ${
              activeFilter === f.key ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
            }`}
          >
            <span
              className={`text-[13px] leading-4 font-red-hat ${
                activeFilter === f.key ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
              }`}
            >
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* Notes list */}
      <div className="flex flex-col flex-1 overflow-y-auto pt-4 px-6 pb-32">
        {filteredNotes.map((note, i) => {
          const fromLabel = getFromLabel(note);
          const isLast = i === filteredNotes.length - 1;

          return (
            <button
              key={note.id}
              onClick={() => handleSelectNote(note)}
              className={`flex flex-col py-4 gap-1 text-left ${
                !isLast ? "border-b border-b-[#F5F5F4]" : ""
              }`}
            >
              <div className="flex items-center gap-1.5">
                <div className={`text-[15px] leading-5 text-[#1C1917] font-red-hat font-bold truncate`}>
                  {note.title || "Untitled Note"}
                </div>
                {note.isAIGenerated ? (
                  <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#FEE2E2] shrink-0">
                    <span className={`text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-bold`}>AI</span>
                  </div>
                ) : (
                  <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#DBEAFE] shrink-0">
                    <span className={`text-[10px] leading-3.5 text-[#2563EB] font-red-hat font-semibold`}>
                      Manual
                    </span>
                  </div>
                )}
              </div>
              <div className={`text-[14px] leading-5 text-[#78716C] font-red-hat line-clamp-2`}>
                {stripHtmlAndTruncate(note.content) || "No content"}
              </div>
              <div className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat`}>
                {fromLabel || formatNoteDate(note)}
              </div>
            </button>
          );
        })}
      </div>

      {/* FAB */}
      <button
        onClick={handleAddNote}
        className="absolute bottom-[25px] right-6 flex items-center justify-center w-[52px] h-[52px] rounded-2xl bg-[#DC2626] shadow-[0px_4px_16px_#DC262640] z-10"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

    </div>
  );
}
