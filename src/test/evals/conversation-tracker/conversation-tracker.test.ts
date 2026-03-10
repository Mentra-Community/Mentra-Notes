/**
 * Eval: Conversation Tracker
 *
 * Evaluates the three LLM calls made by ConversationTracker:
 *   1. Chunk-in-context: CONTINUATION / NEW_CONVERSATION / FILLER
 *   2. Resumption check: YES / NO
 *   3. Summary compression: preserves key info under word limit
 *
 * Makes REAL LLM API calls — requires GOOGLE_GENERATIVE_AI_API_KEY (or equivalent) in .env.
 *
 * Run all:           bun test:eval:tracker
 * Run one:           bun test:eval:tracker:context / resumption / summary
 */

import { describe, test, afterAll } from "bun:test";
import { createProviderFromEnv, type AgentProvider } from "@/backend/services/llm";
import { AUTO_NOTES_CONFIG } from "@/backend/services/auto-notes/config";
import { getDomainPromptContext } from "@/backend/services/auto-notes/domain-config";

import contextCases from "./fixtures/chunk-in-context.json";
import resumptionCases from "./fixtures/resumption-check.json";
import summaryCases from "./fixtures/summary-compression.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TrackingDecision = "CONTINUATION" | "NEW_CONVERSATION" | "FILLER";

interface ContextCase {
  summary: string;
  chunk: string;
  expected: TrackingDecision;
  category: string;
  note?: string;
}

interface ResumptionCase {
  summary: string;
  chunk: string;
  expected: boolean;
  category: string;
  note?: string;
}

interface SummaryCase {
  transcript: string;
  mustInclude: string[];
  category: string;
  note?: string;
}

interface EvalResult {
  label: string;
  pass: boolean;
  ms: number;
  evalType: string;
  category: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// LLM provider
// ---------------------------------------------------------------------------

let provider: AgentProvider | null = null;
try {
  provider = createProviderFromEnv();
} catch {
  console.warn("[eval] No LLM provider — all tests will use defaults");
}

// ---------------------------------------------------------------------------
// Standalone LLM functions (mirror ConversationTracker logic, no DB)
// ---------------------------------------------------------------------------

async function classifyChunkInContext(
  summary: string,
  chunk: string,
): Promise<TrackingDecision> {
  if (!provider) return "CONTINUATION";

  const domainContext = getDomainPromptContext("general");

  const prompt = `You are a conversation tracker. You're monitoring an ongoing conversation and a new chunk of transcript has arrived.

Domain context: ${domainContext}

Current conversation summary:
"${summary}"

New chunk:
"${chunk}"

Classify this new chunk as one of:
- CONTINUATION: Same conversation topic, continue tracking
- NEW_CONVERSATION: Clearly a different topic/conversation has started
- FILLER: Background noise, small talk, or silence that interrupts the conversation

Respond with exactly one word: CONTINUATION, NEW_CONVERSATION, or FILLER`;

  const response = await provider.chat(
    [{ role: "user", content: prompt }],
    {
      tier: AUTO_NOTES_CONFIG.TRACKER_MODEL_TIER,
      maxTokens: AUTO_NOTES_CONFIG.TRACKER_MAX_TOKENS,
      temperature: 0.1,
    },
  );

  const text =
    response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("")
      .trim()
      .toUpperCase() || "CONTINUATION";

  if (text.includes("NEW_CONVERSATION")) return "NEW_CONVERSATION";
  if (text.includes("FILLER")) return "FILLER";
  return "CONTINUATION";
}

async function checkResumption(
  summary: string,
  chunk: string,
): Promise<boolean> {
  if (!provider) return false;

  const prompt = `A conversation was paused. A new chunk of speech has arrived. Is this a continuation of the previous conversation?

Previous conversation summary:
"${summary}"

New chunk:
"${chunk}"

Respond with exactly YES or NO.`;

  const response = await provider.chat(
    [{ role: "user", content: prompt }],
    {
      tier: AUTO_NOTES_CONFIG.TRACKER_MODEL_TIER,
      maxTokens: 16,
      temperature: 0.1,
    },
  );

  const text =
    response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("")
      .trim()
      .toUpperCase() || "NO";

  return text.includes("YES");
}

async function compressSummary(transcript: string): Promise<string> {
  if (!provider) return transcript;

  const prompt = `Compress the following conversation transcript into a summary of under ${AUTO_NOTES_CONFIG.SUMMARY_MAX_WORDS} words. Preserve: names, numbers, decisions, action items, and key facts discussed.

Transcript:
"${transcript}"

Write a concise summary:`;

  const response = await provider.chat(
    [{ role: "user", content: prompt }],
    {
      tier: AUTO_NOTES_CONFIG.SUMMARY_MODEL_TIER,
      maxTokens: AUTO_NOTES_CONFIG.SUMMARY_MAX_TOKENS,
      temperature: 0.3,
    },
  );

  return (
    response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("")
      .trim() || transcript
  );
}

// ---------------------------------------------------------------------------
// Dataset selection
// ---------------------------------------------------------------------------

const allResults: EvalResult[] = [];

const cliArg = process.argv.find((a) =>
  ["context", "resumption", "summary"].includes(a.toLowerCase()),
);
const evalType = (cliArg || process.env.EVAL_TYPE)?.toLowerCase();

// ---------------------------------------------------------------------------
// Test 1: Chunk-in-context classification
// ---------------------------------------------------------------------------

if (!evalType || evalType === "context") {
  const cases = contextCases.cases as ContextCase[];

  describe(`ChunkInContext (${cases.length} cases)`, () => {
    for (const c of cases) {
      test(
        `[${c.category}] "${c.chunk.slice(0, 50)}${c.chunk.length > 50 ? "..." : ""}" — expected: ${c.expected}`,
        async () => {
          const start = Date.now();
          const actual = await classifyChunkInContext(c.summary, c.chunk);
          const ms = Date.now() - start;
          const pass = actual === c.expected;

          allResults.push({
            label: c.chunk.slice(0, 60),
            pass,
            ms,
            evalType: "context",
            category: c.category,
            detail: pass ? undefined : `expected ${c.expected}, got ${actual}`,
          });

          if (!pass) {
            throw new Error(
              `MISMATCH: "${c.chunk.slice(0, 80)}" — expected ${c.expected}, got ${actual}\nSummary: "${c.summary.slice(0, 100)}..."`,
            );
          }
        },
        15000,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Test 2: Resumption check
// ---------------------------------------------------------------------------

if (!evalType || evalType === "resumption") {
  const cases = resumptionCases.cases as ResumptionCase[];

  describe(`ResumptionCheck (${cases.length} cases)`, () => {
    for (const c of cases) {
      test(
        `[${c.category}] "${c.chunk.slice(0, 50)}${c.chunk.length > 50 ? "..." : ""}" — expected: ${c.expected ? "YES" : "NO"}`,
        async () => {
          const start = Date.now();
          const actual = await checkResumption(c.summary, c.chunk);
          const ms = Date.now() - start;
          const pass = actual === c.expected;

          allResults.push({
            label: c.chunk.slice(0, 60),
            pass,
            ms,
            evalType: "resumption",
            category: c.category,
            detail: pass ? undefined : `expected ${c.expected ? "YES" : "NO"}, got ${actual ? "YES" : "NO"}`,
          });

          if (!pass) {
            throw new Error(
              `MISMATCH: "${c.chunk.slice(0, 80)}" — expected ${c.expected ? "YES" : "NO"}, got ${actual ? "YES" : "NO"}\nSummary: "${c.summary.slice(0, 100)}..."`,
            );
          }
        },
        15000,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Test 3: Summary compression
// ---------------------------------------------------------------------------

if (!evalType || evalType === "summary") {
  const cases = summaryCases.cases as SummaryCase[];

  describe(`SummaryCompression (${cases.length} cases)`, () => {
    for (const c of cases) {
      test(
        `[${c.category}] preserves key info — ${c.mustInclude.length} required terms`,
        async () => {
          const start = Date.now();
          const compressed = await compressSummary(c.transcript);
          const ms = Date.now() - start;

          const wordCount = compressed.split(/\s+/).filter(Boolean).length;
          const lowerCompressed = compressed.toLowerCase();

          const missing = c.mustInclude.filter(
            (term) => !lowerCompressed.includes(term.toLowerCase()),
          );

          const overLimit = wordCount > AUTO_NOTES_CONFIG.SUMMARY_MAX_WORDS;
          const pass = missing.length === 0 && !overLimit;

          const details: string[] = [];
          if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
          if (overLimit) details.push(`${wordCount} words (max ${AUTO_NOTES_CONFIG.SUMMARY_MAX_WORDS})`);

          allResults.push({
            label: `[${c.category}] ${c.mustInclude.length} terms`,
            pass,
            ms,
            evalType: "summary",
            category: c.category,
            detail: pass ? undefined : details.join("; "),
          });

          if (!pass) {
            throw new Error(
              `SUMMARY ISSUE: ${details.join("; ")}\n\nCompressed (${wordCount} words):\n${compressed}`,
            );
          }
        },
        30000,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

afterAll(() => {
  if (allResults.length === 0) return;

  const passed = allResults.filter((r) => r.pass).length;
  const failed = allResults.filter((r) => !r.pass);
  const times = allResults.map((r) => r.ms).sort((a, b) => a - b);
  const totalMs = times.reduce((sum, t) => sum + t, 0);
  const avgMs = Math.round(totalMs / times.length);
  const medianMs = times[Math.floor(times.length / 2)];

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  CONVERSATION TRACKER EVAL REPORT`);
  console.log(`${"=".repeat(70)}`);

  // Overall
  console.log(
    `\n  Score:    ${passed}/${allResults.length} passed (${Math.round((passed / allResults.length) * 100)}%)`,
  );
  console.log(`  Total:    ${(totalMs / 1000).toFixed(1)}s`);

  // Timing
  console.log(`\n  Timing:`);
  console.log(`    avg:     ${avgMs}ms`);
  console.log(`    median:  ${medianMs}ms`);

  // By eval type
  const types = [...new Set(allResults.map((r) => r.evalType))];
  console.log(`\n  By eval type:`);
  for (const t of types) {
    const tResults = allResults.filter((r) => r.evalType === t);
    const tPassed = tResults.filter((r) => r.pass).length;
    const tAvg = Math.round(
      tResults.reduce((s, r) => s + r.ms, 0) / tResults.length,
    );
    const marker = tPassed === tResults.length ? "✅" : "⚠️";
    console.log(
      `    ${marker} ${t.padEnd(16)} ${tPassed}/${tResults.length} (${String(Math.round((tPassed / tResults.length) * 100)).padStart(3)}%)  avg ${tAvg}ms`,
    );
  }

  // By category
  const categories = [...new Set(allResults.map((r) => r.category))];
  console.log(`\n  By category:`);
  for (const cat of categories) {
    const catResults = allResults.filter((r) => r.category === cat);
    const catPassed = catResults.filter((r) => r.pass).length;
    const marker = catPassed === catResults.length ? "✅" : "⚠️";
    console.log(
      `    ${marker} ${cat.padEnd(24)} ${catPassed}/${catResults.length}`,
    );
  }

  // Failed cases
  if (failed.length > 0) {
    console.log(`\n  Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(
        `    [${f.evalType}/${f.category}] "${f.label.slice(0, 50)}${f.label.length > 50 ? "..." : ""}"`,
      );
      if (f.detail) console.log(`      ${f.detail}`);
    }
  }

  console.log(`\n${"=".repeat(70)}\n`);
});
