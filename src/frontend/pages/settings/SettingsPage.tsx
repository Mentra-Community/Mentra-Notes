/**
 * SettingsPage - App settings and preferences
 *
 * Features:
 * - General settings (Notifications, Data & Storage)
 * - Recording settings (Persistent transcription toggle)
 * - Glasses display mode selector
 * - Preferences (Dark mode toggle)
 * - Auto-detects and sends user timezone
 */

import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { clsx } from "clsx";
import {
  ChevronLeft,
  ChevronRight,
  // Bell,
  // Database,
  // Glasses,
  // Check,
} from "lucide-react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI /*, GlassesDisplayMode */ } from "../../../shared/types";
import { useTheme } from "../../App";
import { SettingsPageSkeleton } from "../../components/shared/SkeletonLoader";

interface SettingsRowProps {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  type?: "toggle" | "link" | "none";
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
}

function SettingsRow({
  icon,
  label,
  value,
  type = "none",
  onClick,
  active,
  disabled,
}: SettingsRowProps) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled || type === "none"}
      className={clsx(
        "w-full flex items-center justify-between py-4 border-b border-zinc-100 dark:border-zinc-800 transition-colors",
        disabled && "opacity-50",
        (type === "link" || type === "toggle") &&
          !disabled &&
          "hover:bg-zinc-50 dark:hover:bg-zinc-900/50",
      )}
    >
      <div className="flex items-center gap-3">
        {icon && (
          <span className="text-zinc-400 dark:text-zinc-500">{icon}</span>
        )}
        <span className="text-base font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {value && (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {value}
          </span>
        )}

        {type === "toggle" && (
          <div
            className={clsx(
              "w-11 h-6 rounded-full p-0.5 relative transition-colors",
              disabled ? "cursor-not-allowed" : "cursor-pointer",
              active
                ? "bg-zinc-900 dark:bg-white"
                : "bg-zinc-200 dark:bg-zinc-700",
            )}
          >
            <div
              className={clsx(
                "w-5 h-5 rounded-full bg-white dark:bg-black shadow-sm transition-transform",
                active && "translate-x-5",
              )}
            />
          </div>
        )}

        {type === "link" && (
          <ChevronRight
            size={18}
            className="text-zinc-300 dark:text-zinc-600"
          />
        )}
      </div>
    </button>
  );
}

// interface DisplayModeOption {
//   value: GlassesDisplayMode;
//   label: string;
//   description: string;
// }

// const displayModeOptions: DisplayModeOption[] = [
//   {
//     value: "off",
//     label: "Off",
//     description: "Nothing shown on glasses",
//   },
//   {
//     value: "live_transcript",
//     label: "Live Transcript",
//     description: "Real-time transcription text",
//   },
//   {
//     value: "hour_summary",
//     label: "Hour Summary",
//     description: "Rolling summary of the current hour",
//   },
//   {
//     value: "key_points",
//     label: "Key Points Only",
//     description: "Only show important moments",
//   },
// ];

export function SettingsPage() {
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session, isConnected } = useSynced<SessionI>(userId || "");
  const { isDarkMode, toggleTheme } = useTheme();

  // Get settings from session
  const persistentTranscription =
    session?.settings?.showLiveTranscript ?? false;
  // const glassesDisplayMode =
  //   session?.settings?.glassesDisplayMode ?? "live_transcript";
  const savedTimezone = session?.settings?.timezone;

  // Timezone is now auto-synced at connection time in useSynced hook

  // Toggle persistent transcription via RPC
  const handleTogglePersistentTranscription = async () => {
    if (!session?.settings?.updateSettings) return;

    try {
      await session.settings.updateSettings({
        showLiveTranscript: !persistentTranscription,
      });
    } catch (err) {
      console.error("[SettingsPage] Failed to toggle transcription:", err);
    }
  };

  // Change glasses display mode — commented out for now
  // const handleChangeDisplayMode = async (mode: GlassesDisplayMode) => {
  //   if (!session?.settings?.updateSettings) return;
  //   try {
  //     await session.settings.updateSettings({
  //       glassesDisplayMode: mode,
  //     });
  //   } catch (err) {
  //     console.error("[SettingsPage] Failed to change display mode:", err);
  //   }
  // };

  const handleBack = () => {
    setLocation("/");
  };

  // Loading state
  if (!session) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {/* Header */}
      <div className="shrink-0 border-b border-zinc-200 dark:border-zinc-800 py-3">
        <div className="flex items-center">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 transition-colors md:hidden pl-6"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-xl font-normal text-zinc-900 dark:text-white tracking-tight md:ml-0">
            Settings
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-6 md:px-6 pb-24">
          {/* General Section */}
          {/* <div className="mt-6 mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              General
            </h3>
            <SettingsRow
              icon={<Bell size={20} />}
              label="Notifications"
              type="link"
              onClick={() => {}}
            />
            <SettingsRow
              icon={<Database size={20} />}
              label="Data & Storage"
              type="link"
              onClick={() => {}}
            />
          </div> */}

          {/* Recording Section */}
          <div className="mt-8 mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Recording
            </h3>
            <SettingsRow
              label="Persistent transcription"
              type="toggle"
              active={persistentTranscription}
              onClick={handleTogglePersistentTranscription}
              disabled={!isConnected}
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 mb-4">
              When enabled, Mentra Notes captures transcripts automatically
              while active
            </p>
          </div>

          {/* Glasses Display Section — commented out for now
          <div className="mt-8 mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Glasses Display
            </h3>
            <div className="flex items-center gap-2 mb-3 text-zinc-600 dark:text-zinc-400">
              <Glasses size={18} />
              <span className="text-sm">What to show on your glasses</span>
            </div>
            <div className="space-y-2">
              {displayModeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleChangeDisplayMode(option.value)}
                  disabled={!isConnected}
                  className={clsx(
                    "w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left",
                    glassesDisplayMode === option.value
                      ? "bg-zinc-50 dark:bg-zinc-900 border-zinc-900 dark:border-white"
                      : "bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700",
                    !isConnected && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div>
                    <span
                      className={clsx(
                        "font-medium block",
                        glassesDisplayMode === option.value
                          ? "text-zinc-900 dark:text-white"
                          : "text-zinc-700 dark:text-zinc-300",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {option.description}
                    </span>
                  </div>
                  {glassesDisplayMode === option.value && (
                    <div className="w-6 h-6 rounded-full bg-zinc-900 dark:bg-white flex items-center justify-center">
                      <Check
                        size={14}
                        className="text-white dark:text-zinc-900"
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div> */}

          {/* Preferences Section */}
          <div className="mt-8 mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Preferences
            </h3>
            <SettingsRow
              label="Dark Mode"
              type="toggle"
              active={isDarkMode}
              onClick={toggleTheme}
            />
          </div>

          {/* Onboarding */}
          <div className="mt-8 mb-2">
            <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              Onboarding
            </h3>
            <SettingsRow
              label="Reset onboarding"
              type="link"
              onClick={async () => {
                if (!session?.settings?.updateSettings) return;
                await session.settings.updateSettings({ onboardingCompleted: false });
                setLocation("/onboarding");
              }}
              disabled={!isConnected}
            />
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 mb-4">
              Restart the onboarding tutorial and update your profile
            </p>
          </div>

          {/* Timezone Info */}
          {savedTimezone && (
            <div className="mt-8 mb-2">
              <h3 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                Timezone
              </h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                {savedTimezone}
              </p>
              <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
                Days and times are shown in your local timezone
              </p>
            </div>
          )}

          {/* Version */}
          <div className="mt-12 text-center">
            <p className="text-sm text-zinc-400 dark:text-zinc-500">
              Mentra Notes v3.0.0
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
