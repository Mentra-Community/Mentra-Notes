/**
 * Shell - Responsive layout wrapper
 *
 * Provides:
 * - Desktop: Left sidebar with navigation
 * - Mobile: Bottom tab bar navigation with lightning button for quick actions
 *
 * Handles responsive breakpoints and connection status display.
 */

import { ReactNode, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { clsx } from "clsx";
import { Home, Loader2, PencilLine, Search, Settings, Wifi, WifiOff } from "lucide-react";
import { useSynced } from "../../hooks/useSynced";
import { useMentraAuth } from "@mentra/react";
import type { SessionI } from "../../../shared/types";
import { QuickActionsDrawer } from "../shared/QuickActionsDrawer";

interface ShellProps {
  children: ReactNode;
}

interface NavItem {
  path: string;
  icon: typeof Home;
  label: string;
  matchPaths?: string[];
}

const navItems: NavItem[] = [
  {
    path: "/",
    icon: Home,
    label: "Home",
    matchPaths: ["/", "/day"],
  },
  {
    path: "/search",
    icon: Search,
    label: "Search",
  },
  {
    path: "/settings",
    icon: Settings,
    label: "Settings",
  },
];

export function Shell({ children }: ShellProps) {
  const { userId } = useMentraAuth();
  const { isConnected, session } = useSynced<SessionI>(userId || "");
  const [location, setLocation] = useLocation();
  const [showQuickActions, setShowQuickActions] = useState(false);
  const wasOnDayPageRef = useRef(false);

  const generating = session?.notes?.generating ?? false;

  // Extract dateString from route if on a DayPage (e.g. /day/2026-02-27)
  const onDayPage = location.startsWith("/day/");
  const dayPageDate = onDayPage ? location.replace("/day/", "") : undefined;

  // Reset to today's transcript when navigating away from a DayPage
  useEffect(() => {
    if (onDayPage) {
      wasOnDayPageRef.current = true;
    } else if (wasOnDayPageRef.current) {
      wasOnDayPageRef.current = false;
      session?.transcript?.loadTodayTranscript?.();
    }
  }, [onDayPage, session?.transcript]);

  const isActive = (item: NavItem): boolean => {
    if (location === item.path) return true;
    if (item.matchPaths) {
      return item.matchPaths.some((p) => p !== "/" && location.startsWith(p));
    }
    return false;
  };

  // Hide bottom nav on note editor and onboarding pages
  const hideBottomNav = location.startsWith("/note/") || location.startsWith("/onboarding");

  // Hide entire shell chrome on onboarding
  const hideShellChrome = location.startsWith("/onboarding");

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      {/* Desktop Sidebar */}
      <div className={clsx("w-16 shrink-0 border-r border-zinc-200 dark:border-zinc-800 hidden md:flex flex-col items-center py-4 gap-2 bg-white dark:bg-zinc-950", hideShellChrome && "hidden!")}>
        {/* App Icon */}
        <div className="w-10 h-10 rounded-xl bg-zinc-900 dark:bg-white flex items-center justify-center mb-4">
          <span className="text-white dark:text-zinc-900 text-lg">📝</span>
        </div>

        {/* Nav Items */}
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => setLocation(item.path)}
            className={clsx(
              "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
              isActive(item)
                ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900",
            )}
            title={item.label}
          >
            <item.icon size={20} />
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Connection Status */}
        <div
          className={clsx(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            isConnected ? "text-emerald-500" : "text-zinc-400",
          )}
          title={isConnected ? "Connected" : "Disconnected"}
        >
          {isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white dark:bg-black relative">
        <main className={clsx("flex-1 min-h-0 overflow-hidden relative md:pb-0", hideBottomNav ? "pb-0" : "pb-16")}>
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation - hidden on detail pages */}
      {!hideBottomNav && (
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white dark:bg-zinc-950  border-zinc-200 dark:border-zinc-800  z-30">
        <div className="flex items-center justify-between h-[72px] px-8 pb-[15px]">
          {/* Home */}
          <button
            onClick={() => setLocation("/")}
            className={clsx(
              "w-11 h-11 rounded-full flex items-center justify-center transition-colors",
              isActive(navItems[0])
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800"
                : "text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400",
            )}
          >
            <Home
              size={22}
              strokeWidth={isActive(navItems[0]) ? 2.5 : 2}
              fill={isActive(navItems[0]) ? "currentColor" : "none"}
            />
          </button>

          {/* Search */}
          <button
            onClick={() => setLocation("/search")}
            className={clsx(
              "w-11 h-11 rounded-full flex items-center justify-center transition-colors",
              isActive(navItems[1])
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800"
                : "text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400",
            )}
          >
            <Search size={22} strokeWidth={isActive(navItems[1]) ? 2.5 : 2} />
          </button>

          {/* Center Action Button - Pencil */}
          <button
            onClick={() => !generating && setShowQuickActions(true)}
            disabled={generating}
            className={clsx(
              "w-11 h-11 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shadow-sm transition-all",
              generating ? "opacity-70 cursor-not-allowed" : "hover:scale-105 active:scale-95",
            )}
            title="Quick Actions"
          >
            {generating ? (
              <Loader2 size={22} className="text-white dark:text-zinc-900 animate-spin" />
            ) : (
              <PencilLine size={22} strokeWidth={2} className="text-white dark:text-zinc-900" />
            )}
          </button>

          {/* Settings */}
          <button
            onClick={() => setLocation("/settings")}
            className={clsx(
              "w-11 h-11 rounded-full flex items-center justify-center transition-colors",
              isActive(navItems[2])
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800"
                : "text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400",
            )}
          >
            <Settings size={22} strokeWidth={isActive(navItems[2]) ? 2.5 : 2} />
          </button>
        </div>
      </div>
      )}

      {/* Quick Actions Drawer */}
      <QuickActionsDrawer
        isOpen={showQuickActions}
        onClose={() => setShowQuickActions(false)}
        dateString={dayPageDate}
      />
    </div>
  );
}
