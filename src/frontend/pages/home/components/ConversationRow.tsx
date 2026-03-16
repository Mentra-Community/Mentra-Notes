/**
 * ConversationRow - Individual conversation item in the list
 *
 * Displays: time | title + metadata (duration, transcribing status) | chevron
 * Active conversations show red styling with "Transcribing now" badge.
 */

import { format } from "date-fns";
import { motion, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useRef, useState } from "react";
import type { Conversation } from "../../../../shared/types";

const FONT = "font-['Red_Hat_Display',system-ui,sans-serif]";
const SWIPE_THRESHOLD = 80;

interface ConversationRowProps {
  conversation: Conversation;
  onSelect: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDelete?: (conversation: Conversation) => void;
  isLast?: boolean;
}

function getDurationMinutes(conversation: Conversation): number | null {
  if (!conversation.endTime) return null;
  const start = new Date(conversation.startTime).getTime();
  const end = new Date(conversation.endTime).getTime();
  return Math.round((end - start) / 60000);
}

export function ConversationRow({
  conversation,
  onSelect,
  onArchive,
  onDelete,
  isLast = false,
}: ConversationRowProps) {
  const isActive = conversation.status === "active";
  const startTime = new Date(conversation.startTime);
  const duration = getDurationMinutes(conversation);
  const x = useMotionValue(0);
  const [isSwiped, setIsSwiped] = useState(false);
  const constraintsRef = useRef<HTMLDivElement>(null);

  // Map swipe offset to action button widths
  const archiveOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20], [1, 0]);
  const deleteOpacity = useTransform(x, [-SWIPE_THRESHOLD * 2, -SWIPE_THRESHOLD], [1, 0]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE_THRESHOLD) {
      setIsSwiped(true);
    } else {
      setIsSwiped(false);
    }
  };

  const handleTap = () => {
    if (isSwiped) {
      setIsSwiped(false);
    } else {
      onSelect(conversation);
    }
  };

  return (
    <div className="relative overflow-hidden" ref={constraintsRef}>
      {/* Swipe action buttons (behind the row) */}
      <div className="absolute inset-y-0 right-0 flex">
        <motion.button
          style={{ opacity: archiveOpacity }}
          onClick={() => onArchive?.(conversation)}
          className="flex items-center justify-center w-[72px] bg-[#1C1917]"
        >
          <div className="flex flex-col items-center gap-[3px]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M21 8v13H3V8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="1" y="3" width="22" height="5" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M10 12h4" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={`text-[10px] leading-3 text-white ${FONT} font-semibold`}>Archive</span>
          </div>
        </motion.button>
        <motion.button
          style={{ opacity: deleteOpacity }}
          onClick={() => onDelete?.(conversation)}
          className="flex items-center justify-center w-[74px] bg-[#DC2626]"
        >
          <div className="flex flex-col items-center gap-[3px]">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M3 6h18" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className={`text-[10px] leading-3 text-white ${FONT} font-semibold`}>Delete</span>
          </div>
        </motion.button>
      </div>

      {/* Draggable row content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -146, right: 0 }}
        dragElastic={0.1}
        style={{ x }}
        animate={{ x: isSwiped ? -146 : 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onDragEnd={handleDragEnd}
        onTap={handleTap}
        className={`flex items-center py-3.5 gap-3.5 bg-[#FAFAF9] relative z-10 ${
          !isLast ? (isActive ? "border-b border-b-[#FEE2E2]" : "border-b border-b-[#F5F5F4]") : ""
        }`}
      >
        {/* Time column */}
        <div className="flex flex-col items-center shrink-0 w-10">
          <div
            className={`text-[14px] leading-[18px] ${FONT} font-semibold ${
              isActive ? "text-[#DC2626]" : "text-[#1C1917]"
            }`}
          >
            {format(startTime, "h:mm")}
          </div>
          <div
            className={`text-[11px] leading-3.5 ${FONT} ${
              isActive ? "text-[#DC2626] opacity-60" : "text-[#A8A29E]"
            }`}
          >
            {format(startTime, "a")}
          </div>
        </div>

        {/* Content column */}
        <div className="flex flex-col grow shrink basis-0 gap-1.5 min-w-0">
          <div className={`text-[16px] leading-5 ${FONT} font-semibold text-[#1C1917] truncate`}>
            {conversation.title}
          </div>
          <div className="flex items-center gap-2">
            {isActive ? (
              <div className="flex items-center rounded-md py-[3px] px-2 gap-[5px] bg-[#FEE2E2]">
                <div className="flex items-center h-3 gap-px">
                  <div className="w-0.5 h-1.5 rounded-[1px] bg-[#DC2626] shrink-0 animate-pulse" />
                  <div className="w-0.5 h-2.5 rounded-[1px] bg-[#DC2626] shrink-0 animate-pulse [animation-delay:150ms]" />
                  <div className="w-0.5 h-[5px] rounded-[1px] bg-[#DC2626] shrink-0 animate-pulse [animation-delay:300ms]" />
                </div>
                <span className={`text-[12px] leading-4 text-[#DC2626] ${FONT} font-semibold`}>
                  Transcribing now
                </span>
              </div>
            ) : duration !== null ? (
              <div className="rounded-md py-[3px] px-2 bg-[#F5F5F4]">
                <span className={`text-[11px] leading-3.5 text-[#78716C] ${FONT} font-medium`}>
                  {duration} min
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Chevron */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <path d="m9 18 6-6-6-6" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </motion.div>
    </div>
  );
}
