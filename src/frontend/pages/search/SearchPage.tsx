/**
 * SearchPage — Search across notes (semantic) and transcript hour summaries (text).
 *
 * Matches the Paper design:
 * - "MENTRA NOTES" eyebrow + giant "Search" title
 * - Rounded stone-coloured search bar with inline X clear
 * - Sectioned results: Notes / Transcripts. No filter pills.
 *
 * Conversations are no longer searched — their UI surface is being replaced by
 * hour-summary titles stored per-hour on each transcript.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, isToday, isYesterday } from "date-fns";
import { LoadingState } from "../../components/shared/LoadingState";

const RECENT_SEARCHES_KEY = "mentra_recent_searches";
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecentSearch(q: string) {
  const trimmed = q.trim();
  if (!trimmed) return;
  const recent = getRecentSearches().filter((s) => s.toLowerCase() !== trimmed.toLowerCase());
  recent.unshift(trimmed);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function removeRecentSearch(q: string) {
  const recent = getRecentSearches().filter((s) => s !== q);
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent));
}

type NoteResult = {
  id: string;
  type: "note";
  title: string;
  summary: string;
  date: string;
  score: number;
  content?: string;
  isAIGenerated?: boolean;
};

type TranscriptResult = {
  id: string;
  type: "transcript";
  title: string;
  summary: string;
  date: string;
  hour: number;
  hourLabel: string;
  score: number;
};

type SearchResult = NoteResult | TranscriptResult;

function stripHtml(html: string, maxWords = 30): string {
  if (!html) return "";
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = text.split(" ").slice(0, maxWords);
  return words.length >= maxWords ? words.join(" ") + "..." : words.join(" ");
}

function formatNoteDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const [year, month, day] = dateStr.split("-").map(Number);
    const d = new Date(year, month - 1, day);
    if (isToday(d)) return "Today";
    if (isYesterday(d)) return "Yesterday";
    return format(d, "MMM d");
  } catch {
    return dateStr;
  }
}

function formatTranscriptDate(dateStr: string, hourLabel: string): string {
  const base = formatNoteDate(dateStr);
  return hourLabel ? `${base}, ${hourLabel}` : base;
}

export function SearchPage() {
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [loadingKey, setLoadingKey] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    searchAbortRef.current?.abort();
    const abortController = new AbortController();
    searchAbortRef.current = abortController;

    setIsSearching(true);
    setHasSearched(true);
    setLoadingKey((k) => k + 1);

    const minDelay = new Promise((r) => setTimeout(r, 600));

    try {
      const userParam = userId ? `&userId=${encodeURIComponent(userId)}` : "";
      const fetchPromise = fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&limit=10${userParam}`,
        { credentials: "include", signal: abortController.signal },
      ).then((r) => r.json());

      const [data] = await Promise.all([fetchPromise, minDelay]);
      if (!abortController.signal.aborted) {
        setResults(data.results || []);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      await minDelay;
      if (!abortController.signal.aborted) {
        setResults([]);
      }
    } finally {
      if (!abortController.signal.aborted) {
        saveRecentSearch(q.trim());
        setRecentSearches(getRecentSearches());
        setIsSearching(false);
      }
    }
  }, [userId]);

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => doSearch(value), 400);
    },
    [doSearch],
  );

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    inputRef.current?.focus();
  };

  const handleRecentTap = (q: string) => {
    setQuery(q);
    doSearch(q);
  };

  const handleRecentRemove = (q: string) => {
    removeRecentSearch(q);
    setRecentSearches(getRecentSearches());
  };

  const handleResultClick = (result: SearchResult) => {
    if (result.type === "note") {
      setLocation(`/note/${result.id}`);
    } else {
      // Deep-link to that day's transcript page, scrolled to the matching hour
      setLocation(`/transcript/${result.date}#hour-${result.hour}`);
    }
  };

  const noteResults = useMemo(
    () => results.filter((r): r is NoteResult => r.type === "note"),
    [results],
  );
  const transcriptResults = useMemo(
    () => results.filter((r): r is TranscriptResult => r.type === "transcript"),
    [results],
  );

  const totalCount = results.length;

  return (
    <div className="[font-synthesis:none] flex h-full flex-col bg-[#FCFBFA] overflow-hidden antialiased">
      {/* Header */}
      <div className="flex flex-col pt-1.5 pb-4 gap-0.5 px-6 shrink-0">
        <div className="tracking-[1.5px] uppercase text-[#D32F2F] font-red-hat font-bold text-[11px] leading-3.5">
          Mentra Notes
        </div>
        <div className="tracking-[-0.5px] text-[#1A1A1A] font-red-hat font-black text-[34px] leading-10.5">
          Search
        </div>
      </div>

      {/* Search bar */}
      <div className="pb-2 px-6 shrink-0">
        <div className="flex items-center justify-between rounded-[14px] py-3.25 px-4 bg-[#F5F3F0] border border-[#E8E5E1]">
          <div className="flex items-center gap-2.5 grow min-w-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C958D" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder="Search notes & transcripts..."
              className="text-[15px] leading-[18px] grow bg-transparent border-none focus:outline-none text-[#1A1A1A] font-red-hat font-medium placeholder-[#9C958D] min-w-0"
            />
          </div>
          {query && (
            <button onClick={handleClear} className="shrink-0 ml-2" aria-label="Clear search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C958D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Result count */}
      {hasSearched && !isSearching && (
        <div className="pb-1 px-6 shrink-0">
          <span className="text-[#D32F2F] font-red-hat font-medium text-[13px] leading-4">
            {totalCount} {totalCount === 1 ? "result" : "results"}
          </span>
        </div>
      )}

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Loading */}
        {isSearching && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[300px]">
            <LoadingState key={loadingKey} size={80} />
          </div>
        )}

        {/* Notes section */}
        {!isSearching && noteResults.length > 0 && (
          <div className="flex flex-col px-6">
            <div className="pt-3 pb-2">
              <div className="tracking-[1.2px] uppercase text-[#D32F2F] font-red-hat font-bold text-[11px] leading-3.5">
                Notes · {noteResults.length}
              </div>
            </div>
            {noteResults.map((result) => (
              <button
                key={`note-${result.id}`}
                onClick={() => handleResultClick(result)}
                className="flex items-center py-3 gap-2.5 border-t border-[#F0EDEA] text-left"
              >
                <div className="flex flex-col grow shrink basis-0 gap-1 min-w-0">
                  <div className="text-[#1A1A1A] font-red-hat font-bold text-[15px] leading-[18px] truncate">
                    {result.title || "Untitled"}
                  </div>
                  <div className="text-[#6B655D] font-red-hat text-[13px] leading-[17px] line-clamp-2">
                    {stripHtml(result.summary || result.content || "")}
                  </div>
                  <div className="text-[#B0AAA2] font-red-hat font-medium text-[11px] leading-3.5">
                    {formatNoteDate(result.date)}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* Transcripts section */}
        {!isSearching && transcriptResults.length > 0 && (
          <div className="flex flex-col px-6">
            <div className="pt-4 pb-2">
              <div className="tracking-[1.2px] uppercase text-[#D32F2F] font-red-hat font-bold text-[11px] leading-3.5">
                Transcripts · {transcriptResults.length}
              </div>
            </div>
            {transcriptResults.map((result) => (
              <button
                key={`transcript-${result.id}`}
                onClick={() => handleResultClick(result)}
                className="flex items-center py-3 gap-2.5 border-t border-[#F0EDEA] text-left"
              >
                <div className="flex flex-col grow shrink basis-0 gap-1 min-w-0">
                  <div className="text-[#1A1A1A] font-red-hat font-semibold text-[15px] leading-[18px] truncate">
                    {result.title || result.hourLabel}
                  </div>
                  <div className="text-[#6B655D] font-red-hat text-[13px] leading-4 line-clamp-2">
                    {result.summary}
                  </div>
                  <div className="text-[#B0AAA2] font-red-hat font-medium text-[11px] leading-3.5">
                    {formatTranscriptDate(result.date, result.hourLabel)}
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {/* Empty / No results — preserves the existing dot-art halftone SVG */}
        {!isSearching && hasSearched && results.length === 0 && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] gap-3">
            <svg width="140" height="130" viewBox="0 0 140 130" fill="none">
              <circle cx="30" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="38" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="46" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="54" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="62" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="70" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="78" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="86" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="94" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="102" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="110" cy="90" r="3" fill="#D94F3B66" />
              <circle cx="30" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="38" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="46" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="54" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="62" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="70" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="70" cy="66" r="2.5" fill="#D94F3B59" />
              <circle cx="70" cy="74" r="2" fill="#D94F3B59" />
              <circle cx="70" cy="82" r="2.5" fill="#D94F3B59" />
              <circle cx="78" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="86" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="94" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="102" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="58" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="66" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="74" r="3" fill="#D94F3B59" />
              <circle cx="30" cy="82" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="66" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="74" r="3" fill="#D94F3B59" />
              <circle cx="110" cy="82" r="3" fill="#D94F3B59" />
              <circle cx="25" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="33" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="41" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="49" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="57" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="65" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="20" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="28" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="36" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="44" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="52" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="60" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="15" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="23" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="31" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="39" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="47" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="55" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="75" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="83" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="91" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="99" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="107" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="115" cy="51" r="2.5" fill="#D94F3B38" />
              <circle cx="80" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="88" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="96" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="104" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="112" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="120" cy="44" r="2.5" fill="#D94F3B29" />
              <circle cx="85" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="93" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="101" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="109" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="117" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="125" cy="37" r="2" fill="#D94F3B1A" />
              <circle cx="46" cy="68" r="2" fill="#D94F3B0F" />
              <circle cx="62" cy="72" r="1.5" fill="#D94F3B0D" />
              <circle cx="78" cy="66" r="1.5" fill="#D94F3B0D" />
              <circle cx="55" cy="78" r="1.5" fill="#D94F3B0A" />
              <circle cx="85" cy="76" r="1.5" fill="#D94F3B0A" />
              <circle cx="70" cy="82" r="2" fill="#D94F3B0A" />
            </svg>
            <span className="text-[14px] text-[#B0AAA2] font-red-hat">Nothing found</span>
            <span className="text-[12px] text-[#C5C0B8] font-red-hat">Try a different search term</span>
          </div>
        )}

        {/* Initial state */}
        {!isSearching && !hasSearched && (
          recentSearches.length > 0 ? (
            <div className="flex flex-col pt-6 gap-4 px-6 w-full">
              <span className="text-[11px] tracking-widest uppercase leading-3.5 text-[#B0AAA2] font-red-hat font-bold">
                Recent searches
              </span>
              <div className="flex flex-col">
                {recentSearches.map((term, i) => (
                  <div
                    key={term}
                    className={`flex items-center py-3.5 gap-3 ${
                      i < recentSearches.length - 1 ? "border-b border-[#F0EDEA]" : ""
                    }`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0">
                      <circle cx="12" cy="12" r="9" stroke="#C5C0B8" strokeWidth="1.75" />
                      <polyline points="12,7 12,12 15,15" stroke="#C5C0B8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <button
                      onClick={() => handleRecentTap(term)}
                      className="text-[15px] leading-5 grow shrink basis-0 text-left text-[#1A1A1A] font-red-hat"
                    >
                      {term}
                    </button>
                    <button onClick={() => handleRecentRemove(term)} className="shrink-0 p-1" aria-label="Remove recent">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <line x1="18" y1="6" x2="6" y2="18" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" stroke="#C5C0B8" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] gap-3">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#C5C0B8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className="text-[14px] text-[#B0AAA2] font-red-hat">Search across all your notes and transcripts</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
