/**
 * ConversationsTab - Displays auto-detected conversations for a specific day
 *
 * Shows:
 * - List of conversation cards with status badges (Live/Paused/Ended)
 * - Expandable cards showing summary + transcript
 * - Empty state when no conversations detected
 */

import { useState, useRef, useMemo, memo } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion, useMotionValue, useTransform, animate, type PanInfo } from "motion/react";
import {
  MessagesSquare,
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { Conversation, ConversationChunk } from "../../../../../shared/types";

interface ConversationsTabProps {
  conversations: Conversation[];
  isLoading?: boolean;
  onDeleteConversation?: (conversationId: string) => void;
}

export function ConversationsTab({
  conversations,
  isLoading = false,
  onDeleteConversation,
}: ConversationsTabProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-4 pt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-4 bg-zinc-50 dark:bg-zinc-900 rounded-xl space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-1/2 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                <div className="h-5 w-16 bg-zinc-200 dark:bg-zinc-800 rounded-full animate-pulse" />
              </div>
              <div className="h-3 w-3/4 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
              <div className="h-3 w-1/3 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (conversations.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-4">
          <MessagesSquare
            size={24}
            className="text-zinc-400 dark:text-zinc-500"
          />
        </div>
        <h3 className="text-base font-medium text-zinc-900 dark:text-white mb-1">
          No conversations detected yet
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs">
          Conversations will appear here as they're automatically detected from
          your transcript.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 pt-4 space-y-3">
        {/* Conversation cards */}
        <AnimatePresence initial={false}>
          {conversations.map((conversation) => (
            <motion.div
              key={conversation.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ConversationCard
                conversation={conversation}
                isExpanded={expandedId === conversation.id}
                onToggle={() =>
                  setExpandedId(
                    expandedId === conversation.id ? null : conversation.id,
                  )
                }
                onDelete={onDeleteConversation}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

// =============================================================================
// ConversationCard
// =============================================================================

interface ConversationCardProps {
  conversation: Conversation;
  isExpanded: boolean;
  onToggle: () => void;
  onDelete?: (conversationId: string) => void;
}

const ConversationCard = memo(function ConversationCard({
  conversation,
  isExpanded,
  onToggle,
  onDelete,
}: ConversationCardProps) {
  const [activeSection, setActiveSection] = useState<"summary" | "transcript">(
    "summary",
  );
  const x = useMotionValue(0);
  const deleteOpacity = useTransform(x, [-120, -60], [1, 0]);
  const isDragging = useRef(false);

  const timeRange = formatTimeRange(
    conversation.startTime,
    conversation.endTime,
  );

  const previewText = conversation.runningSummary || "";
  const preview =
    previewText.length > 120
      ? previewText.substring(0, 120) + "..."
      : previewText;

  const snapBackTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -100 && onDelete) {
      // Slide card off-screen, then delete
      animate(x, -window.innerWidth, { duration: 0.25, ease: "easeIn" }).then(() => {
        onDelete(conversation.id);
      });
    } else {
      // Stay in place briefly, then slide back smoothly
      if (snapBackTimeout.current) clearTimeout(snapBackTimeout.current);
      snapBackTimeout.current = setTimeout(() => {
        x.set(0);
      }, 1500);
    }
  };

  return (
    <div className="relative rounded-xl overflow-hidden">
      {/* Delete background */}
      {onDelete && (
        <motion.div
          className="absolute inset-0 bg-linear-to-r from-transparent from-70% to-red-100 dark:to-red-950 rounded-xl flex items-center justify-end pr-5"
          style={{ opacity: deleteOpacity }}
        >
          <Trash2 size={18} className="text-red-400 dark:text-red-400" />
        </motion.div>
      )}

      <motion.div
        style={{ x }}
        drag={onDelete ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={{ left: 0.5, right: 0 }}
        onDragStart={() => { isDragging.current = true; }}
        onDragEnd={(_, info) => {
          isDragging.current = false;
          handleDragEnd(_, info);
        }}
        className="relative rounded-xl bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      {/* Card header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => { if (!isDragging.current) onToggle(); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}
        className="w-full text-left p-4 flex flex-col gap-2 cursor-pointer"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-white truncate flex items-center gap-1.5">
              {conversation.title
                ? conversation.title
                : conversation.status === "ended" && !conversation.generatingSummary && !conversation.aiSummary
                  ? "Untitled Conversation"
                  : <>
                      <Loader2 size={12} className="animate-spin text-zinc-400 shrink-0" />
                      <span className="text-zinc-400">
                        {conversation.generatingSummary ? "Generating title..." : "Capturing Conversation..."}
                      </span>
                    </>
              }
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {timeRange}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {conversation.status !== "ended" && <StatusBadge conversation={conversation} />}
            {isExpanded ? (
              <ChevronUp size={14} className="text-zinc-400" />
            ) : (
              <ChevronDown size={14} className="text-zinc-400" />
            )}
          </div>
        </div>

        {/* Preview — only when collapsed */}
        {!isExpanded && preview && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
            {preview}
          </p>
        )}
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-zinc-200 dark:border-zinc-800">
          {/* Section toggle */}
          <div className="flex border-b border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => setActiveSection("summary")}
              className={clsx(
                "flex-1 py-2.5 text-xs font-medium transition-colors",
                activeSection === "summary"
                  ? "text-zinc-900 dark:text-white bg-white dark:bg-zinc-800"
                  : "text-zinc-500 dark:text-zinc-400",
              )}
            >
              Summary
            </button>
            <button
              onClick={() => setActiveSection("transcript")}
              className={clsx(
                "flex-1 py-2.5 text-xs font-medium transition-colors",
                activeSection === "transcript"
                  ? "text-zinc-900 dark:text-white bg-white dark:bg-zinc-800"
                  : "text-zinc-500 dark:text-zinc-400",
              )}
            >
              Transcript
            </button>
          </div>

          <div className="p-4 max-h-[400px] overflow-y-auto">
            {activeSection === "summary" ? (
              <SummarySection conversation={conversation} />
            ) : (
              <TranscriptSection chunks={conversation.chunks} />
            )}
          </div>

        </div>
      )}
      </motion.div>
    </div>
  );
});

// =============================================================================
// StatusBadge
// =============================================================================

function StatusBadge({ conversation }: { conversation: Conversation }) {
  switch (conversation.status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
          Paused
        </span>
      );
    case "ended":
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
          Ended
        </span>
      );
  }
}

// =============================================================================
// SummarySection — lightweight HTML renderer
// =============================================================================

function parseMarkdownToHtml(text: string): string {
  return text
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .split("\n\n")
    .map((p) => p.trim())
    .filter((p) => p)
    .map((p) => {
      if (p.startsWith("<h") || p.startsWith("<ul") || p.startsWith("<ol")) return p;
      return `<p>${p.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}

function ReadOnlyHtml({ content }: { content: string }) {
  const html = useMemo(() => {
    if (content.includes("<p>") || content.includes("<h")) return content;
    return parseMarkdownToHtml(content);
  }, [content]);

  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      className="prose prose-sm dark:prose-invert max-w-none text-[15px]
        prose-headings:font-semibold prose-headings:text-zinc-900 dark:prose-headings:text-white
        prose-h1:text-base prose-h2:text-[15px] prose-h3:text-[15px]
        prose-p:text-[15px] prose-p:text-zinc-600 dark:prose-p:text-zinc-300 prose-p:leading-relaxed prose-p:my-1
        prose-strong:text-zinc-900 dark:prose-strong:text-white prose-strong:font-semibold
        prose-ul:text-[15px] prose-ul:text-zinc-600 dark:prose-ul:text-zinc-300 prose-ul:my-0.5
        prose-li:my-0 prose-li:marker:text-zinc-400 dark:prose-li:marker:text-zinc-500
        prose-blockquote:border-zinc-300 dark:prose-blockquote:border-zinc-600
        prose-blockquote:text-zinc-500 dark:prose-blockquote:text-zinc-400 prose-blockquote:text-[15px]"
    />
  );
}

function SummarySection({
  conversation,
}: {
  conversation: Conversation;
}) {
  // AI summary available — render with read-only Tiptap
  if (conversation.aiSummary) {
    return <ReadOnlyHtml content={conversation.aiSummary} />;
  }

  // Generating AI summary
  if (conversation.generatingSummary) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-3">
        <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <Sparkles size={16} className="animate-pulse text-zinc-400 dark:text-zinc-500" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Generating summary...
        </p>
      </div>
    );
  }

  // Live/paused — show waiting message (summary generates after conversation ends)
  return (
    <div className="flex flex-col items-center justify-center py-6 gap-3">
      <div className="w-9 h-9 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
        <Sparkles size={16} className="text-zinc-400 dark:text-zinc-500" />
      </div>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 text-center">
        Summary will be generated when the conversation ends.
      </p>
    </div>
  );
}

// =============================================================================
// TranscriptSection
// =============================================================================

const TranscriptSection = memo(function TranscriptSection({ chunks }: { chunks: ConversationChunk[] }) {
  if (chunks.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No transcript chunks yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {chunks.map((chunk) => (
        <ChunkRow key={chunk.id} chunk={chunk} />
      ))}
    </div>
  );
});

const ChunkRow = memo(function ChunkRow({ chunk }: { chunk: ConversationChunk }) {
  return (
    <div className="flex gap-3">
      <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono shrink-0 pt-0.5 whitespace-nowrap">
        {formatTime(chunk.startTime)}
      </span>
      <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
        {chunk.text}
      </p>
    </div>
  );
});

// =============================================================================
// Helpers
// =============================================================================

function formatTime(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimeRange(
  start: Date | string,
  end: Date | string | null,
): string {
  const startStr = formatTime(start);
  if (!end) return `${startStr} – now`;
  return `${startStr} – ${formatTime(end)}`;
}

