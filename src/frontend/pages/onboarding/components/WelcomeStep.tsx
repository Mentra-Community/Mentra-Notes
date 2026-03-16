/**
 * WelcomeStep - First onboarding screen
 * Shows welcome message and "How it works" feature list
 */

interface WelcomeStepProps {
  onNext: () => void;
}

const features = [
  {
    title: "Always listening",
    description: "Detects and transcribes conversations automatically in the background.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    ),
  },
  {
    title: "Auto note-making",
    description: "AI generates structured notes with summary, decisions, and action items.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    title: "Speaker identification",
    description: "Recognizes who's speaking and labels each part accordingly.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    title: "Easy export",
    description: "Share via email, clipboard, or export as text and markdown.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
];

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col items-center w-full pt-[60px] pb-6 gap-4 px-6">
        <div className="flex items-center justify-center rounded-2xl bg-[#FEE2E2] shrink-0 size-14">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26z" />
          </svg>
        </div>
        <div className="flex flex-col items-center gap-2">
          <div className="text-[28px] text-center leading-[34px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
            Welcome to<br />Mentra Notes
          </div>
          <div className="text-[15px] text-center leading-[22px] text-[#78716C] font-['Red_Hat_Text',system-ui,sans-serif]">
            Your conversations, automatically<br />captured and organized.
          </div>
        </div>
      </div>

      {/* Features */}
      <div className="flex flex-col w-full pt-2 gap-5 px-6">
        <div className="text-[11px] tracking-widest uppercase text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-3.5">
          How it works
        </div>
        {features.map((feature) => (
          <div key={feature.title} className="flex items-start w-full gap-3.5">
            <div className="flex items-center justify-center shrink-0 rounded-xl bg-[#F5F5F4] dark:bg-zinc-800 size-10">
              {feature.icon}
            </div>
            <div className="flex flex-col grow shrink basis-[0%] gap-0.5">
              <div className="text-[15px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
                {feature.title}
              </div>
              <div className="text-[13px] leading-[18px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif]">
                {feature.description}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grow" />

      {/* Footer */}
      <div className="flex items-center justify-between w-full pb-10 px-6">
        <div className="text-[12px] text-[#A8A29E] font-['Red_Hat_Text',system-ui,sans-serif] leading-4">
          Permissions are managed by Mentra
        </div>
        <button
          onClick={onNext}
          className="flex items-center justify-center rounded-[28px] py-3 px-8 bg-[#1C1917] dark:bg-white active:scale-95 transition-transform"
        >
          <div className="text-[15px] text-[#FAFAF9] dark:text-black font-['Red_Hat_Display',system-ui,sans-serif] font-bold leading-[18px]">
            Start
          </div>
        </button>
      </div>
    </div>
  );
}
