/**
 * QuickActionsDrawer - Bottom drawer for quick note actions
 *
 * Uses vaul for proper spring physics and backdrop blur.
 *
 * Shows:
 * - Add Note (creates blank note)
 * - Generate note from current hour (opens time picker)
 *
 * Can be triggered from:
 * - Plus FAB on Notes tab
 * - Lightning button in bottom nav
 */

import { useState, useEffect } from "react";
import { useNavigation } from "../../navigation/NavigationStack";
import { useMentraAuth } from "@mentra/react";
import { clsx } from "clsx";
import { FileText, Sparkles, Loader2, Clock } from "lucide-react";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";

interface QuickActionsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  dateString?: string;
}

export function QuickActionsDrawer({
  isOpen,
  onClose,
  dateString,
}: QuickActionsDrawerProps) {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const { push } = useNavigation();

  const [showTimeRangePicker, setShowTimeRangePicker] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [error, setError] = useState("");

  const generating = session?.notes?.generating ?? false;

  // Determine label: "today" or formatted date like "Feb 27"
  const dateLabel = (() => {
    if (!dateString) return "today";
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (dateString === todayStr) return "today";
    const [y, m, d] = dateString.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  })();

  // Set default times to current hour when opening time picker
  useEffect(() => {
    if (showTimeRangePicker) {
      const now = new Date();
      const currentHour = now.getHours();
      const startHour = currentHour;
      const endHour = currentHour + 1;

      setStartTime(`${String(startHour).padStart(2, "0")}:00`);
      setEndTime(`${String(endHour % 24).padStart(2, "0")}:00`);
    }
  }, [showTimeRangePicker]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      setShowTimeRangePicker(false);
      setError("");
    }
  }, [isOpen]);

  const handleAddNote = async () => {
    if (!session?.notes?.createManualNote) return;

    try {
      const note = await session.notes.createManualNote("New Note", "");
      onClose();
      push(`/note/${note.id}`);
    } catch (err) {
      console.error("[QuickActionsDrawer] Failed to create note:", err);
    }
  };

  const handleGenerateNote = async () => {
    if (!session?.notes?.generateNote) return;
    setError("");

    try {
      const [startHour, startMin] = startTime.split(":").map(Number);
      const [endHour, endMin] = endTime.split(":").map(Number);

      // Use the dateString if on a DayPage, otherwise default to today
      let year: number, month: number, day: number;
      if (dateString) {
        [year, month, day] = dateString.split("-").map(Number);
      } else {
        const now = new Date();
        year = now.getFullYear();
        month = now.getMonth() + 1;
        day = now.getDate();
      }

      const startDate = new Date(year, month - 1, day, startHour, startMin);
      const endDate = new Date(year, month - 1, day, endHour, endMin);

      const note = await session.notes.generateNote(
        undefined,
        startDate,
        endDate,
      );
      onClose();
      if (note?.id) {
        push(`/note/${note.id}`);
      }
    } catch (err: any) {
      console.error("[QuickActionsDrawer] Failed to generate note:", err);
      const msg = err?.message || String(err);
      if (msg.includes("No transcript content")) {
        setError("No transcription available for this time period. Please select a different range.");
      } else {
        setError("Failed to generate note. Please try again.");
      }
    }
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Drawer.Content className="bg-white dark:bg-zinc-900 flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-zinc-100 dark:border-zinc-800">
          {/* Handle */}
          <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700 mt-4 mb-2" />

          {/* Header */}
          <div className="px-6 pb-4 flex items-center justify-between">
            <Drawer.Title className="text-lg font-semibold text-zinc-900 dark:text-white">
              {showTimeRangePicker ? "Generate Summary" : "Quick Actions"}
            </Drawer.Title>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">
              {dateLabel === "today" ? `Today, ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : dateLabel}
            </span>
            <Drawer.Description className="sr-only">
              {showTimeRangePicker
                ? "Select a time range to generate a summary"
                : "Quick actions for notes"}
            </Drawer.Description>
          </div>

          {/* Content */}
          <div className="px-6 pb-8">
            {showTimeRangePicker ? (
              // Time Range Picker View
              <div className="space-y-6">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Select a time range from the transcript to generate a focused
                  summary note.
                </p>

                {/* Time Inputs */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                      Start Time
                    </label>
                    <div className="relative">
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="w-full pl-4 pr-12 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden [&::-webkit-clear-button]:hidden"
                      />
                      <Clock
                        size={18}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 pointer-events-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
                      End Time
                    </label>
                    <div className="relative">
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full pl-4 pr-12 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-zinc-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white appearance-none [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-inner-spin-button]:hidden [&::-webkit-clear-button]:hidden"
                      />
                      <Clock
                        size={18}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 pointer-events-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Error message */}
                {error && (
                  <p className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-4 py-3 rounded-xl">
                    {error}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowTimeRangePicker(false); setError(""); }}
                    className="flex-1 py-4 rounded-xl font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerateNote}
                    disabled={generating}
                    className={clsx(
                      "flex-1 py-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors",
                      generating
                        ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed"
                        : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100",
                    )}
                  >
                    {generating ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles size={18} />
                        Generate
                      </>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              // Quick Actions List View
              <div className="space-y-2">
                {/* Add Note */}
                <button
                  onClick={handleAddNote}
                  className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <FileText
                      size={20}
                      className="text-zinc-600 dark:text-zinc-400"
                    />
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900 dark:text-white block">
                      Add note
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      Create a new blank note
                    </span>
                  </div>
                </button>

                {/* Generate from time */}
                <button
                  onClick={() => setShowTimeRangePicker(true)}
                  className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Sparkles
                      size={20}
                      className="text-zinc-600 dark:text-zinc-400"
                    />
                  </div>
                  <div>
                    <span className="font-medium text-zinc-900 dark:text-white block">
                      Generate AI note
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      AI summary from your transcript
                    </span>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Safe area padding for mobile */}
          <div className="h-safe-area-bottom" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
