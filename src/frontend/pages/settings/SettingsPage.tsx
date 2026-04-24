/**
 * SettingsPage — Paper-inspired minimal settings surface.
 *
 * Sections: profile (info-only), Export (export-all + delete-all rows), Timezone, version footer.
 */

import { useEffect, useState } from "react";
import { useMentraAuth } from "@mentra/react";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";
import { SettingsPageSkeleton } from "../../components/shared/SkeletonLoader";
import { BottomDrawer } from "../../components/shared/BottomDrawer";
import { toast } from "../../components/shared/toast";

export function SettingsPage() {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");

  const [photoError, setPhotoError] = useState(false);
  const [showExportDrawer, setShowExportDrawer] = useState(false);
  const [showDeleteDrawer, setShowDeleteDrawer] = useState(false);

  const displayName = session?.settings?.displayName ?? null;
  const role = session?.settings?.role ?? null;
  const company = session?.settings?.company ?? null;
  const savedTimezone = session?.settings?.timezone;

  const profileSubtitle = [role, company].filter(Boolean).join(" · ") || userId || "";

  const initials = displayName
    ? displayName.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : (userId || "?").slice(0, 2).toUpperCase();

  const profilePhotoUrl = userId
    ? `https://lyleqmzybkbifsxbkxqp.supabase.co/storage/v1/object/public/profile-photos/${userId}`
    : null;

  if (!session) {
    return <SettingsPageSkeleton />;
  }

  return (
    <div className="h-full flex flex-col bg-[#FCFBFA]">
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col px-6 pb-24">

          {/* Kicker + title */}
          <div className="flex flex-col pt-1.5 pb-4 gap-0.5">
            <span className="tracking-[1.5px] uppercase text-[11px] leading-3.5 text-[#D32F2F] font-red-hat font-bold">
              Mentra Notes
            </span>
            <span className="tracking-[-0.5px] text-[34px] leading-[42px] text-[#1A1A1A] font-red-hat font-black">
              Settings
            </span>
          </div>

          {/* Profile row (informational, no chevron) */}
          <div className="flex items-center py-3 gap-3.5">
            <div className="flex items-center justify-center shrink-0 rounded-3xl bg-[#EBE7E1] size-12 overflow-hidden">
              {profilePhotoUrl && !photoError ? (
                <img
                  src={profilePhotoUrl}
                  alt={displayName || "Profile"}
                  className="w-full h-full object-cover"
                  onError={() => setPhotoError(true)}
                />
              ) : (
                <span className="text-[#6B655D] font-red-hat font-bold text-[18px] leading-[22px]">
                  {initials}
                </span>
              )}
            </div>
            <div className="flex flex-col grow shrink basis-0 gap-0.5">
              <span className="text-[16px] leading-5 text-[#1A1A1A] font-red-hat font-bold">
                {displayName || "User"}
              </span>
              <span className="text-[13px] leading-4 text-[#9C958D] font-red-hat">
                {profileSubtitle}
              </span>
            </div>
          </div>

          {/* Export section */}
          <div className="flex flex-col pt-2">
            <span className="tracking-[1px] uppercase py-3 text-[11px] leading-3.5 text-[#9C958D] font-red-hat">
              Export
            </span>

            <button
              onClick={() => setShowExportDrawer(true)}
              className="flex justify-between items-center py-4 border-t border-[#F0EDEA] w-full text-left"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] leading-[18px] text-[#1A1A1A] font-red-hat">
                  Export all data
                </span>
                <span className="text-[12px] leading-4 text-[#9C958D] font-red-hat">
                  Download transcripts and notes as a ZIP file
                </span>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>

            <button
              onClick={() => setShowDeleteDrawer(true)}
              className="flex justify-between items-center py-4 border-t border-[#F0EDEA] w-full text-left"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] leading-[18px] text-[#D32F2F] font-red-hat">
                  Delete all data
                </span>
                <span className="text-[12px] leading-4 text-[#9C958D] font-red-hat">
                  Permanently remove all transcripts and notes
                </span>
              </div>
            </button>
          </div>

          {/* Timezone — informational. Styled as a soft info card so it reads
              as a note, not a tappable row. No border, no chevron, no hover. */}
          {savedTimezone && (
            <div className="pt-6 select-none">
              <div className="flex items-start gap-3 rounded-[14px] bg-[#F5F3F0] border border-[#ECE8E2] px-4 py-3.5">
                <svg
                  aria-hidden
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#B0AAA2"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="shrink-0 mt-px"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 15 14" />
                </svg>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <p className="text-[12px] leading-4 text-[#6B655D] font-red-hat">
                    Days and times are shown in your local timezone.
                  </p>
                  <span className="inline-flex self-start items-center rounded-full bg-[#ECE8E2] px-2 py-0.5 text-[11px] leading-4 tracking-[0.2px] text-[#6B655D] font-red-hat font-medium">
                    {savedTimezone}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Version footer */}
          
        </div>
      </div>

      <BottomDrawer isOpen={showExportDrawer} onClose={() => setShowExportDrawer(false)}>
        <ExportAllDialog
          key={showExportDrawer ? "open" : "closed"}
          onClose={() => setShowExportDrawer(false)}
          onDone={(summary) => {
            setShowExportDrawer(false);
            toast.success(summary);
          }}
          session={session}
          defaultEmail={userId || ""}
        />
      </BottomDrawer>

      <BottomDrawer isOpen={showDeleteDrawer} onClose={() => setShowDeleteDrawer(false)}>
        <DeleteAllDialog
          key={showDeleteDrawer ? "open" : "closed"}
          onClose={() => setShowDeleteDrawer(false)}
          onDone={() => {
            setShowDeleteDrawer(false);
            toast.success("All data deleted");
          }}
          session={session}
        />
      </BottomDrawer>
    </div>
  );
}

// ── Export All dialog (email delivery only) ──

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ExportAllDialog({
  onClose,
  onDone,
  session,
  defaultEmail,
}: {
  onClose: () => void;
  onDone: (summary: string) => void;
  session: SessionI;
  defaultEmail: string;
}) {
  const [to, setTo] = useState(defaultEmail);
  const [ccInput, setCcInput] = useState("");
  const [ccList, setCcList] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCc = (raw: string) => {
    const email = raw.trim().replace(/,$/, "").trim();
    if (!email || !EMAIL_REGEX.test(email)) return;
    if (ccList.includes(email) || email === to) {
      setCcInput("");
      return;
    }
    setCcList([...ccList, email]);
    setCcInput("");
  };

  const removeCc = (email: string) => {
    setCcList(ccList.filter((e) => e !== email));
  };

  const toValid = EMAIL_REGEX.test(to.trim());
  const canSend = toValid && !isSending;

  const handleSend = async () => {
    if (!canSend || !session?.settings?.sendExportAllEmail) return;
    setIsSending(true);
    setError(null);
    try {
      const result = await session.settings.sendExportAllEmail({
        to: to.trim(),
        cc: ccList.length > 0 ? ccList : undefined,
      });
      onDone(
        `Export sent (${result.transcriptCount} transcript${result.transcriptCount === 1 ? "" : "s"}, ${result.noteCount} note${result.noteCount === 1 ? "" : "s"})`,
      );
    } catch (err) {
      console.error("[SettingsPage] Export email failed:", err);
      setError("Couldn't send the email. Try again.");
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[20px] leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
        Export all data
      </div>
      <div className="text-[14px] leading-5 text-[#78716C] font-red-hat">
        We'll email you a ZIP of plain-text transcripts and notes.
      </div>

      {/* To */}
      <label className="flex flex-col gap-1.5 pt-2">
        <span className="tracking-[0.08em] uppercase text-[11px] leading-3.5 text-[#A8A29E] font-red-hat font-bold">
          To
        </span>
        <input
          type="email"
          inputMode="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="you@example.com"
          className="bg-[#F5F5F4] rounded-xl px-3.5 py-3 text-[15px] leading-5 text-[#1C1917] font-red-hat placeholder-[#A8A29E] outline-none focus:ring-2 focus:ring-[#1C1917]"
        />
      </label>

      {/* CC */}
      <label className="flex flex-col gap-1.5">
        <span className="tracking-[0.08em] uppercase text-[11px] leading-3.5 text-[#A8A29E] font-red-hat font-bold">
          CC <span className="text-[#D6D3D1] font-normal normal-case tracking-normal">(optional)</span>
        </span>
        <div className="flex flex-wrap gap-1.5 bg-[#F5F5F4] rounded-xl px-2.5 py-2 min-h-11">
          {ccList.map((email) => (
            <span
              key={email}
              className="flex items-center gap-1 rounded-lg bg-[#E7E5E4] px-2 py-1 text-[13px] leading-4 text-[#1C1917] font-red-hat"
            >
              {email}
              <button
                type="button"
                onClick={() => removeCc(email)}
                className="text-[#78716C] hover:text-[#1C1917] leading-none text-[14px]"
                aria-label={`Remove ${email}`}
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="email"
            inputMode="email"
            value={ccInput}
            onChange={(e) => setCcInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "," || e.key === " ") {
                e.preventDefault();
                addCc(ccInput);
              } else if (e.key === "Backspace" && !ccInput && ccList.length > 0) {
                setCcList(ccList.slice(0, -1));
              }
            }}
            onBlur={() => addCc(ccInput)}
            placeholder={ccList.length === 0 ? "Add email and press Enter" : ""}
            className="flex-1 min-w-[140px] bg-transparent px-1.5 py-1 text-[14px] leading-5 text-[#1C1917] font-red-hat placeholder-[#A8A29E] outline-none"
          />
        </div>
      </label>

      {error && (
        <div className="text-[13px] leading-4 text-[#DC2626] font-red-hat">
          {error}
        </div>
      )}

      <div className="flex gap-3 w-full mt-2">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-medium bg-[#F5F5F4] text-[#78716C]"
        >
          Cancel
        </button>
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-bold bg-[#1C1917] text-white disabled:opacity-50"
        >
          {isSending ? "Sending..." : "Send email"}
        </button>
      </div>
    </div>
  );
}

// ── Delete All dialog (10s countdown + checkbox gate) ──

function DeleteAllDialog({
  onClose,
  onDone,
  session,
}: {
  onClose: () => void;
  onDone: () => void;
  session: SessionI;
}) {
  const COUNTDOWN_SECONDS = 10;
  const [remaining, setRemaining] = useState(COUNTDOWN_SECONDS);
  const [confirmed, setConfirmed] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);

  const unlocked = remaining === 0;
  const canDelete = unlocked && confirmed && !isDeleting;

  const handleDelete = async () => {
    if (!canDelete || !session?.settings?.deleteAllUserData) return;
    setIsDeleting(true);
    setError(null);
    try {
      await session.settings.deleteAllUserData();
      onDone();
    } catch (err) {
      console.error("[SettingsPage] Delete all failed:", err);
      setError("Failed to delete. Try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[20px] leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
        Delete all data
      </div>
      <div className="text-[14px] leading-5 text-[#78716C] font-red-hat">
        This will permanently remove all your transcripts and notes. This cannot be undone.
      </div>

      {/* Countdown / unlocked indicator */}
      <div className="text-[13px] leading-4 font-red-hat font-medium">
        {unlocked ? (
          <span className="text-[#1C1917]">Ready to confirm</span>
        ) : (
          <span className="text-[#9C958D]">
            You can confirm in {remaining}s…
          </span>
        )}
      </div>

      {/* Confirmation checkbox */}
      <button
        type="button"
        onClick={() => unlocked && setConfirmed((c) => !c)}
        disabled={!unlocked}
        className={`flex items-start gap-3 text-left py-3 ${unlocked ? "" : "opacity-50"}`}
      >
        <div
          className={`mt-0.5 shrink-0 size-5 rounded-md flex items-center justify-center transition-colors ${
            confirmed
              ? "bg-[#DC2626]"
              : "border-2 border-[#D6D3D1] bg-transparent"
          }`}
        >
          {confirmed && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <polyline points="6,12 10,16 18,8" stroke="#FAFAF9" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
        <span className="text-[14px] leading-5 text-[#1C1917] font-red-hat">
          I understand my data will be permanently deleted.
        </span>
      </button>

      {error && (
        <div className="text-[13px] leading-4 text-[#DC2626] font-red-hat">
          {error}
        </div>
      )}

      <div className="flex gap-3 w-full mt-1">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-medium bg-[#F5F5F4] text-[#78716C]"
        >
          Cancel
        </button>
        <button
          onClick={handleDelete}
          disabled={!canDelete}
          className="flex-1 py-3 rounded-xl text-[15px] leading-5 font-red-hat font-bold bg-[#DC2626] text-white disabled:opacity-50"
        >
          {isDeleting ? "Deleting..." : "Delete everything"}
        </button>
      </div>
    </div>
  );
}
