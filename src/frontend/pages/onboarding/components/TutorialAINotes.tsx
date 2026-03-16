/**
 * TutorialAINotes - "AI does the work" tutorial page (2 of 5)
 * Shows AI note generation flow and manual notes
 */

interface TutorialAINotesProps {
  onNext: () => void;
  onBack?: () => void;
}

export function TutorialAINotes({ onNext, onBack }: TutorialAINotesProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col w-full pt-3 pb-5 gap-3 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          2 OF 5
        </div>
        <div className="text-[32px] leading-[38px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          AI does the work.
        </div>
        <div className="text-[16px] leading-6 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
          Generate AI-powered notes from any conversation, or write your own and link them.
        </div>
      </div>

      {/* AI Notes Flow */}
      <div className="flex flex-col w-full px-6 gap-4">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          AI NOTES
        </div>

        {/* Flow Diagram */}
        <div className="flex items-center gap-2.5">
          <div className="grow shrink basis-[0%] flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center rounded-[14px] bg-[#F5F5F4] dark:bg-zinc-800 shrink-0 size-12">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="text-[11px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3.5">
              Conversation
            </div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <div className="grow shrink basis-[0%] flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center h-12 rounded-[14px] px-3.5 bg-[#1C1917] dark:bg-white shrink-0">
              <div className="text-[12px] text-center text-[#FAFAF9] dark:text-black font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-4">
                Generate Note
              </div>
            </div>
            <div className="text-[11px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3.5">
              Tap the button
            </div>
          </div>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <div className="grow shrink basis-[0%] flex flex-col items-center gap-1.5">
            <div className="flex items-center justify-center rounded-[14px] bg-[#FEE2E2] shrink-0 size-12">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div className="text-[11px] text-[#DC2626] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3.5">
              Note ready
            </div>
          </div>
        </div>

        {/* Tags */}
        <div className="flex gap-2">
          {[
            { label: "Summary", icon: <><line x1="17" y1="10" x2="3" y2="10" /><line x1="21" y1="6" x2="3" y2="6" /><line x1="21" y1="14" x2="3" y2="14" /><line x1="17" y1="18" x2="3" y2="18" /></> },
            { label: "Actions", icon: <><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></> },
            { label: "Decisions", icon: <><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></> },
          ].map((tag) => (
            <div key={tag.label} className="flex items-center rounded-[20px] py-2 px-3 gap-1.5 bg-[#F5F5F4] dark:bg-zinc-800">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {tag.icon}
              </svg>
              <div className="text-[12px] text-[#1C1917] dark:text-white font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-4">
                {tag.label}
              </div>
            </div>
          ))}
        </div>

        <div className="h-px bg-[#E7E5E4] dark:bg-zinc-700 shrink-0" />

        {/* Manual Notes */}
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          MANUAL NOTES
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center shrink-0 rounded-[14px] bg-[#F5F5F4] dark:bg-zinc-800 size-12">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
              Write your own
            </div>
            <div className="text-[12px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
              Tap + in Notes tab — link to any conversation
            </div>
          </div>
        </div>
        <div className="flex items-center rounded-xl py-2.5 px-3.5 gap-2 bg-[#F5F5F4] dark:bg-zinc-800">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <div className="text-[12px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
            All notes saved in the Notes tab — organize with folders
          </div>
        </div>
      </div>

    </div>
  );
}
