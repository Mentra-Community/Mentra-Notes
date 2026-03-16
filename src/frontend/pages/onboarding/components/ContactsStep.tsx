/**
 * ContactsStep - Who do you talk to most
 * Add contacts and project topics
 */

import { useState } from "react";

interface ContactsStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export function ContactsStep({ onNext, onBack }: ContactsStepProps) {
  const [nameInput, setNameInput] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [topics, setTopics] = useState<string[]>(["Q3 Mobile Redesign", "Client Beta"]);

  const addTopic = () => {
    const trimmed = topicInput.trim();
    if (trimmed && !topics.includes(trimmed)) {
      setTopics((prev) => [...prev, trimmed]);
      setTopicInput("");
    }
  };

  const removeTopic = (topic: string) => {
    setTopics((prev) => prev.filter((t) => t !== topic));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-2 px-6">
        <div className="text-[11px] tracking-widest leading-3.5 uppercase text-[#DC2626] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
          onboarding
        </div>
        <div className="text-[30px] tracking-[-0.03em] leading-[34px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-extrabold">
          Who do you talk<br />to most?
        </div>
        <div className="text-[15px] leading-[22px] text-[#78716C] font-['Red_Hat_Display',system-ui,sans-serif]">
          Add names so Mentra Notes can recognize speakers and organize conversations by person.
        </div>
      </div>

      {/* Name Input */}
      <div className="flex flex-col pt-6 gap-3.5 px-6">
        <div className="flex items-center rounded-xl py-3.5 px-4 gap-2.5 bg-[#F5F5F4] dark:bg-zinc-800">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="7" r="4" stroke="#A8A29E" strokeWidth="2" />
          </svg>
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="Add a name..."
            className="text-[15px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] placeholder:text-[#A8A29E] bg-transparent outline-none w-full"
          />
        </div>
      </div>

      {/* Topics */}
      <div className="flex flex-col pt-7 gap-3.5 px-6">
        <div className="text-[11px] tracking-widest leading-3.5 uppercase text-[#A8A29E] font-['Red_Hat_Display',system-ui,sans-serif] font-bold">
          Topics
        </div>
        <div className="flex items-center rounded-xl py-3.5 px-4 gap-2.5 bg-[#F5F5F4] dark:bg-zinc-800">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="7" height="7" rx="1" stroke="#A8A29E" strokeWidth="2" />
            <rect x="14" y="3" width="7" height="7" rx="1" stroke="#A8A29E" strokeWidth="2" />
            <rect x="3" y="14" width="7" height="7" rx="1" stroke="#A8A29E" strokeWidth="2" />
            <rect x="14" y="14" width="7" height="7" rx="1" stroke="#A8A29E" strokeWidth="2" />
          </svg>
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTopic()}
            placeholder="Add a project..."
            className="text-[15px] leading-5 text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] placeholder:text-[#A8A29E] bg-transparent outline-none w-full"
          />
        </div>

        {/* Topic Tags */}
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {topics.map((topic) => (
              <button
                key={topic}
                onClick={() => removeTopic(topic)}
                className="flex items-center rounded-[20px] py-2 px-3.5 gap-2 bg-[#F5F5F4] dark:bg-zinc-800 active:scale-95 transition-transform"
              >
                <div className="text-[14px] leading-[18px] text-[#1C1917] dark:text-white font-['Red_Hat_Display',system-ui,sans-serif] font-medium">
                  {topic}
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <line x1="18" y1="6" x2="6" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  <line x1="6" y1="6" x2="18" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
