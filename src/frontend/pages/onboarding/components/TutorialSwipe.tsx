/**
 * TutorialSwipe - "Swipe to manage" tutorial page (4 of 5)
 * Shows swipe-to-archive and swipe-to-delete gestures
 */

interface TutorialSwipeProps {
  onNext: () => void;
  onBack?: () => void;
}

export function TutorialSwipe({ onNext, onBack }: TutorialSwipeProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col w-full pt-3 pb-5 gap-2 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          4 OF 5
        </div>
        <div className="text-[32px] leading-[38px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Swipe to manage.
        </div>
        <div className="text-[16px] leading-6 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
          Swipe left on any conversation or note<br />to archive or delete it.
        </div>
      </div>

      <div className="flex flex-col w-full pt-4 gap-6 px-6">
        {/* Conversations swipe example */}
        <div className="flex flex-col w-full gap-2">
          <div className="text-[11px] tracking-widest leading-3.5 text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
            CONVERSATIONS
          </div>
          <div className="flex h-[76px] rounded-2xl overflow-clip shrink-0">
            <div className="flex items-center grow shrink basis-[0%] px-5 bg-white dark:bg-zinc-800 border-t border-l border-b border-[#E7E5E4] dark:border-zinc-700 rounded-l-2xl">
              <div className="flex flex-col gap-[3px]">
                <div className="text-[16px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-5">
                  Engineering sync
                </div>
                <div className="text-[13px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  16 min · 3:05 PM
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center w-20 shrink-0 bg-[#1C1917]">
              <div className="flex flex-col items-center gap-1.5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8V21H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
                <div className="text-[11px] text-[#FAFAF9] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-3.5">
                  Archive
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center w-20 shrink-0 bg-[#DC2626]">
              <div className="flex flex-col items-center gap-1.5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <div className="text-[11px] text-[#FAFAF9] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-3.5">
                  Delete
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center px-1 gap-1.5">
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <line x1="16" y1="6" x2="4" y2="6" stroke="#A8A29E" strokeWidth="1.5" strokeDasharray="3 2" />
              <polygon points="4,2 0,6 4,10" fill="#A8A29E" />
            </svg>
            <div className="text-[11px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3.5">
              Swipe left
            </div>
          </div>
        </div>

        {/* Notes swipe example */}
        <div className="flex flex-col w-full gap-2">
          <div className="text-[11px] tracking-widest leading-3.5 text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
            NOTES
          </div>
          <div className="flex h-[76px] rounded-2xl overflow-clip shrink-0">
            <div className="flex items-center grow shrink basis-[0%] px-5 bg-white dark:bg-zinc-800 border-t border-l border-b border-[#E7E5E4] dark:border-zinc-700 rounded-l-2xl">
              <div className="flex flex-col gap-[3px]">
                <div className="text-[16px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-5">
                  Standup Summary
                </div>
                <div className="text-[13px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  Work Notes · Today
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center w-20 shrink-0 bg-[#1C1917]">
              <div className="flex flex-col items-center gap-1.5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 8V21H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
                <div className="text-[11px] text-[#FAFAF9] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-3.5">
                  Archive
                </div>
              </div>
            </div>
            <div className="flex items-center justify-center w-20 shrink-0 bg-[#DC2626]">
              <div className="flex flex-col items-center gap-1.5">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                <div className="text-[11px] text-[#FAFAF9] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-3.5">
                  Delete
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center px-1 gap-1.5">
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <line x1="16" y1="6" x2="4" y2="6" stroke="#A8A29E" strokeWidth="1.5" strokeDasharray="3 2" />
              <polygon points="4,2 0,6 4,10" fill="#A8A29E" />
            </svg>
            <div className="text-[11px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3.5">
              Swipe left
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="flex flex-col rounded-xl gap-2.5 bg-[#F5F5F4] dark:bg-zinc-800 p-4">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8V21H3V8" />
              <path d="M1 3h22v5H1z" />
            </svg>
            <div>
              <span className="text-[14px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-[18px]">
                Archived items live in{" "}
              </span>
              <span className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Text',system-ui,sans-serif] font-semibold leading-[18px]">
                Archives
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
            <div>
              <span className="text-[14px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-[18px]">
                Deleted items go to{" "}
              </span>
              <span className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Text',system-ui,sans-serif] font-semibold leading-[18px]">
                Trash
              </span>
              <span className="text-[14px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-[18px]">
                {" "}for 30 days
              </span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
