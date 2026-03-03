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

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { clsx } from "clsx";
import { ArrowDown, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type {
  TranscriptSegment,
  HourSummary,
} from "../../../../../shared/types";

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

// R2 private endpoint → public URL rewrite for legacy segments
const R2_PRIVATE_PREFIX = "https://3c764e987404b8a1199ce5fdc3544a94.r2.cloudflarestorage.com/mentra-notes/";
const R2_PUBLIC_PREFIX = "https://pub-b5f134142a0f4fbdb5c05a2f75fc8624.r2.dev/";

function getPhotoSrc(url: string): string {
  if (url.startsWith(R2_PRIVATE_PREFIX)) {
    return url.replace(R2_PRIVATE_PREFIX, R2_PUBLIC_PREFIX);
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
  onGenerateSummary,
  isCompactMode = false,
  isSyncingPhoto = false,
  isLoading = false,
}: TranscriptTabProps) {
  // Track expanded state for each hour (only used when not in compact mode)
  const [expandedHours, setExpandedHours] = useState<Set<string>>(new Set());
  const [generatingHour, setGeneratingHour] = useState<number | null>(null);
  const [loadingHour, setLoadingHour] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

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

    // If there's interim text and a current hour, ensure that hour exists in the groups
    // so the hour section renders immediately (before any final segment arrives)
    if (currentHour !== undefined && interimText.trim().length > 0) {
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
  }, [segments, currentHour, interimText]);

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

  /**
   * Check if this is the current hour and has interim text
   */
  const hasInterimForHour = (hourKey: string): boolean => {
    const { hour24 } = parseHourKey(hourKey);
    const isCurrentHour = currentHour !== undefined && hour24 === currentHour;
    return isCurrentHour && interimText.trim().length > 0;
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

  // When loadingHour clears (content rendered), scroll to the end of that hour
  const pendingScrollRef = useRef<string | null>(null);

  useEffect(() => {
    if (pendingScrollRef.current && !loadingHour) {
      const hourKey = pendingScrollRef.current;
      pendingScrollRef.current = null;
      activeScrollHourRef.current = hourKey;
      // Double rAF to ensure layout is complete after React render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToEndOfHour(hourKey);
        });
      });
      // Stop re-scrolling on image loads after a generous timeout
      setTimeout(() => {
        if (activeScrollHourRef.current === hourKey) {
          activeScrollHourRef.current = null;
        }
      }, 3000);
    }
  }, [loadingHour, scrollToEndOfHour]);

  // Toggle between collapsed/veryCollapsed and expanded
  const toggleHour = (hourKey: string) => {
    const wasExpanded = expandedHours.has(hourKey);

    if (wasExpanded) {
      // Collapsing — clear any active scroll tracking
      activeScrollHourRef.current = null;
      setExpandedHours((prev) => {
        const newSet = new Set(prev);
        newSet.delete(hourKey);
        return newSet;
      });
    } else {
      // Expanding — show spinner first, then render content + scroll
      setLoadingHour(hourKey);
      setExpandedHours((prev) => {
        const newSet = new Set(prev);
        newSet.add(hourKey);
        return newSet;
      });
      pendingScrollRef.current = hourKey;

      // Brief delay to let the spinner show, then clear loading to render segments
      requestAnimationFrame(() => {
        setLoadingHour(null);
      });
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

    // Auto-scroll on DOM mutations only when locked and not suppressed
    const observer = new MutationObserver(() => {
      if (!isScrollLockedRef.current || suppressAutoScrollRef.current) return;
      container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    });

    observer.observe(container, { childList: true, subtree: true, characterData: true });
    container.addEventListener("scroll", handleScroll);

    // Initial scroll to bottom
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Scroll to bottom and re-lock
  const scrollToBottomAndLock = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
    isScrollLockedRef.current = true;
    setIsScrollLocked(true);
  }, []);

  // Handle generating summary for an hour
  const handleGenerateSummary = async (e: React.MouseEvent, hour: number) => {
    e.stopPropagation(); // Don't toggle expand

    if (!onGenerateSummary || generatingHour !== null) return;

    setGeneratingHour(hour);
    try {
      await onGenerateSummary(hour);
    } catch (error) {
      console.error("Failed to generate summary:", error);
    } finally {
      setGeneratingHour(null);
    }
  };

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

  return (
    <div className="h-full relative">
    <div ref={scrollContainerRef} className="h-full overflow-y-auto">
      <div className="pb-2">
        {sortedHours.map((hourKey) => {
          const hourSegments = groupedSegments[hourKey];
          const { hour24, label: hourLabel } = parseHourKey(hourKey);
          const hourState = getHourState(hourKey);
          const isCollapsed = hourState === "collapsed";
          const isExpanded = hourState === "expanded";
          const isCurrentHour =
            currentHour !== undefined && hour24 === currentHour;

          const banner = getBannerContent(hourKey, hourSegments);
          const summary = getHourSummary(hour24);
          const hasSummary = summary && summary.segmentCount > 0;
          const isGenerating = generatingHour === hour24;

          return (
            <div
              key={hourKey}
              data-hour-section={hourKey}
              className="border-b border-zinc-100 dark:border-[#3f4147] last:border-0 "
            >
              {/* Hour Header - Sticky when expanded */}
              <button
                ref={(el) => {
                  if (el) headerRefs.current.set(hourKey, el);
                }}
                onClick={() => toggleHour(hourKey)}
                className={clsx(
                  "w-full flex items-start gap-3 px-4 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-900/30 text-left  px-6",
                  isExpanded && "bg-[#f1f1f1] dark:bg-[#2b2d31] sticky top-0 z-10",
                )}
              >
                {/* Hour Label */}
                <div className="flex items-center gap-2 shrink-0 w-20">
                  <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                    {hourLabel}
                  </span>
                  {isCurrentHour && (
                    <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                  )}
                </div>

                {/* Live transcription in veryCollapsed (compact) mode for current hour */}
                {hourState === "veryCollapsed" && hasInterimForHour(hourKey) && (
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <p className="text-sm text-zinc-400 dark:text-zinc-500 font-light italic whitespace-nowrap" style={{ direction: "rtl", textAlign: "left" }}>
                      {interimText}
                    </p>
                  </div>
                )}

                {/* Banner Content (when collapsed - normal state) */}
                {isCollapsed && (
                  <div className="flex-1 min-w-0">
                    {/* Title + Body (when summary exists) */}
                    {banner.hasSummary && banner.title ? (
                      <>
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                          {banner.title}
                        </p>
                        {banner.body && (
                          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-0.5">
                            {banner.body}
                          </p>
                        )}
                      </>
                    ) : (
                      /* Preview (when no summary) */
                      <p className="text-sm text-zinc-400 dark:text-zinc-500 italic line-clamp-1">
                        {banner.preview}
                      </p>
                    )}

                    {/* Interim text shown BELOW summary for current hour */}
                    {hasInterimForHour(hourKey) && (
                      <p className="text-sm text-zinc-400 dark:text-zinc-500 font-light italic mt-1 line-clamp-1">
                        {interimText}
                      </p>
                    )}

                    {/* <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs text-zinc-400 dark:text-zinc-500">
                        {hourSegments.length} segment
                        {hourSegments.length !== 1 ? "s" : ""}
                      </span>
                      {!banner.hasSummary && onGenerateSummary && (
                        <span
                          role="button"
                          onClick={(e) => handleGenerateSummary(e, hour24)}
                          className={clsx(
                            "text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer",
                            isGenerating
                              ? "text-zinc-400 dark:text-zinc-500"
                              : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200",
                          )}
                        >
                          {isGenerating ? (
                            <>
                              <Loader2 size={10} className="animate-spin" />
                              <span>Summarizing...</span>
                            </>
                          ) : (
                            <span>Generate summary</span>
                          )}
                        </span>
                      )}
                    </div> */}
                  </div>
                )}

                {/* Summary shown when expanded (not in compact mode) */}
                {isExpanded && hasSummary && !isCompactMode && (
                  <div className="flex-1 min-w-0">
                    {banner.title && (
                      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {banner.title}
                      </p>
                    )}
                    {banner.body && (
                      <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {banner.body}
                      </p>
                    )}
                  </div>
                )}

                {/* Expand indicator */}
                <div className="text-zinc-400 dark:text-zinc-500 shrink-0 ml-auto ">
                  {isExpanded ? (
                    <ChevronDown size={18} />
                  ) : (
                    <ChevronRight size={18} />
                  )}
                </div>
              </button>

              {/* Expanded Segments */}
              {isExpanded && (
                <div className="px-6 pb-4 bg-zinc-50/50 dark:bg-[#313338]/20">
                  {loadingHour === hourKey ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={18} className="animate-spin text-zinc-400" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {hourSegments.map((segment, idx) => {
                        const segId = segment.id || `idx-${idx}`;
                        return (
                          <div
                            key={segId}
                            className="flex gap-3"
                          >
                            {/* Timestamp */}
                            <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500 w-16 shrink-0 pt-0.5">
                              {segment.timestamp ? formatTime(segment.timestamp) : ""}
                            </span>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              {segment.type === "photo" && segment.photoUrl ? (
                                <div className="w-full max-w-xs">
                                  <img
                                    src={getPhotoSrc(segment.photoUrl)}
                                    alt="Photo capture"
                                    className="block rounded-lg w-full min-h-24 object-cover border border-zinc-200 dark:border-zinc-700"
                                    loading="lazy"
                                    onLoad={(e) => handleImageLoad(e, hourKey)}
                                  />
                                </div>
                              ) : (
                                <>
                                  <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                                    {segment.text}
                                  </p>
                                  {segment.speakerId && (
                                    <span className="text-xs text-zinc-400 dark:text-zinc-500 mt-1 block">
                                      Speaker {segment.speakerId}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Show interim text at the bottom for current hour */}
                      {isCurrentHour && (
                        <div
                          className={clsx(
                            "flex gap-3 transition-all duration-300 ease-out overflow-hidden",
                            interimText.trim()
                              ? "opacity-70 "
                              : "opacity-0 max-h-0",
                          )}
                        >
                          <span className="text-xs font-mono text-zinc-400 dark:text-zinc-500 w-16 shrink-0 pt-0.5">
                            now
                          </span>
                          <p className="flex-1 text-sm text-zinc-400 dark:text-zinc-500 font-light italic leading-relaxed">
                            {interimText || "\u00A0"}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Syncing photo indicator */}
        {isSyncingPhoto && (
          <div className="flex items-center gap-2 px-4 py-3 text-zinc-400 dark:text-zinc-500">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-sm">Syncing image...</span>
          </div>
        )}

      </div>

    </div>

      {/* Scroll-to-bottom FAB — only shown for live (today) when unlocked */}
      {isLive && !isScrollLocked && (
        <button
          onClick={scrollToBottomAndLock}
          className="absolute bottom-4 right-4 z-20 w-9 h-9 rounded-full bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-900 flex items-center justify-center shadow-lg"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
