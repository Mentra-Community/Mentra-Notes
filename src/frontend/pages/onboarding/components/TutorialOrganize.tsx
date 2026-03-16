/**
 * TutorialOrganize - "Stay organized" tutorial page (3 of 5)
 * Shows view switching and folder organization
 */

interface TutorialOrganizeProps {
  onNext: () => void;
  onBack?: () => void;
}

export function TutorialOrganize({ onNext, onBack }: TutorialOrganizeProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col w-full pt-3 pb-5 gap-3 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          3 OF 5
        </div>
        <div className="text-[32px] leading-[38px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Stay organized.
        </div>
        <div className="text-[16px] leading-6 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
          Folders, calendar view, and different ways to browse your conversations and notes.
        </div>
      </div>

      <div className="flex flex-col w-full px-6 gap-6">
        {/* Switch Views */}
        <div className="flex flex-col w-full gap-3">
          <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
            SWITCH VIEWS
          </div>
          <div className="flex w-full gap-3">
            {/* Conversations Card */}
            <div className="grow shrink basis-[0%] flex flex-col items-center rounded-[14px] py-4 px-3 gap-2 bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="flex items-center gap-1">
                <div className="flex items-center justify-center rounded-lg bg-[#1C1917] dark:bg-white shrink-0 size-8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-black">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </div>
                <div className="flex items-center justify-center rounded-lg bg-[#E7E5E4] dark:bg-zinc-700 shrink-0 size-8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
              </div>
              <div className="text-[12px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-4">
                Conversations
              </div>
              <div className="text-[11px] text-center text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-3.5">
                List or Calendar
              </div>
            </div>

            {/* Notes Card */}
            <div className="grow shrink basis-[0%] flex flex-col items-center rounded-[14px] py-4 px-3 gap-2 bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="flex items-center gap-1">
                <div className="flex items-center justify-center rounded-lg bg-[#E7E5E4] dark:bg-zinc-700 shrink-0 size-8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </div>
                <div className="flex items-center justify-center rounded-lg bg-[#1C1917] dark:bg-white shrink-0 size-8">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FAFAF9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-black">
                    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
                  </svg>
                </div>
              </div>
              <div className="text-[12px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-4">
                Notes
              </div>
              <div className="text-[11px] text-center text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-3.5">
                List or Folders
              </div>
            </div>
          </div>
        </div>

        {/* Folders */}
        <div className="flex flex-col w-full gap-3">
          <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
            FOLDERS
          </div>
          <div className="flex w-full gap-3">
            <div className="grow shrink basis-[0%] flex flex-col rounded-[14px] overflow-clip bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="h-1 w-full bg-[#DC2626] shrink-0" />
              <div className="flex flex-col gap-1 p-3.5">
                <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                  Work Notes
                </div>
                <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  12 notes
                </div>
              </div>
            </div>
            <div className="grow shrink basis-[0%] flex flex-col rounded-[14px] overflow-clip bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="h-1 w-full bg-[#78716C] shrink-0" />
              <div className="flex flex-col gap-1 p-3.5">
                <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                  Personal
                </div>
                <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  5 notes
                </div>
              </div>
            </div>
          </div>
          <div className="flex w-full gap-3">
            <div className="grow shrink basis-[0%] flex flex-col rounded-[14px] overflow-clip bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="h-1 w-full bg-[#2563EB] shrink-0" />
              <div className="flex flex-col gap-1 p-3.5">
                <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                  Project Alpha
                </div>
                <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  8 notes
                </div>
              </div>
            </div>
            <div className="grow shrink basis-[0%] flex flex-col rounded-[14px] overflow-clip bg-[#F5F5F4] dark:bg-zinc-800">
              <div className="h-1 w-full bg-[#16A34A] shrink-0" />
              <div className="flex flex-col gap-1 p-3.5">
                <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                  Research
                </div>
                <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  3 notes
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Calendar View */}
        <div className="flex flex-col w-full gap-3">
          <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
            CALENDAR VIEW
          </div>
          <div className="flex flex-col w-full rounded-2xl gap-2.5 bg-[#F5F5F4] dark:bg-zinc-800 p-4">
            <div className="flex items-center justify-between w-full">
              <div className="text-[14px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                March 2026
              </div>
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </div>
            </div>
            <div className="flex items-center justify-between w-full">
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Mon
                </div>
                <div className="text-[14px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  9
                </div>
              </div>
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Tue
                </div>
                <div className="text-[14px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  10
                </div>
              </div>
              <div className="flex flex-col items-center w-9 rounded-[10px] py-1 gap-1 bg-[#1C1917] dark:bg-white shrink-0">
                <div className="text-[10px] text-[#FAFAF9] dark:text-black font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Wed
                </div>
                <div className="text-[14px] text-[#FAFAF9] dark:text-black font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
                  11
                </div>
              </div>
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Thu
                </div>
                <div className="text-[14px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  12
                </div>
              </div>
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Fri
                </div>
                <div className="text-[14px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  13
                </div>
              </div>
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Sat
                </div>
                <div className="text-[14px] text-[#D6D3D1] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  14
                </div>
              </div>
              <div className="flex flex-col items-center w-9 gap-1 shrink-0">
                <div className="text-[10px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] font-medium leading-3">
                  Sun
                </div>
                <div className="text-[14px] text-[#D6D3D1] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  15
                </div>
              </div>
            </div>
            <div className="text-[12px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
              Browse conversations by date
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
