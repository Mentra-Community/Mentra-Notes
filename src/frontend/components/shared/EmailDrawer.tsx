/**
 * EmailDrawer - Bottom drawer for sending emails
 *
 * - To: plain text input, persisted in localStorage
 * - CC: tag chips, only persisted when "Remember CC" is checked
 * - "Remember CC" boolean stored in localStorage
 * - CC emails always start empty unless "Remember CC" is on
 */

import { useState, useEffect, useRef, type KeyboardEvent } from "react";
import { clsx } from "clsx";
import { Mail, Loader2, Plus, X, Check } from "lucide-react";
import { Drawer } from "vaul";
import { motion, AnimatePresence } from "motion/react";

const STORAGE_KEY_TO = "mentra-email-drawer-to";
const STORAGE_KEY_CC = "mentra-email-drawer-cc";
const STORAGE_KEY_REMEMBER_CC = "mentra-email-drawer-remember-cc";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loadString(key: string, fallback = ""): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

function loadEmails(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed.filter((e: string) => EMAIL_REGEX.test(e));
    }
  } catch {}
  return [];
}

function loadBool(key: string, fallback = false): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch { return fallback; }
}

// ── CC Tag Input ────────────────────────────────────────────────────

interface EmailTagInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder: string;
}

function EmailTagInput({ emails, onChange, placeholder }: EmailTagInputProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addEmail = (raw: string) => {
    const email = raw.trim().replace(/,$/, "").trim();
    if (!email || !EMAIL_REGEX.test(email) || emails.includes(email)) {
      setInput("");
      return;
    }
    onChange([...emails, email]);
    setInput("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === " " || e.key === ",") {
      e.preventDefault();
      addEmail(input);
    }
    if (e.key === "Backspace" && !input && emails.length > 0) {
      onChange(emails.slice(0, -1));
    }
  };

  return (
    <div
      onClick={() => inputRef.current?.focus()}
      className="flex flex-wrap gap-1.5 px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl min-h-11 cursor-text focus-within:ring-2 focus-within:ring-zinc-900 dark:focus-within:ring-white"
    >
      <AnimatePresence mode="popLayout">
        {emails.map((email) => (
          <motion.span
            key={email}
            layout
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="inline-flex items-center gap-1 px-2.5 py-1 bg-zinc-900 dark:bg-zinc-200 text-white dark:text-zinc-900 rounded-full text-xs font-medium"
          >
            {email}
            <button
              onClick={(e) => { e.stopPropagation(); onChange(emails.filter((x) => x !== email)); }}
              className="text-zinc-400 dark:text-zinc-500 hover:text-white dark:hover:text-zinc-900 transition-colors ml-0.5"
            >
              <X size={11} strokeWidth={2.5} />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      <input
        ref={inputRef}
        type="email"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addEmail(input); }}
        placeholder={emails.length === 0 ? placeholder : ""}
        className="flex-1 min-w-30 bg-transparent text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none text-sm py-0.5"
      />
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────

interface EmailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSend: (to: string, cc: string) => Promise<void>;
  defaultEmail: string;
  itemLabel: string;
}

export function EmailDrawer({
  isOpen,
  onClose,
  onSend,
  defaultEmail,
  itemLabel,
}: EmailDrawerProps) {
  const [to, setTo] = useState("");
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [rememberCc, setRememberCc] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    // To — always restore
    setTo(loadString(STORAGE_KEY_TO, defaultEmail));
    // CC — only restore if "remember" is on
    const remember = loadBool(STORAGE_KEY_REMEMBER_CC);
    setRememberCc(remember);
    if (remember) {
      const stored = loadEmails(STORAGE_KEY_CC);
      setCcEmails(stored);
      setShowCc(stored.length > 0);
    } else {
      setCcEmails([]);
      setShowCc(false);
    }
    setError("");
    setIsSending(false);
  }, [isOpen, defaultEmail]);

  // Persist To
  const handleToChange = (value: string) => {
    setTo(value);
    try { localStorage.setItem(STORAGE_KEY_TO, value.trim()); } catch {}
  };

  // Persist CC (only if remember is on)
  const updateCcEmails = (emails: string[]) => {
    setCcEmails(emails);
    if (rememberCc) {
      try { localStorage.setItem(STORAGE_KEY_CC, JSON.stringify(emails)); } catch {}
    }
  };

  // Toggle remember
  const toggleRememberCc = () => {
    const next = !rememberCc;
    setRememberCc(next);
    try { localStorage.setItem(STORAGE_KEY_REMEMBER_CC, String(next)); } catch {}
    if (next) {
      // Save current CC emails
      try { localStorage.setItem(STORAGE_KEY_CC, JSON.stringify(ccEmails)); } catch {}
    } else {
      // Clear stored CC
      try { localStorage.removeItem(STORAGE_KEY_CC); } catch {}
    }
  };

  const handleSend = async () => {
    if (!to.trim()) {
      setError("Email address is required");
      return;
    }
    if (!EMAIL_REGEX.test(to.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setError("");
    setIsSending(true);
    try {
      await onSend(to.trim(), ccEmails.join(","));
      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to send email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Drawer.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Drawer.Content
          className={clsx(
            "bg-white dark:bg-zinc-900 flex flex-col rounded-t-2xl fixed bottom-0 left-0 right-0 z-50 max-w-lg mx-auto outline-none border-t border-zinc-100 dark:border-zinc-800 max-h-[3000svh] transition-[min-height] duration-200 ease-out",
            showCc ? "min-h-[350px]" : "min-h-[250px]",
          )}
        >
          {/* Handle */}
          <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-700 mt-4 mb-2 " />

          {/* Header */}
          <div className="px-6 pb-3 flex-shrink-0">
            <Drawer.Title className="text-lg font-semibold text-zinc-900 dark:text-white">
              Send {itemLabel}
            </Drawer.Title>
            <Drawer.Description className="sr-only">
              Enter email addresses to send {itemLabel}
            </Drawer.Description>
          </div>

          {/* Content — scroll internally if it overflows (e.g. when CC is
              expanded and the webview viewport is short). Otherwise the Send
              button can get pushed off-screen. */}
          <div className="px-6 pb-8 space-y-5 overflow-y-auto flex-1 min-h-0">
            {/* To */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.25, ease: "easeOut" }}
            >
              <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1.5">
                To
              </label>
              <input
                type="email"
                value={to}
                onChange={(e) => handleToChange(e.target.value)}
                placeholder="email@example.com"
                autoFocus
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm text-zinc-900 dark:text-white placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-white transition-shadow"
              />
            </motion.div>

            {/* CC */}
            <AnimatePresence mode="wait" initial={false}>
              {showCc ? (
                <motion.div
                  key="cc-fields"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="overflow-hidden"
                >
                  <div className="py-px">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                        CC
                      </label>
                      <button
                        onClick={() => {
                          setShowCc(false);
                          updateCcEmails([]);
                        }}
                        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <EmailTagInput
                      emails={ccEmails}
                      onChange={updateCcEmails}
                      placeholder="cc@example.com"
                    />
                    {/* Remember CC toggle */}
                    <button
                      onClick={toggleRememberCc}
                      className="flex items-center gap-2 mt-2.5 group"
                    >
                      <div
                        className={clsx(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          rememberCc
                            ? "bg-zinc-900 dark:bg-white border-zinc-900 dark:border-white"
                            : "border-zinc-300 dark:border-zinc-600 group-hover:border-zinc-400 dark:group-hover:border-zinc-500",
                        )}
                      >
                        {rememberCc && <Check size={10} className="text-white dark:text-zinc-900" strokeWidth={3} />}
                      </div>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Remember CC for next time
                      </span>
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="add-cc-btn"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
                  className="overflow-hidden"
                >
                  <button
                    onClick={() => setShowCc(true)}
                    className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
                  >
                    <Plus size={14} />
                    Add CC
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="text-sm text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-4 py-3 rounded-xl"
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Send */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.25, ease: "easeOut" }}
              onClick={handleSend}
              disabled={isSending || !to.trim()}
              className={clsx(
                "w-full py-3.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-colors",
                isSending || !to.trim()
                  ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed"
                  : "bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100",
              )}
            >
              {isSending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Mail size={16} />
                  Send
                </>
              )}
            </motion.button>
          </div>

          {/* Safe area */}
          <div className="h-safe-area-bottom" />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
