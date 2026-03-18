/**
 * ConversationDetailPage - Full conversation view with summary + transcript
 *
 * Shows:
 * - Header with title, time range, duration
 * - AI summary section
 * - Generate Note button
 * - Transcript with speaker-colored chunks
 * - "View full transcript" expand toggle
 */

import { useMemo, useState, useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import { WaveIndicator } from "../../components/shared/WaveIndicator";
import type { SessionI, Conversation, ConversationChunk, ConversationSegment, TranscriptSegment } from "../../../shared/types";

/** Stable speakerId string → sequential color index (first seen = 0, second = 1, …) */
function buildSpeakerMap(segments: (TranscriptSegment | ConversationSegment)[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const seg of segments) {
    const id = seg.speakerId ?? "default";
    if (!map.has(id)) map.set(id, map.size);
  }
  return map;
}


// Speaker color palette (cycles for multiple speakers)
const SPEAKER_COLORS = [
  { bg: "bg-[#EFF6FF]", text: "text-[#3B82F6]" }, // Blue
  { bg: "bg-[#FFF7ED]", text: "text-[#F97316]" }, // Orange
  { bg: "bg-[#F0FDF4]", text: "text-[#22C55E]" }, // Green
  { bg: "bg-[#FDF4FF]", text: "text-[#A855F7]" }, // Purple
  { bg: "bg-[#FEF2F2]", text: "text-[#EF4444]" }, // Red
];

function getDurationMinutes(conv: Conversation): number | null {
  if (!conv.endTime) return null;
  const start = new Date(conv.startTime).getTime();
  const end = new Date(conv.endTime).getTime();
  return Math.round((end - start) / 60000);
}

function formatTimeRange(conv: Conversation): string {
  const start = format(new Date(conv.startTime), "h:mm a");
  if (!conv.endTime) return `${start} – now`;
  const end = format(new Date(conv.endTime), "h:mm a");
  return `${start} – ${end}`;
}

function getTotalDuration(chunks: ConversationChunk[]): string {
  if (chunks.length === 0) return "0:00";
  const first = new Date(chunks[0].startTime).getTime();
  const last = new Date(chunks[chunks.length - 1].endTime).getTime();
  const totalSec = Math.round((last - first) / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

export function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const [showFullTranscript, setShowFullTranscript] = useState(false);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);

  // Find conversation from session state
  const conversation = useMemo(() => {
    const conversations = session?.conversation?.conversations ?? [];
    return conversations.find((c) => c.id === id) ?? null;
  }, [session?.conversation?.conversations, id]);

  const isActive = conversation?.status === "active";

  // Live segments filtered to this conversation's time range
  const liveSegments = useMemo(() => {
    if (!conversation || !isActive) return [];
    const allSegments: TranscriptSegment[] = session?.transcript?.segments ?? [];
    const start = new Date(conversation.startTime).getTime();
    return allSegments.filter(
      (s) => s.isFinal && s.type !== "photo" && new Date(s.timestamp).getTime() >= start,
    );
  }, [session?.transcript?.segments, conversation?.startTime, isActive]);

  // Stable speaker ID → color index map for live segments
  const liveSpeakerMap = useMemo(() => buildSpeakerMap(liveSegments), [liveSegments]);

  // Preview: last 2 live segments shown on detail page
  const previewSegments = useMemo(() => liveSegments.slice(-2), [liveSegments]);

  // No auto-scroll on detail page — active state is non-scrollable
  useEffect(() => { void transcriptBottomRef; }, []);

  if (!session || !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FAFAF9]">
        <div className={`text-[16px] text-[#A8A29E] font-red-hat`}>
          {!session ? "Loading..." : "Conversation not found"}
        </div>
      </div>
    );
  }

  const duration = getDurationMinutes(conversation);
  const timeRange = formatTimeRange(conversation);
  const chunks = conversation.chunks ?? [];
  const totalDuration = getTotalDuration(chunks);

  // Segments with speaker IDs for ended conversations
  const endedSegments = conversation.segments ?? [];
  const displaySegments = showFullTranscript ? endedSegments : endedSegments.slice(0, 8);

  // Speaker map for ended conversation segments
  const endedSpeakerMap = useMemo(() => buildSpeakerMap(endedSegments), [endedSegments]);

  const handleBack = () => {
    setLocation("/");
  };

  const handleGenerateNote = async () => {
    if (!session?.notes) return;
    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];
    await session.notes.generateNote(
      conversation.title || undefined,
      firstChunk ? new Date(firstChunk.startTime) : undefined,
      lastChunk ? new Date(lastChunk.endTime) : undefined,
    );
    // Navigate to day page to see the note
    setLocation(`/day/${conversation.date}`);
  };

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
      {/* Header */}
      <div className="flex items-start pt-3 pb-4 gap-3 px-6 shrink-0">
        <button onClick={handleBack} className="shrink-0 mt-1 -ml-2 p-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m15 18-6-6 6-6" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex flex-col grow shrink basis-0 gap-1 min-w-0">
          <div className={`text-[22px] tracking-[-0.02em] leading-[26px] text-[#1C1917] font-red-hat font-extrabold max-w-[90%]`}>
            {conversation.title || "Untitled Conversation"}
          </div>
          <div className={`text-[13px] leading-4 text-[#A8A29E] font-red-hat`}>
            {timeRange}
            {duration !== null ? ` · ${duration} min` : ""}
          </div>
        </div>

        {/* Share + More buttons */}
        <div className="flex  shrink-0 mt-10 gap-2 ">
          <button className="p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" stroke="#52525B" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="16,6 12,2 8,6" stroke="#52525B" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="12" y1="2" x2="12" y2="15" stroke="#52525B" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
          <button className="p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="6" r="1.5" fill="#52525B" />
              <circle cx="12" cy="12" r="1.5" fill="#52525B" />
              <circle cx="12" cy="18" r="1.5" fill="#52525B" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content — non-scrollable when active, scrollable when ended */}
      <div className={`flex flex-col grow min-h-0 gap-7 px-6 pb-12 ${isActive ? "overflow-hidden" : "overflow-y-auto"}`}>
        {/* Summary section */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <div className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#A8A29E] font-red-hat font-bold`}>
              Summary
            </div>
            <div className="flex items-center rounded-sm py-0.5 px-2 gap-1 bg-[#FEE2E2]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l2.09 6.26L20.18 9l-4.91 3.74L17.18 19 12 15.27 6.82 19l1.91-6.26L3.82 9l6.09-.74z" fill="#DC2626" />
              </svg>
              <div className={`text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-bold`}>
                AI
              </div>
            </div>
          </div>

          {isActive ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <WaveIndicator color="#A8A29E" height={16} barWidth={3} gap={3} />
              <p className={`text-[13px] leading-5 text-[#A8A29E] font-red-hat text-center`}>
                Waiting for conversation to end{"\n"}to generate AI summary
              </p>
            </div>
          ) : conversation.generatingSummary ? (
            <div className="flex items-center gap-2 py-4">
              <div className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-pulse" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-pulse [animation-delay:150ms]" />
              <div className="w-1.5 h-1.5 rounded-full bg-[#A8A29E] animate-pulse [animation-delay:300ms]" />
              <span className={`text-[14px] text-[#A8A29E] font-red-hat`}>Generating summary...</span>
            </div>
          ) : conversation.aiSummary ? (
            <div className={`text-[15px] leading-[22px] text-[#44403C] font-red-hat whitespace-pre-wrap`}>
              {conversation.aiSummary}
            </div>
          ) : (
            <div className={`text-[14px] leading-5 text-[#A8A29E] font-red-hat`}>
              No summary available
            </div>
          )}

          {/* Generate Note button — only when conversation has ended */}
          {!isActive && (
            <button
              onClick={handleGenerateNote}
              className="flex items-center justify-center w-full h-14 rounded-2xl bg-[#1C1917] shrink-0 active:scale-[0.98] transition-transform"
            >
              <span className={`text-[16px] leading-5 text-[#FAFAF9] font-red-hat font-semibold`}>
                Generate Note
              </span>
            </button>
          )}
        </div>

        {/* Transcript section — live segments when active, chunks when ended */}
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <div className={`text-[11px] leading-3.5 tracking-widest uppercase text-[#A8A29E] font-red-hat font-bold`}>
              Transcript
            </div>
            {!isActive && chunks.length > 0 && (
              <div className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat font-medium`}>
                {totalDuration} total
              </div>
            )}
          </div>

          {isActive ? (
            <div className="flex flex-col gap-3.5">
              {previewSegments.length > 0 ? (
                previewSegments.map((seg) => {
                  const speakerIdx = (liveSpeakerMap.get(seg.speakerId ?? "default") ?? 0) % SPEAKER_COLORS.length;
                  const color = SPEAKER_COLORS[speakerIdx];
                  return (
                    <div key={seg.id} className="flex items-start gap-2.5">
                      <div className={`flex items-center justify-center shrink-0 rounded-full ${color.bg} size-7`}>
                        <span className={`text-[12px] leading-3.5 ${color.text} font-red-hat font-bold`}>
                          {speakerIdx + 1}
                        </span>
                      </div>
                      <div className="flex flex-col grow shrink basis-0 pt-1 gap-0.5 min-w-0">
                        <span className={`text-[12px] leading-3.5 ${color.text} font-red-hat font-semibold`}>
                          Speaker {speakerIdx + 1} · {format(new Date(seg.timestamp), "h:mm")}
                        </span>
                        <span className={`text-[14px] leading-5 text-[#3F3F46] font-red-hat`}>
                          {seg.text}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <span className={`text-[13px] text-[#A8A29E] font-red-hat`}>Listening...</span>
              )}
              {/* View transcript link — always shown when active */}
              <button
                onClick={() => setLocation(`/conversation/${id}/transcript`)}
                className="flex items-center gap-1.5 pt-1"
              >
                <span className="text-[13px] leading-4 text-[#71717A] font-red-hat font-medium">
                  View transcript
                </span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
          ) : endedSegments.length > 0 ? (
            <>
              {displaySegments.map((seg) => {
                const speakerIdx = (endedSpeakerMap.get(seg.speakerId ?? "default") ?? 0) % SPEAKER_COLORS.length;
                const color = SPEAKER_COLORS[speakerIdx];
                const segTime = format(new Date(seg.timestamp), "h:mm");
                return (
                  <div key={seg.id} className="flex items-start gap-2.5">
                    <div className={`flex items-center justify-center shrink-0 rounded-full ${color.bg} size-7`}>
                      <div className={`text-[12px] leading-3.5 ${color.text} font-red-hat font-bold`}>
                        {speakerIdx + 1}
                      </div>
                    </div>
                    <div className="flex flex-col grow shrink basis-0 pt-1 gap-0.5 min-w-0">
                      <div className={`text-[12px] leading-3.5 ${color.text} font-red-hat font-semibold`}>
                        Speaker {speakerIdx + 1} · {segTime}
                      </div>
                      <div className={`text-[14px] leading-5 text-[#3F3F46] font-red-hat`}>
                        {seg.text}
                      </div>
                    </div>
                  </div>
                );
              })}
              {endedSegments.length > 8 && (
                <button
                  onClick={() => setShowFullTranscript(!showFullTranscript)}
                  className="flex items-center justify-center pt-3 gap-1.5"
                >
                  <span className={`text-[13px] leading-4 text-[#71717A] font-red-hat font-medium`}>
                    {showFullTranscript ? "Show less" : `View full transcript (${endedSegments.length} segments)`}
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#71717A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${showFullTranscript ? "rotate-180" : ""}`}>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              )}
            </>
          ) : (
            <div className={`text-[13px] text-[#A8A29E] font-red-hat`}>
              No transcript recorded
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
