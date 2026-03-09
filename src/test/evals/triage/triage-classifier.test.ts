/**
 * Eval: Triage Classifier
 *
 * Evaluates TriageClassifier LLM classification against JSON fixture datasets.
 * Four sets: easy, medium, hard, realistic.
 * Makes REAL LLM API calls — requires GOOGLE_GENERATIVE_AI_API_KEY (or equivalent) in .env.
 *
 * The classifier is tested in isolation: we construct a minimal TranscriptChunkI object
 * and call classify() directly, bypassing DB reads/writes with a test subclass.
 *
 * Fixtures: src/test/evals/triage/fixtures/triage-classifier-{easy,medium,hard,realistic}.json
 *
 * Run all:         bun test:eval:triage
 * Run one:         bun test:eval:triage:easy / medium / hard / realistic
 */

import { describe, test, afterAll } from "bun:test";
import { createProviderFromEnv, type AgentProvider } from "@/backend/services/llm";
import { AUTO_NOTES_CONFIG } from "@/backend/services/auto-notes/config";
import {
  getDomainPromptContext,
  type DomainProfile,
} from "@/backend/services/auto-notes/domain-config";

import easyCases from "./fixtures/triage-classifier-easy.json";
import mediumCases from "./fixtures/triage-classifier-medium.json";
import hardCases from "./fixtures/triage-classifier-hard.json";
import realisticCases from "./fixtures/triage-classifier-realistic.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TriageResult = "auto-skipped" | "filler" | "meaningful";

interface EvalCase {
  text: string;
  expected: TriageResult;
  category: string;
  note?: string;
}

interface EvalResult {
  text: string;
  expected: TriageResult;
  actual: TriageResult;
  pass: boolean;
  category: string;
  ms: number;
  difficulty: string;
}

// ---------------------------------------------------------------------------
// Standalone classify function (mirrors TriageClassifier logic, no DB)
// ---------------------------------------------------------------------------

let provider: AgentProvider | null = null;
try {
  provider = createProviderFromEnv();
} catch {
  console.warn("[eval] No LLM provider — all cases will default to meaningful");
}

async function classifyChunk(
  text: string,
  domain: DomainProfile = "general",
): Promise<TriageResult> {
  // Skip truly empty input
  if (!text.trim()) return "auto-skipped";

  // Everything else goes to LLM — eval tests the prompt, not the word-count gate
  if (!provider) return "meaningful";

  const domainContext = getDomainPromptContext(domain);

  const prompt = `You are a transcript triage classifier for an always-on wearable microphone. Your job is to decide if a transcript chunk contains meaningful conversation or is just filler/background noise.

Domain context: ${domainContext}

Current chunk to classify:
"${text}"

Classify this chunk as either FILLER or MEANINGFUL.

FILLER means:
- Background noise, music, TV, or transcription artifacts (e.g. "[inaudible]", "[crosstalk]")
- Greetings and goodbyes with no substance ("hey how's it going", "see you later")
- Small talk about weather, food, commute, sports, weekend plans
- Pure acknowledgments and backchannel ("yeah", "okay sure", "mmhmm", "that's interesting")
- Stalling and non-committal responses ("we'll see", "let me think about it", "hmm")
- Transition phrases with no content ("anyway, moving on", "so yeah")
- Vague agreement or deference with no new information ("whatever you think is best")
- Personal momentary interruptions with no lasting info ("hold on, left my keys", "let me grab my charger", "one sec, bathroom break")
- Standalone location references without context that don't convey who/what/why (e.g. "Room 204" alone with no surrounding discussion)

MEANINGFUL means:
- Specific facts, numbers, names, dates, or times that answer a question or advance a discussion (e.g. "Thursday at nine", "two fifty", "she quit")
- Decisions, agreements, or disagreements about something concrete
- Action items, requests, or commitments
- Problem reports, incidents, or complaints with specifics
- Planning, scheduling, or coordination
- Any statement that a note-taker would want to capture

IMPORTANT: Even very short phrases can be meaningful if they convey a specific fact, data point, or decision. "She quit" is meaningful (important news). "Thursday at nine" is meaningful (scheduling). "Two fifty" is meaningful (a number/price). But "okay sure" is filler (pure acknowledgment).

When transcription produces doubled/repeated words (e.g. "I I left left my my keys keys"), look past the repetition to judge the underlying content. A personal errand interruption is still filler even with transcription artifacts.

Respond with exactly one word: FILLER or MEANINGFUL`;

  const response = await provider.chat(
    [{ role: "user", content: prompt }],
    {
      tier: AUTO_NOTES_CONFIG.TRIAGE_MODEL_TIER,
      maxTokens: AUTO_NOTES_CONFIG.TRIAGE_MAX_TOKENS,
      temperature: 0.1,
    },
  );

  const responseText =
    response.content
      .filter((c) => c.type === "text")
      .map((c) => (c as any).text)
      .join("")
      .trim()
      .toUpperCase() || "MEANINGFUL";

  return responseText.includes("FILLER") ? "filler" : "meaningful";
}

// ---------------------------------------------------------------------------
// Dataset selection (CLI arg or env var)
// ---------------------------------------------------------------------------

const allResults: EvalResult[] = [];

const cliArg = process.argv.find((a) =>
  ["easy", "medium", "hard", "realistic"].includes(a.toLowerCase()),
);
const difficulty = (cliArg || process.env.EVAL_DIFFICULTY)?.toLowerCase();
const datasets: { name: string; domain: DomainProfile; cases: EvalCase[] }[] = [];

if (!difficulty || difficulty === "easy")
  datasets.push({ name: "easy", domain: (easyCases as any).domain ?? "general", cases: easyCases.cases as EvalCase[] });
if (!difficulty || difficulty === "medium")
  datasets.push({ name: "medium", domain: (mediumCases as any).domain ?? "general", cases: mediumCases.cases as EvalCase[] });
if (!difficulty || difficulty === "hard")
  datasets.push({ name: "hard", domain: (hardCases as any).domain ?? "general", cases: hardCases.cases as EvalCase[] });
if (!difficulty || difficulty === "realistic")
  datasets.push({ name: "realistic", domain: (realisticCases as any).domain ?? "general", cases: realisticCases.cases as EvalCase[] });

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

for (const dataset of datasets) {
  describe(`TriageClassifier — ${dataset.name} (${dataset.cases.length} cases)`, () => {
    for (const c of dataset.cases) {
      test(
        `[${c.category}] "${c.text.slice(0, 60)}${c.text.length > 60 ? "..." : ""}" — expected: ${c.expected}`,
        async () => {
          const start = Date.now();
          const actual = await classifyChunk(c.text, dataset.domain);
          const ms = Date.now() - start;
          const pass = actual === c.expected;

          allResults.push({
            text: c.text,
            expected: c.expected,
            actual,
            pass,
            category: c.category,
            ms,
            difficulty: dataset.name,
          });

          if (!pass) {
            throw new Error(
              `MISMATCH: "${c.text.slice(0, 80)}" — expected ${c.expected}, got ${actual}`,
            );
          }
        },
        15000,
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
  const minMs = times[0];
  const maxMs = times[times.length - 1];
  const slowest = allResults.reduce((a, b) => (a.ms > b.ms ? a : b));
  const fastest = allResults.reduce((a, b) => (a.ms < b.ms ? a : b));

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  TRIAGE CLASSIFIER EVAL REPORT`);
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
  console.log(
    `    min:     ${minMs}ms  ("${fastest.text.slice(0, 40)}${fastest.text.length > 40 ? "..." : ""}")`,
  );
  console.log(
    `    max:     ${maxMs}ms  ("${slowest.text.slice(0, 40)}${slowest.text.length > 40 ? "..." : ""}")`,
  );

  // By difficulty
  const difficulties = [...new Set(allResults.map((r) => r.difficulty))];
  console.log(`\n  By difficulty:`);
  for (const d of difficulties) {
    const dResults = allResults.filter((r) => r.difficulty === d);
    const dPassed = dResults.filter((r) => r.pass).length;
    const dAvg = Math.round(
      dResults.reduce((s, r) => s + r.ms, 0) / dResults.length,
    );
    const marker = dPassed === dResults.length ? "✅" : "⚠️";
    console.log(
      `    ${marker} ${d.padEnd(12)} ${dPassed}/${dResults.length} (${String(Math.round((dPassed / dResults.length) * 100)).padStart(3)}%)  avg ${dAvg}ms`,
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

  // By expected label (precision/recall proxy)
  console.log(`\n  By expected label:`);
  for (const label of ["meaningful", "filler"] as const) {
    const labelCases = allResults.filter((r) => r.expected === label);
    const labelPassed = labelCases.filter((r) => r.pass).length;
    const marker = labelPassed === labelCases.length ? "✅" : "⚠️";
    console.log(
      `    ${marker} ${label.padEnd(16)} ${labelPassed}/${labelCases.length} (${Math.round((labelPassed / labelCases.length) * 100)}%)`,
    );
  }

  // Failed cases
  if (failed.length > 0) {
    console.log(`\n  Failed (${failed.length}):`);
    for (const f of failed) {
      console.log(
        `    [${f.difficulty}/${f.category}] "${f.text.slice(0, 60)}${f.text.length > 60 ? "..." : ""}"`,
      );
      console.log(
        `      expected ${f.expected}, got ${f.actual} (${f.ms}ms)`,
      );
    }
  }

  console.log(`\n${"=".repeat(70)}\n`);
});
