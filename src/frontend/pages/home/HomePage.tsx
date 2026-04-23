/**
 * HomePage — Transcripts-only view.
 *
 * Background conversation detection and auto-note generation still run server-side;
 * the old Conversations list, filter drawer, calendar, merge/export,
 * and FAB mic controls have been removed.
 *
 * Long-press a transcript day to enter multi-select mode for bulk export/delete.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useNavigation } from "../../navigation/NavigationStack";
import { useMentraAuth } from "@mentra/react";
import { AnimatePresence } from "motion/react";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import { useMultiSelect } from "../../hooks/useMultiSelect";
import type { SessionI } from "../../../shared/types";
import { TranscriptList } from "./components/TranscriptList";
import { HomePageSkeleton } from "../../components/shared/SkeletonLoader";
import { SelectionHeader } from "../../components/shared/SelectionHeader";
import { MultiSelectBar, ExportIcon, DeleteIcon } from "../../components/shared/MultiSelectBar";
import { ExportDrawer, type ExportOptions } from "../../components/shared/ExportDrawer";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
import { toast } from "../../components/shared/toast";
import { useTabBar } from "../../components/layout/Shell";

export function HomePage() {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const { push } = useNavigation();

  const transcriptSelect = useMultiSelect();
  const tabBar = useTabBar();

  // Slide the bottom tab bar out while in selection mode so MultiSelectBar can take its place
  useEffect(() => {
    tabBar.setHidden(transcriptSelect.isSelecting);
    return () => tabBar.setHidden(false);
  }, [transcriptSelect.isSelecting, tabBar]);

  const [showExportDrawer, setShowExportDrawer] = useState(false);
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const pendingDatesRef = useRef<string[]>([]);

  const files = session?.file?.files ?? [];
  const isRecording = session?.transcript?.isRecording ?? false;
  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const availableDates = session?.transcript?.availableDates ?? [];
  const conversations = session?.conversation?.conversations ?? [];

  const toggleTranscription = () => {
    session?.settings?.updateSettings({ transcriptionPaused: !transcriptionPaused });
  };

  // ── Multi-select handlers ──

  const handleBatchExport = useCallback(async (options: ExportOptions) => {
    if (!session?.transcript) return;

    const selectedDates = [...transcriptSelect.selectedIds];
    const textParts: string[] = [];

    for (const dateStr of selectedDates) {
      try {
        const result = await session.transcript.loadDateTranscript(dateStr);
        if (result?.segments && result.segments.length > 0) {
          const [year, month, day] = dateStr.split("-").map(Number);
          const dateObj = new Date(year, month - 1, day);
          const dateLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

          const segmentLines = result.segments.map((s) => {
            const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
            return `[${time}] ${s.text}`;
          }).join("\n");

          textParts.push(`# Transcript — ${dateLabel}\n${segmentLines}`);
        }
      } catch (err) {
        console.error(`Failed to load transcript for ${dateStr}:`, err);
      }
    }

    if (options.destination === "email") {
      pendingDatesRef.current = selectedDates;
      setShowEmailDrawer(true);
      return;
    }

    const text = textParts.join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
      return;
    }
    transcriptSelect.cancel();
  }, [transcriptSelect, session]);

  const handleEmailSend = useCallback(async (to: string, cc: string) => {
    const dates = pendingDatesRef.current;
    if (dates.length === 0 || !session?.transcript) return;

    const emailNotes: Array<{
      noteId: string;
      noteTimestamp: string;
      noteTitle: string;
      noteContent: string;
      noteType: string;
    }> = [];

    let sessionDate = "";
    let firstStart = "";
    let lastEnd = "";

    for (const dateStr of dates) {
      const result = await session.transcript.loadDateTranscript(dateStr);
      if (!result?.segments?.length) continue;

      const [year, month, day] = dateStr.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);
      const dateLabel = dateObj.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      if (!sessionDate) sessionDate = dateObj.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

      const segmentLines = result.segments.map((s) => {
        const time = new Date(s.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        if (!firstStart) firstStart = time;
        lastEnd = time;
        return `<tr><td style="color:#A8A29E;font-size:13px;padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;">${time}</td><td style="color:#1C1917;font-size:14px;line-height:21px;padding:4px 0;">${s.text}</td></tr>`;
      }).join("");

      const segCount = result.segments.length;
      const startTime = new Date(result.segments[0].timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      const endTime = new Date(result.segments[result.segments.length - 1].timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

      emailNotes.push({
        noteId: `transcript-${dateStr}`,
        noteTimestamp: `${startTime} — ${endTime}`,
        noteTitle: dateLabel,
        noteContent: `<p style="margin:0 0 12px;color:#A8A29E;font-size:12px;">${segCount} segments</p><table cellpadding="0" cellspacing="0" border="0" width="100%">${segmentLines}</table>`,
        noteType: "Transcript",
      });
    }

    if (emailNotes.length === 0) return;

    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;

    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        cc: ccList,
        sessionDate: sessionDate || "Transcripts",
        sessionStartTime: firstStart,
        sessionEndTime: lastEnd,
        notes: emailNotes,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
    toast.success(`Email sent to ${to}`);
    transcriptSelect.cancel();
  }, [session, transcriptSelect]);

  const deleteWarning = useMemo(() => {
    const dates = [...transcriptSelect.selectedIds];
    const affectedConvs = conversations.filter((c) => {
      if (!c.startTime) return false;
      const convDate = new Date(c.startTime);
      const convDateStr = `${convDate.getFullYear()}-${String(convDate.getMonth() + 1).padStart(2, "0")}-${String(convDate.getDate()).padStart(2, "0")}`;
      return dates.includes(convDateStr);
    });

    if (affectedConvs.length > 0) {
      return `${affectedConvs.length} ${affectedConvs.length === 1 ? "conversation" : "conversations"} will lose ${affectedConvs.length === 1 ? "its" : "their"} linked transcript. This cannot be undone.`;
    }
    return "This will permanently delete the transcript data. This cannot be undone.";
  }, [transcriptSelect.selectedIds, conversations]);

  const handleBatchDeleteConfirmed = useCallback(async () => {
    if (!session?.file) return;
    const dates = [...transcriptSelect.selectedIds];
    for (const dateStr of dates) {
      await session.file.trashFile(dateStr);
    }
    await session.transcript?.removeDates(dates);
    setShowDeleteConfirm(false);
    transcriptSelect.cancel();
  }, [transcriptSelect, session]);

  const selectActions = useMemo(() => [
    { icon: <ExportIcon />, label: "Export", onClick: () => setShowExportDrawer(true) },
    { icon: <DeleteIcon />, label: "Delete", onClick: () => setShowDeleteConfirm(true), variant: "danger" as const },
  ], []);

  const exportLabel = useMemo(
    () => `${transcriptSelect.count} transcript${transcriptSelect.count === 1 ? "" : "s"} selected`,
    [transcriptSelect.count],
  );

  const selectableDates = availableDates;

  if (!session) {
    return <HomePageSkeleton />;
  }

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
      {/* Header — swaps between normal and selection mode (matches NotesPage) */}
      {transcriptSelect.isSelecting ? (
        <div className="shrink-0 pt-3">
          <SelectionHeader
            count={transcriptSelect.count}
            onCancel={transcriptSelect.cancel}
            onSelectAll={() => transcriptSelect.selectAll(selectableDates)}
          />
        </div>
      ) : (
        <div className="flex flex-col pt-1.5 pb-3 gap-0.5 px-6 shrink-0">
          <div className="text-[11px] tracking-[1.5px] uppercase text-[#DC2626] font-red-hat font-bold leading-3.5">
            Mentra Notes
          </div>
          <div className="text-[34px] leading-10.5 text-[#1A1A1A] font-red-hat font-black tracking-[-0.5px]">
            Transcripts
          </div>
          <div className="text-[14px] leading-4.5 text-[#A8A29E] font-red-hat pt-1">
            {availableDates.length} {availableDates.length === 1 ? "day" : "days"} of transcripts
          </div>
        </div>
      )}
      {/* Transcribing status bar — hidden during selection */}
      {!transcriptSelect.isSelecting && (
        <div
          className={`flex items-center justify-between px-6 border-b shrink-0 ${
            transcriptionPaused
              ? "py-4 bg-[#F5F3F0] border-[#E8E5E1]"
              : "py-3.5 bg-[#D32F2F0D] border-[#D32F2F1A]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`rounded-[5px] shrink-0 size-2.5 ${
                transcriptionPaused
                  ? "bg-[#B0AAA2]"
                  : "bg-[#D32F2F] animate-pulse [box-shadow:#D32F2F2E_0px_0px_0px_3px]"
              }`}
            />
            <div className="flex flex-col gap-px">
              <div
                className={`text-[14px] leading-4.5 font-red-hat font-bold ${
                  transcriptionPaused ? "text-[#6B655D]" : "text-[#D32F2F] tracking-[-0.2px]"
                }`}
              >
                {transcriptionPaused ? "Paused" : "Transcribing"}
              </div>
              <div className="text-[11px] leading-3.5 text-[#9C958D] font-red-hat font-medium">
                {transcriptionPaused ? "Microphone off" : "Microphone on"}
              </div>
            </div>
          </div>
          <button
            onClick={toggleTranscription}
            className={`flex items-center rounded-3xl py-2.5 px-5 gap-1.75 ${
              transcriptionPaused
                ? "bg-[#DC2626]"
                : "bg-white border-[1.5px] border-[#E0DBD5]"
            }`}
          >
            {transcriptionPaused ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                </svg>
                <span className="text-[13px] leading-4 text-white font-red-hat font-bold">
                  Resume
                </span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3D3832" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
                <span className="text-[13px] leading-4 text-[#3D3832] font-red-hat font-bold">
                  Pause
                </span>
              </>
            )}
          </button>
        </div>
      )}
      <div className={`flex-1 overflow-hidden ${transcriptSelect.isSelecting ? "" : "px-6"}`}>
        <div className="h-full overflow-y-auto pb-32">
          <TranscriptList
            availableDates={availableDates}
            files={files}
            isRecording={isRecording}
            transcriptionPaused={transcriptionPaused}
            onSelect={(dateStr) => push(`/transcript/${dateStr}`)}
            isSelecting={transcriptSelect.isSelecting}
            selectedDates={transcriptSelect.selectedIds}
            onToggleSelect={(dateStr) => transcriptSelect.toggleItem(dateStr)}
            longPressProps={transcriptSelect.longPressProps}
          />
        </div>
      </div>

      {/* Multi-select bottom bar */}
      <AnimatePresence>
        {transcriptSelect.isSelecting && (
          <MultiSelectBar actions={selectActions} />
        )}
      </AnimatePresence>

      {/* Export Drawer */}
      <ExportDrawer
        isOpen={showExportDrawer}
        onClose={() => setShowExportDrawer(false)}
        itemType="transcript"
        itemLabel={exportLabel}
        count={transcriptSelect.count}
        onExport={handleBatchExport}
      />

      {/* Email Drawer */}
      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => setShowEmailDrawer(false)}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel={transcriptSelect.count === 1 ? "Transcript" : `${transcriptSelect.count} Transcripts`}
      />

      {/* Delete Confirmation */}
      <Drawer.Root open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[6px] z-50" />
          <Drawer.Content className="flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] outline-none">
            <div className="flex justify-center pt-3 pb-4">
              <div className="w-9 h-1 rounded-xs bg-[#D6D3D1] shrink-0" />
            </div>
            <Drawer.Title className="sr-only">Delete Transcripts</Drawer.Title>
            <Drawer.Description className="sr-only">Confirm transcript deletion</Drawer.Description>
            <div className="px-6 pb-10">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xl leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
                  Delete Transcripts?
                </span>
                <button onClick={() => setShowDeleteConfirm(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="text-[14px] leading-5 text-[#78716C] font-red-hat pb-6">
                {deleteWarning}
              </p>
              <button
                onClick={handleBatchDeleteConfirmed}
                className="flex items-center justify-center w-full rounded-xl bg-[#DC2626] p-3.5 mb-3"
              >
                <span className="text-[16px] leading-5 text-white font-red-hat font-bold">
                  Delete Transcripts
                </span>
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex items-center justify-center w-full rounded-xl border border-[#E7E5E4] p-3.5"
              >
                <span className="text-[16px] leading-5 text-[#1C1917] font-red-hat font-bold">
                  Cancel
                </span>
              </button>
            </div>
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
