/**
 * TranscriptPage - Dedicated transcript view for a specific date.
 * UI matches the Paper design system.
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, parse } from "date-fns";
import { Upload, Mail, ClipboardCopy } from "lucide-react";
import { WaveIndicator } from "../../components/shared/WaveIndicator";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";
import { TranscriptTab } from "../day/components/tabs/TranscriptTab";
import { DropdownMenu } from "../../components/shared/DropdownMenu";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
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
  const dateMatchesServer = loadedDate === dateString;
  const isDataLoading = isLoadingHistory || isLoadingTranscript || !dateMatchesServer;

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
    if (loadedDate === dateString) {
      lastLoadedDateRef.current = dateString;
      return;
    }

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

  // Check if transcript was deleted for this date
  const transcriptDeleted = useMemo(() => {
    if (!dateString || isToday) return false;
    const files = session?.file?.files ?? [];
    const file = files.find((f) => f.date === dateString);
    return file ? (file.isTrashed || !file.hasTranscript) : false;
  }, [dateString, isToday, session?.file?.files]);

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

  const transcriptHourCount = useMemo(() => {
    const hours = new Set(
      daySegments
        .filter((s) => s.isFinal && s.timestamp)
        .map((s) => new Date(s.timestamp).getHours())
    );
    return hours.size;
  }, [daySegments]);

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
  const segmentCount = daySegments.filter((s) => s.isFinal).length;

  // Header date label
  const headerLabel = isToday ? "Today" : format(date, "MMM d");
  const headerSub = isToday && isRecording
    ? `${segmentCount} segments · ${formatElapsed(elapsedSeconds)} elapsed`
    : isToday
      ? `${segmentCount} segments recorded`
      : format(date, "MMMM d, yyyy");

  return (
    <div className="h-full flex flex-col bg-[#FAFAF9]">
      {/* Header */}
      <div className="shrink-0 pt-3 px-6">
        <div className="text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-red-hat font-bold mb-2">
          Mentra Notes
        </div>
        <div className="flex items-end justify-between pb-5">
          {/* Left: back + title */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setLocation("/?tab=transcripts")}
              className="p-1 -ml-1 text-[#1C1917]"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M13 4L7 10L13 16" stroke="#1C1917" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[30px] tracking-[-0.03em] leading-[34px] font-red-hat font-extrabold text-[#1C1917]">
                  {headerLabel}
                </span>
                {/* {isToday && isRecording && (
                  <div className="flex items-center rounded-lg py-[3px] px-2 gap-[5px] bg-[#FEF2F2]">
                    <div className="rounded-full bg-[#EF4444] size-1.5 animate-pulse" />
                    <span className="text-[11px] tracking-[0.04em] font-red-hat font-bold text-[#EF4444] leading-3.5">
                      LIVE
                    </span>
                  </div>
                )} */}
              </div>
              {transcriptHourCount > 0 && (
                <span className="text-[14px] leading-[18px] font-red-hat text-[#A8A29E]">
                  Today · {transcriptHourCount} {transcriptHourCount === 1 ? "hour" : "hours"}
                </span>
              )}
            </div>
          </div>

          {/* Right: actions */}
          
        </div>
      </div>

      {/* Live transcribing banner */}
      {/* {isToday && isRecording && (
        <div className="mx-3 mb-2.5 flex items-center shrink-0 rounded-[14px] py-3 px-4 gap-2.5 bg-[#FEF7F5] border-[1.5px] border-[#F5C9BC]">
          <div className="flex items-center grow gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 3C2 2.45 2.45 2 3 2h8C11.55 2 12 2.45 12 3v6c0 .55-.45 1-1 1H8L6 12V10H3c-.55 0-1-.45-1-1V3z" fill="#C9573A" />
            </svg>
            <div className="flex flex-col">
              <span className="text-[13px] font-red-hat font-semibold text-[#C9573A] leading-4">
                Transcribing now
              </span>
              <span className="text-[11px] font-red-hat text-[#A8A29E] leading-3.5">
                {segmentCount} segments · will link to a conversation
              </span>
            </div>
          </div>
          <div className="flex items-center justify-center rounded-full bg-white border border-[#E7E5E0] size-[30px] shrink-0">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="3" y="3" width="6" height="6" rx="1" fill="#1C1917" />
            </svg>
          </div>
        </div>
      )} */}

      {/* Transcript content */}
      <div className="flex-1 min-h-0 overflow-hidden px-6">
        {transcriptDeleted ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#FEF2F2]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold">Transcript deleted</span>
            <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat text-center max-w-[240px]">
              The transcript data for this day has been permanently deleted.
            </span>
          </div>
        ) : (
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
        )}
      </div>

      {/* Bottom bar — shown when recording (active or paused) */}
      {isToday && (
        <div className="flex items-center shrink-0 pt-3.5 pb-5 gap-4 bg-white border-t border-[#F0EEE9] px-6">
          <div className="grow flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              {transcriptionPaused ? (
                <div className="w-2 h-2 rounded-full bg-[#A8A29E]" />
              ) : (
                <WaveIndicator />
              )}
              <span className="text-[13px] font-red-hat font-semibold text-[#1C1917] leading-4">
                {transcriptionPaused ? "Paused" : "Transcribing"}
              </span>
            </div>
            <span className="text-[12px] font-red-hat text-[#A8A29E] leading-4">
              {transcriptionPaused
                ? "Microphone is turned off"
                : `${formatElapsed(elapsedSeconds)} elapsed`}
            </span>
          </div>
          {transcriptionPaused ? (
            <button
              onClick={() => session?.settings?.updateSettings({ transcriptionPaused: false })}
              className="w-13 h-13 flex items-center justify-center rounded-full bg-[#1C1917] shrink-0"
            >
              {/* Mic off */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            </button>
          ) : (
            <button
              onClick={() => setShowStopConfirm(true)}
              className="w-13 h-13 flex items-center justify-center rounded-full bg-[#DC2626] shrink-0"
            >
              {/* Mic on */}
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#FFFFFF" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="19" x2="12" y2="23" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
