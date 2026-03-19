/**
 * NoteRow - Individual note item with swipe-to-delete/archive
 *
 * Uses native touch events via useSwipeToReveal for smooth,
 * jank-free swipe gesture on mobile.
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
  isLast?: boolean;
}

export const NoteRow = memo(function NoteRow({
  note,
  fromLabel,
  formatNoteDate,
  stripHtmlAndTruncate,
  onSelect,
  onArchive,
  onDelete,
  isLast = false,
}: NoteRowProps) {
  const { x, handlers, handleClick } = useSwipeToReveal({
    openDistance: SWIPE_OPEN_DISTANCE,
    threshold: 0.3,
  });

  const archiveOpacity = useTransform(x, [-SWIPE_OPEN_DISTANCE * 0.3, -10], [1, 0]);
  const deleteOpacity = useTransform(x, [-SWIPE_OPEN_DISTANCE, -SWIPE_OPEN_DISTANCE * 0.3], [1, 0]);

  return (
    <div className="relative " {...handlers}>
      {/* Swipe action buttons (behind the row) */}
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
            <span className="text-[10px] leading-3 text-white font-red-hat font-semibold">Archive</span>
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
            <span className="text-[10px] leading-3 text-white font-red-hat font-semibold">Delete</span>
          </div>
        </motion.button>
      </div>

      {/* Row content */}
      <motion.div
        style={{ x }}
        onClick={() => handleClick(() => onSelect(note))}
        className={`flex flex-col py-4 gap-1 text-left bg-[#FAFAF9] relative z-10 ${
          !isLast ? "border-b border-b-[#F5F5F4]" : ""
        }`}
      >
        <div className="flex items-center gap-1.5">
          <div className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-bold truncate">
            {note.title || "Untitled Note"}
          </div>
          {note.isAIGenerated ? (
            <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#FEE2E2] shrink-0">
              <span className="text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-bold">AI</span>
            </div>
          ) : (
            <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#DBEAFE] shrink-0">
              <span className="text-[10px] leading-3.5 text-[#2563EB] font-red-hat font-semibold">
                Manual
              </span>
            </div>
          )}
        </div>
        <div className="text-[14px] leading-5 text-[#78716C] font-red-hat line-clamp-2">
          {stripHtmlAndTruncate(note.content) || "No content"}
        </div>
        <div className="text-[12px] leading-4 text-[#A8A29E] font-red-hat">
          {fromLabel || formatNoteDate(note)}
        </div>
      </motion.div>
    </div>
  );
});
