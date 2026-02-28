/**
 * Shell - Responsive layout wrapper
 *
 * Provides:
 * - Desktop: Left sidebar with navigation
 * - Mobile: Bottom tab bar navigation with lightning button for quick actions
 *
 * Handles responsive breakpoints and connection status display.
 */

import { ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { clsx } from "clsx";
import { Home, PencilLine, Settings, Wifi, WifiOff } from "lucide-react";
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
    path: "/settings",
    icon: Settings,
    label: "Settings",
  },
];

export function Shell({ children }: ShellProps) {
  const { userId } = useMentraAuth();
  const { isConnected } = useSynced<SessionI>(userId || "");
  const [location, setLocation] = useLocation();
  const [showQuickActions, setShowQuickActions] = useState(false);

  const isActive = (item: NavItem): boolean => {
    if (location === item.path) return true;
    if (item.matchPaths) {
      return item.matchPaths.some((p) => p !== "/" && location.startsWith(p));
    }
    return false;
  };

  // Hide bottom nav when viewing a day or note (detail pages)
  const hideBottomNav = location.startsWith("/day/") || location.startsWith("/note/");

  return (
    <div className="flex h-screen w-full bg-zinc-50 dark:bg-black text-zinc-900 dark:text-zinc-100">
      {/* Desktop Sidebar */}
      <div className="w-16 shrink-0 border-r border-zinc-200 dark:border-zinc-800 hidden md:flex flex-col items-center py-4 gap-2 bg-white dark:bg-zinc-950">
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
        <div className="flex items-center justify-between h-[72px] px-12">
          {/* Home */}
          <button
            onClick={() => setLocation("/")}
            className={clsx(
              "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
              isActive(navItems[0])
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800"
                : "text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400",
            )}
          >
            <Home
              size={24}
              strokeWidth={isActive(navItems[0]) ? 2.5 : 2}
              fill={isActive(navItems[0]) ? "currentColor" : "none"}
            />
          </button>

          {/* Center Action Button - Pencil */}
          <button
            onClick={() => setShowQuickActions(true)}
            className="w-12 h-12 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center shadow-sm hover:scale-105 active:scale-95 transition-all"
            title="Quick Actions"
          >
            <PencilLine
              size={24}
              strokeWidth={2}
              className="text-white dark:text-zinc-900"
            />
          </button>

          {/* Settings */}
          <button
            onClick={() => setLocation("/settings")}
            className={clsx(
              "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
              isActive(navItems[1])
                ? "text-zinc-900 dark:text-zinc-100 bg-zinc-100 dark:bg-zinc-800"
                : "text-zinc-400 dark:text-zinc-600 hover:text-zinc-600 dark:hover:text-zinc-400",
            )}
          >
            <Settings size={24} strokeWidth={isActive(navItems[1]) ? 2.5 : 2} />
          </button>
        </div>
      </div>
      )}

      {/* Quick Actions Drawer */}
      <QuickActionsDrawer
        isOpen={showQuickActions}
        onClose={() => setShowQuickActions(false)}
      />
    </div>
  );
}
