/**
 * NoteRow — Single note row with red left rail (Paper spec).
 *
 * Multi-select supported: tap toggles selection; long-press triggers selection
 * via the parent's `useMultiSelect` handlers. No swipe actions, no badges,
 * no archive/trash affordances — deletion goes through multi-select only.
 */

import { motion } from "motion/react";
import { memo } from "react";
import type { Note } from "../../../shared/types";

interface NoteRowProps {
  note: Note;
  /** Pre-formatted meta string like "Today, 2:10 PM" */
  meta: string;
  stripHtmlAndTruncate: (html: string | undefined, maxWords?: number) => string;
  onSelect: (note: Note) => void;
  /** Multi-select props */
  isSelecting?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  longPressHandlers?: {
    onTouchStart: (e: React.TouchEvent) => void;
    onTouchEnd: () => void;
    onTouchMove: () => void;
  };
}

export const NoteRow = memo(function NoteRow({
  note,
  meta,
  stripHtmlAndTruncate,
  onSelect,
  isSelecting = false,
  isSelected = false,
  onToggleSelect,
  longPressHandlers,
}: NoteRowProps) {
  const handleClick = () => {
    if (isSelecting) {
      onToggleSelect?.();
    } else {
      onSelect(note);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-start py-4 pl-6 pr-6 gap-3.5 border-t border-[#F0EDEA] border-l-[3px] border-l-[#D32F2F] select-none cursor-pointer transition-colors duration-200 ${
        isSelecting && isSelected ? "bg-[#FEE2E24D]" : "bg-transparent"
      }`}
      {...(!isSelecting ? longPressHandlers || {} : {})}
    >
      {/* Checkbox slot — only mounted in selection mode so the `gap-3.5`
          doesn't reserve phantom space when hidden. */}
      {isSelecting && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 22, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          className="shrink-0 overflow-hidden mt-1"
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
        </motion.div>
      )}

      {/* Content */}
      <div className="flex flex-col grow shrink basis-0 gap-1.5 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="tracking-[-0.2px] text-[#1A1A1A] font-red-hat font-bold text-[17px] leading-[22px] truncate">
            {note.title || "Untitled Note"}
          </div>
        </div>
        <div className="text-[#6B655D] font-red-hat text-[13px] leading-[18px] line-clamp-2">
          {stripHtmlAndTruncate(note.content) || "No content"}
        </div>
        <div className="flex items-center pt-0.5 gap-1.5">
          <div className="text-[#B0AAA2] font-red-hat font-medium text-[11px] leading-3.5">
            {meta}
          </div>
        </div>
      </div>

      {/* Chevron — hidden in selection mode (like TranscriptList) */}
      {!isSelecting && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#C5C0B8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 mt-1"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </div>
  );
});
