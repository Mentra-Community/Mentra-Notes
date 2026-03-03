/**
 * NotePage - Apple Notes style editor
 *
 * Minimal, clean, distraction-free note editing.
 * - Title as the first line, naturally flows into content
 * - Formatting toolbar in header
 * - Auto-saves as you type
 * - Full screen, content-first design
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { clsx } from "clsx";
import {
  ChevronLeft,
  MoreHorizontal,
  Loader2,
  Trash2,
  Bold,
  Italic,
  List,
  Heading2,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { Drawer } from "vaul";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI, Note } from "../../../shared/types";
import { NotePageSkeleton } from "../../components/shared/SkeletonLoader";

export function NotePage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");

  const [editTitle, setEditTitle] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const noteId = params.id || "";
  const allNotes = session?.notes?.notes ?? [];
  const note = allNotes.find((n) => n.id === noteId);

  // TipTap editor - always editable, minimal config
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: {
          class: "rounded-lg max-w-full h-auto my-3",
        },
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
      attributes: {
        class: "focus:outline-none min-h-[70vh]",
      },
    },
    onUpdate: ({ editor }) => {
      // Debounced auto-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = setTimeout(() => {
        handleAutoSave(editor.getHTML());
      }, 1500);
    },
  });

  // Check if content is placeholder text
  const isPlaceholderContent = (content: string | undefined): boolean => {
    if (!content) return true;
    const trimmed = content.trim().toLowerCase();
    return (
      trimmed === "" ||
      trimmed === "tap to edit this note..." ||
      trimmed === "<p></p>"
    );
  };

  // Parse markdown-style content to HTML
  const parseContent = useCallback((content: string): string => {
    if (!content) return "";
    if (content.includes("<p>") || content.includes("<h")) {
      return content;
    }

    let html = content
      .replace(/^### (.*$)/gim, "<h3>$1</h3>")
      .replace(/^## (.*$)/gim, "<h2>$1</h2>")
      .replace(/^# (.*$)/gim, "<h1>$1</h1>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .split("\n\n")
      .map((p) => p.trim())
      .filter((p) => p)
      .map((p) => {
        if (p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<ol")) {
          return p;
        }
        return `<p>${p}</p>`;
      })
      .join("");

    return html;
  }, []);

  // Rewrite private R2 URLs to public URLs in HTML content
  const rewritePhotoUrls = useCallback((html: string): string => {
    return html.replaceAll(
      "https://3c764e987404b8a1199ce5fdc3544a94.r2.cloudflarestorage.com/mentra-notes/",
      "https://pub-b5f134142a0f4fbdb5c05a2f75fc8624.r2.dev/",
    );
  }, []);

  // Build editor content from note
  const buildEditorContent = useCallback(
    (note: Note): string => {
      let html = "";

      // Content is already HTML from AI generation, use it directly
      if (note.content && !isPlaceholderContent(note.content)) {
        // If content already has HTML tags, use it directly
        if (note.content.includes("<p>") || note.content.includes("<h")) {
          html = note.content;
        } else {
          // Otherwise parse markdown-style content
          html = parseContent(note.content);
        }
      } else if (note.summary && !isPlaceholderContent(note.summary)) {
        // Fallback to summary if no content
        if (note.summary.includes("<p>") || note.summary.includes("<h")) {
          html = note.summary;
        } else {
          html = `<p>${note.summary}</p>`;
        }
      }

      return rewritePhotoUrls(html);
    },
    [parseContent, rewritePhotoUrls],
  );

  // Initialize editor content when note loads
  useEffect(() => {
    if (note && editor) {
      setEditTitle(note.title || "");
      const content = buildEditorContent(note);
      editor.commands.setContent(content);
    }
  }, [note?.id, editor, buildEditorContent]);

  // Auto-save function
  const handleAutoSave = async (content: string) => {
    if (!session?.notes?.updateNote || !note) return;

    setIsSaving(true);
    try {
      await session.notes.updateNote(noteId, {
        title: editTitle,
        content: content,
      });
      // Show "Saved" briefly
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
      if (session?.notes?.updateNote) {
        session.notes
          .updateNote(noteId, { title: editTitle })
          .then(() => {
            setShowSaved(true);
            if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
            savedTimeoutRef.current = setTimeout(
              () => setShowSaved(false),
              2000,
            );
          })
          .catch((err) => {
            console.error("[NotePage] Failed to save title:", err);
          });
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [editTitle, note?.title, noteId, session?.notes]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedTimeoutRef.current) clearTimeout(savedTimeoutRef.current);
    };
  }, []);

  // Loading state
  if (!session) {
    return <NotePageSkeleton />;
  }

  // Note not found
  if (!note) {
    return (
      <div className="flex h-full flex-col bg-white dark:bg-black">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
          <button
            onClick={() => setLocation("/")}
            className="p-2 -ml-2 min-w-11 min-h-11 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-600 dark:text-zinc-400 transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12 text-zinc-400">
            <p className="text-sm">Note not found</p>
            <button
              onClick={() => setLocation("/")}
              className="mt-4 text-sm text-zinc-600 dark:text-zinc-400 underline"
            >
              Go back home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleBack = () => {
    // Save any pending changes before leaving
    if (editor) {
      handleAutoSave(editor.getHTML());
    }

    // Use the note's date field (folder date) for navigation
    // This ensures we go back to the correct folder, not derived from createdAt
    if (note.date) {
      setLocation(`/day/${note.date}?tab=notes`);
    } else if (note.createdAt) {
      // Fallback for old notes without date field
      const date = new Date(note.createdAt);
      const dateString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      setLocation(`/day/${dateString}?tab=notes`);
    } else {
      setLocation("/");
    }
  };

  const handleDelete = async () => {
    if (!session?.notes?.deleteNote) return;

    try {
      await session.notes.deleteNote(noteId);
      handleBack();
    } catch (err) {
      console.error("[NotePage] Failed to delete note:", err);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white dark:bg-black">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-2 py-2 border-b border-zinc-100 dark:border-zinc-900">
        {/* Left side - fixed width to balance right side */}
        <div className="w-24 flex items-center">
          <button
            onClick={handleBack}
            className="p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-500 dark:text-zinc-400 transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
        </div>

        {/* Formatting toolbar - centered */}
        {editor && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={clsx(
                "p-2 rounded-lg transition-colors",
                editor.isActive("bold")
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <Bold size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={clsx(
                "p-2 rounded-lg transition-colors",
                editor.isActive("italic")
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <Italic size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={clsx(
                "p-2 rounded-lg transition-colors",
                editor.isActive("heading", { level: 2 })
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <Heading2 size={18} />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={clsx(
                "p-2 rounded-lg transition-colors",
                editor.isActive("bulletList")
                  ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-white"
                  : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900",
              )}
            >
              <List size={18} />
            </button>
          </div>
        )}

        {/* Right side - fixed width to keep toolbar centered */}
        <div className="w-24 flex items-center justify-end gap-1">
          {/* Save status */}
          <span className="text-xs text-zinc-400 flex items-center gap-1">
            {isSaving ? (
              <Loader2 size={12} className="animate-spin" />
            ) : showSaved ? (
              <>
                <Check size={12} />
                Saved
              </>
            ) : null}
          </span>

          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
            >
              <MoreHorizontal size={20} />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowMenu(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg py-1 min-w-40">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      setShowDeleteConfirm(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-sm text-red-600 dark:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-3"
                  >
                    <Trash2 size={16} />
                    Delete Note
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Editor Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-5 py-6">
          {/* Title - large, clean, no borders */}
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="w-full text-2xl font-semibold text-zinc-900 dark:text-white bg-transparent border-none focus:outline-none placeholder-zinc-300 dark:placeholder-zinc-600 mb-4"
          />

          {/* Content editor */}
          <EditorContent
            editor={editor}
            className="prose prose-zinc dark:prose-invert prose-base max-w-none
              prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-white
              prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
              prose-p:text-zinc-700 dark:prose-p:text-zinc-300 prose-p:leading-relaxed prose-p:my-3
              prose-strong:text-zinc-900 dark:prose-strong:text-white prose-strong:font-semibold
              prose-em:text-zinc-700 dark:prose-em:text-zinc-300
              prose-ul:text-zinc-700 dark:prose-ul:text-zinc-300 prose-ul:my-2
              prose-ol:text-zinc-700 dark:prose-ol:text-zinc-300 prose-ol:my-2
              prose-li:my-0.5
              prose-li:marker:text-zinc-400 dark:prose-li:marker:text-zinc-500
              prose-blockquote:border-zinc-300 dark:prose-blockquote:border-zinc-600
              prose-blockquote:text-zinc-600 dark:prose-blockquote:text-zinc-400
              prose-hr:border-zinc-200 dark:prose-hr:border-zinc-800
              [&_.is-editor-empty:first-child::before]:text-zinc-400
              [&_.is-editor-empty:first-child::before]:dark:text-zinc-500
              [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
              [&_.is-editor-empty:first-child::before]:float-left
              [&_.is-editor-empty:first-child::before]:h-0
              [&_.is-editor-empty:first-child::before]:pointer-events-none"
          />
        </div>
      </div>

      {/* Delete Confirmation Drawer */}
      <Drawer.Root open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
          <Drawer.Content className="bg-white dark:bg-zinc-900 flex flex-col rounded-t-2xl mt-24 fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-zinc-100 dark:border-zinc-800">
            {/* Handle */}
            <div className="mx-auto w-12 h-1.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700 mt-4 mb-2" />

            {/* Content */}
            <div className="px-6 pb-8">
              <div className="flex flex-col items-center text-center mb-6">
                <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
                  <AlertTriangle size={24} className="text-red-600 dark:text-red-400" />
                </div>
                <Drawer.Title className="text-lg font-semibold text-zinc-900 dark:text-white mb-2">
                  Delete Note?
                </Drawer.Title>
                <Drawer.Description className="text-sm text-zinc-500 dark:text-zinc-400">
                  This action cannot be undone. The note will be permanently deleted.
                </Drawer.Description>
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <Drawer.Close asChild>
                  <button className="flex-1 py-4 rounded-xl font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
                    Cancel
                  </button>
                </Drawer.Close>
                <button
                  onClick={handleDelete}
                  className="flex-1 py-4 rounded-xl font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={18} />
                  Delete
                </button>
              </div>
            </div>

            {/* Safe area padding for mobile */}
            <div className="h-safe-area-bottom" />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </div>
  );
}
