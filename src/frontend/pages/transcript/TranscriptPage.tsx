/**
 * TranscriptPage - Dedicated transcript view for a specific date.
 * UI matches the Paper design system.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, parse } from "date-fns";
import { toast } from "sonner";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";
import { TranscriptTab } from "../day/components/tabs/TranscriptTab";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
import { DropdownMenu } from "../../components/shared/DropdownMenu";
import { DayPageSkeleton } from "../../components/shared/SkeletonLoader";
import { StopTranscriptionDialog } from "../home/components/StopTranscriptionDialog";

export function TranscriptPage() {
  const params = useParams<{ date: string }>();
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session, isReconnecting } = useSynced<SessionI>(userId || "");

  const dateString = params.date || "";
  const date = useMemo(() => {
    try {
      return parse(dateString, "yyyy-MM-dd", new Date());
    } catch {
      return new Date();
    }
  }, [dateString]);

  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const isToday = dateString === todayString;

  // Session data
  const allSegments = session?.transcript?.segments ?? [];
  const hourSummaries = session?.summary?.hourSummaries ?? [];
  const interimText = session?.transcript?.interimText ?? "";
  const isRecording = session?.transcript?.isRecording ?? false;
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isSyncingPhoto = session?.transcript?.isSyncingPhoto ?? false;
  const loadedDate = session?.transcript?.loadedDate ?? "";

  // Loading state
  const [isLoadingTranscript, setIsLoadingTranscript] = useState(false);
  const lastLoadedDateRef = useRef<string | null>(null);
  const historicalSegmentCountRef = useRef<number | null>(null);
  const isLoadingHistory = session?.transcript?.isLoadingHistory ?? false;
  const isTranscriptHydrated = session?.transcript?.isHydrated ?? false;
  const dateMatchesServer = loadedDate === dateString;
  const isDataLoading =
    !isTranscriptHydrated ||
    isLoadingHistory ||
    isLoadingTranscript ||
    !dateMatchesServer;

  // Compact mode
  const serverCompactMode = session?.settings?.superCollapsed ?? false;
  // Default to compact on this page — overridden by user toggle or server setting
  const [optimisticCompact, setOptimisticCompact] = useState<boolean | null>(true);
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

  // Stop transcription confirmation dialog
  const [showStopConfirm, setShowStopConfirm] = useState(false);

  const handleStopTranscription = useCallback(async () => {
    await session?.settings?.updateSettings({ transcriptionPaused: true });
    setShowStopConfirm(false);
  }, [session?.settings]);

  // Email drawer
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);

  // Elapsed time for live recording
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isToday || !isRecording) return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [isToday, isRecording]);

  const formatElapsed = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  // Reset date tracking after reconnection
  useEffect(() => {
    if (!isReconnecting && lastLoadedDateRef.current) {
      lastLoadedDateRef.current = null;
    }
  }, [isReconnecting]);

  // Load transcript for this date
  useEffect(() => {
    if (!session?.transcript?.loadDateTranscript) return;
    if (!dateString || isReconnecting) return;
    if (lastLoadedDateRef.current === dateString) return;

    // NOTE: we used to skip loading when `loadedDate === dateString` already,
    // but TranscriptManager sets `loadedDate` optimistically before segments
    // finish fetching — skipping caused the empty state to flash for today.
    // Always trigger the load so `isLoadingTranscript` covers the real window.

    lastLoadedDateRef.current = dateString;
    setIsLoadingTranscript(true);

    if (dateString === todayString) {
      session.transcript
        .loadTodayTranscript()
        .catch((err) => console.error("[TranscriptPage] Failed to load today:", err))
        .finally(() => setIsLoadingTranscript(false));
    } else {
      session.transcript
        .loadDateTranscript(dateString)
        .catch((err) => console.error(`[TranscriptPage] Failed to load ${dateString}:`, err))
        .finally(() => setIsLoadingTranscript(false));
    }
  }, [dateString, todayString, loadedDate, session?.transcript, isReconnecting]);

  // Snapshot segment count when historical date finishes loading
  useEffect(() => {
    if (!isDataLoading && loadedDate === dateString) {
      historicalSegmentCountRef.current = isToday ? null : allSegments.length;
    }
  }, [isDataLoading, loadedDate, dateString, isToday, allSegments.length]);

  useEffect(() => {
    historicalSegmentCountRef.current = null;
  }, [dateString]);

  // Timezone-aware segment date helper
  const timezone = session?.settings?.timezone ?? undefined;
  const getSegmentDate = useCallback((timestamp: Date | string): string => {
    const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
        timeZone: timezone,
      }).formatToParts(d);
      const y = parts.find((p) => p.type === "year")?.value || "2026";
      const m = parts.find((p) => p.type === "month")?.value || "01";
      const day = parts.find((p) => p.type === "day")?.value || "01";
      return `${y}-${m}-${day}`;
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [timezone]);

  const daySegments = useMemo(() => {
    if (isDataLoading) return [];
    if (loadedDate === dateString) {
      if (!isToday && historicalSegmentCountRef.current !== null) {
        return allSegments.slice(0, historicalSegmentCountRef.current);
      }
      if (isToday) {
        return allSegments.filter((s) => !s.timestamp || getSegmentDate(s.timestamp) === dateString);
      }
      return allSegments;
    }
    return allSegments.filter((s) => s.timestamp && getSegmentDate(s.timestamp) === dateString);
  }, [allSegments, dateString, loadedDate, isDataLoading, isToday, getSegmentDate]);

  const handleCopyTranscript = useCallback(async () => {
    const finalSegments = daySegments.filter((s) => s.isFinal && s.type !== "photo");
    if (finalSegments.length === 0) {
      toast.error("No transcript to copy");
      return;
    }
    const dateLabel = isToday ? "Today" : format(date, "MMMM d, yyyy");
    const lines = finalSegments.map((s) => {
      const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `[${time}] ${s.text}`;
    });
    const text = `# Transcript — ${dateLabel}\n${lines.join("\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard", { position: "bottom-center" });
    } catch {
      toast.error("Failed to copy", { position: "bottom-center" });
    }
  }, [daySegments, isToday, date]);

  const handleDeleteTranscript = useCallback(async () => {
    if (!session?.file || !session?.transcript) return;
    if (!confirm(`Delete the transcript for ${isToday ? "today" : format(date, "MMMM d, yyyy")}? This cannot be undone.`)) return;
    await session.file.trashFile(dateString);
    await session.transcript.removeDates([dateString]);
    setLocation("/");
  }, [session?.file, session?.transcript, dateString, isToday, date, setLocation]);

  const handleEmailSend = useCallback(async (to: string, cc: string) => {
    const finalSegments = daySegments
      .filter((s) => s.isFinal && s.type !== "photo")
      .map((s) => ({
        timestamp: new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
        text: s.text,
      }));
    if (finalSegments.length === 0) throw new Error("No transcript segments to send");

    const noteDate = new Date(dateString + "T00:00:00");
    const sessionDate = noteDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const firstSeg = daySegments.find((s) => s.isFinal);
    const lastSeg = [...daySegments].reverse().find((s) => s.isFinal);
    const startTime = firstSeg ? new Date(firstSeg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";
    const endTime = lastSeg ? new Date(lastSeg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) : "";

    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;
    const res = await fetch("/api/transcript/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ to, cc: ccList, userId, date: dateString, sessionDate, sessionStartTime: startTime, sessionEndTime: endTime, segments: finalSegments }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
  }, [daySegments, dateString, userId]);

  if (!session || isReconnecting) {
    return <DayPageSkeleton />;
  }

  const currentHour = new Date().getHours();

  // Header title + time range subtitle (Paper design)
  const headerLabel = isToday ? "Today" : format(date, "MMM d");
  const finalSegs = daySegments.filter((s) => s.isFinal && s.timestamp);
  const firstSeg = finalSegs[0];
  const lastSeg = finalSegs[finalSegs.length - 1];
  const timeRangeLabel = (() => {
    if (!firstSeg || !lastSeg) return format(date, "MMMM d, yyyy");
    const start = new Date(firstSeg.timestamp);
    const end = new Date(lastSeg.timestamp);
    const startStr = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const endStr = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const mins = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
    const duration = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins} min`;
    return `${startStr} – ${endStr} · ${duration}`;
  })();

  return (
    <div className="h-full flex flex-col bg-[#FCFBFA]">
      {/* Header */}
      <div className="shrink-0 flex items-end justify-between pt-4 pb-4 px-6">
        <div className="flex items-center grow gap-3">
          <button
            onClick={() => setLocation("/")}
            className="p-1 -ml-1 text-[#1A1A1A]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex flex-col gap-3">
            <div className="text-[22px] leading-7 tracking-[-0.4px] text-[#1A1A1A] font-red-hat font-extrabold">
              {headerLabel}
            </div>
            <div className="text-[13px] leading-4 text-[#9C958D] font-red-hat">
              {timeRangeLabel}
            </div>
          </div>
        </div>
        <div className="flex pt-1 gap-3 -mb-1">
          <DropdownMenu
            align="right"
            trigger={
              <button className="p-1" aria-label="Share transcript">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
            }
            options={[
              {
                id: "email",
                label: "Email transcript",
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                ),
                onClick: () => setShowEmailDrawer(true),
              },
              {
                id: "copy",
                label: "Copy to clipboard",
                icon: (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52525B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                ),
                onClick: () => { handleCopyTranscript(); },
              },
            ]}
          />
          <button
            onClick={handleDeleteTranscript}
            className="p-1"
            aria-label="Delete transcript"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Transcript content */}
      <div className="flex-1 min-h-0 overflow-hidden px-6">
        <TranscriptTab
          segments={daySegments}
          hourSummaries={hourSummaries}
          interimText={isToday ? interimText : ""}
          currentHour={isToday ? currentHour : undefined}
          dateString={dateString}
          timezone={timezone}
          onGenerateSummary={session?.summary?.generateHourSummary}
          isCompactMode={isCompactMode}
          isSyncingPhoto={isToday ? isSyncingPhoto : false}
          isLoading={isDataLoading}
        />
      </div>

      {/* Bottom bar — transcribing status + stop/resume button (today only) */}
      {isToday && (
        <div className="flex flex-col items-center shrink-0 pt-4 pb-10 gap-3 bg-white border-t border-[#E8E5E1] px-6">
          <div className="flex items-center gap-1.5">
            <div
              className={`rounded-[3px] shrink-0 size-1.5 ${
                transcriptionPaused ? "bg-[#A8A29E]" : "bg-[#D32F2F] animate-pulse"
              }`}
            />
            <span className="text-[13px] leading-4 text-[#6B655D] font-red-hat font-medium">
              {transcriptionPaused
                ? "Paused"
                : `Transcribing · ${formatElapsed(elapsedSeconds)}`}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-center gap-1">
              {transcriptionPaused ? (
                <button
                  onClick={() => session?.settings?.updateSettings({ transcriptionPaused: false })}
                  className="w-13 h-13 flex items-center justify-center rounded-[26px] bg-[#1C1917] shrink-0"
                  aria-label="Resume transcription"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={() => setShowStopConfirm(true)}
                  className="w-13 h-13 flex items-center justify-center rounded-[26px] bg-[#D32F2F] shrink-0"
                  aria-label="Stop transcription"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF" stroke="none">
                    <rect x="4" y="4" width="16" height="16" rx="3" />
                  </svg>
                </button>
              )}
              <span
                className={`text-[11px] leading-3.5 font-red-hat font-semibold ${
                  transcriptionPaused ? "text-[#1C1917]" : "text-[#D32F2F]"
                }`}
              >
                {transcriptionPaused ? "Resume" : "Stop"}
              </span>
            </div>
          </div>
        </div>
      )}

      <StopTranscriptionDialog
        open={showStopConfirm}
        onCancel={() => setShowStopConfirm(false)}
        onConfirm={handleStopTranscription}
      />

      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => setShowEmailDrawer(false)}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel="Transcript"
      />
    </div>
  );
}
