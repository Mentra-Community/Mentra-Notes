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
import { format, isToday, isYesterday } from "date-fns";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, Note } from "../../../shared/types";
import { NotePageSkeleton } from "../../components/shared/SkeletonLoader";
import { EmailDrawer } from "../../components/shared/EmailDrawer";
import { rewriteR2Urls } from "../../../shared/constants";

// =============================================================================
// Content parser — extracts structured sections from note content
// =============================================================================

interface ParsedNote {
  summary: string;
}

function parseNoteContent(content: string, summary?: string): ParsedNote {
  const result: ParsedNote = {
    summary: "",
  };

  if (summary) {
    result.summary = summary;
    return result;
  }

  if (!content) return result;

  // Strip HTML tags to extract a plain-text summary
  const text = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const bulletText = line
      .replace(/^[-•*]\s*/, "")
      .replace(/^\d+\.\s*/, "")
      .trim();
    if (!bulletText) continue;
    result.summary += (result.summary ? " " : "") + bulletText;
    if (result.summary.length > 200) break;
  }

  return result;
}

// =============================================================================
// Component
// =============================================================================

export function NotePage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");

  const [editTitle, setEditTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEmailDrawer, setShowEmailDrawer] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteId = params.id || "";
  const allNotes = session?.notes?.notes ?? [];
  const note = allNotes.find((n) => n.id === noteId);
  const conversations = session?.conversation?.conversations ?? [];

  // Find the source conversation for this note (match by noteId link)
  const sourceConversation = useMemo(() => {
    if (!note) return null;
    return conversations.find((c) => c.noteId === note.id) ?? null;
  }, [note, conversations]);

  // Parse structured content
  const parsed = useMemo(() => {
    if (!note) return null;
    return parseNoteContent(note.content, note.summary);
  }, [note?.content, note?.summary]);

  // Format date
  const dateLabel = useMemo(() => {
    if (!note?.date) return "";
    const [year, month, day] = note.date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    if (isToday(dateObj)) return "Today";
    if (isYesterday(dateObj)) return "Yesterday";
    return format(dateObj, "MMM d, yyyy");
  }, [note?.date]);

  // Source label
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

  const handleDelete = async () => {
    if (!session?.notes?.deleteNote) return;
    try {
      await session.notes.deleteNote(noteId);
      setLocation("/notes");
    } catch (err) {
      console.error("[NotePage] Failed to delete note:", err);
    }
  };

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
    <div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between pt-3 px-6 shrink-0">
        <button onClick={handleBack} className="flex items-center gap-3.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <polyline
              points="15,18 9,12 15,6"
              stroke="#1C1917"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span
            className={`text-[16px] leading-5 text-[#1C1917] font-red-hat font-semibold`}
          >
            Note
          </span>
        </button>
        <div className="flex items-center gap-4">
          {/* Save status */}
          <span className={`text-[11px] text-[#A8A29E] font-red-hat`}>
            {isSaving ? "Saving..." : showSaved ? "Saved" : ""}
          </span>
          {/* Favorite star */}
          <button className="p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2l2.09 6.26L20.18 9l-4.91 3.74L17.18 19 12 15.27 6.82 19l1.91-6.26L3.82 9l6.09-.74z"
                stroke="#1C1917"
                strokeWidth="1.75"
                fill="none"
              />
            </svg>
          </button>
          {/* More menu */}
          <div className="relative">
            <button onClick={() => setShowMenu(!showMenu)} className="p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="5" r="1.5" fill="#1C1917" />
                <circle cx="12" cy="12" r="1.5" fill="#1C1917" />
                <circle cx="12" cy="19" r="1.5" fill="#1C1917" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div
                  className={`absolute right-0 top-full mt-1 z-50 bg-white border border-[#E7E5E4] rounded-xl shadow-lg py-1 min-w-40 font-red-hat`}
                >
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowEmailDrawer(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-[14px] text-[#1C1917] flex items-center gap-3"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#78716C"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                      <polyline points="22,6 12,13 2,6" />
                    </svg>
                    Send Email
                  </button>
                  <div className="my-1 border-t border-[#E7E5E4]" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteConfirm(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-[14px] text-[#DC2626] flex items-center gap-3"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#DC2626"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                    Delete Note
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Meta section */}
        <div className="flex flex-col pt-5 gap-3 px-6">
          {/* Badges row */}
          <div className="flex items-center gap-2">
            {note.isAIGenerated ? (
              <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#FEE2E2]">
                <span
                  className={`text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-bold`}
                >
                  AI
                </span>
              </div>
            ) : (
              <div className="flex items-center rounded-sm py-0.5 px-2 bg-[#DBEAFE]">
                <span
                  className={`text-[10px] leading-3.5 text-[#2563EB] font-red-hat font-semibold`}
                >
                  Manual
                </span>
              </div>
            )}
            <div className="flex items-center rounded-sm py-0.5 px-2 gap-1 bg-[#F5F5F4]">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path
                  d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"
                  stroke="#78716C"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
              <span
                className={`text-[10px] leading-3.5 text-[#78716C] font-red-hat font-semibold`}
              >
                Work Notes
              </span>
            </div>
            <span
              className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat`}
            >
              {dateLabel}
            </span>
          </div>

          {/* Title (editable, auto-wrapping) */}
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
            className={`w-full text-[24px] leading-[30px] text-[#1C1917] font-red-hat font-extrabold bg-transparent border-none focus:outline-none placeholder-[#D6D3D1] resize-none overflow-hidden break-words p-0`}
          />

          {/* Source conversation */}
          {sourceLabel && sourceConversation && (
            <button className="flex items-center gap-2 active:opacity-70 transition-opacity">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
                  stroke="#A8A29E"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span
                onClick={() =>
                  setLocation(`/conversation/${sourceConversation.id}`)
                }
                className={`text-[13px] leading-[18px] text-[#78716C] font-red-hat font-medium underline underline-offset-2 decoration-[#D6D3D1]`}
              >
                {sourceLabel}
              </span>
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="h-px mt-5 mb-5 bg-[#E7E5E4] mx-6" />

        {/* Summary section (AI-generated notes only) */}
        {note.isAIGenerated && parsed?.summary && (
          <div className="flex flex-col gap-2.5 px-6">
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] tracking-[0.08em] uppercase leading-3.5 text-[#A8A29E] font-red-hat font-bold`}
              >
                Summary
              </span>
            </div>
          </div>
        )}

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

      {/* Bottom formatting toolbar */}
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
            <button className="flex items-center justify-center rounded-[10px] shrink-0 size-10">
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
            </button>
          </>
        )}
      </div>

      {/* Delete Confirmation Drawer */}
      <Drawer.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
          <Drawer.Content className="bg-[#FAFAF9] flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-[#E7E5E4]">
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-[#D6D3D1] mt-4 mb-2" />
            <div className="px-6 pb-8 pt-4">
              <Drawer.Title
                className={`text-lg font-semibold text-[#1C1917] text-center font-red-hat`}
              >
                Delete Note?
              </Drawer.Title>
              <Drawer.Description
                className={`text-sm text-[#A8A29E] text-center mt-3 font-red-hat`}
              >
                This action cannot be undone. The note will be permanently
                deleted.
              </Drawer.Description>
              <div className="flex gap-3 mt-6">
                <Drawer.Close asChild>
                  <button
                    className={`flex-1 py-3 rounded-xl font-medium bg-[#F5F5F4] text-[#78716C] font-red-hat`}
                  >
                    Cancel
                  </button>
                </Drawer.Close>
                <button
                  onClick={handleDelete}
                  className={`flex-1 py-3 rounded-xl font-medium bg-[#DC2626] text-white font-red-hat`}
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {/* Email Drawer */}
      <EmailDrawer
        isOpen={showEmailDrawer}
        onClose={() => setShowEmailDrawer(false)}
        onSend={handleEmailSend}
        defaultEmail={userId || ""}
        itemLabel="Note"
      />
    </div>
  );
}
