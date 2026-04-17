/**
 * Shell - Responsive layout wrapper
 *
 * Provides:
 * - Mobile: Bottom tab bar navigation (Transcripts, Search, Notes, Settings)
 *
 * Handles responsive breakpoints and connection status display.
 */

import { ReactNode, createContext, useContext, useState, useCallback, useTransition, useEffect } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "motion/react";

interface ShellProps {
  children: ReactNode;
}

type Tab = "transcripts" | "search" | "notes" | "settings";

interface TabBarContextValue {
  setHidden: (hidden: boolean) => void;
}

const TabBarContext = createContext<TabBarContextValue>({ setHidden: () => {} });

/** Pages call setHidden(true) to slide the tab bar out (e.g. during multi-select). */
export function useTabBar() {
  return useContext(TabBarContext);
}

export function Shell({ children }: ShellProps) {
  const [location, setLocation] = useLocation();
  const [pageHidesTabBar, setPageHidesTabBar] = useState(false);

  const setHidden = useCallback((hidden: boolean) => {
    setPageHidesTabBar(hidden);
  }, []);

  const routeHidesTabBar =
    location.startsWith("/onboarding") ||
    location.endsWith("/generating") ||
    location.startsWith("/transcript/");

  const hideTabBar = routeHidesTabBar || pageHidesTabBar;

  const routeTab: Tab =
    location === "/" ? "transcripts" :
    location.startsWith("/search") ? "search" :
    location.startsWith("/notes") || location.startsWith("/note/") || location.startsWith("/collections") || location.startsWith("/folder/") ? "notes" :
    location.startsWith("/settings") ? "settings" :
    "transcripts";

  // Optimistic active tab — flips immediately on click so the indicator animation
  // starts on its own frame, before the page swap mounts the next route.
  const [activeTab, setActiveTab] = useState<Tab>(routeTab);
  const [, startTransition] = useTransition();

  // Keep optimistic state in sync when the route changes from elsewhere (back/forward, deep links)
  useEffect(() => {
    setActiveTab(routeTab);
  }, [routeTab]);

  const handleNavigate = (tab: Tab) => {
    if (tab === activeTab) return;
    setActiveTab(tab); // paint the indicator slide first
    // Defer the heavy page swap so motion gets the next frame for the layout animation
    requestAnimationFrame(() => {
      startTransition(() => {
        switch (tab) {
          case "transcripts":
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
      });
    });
  };

  return (
    <TabBarContext.Provider value={{ setHidden }}>
    <div className="flex h-screen w-full bg-[#FAFAF9]">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <main className={`flex-1 min-h-0 overflow-hidden relative ${routeHidesTabBar ? '' : ''}`}>
          {children}
        </main>
      </div>

      {/* Bottom Tab Bar — slides down out of view when hidden, matching MultiSelectBar's slide-up */}
      <AnimatePresence>
      {!hideTabBar && <motion.div
          initial={{ y: 80 }}
          animate={{ y: 0 }}
          exit={{ y: 80 }}
          transition={{ type: "tween", duration: 0.2, ease: "easeOut" }}
          className="[font-synthesis:none] fixed bottom-0 left-0 right-0 flex items-start justify-around pt-2.5 pb-5.5 px-7.5 bg-white border-t border-t-solid border-t-[#E8E5E1] antialiased z-30 min-h-20"
        >
          {/* Transcripts */}
          <button
            onClick={() => handleNavigate("transcripts")}
            className="flex flex-col items-center gap-1"
          >
            {/* Slot for the sliding indicator — always 2.5px tall so icons stay aligned */}
            <div className="h-[2.5px] flex items-center justify-center">
              {activeTab === "transcripts" && (
                <motion.div
                  layoutId="tab-indicator"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F]"
                />
              )}
            </div>
            <svg width="21" height="21" fill="none" stroke={activeTab === "transcripts" ? "#D32F2F" : "#B8B2A9"} strokeWidth={activeTab === "transcripts" ? 1.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
            <div
              className={`inline-block font-red-hat text-[10px]/3 ${
                activeTab === "transcripts"
                  ? "tracking-[0.2px] text-[#D32F2F] font-bold"
                  : "text-[#B8B2A9] font-medium"
              }`}
            >
              Transcripts
            </div>
          </button>

          {/* Search */}
          <button
            onClick={() => handleNavigate("search")}
            className="flex flex-col items-center gap-1"
          >
            <div className="h-[2.5px] flex items-center justify-center">
              {activeTab === "search" && (
                <motion.div
                  layoutId="tab-indicator"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F]"
                />
              )}
            </div>
            <svg width="21" height="21" fill="none" stroke={activeTab === "search" ? "#D32F2F" : "#B8B2A9"} strokeWidth={activeTab === "search" ? 1.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div
              className={`inline-block font-red-hat text-[10px]/3 ${
                activeTab === "search"
                  ? "tracking-[0.2px] text-[#D32F2F] font-bold"
                  : "text-[#B8B2A9] font-medium"
              }`}
            >
              Search
            </div>
          </button>

          {/* Notes */}
          <button
            onClick={() => handleNavigate("notes")}
            className="flex flex-col items-center gap-1"
          >
            <div className="h-[2.5px] flex items-center justify-center">
              {activeTab === "notes" && (
                <motion.div
                  layoutId="tab-indicator"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F]"
                />
              )}
            </div>
            <svg width="21" height="21" fill="none" stroke={activeTab === "notes" ? "#D32F2F" : "#B8B2A9"} strokeWidth={activeTab === "notes" ? 1.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <div
              className={`inline-block font-red-hat text-[10px]/3 ${
                activeTab === "notes"
                  ? "tracking-[0.2px] text-[#D32F2F] font-bold"
                  : "text-[#B8B2A9] font-medium"
              }`}
            >
              Notes
            </div>
          </button>

          {/* Settings */}
          <button
            onClick={() => handleNavigate("settings")}
            className="flex flex-col items-center gap-1 min-w-12.5"
          >
            <div className="h-[2.5px] flex items-center justify-center">
              {activeTab === "settings" && (
                <motion.div
                  layoutId="tab-indicator"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  className="w-4 h-[2.5px] rounded-xs bg-[#D32F2F]"
                />
              )}
            </div>
            <svg width="21" height="21" fill="none" stroke={activeTab === "settings" ? "#D32F2F" : "#B8B2A9"} strokeWidth={activeTab === "settings" ? 1.6 : 1.5} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <div
              className={`inline-block font-red-hat text-[10px]/3 ${
                activeTab === "settings"
                  ? "tracking-[0.2px] text-[#D32F2F] font-bold"
                  : "text-[#B8B2A9] font-medium"
              }`}
            >
              Settings
            </div>
          </button>
        </motion.div>}
      </AnimatePresence>
    </div>
    </TabBarContext.Provider>
  );
}
