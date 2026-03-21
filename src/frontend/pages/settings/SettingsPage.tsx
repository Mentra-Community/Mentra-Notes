/**
 * SettingsPage - App settings and preferences
 *
 * Warm stone design. Shows user profile at top,
 * then grouped settings sections matching current backend logic.
 */

import { useState } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";
import { useTheme } from "../../App";
import { SettingsPageSkeleton } from "../../components/shared/SkeletonLoader";

// ── Toggle Switch (matches ExportDrawer style) ──

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onChange}
      disabled={disabled}
      className={`w-11 h-[26px] flex items-center rounded-[13px] shrink-0 p-0.5 transition-colors duration-200 ${
        disabled ? "opacity-50" : ""
      } ${checked ? "bg-[#2563EB] justify-end" : "bg-[#E7E5E4] justify-start"}`}
    >
      <div className="w-[22px] h-[22px] rounded-[11px] bg-[#FAFAF9] shrink-0" />
    </button>
  );
}

// ── Section Header ──

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="pt-6 pb-2.5">
      <span className="tracking-widest uppercase text-[11px] leading-3.5 text-[#A8A29E] font-red-hat font-bold">
        {label}
      </span>
    </div>
  );
}

// ── Chevron icon ──

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <polyline points="9,6 15,12 9,18" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsPage() {
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session, isConnected } = useSynced<SessionI>(userId || "");
  const { isDarkMode, toggleTheme } = useTheme();

  // Profile photo state
  const [photoError, setPhotoError] = useState(false);

  // Get settings from session
  const displayName = session?.settings?.displayName ?? null;
  const role = session?.settings?.role ?? null;
  const company = session?.settings?.company ?? null;
  const persistentTranscription = session?.settings?.showLiveTranscript ?? false;
  const savedTimezone = session?.settings?.timezone;

  // Build profile subtitle
  const profileSubtitle = [role, company].filter(Boolean).join(" · ") || userId || "";

  // Initials for avatar fallback
  const initials = displayName
    ? displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : (userId || "?").slice(0, 2).toUpperCase();

  // Supabase profile photo URL
  const profilePhotoUrl = userId
    ? `https://lyleqmzybkbifsxbkxqp.supabase.co/storage/v1/object/public/profile-photos/${userId}`
    : null;

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

  // Loading state
  if (!session) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="h-full flex flex-col bg-[#FAFAF9]">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col px-6 pb-24">

          {/* Header */}
          <div className="flex flex-col pt-3 gap-2">
            <span className="tracking-widest uppercase text-[11px] leading-3.5 text-[#DC2626] font-red-hat font-bold">
              Mentra Notes
            </span>
            <span className="tracking-[-0.03em] text-[30px] leading-[34px] text-[#1C1917] font-red-hat font-extrabold">
              Settings
            </span>
          </div>

          {/* ── User Profile ── */}
          <div className="flex items-center py-4 gap-3.5 border-b border-[#E7E5E4]">
            <div className="flex items-center justify-center shrink-0 rounded-3xl bg-[#1C1917] size-12 overflow-hidden">
              {profilePhotoUrl && !photoError ? (
                <img
                  src={profilePhotoUrl}
                  alt={displayName || "Profile"}
                  className="w-full h-full object-cover"
                  onError={() => setPhotoError(true)}
                />
              ) : (
                <span className="text-[#FAFAF9] font-red-hat font-bold text-[17px] leading-[22px]">
                  {initials}
                </span>
              )}
            </div>
            <div className="flex flex-col grow shrink basis-0 gap-px">
              <span className="text-[17px] leading-[22px] text-[#1C1917] font-red-hat font-bold">
                {displayName || "User"}
              </span>
              <span className="text-[13px] leading-[18px] text-[#78716C] font-red-hat">
                {profileSubtitle}
              </span>
            </div>
            <ChevronRight />
          </div>

          {/* ── Recording ── */}
          <SectionHeader label="Recording" />

          <div className="flex items-center justify-between py-3.5 border-b border-[#E7E5E4]">
            <div className="flex flex-col grow shrink basis-0 gap-0.5">
              <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium">
                Persistent transcription
              </span>
              <span className="text-xs leading-4 text-[#78716C] font-red-hat">
                Always-on recording in background
              </span>
            </div>
            <ToggleSwitch
              checked={persistentTranscription}
              onChange={handleTogglePersistentTranscription}
              disabled={!isConnected}
            />
          </div>

          {/* ── Preferences ── */}
          <SectionHeader label="Preferences" />

          <div className="flex items-center justify-between py-3.5 border-b border-[#E7E5E4]">
            <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium">
              Dark Mode
            </span>
            <ToggleSwitch checked={isDarkMode} onChange={toggleTheme} />
          </div>

          {/* ── Onboarding ── */}
          <SectionHeader label="Onboarding" />

          <button
            onClick={async () => {
              if (!session?.settings?.updateSettings) return;
              await session.settings.updateSettings({ onboardingCompleted: false });
              setLocation("/onboarding");
            }}
            disabled={!isConnected}
            className="flex items-center justify-between py-3.5 border-b border-[#E7E5E4] w-full text-left disabled:opacity-50"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium">
                Reset onboarding
              </span>
              <span className="text-xs leading-4 text-[#78716C] font-red-hat">
                Restart the tutorial and update your profile
              </span>
            </div>
            <ChevronRight />
          </button>

          {/* ── Timezone ── */}
          {savedTimezone && (
            <>
              <SectionHeader label="Timezone" />
              <div className="py-3.5 border-b border-[#E7E5E4]">
                <span className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-medium">
                  {savedTimezone}
                </span>
                <p className="text-xs leading-4 text-[#78716C] font-red-hat mt-0.5">
                  Days and times are shown in your local timezone
                </p>
              </div>
            </>
          )}

          {/* Version */}
          <div className="flex justify-center py-6">
            <span className="text-[13px] leading-4 text-[#D6D3D1] font-red-hat">
              Mentra Notes v3.0.0
            </span>
          </div>

        </div>
      </div>
    </div>
  );
}
