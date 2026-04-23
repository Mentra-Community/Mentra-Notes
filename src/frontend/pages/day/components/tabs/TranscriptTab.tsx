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
import { ArrowDown, ChevronDown, Loader2, MessagesSquare } from "lucide-react";
import { DotsSpinner } from "../../../../components/shared/DotsSpinner";
import { WaveIndicator } from "../../../../components/shared/WaveIndicator";
import type {
  TranscriptSegment,
  HourSummary,
} from "../../../../../shared/types";

// Memoized segment row to prevent re-renders when siblings update
const SegmentRow = memo(function SegmentRow({
  segment,
  segId,
  formatTime,
  getPhotoSrc,
  onImageLoad,
  isLive,
}: {
  segment: TranscriptSegment;
  segId?: string;
  formatTime: (timestamp: Date | string) => string;
  getPhotoSrc: (url: string) => string;
  onImageLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  isLive?: boolean;
}) {
  if (segment.type === "photo" && segment.photoUrl) {
    return (
      <div data-seg-id={segId} className="rounded-[10px] overflow-hidden bg-white">
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
    <div
      data-seg-id={segId}
      className={clsx(
        "flex flex-col rounded-[10px] py-2.5 px-3 gap-[3px] bg-white transition-colors duration-700",
        isLive && "border-[1.5px] border-[#F5C9BC]",
      )}
    >
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
  /** Hour (0-23) to auto-expand + scroll to on mount (e.g. from #hour-N deep-link) */
  targetHour?: number;
  /** Segment id (`${date}-${segIndex}`) to expand + scroll + yellow-flash (from #seg-<id>) */
  targetSegId?: string;
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

/**
 * Build the stable segId used by the deep-link (#seg-<id>) and by the backend
 * phrase-search collection. Derived from the segment's local id "seg_N" so
 * the frontend doesn't need a parallel id field.
 */
function toSegId(dateString: string, segmentId: string | undefined): string | undefined {
  if (!segmentId) return undefined;
  const m = segmentId.match(/^seg_(\d+)$/);
  if (!m) return undefined;
  return `${dateString}-${m[1]}`;
}

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
  targetHour,
  targetSegId,
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
              }, 400);
      }, 1000);
    }
  };

  // Scroll button + auto-scroll only when at the bottom.
  // Touch scroll up → unlock. Button or manual scroll back to bottom → re-lock.
  const isLive = currentHour !== undefined;
  const [showScrollButton, setShowScrollButton] = useState(false);
  const lockedRef = useRef(true);
  // Initial scroll to bottom on first load only
  const initialScrollDone = useRef(false);
  useEffect(() => {
    if (isLoading || initialScrollDone.current) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    initialScrollDone.current = true;
    lockedRef.current = true;
    container.scrollTo({ top: container.scrollHeight, behavior: "instant" });
  }, [isLoading]);

  // Reset initial scroll flag when date changes
  useEffect(() => {
    initialScrollDone.current = false;
  }, [dateString]);

  // Deep-link: when `targetHour` is provided (e.g. from /transcript/{date}#hour-N),
  // expand that hour and scroll its header to the top after segments have loaded.
  // Runs once per (date, targetHour) combo.
  const lastTargetHourRef = useRef<string | null>(null);
  useEffect(() => {
    if (targetHour === undefined || targetHour < 0) return;
    if (isLoading) return;
    const key = `${dateString}-${targetHour}`;
    if (lastTargetHourRef.current === key) return;

    const hourKey = createHourKey(targetHour);
    // Bail if that hour has no segments yet (wrong day, or still hydrating)
    const container = scrollContainerRef.current;
    if (!container) return;
    const section = container.querySelector(`[data-hour-section="${hourKey}"]`);
    if (!section) return;

    lastTargetHourRef.current = key;
    // Expand + pin: same flow as tapping the hour's expand button
    setExpandedHours((prev) => {
      if (prev.has(hourKey)) return prev;
      const next = new Set(prev);
      next.add(hourKey);
      return next;
    });
    // Give React a frame to mount the expanded content, then scroll
    requestAnimationFrame(() => {
      scrollHeaderToTop(hourKey, "smooth");
    });
  }, [targetHour, dateString, isLoading, scrollHeaderToTop]);

  // Deep-link: when `targetSegId` is provided (e.g. /transcript/{date}#seg-<id>),
  // find that segment, expand its hour, scroll it into view, and briefly
  // flash it yellow. Runs once per (date, segId) pair so repeat visits re-fire.
  //
  // Robust against R2 race: when the user deep-links into a historical day,
  // `isLoading` flips false but `segments` can still arrive over several
  // @synced updates. The effect keeps a cancelable poller that retries for
  // up to 6s waiting for both segments to populate AND the hour DOM to mount.
  const lastTargetSegRef = useRef<string | null>(null);
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  // Reset the deep-link lock whenever we start loading a new date, so a
  // successful "find" in the PREVIOUS date's still-resident segments can't
  // claim the lock before the new date's data arrives. Without this reset,
  // the effect correctly re-fires when segments hydrate but then skips
  // because the key matches a lock set against stale data.
  useEffect(() => {
    if (isLoading) {
      lastTargetSegRef.current = null;
    }
  }, [isLoading, dateString]);

  useEffect(() => {
    console.log(
      `[TranscriptTab] deep-link effect fired: targetSegId=${targetSegId} isLoading=${isLoading} dateString=${dateString} segments=${segments.length} lastKey=${lastTargetSegRef.current}`,
    );
    if (!targetSegId) return;
    if (isLoading) return;
    const key = `${dateString}|${targetSegId}`;
    if (lastTargetSegRef.current === key) {
      console.log(`[TranscriptTab] skipping — same key as last run`);
      return;
    }

    // Guard against the stale-segments race: only proceed if the segments
    // actually belong to the target date. R2 historical loads go through
    // three states — (A) initial render with prior date's segments still
    // resident, (B) segments.set([]) + isLoading=true, (C) new data arrives.
    // If we hit (A) and the target was in the previous date, we'd mark the
    // lock prematurely. Check the target segment's matching date prefix.
    const match = targetSegId.match(/^(\d{4}-\d{2}-\d{2})-(\d+)$/);
    if (!match) {
      console.warn(`[TranscriptTab] Bad targetSegId format: ${targetSegId}`);
      return;
    }
    if (match[1] !== dateString) {
      console.log(
        `[TranscriptTab] target seg date (${match[1]}) != dateString (${dateString}), waiting`,
      );
      return;
    }
    // Also require that at least one rendered segment has a timestamp whose
    // date (in the user's tz) matches — proves we're looking at the RIGHT
    // day's data, not the previous day's lingering segments.
    const hasCorrectDateSegments = segments.some((s) => {
      if (!s.timestamp) return false;
      const d = typeof s.timestamp === "string" ? new Date(s.timestamp) : s.timestamp;
      // Cheap check: format the timestamp into YYYY-MM-DD in the user's tz
      // and compare. Using Intl.DateTimeFormat keeps us consistent with
      // getHourInTimezone below.
      const parts = new Intl.DateTimeFormat("en-US", {
        year: "numeric", month: "2-digit", day: "2-digit",
        ...(timezone && { timeZone: timezone }),
      }).formatToParts(d);
      const y = parts.find((p) => p.type === "year")?.value;
      const m = parts.find((p) => p.type === "month")?.value;
      const dd = parts.find((p) => p.type === "day")?.value;
      return `${y}-${m}-${dd}` === dateString;
    });
    if (!hasCorrectDateSegments) {
      // Sample 3 segment timestamps so we can see what dates they DO match.
      const sample = segments.slice(0, 3).map((s) => {
        if (!s.timestamp) return `${s.id}:no-ts`;
        const d = typeof s.timestamp === "string" ? new Date(s.timestamp) : s.timestamp;
        return `${s.id}:${d.toISOString()}`;
      }).join(", ");
      console.log(
        `[TranscriptTab] no segments yet match dateString=${dateString} (sample: ${sample})`,
      );
      return;
    }
    console.log(
      `[TranscriptTab] proceeding past date gate — starting poll for segment`,
    );

    const [, , segIndexStr] = match;
    const targetIndex = parseInt(segIndexStr, 10);

    let cancelled = false;
    let success = false;

    const findSegment = (): TranscriptSegment | null => {
      const segs = segmentsRef.current;
      if (segs.length === 0) return null;
      // Only consider segments whose timestamp falls on dateString (user tz).
      // This blocks stale residual segments from a previous date from being
      // picked up during the brief render window where they're still in state.
      const dateSegs = segs.filter((s) => {
        if (!s.timestamp) return false;
        const d = typeof s.timestamp === "string" ? new Date(s.timestamp) : s.timestamp;
        const parts = new Intl.DateTimeFormat("en-US", {
          year: "numeric", month: "2-digit", day: "2-digit",
          ...(timezone && { timeZone: timezone }),
        }).formatToParts(d);
        const y = parts.find((p) => p.type === "year")?.value;
        const m = parts.find((p) => p.type === "month")?.value;
        const dd = parts.find((p) => p.type === "day")?.value;
        return `${y}-${m}-${dd}` === dateString;
      });
      if (dateSegs.length === 0) return null;

      // Primary: exact id match.
      let segment = dateSegs.find((s) => s.id === `seg_${segIndexStr}`);
      // Fallback 1: numeric tail match.
      if (!segment?.timestamp) {
        segment = dateSegs.find((s) => {
          const m = s.id?.match(/(\d+)$/);
          return m ? parseInt(m[1], 10) === targetIndex : false;
        });
      }
      // Fallback 2: nearest index within ±5.
      if (!segment?.timestamp) {
        let best: { seg: TranscriptSegment; delta: number } | null = null;
        for (const s of dateSegs) {
          const m = s.id?.match(/(\d+)$/);
          if (!m) continue;
          const delta = Math.abs(parseInt(m[1], 10) - targetIndex);
          if (!best || delta < best.delta) best = { seg: s, delta };
        }
        if (best && best.delta <= 5) {
          console.log(
            `[TranscriptTab] Exact seg_${targetIndex} not found, using nearest (delta=${best.delta}): ${best.seg.id}`,
          );
          segment = best.seg;
        }
      }
      return segment?.timestamp ? segment : null;
    };

    const tryOnce = () => {
      if (cancelled || success) return true;
      const segment = findSegment();
      if (!segment?.timestamp) {
        console.log(`[TranscriptTab] tryOnce: segment not found yet`);
        return false;
      }

      const hour = getHourInTimezone(segment.timestamp);
      const hourKey = createHourKey(hour);

      const container = scrollContainerRef.current;
      if (!container) {
        console.log(`[TranscriptTab] tryOnce: scroll container not mounted`);
        return false;
      }
      const hourSection = container.querySelector(`[data-hour-section="${hourKey}"]`);
      if (!hourSection) {
        console.log(`[TranscriptTab] tryOnce: hour section ${hourKey} not in DOM`);
        return false;
      }

      console.log(
        `[TranscriptTab] tryOnce SUCCESS: segment.id=${segment.id} hour=${hour} hourKey=${hourKey}`,
      );
      // Success path begins — claim the ref so later effect re-runs don't refire.
      lastTargetSegRef.current = key;
      success = true;

      // Expand the hour.
      setExpandedHours((prev) => {
        if (prev.has(hourKey)) return prev;
        const next = new Set(prev);
        next.add(hourKey);
        return next;
      });

      const actualSegId = (() => {
        const m = segment.id?.match(/^seg_(\d+)$/);
        return m ? `${dateString}-${m[1]}` : undefined;
      })();

      const attemptFlash = (attemptsLeft: number) => {
        if (cancelled) return;
        let el = container.querySelector<HTMLElement>(
          `[data-seg-id="${CSS.escape(targetSegId)}"]`,
        );
        if (!el && actualSegId && actualSegId !== targetSegId) {
          el = container.querySelector<HTMLElement>(
            `[data-seg-id="${CSS.escape(actualSegId)}"]`,
          );
        }
        if (!el) {
          if (attemptsLeft > 0) {
            setTimeout(() => attemptFlash(attemptsLeft - 1), 120);
          } else {
            console.warn(
              `[TranscriptTab] Deep-link: segment DOM node never appeared for ${targetSegId} (tried actualSegId=${actualSegId})`,
            );
          }
          return;
        }
        console.log(
          `[TranscriptTab] Flashing DOM node: data-seg-id=${el.getAttribute("data-seg-id")} rect.top=${el.getBoundingClientRect().top}`,
        );

        // Use scrollIntoView — the native API re-measures layout on each call
        // and handles mid-animation cases better than a manual scrollTo with a
        // precomputed offset. The hour-expand animation is typically still
        // running when we get here; scrollIntoView with block:"center" puts
        // the segment in the middle of the viewport, survives re-layout, and
        // is the most reliable cross-browser behavior.
        el.scrollIntoView({ behavior: "smooth", block: "center" });

        // Flash after a beat so the scroll animation doesn't fight the class
        // change. Color stays for 1.5s, then fades via the SegmentRow's
        // `transition-colors duration-700`.
        const flashEl = el;
        setTimeout(() => {
          if (cancelled) return;
          flashEl.classList.add("!bg-yellow-200");
          setTimeout(() => {
            flashEl.classList.remove("!bg-yellow-200");
          }, 1500);
        }, 400);

        // Re-scroll once the layout likely settled (hour expand animations
        // typically run ~300-500ms). Without this, the smooth scroll started
        // above can land at the wrong position because the segment's real
        // final y changes as sibling hours expand/collapse.
        setTimeout(() => {
          if (cancelled) return;
          // Confirm the element is still in the DOM before re-scrolling
          if (!document.body.contains(flashEl)) return;
          flashEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 700);
      };
      requestAnimationFrame(() => attemptFlash(30));
      return true;
    };

    // Try immediately; if not ready, poll for up to 6 seconds waiting for
    // segments to hydrate + hour DOM to render.
    if (tryOnce()) return;
    let attempts = 0;
    const maxAttempts = 60; // 60 × 100ms = 6s
    const poller = setInterval(() => {
      attempts++;
      if (tryOnce() || attempts >= maxAttempts) {
        clearInterval(poller);
        if (!success && attempts >= maxAttempts) {
          console.warn(
            `[TranscriptTab] Deep-link: gave up waiting for ${targetSegId} ` +
              `(segments=${segmentsRef.current.length})`,
          );
        }
      }
    }, 100);

    return () => {
      cancelled = true;
      clearInterval(poller);
    };
  }, [targetSegId, dateString, isLoading]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const isNearBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight < 200;
    };

    // Detect scroll position to lock/unlock — works for both touch and mouse
    const handleScroll = () => {
      if (isNearBottom()) {
        lockedRef.current = true;
        setShowScrollButton(false);
      } else {
        lockedRef.current = false;
        setShowScrollButton(true);
      }
    };

    // Auto-scroll on new child elements only when locked
    // Removed characterData to avoid interim text causing scroll jank
    const observer = new MutationObserver(() => {
      if (!lockedRef.current) return;
      requestAnimationFrame(() => {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      });
    });

    container.addEventListener("scroll", handleScroll, { passive: true });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      observer.disconnect();
    };
  }, [isLoading]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    lockedRef.current = true;
    setShowScrollButton(false);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);


  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 py-12 px-6">
          <Loader2 size={36} strokeWidth={2} className="text-[#B0AAA2] animate-spin" />
          <p className="text-[13px] leading-4 text-[#A8A29E] font-red-hat">
            Loading transcription…
          </p>
        </div>
      </div>
    );
  }

  if (segments.length === 0 && sortedHours.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 py-12 px-6">
          <div className="flex items-center justify-center size-32 rounded-full bg-[#F5F3F0]">
            <MessagesSquare size={56} strokeWidth={1.5} className="text-[#B0AAA2]" />
          </div>
          <p className="text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold">
            No transcript yet
          </p>
          <p className="text-[13px] leading-4 text-[#A8A29E] font-red-hat text-center">
            Start talking and your words will appear here
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
      <div className="pb-20 pt-1">
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
              {/* Left: hour label + vertical line.
                  Label and (when expanded) collapse affordance stay sticky to the
                  top of the scroll viewport so the reader always knows which hour
                  they're inside and can collapse from anywhere within it. */}
              <div className="flex flex-col items-center w-11 shrink-0">
                <div className="sticky top-0 z-10 bg-[#FAFAF9] pt-0.5 pb-1 flex flex-col items-center gap-1 shrink-0">
                  <span className={clsx(
                    "text-[12px] font-red-hat font-bold leading-4",
                    isCurrentHour ? "text-[#C9573A]" : "text-[#1C1917]",
                  )}>
                    {hourLabel}
                  </span>
                  {isExpanded && (
                    <button
                      onClick={() => toggleHour(hourKey)}
                      aria-label="Collapse hour"
                      className="flex items-center justify-center w-5 h-5 rounded-full bg-[#F5F3F0] text-[#A8A29E] active:bg-[#E7E5E0]"
                    >
                      <ChevronDown size={11} className="rotate-180" />
                    </button>
                  )}
                </div>
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
                        segId={toSegId(dateString, segment.id)}
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
                              segId={toSegId(dateString, segment.id)}
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
      {showScrollButton && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1 z-20 w-9 h-9 rounded-full bg-[#1C1917] text-white flex items-center justify-center shadow-lg"
        >
          <ArrowDown size={18} />
        </button>
      )}
    </div>
  );
}
