/**
 * FABMenu - Expandable floating action button
 *
 * Default: Red "+" button
 * Expanded: X close button + stacked action pills (Ask AI, Add manual note, Stop/Resume transcribing)
 *
 * Uses CSS transitions only (no framer-motion) for zero-lag first press.
 */

import { useState } from "react";

interface FABMenuProps {
  transcriptionPaused: boolean;
  onAskAI: () => void;
  onAddNote: () => void;
  onStopTranscribing: () => void;
  onResumeTranscribing: () => void;
}

export function FABMenu({
  transcriptionPaused,
  onAskAI,
  onAddNote,
  onStopTranscribing,
  onResumeTranscribing,
}: FABMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  const actions = [
    transcriptionPaused
      ? {
          id: "resume",
          label: "Resume transcribing",
          onClick: () => { onResumeTranscribing(); setIsOpen(false); },
          bg: "bg-[#F0FDF4]",
          textColor: "text-[#16A34A]",
          fontWeight: "font-bold",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#16A34A" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="23" stroke="#16A34A" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ),
        }
      : {
          id: "stop",
          label: "Stop transcribing",
          onClick: () => { onStopTranscribing(); setIsOpen(false); },
          bg: "bg-[#FEE2E2]",
          textColor: "text-[#DC2626]",
          fontWeight: "font-bold",
          icon: (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill="#DC2626" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="19" x2="12" y2="23" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />
            </svg>
          ),
        },
    {
      id: "note",
      label: "Add manual note",
      onClick: () => { onAddNote(); setIsOpen(false); },
      bg: "bg-[#FAFAF9]",
      textColor: "text-[#1C1917]",
      fontWeight: "font-semibold",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="12" y1="11" x2="12" y2="17" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" />
          <line x1="9" y1="14" x2="15" y2="14" stroke="#1C1917" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      ),
    },
    {
      id: "ai",
      label: "Ask AI",
      onClick: () => { onAskAI(); setIsOpen(false); },
      bg: "bg-[#FAFAF9]",
      textColor: "text-[#1C1917]",
      fontWeight: "font-semibold",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M12 2l2.09 6.26L20.18 9l-4.91 3.74L17.18 19 12 15.27 6.82 19l1.91-6.26L3.82 9l6.09-.74z" stroke="#1C1917" strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
      ),
    },
  ];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setIsOpen(false)}
        className="fixed inset-0 z-40"
        style={{
          backgroundColor: "rgba(0,0,0,0.2)",
          opacity: isOpen ? 1 : 0,
          pointerEvents: isOpen ? "auto" : "none",
          transition: "opacity 0.15s ease",
        }}
      />

      {/* FAB container */}
      <div className="absolute bottom-[104px] right-6 z-50 flex flex-col items-end gap-2.5 pointer-events-none">
        {/* Action pills */}
        {actions.map((action, i) => (
          <button
            key={action.id}
            onClick={action.onClick}
            className={`flex items-center gap-2.5 py-2.5 px-[18px] h-11 ${action.bg} [box-shadow:#0000001A_0px_2px_12px] rounded-xl`}
            style={{
              opacity: isOpen ? 1 : 0,
              transform: isOpen ? "translateY(0) scale(1)" : "translateY(16px) scale(0.92)",
              pointerEvents: isOpen ? "auto" : "none",
              transition: `opacity 0.18s ease ${i * 0.04}s, transform 0.18s cubic-bezier(0.25,0.46,0.45,0.94) ${i * 0.04}s`,
            }}
          >
            <span className={`text-[15px] leading-5 ${action.textColor} font-red-hat ${action.fontWeight}`}>
              {action.label}
            </span>
            {action.icon}
          </button>
        ))}

        {/* Main FAB button */}
        <button
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center justify-center w-[52px] h-[52px] rounded-2xl bg-[#DC2626] [box-shadow:#DC262640_0px_4px_16px] pointer-events-auto"
          style={{
            transform: `rotate(${isOpen ? 45 : 0}deg)`,
            transition: "transform 0.2s ease-in-out",
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  );
}
