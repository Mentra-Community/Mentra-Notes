/**
 * OnboardingFooter - Bottom bar with animated dot indicator and back/next split buttons
 */

import { motion } from "motion/react";

interface OnboardingFooterProps {
  activeIndex: number;
  totalDots: number;
  buttonLabel: string;
  onAction: () => void;
  onBack?: () => void;
}

export function OnboardingFooter({
  activeIndex,
  totalDots,
  buttonLabel,
  onAction,
  onBack,
}: OnboardingFooterProps) {
  return (
    <div className="flex items-center justify-between w-full pb-10 px-6">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalDots }).map((_, i) => (
          <motion.div
            key={i}
            className="rounded-[3px] shrink-0 h-1.5"
            animate={{
              width: i === activeIndex ? 24 : 6,
              backgroundColor: i === activeIndex ? "#1C1917" : "#D6D3D1",
            }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
        ))}
      </div>

      {/* Split capsule: Back + Next */}
      <div className="flex items-center rounded-[28px] bg-[#1C1917] dark:bg-white overflow-hidden">
        {onBack && (
          <>
            <button
              onClick={onBack}
              className="flex items-center justify-center py-3 pl-5 pr-4 active:scale-95 transition-transform"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-black">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="w-px h-5 bg-[#3f3f3f] dark:bg-zinc-300 shrink-0" />
          </>
        )}
        <button
          onClick={onAction}
          className="flex items-center justify-center py-3 px-6 active:scale-95 transition-transform"
        >
          <div className="text-[15px] text-[#FAFAF9] dark:text-black font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
            {buttonLabel}
          </div>
        </button>
      </div>
    </div>
  );
}
