/**
 * TranscriptTab - Displays transcription segments grouped by hour
 *
 * Features:
 * - Collapsible hour sections with smart banners
 * - Sticky hour headers when expanded (stays at top while scrolling)
 * - Smart banner logic: Interim text > Hour Summary > First segment preview
 * - Real-time interim text display for current hour
 * - Auto-scroll for new segments (only when user is near bottom)
 */

import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, ChevronDown, Loader2 } from "lucide-react";
import { DotsSpinner } from "../../../../components/shared/DotsSpinner";
import { WaveIndicator } from "../../../../components/shared/WaveIndicator";
import type {
  TranscriptSegment,
  HourSummary,
} from "../../../../../shared/types";

// Memoized segment row to prevent re-renders when siblings update
const SegmentRow = memo(function SegmentRow({
  segment,
  formatTime,
  getPhotoSrc,
  onImageLoad,
  isLive,
}: {
  segment: TranscriptSegment;
  formatTime: (timestamp: Date | string) => string;
  getPhotoSrc: (url: string) => string;
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  isLive?: boolean;
}) {
  if (segment.type === "photo" && segment.photoUrl) {
    return (
      <div className="rounded-[10px] overflow-hidden bg-white">
        <img
          src={getPhotoSrc(segment.photoUrl)}
          alt="Photo capture"
          className="block w-full min-h-24 object-cover"
          loading="lazy"
          onLoad={onImageLoad}
        />
      </div>
    );
  }

  const speakerLabel = segment.speakerId ? `Speaker ${segment.speakerId}` : "Speaker";
  const timeLabel = segment.timestamp ? formatTime(segment.timestamp) : "";

  return (
    <div className={clsx(
      "flex flex-col rounded-[10px] py-2.5 px-3 gap-[3px] bg-white",
      isLive && "border-[1.5px] border-[#F5C9BC]",
    )}>
      <div className="flex items-center justify-between">
        <span className={clsx(
          "text-[11px] font-red-hat font-semibold leading-3.5",
          isLive ? "text-[#C9573A]" : "text-[#78716C]",
        )}>
          {speakerLabel}{timeLabel ? ` · ${timeLabel}` : ""}
        </span>
        {isLive && <WaveIndicator />}
      </div>
      <p className="text-[13px] leading-[1.5] font-red-hat text-[#1C1917]">
        {segment.text}
      </p>
      {/* {isLive && (
        <div className="flex items-center mt-0.5 gap-1">
          <div className="rounded-full bg-[#A8A29E] size-1" />
          <div className="rounded-full bg-[#A8A29E] size-1" />
          <div className="rounded-full bg-[#A8A29E] size-1" />
        </div>
      )} */}
    </div>
  );
});

interface TranscriptTabProps {
  segments: TranscriptSegment[];
  hourSummaries?: HourSummary[];
  interimText?: string;
  currentHour?: number; // Only provided for "today" - undefined for historical days
  dateString: string;
  timezone?: string; // IANA timezone for correct hour grouping (e.g., "America/Los_Angeles")
  onGenerateSummary?: (hour: number) => Promise<HourSummary>;
  isCompactMode?: boolean; // When true, all hours show in minimal/compact view
  isSyncingPhoto?: boolean; // When true, a photo is being uploaded/analyzed
  isLoading?: boolean; // When true, show skeleton loading state
}

interface GroupedSegments {
  [hourKey: string]: TranscriptSegment[];
}

import { R2_PRIVATE_URL_PREFIX, R2_PUBLIC_URL_PREFIX } from "../../../../../shared/constants";

function getPhotoSrc(url: string): string {
  if (url.startsWith(R2_PRIVATE_URL_PREFIX)) {
    return url.replace(R2_PRIVATE_URL_PREFIX, R2_PUBLIC_URL_PREFIX);
  }
  return url;
}

// Hour display states: veryCollapsed (minimal) → collapsed (banner) → expanded (segments)
type HourState = "veryCollapsed" | "collapsed" | "expanded";

export function TranscriptTab({
  segments,
  hourSummaries = [],
  interimText = "",
  currentHour,
  dateString,
  timezone,
  onGenerateSummary: _onGenerateSummary,
  isCompactMode = false,
  isSyncingPhoto = false,
  isLoading = false,
}: TranscriptTabProps) {
  // Track expanded state for each hour (only used when not in compact mode)
  const [expandedHours, setExpandedHours] = useState<Set<string>>(new Set());
  // Hours currently showing spinner (min 2s before content reveals)
  const [loadingHours, setLoadingHours] = useState<Set<string>>(new Set());
  // Measured spinner height per hour (header bottom → container bottom)
  const [spinnerHeights, setSpinnerHeights] = useState<Map<string, number>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Track the last interim text so we can keep it visible (with finalized styling)
  // until the matching final segment actually appears in the segments array.
  // This prevents the "jump" where interim disappears before the final segment arrives.
  const lastInterimRef = useRef<string>("");
  const lastSegmentCountRef = useRef<number>(segments.length);

  // When interimText is non-empty, track it
  if (interimText.trim()) {
    lastInterimRef.current = interimText;
  }

  // When a new segment arrives and interim is cleared, clear the stale interim
  if (segments.length > lastSegmentCountRef.current && !interimText.trim()) {
    lastInterimRef.current = "";
  }
  lastSegmentCountRef.current = segments.length;

  // The text to display as "live" — either actual interim, or the finalized-but-not-yet-in-segments text
  const displayInterimText = interimText.trim() || lastInterimRef.current;

  // Helper to get hour state based on compact mode and expanded state
  const getHourState = (hourKey: string): HourState => {
    if (expandedHours.has(hourKey)) return "expanded";
    if (isCompactMode) return "veryCollapsed";
    return "collapsed";
  };

  // Parse hour key and return components
  const parseHourKey = (hourKey: string): { hour24: number; label: string } => {
    const [hour24Str, label] = hourKey.split("|");
    return {
      hour24: parseInt(hour24Str.split(":")[0], 10),
      label: label || hourKey,
    };
  };

  // Create hour key from hour number
  const createHourKey = (hour: number): string => {
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour.toString().padStart(2, "0")}:00|${hour12} ${ampm}`;
  };

  // Extract hour (0-23) from a timestamp in the user's timezone
  const getHourInTimezone = (timestamp: Date | string): number => {
    const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    if (timezone) {
      const parts = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }).formatToParts(date);
      return parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    }
    return date.getHours();
  };

  // Parse timestamp and return hour key for grouping
  const getHourKey = (timestamp: Date | string): string => {
    return createHourKey(getHourInTimezone(timestamp));
  };

  // Format timestamp for display (12-hour with AM/PM)
  const formatTime = (timestamp: Date | string): string => {
    const date =
      typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      ...(timezone && { timeZone: timezone }),
    });
  };

  // Group segments by hour (memoized to avoid re-computing on every render)
  // Also ensures the current hour appears even if only interim text exists (no final segments yet)
  const { groupedSegments, sortedHours } = useMemo(() => {
    const grouped: GroupedSegments = segments.reduce((acc, segment) => {
      if (!segment.timestamp) return acc;
      const hourKey = getHourKey(segment.timestamp);
      if (!acc[hourKey]) {
        acc[hourKey] = [];
      }
      acc[hourKey].push(segment);
      return acc;
    }, {} as GroupedSegments);

    // If there's interim/finalizing text and a current hour, ensure that hour exists in the groups
    // so the hour section renders immediately (before any final segment arrives)
    if (currentHour !== undefined && displayInterimText.length > 0) {
      const currentHourKey = createHourKey(currentHour);
      if (!grouped[currentHourKey]) {
        grouped[currentHourKey] = [];
      }
    }

    const sorted = Object.keys(grouped).sort((a, b) => {
      const { hour24: hourA } = parseHourKey(a);
      const { hour24: hourB } = parseHourKey(b);
      return hourA - hourB;
    });

    return { groupedSegments: grouped, sortedHours: sorted };
  }, [segments, currentHour, displayInterimText]);

  // Get summary for a specific hour
  const getHourSummary = (hour: number): HourSummary | undefined => {
    return hourSummaries.find((s) => s.date === dateString && s.hour === hour);
  };

  /**
   * Parse summary into title and body (split by newline)
   */
  const parseSummary = (
    summary: string,
  ): { title: string; body: string } | null => {
    if (!summary) return null;

    const lines = summary.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return null;

    if (lines.length === 1) {
      // Single line - treat as title only
      return { title: lines[0].trim(), body: "" };
    }

    // First line is title, rest is body
    return {
      title: lines[0].trim(),
      body: lines.slice(1).join(" ").trim(),
    };
  };


  /**
   * Get banner content for an hour
   * Returns parsed title/body if summary available, otherwise first segment preview
   */
  const getBannerContent = (
    hourKey: string,
    hourSegments: TranscriptSegment[],
  ): {
    title: string | null;
    body: string | null;
    preview: string;
    hasSummary: boolean;
  } => {
    const { hour24 } = parseHourKey(hourKey);

    // Check for AI-generated hour summary
    const summaryObj = getHourSummary(hour24);
    const hasSummary = !!(
      summaryObj &&
      summaryObj.summary &&
      summaryObj.segmentCount > 0
    );

    // Parse summary into title/body
    const parsed = hasSummary ? parseSummary(summaryObj!.summary) : null;

    // Get first segment as preview/fallback
    const firstSegmentText = hourSegments[0]?.text || "";
    const preview =
      firstSegmentText.length > 80
        ? firstSegmentText.substring(0, 80) + "..."
        : firstSegmentText || "No content";

    return {
      title: parsed?.title || null,
      body: parsed?.body || null,
      preview,
      hasSummary,
    };
  };


  // Tracks which hour we last expanded — images loading in this section will re-trigger scroll
  const activeScrollHourRef = useRef<string | null>(null);

  // Scroll so the last segment of a given hour section is at the bottom of the viewport
  const scrollToEndOfHour = useCallback((hourKey: string) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const section = container.querySelector(`[data-hour-section="${hourKey}"]`) as HTMLElement;
    if (!section) return;

    const containerRect = container.getBoundingClientRect();
    const sectionRect = section.getBoundingClientRect();
    const sectionBottom = sectionRect.bottom - containerRect.top + container.scrollTop;
    const targetScroll = sectionBottom - containerRect.height;

    container.scrollTo({
      top: Math.max(0, targetScroll),
      behavior: "instant",
    });
  }, []);

  // Called when any image inside an expanded section finishes loading
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>, hourKey: string) => {
    (e.target as HTMLImageElement).classList.remove("min-h-24");
    // If this image belongs to the hour we just scrolled to, re-scroll to end of that hour
    if (activeScrollHourRef.current === hourKey) {
      scrollToEndOfHour(hourKey);
    }
    // Also scroll to absolute bottom so newly loaded photos are always visible
    const container = scrollContainerRef.current;
    if (container) {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Only if user was already near the bottom (within 300px)
      if (scrollHeight - scrollTop - clientHeight < 300) {
        container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
      }
    }
  }, [scrollToEndOfHour]);

  // Called when content mounts after spinner — immediately scroll to bottom of that hour
  const handleContentReady = useCallback((hourKey: string) => {
    // Stop the pin loop now that content is laid out
    pinningHourRef.current = null;
    suppressAutoScrollRef.current = false;

    activeScrollHourRef.current = hourKey;
    // Use rAF to ensure DOM has painted the content before measuring
    requestAnimationFrame(() => {
      scrollToEndOfHour(hourKey);
      // Stop re-scrolling on image loads after a generous timeout
      setTimeout(() => {
        if (activeScrollHourRef.current === hourKey) {
          activeScrollHourRef.current = null;
        }
      }, 3000);
    });
  }, [scrollToEndOfHour]);

  // Scroll a header to the top of the scroll container
  const scrollHeaderToTop = useCallback((hourKey: string, behavior: ScrollBehavior = "smooth") => {
    const container = scrollContainerRef.current;
    const header = headerRefs.current.get(hourKey);
    if (!container || !header) return;

    const containerRect = container.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const targetScroll = headerRect.top - containerRect.top + container.scrollTop;

    container.scrollTo({
      top: targetScroll,
      behavior,
    });
  }, []);

  // rAF loop that continuously pins a header to the top during content animation
  const pinningHourRef = useRef<string | null>(null);

  const startPinningHeader = useCallback((hourKey: string) => {
    pinningHourRef.current = hourKey;

    const pin = () => {
      if (pinningHourRef.current !== hourKey) return;
      scrollHeaderToTop(hourKey, "instant");
      requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
  }, [scrollHeaderToTop]);

  // Toggle between collapsed/veryCollapsed and expanded
  const toggleHour = (hourKey: string) => {
    const wasExpanded = expandedHours.has(hourKey);

    if (wasExpanded) {
      // Collapsing — clear all tracking: pin loop, auto-scroll suppression, active scroll
      pinningHourRef.current = null;
      activeScrollHourRef.current = null;
      suppressAutoScrollRef.current = false;
      setLoadingHours((prev) => {
        const newSet = new Set(prev);
        newSet.delete(hourKey);
        return newSet;
      });
      setExpandedHours((prev) => {
        const newSet = new Set(prev);
        newSet.delete(hourKey);
        return newSet;
      });
    } else {
      // Calculate spinner height as: container height - header height
      // This is the exact space below the header once it's pinned to the top
      const container = scrollContainerRef.current;
      const header = headerRefs.current.get(hourKey);
      if (container && header) {
        const containerHeight = container.clientHeight;
        const headerHeight = header.getBoundingClientRect().height;
        setSpinnerHeights((prev) => new Map(prev).set(hourKey, Math.max(containerHeight - headerHeight, 200)));
      }

      // Expanding — pin header to top, show spinner for min 2s
      setExpandedHours((prev) => {
        const newSet = new Set(prev);
        newSet.add(hourKey);
        return newSet;
      });
      setLoadingHours((prev) => {
        const newSet = new Set(prev);
        newSet.add(hourKey);
        return newSet;
      });

      // Suppress MutationObserver auto-scroll so it doesn't fight our scroll-to-header
      suppressAutoScrollRef.current = true;

      // Smooth-scroll header to top after React renders the expanded state
      requestAnimationFrame(() => {
        scrollHeaderToTop(hourKey);
      });

      // Clear loading after 2 seconds — content is already rendered (hidden), animation will then play
      setTimeout(() => {
        // Start rAF loop to keep header pinned during content animation
        startPinningHeader(hourKey);

        setLoadingHours((prev) => {
          const newSet = new Set(prev);
          newSet.delete(hourKey);
          return newSet;
        });
        // Re-enable auto-scroll after content animation starts
        setTimeout(() => {
          suppressAutoScrollRef.current = false;
        }, 400);
      }, 1000);
    }
  };

  // Lock/unlock scroll: when locked (near bottom), auto-scroll on DOM changes.
  // When unlocked (user scrolled up), stop auto-scrolling and show a FAB to re-lock.
  const isLive = currentHour !== undefined;
  const [isScrollLocked, setIsScrollLocked] = useState(true);
  const isScrollLockedRef = useRef(true);
  const suppressAutoScrollRef = useRef(false);

  // Suppress auto-scroll briefly when compact mode changes to prevent layout shift
  useEffect(() => {
    suppressAutoScrollRef.current = true;
    const timer = setTimeout(() => { suppressAutoScrollRef.current = false; }, 200);
    return () => clearTimeout(timer);
  }, [isCompactMode]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const LOCK_THRESHOLD = 100;

    // Update lock state based on scroll position
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distFromBottom = scrollHeight - scrollTop - clientHeight;
      const locked = distFromBottom <= LOCK_THRESHOLD;
      isScrollLockedRef.current = locked;
      setIsScrollLocked(locked);
    };

    // Auto-scroll on DOM mutations only when locked and not suppressed.
    // Debounced so rapid interim text updates don't spawn competing smooth scrolls.
    let scrollRaf: number | null = null;
    const observer = new MutationObserver(() => {
      if (!isScrollLockedRef.current || suppressAutoScrollRef.current) return;
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        scrollRaf = null;
      });
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });
    container.addEventListener("scroll", handleScroll);

    // Initial scroll to bottom (instant — covers both first mount and post-reconnect)
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });

    return () => {
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, [isLoading]);

  // Scroll to bottom and re-lock
  const scrollToBottomAndLock = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    isScrollLockedRef.current = true;
    setIsScrollLocked(true);
  }, []);


  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border-b border-zinc-100 dark:border-[#3f4147] last:border-0">
              <div className="flex items-start gap-3 px-4 py-4">
                <div className="flex items-center gap-2 shrink-0 w-20">
                  <div className="h-5 w-14 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
                  <div className="h-3 w-1/2 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
                </div>
                <div className="h-4 w-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse shrink-0 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (segments.length === 0 && sortedHours.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center py-12 text-zinc-400">
          <p className="text-sm">No transcript for this day</p>
          <p className="text-xs mt-1">
            Transcriptions will appear here when you record
          </p>
        </div>
      </div>
    );
  }

  // How many segments to show before a "+N more" collapse
  const PREVIEW_COUNT = 2;

  return (
    <div className="h-full relative">
    <div ref={scrollContainerRef} className="h-full overflow-y-auto">
      <div className="pb-6 pt-1">
        {sortedHours.map((hourKey) => {
          const hourSegments = groupedSegments[hourKey];
          const { hour24, label: hourLabel } = parseHourKey(hourKey);
          const hourState = getHourState(hourKey);
          const isExpanded = hourState === "expanded";
          const isCurrentHour = currentHour !== undefined && hour24 === currentHour;
          const banner = getBannerContent(hourKey, hourSegments);
          const hasSummary = !!(getHourSummary(hour24)?.segmentCount);
          const segCount = hourSegments.length;

          // For compact (veryCollapsed) mode, show a minimal one-line row
          if (hourState === "veryCollapsed") {
            return (
              <div key={hourKey} data-hour-section={hourKey} className="flex gap-3  mb-1">
                <div className="flex flex-col items-center w-11 shrink-0 pt-0.5">
                  <span className="text-[12px] font-red-hat font-bold text-[#1C1917] leading-4">
                    {hourLabel}
                  </span>
                </div>
                <button
                  ref={(el) => { if (el) headerRefs.current.set(hourKey, el); }}
                  onClick={() => toggleHour(hourKey)}
                  className="grow flex items-center justify-between rounded-[10px] py-2.5 px-3 bg-white mb-2 text-left"
                >
                  <span className="text-[13px] font-red-hat text-[#A8A29E]">
                    {isCurrentHour && displayInterimText
                      ? displayInterimText
                      : hasSummary
                        ? banner.title || banner.preview
                        : banner.preview
                    }
                  </span>
                  <span className="text-[13px] font-red-hat font-semibold text-[#C9573A] ml-3 shrink-0">
                    Expand <ChevronDown size={12} className="inline" />
                  </span>
                </button>
              </div>
            );
          }

          return (
            <div
              key={hourKey}
              data-hour-section={hourKey}
              className="flex gap-3 mb-1"
            >
              {/* Left: hour label + vertical line */}
              <div className="flex flex-col items-center w-11 shrink-0">
                <span className={clsx(
                  "text-[12px] font-red-hat font-bold leading-4 pt-0.5 shrink-0",
                  isCurrentHour ? "text-[#C9573A]" : "text-[#1C1917]",
                )}>
                  {hourLabel}
                </span>
                <div className="w-px grow mt-1.5 bg-[#E7E5E0]" />
              </div>

              {/* Right: content column */}
              <div className="grow flex flex-col pb-3 gap-1.5 min-w-0">

                {/* Conversation banner (summary title, or first-segment preview as fallback) */}
                {segCount > 0 && (
                  <div className="flex items-center gap-2 py-1">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
                      <path d="M2 3C2 2.45 2.45 2 3 2h8C11.55 2 12 2.45 12 3v6c0 .55-.45 1-1 1H8L6 12V10H3c-.55 0-1-.45-1-1V3z" fill={hasSummary ? "#C9573A" : "#C9C9C9"} />
                    </svg>
                    <span className={clsx(
                      "text-[13px] font-red-hat font-semibold leading-4 truncate",
                      hasSummary ? "text-[#C9573A]" : "text-[#A8A29E]",
                    )}>
                      {banner.title || banner.preview}
                    </span>
                    <button onClick={() => toggleHour(hourKey)} className="ml-auto shrink-0">
                      <ChevronDown
                        size={13}
                        className={clsx(
                          "transition-transform duration-200",
                          isExpanded ? "rotate-180 text-[#A8A29E]" : "text-[#C9C9C9]",
                        )}
                      />
                    </button>
                  </div>
                )}

                {/* Collapsed: show preview segments + expand row */}
                {!isExpanded && (
                  <>
                    {/* First PREVIEW_COUNT final segments */}
                    {hourSegments.filter(s => s.isFinal && s.type !== "photo").slice(0, PREVIEW_COUNT).map((segment, idx) => (
                      <SegmentRow
                        key={segment.id || `prev-${idx}`}
                        segment={segment}
                        formatTime={formatTime}
                        getPhotoSrc={getPhotoSrc}
                      />
                    ))}

                    {/* "+N more segments" divider if there are more */}
                    {segCount > PREVIEW_COUNT && (
                      <button
                        ref={(el) => { if (el) headerRefs.current.set(hourKey, el); }}
                        onClick={() => toggleHour(hourKey)}
                        className="flex items-center px-1 gap-1.5 py-0.5"
                      >
                        <div className="grow h-px bg-[#E7E5E0]" />
                        <span className="text-[11px] font-red-hat text-[#A8A29E] shrink-0">
                          +{segCount - PREVIEW_COUNT} more segment{segCount - PREVIEW_COUNT !== 1 ? "s" : ""}
                        </span>
                        <div className="grow h-px bg-[#E7E5E0]" />
                      </button>
                    )}

                    {/* If ≤ PREVIEW_COUNT segments, still need the header ref + expand affordance */}
                    {segCount <= PREVIEW_COUNT && segCount > 0 && (
                      <button
                        ref={(el) => { if (el) headerRefs.current.set(hourKey, el); }}
                        onClick={() => toggleHour(hourKey)}
                        className="flex items-center justify-between rounded-[10px] py-2.5 px-3 bg-white text-left"
                      >
                        <span className="text-[13px] font-red-hat text-[#A8A29E]">
                          {segCount} segment{segCount !== 1 ? "s" : ""} · {hasSummary ? "linked" : "no linked conversation"}
                        </span>
                        <span className="text-[13px] font-red-hat font-semibold text-[#C9573A] ml-3 shrink-0">
                          Expand <ChevronDown size={12} className="inline" />
                        </span>
                      </button>
                    )}

                    {/* Empty hour */}
                    {segCount === 0 && !isCurrentHour && (
                      <div className="rounded-[10px] py-2.5 px-3 bg-white">
                        <span className="text-[13px] font-red-hat text-[#A8A29E]">No segments</span>
                      </div>
                    )}

                    {/* Live interim for current hour (collapsed) */}
                    {isCurrentHour && displayInterimText && (
                      <SegmentRow
                        segment={{ id: "interim", text: displayInterimText, isFinal: false, timestamp: new Date().toISOString(), type: "text" } as any}
                        formatTime={formatTime}
                        getPhotoSrc={getPhotoSrc}
                        isLive
                      />
                    )}
                  </>
                )}

                {/* Expanded: spinner then all segments */}
                {isExpanded && (
                  <div
                    ref={(el) => { if (el) headerRefs.current.set(hourKey, el as any); }}
                    style={{ minHeight: loadingHours.has(hourKey) ? (spinnerHeights.get(hourKey) ?? 300) : undefined }}
                  >
                    <AnimatePresence>
                      {loadingHours.has(hourKey) && (
                        <motion.div
                          key={`loader-${hourKey}`}
                          initial={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="flex flex-col items-center justify-center gap-3"
                          style={{ height: spinnerHeights.get(hourKey) ?? 300 }}
                        >
                          <DotsSpinner size={24} className="text-[#E7E5E0]" />
                          <span className="text-[11px] font-red-hat text-[#A8A29E]">Loading transcription...</span>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {!loadingHours.has(hourKey) && (
                      <motion.div
                        key={`expand-${hourKey}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        ref={() => handleContentReady(hourKey)}
                        className="flex flex-col gap-1.5"
                      >
                        {hourSegments.map((segment, idx) => {
                          const isLastSegment = idx === hourSegments.length - 1;
                          const isLiveSegment = isCurrentHour && isLastSegment && !segment.isFinal;
                          return (
                            <SegmentRow
                              key={segment.id || `idx-${idx}`}
                              segment={segment}
                              formatTime={formatTime}
                              getPhotoSrc={getPhotoSrc}
                              onImageLoad={(e) => handleImageLoad(e, hourKey)}
                              isLive={isLiveSegment}
                            />
                          );
                        })}

                        {/* Interim text */}
                        {isCurrentHour && displayInterimText && (
                          <SegmentRow
                            segment={{ id: "interim", text: displayInterimText, isFinal: false, timestamp: new Date().toISOString(), type: "text" } as any}
                            formatTime={formatTime}
                            getPhotoSrc={getPhotoSrc}
                            isLive
                          />
                        )}

                        {/* Collapse button */}
                        <button
                          onClick={() => toggleHour(hourKey)}
                          className="flex items-center px-1 gap-1.5 py-0.5 mt-1"
                        >
                          <div className="grow h-px bg-[#E7E5E0]" />
                          <span className="text-[11px] font-red-hat text-[#A8A29E] shrink-0 flex items-center gap-1">
                            <ChevronDown size={11} className="rotate-180" /> collapse
                          </span>
                          <div className="grow h-px bg-[#E7E5E0]" />
                        </button>
                      </motion.div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Syncing photo indicator */}
        {isSyncingPhoto && (
          <div className="flex items-center gap-2 px-5 py-2 text-[#A8A29E]">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-[12px] font-red-hat">Syncing image...</span>
          </div>
        )}
      </div>
    </div>

      {/* Scroll-to-bottom FAB */}
      {isLive && !isScrollLocked && (
        <button
          onClick={scrollToBottomAndLock}
          className="absolute bottom-4 left-1 z-20 w-9 h-9 rounded-full bg-[#1C1917] text-white flex items-center justify-center shadow-lg"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
