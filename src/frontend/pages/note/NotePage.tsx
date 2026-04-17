/**
 * NotePage - Structured note viewer with inline editing
 *
 * Matches Paper design with:
 * - Back button + "Note" label + star + more menu
 * - AI/Manual badge + date + conversation source
 * - Editable title (always inline)
 * - Structured sections: Summary, Key Decisions
 * - TipTap editor inline for content editing
 * - Bottom formatting toolbar (bold, italic, heading, list, link)
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { isToday, isYesterday, format } from "date-fns";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, Note } from "../../../shared/types";
import { NotePageSkeleton } from "../../components/shared/SkeletonLoader";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
import { ExportDrawer, type ExportOptions } from "../../components/shared/ExportDrawer";
import { useTabBar } from "../../components/layout/Shell";
import { isDevelopmentMode } from "../../lib/devMode";
import { rewriteR2Urls } from "../../../shared/constants";

// =============================================================================
// Component
// =============================================================================

export function NotePage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");

  const [editTitle, setEditTitle] = useState("");
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);
  const [showExportDrawer, setShowExportDrawer] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hide the bottom tab bar while on this route (spec: detail page is full-bleed)
  const tabBar = useTabBar();
  useEffect(() => {
    tabBar.setHidden(true);
    return () => tabBar.setHidden(false);
  }, [tabBar]);

  const noteId = params.id || "";
  const allNotes = session?.notes?.notes ?? [];
  const note = allNotes.find((n) => n.id === noteId);
  const conversations = session?.conversation?.conversations ?? [];

  // Find the source conversation for this note (match by noteId link)
  const sourceConversation = useMemo(() => {
    if (!note) return null;
    return conversations.find((c) => c.noteId === note.id) ?? null;
  }, [note, conversations]);

  // Format the meta line: "Today, 2:10 PM" / "Yesterday, 2:10 PM" / "Mar 12, 2:10 PM"
  // Uses createdAt so a note created at 11:58 PM stays in its real day.
  const metaLabel = useMemo(() => {
    const created = note?.createdAt ? new Date(note.createdAt) : null;
    if (!created) return "";
    let dayLabel: string;
    if (isToday(created)) dayLabel = "Today";
    else if (isYesterday(created)) dayLabel = "Yesterday";
    else {
      const sameYear = created.getFullYear() === new Date().getFullYear();
      dayLabel = sameYear ? format(created, "MMM d") : format(created, "MMM d, yyyy");
    }
    const time = created.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${dayLabel}, ${time}`;
  }, [note?.createdAt]);

  // Dev-only "From: …" source label — conversations UI is deprecated but we
  // still want the link in dev so engineers can jump into the source.
  const sourceLabel = useMemo(() => {
    if (!note?.isAIGenerated || !sourceConversation) return null;
    const duration = sourceConversation.endTime
      ? Math.round(
          (new Date(sourceConversation.endTime).getTime() -
            new Date(sourceConversation.startTime).getTime()) /
            60000,
        )
      : null;
    return `From: ${sourceConversation.title}${duration ? ` · ${duration} min` : ""}`;
  }, [note, sourceConversation]);


  // Parse markdown to HTML
  const parseContentToHtml = useCallback((content: string): string => {
    if (!content) return "";
    if (content.includes("<p>") || content.includes("<h")) return content;
    return content
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .split("\n\n")
      .map((p) => p.trim())
      .filter((p) => p)
      .map((p) =>
        p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<ol")
          ? p
          : `<p>${p}</p>`,
      )
      .join("");
  }, []);

  const buildEditorContent = useCallback(
    (note: Note): string => {
      let html = "";
      const content = note.content;
      const summary = note.summary;
      if (
        content &&
        content.trim() &&
        content.trim() !== "Tap to edit this note..."
      ) {
        html =
          content.includes("<p>") || content.includes("<h")
            ? content
            : parseContentToHtml(content);
      } else if (summary && summary.trim()) {
        html =
          summary.includes("<p>") || summary.includes("<h")
            ? summary
            : `<p>${summary}</p>`;
      }
      return rewriteR2Urls(html);
    },
    [parseContentToHtml],
  );

  // TipTap editor — always inline, always editable
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: "rounded-lg max-w-full h-auto my-3" },
      }),
      Placeholder.configure({
        placeholder: "Start writing...",
        emptyEditorClass: "is-editor-empty",
      }),
    ],
    content: "",
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "focus:outline-none min-h-[200px]" },
    },
    onUpdate: ({ editor }) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        handleAutoSave(editor.getHTML());
      }, 1500);
    },
  });

  // Initialize editor content when note loads
  useEffect(() => {
    if (note && editor) {
      setEditTitle(note.title || "");
      editor.commands.setContent(buildEditorContent(note));
    }
  }, [note?.id, editor, buildEditorContent]);

  // Auto-save content
  const handleAutoSave = async (content: string) => {
    if (!session?.notes?.updateNote || !note) return;
    setIsSaving(true);
    try {
      await session.notes.updateNote(noteId, { title: editTitle, content });
      setShowSaved(true);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
    } catch (err) {
      console.error("[NotePage] Auto-save failed:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Save on title change (debounced)
  useEffect(() => {
    if (!note || editTitle === note.title) return;
    const timeout = setTimeout(() => {
      session?.notes
        ?.updateNote(noteId, { title: editTitle })
        .then(() => {
          setShowSaved(true);
          if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
          savedTimeoutRef.current = setTimeout(() => setShowSaved(false), 2000);
        })
        .catch(() => {});
    }, 1000);
    return () => clearTimeout(timeout);
  }, [editTitle, note?.title, noteId, session?.notes]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  if (!session) return <NotePageSkeleton />;

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FAFAF9]">
        <div className={`text-[16px] text-[#A8A29E] font-red-hat`}>
          Note not found
        </div>
        <button
          onClick={() => setLocation("/notes")}
          className={`mt-4 text-[14px] text-[#78716C] underline font-red-hat`}
        >
          Go back
        </button>
      </div>
    );
  }

  const handleBack = () => {
    // Save pending changes before leaving
    if (editor) handleAutoSave(editor.getHTML());
    setLocation("/notes");
  };

  const handleExport = useCallback(async (options: ExportOptions) => {
    if (!note) return;
    if (options.destination === "email") {
      setShowEmailDrawer(true);
      return;
    }
    const content = editor?.getHTML() || note.content || "";
    const text = content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const title = editTitle || note.title || "Untitled Note";
    await navigator.clipboard.writeText(`# ${title}\n\n${text}`);
  }, [note, editor, editTitle]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (!session?.notes?.permanentlyDeleteNote || !note) {
      setShowDeleteConfirm(false);
      return;
    }
    await session.notes.permanentlyDeleteNote(note.id);
    setShowDeleteConfirm(false);
    setLocation("/notes");
  }, [session, note, setLocation]);

  const handleEmailSend = async (to: string, cc: string) => {
    if (!note) return;
    const ccList = cc ? cc.split(",").filter(Boolean) : undefined;
    const dateStr = note.date || "";
    const noteDate = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
    const sessionDate = noteDate.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const createdAt = note.createdAt ? new Date(note.createdAt) : new Date();
    const noteTimestamp = createdAt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const startTime = note.transcriptRange?.startTime
      ? new Date(note.transcriptRange.startTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : noteTimestamp;
    const endTime = note.transcriptRange?.endTime
      ? new Date(note.transcriptRange.endTime).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "";

    const res = await fetch("/api/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        to,
        cc: ccList,
        sessionDate,
        sessionStartTime: startTime,
        sessionEndTime: endTime,
        notes: [
          {
            noteId: note.id,
            noteTimestamp,
            noteTitle: editTitle || note.title,
            noteContent: editor?.getHTML() || note.content,
            noteType: note.isAIGenerated ? "AI Generated" : "Manual",
          },
        ],
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Failed to send email");
  };

  return (
    <div className="[font-synthesis:none] flex h-full flex-col bg-[#FCFBFA] overflow-hidden antialiased">
      {/* Header bar — back chevron + "Note" label */}
      <div className="flex items-center justify-between py-3 px-6 shrink-0">
        <button onClick={handleBack} className="flex items-center gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-[18px] leading-[22px] text-[#1A1A1A] font-red-hat font-bold">
            Note
          </span>
        </button>
        {/* Save status — kept but muted, so auto-save is still visible */}
        <span className="text-[11px] text-[#A8A29E] font-red-hat mr-20">
          {isSaving ? "Saving..." : showSaved ? "Saved" : ""}
        </span>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Title row — extrabold title + export + delete action icons */}
        <div className="flex flex-col pb-3.5 gap-1.5 pt-2 px-6">
          <div className="flex items-center gap-1.5 justify-center">
            <textarea
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = e.target.scrollHeight + "px";
              }}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }
              }}
              placeholder="Untitled Note"
              rows={1}
              className="flex-1 tracking-[-0.5px] text-[#1A1A1A] font-red-hat font-extrabold text-[26px] leading-8 bg-transparent border-none focus:outline-none placeholder-[#D6D3D1] resize-none overflow-hidden break-words pr-6"
            />
            <div className="flex gap-3 w-fit shrink-0 pt-1">
              <button onClick={() => setShowExportDrawer(true)} aria-label="Export note">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </button>
              <button onClick={() => setShowDeleteConfirm(true)} aria-label="Delete note">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B655D" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>
          {/* Timestamp line — "Today, 2:10 PM" */}
          <div className="text-[#9C958D] font-red-hat text-[13px] leading-4">
            {metaLabel}
          </div>
          {/* Dev-only "From: …" conversation link */}
          {isDevelopmentMode && sourceLabel && sourceConversation && (
            <button
              onClick={() => setLocation(`/conversation/${sourceConversation.id}`)}
              className="flex items-center gap-2 active:opacity-70 transition-opacity self-start"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="#A8A29E"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="text-[13px] leading-[18px] text-[#78716C] font-red-hat font-medium underline underline-offset-2 decoration-[#D6D3D1]">
                {sourceLabel}
              </span>
            </button>
          )}
        </div>

        {/* Inline TipTap editor — always visible, always editable */}
        <div className="px-6 pt-0 pb-32">
          <EditorContent
            editor={editor}
            className={`font-red-hat text-[15px] leading-[22px] text-[#1C1917]
              prose prose-stone max-w-none
              prose-headings:font-bold prose-headings:text-[#1C1917]
              prose-h1:text-[20px] prose-h2:text-[18px] prose-h3:text-[16px]
              prose-p:text-[#44403C] prose-p:leading-[22px] prose-p:my-2
              prose-li:text-[#44403C]
              prose-strong:text-[#1C1917]
              prose-ul:my-2 prose-ol:my-2
              prose-li:my-0.5
              prose-li:marker:text-[#A8A29E]
              prose-blockquote:border-[#E7E5E4] prose-blockquote:text-[#78716C]
              prose-hr:border-[#E7E5E4]
              [&_.is-editor-empty:first-child::before]:text-[#D6D3D1]
              [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
              [&_.is-editor-empty:first-child::before]:float-left
              [&_.is-editor-empty:first-child::before]:h-0
              [&_.is-editor-empty:first-child::before]:pointer-events-none`}
          />
        </div>
      </div>

      {/* Bottom formatting toolbar — commented out for read-only/minimal detail page */}
      {false && (
      <div className="flex items-center justify-center pt-3 pb-3 gap-1 border-t border-[#F4F4F5] bg-[#FAFAF9] shrink-0">
        {editor && (
          <>
            {/* Bold */}
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`flex items-center justify-center rounded-[10px] shrink-0 size-10 ${
                editor.isActive("bold") ? "bg-[#F5F5F4]" : ""
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={editor.isActive("bold") ? "#1C1917" : "#71717A"}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
                <path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z" />
              </svg>
            </button>
            {/* Italic */}
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`flex items-center justify-center rounded-[10px] shrink-0 size-10 ${
                editor.isActive("italic") ? "bg-[#F5F5F4]" : ""
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={editor.isActive("italic") ? "#1C1917" : "#71717A"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="19" y1="4" x2="10" y2="4" />
                <line x1="14" y1="20" x2="5" y2="20" />
                <line x1="15" y1="4" x2="9" y2="20" />
              </svg>
            </button>
            {/* Heading */}
            <button
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className={`flex items-center justify-center rounded-[10px] shrink-0 size-10 ${
                editor.isActive("heading", { level: 2 }) ? "bg-[#F5F5F4]" : ""
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={
                  editor.isActive("heading", { level: 2 })
                    ? "#1C1917"
                    : "#71717A"
                }
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 12h8" />
                <path d="M4 18V6" />
                <path d="M12 18V6" />
                <path d="M17 12a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1a2 2 0 0 1-.6 1.4L17 18h4" />
              </svg>
            </button>
            {/* Bullet list */}
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`flex items-center justify-center rounded-[10px] shrink-0 size-10 ${
                editor.isActive("bulletList") ? "bg-[#F5F5F4]" : ""
              }`}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke={editor.isActive("bulletList") ? "#1C1917" : "#71717A"}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            {/* Link (placeholder) */}
            {/* <button className="flex items-center justify-center rounded-[10px] shrink-0 size-10">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#71717A"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </button> */}
          </>
        )}
      </div>
      )}

      {/* Export Drawer (clipboard / email) */}
      <ExportDrawer
        isOpen={showExportDrawer}
        onClose={() => setShowExportDrawer(false)}
        itemType="note"
        itemLabel={editTitle || note.title || "Untitled Note"}
        count={1}
        onExport={handleExport}
      />

      {/* Email Drawer (opened by ExportDrawer when destination=email) */}
      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => setShowEmailDrawer(false)}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel="Note"
      />

      {/* Delete confirmation — permanent */}
      <Drawer.Root open={showDeleteConfirm} onOpenChange={(open) => !open && setShowDeleteConfirm(false)}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/30 backdrop-blur-[6px] z-50" />
          <Drawer.Content className="flex flex-col rounded-t-[20px] fixed bottom-0 left-0 right-0 z-50 bg-[#FAFAF9] outline-none">
            <div className="flex justify-center pt-3 pb-4">
              <div className="w-9 h-1 rounded-xs bg-[#D6D3D1] shrink-0" />
            </div>
            <Drawer.Title className="sr-only">Delete Note</Drawer.Title>
            <Drawer.Description className="sr-only">Confirm permanent note deletion</Drawer.Description>
            <div className="px-6 pb-10">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xl leading-[26px] text-[#1C1917] font-red-hat font-extrabold tracking-[-0.02em]">
                  Delete Note?
                </span>
                <button onClick={() => setShowDeleteConfirm(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <line x1="18" y1="6" x2="6" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                    <line x1="6" y1="6" x2="18" y2="18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
              <p className="text-[14px] leading-5 text-[#78716C] font-red-hat pb-6">
                This will permanently delete this note. This cannot be undone.
              </p>
              <button
                onClick={handleDeleteConfirmed}
                className="flex items-center justify-center w-full rounded-xl bg-[#DC2626] p-3.5 mb-3"
              >
                <span className="text-[16px] leading-5 text-white font-red-hat font-bold">
                  Delete Note
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
