/**
 * NotesPage — Passive list of notes grouped by the day they were created.
 *
 * The old filter / folder / trash / archive / favourites UI is gone; those
 * fields still exist in the schema but aren't surfaced. Notes are generated
 * by the agent in the background — this page only reads, opens, exports, or
 * permanently deletes them.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useNavigation } from "../../navigation/NavigationStack";
import { useMentraAuth } from "@mentra/react";
import { AnimatePresence, motion } from "motion/react";
import { format, isToday, isYesterday } from "date-fns";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import { useMultiSelect } from "../../hooks/useMultiSelect";
import type { SessionI, Note } from "../../../shared/types";
import { NoteRow } from "./NoteRow";
import { SelectionHeader } from "../../components/shared/SelectionHeader";
import { MultiSelectBar, type MultiSelectAction, ExportIcon, DeleteIcon } from "../../components/shared/MultiSelectBar";
import { ExportDrawer, type ExportOptions } from "../../components/shared/ExportDrawer";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
import { toast } from "../../components/shared/toast";
import { useTabBar } from "../../components/layout/Shell";

/** Strip HTML tags and return first ~40 words */
function stripHtmlAndTruncate(html: string | undefined, maxWords = 40): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").slice(0, maxWords);
  return words.length >= maxWords ? words.join(" ") + "..." : words.join(" ");
}

/** Short date label — "Today" / "Yesterday" / "Mar 12" / "Mar 12, 2024". No weekday names. */
function formatDayLabel(d: Date): string {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return sameYear ? format(d, "MMM d") : format(d, "MMM d, yyyy");
}

/** Key used to bucket notes by local-date (YYYY-MM-DD) — so timezone-local grouping is stable. */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function NotesPage() {
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const { push } = useNavigation();

  const [showExportDrawer, setShowExportDrawer] = useState(false);
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const multiSelect = useMultiSelect();
  const tabBar = useTabBar();

  // Slide the bottom tab bar out in selection mode — same pattern as TranscriptList
  useEffect(() => {
    tabBar.setHidden(multiSelect.isSelecting);
    return () => tabBar.setHidden(false);
  }, [multiSelect.isSelecting, tabBar]);

  const allNotes = session?.notes?.notes ?? [];

  // Only "live" notes — trashed/archived are invisible. Deletion is permanent;
  // if something is still `isTrashed` in the DB (leftover from old UI), hide it.
  const visibleNotes = useMemo(() => {
    return allNotes
      .filter((n) => !n.isTrashed && !n.isArchived)
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allNotes]);

  // Group by the *createdAt* day in the user's local timezone, preserving
  // overall newest-first order across groups.
  const groupedNotes = useMemo(() => {
    const groups = new Map<string, { key: string; date: Date; notes: Note[] }>();
    for (const n of visibleNotes) {
      const created = new Date(n.createdAt);
      const key = localDateKey(created);
      let group = groups.get(key);
      if (!group) {
        group = { key, date: created, notes: [] };
        groups.set(key, group);
      }
      group.notes.push(n);
    }
    // Map iteration preserves insertion order; visibleNotes is already sorted
    // newest-first so groups come out newest-first.
    return [...groups.values()];
  }, [visibleNotes]);

  const handleSelectNote = (note: Note) => {
    push(`/note/${note.id}`);
  };

  // ── Multi-select handlers ──

  const handleBatchExport = useCallback(async (options: ExportOptions) => {
    if (!session?.notes) return;

    if (options.destination === "email") {
      setShowEmailDrawer(true);
      return;
    }

    // Clipboard
    const selected = visibleNotes.filter((n) => multiSelect.selectedIds.has(n.id));
    const textParts: string[] = [];

    for (const note of selected) {
      const content = stripHtmlAndTruncate(note.content, 9999);
      const created = note.createdAt ? new Date(note.createdAt) : null;
      const dateLabel = created
        ? created.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
        : note.date;
      const createdAt = created
        ? created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "";
      const typeLabel = note.isAIGenerated ? "AI Generated" : "Manual";

      let meta = `Date: ${dateLabel}`;
      if (createdAt) meta += `\nCreated: ${createdAt}`;
      meta += `\nType: ${typeLabel}`;

      textParts.push(`# ${note.title || "Untitled Note"}\n${meta}\n\n${content}`);
    }

    const text = textParts.join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
      return;
    }
    multiSelect.cancel();
  }, [session, multiSelect, visibleNotes]);

  const handleEmailSend = useCallback(async (to: string, cc: string) => {
    const selected = visibleNotes.filter((n) => multiSelect.selectedIds.has(n.id));
    if (selected.length === 0) return;

    const first = selected[0];
    const firstCreated = first.createdAt ? new Date(first.createdAt) : new Date();
    const sessionDate = firstCreated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const startTime = firstCreated.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const emailNotes = selected.map((note) => ({
      noteId: note.id,
      noteTimestamp: note.createdAt
        ? new Date(note.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "",
      noteTitle: note.title || "Untitled Note",
      noteContent: note.content || "",
      noteType: note.isAIGenerated ? "AI Generated" : "Manual",
    }));

    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;

    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        cc: ccList,
        sessionDate,
        sessionStartTime: startTime,
        sessionEndTime: "",
        notes: emailNotes,
      }),
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
    toast.success(`Email sent to ${to}`);
    multiSelect.cancel();
  }, [visibleNotes, multiSelect]);

  const handleBatchDeleteConfirmed = useCallback(async () => {
    if (!session?.notes?.permanentlyDeleteNote) {
      setShowDeleteConfirm(false);
      return;
    }
    const ids = [...multiSelect.selectedIds];
    for (const id of ids) {
      await session.notes.permanentlyDeleteNote(id);
    }
    setShowDeleteConfirm(false);
    multiSelect.cancel();
  }, [session, multiSelect]);

  const selectActions = useMemo((): MultiSelectAction[] => [
    { icon: <ExportIcon />, label: "Export", onClick: () => setShowExportDrawer(true) },
    { icon: <DeleteIcon />, label: "Delete", onClick: () => setShowDeleteConfirm(true), variant: "danger" },
  ], []);

  const exportItemLabel = useMemo(() => {
    if (multiSelect.count === 1) {
      const note = visibleNotes.find((n) => multiSelect.selectedIds.has(n.id));
      return note?.title || "Untitled Note";
    }
    return `${multiSelect.count} notes selected`;
  }, [multiSelect.count, multiSelect.selectedIds, visibleNotes]);

  // Row-level meta label: "Today, 2:10 PM" / "Yesterday, 2:10 PM" / "Mar 12, 2:10 PM"
  const formatRowMeta = (note: Note): string => {
    const created = note.createdAt ? new Date(note.createdAt) : null;
    if (!created) return "";
    const dayLabel = formatDayLabel(created);
    const time = created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${dayLabel}, ${time}`;
  };

  return (
    <div className="[font-synthesis:none] flex h-full flex-col bg-[#FCFBFA] relative overflow-hidden antialiased">
      {/* Header — swaps between normal and selection mode */}
      {multiSelect.isSelecting ? (
        <div className="shrink-0 pt-3">
          <SelectionHeader
            count={multiSelect.count}
            onCancel={multiSelect.cancel}
            onSelectAll={() => multiSelect.selectAll(visibleNotes.map((n) => n.id))}
          />
        </div>
      ) : (
        <div className="flex flex-col pt-1.5 pb-4 gap-0.5 px-6 shrink-0">
          <div className="tracking-[1.5px] uppercase text-[#D32F2F] font-red-hat font-bold text-[11px] leading-3.5">
            Mentra Notes
          </div>
          <div className="tracking-[-0.5px] text-[#1A1A1A] font-red-hat font-black text-[34px] leading-10.5">
            Notes
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-32">
        {visibleNotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-5 px-6">
            <svg width="140" height="130" viewBox="0 0 140 130" fill="none">
              <circle cx="30" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="38" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="46" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="54" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="62" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="70" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="78" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="86" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="94" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="102" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="110" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="30" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="38" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="46" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="54" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="62" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="70" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="70" cy="66" r="2.5" fill="#D94F3B59" />
              <circle cx="70" cy="74" r="2" fill="#D94F3B59" />
              <circle cx="70" cy="82" r="2.5" fill="#D94F3B59" />
              <circle cx="78" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="86" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="94" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="102" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="66" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="74" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="82" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="66" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="74" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="82" r="3" fill="#D94F3B59" />
              <circle cx="25" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="33" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="41" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="49" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="57" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="65" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="20" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="28" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="36" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="44" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="52" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="60" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="15" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="23" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="31" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="39" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="47" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="55" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="75" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="83" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="91" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="99" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="107" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="115" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="80" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="88" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="96" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="104" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="112" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="120" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="85" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="93" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="101" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="109" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="117" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="125" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="46" cy="68" r="2" fill="#D94F3B0F" />
              <circle cx="62" cy="72" r="1.5" fill="#D94F3B0D" />
              <circle cx="78" cy="66" r="1.5" fill="#D94F3B0D" />
              <circle cx="55" cy="78" r="1.5" fill="#D94F3B0A" />
              <circle cx="85" cy="76" r="1.5" fill="#D94F3B0A" />
              <circle cx="70" cy="82" r="2" fill="#D94F3B0A" />
            </svg>
            <div className="tracking-[0.01em] text-[#D94F3B8C] font-red-hat font-medium text-[18px] leading-[22px]">
              No notes yet
            </div>
            <div className="tracking-[0.02em] text-[#968C82B3] font-red-hat text-[13px] leading-4 text-center">
              Your notes will appear here
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {groupedNotes.map((group, groupIdx) => (
              <motion.div
                key={group.key}
                layout
                initial={false}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              >
                <div
                  className={`text-black font-red-hat px-6 text-[16px] leading-5 ${
                    groupIdx === 0 ? "py-2" : "pt-5 pb-2"
                  }`}
                >
                  {formatDayLabel(group.date)}
                </div>
                {group.notes.map((note) => (
                  <motion.div
                    key={note.id}
                    layout
                    initial={false}
                    exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
                    transition={{ duration: 0.25, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <NoteRow
                      note={note}
                      meta={formatRowMeta(note)}
                      stripHtmlAndTruncate={stripHtmlAndTruncate}
                      onSelect={handleSelectNote}
                      isSelecting={multiSelect.isSelecting}
                      isSelected={multiSelect.selectedIds.has(note.id)}
                      onToggleSelect={() => multiSelect.toggleItem(note.id)}
                      longPressHandlers={multiSelect.longPressProps(note.id)}
                    />
                  </motion.div>
                ))}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Multi-select bottom bar */}
      <AnimatePresence>
        {multiSelect.isSelecting && (
          <MultiSelectBar actions={selectActions} />
        )}
      </AnimatePresence>

      {/* Export Drawer */}
      <ExportDrawer
        isOpen={showExportDrawer}
        onClose={() => setShowExportDrawer(false)}
        itemType="note"
        itemLabel={exportItemLabel}
        count={multiSelect.count}
        onExport={handleBatchExport}
      />

      {/* Email Drawer */}
      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => setShowEmailDrawer(false)}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel={multiSelect.count === 1 ? "Note" : `${multiSelect.count} Notes`}
      />

      {/* Delete confirmation — irreversible */}
      <Drawer.Root open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[6px] z-50" />
          <Drawer.Content className="flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] outline-none">
            <div className="flex justify-center pt-3 pb-4">
              <div className="w-9 h-1 rounded-xs bg-[#D6D3D1] shrink-0" />
            </div>
            <Drawer.Title className="sr-only">Delete Notes</Drawer.Title>
            <Drawer.Description className="sr-only">Confirm permanent note deletion</Drawer.Description>
            <div className="px-6 pb-10">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xl leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
                  Delete {multiSelect.count} {multiSelect.count === 1 ? "Note" : "Notes"}?
                </span>
                <button onClick={() => setShowDeleteConfirm(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="text-[14px] leading-5 text-[#78716C] font-red-hat pb-6">
                This will permanently delete {multiSelect.count === 1 ? "this note" : "these notes"}. This cannot be undone.
              </p>
              <button
                onClick={handleBatchDeleteConfirmed}
                className="flex items-center justify-center w-full rounded-xl bg-[#DC2626] p-3.5 mb-3"
              >
                <span className="text-[16px] leading-5 text-white font-red-hat font-bold">
                  Delete {multiSelect.count === 1 ? "Note" : "Notes"}
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
