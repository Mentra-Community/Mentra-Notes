/**
 * SearchPage - Semantic search across notes and conversations
 *
 * Matches Paper design with:
 * - "Mentra Notes" brand + "Search" title
 * - Search bar with clear button
 * - Filter pills: All, Conversations, Notes, People
 * - Results grouped by type with section headers
 */

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format, isToday, isYesterday } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";
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

interface SearchResult {
  id: string;
  type: "note" | "conversation";
  title: string;
  summary: string;
  date: string;
  score: number;
  content?: string;
  isAIGenerated?: boolean;
}

type SearchFilter = "all" | "conversations" | "notes";

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

function formatResultDate(dateStr: string): string {
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

export function SearchPage() {
  const [, setLocation] = useLocation();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeFilter, setActiveFilter] = useState<SearchFilter>("all");
  const [loadingKey, setLoadingKey] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const transcriptionPaused = session?.settings?.transcriptionPaused ?? false;
  const isMicActive = !transcriptionPaused;

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    setLoadingKey((k) => k + 1);

    const minDelay = new Promise((r) => setTimeout(r, 1500));

    try {
      const userParam = userId ? `&userId=${encodeURIComponent(userId)}` : "";
      const fetchPromise = fetch(`/api/search?q=${encodeURIComponent(q.trim())}&limit=10${userParam}`, { credentials: "include" })
        .then((r) => r.json());

      const [data] = await Promise.all([fetchPromise, minDelay]);
      setResults(data.results || []);
    } catch {
      await minDelay;
      setResults([]);
    } finally {
      saveRecentSearch(q.trim());
      setRecentSearches(getRecentSearches());
      setIsSearching(false);
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
      setLocation(`/conversation/${result.id}`);
    }
  };


  // Filter results
  const filteredResults = useMemo(() => {
    if (activeFilter === "notes") return results.filter((r) => r.type === "note");
    if (activeFilter === "conversations") return results.filter((r) => r.type === "conversation");
    return results;
  }, [results, activeFilter]);

  const noteResults = useMemo(() => filteredResults.filter((r) => r.type === "note"), [filteredResults]);
  const conversationResults = useMemo(() => filteredResults.filter((r) => r.type === "conversation"), [filteredResults]);

  const filters: { key: SearchFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "conversations", label: "Conversations" },
    { key: "notes", label: "Notes" },
  ];

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] overflow-hidden">
      {/* Header */}
      <div className="flex flex-col pt-3 gap-3 px-6 shrink-0">
        <div className="flex items-center gap-2">
          <div className={`text-[11px] leading-3.5 tracking-widest uppercase text-[#DC2626] font-red-hat font-bold`}>
            Mentra Notes
          </div>
          <div className={`flex items-center gap-1 h-full px-1 rounded ${isMicActive ? 'bg-[#FEF2F2]' : 'bg-[#F5F5F4]'}`}>
            <div className={`shrink-0 rounded-full size-1.75 ${isMicActive ? 'bg-[#DC2626] animate-pulse' : 'bg-[#A8A29E]'}`} />
            {isMicActive ? (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>
        </div>
        <div className={`text-[28px] leading-[34px] text-[#1C1917] font-red-hat font-extrabold font-black`}>
          Search
        </div>
      </div>

      {/* Search bar */}
      <div className="flex items-center py-[13px] px-6 shrink-0">
        <div className="flex items-center grow rounded-xl py-2.5 px-3.5 gap-2.5 bg-[#F5F5F4]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#78716C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder="Search notes & conversations..."
            autoFocus
            className={`text-[15px] leading-5 grow bg-transparent border-none focus:outline-none text-[#1C1917] font-red-hat font-medium placeholder-[#A8A29E]`}
          />
          {query ? (
            <button onClick={handleClear} className="shrink-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </button>
          ) : null}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center pt-3 gap-2 px-6 shrink-0">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`flex items-center rounded-[20px] py-1.5 px-3.5 shrink-0 ${
              activeFilter === f.key ? "bg-[#1C1917]" : "bg-[#F5F5F4]"
            }`}
          >
            <span
              className={`text-[13px] leading-4 font-red-hat ${
                activeFilter === f.key ? "text-[#FAFAF9] font-semibold" : "text-[#78716C] font-medium"
              }`}
            >
              {f.label}
            </span>
          </button>
        ))}
      </div>

      {/* Results count */}
      {hasSearched && !isSearching && (
        <div className="flex items-center justify-between pt-4 px-6 shrink-0">
          <span className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat`}>
            {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"} for "{query}"
          </span>
        </div>
      )}

      {/* Scrollable results */}
      <div className="flex-1 overflow-y-auto flex flex-col jsutify-center ">
        {/* Loading */}
        {isSearching && (
          <div className="flex flex-col items-center justify-center flex-1 min-h-[300px]">
            <LoadingState key={loadingKey} size={80} />
          </div>
        )}

        {/* Notes section */}
        {!isSearching && noteResults.length > 0 && (
          <div className="flex flex-col pt-5 px-6">
            <div className={`text-[11px] leading-3.5 tracking-widest uppercase pb-3 text-[#DC2626] font-red-hat font-bold`}>
              Notes · {noteResults.length}
            </div>
            {noteResults.map((result, i) => (
              <button
                key={result.id}
                onClick={() => handleResultClick(result)}
                className={`flex flex-col py-3.5 gap-1 text-left ${
                  i < noteResults.length - 1 ? "border-b border-[#E7E5E4]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold truncate`}>
                    {result.title || "Untitled"}
                  </span>
                  {result.isAIGenerated ? (
                    <div className="flex items-center rounded-sm py-0.5 px-1.5 bg-[#FEE2E2] shrink-0">
                      <span className={`text-[10px] leading-3.5 text-[#DC2626] font-red-hat font-semibold`}>AI</span>
                    </div>
                  ) : (
                    <div className="flex items-center rounded-sm py-0.5 px-1.5 bg-[#E7E5E4] shrink-0">
                      <span className={`text-[10px] leading-3.5 text-[#78716C] font-red-hat font-semibold`}>Manual</span>
                    </div>
                  )}
                </div>
                <span className={`text-[13px] leading-[18px] text-[#78716C] font-red-hat line-clamp-2`}>
                  {stripHtml(result.summary || result.content || "")}
                </span>
                <span className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat`}>
                  {formatResultDate(result.date)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Conversations section */}
        {!isSearching && conversationResults.length > 0 && (
          <div className="flex flex-col pt-3 px-6">
            <div className={`text-[11px] leading-3.5 tracking-widest uppercase pb-3 text-[#DC2626] font-red-hat font-bold`}>
              Conversations · {conversationResults.length}
            </div>
            {conversationResults.map((result, i) => (
              <button
                key={result.id}
                onClick={() => handleResultClick(result)}
                className={`flex flex-col py-3.5 gap-1 text-left ${
                  i < conversationResults.length - 1 ? "border-b border-[#E7E5E4]" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`text-[15px] leading-5 text-[#1C1917] font-red-hat font-semibold truncate`}>
                    {result.title || "Untitled"}
                  </span>
                </div>
                <span className={`text-[13px] leading-[18px] text-[#78716C] font-red-hat line-clamp-2`}>
                  {stripHtml(result.summary || result.content || "")}
                </span>
                <span className={`text-[12px] leading-4 text-[#A8A29E] font-red-hat`}>
                  {formatResultDate(result.date)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Empty / No results */}
        {!isSearching && hasSearched && filteredResults.length === 0 && (
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
            <span className={`text-[14px] text-[#A8A29E] font-red-hat`}>No results found</span>
            <span className={`text-[12px] text-[#D6D3D1] font-red-hat`}>Try a different search term</span>
          </div>
        )}

        {/* Initial state — recent searches or empty prompt */}
        {!isSearching && !hasSearched && (
          recentSearches.length > 0 ? (
            <div className="flex flex-col pt-6 gap-4 px-6 w-full">
              <span className={`text-[11px] tracking-widest uppercase leading-3.5 text-[#A8A29E] font-red-hat font-bold`}>
                Recent searches
              </span>
              <div className="flex flex-col">
                {recentSearches.map((term, i) => (
                  <div
                    key={term}
                    className={`flex items-center py-3.5 gap-3 ${
                      i < recentSearches.length - 1 ? "border-b border-[#E7E5E4]" : ""
                    }`}
                  >
                    {/* Clock icon */}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0">
                      <circle cx="12" cy="12" r="9" stroke="#D6D3D1" strokeWidth="1.75" />
                      <polyline points="12,7 12,12 15,15" stroke="#D6D3D1" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {/* Tappable search term */}
                    <button
                      onClick={() => handleRecentTap(term)}
                      className={`text-[15px] leading-5 grow shrink basis-0 text-left text-[#1C1917] font-red-hat`}
                    >
                      {term}
                    </button>
                    {/* Remove button */}
                    <button onClick={() => handleRecentRemove(term)} className="shrink-0 p-1">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <line x1="18" y1="6" x2="6" y2="18" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" stroke="#D6D3D1" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[300px] gap-3">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D6D3D1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <span className={`text-[14px] text-[#A8A29E] font-red-hat`}>Search across all your notes and conversations</span>
            </div>
          )
        )}
      </div>

    </div>
  );
}
