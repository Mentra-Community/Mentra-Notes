/**
 * TutorialComplete - "Find anything" final tutorial page (5 of 5)
 * Shows search, filter, and export capabilities
 */

interface TutorialCompleteProps {
  onFinish: () => void;
  onBack?: () => void;
}

export function TutorialComplete({ onFinish, onBack }: TutorialCompleteProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col w-full pt-3 pb-5 gap-3 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          5 OF 5
        </div>
        <div className="text-[32px] leading-[38px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Find anything.
        </div>
        <div className="text-[16px] leading-6 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
          Search, ask AI, filter, or export — everything you need to find and share your conversations.
        </div>
      </div>

      {/* Features */}
      <div className="flex flex-col w-full px-6 gap-4">
        {/* Ask AI - highlighted */}
        <div className="flex items-center w-full rounded-2xl py-4 px-5 gap-3.5 bg-[#FEE2E2] dark:bg-red-950/40">
          <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#DC2626] size-10">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" />
            </svg>
          </div>
          <div className="flex flex-col grow shrink basis-[0%] gap-0.5">
            <div className="text-[15px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold leading-[18px]">
              Ask AI
            </div>
            <div className="text-[12px] leading-4 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
              "What did we decide about the timeline?"
            </div>
          </div>
        </div>

        {/* Search / Filter / Export list */}
        <div className="flex flex-col w-full rounded-2xl overflow-clip bg-[#F5F5F4] dark:bg-zinc-800">
          <div className="flex items-center py-4 px-5 gap-3.5 border-b border-[#E7E5E4] dark:border-zinc-700">
            <div className="flex items-center justify-center shrink-0 rounded-[10px] bg-[#E7E5E4] dark:bg-zinc-700 size-9">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-white">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <div className="flex flex-col grow shrink basis-[0%] gap-px">
              <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                Search
              </div>
              <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                Find by keyword across all conversations and notes
              </div>
            </div>
          </div>
          <div className="flex items-center py-4 px-5 gap-3.5 border-b border-[#E7E5E4] dark:border-zinc-700">
            <div className="flex items-center justify-center shrink-0 rounded-[10px] bg-[#E7E5E4] dark:bg-zinc-700 size-9">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-white">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
            </div>
            <div className="flex flex-col grow shrink basis-[0%] gap-px">
              <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                Filter & Sort
              </div>
              <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                By date, duration, participants, or type
              </div>
            </div>
          </div>
          <div className="flex items-center py-4 px-5 gap-3.5">
            <div className="flex items-center justify-center shrink-0 rounded-[10px] bg-[#E7E5E4] dark:bg-zinc-700 size-9">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-white">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </div>
            <div className="flex flex-col grow shrink basis-[0%] gap-px">
              <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                Export
              </div>
              <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                Text, markdown, or share via clipboard
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
