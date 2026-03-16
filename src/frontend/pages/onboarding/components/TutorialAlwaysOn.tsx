/**
 * TutorialAlwaysOn - "Always on" tutorial page (1 of 5)
 * Shows transcription UI preview and pause/stop controls
 */

interface TutorialAlwaysOnProps {
  onNext: () => void;
  onBack?: () => void;
}

export function TutorialAlwaysOn({ onNext, onBack }: TutorialAlwaysOnProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col w-full pt-3 pb-[19px] gap-2 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          1 OF 5
        </div>
        <div className="text-[32px] leading-[38px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Always on.
        </div>
        <div className="text-[16px] leading-6 text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
          Mentra Notes runs in the background. Conversations are detected and transcribed automatically.
        </div>
      </div>

      {/* Transcription Preview */}
      <div className="flex flex-col w-full px-6">
        <div className="flex items-center rounded-2xl py-3.5 px-4 gap-3 bg-[#FEE2E2]">
          <div className="flex items-end h-5 gap-0.5">
            {[8, 16, 20, 12, 18, 6, 14].map((h, i) => (
              <div key={i} className="w-[3px] rounded-[1px] bg-[#DC2626] shrink-0" style={{ height: h }} />
            ))}
          </div>
          <div className="text-[15px] text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
            Transcribing now
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex flex-col pt-2">
          {[
            { title: "Client deadline discussion", time: "Just now" },
            { title: "Engineering sync", time: "16 min · 3:05 PM" },
            { title: "Design review", time: "12 min · 4:30 PM" },
          ].map((item, i, arr) => (
            <div
              key={item.title}
              className={`flex items-center justify-between py-4 ${i < arr.length - 1 ? "border-b border-b-[#F5F5F4] dark:border-b-zinc-800" : ""}`}
            >
              <div className="flex flex-col gap-[3px]">
                <div className="text-[15px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold leading-[18px]">
                  {item.title}
                </div>
                <div className="text-[13px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
                  {item.time}
                </div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          ))}
        </div>
      </div>

      {/* Controls Info */}
      <div className="flex flex-col w-full pt-4 gap-3.5 px-6">
        <div className="text-[11px] tracking-widest text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          YOU'RE ALWAYS IN CONTROL
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center shrink-0 rounded-[22px] bg-[#F5F5F4] dark:bg-zinc-800 size-11">
            <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
              <rect x="1" y="1" width="4" height="14" rx="1.5" fill="#78716C" />
              <rect x="9" y="1" width="4" height="14" rx="1.5" fill="#78716C" />
            </svg>
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[15px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
              Pause
            </div>
            <div className="text-[13px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
              Temporarily mute. Tap again to resume — nothing is lost.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3.5">
          <div className="flex items-center justify-center shrink-0 rounded-[22px] bg-[#DC2626] size-11">
            <div className="rounded-[3px] bg-[#FAFAF9] shrink-0 size-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-[15px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
              Stop
            </div>
            <div className="text-[13px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
              End and save the conversation. Generate notes from it after.
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
            Find these at the bottom of the live transcript
          </div>
        </div>
      </div>

    </div>
  );
}
