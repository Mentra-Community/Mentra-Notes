/**
 * PrioritiesStep - What matters most to you
 * Multi-select priority options
 */

import { useState } from "react";

interface PrioritiesStepProps {
  onNext: () => void;
  onBack?: () => void;
}

const priorities = [
  {
    id: "decisions",
    title: "Decisions & action items",
    description: "Track what was decided and who's responsible",
  },
  {
    id: "summaries",
    title: "Meeting summaries",
    description: "Get structured recaps of every conversation",
  },
  {
    id: "verbatim",
    title: "Verbatim recall",
    description: "Keep exact words for reference and accuracy",
  },
  {
    id: "topics",
    title: "Key topics & themes",
    description: "Surface recurring topics across conversations",
  },
];

export function PrioritiesStep({ onNext, onBack }: PrioritiesStepProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["decisions", "summaries"]));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6">
        <div className="text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
          onboarding
        </div>
        <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          What matters most<br />to you?
        </div>
        <div className="text-[15px] leading-[22px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
          Helps Mentra Notes prioritize what to capture and how to organize your notes.
        </div>
      </div>

      {/* Options */}
      <div className="flex flex-col pt-6 gap-2.5 px-6">
        {priorities.map((p) => {
          const isSelected = selected.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => toggle(p.id)}
              className={`flex items-center rounded-[14px] py-4 px-[18px] gap-3.5 text-left transition-colors ${
                isSelected
                  ? "bg-[#FEE2E2] border-[1.5px] border-solid border-[#FECACA]"
                  : "bg-[#F5F5F4] dark:bg-zinc-800 border-[1.5px] border-solid border-[#E7E5E4] dark:border-zinc-700"
              }`}
            >
              {/* Checkbox */}
              {isSelected ? (
                <div className="flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-md bg-[#DC2626]">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <polyline points="20,6 9,17 4,12" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              ) : (
                <div className="flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-md bg-white dark:bg-zinc-700 border-[1.5px] border-solid border-[#D6D3D1] dark:border-zinc-600" />
              )}
              <div className="flex flex-col grow shrink basis-[0%] gap-0.5">
                <div className="text-[16px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
                  {p.title}
                </div>
                <div className={`text-[13px] leading-[18px] font-['Red_Hat_Display',system-ui,sans-serif] ${
                  isSelected ? "text-[#78716C]" : "text-[#A8A29E]"
                }`}>
                  {p.description}
                </div>
              </div>
            </button>
          );
        })}
      </div>

    </div>
  );
}
