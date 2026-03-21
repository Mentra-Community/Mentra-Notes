/**
 * MultiSelectBar — Fixed bottom action bar during multi-select mode
 *
 * Replaces the tab bar. Shows contextual actions (Export, Move, Favorite, Delete).
 * Actions vary by context: notes get all 4, conversations get 3 (no Move),
 * transcripts get 2 (Export + Delete only).
 */

import { motion } from "motion/react";
import type { ReactNode } from "react";

export interface MultiSelectAction {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}

interface MultiSelectBarProps {
  actions: MultiSelectAction[];
}

export function MultiSelectBar({ actions }: MultiSelectBarProps) {
  return (
    <motion.div
      initial={{ y: 80 }}
      animate={{ y: 0 }}
      exit={{ y: 80 }}
      transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around pt-3.5 pb-10 bg-[#FAFAF9] border-t border-t-[#E7E5E4] px-6"
    >
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          className="flex flex-col items-center gap-1"
        >
          {action.icon}
          <span
            className={`text-[11px] leading-3.5 font-red-hat font-semibold ${
              action.variant === "danger" ? "text-[#DC2626]" : "text-[#1C1917]"
            }`}
          >
            {action.label}
          </span>
        </button>
      ))}
    </motion.div>
  );
}

// ── Pre-built icon components for actions ──

export function ExportIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="16 6 12 2 8 6" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="12" y1="2" x2="12" y2="15" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MoveIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function FavoriteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.09 6.26L20.18 9l-4.91 3.74L17.18 19 12 15.27 6.82 19l1.91-6.26L3.82 9l6.09-.74z" stroke="#1C1917" strokeWidth="1.75" fill="none" />
    </svg>
  );
}

export function DeleteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <polyline points="3 6 5 6 21 6" stroke="#DC2626" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#DC2626" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
