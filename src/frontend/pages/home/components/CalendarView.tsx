/**
 * CalendarView - Month calendar with conversation/note activity dots
 *
 * Matches Paper design with:
 * - Stats bar (Conversations, Notes, Duration)
 * - Day grid with red (conversation) and gray (note) dot indicators
 * - Today highlighted with dark circle
 * - Legend at bottom
 * - Month navigation via swipe or buttons
 */

import { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  addMonths,
  subMonths,
} from "date-fns";
import type { DailyFolder } from "./FolderList";
import type { Conversation, Note } from "../../../../shared/types";

const WEEK_DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface CalendarViewProps {
  folders: DailyFolder[];
  conversations?: Conversation[];
  notes?: Note[];
  onSelectDate: (dateString: string) => void;
}

export function CalendarView({ conversations = [], notes = [], onSelectDate }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  // Build lookup maps
  const conversationsByDate = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    conversations.forEach((c) => {
      if (!map.has(c.date)) map.set(c.date, []);
      map.get(c.date)!.push(c);
    });
    return map;
  }, [conversations]);

  const notesByDate = useMemo(() => {
    const map = new Map<string, Note[]>();
    notes.forEach((n) => {
      if (!map.has(n.date)) map.set(n.date, []);
      map.get(n.date)!.push(n);
    });
    return map;
  }, [notes]);

  // Month stats
  const monthStr = format(currentMonth, "yyyy-MM");
  const monthConversations = conversations.filter((c) => c.date.startsWith(monthStr));
  const monthNotes = notes.filter((n) => n.date.startsWith(monthStr));
  const monthDurationMin = monthConversations.reduce((acc, c) => {
    if (!c.endTime) return acc;
    return acc + Math.round((new Date(c.endTime).getTime() - new Date(c.startTime).getTime()) / 60000);
  }, 0);

  const handlePrevMonth = () => setCurrentMonth((prev) => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth((prev) => addMonths(prev, 1));

  const handleDayClick = (day: Date) => {
    if (!isSameMonth(day, currentMonth)) return;
    onSelectDate(format(day, "yyyy-MM-dd"));
  };

  // Split calendar days into weeks
  const weeks: Date[][] = [];
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7));
  }

  return (
    <div className="h-full overflow-y-auto bg-[#FAFAF9]">
      {/* Month navigation */}
      <div className="flex items-center justify-between px-6 pt-4 pb-2">
        <button onClick={handlePrevMonth} className="p-2 -ml-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <polyline points="15,18 9,12 15,6" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className={`text-[16px] leading-5 text-[#1C1917] font-red-hat font-semibold`}>
          {format(currentMonth, "MMMM yyyy")}
        </span>
        <button onClick={handleNextMonth} className="p-2 -mr-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <polyline points="9,6 15,12 9,18" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex shrink-0 border-b border-[#FAFAFA] p-6">
        <div className="flex flex-col items-center grow shrink basis-0">
          <div className={`text-[32px] leading-[38px] text-[#18181B] font-red-hat font-light`}>
            {monthConversations.length}
          </div>
          <div className={`text-[10px] uppercase tracking-widest mt-1 text-[#A1A1AA] font-red-hat font-semibold leading-3`}>
            Conversations
          </div>
        </div>
        <div className="flex flex-col items-center grow shrink basis-0 border-l border-[#F4F4F5]">
          <div className={`text-[32px] leading-[38px] text-[#18181B] font-red-hat font-light`}>
            {monthNotes.length}
          </div>
          <div className={`text-[10px] uppercase tracking-widest mt-1 text-[#A1A1AA] font-red-hat font-semibold leading-3`}>
            Notes
          </div>
        </div>
        <div className="flex flex-col items-center grow shrink basis-0 border-l border-[#F4F4F5]">
          <div className={`text-[32px] leading-[38px] text-[#18181B] font-red-hat font-light`}>
            {monthDurationMin}m
          </div>
          <div className={`text-[10px] uppercase tracking-widest mt-1 text-[#A1A1AA] font-red-hat font-semibold leading-3`}>
            Duration
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex flex-col grow-0 shrink-0 basis-auto overflow-clip p-4">
        {/* Week day headers */}
        <div className="flex w-full mb-4">
          {WEEK_DAYS.map((day) => (
            <div key={day} className={`grow shrink basis-0 text-center text-[12px] uppercase tracking-widest text-[#D4D4D8] font-red-hat font-semibold leading-4`}>
              {day}
            </div>
          ))}
        </div>

        {/* Day rows */}
        {weeks.map((week, wi) => (
          <div key={wi} className="flex w-full mb-1 gap-1">
            {week.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const inMonth = isSameMonth(day, currentMonth);
              const today = isToday(day);
              const hasConversations = (conversationsByDate.get(dateStr)?.length ?? 0) > 0;
              const hasNotes = (notesByDate.get(dateStr)?.length ?? 0) > 0;
              const hasContent = hasConversations || hasNotes;

              if (!inMonth) {
                return <div key={dateStr} className="grow shrink basis-0 flex flex-col items-center min-h-16 py-2" />;
              }

              return (
                <button
                  key={dateStr}
                  onClick={() => handleDayClick(day)}
                  className="grow shrink basis-0 flex flex-col items-center min-h-16 rounded-xl py-2"
                >
                  {today ? (
                    <div className="flex items-center justify-center rounded-2xl bg-[#18181B] shrink-0 size-8">
                      <span className={`text-[14px] text-white font-red-hat font-semibold leading-[18px]`}>
                        {format(day, "d")}
                      </span>
                    </div>
                  ) : (
                    <span className={`text-[14px] leading-[18px] font-red-hat font-medium ${
                      hasContent ? "text-[#18181B]" : "text-[#E4E4E7]"
                    }`}>
                      {format(day, "d")}
                    </span>
                  )}

                  {/* Activity dots */}
                  {hasContent && (
                    <div className="flex mt-1 gap-[3px]">
                      {hasConversations && (
                        <div className="w-[5px] h-[5px] rounded-[3px] bg-[#EF4444] shrink-0" />
                      )}
                      {hasNotes && (
                        <div className="w-[5px] h-[5px] rounded-[3px] bg-[#D4D4D8] shrink-0" />
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="flex items-center justify-center mt-8 gap-6">
          <div className="flex items-center gap-2">
            <div className="rounded-sm bg-[#EF4444] shrink-0 size-2" />
            <span className={`text-[12px] text-[#71717A] font-red-hat font-medium leading-4`}>Conversation</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-sm bg-[#D4D4D8] shrink-0 size-2" />
            <span className={`text-[12px] text-[#71717A] font-red-hat font-medium leading-4`}>Note</span>
          </div>
        </div>
      </div>
    </div>
  );
}
