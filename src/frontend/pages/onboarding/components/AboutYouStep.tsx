/**
 * AboutYouStep - User profile information
 * Name, role, company fields + LinkedIn connect option
 */

import { useState } from "react";

interface AboutYouStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export function AboutYouStep({ onNext, onBack }: AboutYouStepProps) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6">
        <div className="text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
          onboarding
        </div>
        <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Tell us about you
        </div>
        <div className="text-[15px] leading-[22px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
          Helps personalize your summaries and identify you in conversations.
        </div>
      </div>

      {/* Form Fields */}
      <div className="flex flex-col pt-7 gap-5 px-6">
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] leading-4 text-[#52525B] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
            Your name
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="flex items-center rounded-xl py-3.5 px-4 bg-[#F5F5F4] dark:bg-zinc-800 text-[16px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-medium placeholder:text-[#A8A29E] outline-none w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] leading-4 text-[#52525B] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
            Your role
          </div>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Product Manager, Engineer..."
            className="flex items-center rounded-xl py-3.5 px-4 bg-[#F5F5F4] dark:bg-zinc-800 text-[16px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] placeholder:text-[#A8A29E] outline-none w-full"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="text-[13px] leading-4 text-[#52525B] font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
            Company or team
          </div>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Mentra, Acme Corp..."
            className="flex items-center rounded-xl py-3.5 px-4 bg-[#F5F5F4] dark:bg-zinc-800 text-[16px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] placeholder:text-[#A8A29E] outline-none w-full"
          />
        </div>
      </div>

      {/* LinkedIn Connect */}
      <div className="flex flex-col pt-6 px-6">
        <div className="flex flex-col rounded-2xl gap-4 bg-[#F5F5F4] dark:bg-zinc-800 p-5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center shrink-0 rounded-[10px] bg-[#2563EB] size-10">
              <div className="text-[18px] leading-5 text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
                in
              </div>
            </div>
            <div className="flex flex-col gap-px">
              <div className="text-[16px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
                Connect LinkedIn
              </div>
              <div className="text-[12px] leading-4 text-[#A8A29E] font-['Red_Hat_Display',system-ui,sans-serif]">
                Optional · Adds richer context
              </div>
            </div>
          </div>
          <div className="flex flex-col pl-1 gap-2">
            <div className="text-[13px] leading-[18px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
              ✓ Auto-fill your role, company, and industry
            </div>
            <div className="text-[13px] leading-[18px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
              ✓ Match speakers to your professional network
            </div>
            <div className="text-[13px] leading-[18px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
              ✓ Better summaries with industry-specific language
            </div>
          </div>
          <button className="flex items-center justify-center h-12 rounded-xl bg-[#2563EB] shrink-0 active:scale-95 transition-transform">
            <div className="text-[15px] leading-[18px] text-white font-['Red_Hat_Display',system-ui,sans-serif] font-semibold">
              Connect with LinkedIn
            </div>
          </button>
        </div>
      </div>

    </div>
  );
}
