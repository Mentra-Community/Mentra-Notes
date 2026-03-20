/**
 * Shell - Responsive layout wrapper
 *
 * Provides:
 * - Mobile: Bottom tab bar navigation (Conversations, Search, Notes, Settings)
 *
 * Handles responsive breakpoints and connection status display.
 */

import { ReactNode } from "react";
import { useLocation } from "wouter";

interface ShellProps {
  children: ReactNode;
}

type Tab = "conversations" | "search" | "notes" | "settings";

export function Shell({ children }: ShellProps) {
  const [location, setLocation] = useLocation();

  const hideTabBar = location.startsWith("/onboarding") || location.endsWith("/generating");

  const activeTab: Tab =
    location === "/" ? "conversations" :
    location.startsWith("/search") ? "search" :
    location.startsWith("/notes") || location.startsWith("/note/") || location.startsWith("/collections") || location.startsWith("/folder/") ? "notes" :
    location.startsWith("/settings") ? "settings" :
    "conversations";

  const handleNavigate = (tab: Tab) => {
    switch (tab) {
      case "conversations":
        setLocation("/");
        break;
      case "search":
        setLocation("/search");
        break;
      case "notes":
        setLocation("/notes");
        break;
      case "settings":
        setLocation("/settings");
        break;
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#FAFAF9]">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <main className={`flex-1 min-h-0 overflow-hidden relative ${hideTabBar ? '' : 'pb-[72px]'}`}>
          {children}
        </main>
      </div>

      {/* Bottom Tab Bar */}
      {!hideTabBar && <div className="fixed bottom-0 left-0 right-0 flex items-center justify-around pt-4 pb-6 bg-[#FAFAF9] border-t border-t-[#E7E5E4] z-30">
          {/* Conversations */}
          <button
            onClick={() => handleNavigate("conversations")}
            className="flex flex-col items-center gap-1 grow shrink basis-0"
          >
            {activeTab === "conversations" ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#1C1917" stroke="none">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#A8A29E" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span
              className={`text-[10px] leading-3 font-red-hat ${
                activeTab === "conversations" ? "text-[#1C1917] font-semibold" : "text-[#A8A29E] font-medium"
              }`}
            >
              Conversations
            </span>
          </button>

          {/* Search */}
          <button
            onClick={() => handleNavigate("search")}
            className="flex flex-col items-center gap-1 grow shrink basis-0"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke={activeTab === "search" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" />
              <line x1="16.5" y1="16.5" x2="21" y2="21" stroke={activeTab === "search" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" strokeLinecap="round" />
            </svg>
            <span
              className={`text-[10px] leading-3 font-red-hat ${
                activeTab === "search" ? "text-[#1C1917] font-semibold" : "text-[#A8A29E] font-medium"
              }`}
            >
              Search
            </span>
          </button>

          {/* Notes */}
          <button
            onClick={() => handleNavigate("notes")}
            className="flex flex-col items-center gap-1 grow shrink basis-0"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke={activeTab === "notes" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="14,2 14,8 20,8" stroke={activeTab === "notes" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span
              className={`text-[10px] leading-3 font-red-hat ${
                activeTab === "notes" ? "text-[#1C1917] font-semibold" : "text-[#A8A29E] font-medium"
              }`}
            >
              Notes
            </span>
          </button>

          {/* Settings */}
          <button
            onClick={() => handleNavigate("settings")}
            className="flex flex-col items-center gap-1 grow shrink basis-0"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="3" stroke={activeTab === "settings" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" stroke={activeTab === "settings" ? "#1C1917" : "#A8A29E"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span
              className={`text-[10px] leading-3 font-red-hat ${
                activeTab === "settings" ? "text-[#1C1917] font-semibold" : "text-[#A8A29E] font-medium"
              }`}
            >
              Settings
            </span>
          </button>
        </div>}
    </div>
  );
}
