/**
 * TranscriptList - List of transcript dates for the Transcripts tab.
 * Loads 20 at a time, with more loaded on scroll.
 *
 * Supports multi-select mode: shows checkbox per row,
 * tap toggles selection. Live transcript dates cannot be selected.
 */

import { useState, useRef, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import type { FileData } from "../../../../shared/types";
import { WaveIndicator } from "../../../components/shared/WaveIndicator";

const PAGE_SIZE = 20;

interface TranscriptListProps {
  availableDates: string[];
  files: FileData[];
  isRecording: boolean;
  transcriptionPaused: boolean;
  onSelect: (dateStr: string) => void;
  /** Multi-select props */
  isSelecting?: boolean;
  selectedDates?: Set<string>;
  onToggleSelect?: (dateStr: string) => void;
  longPressProps?: (id: string, disabled?: boolean) => {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
  };
}

export function TranscriptList({
  availableDates,
  files,
  isRecording,
  transcriptionPaused,
  onSelect,
  isSelecting = false,
  selectedDates,
  onToggleSelect,
  longPressProps,
}: TranscriptListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const observer = useRef<IntersectionObserver | null>(null);

  const sorted = [...availableDates].sort((a, b) => b.localeCompare(a));
  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const lastItemRef = useCallback(
    (node: HTMLButtonElement | HTMLDivElement | null) => {
      if (observer.current) observer.current.disconnect();
      if (!node || !hasMore) return;
      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sorted.length));
        }
      });
      observer.current.observe(node);
    },
    [hasMore, sorted.length],
  );

  if (availableDates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        <span className="text-[14px] text-[#A8A29E] font-red-hat">No transcripts yet</span>
      </div>
    );
  }

  return (
    <>
      {visible.map((dateStr, i) => {
        const [year, month, day] = dateStr.split("-").map(Number);
        const dateObj = new Date(year, month - 1, day);
        const today = isToday(dateObj);
        const yesterday = isYesterday(dateObj);
        const label = today ? "Today" : yesterday ? "Yesterday" : format(dateObj, "EEE, MMM d");
        const file = files.find((f) => f.date === dateStr);
        const segCount = file?.transcriptSegmentCount ?? 0;
        const hourCount = file?.transcriptHourCount ?? 0;
        const isLive = today && isRecording && !transcriptionPaused;
        const isLast = i === visible.length - 1;
        const isSelected = selectedDates?.has(dateStr) ?? false;
        const canSelect = !isLive; // Can't select live transcript

        const lpHandlers = longPressProps?.(dateStr, !canSelect);

        if (isSelecting) {
          return (
            <div
              key={dateStr}
              ref={isLast ? lastItemRef : undefined}
              onClick={() => { if (canSelect) onToggleSelect?.(dateStr); }}
              className={`flex items-center py-4 gap-3 w-full text-left select-none ${
                isSelected ? "bg-[#FEE2E24D]  " : ""
              } ${!canSelect ? "opacity-40" : ""} ${
                i < visible.length - 1 ? "border-b border-[#F5F5F4]" : ""
              }`}
            >
              {/* Checkbox */}
              {canSelect && (
                <div
                  className="shrink-0 overflow-hidden"
                  style={{ width: 22 }}
                >
                  {isSelected ? (
                    <div className="flex items-center justify-center w-[22px] h-[22px] rounded-md bg-[#DC2626]">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                        <polyline points="6,12 10,16 18,8" stroke="#FAFAF9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-[22px] h-[22px] rounded-md border-2 border-[#D6D3D1]" />
                  )}
                </div>
              )}

              {/* Mic icon */}
              <div className={`flex items-center justify-center shrink-0 rounded-xl size-10 ${today ? "bg-[#FEE2E2]" : "bg-[#F5F5F4]"}`}>
                {isLive ? (
                  <WaveIndicator color="#DC2626" height={16} barWidth={3} gap={2.5} />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={today ? "#DC2626" : "#78716C"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="23" />
                    <line x1="8" y1="23" x2="16" y2="23" />
                  </svg>
                )}
              </div>
              {/* Content */}
              <div className="flex flex-col grow shrink basis-0 gap-0.5 min-w-0">
                <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold">
                  {label}
                </span>
                <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat">
                  {segCount} segments{hourCount > 0 ? ` · ${hourCount} ${hourCount === 1 ? "hour" : "hours"}` : ""}
                </span>
              </div>
            </div>
          );
        }

        // Normal mode
        return (
          <button
            key={dateStr}
            ref={isLast ? lastItemRef : undefined}
            onClick={() => onSelect(dateStr)}
            className={`flex items-center py-4 gap-3 w-full text-left select-none ${
              i < visible.length - 1 ? "border-b border-[#F5F5F4]" : ""
            }`}
            {...(lpHandlers || {})}
          >
            {/* Mic icon / Wave indicator */}
            <div className={`flex items-center justify-center shrink-0 rounded-xl size-10 ${today ? "bg-[#FEE2E2]" : "bg-[#F5F5F4]"}`}>
              {isLive ? (
                <WaveIndicator color="#DC2626" height={16} barWidth={3} gap={2.5} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={today ? "#DC2626" : "#78716C"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              )}
            </div>
            {/* Content */}
            <div className="flex flex-col grow shrink basis-0 gap-0.5 min-w-0">
              <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold">
                {label}
              </span>
              <span className="text-[13px] leading-4 text-[#A8A29E] font-red-hat">
                {segCount} segments{hourCount > 0 ? ` · ${hourCount} ${hourCount === 1 ? "hour" : "hours"}` : ""}
              </span>
            </div>
            {/* Chevron */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
              <path d="m9 18 6-6-6-6" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        );
      })}
    </>
  );
}
