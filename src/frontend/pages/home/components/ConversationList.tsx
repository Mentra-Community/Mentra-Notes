/**
 * ConversationList - Displays conversations grouped by day
 *
 * Groups conversations into: Today, Yesterday, or formatted date headers.
 * Each group shows a count and renders ConversationRow items.
 */

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { format, isToday, isYesterday } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import type { Conversation } from "../../../../shared/types";
import { ConversationRow } from "./ConversationRow";


interface ConversationListProps {
  conversations: Conversation[];
  onSelectConversation: (conversation: Conversation) => void;
  onArchive?: (conversation: Conversation) => void;
  onDelete?: (conversation: Conversation) => void;
}

interface DayGroup {
  key: string;
  label: string;
  count: number;
  conversations: Conversation[];
}

const PAGE_SIZE = 20;

export function ConversationList({
  conversations,
  onSelectConversation,
  onArchive,
  onDelete,
}: ConversationListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Reset visible count when conversations change (e.g. filter switch)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [conversations.length]);

  // Track IDs seen on first render — only animate rows that arrive after mount
  const seenIds = useRef<Set<string> | null>(null);
  if (seenIds.current === null) {
    seenIds.current = new Set(conversations.map((c) => c.id));
  }

  // Auto-scroll to top when a new active conversation appears
  useEffect(() => {
    const activeNew = conversations.find(
      (c) => c.status === "active" && !seenIds.current!.has(c.id),
    );
    if (activeNew) {
      seenIds.current!.add(activeNew.id);
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }, 100);
    }
    for (const c of conversations) {
      seenIds.current!.add(c.id);
    }
  }, [conversations]);

  // Infinite scroll — load more when sentinel enters viewport
  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, conversations.length));
  }, [conversations.length]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: scrollRef.current, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Slice conversations to visible count, then group
  const visibleConversations = useMemo(
    () => conversations.slice(0, visibleCount),
    [conversations, visibleCount],
  );

  const groups = useMemo((): DayGroup[] => {
    const byDate = new Map<string, Conversation[]>();

    for (const conv of visibleConversations) {
      const dateKey = conv.date;
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey)!.push(conv);
    }

    for (const [, convs] of byDate) {
      convs.sort(
        (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
    }

    const sortedKeys = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

    return sortedKeys.map((dateKey) => {
      const convs = byDate.get(dateKey)!;
      const [year, month, day] = dateKey.split("-").map(Number);
      const dateObj = new Date(year, month - 1, day);

      let label: string;
      if (isToday(dateObj)) {
        label = "Today";
      } else if (isYesterday(dateObj)) {
        label = "Yesterday";
      } else {
        label = format(dateObj, "EEE MMM d");
      }

      return {
        key: dateKey,
        label,
        count: convs.length,
        conversations: convs,
      };
    });
  }, [visibleConversations]);

  const hasMore = visibleCount < conversations.length;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto px-6 pb-32">
      {groups.map((group) => (
        <div key={group.key}>
          {/* Day section header */}
          <div className="pt-5 pb-2">
            <span
              className={`text-[11px] tracking-widest leading-3.5 uppercase text-[#A8A29E] font-red-hat font-bold`}
            >
              {group.label} · {group.count} {group.count === 1 ? "conversation" : "conversations"}
            </span>
          </div>

          {/* Conversation rows */}
          <AnimatePresence initial={false}>
            {group.conversations.map((conv, i) => {
              const isNew = !seenIds.current!.has(conv.id);
              return (
                <motion.div
                  key={conv.id}
                  initial={isNew ? { opacity: 0, y: 16 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                >
                  <ConversationRow
                    conversation={conv}
                    onSelect={onSelectConversation}
                    onArchive={onArchive}
                    onDelete={onDelete}
                    isLast={i === group.conversations.length - 1}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      ))}

      {/* Scroll sentinel — triggers loading more */}
      {hasMore && (
        <div ref={sentinelRef} className="flex items-center justify-center py-4">
          <span className="text-[12px] text-[#A8A29E] font-red-hat">Loading more...</span>
        </div>
      )}
    </div>
  );
}
