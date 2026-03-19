/**
 * Auto-Notes Configuration
 *
 * All tunable parameters for the automatic conversation notes pipeline.
 * Centralized here so they can be adjusted without touching business logic.
 */

export const AUTO_NOTES_CONFIG = {
  // =========================================================================
  // Phase 1: Buffer
  // =========================================================================

  /** How often to package transcript buffer into a chunk (ms) */
  BUFFER_INTERVAL_MS: 5_000,

  /** Max time to wait for sentence boundary after interval fires (ms) */
  SENTENCE_BOUNDARY_MAX_WAIT_MS: 3_000,

  /** Sentence-ending punctuation pattern */
  SENTENCE_END_REGEX: /[.!?]\s*$/,

  // =========================================================================
  // Phase 2: Triage
  // =========================================================================

  /** Chunks under this word count are auto-skipped (unless high-signal keywords) */
  PRE_FILTER_WORD_MIN: 4,

  /** Number of previous chunks to include as context when classifying */
  CONTEXT_LOOKBACK_CHUNKS: 2,

  // =========================================================================
  // Phase 3: Conversation Tracking
  // =========================================================================

  /** Meaningful chunks needed before creating a conversation */
  MIN_CHUNKS_TO_CONFIRM: 2,

  /** Filler chunks in PENDING state before discarding buffer */
  PENDING_SILENCE_THRESHOLD: 3,

  /** Number of preceding chunks to pull into a new conversation as context */
  CONTEXT_PREAMBLE_CHUNKS: 3,

  /** 1 silent/filler chunk → pause the conversation */
  SILENCE_PAUSE_CHUNKS: 1,

  /** 3 consecutive silent/filler chunks → end the conversation permanently */
  SILENCE_END_CHUNKS: 4,

  /** Max words for the running summary (compressed every 3 chunks) */
  SUMMARY_MAX_WORDS: 300,

  /** How many chunks before compressing the running summary */
  SUMMARY_COMPRESSION_INTERVAL: 3,

  /** Window to check for resuming a paused conversation (ms) — 30 minutes */
  RESUMPTION_WINDOW_MS: 30 * 60 * 1000,

  // =========================================================================
  // Phase 4: Note Generation
  // =========================================================================

  /** Model tier for triage classification (fast = cheap, quick) */
  TRIAGE_MODEL_TIER: "fast" as const,

  /** Model tier for conversation tracking classification */
  TRACKER_MODEL_TIER: "fast" as const,

  /** Model tier for note generation (smart = higher quality) */
  NOTE_GENERATION_MODEL_TIER: "smart" as const,

  /** Model tier for summary compression */
  SUMMARY_MODEL_TIER: "fast" as const,

  /** Max tokens for triage LLM response */
  TRIAGE_MAX_TOKENS: 64,

  /** Max tokens for tracker LLM response */
  TRACKER_MAX_TOKENS: 128,

  /** Max tokens for note generation LLM response */
  NOTE_GENERATION_MAX_TOKENS: 4096,

  /** Max tokens for summary compression LLM response */
  SUMMARY_MAX_TOKENS: 512,

  /** Retry delay for failed note generation (ms) */
  NOTE_GENERATION_RETRY_DELAY_MS: 5_000,

  // =========================================================================
  // Cleanup
  // =========================================================================

  /** How long to keep raw chunks before cleanup (hours) */
  CHUNK_RETENTION_HOURS: 24,
} as const;

export type AutoNotesConfig = typeof AUTO_NOTES_CONFIG;
