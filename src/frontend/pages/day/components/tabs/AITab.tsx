/**
 * AITab - AI Chat interface for asking questions about the day's content
 *
 * Features:
 * - Chat with AI about transcripts and notes
 * - Suggested prompts for common queries
 * - Real-time typing indicator
 * - Markdown rendering for AI responses
 */

import { useState, useRef, useEffect } from "react";
import { useMentraAuth } from "@mentra/react";
import { clsx } from "clsx";
import { ArrowUp, Sparkles, User, Trash2, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useSynced } from "../../../../hooks/useSynced";
import type { SessionI, ChatMessage } from "../../../../../shared/types";

interface AITabProps {
  date: Date;
  isLoading?: boolean;
}

const SUGGESTIONS = [
  "Summarize my day",
  "List action items",
  "What did I discuss in the morning?",
  "Any deadlines mentioned?",
];

export function AITab({ date, isLoading = false }: AITabProps) {
  const { userId } = useMentraAuth();
  const { session, isConnected } = useSynced<SessionI>(userId || "");

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Get chat state from session
  const messages = session?.chat?.messages ?? [];
  const isTyping = session?.chat?.isTyping ?? false;
  const loadedDate = session?.chat?.loadedDate ?? "";

  // Load chat history when date changes
  useEffect(() => {
    if (!session?.chat?.loadDateChat || !isConnected) return;

    // Format date to YYYY-MM-DD
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    // Only load if different from currently loaded date
    if (dateStr !== loadedDate) {
      session.chat.loadDateChat(dateStr).catch((err: Error) => {
        console.error("[AITab] Failed to load chat for date:", err);
      });
    }
  }, [date, loadedDate, session?.chat?.loadDateChat, isConnected]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async (text: string = input) => {
    if (!text.trim() || !session?.chat?.sendMessage) return;

    setInput("");

    try {
      await session.chat.sendMessage(text.trim());
    } catch (error) {
      console.error("[AITab] Failed to send message:", error);
    }
  };

  const handleClear = async () => {
    if (!session?.chat?.clearHistory) return;

    try {
      await session.chat.clearHistory();
    } catch (error) {
      console.error("[AITab] Failed to clear history:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format timestamp
  const formatTime = (timestamp: Date | string) => {
    const d = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full bg-white dark:bg-black">
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
          {/* AI avatar + welcome skeleton */}
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-zinc-100 dark:bg-zinc-900 animate-pulse shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
              <div className="h-4 w-1/2 bg-zinc-100 dark:bg-zinc-800/60 rounded animate-pulse" />
            </div>
          </div>
          {/* Suggestion skeletons */}
          <div className="space-y-2 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-full bg-zinc-100 dark:bg-zinc-900 rounded-xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-black relative">
      {/* Chat Area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-6 space-y-6 pb-32"
      >
        {/* Welcome message if no messages */}
        {messages.length === 0 && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 border bg-white dark:bg-black border-zinc-200 dark:border-zinc-800">
              <Sparkles
                size={14}
                className="text-zinc-600 dark:text-zinc-400"
              />
            </div>
            <div className="flex flex-col max-w-[85%] items-start">
              <div className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                I can analyze your audio, notes, and transcriptions for this
                day. What would you like to know?
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg: ChatMessage) => {
          const isAssistant = msg.role === "assistant";
          return (
            <div
              key={msg.id}
              className={clsx(
                "flex gap-3",
                isAssistant ? "items-start" : "flex-row-reverse",
              )}
            >
              {/* Avatar */}
              <div
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border",
                  isAssistant
                    ? "bg-white dark:bg-black border-zinc-200 dark:border-zinc-800"
                    : "bg-zinc-900 dark:bg-zinc-100 border-transparent",
                )}
              >
                {isAssistant ? (
                  <Sparkles
                    size={14}
                    className="text-zinc-600 dark:text-zinc-400"
                  />
                ) : (
                  <User size={14} className="text-white dark:text-zinc-900" />
                )}
              </div>

              {/* Bubble */}
              <div
                className={clsx(
                  "flex flex-col max-w-[85%]",
                  isAssistant ? "items-start" : "items-end",
                )}
              >
                <div
                  className={clsx(
                    "px-4 py-3 text-sm leading-relaxed",
                    isAssistant
                      ? "text-zinc-700 dark:text-zinc-300"
                      : "bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-2xl rounded-tr-sm whitespace-pre-wrap",
                  )}
                >
                  {isAssistant ? (
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-lg font-bold mt-4 mb-2 first:mt-0">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-base font-bold mt-3 mb-2 first:mt-0">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-sm font-semibold mt-3 mb-1 first:mt-0">
                            {children}
                          </h3>
                        ),
                        p: ({ children }) => (
                          <p className="mb-2 last:mb-0">{children}</p>
                        ),
                        ul: ({ children }) => (
                          <ul className="list-disc list-outside ml-4 mb-2 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-outside ml-4 mb-2 space-y-1">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="pl-1">{children}</li>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                            {children}
                          </strong>
                        ),
                        em: ({ children }) => (
                          <em className="italic">{children}</em>
                        ),
                        code: ({ children }) => (
                          <code className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-xs font-mono">
                            {children}
                          </code>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-2 border-zinc-300 dark:border-zinc-600 pl-3 my-2 text-zinc-600 dark:text-zinc-400 italic">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    msg.content
                  )}
                </div>
                <span className="text-[10px] text-zinc-400 mt-1 px-1">
                  {formatTime(msg.timestamp)}
                </span>
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isTyping && (
          <div className="flex gap-3 items-start">
            <div className="w-8 h-8 rounded-full bg-white dark:bg-black border border-zinc-200 dark:border-zinc-800 flex items-center justify-center shrink-0">
              <Sparkles size={14} className="text-zinc-400" />
            </div>
            <div className="flex items-center gap-2 h-8 px-2">
              <Loader2 size={14} className="animate-spin text-zinc-400" />
              <span className="text-sm text-zinc-400">Thinking...</span>
            </div>
          </div>
        )}

        {/* Suggestions (only show if no messages) */}
        {messages.length === 0 && !isTyping && (
          <div className="space-y-2 mt-6">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSend(suggestion)}
                disabled={!isConnected}
                className="w-full text-left text-sm py-3 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white via-white to-transparent dark:from-black dark:via-black dark:to-transparent pt-8 pb-4 px-4">
        <div className="relative flex items-center gap-2">
          {/* Clear button */}
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="p-2.5 rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
              title="Clear chat"
            >
              <Trash2 size={18} />
            </button>
          )}

          <div className="relative flex-1 flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-full border border-zinc-200 dark:border-zinc-800">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                isConnected ? "Ask about this day..." : "Connecting..."
              }
              disabled={!isConnected || isTyping}
              className="w-full bg-transparent rounded-full pl-4 pr-12 py-3 text-sm focus:outline-none placeholder-zinc-400 dark:placeholder-zinc-500 text-zinc-900 dark:text-white disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || !isConnected || isTyping}
              className={clsx(
                "absolute right-1.5 p-2 rounded-full transition-all duration-200",
                input.trim() && isConnected && !isTyping
                  ? "bg-zinc-900 dark:bg-white text-white dark:text-black"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600",
              )}
            >
              {isTyping ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ArrowUp size={16} strokeWidth={2.5} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
