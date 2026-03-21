/**
 * NoteRow - Individual note item with swipe-to-delete/archive
 *
 * Uses native touch events via useSwipeToReveal for smooth,
 * jank-free swipe gesture on mobile.
 *
 * Supports multi-select mode: shows checkbox, disables swipe,
 * tap toggles selection instead of navigating.
 */

import { motion, useTransform } from "motion/react";
import { memo } from "react";
import type { Note } from "../../../shared/types";
import { useSwipeToReveal } from "../../hooks/useSwipeToReveal";

const SWIPE_OPEN_DISTANCE = 146;

interface NoteRowProps {
  note: Note;
  fromLabel: string | null;
  formatNoteDate: (note: Note) => string;
  stripHtmlAndTruncate: (html: string | undefined, maxWords?: number) => string;
  onSelect: (note: Note) => void;
  onArchive?: (note: Note) => void;
  onDelete?: (note: Note) => void;
  archiveLabel?: string;
  deleteLabel?: string;
  isLast?: boolean;
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
  fromLabel,
  formatNoteDate,
  stripHtmlAndTruncate,
  onSelect,
  onArchive,
  onDelete,
  archiveLabel = "Archive",
  deleteLabel = "Trash",
  isLast = false,
  isSelecting = false,
  isSelected = false,
  onToggleSelect,
  longPressHandlers,
}: NoteRowProps) {
  const { x, handlers, handleClick } = useSwipeToReveal({
    openDistance: SWIPE_OPEN_DISTANCE,
    threshold: 0.3,
  });

  const archiveOpacity = useTransform(x, [-SWIPE_OPEN_DISTANCE * 0.3, -10], [1, 0]);
  const deleteOpacity = useTransform(x, [-SWIPE_OPEN_DISTANCE, -SWIPE_OPEN_DISTANCE * 0.3], [1, 0]);

  // In selection mode: tap toggles, no swipe
  const rowClick = isSelecting
    ? () => onToggleSelect?.()
    : () => handleClick(() => onSelect(note));

  // Merge swipe + long-press touch handlers so neither overwrites the other
  const mergedTouchHandlers = (() => {
    if (isSelecting) return {};
    const swipe = handlers;
    const lp = longPressHandlers;
    if (!lp) return swipe;
    return {
      onTouchStart: (e: React.TouchEvent) => { swipe.onTouchStart?.(e); lp.onTouchStart(e); },
      onTouchEnd: (e: React.TouchEvent) => { swipe.onTouchEnd?.(e); lp.onTouchEnd(); },
      onTouchMove: (e: React.TouchEvent) => { swipe.onTouchMove?.(e); lp.onTouchMove(); },
    };
  })();

  return (
    <div
      className="relative"
      {...mergedTouchHandlers}
    >
      {/* Swipe action buttons (behind the row) — hidden in selection mode */}
      {!isSelecting && (
        <div className="absolute inset-y-0 right-0 flex">
          <motion.button
            style={{ opacity: archiveOpacity }}
            onClick={() => onArchive?.(note)}
            className="flex items-center justify-center w-[72px] bg-[#1C1917]"
          >
            <div className="flex flex-col items-center gap-[3px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M21 8v13H3V8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <rect x="1" y="3" width="22" height="5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M10 12h4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px] leading-3 text-white font-red-hat font-semibold">{archiveLabel}</span>
            </div>
          </motion.button>
          <motion.button
            style={{ opacity: deleteOpacity }}
            onClick={() => onDelete?.(note)}
            className="flex items-center justify-center w-[74px] bg-[#DC2626]"
          >
            <div className="flex flex-col items-center gap-[3px]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[10px] leading-3 text-white font-red-hat font-semibold">{deleteLabel}</span>
            </div>
          </motion.button>
        </div>
      )}

      {/* Row content */}
      <motion.div
        style={isSelecting ? undefined : { x }}
        onClick={rowClick}
        className={`flex items-start py-3.5 text-left relative z-10 select-none ${
          isSelected ? "bg-[#FEE2E24D] px-6 -mx-6" : "bg-[#FAFAF9]"
        } ${!isLast ? "border-b border-b-[#E7E5E4]" : ""}`}
      >
        {/* Checkbox */}
        <div
          className="shrink-0 mt-px overflow-hidden"
          style={{ width: isSelecting ? 22 : 0 }}
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

        {/* Content */}
        <div className={`flex flex-col gap-1 min-w-0 ${isSelecting ? 'pl-3' : 'pl-0'}`}>
          <div className="flex items-center gap-1.5">
            <div className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-bold truncate">
              {note.title || "Untitled Note"}
            </div>
            {note.isFavourite && (
              <span className="text-[#DC2626] font-red-hat text-sm leading-3.5">★</span>
            )}
            {note.isAIGenerated ? (
              <div className="flex items-center rounded-sm py-0.5 px-2 gap-1 bg-[#FEE2E2] shrink-0">
               
                <span className="text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-bold">AI</span>
              </div>
            ) : (
              <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#F5F5F4] border border-[#D6D3D1] shrink-0">
                <span className="text-[10px] leading-3.5 text-[#78716C] font-red-hat font-semibold">
                  Manual
                </span>
              </div>
            )}
          </div>
          <div className="text-[13px] leading-[18px] text-[#78716C] font-red-hat line-clamp-2">
            {stripHtmlAndTruncate(note.content) || "No content"}
          </div>
          <div className="text-[11px] leading-3.5 text-[#A8A29E] font-red-hat font-medium">
            {fromLabel || formatNoteDate(note)}
          </div>
        </div>
      </motion.div>
    </div>
  );
});
