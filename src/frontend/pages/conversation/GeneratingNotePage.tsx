/**
 * GeneratingNotePage - Shows progress while generating an AI note from a conversation
 *
 * Displays:
 * - Back button + conversation date header
 * - Step-by-step progress card (Buffer, Triage, Track, Generate, Safety Pass)
 * - Live preview card with conversation title and summary preview
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation, useParams } from "wouter";
import { useMentraAuth } from "@mentra/react";
import { format } from "date-fns";
import { useSynced } from "../../hooks/useSynced";
import type { SessionI } from "../../../shared/types";

type StepStatus = "done" | "active" | "pending";

interface Step {
  label: string;
  subtitle: string;
  status: StepStatus;
}

export function GeneratingNotePage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useMentraAuth();
  const { session } = useSynced<SessionI>(userId || "");
  const [, setLocation] = useLocation();
  const [activeStep, setActiveStep] = useState(0);
  const generationStartedRef = useRef(false);
  const [progressPercent, setProgressPercent] = useState(0);

  const conversation = useMemo(() => {
    const conversations = session?.conversation?.conversations ?? [];
    return conversations.find((c) => c.id === id) ?? null;
  }, [session?.conversation?.conversations, id]);

  const chunks = conversation?.chunks ?? [];

  // Format the date for header
  const dateLabel = useMemo(() => {
    if (!conversation) return "";
    try {
      const [year, month, day] = conversation.date.split("-").map(Number);
      return format(new Date(year, month - 1, day), "MMMM d, yyyy");
    } catch {
      return conversation.date;
    }
  }, [conversation?.date]);


  // Track whether the API has finished so checkmarks can catch up
  const [generateDone, setGenerateDone] = useState(false);
  const generatedNoteId = useRef<string | null>(null);

  // Start generation immediately on mount (in parallel with checkmark animations)
  useEffect(() => {
    if (!session?.notes || !conversation || generationStartedRef.current) return;
    generationStartedRef.current = true;

    // Use chunks for time range, fall back to conversation start/end times
    const firstChunk = chunks[0];
    const lastChunk = chunks[chunks.length - 1];
    const startTime = firstChunk ? new Date(firstChunk.startTime) : conversation.startTime ? new Date(conversation.startTime) : undefined;
    const endTime = lastChunk ? new Date(lastChunk.endTime) : conversation.endTime ? new Date(conversation.endTime) : undefined;

    (async () => {
      try {
        const note = await session.notes.generateNote(
          conversation.title || undefined,
          startTime,
          endTime,
        );
        if (note?.id && session?.conversation) {
          await session.conversation.linkNoteToConversation(conversation.id, note.id);
        }
        generatedNoteId.current = note?.id || null;
        setGenerateDone(true);
      } catch (err) {
        console.error("[GeneratingNotePage] Note generation failed:", err);
        setLocation(`/conversation/${id}`);
      }
    })();
  }, [session, conversation, chunks, id, setLocation]);

  // Animate steps forward — random delay between 500ms and 2s per step
  // Steps 0-2 animate on their own schedule; step 3 waits for API to finish
  useEffect(() => {
    if (activeStep >= 5) return;
    // Step 3 (Generate) — only advance once API is done
    if (activeStep === 3) {
      if (!generateDone) return;
      const timer = setTimeout(() => setActiveStep(4), 400);
      return () => clearTimeout(timer);
    }
    // Step 4 (Safety Pass) — quick finish then navigate
    if (activeStep === 4) {
      const timer = setTimeout(() => {
        setProgressPercent(100);
        setActiveStep(5);
        if (generatedNoteId.current) {
          setTimeout(() => setLocation(`/note/${generatedNoteId.current}`), 600);
        }
      }, 600);
      return () => clearTimeout(timer);
    }
    // Steps 0-2 — cosmetic animation
    const delay = Math.random() * 1500 + 500; // 500ms – 2000ms
    const timer = setTimeout(() => setActiveStep((s) => s + 1), delay);
    return () => clearTimeout(timer);
  }, [activeStep, generateDone, setLocation]);

  // Animate progress bar — starts immediately
  useEffect(() => {
    const interval = setInterval(() => {
      setProgressPercent((p) => {
        const cap = generateDone ? 100 : 90;
        if (p >= cap) {
          clearInterval(interval);
          return cap;
        }
        return p + Math.random() * 8 + 2;
      });
    }, 300);
    return () => clearInterval(interval);
  }, [generateDone]);

  if (!session || !conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-[#FAFAF9]">
        <div className="text-[16px] text-[#A8A29E] font-red-hat">
          {!session ? "Loading..." : "Conversation not found"}
        </div>
      </div>
    );
  }

  const steps: Step[] = [
    { label: "Buffer", subtitle: `${chunks.length} chunks collected`, status: activeStep > 0 ? "done" : activeStep === 0 ? "active" : "pending" },
    { label: "Triage", subtitle: "Speech detected", status: activeStep > 1 ? "done" : activeStep === 1 ? "active" : "pending" },
    { label: "Track", subtitle: "Conversation ended", status: activeStep > 2 ? "done" : activeStep === 2 ? "active" : "pending" },
    { label: "Generate", subtitle: activeStep >= 3 ? "Creating structured note..." : "Pending", status: activeStep > 3 ? "done" : activeStep === 3 ? "active" : "pending" },
    { label: "Safety Pass", subtitle: activeStep > 4 ? "Complete" : "Pending", status: activeStep > 4 ? "done" : activeStep === 4 ? "active" : "pending" },
  ];

  return (
    <div className="flex h-full flex-col bg-[#FAFAF9] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center pt-6 pb-4 gap-3 px-6 shrink-0">
        <button onClick={() => setLocation(`/conversation/${id}`)} className="-ml-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="m15 18-6-6 6-6" stroke="#1C1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="text-[#1C1917] font-red-hat font-bold text-lg leading-[22px]">
          {dateLabel}
        </div>
      </div>

      {/* Progress card */}
      <div className="flex flex-col mx-6 rounded-2xl bg-[#FAFAFA] p-5">
        {/* Card header */}
        <div className="flex items-center pb-4 gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
          </svg>
          <div className="text-[#1C1917] font-red-hat font-bold text-sm leading-[18px]">
            {activeStep > 4 ? "Note generated" : "Generating note..."}
          </div>
          <div className="ml-auto text-[#A8A29E] font-red-hat text-xs leading-4">
            {conversation.title || "Conversation"}
          </div>
        </div>

        {/* Steps */}
        <div className="flex flex-col">
          {steps.map((step) => (
            <div key={step.label} className="flex items-center py-2.5 gap-2.5 border-t border-[#E7E5E4]">
              {/* Icon */}
              <div className={`flex items-center justify-center shrink-0 rounded-xl size-6 ${
                step.status === "done" ? "bg-[#F5F5F4]" :
                step.status === "active" ? "bg-[#FEF2F2]" : "bg-[#F5F5F4]"
              }`}>
                {step.status === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : step.status === "active" ? (
                  <div className="rounded-sm bg-[#EF4444] shrink-0 size-2 animate-pulse" />
                ) : (
                  <div className="rounded-sm bg-[#D6D3D1] shrink-0 size-2" />
                )}
              </div>

              {/* Label */}
              <div className={`font-red-hat font-medium text-[13px] leading-4 ${
                step.status === "active" ? "text-[#EF4444] font-semibold" :
                step.status === "done" ? "text-[#1C1917]" : "text-[#A8A29E]"
              }`}>
                {step.label}
              </div>

              {/* Subtitle */}
              <div className={`ml-auto font-red-hat text-[11px] leading-3.5 ${
                step.status === "active" ? "text-[#EF4444]" :
                step.status === "done" ? "text-[#A8A29E]" : "text-[#D6D3D1]"
              }`}>
                {step.subtitle}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preview card */}
      <div className="flex flex-col mx-6 mt-4 rounded-xl gap-3 bg-[#FAFAFA] border border-dashed border-[#D6D3D1] p-4">
        <div className="tracking-widest uppercase text-[#A8A29E] font-red-hat font-bold text-[10px] leading-3">
          {activeStep > 4 ? "Preview — complete" : "Preview — generating"}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="text-[#1C1917] font-red-hat font-bold text-[15px] leading-[18px]">
            {conversation.title || "Untitled Conversation"}
          </div>
        </div>

        {/* Summary preview */}
        {conversation.aiSummary && (
          <div className="flex flex-col gap-1">
            <div className="tracking-[0.06em] text-[#A8A29E] font-red-hat font-bold text-[10px] leading-3">
              SUMMARY
            </div>
            <div className="text-[#57534E] font-red-hat text-xs leading-[17px]">
              {conversation.aiSummary.slice(0, 120)}{conversation.aiSummary.length > 120 ? "..." : ""}
            </div>
          </div>
        )}

        {/* Progress bar */}
        <div className="flex items-center pt-1 gap-1.5">
          <div className="h-0.5 grow rounded-sm bg-[#E7E5E4] overflow-hidden">
            <div
              className="h-full rounded-sm bg-[#EF4444] transition-all duration-300 ease-out"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            />
          </div>
          <span className="text-[#EF4444] font-red-hat font-medium text-[10px] leading-3">
            ~{Math.round(Math.min(progressPercent, 100))}%
          </span>
        </div>
      </div>
    </div>
  );
}
