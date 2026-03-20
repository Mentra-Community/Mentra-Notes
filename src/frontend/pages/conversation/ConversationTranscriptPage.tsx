/**
 * ConversationTranscriptPage - Live transcript view for an active conversation
 *
 * Shows:
 * - Live incoming segments (final) with speaker avatars
 * - Interim text (currently being spoken) — muted, at the bottom
 * - Auto-scrolls to latest segment
 * - Bottom bar: elapsed timer + Stop button (ends transcription + conversation)
 */

import { useMemo, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import { WaveIndicator } from "../../components/shared/WaveIndicator";
import type { SessionI, TranscriptSegment } from "../../../shared/types";

/** Stable speakerId string → sequential color index */
function buildSpeakerMap(segments: TranscriptSegment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const seg of segments) {
    const id = seg.speakerId ?? "default";
    if (!map.has(id)) map.set(id, map.size);
  }
  return map;
}

const SPEAKER_COLORS = [
  { bg: "bg-[#EFF6FF]", text: "text-[#3B82F6]" },
  { bg: "bg-[#FFF7ED]", text: "text-[#F97316]" },
  { bg: "bg-[#F0FDF4]", text: "text-[#22C55E]" },
  { bg: "bg-[#FDF4FF]", text: "text-[#A855F7]" },
  { bg: "bg-[#FEF2F2]", text: "text-[#EF4444]" },
];

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ConversationTranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lockedToBottom, setLockedToBottom] = useState(true);
  const userScrollingRef = useRef(false);

  const conversation = useMemo(() => {
    return (session?.conversation?.conversations ?? []).find((c) => c.id === id) ?? null;
  }, [session?.conversation?.conversations, id]);

  const isActive = conversation?.status === "active" || conversation?.status === "paused";
  const interimText = session?.transcript?.interimText ?? "";

  // Live final segments for this conversation
  const liveSegments = useMemo(() => {
    if (!conversation) return [];
    const start = new Date(conversation.startTime).getTime();
    return (session?.transcript?.segments ?? []).filter(
      (s) => s.isFinal && s.type !== "photo" && new Date(s.timestamp).getTime() >= start,
    );
  }, [session?.transcript?.segments, conversation?.startTime]);

  const speakerMap = useMemo(() => buildSpeakerMap(liveSegments), [liveSegments]);

  // Elapsed timer from conversation startTime
  useEffect(() => {
    if (!conversation?.startTime) return;
    const start = new Date(conversation.startTime).getTime();
    const tick = () => setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [conversation?.startTime]);

  // Detect user scroll — 5s grace period before unlocking
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const getDistance = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight;
    };

    const handleTouchStart = () => { userScrollingRef.current = true; };
    const handleTouchEnd = () => { userScrollingRef.current = false; };

    const handleScroll = () => {
      const distance = getDistance();

      // Near bottom — re-lock immediately and cancel any pending unlock
      if (distance < 200) {
        if (unlockTimerRef.current) {
          clearTimeout(unlockTimerRef.current);
          unlockTimerRef.current = null;
        }
        setLockedToBottom(true);
        return;
      }

      // User scrolled away — start 5s grace period (if not already started)
      if (userScrollingRef.current && !unlockTimerRef.current && lockedToBottom) {
        unlockTimerRef.current = setTimeout(() => {
          unlockTimerRef.current = null;
          // After 5s, check if still far from bottom
          if (getDistance() > 200) {
            setLockedToBottom(false);
          } else {
            // They scrolled back — auto-scroll to bottom
            setLockedToBottom(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }, 5000);
      }
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchend", handleTouchEnd, { passive: true });
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("scroll", handleScroll);
      if (unlockTimerRef.current) clearTimeout(unlockTimerRef.current);
    };
  }, [lockedToBottom]);

  // Auto-scroll to bottom on new segments or interim text (only if locked)
  useEffect(() => {
    if (lockedToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveSegments.length, interimText, lockedToBottom]);

  const handleStop = () => {
    session?.settings?.updateSettings({ transcriptionPaused: true });
    setLocation(`/conversation/${id}`);
  };

  if (!session || !conversation) {
    return (
      <div className="flex h-full items-center justify-center bg-[#FAFAF9]">
        <span className="text-[14px] text-[#A8A29E] font-red-hat">
          {!session ? "Loading..." : "Conversation not found"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9]">
      {/* Header */}
      <div className="flex items-center gap-3 pt-6 pb-4 px-6 shrink-0">
        <button onClick={() => setLocation(`/conversation/${id}`)} className="-ml-1 p-1 shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m15 18-6-6 6-6" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex flex-col grow min-w-0">
          <div className="text-[17px] font-red-hat font-bold text-[#1C1917] leading-5 truncate">
            {conversation.title || "Live Transcript"}
          </div>
          <div className="text-[12px] font-red-hat text-[#A8A29E] leading-4 mt-0.5">
            {format(new Date(conversation.startTime), "h:mm a")} – now
          </div>
        </div>
      </div>

      {/* Segments */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-6 pb-4 relative">
        {liveSegments.length === 0 && !interimText ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <WaveIndicator color="#A8A29E" height={16} barWidth={3} gap={3} />
            <span className="text-[13px] text-[#A8A29E] font-red-hat">Listening...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5 pt-2">
            {liveSegments.map((seg) => {
              const speakerIdx = (speakerMap.get(seg.speakerId ?? "default") ?? 0) % SPEAKER_COLORS.length;
              const color = SPEAKER_COLORS[speakerIdx];
              return (
                <div key={seg.id} className="flex items-start gap-2.5">
                  <div className={`flex items-center justify-center shrink-0 rounded-full ${color.bg} size-7`}>
                    <span className={`text-[12px] font-red-hat font-bold ${color.text}`}>
                      {speakerIdx + 1}
                    </span>
                  </div>
                  <div className="flex flex-col grow shrink basis-0 pt-1 gap-0.5 min-w-0">
                    <span className={`text-[12px] leading-3.5 font-red-hat font-semibold ${color.text}`}>
                      Speaker {speakerIdx + 1} · {format(new Date(seg.timestamp), "h:mm")}
                    </span>
                    <span className="text-[14px] leading-5 text-[#3F3F46] font-red-hat">
                      {seg.text}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Interim text — currently being spoken */}
            {interimText.trim() && (
              <div className="flex items-start gap-2.5">
                <div className="flex items-center justify-center shrink-0 rounded-full bg-[#EFF6FF] size-7">
                  <span className="text-[12px] font-red-hat font-bold text-[#3B82F6]">1</span>
                </div>
                <div className="flex flex-col grow shrink basis-0 pt-1 gap-0.5 min-w-0">
                  <span className="text-[12px] leading-3.5 font-red-hat font-semibold text-[#3B82F6]">
                    Speaking...
                  </span>
                  <span className="text-[14px] leading-5 text-[#A8A29E] font-red-hat italic">
                    {interimText}
                  </span>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Jump to bottom button */}
      {!lockedToBottom && liveSegments.length > 0 && (
        <button
          onClick={() => {
            setLockedToBottom(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="absolute bottom-24 left-6 z-10 flex items-center gap-1.5 rounded-full py-2 px-3.5 bg-[#1C1917] shadow-lg active:scale-95 transition-transform"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <span className="text-[12px] font-red-hat font-semibold text-[#FAFAF9]">Latest</span>
        </button>
      )}

      {/* Bottom bar */}
      <div className="flex items-center shrink-0 pt-3.5 pb-3.5 gap-4 bg-white border-t border-[#F0EEE9] px-6">
        <div className="grow flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            {isActive ? <WaveIndicator /> : <div className="w-2 h-2 rounded-full bg-[#A8A29E]" />}
            <span className="text-[13px] font-red-hat font-semibold text-[#1C1917] leading-4">
              {isActive ? "Transcribing" : "Paused"}
            </span>
          </div>
          <span className="text-[12px] font-red-hat text-[#A8A29E] leading-4">
            {formatElapsed(elapsedSeconds)} elapsed
          </span>
        </div>

        {/* Stop button */}
        <button
          onClick={handleStop}
          className="w-13 h-13 flex items-center justify-center rounded-full bg-[#EF4444] shrink-0"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="5" y="5" width="8" height="8" rx="2" fill="#FFFFFF" />
          </svg>
        </button>
      </div>
    </div>
  );
}
