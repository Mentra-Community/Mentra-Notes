/**
 * ConversationList - Displays conversations grouped by day
 *
 * Groups conversations into: Today, Yesterday, or formatted date headers.
 * Each group shows a count and renders ConversationRow items.
 */

import { useMemo } from "react";
import { format, isToday, isYesterday } from "date-fns";
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

export function ConversationList({
  conversations,
  onSelectConversation,
  onArchive,
  onDelete,
}: ConversationListProps) {
  const groups = useMemo((): DayGroup[] => {
    // Group by date string (YYYY-MM-DD)
    const byDate = new Map<string, Conversation[]>();

    for (const conv of conversations) {
      const dateKey = conv.date;
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey)!.push(conv);
    }

    // Sort each group by startTime (newest first within a day — or oldest first, matching design)
    // Design shows oldest first (2:10 PM, 3:05 PM, 4:30 PM, 5:15 PM)
    for (const [, convs] of byDate) {
      convs.sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
    }

    // Sort date keys newest first
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
  }, [conversations]);

  return (
    <div className="h-full overflow-y-auto px-6 pb-32">
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
          {group.conversations.map((conv, i) => (
            <ConversationRow
              key={conv.id}
              conversation={conv}
              onSelect={onSelectConversation}
              onArchive={onArchive}
              onDelete={onDelete}
              isLast={i === group.conversations.length - 1}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
