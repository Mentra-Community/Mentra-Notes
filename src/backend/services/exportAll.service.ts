/**
 * exportAll.service — Build a ZIP of all a user's transcripts + notes as plain .txt files.
 *
 * Layout inside the ZIP:
 *   transcripts/YYYY-MM-DD.txt   — one file per day
 *   notes/{safe-title}.txt       — one file per note (title as first line, body below)
 */

import AdmZip from "adm-zip";
import {
  DailyTranscript,
  Note,
  getFiles,
} from "../models";
import { fetchTranscriptFromR2 } from "./r2Fetch.service";
import type { R2TranscriptSegment } from "./r2Upload.service";

function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export interface BuildZipResult {
  buffer: Buffer;
  transcriptCount: number;
  noteCount: number;
}

export async function buildUserDataZip(userId: string): Promise<BuildZipResult> {
  const zip = new AdmZip();

  // ── Transcripts ──
  // File is the source of truth for which days exist for the user. Live days
  // have a DailyTranscript in Mongo; archived days have their segments in R2
  // (Mongo row is deleted after the batch job). Walk both so the export sees
  // everything the UI would show.
  const files = await getFiles(userId);
  const filesWithTranscript = files.filter((f) => f.hasTranscript);
  const seenDates = new Set<string>();
  let transcriptDayCount = 0;

  for (const file of filesWithTranscript) {
    const date = file.date;
    if (seenDates.has(date)) continue;
    seenDates.add(date);

    let segments: Array<{
      text: string;
      timestamp: Date | string;
      isFinal: boolean;
      speakerId?: string;
      type?: "transcript" | "photo";
      photoDescription?: string;
    }> = [];

    // Prefer live Mongo record (today / not-yet-batched days)
    const daily = await DailyTranscript.findOne({ userId, date }).lean();
    if (daily && daily.segments && daily.segments.length > 0) {
      segments = daily.segments as typeof segments;
    } else if (file.r2Key) {
      // Fall back to R2 for archived days
      const r2 = await fetchTranscriptFromR2({ userId, date });
      if (r2.success && r2.data) {
        segments = (r2.data.segments as R2TranscriptSegment[]).map((s) => ({
          text: s.text,
          timestamp: s.timestamp,
          isFinal: s.isFinal,
          speakerId: s.speakerId,
          type: s.type,
          photoDescription: s.photoDescription,
        }));
      } else {
        console.warn(`[exportAll] Skipping ${date} — R2 fetch failed:`, r2.error?.message);
        continue;
      }
    } else {
      // No Mongo row and no r2Key — nothing to write.
      continue;
    }

    const lines: string[] = [];
    lines.push(`Transcript — ${date}`);
    lines.push("");
    for (const seg of segments) {
      if (!seg.isFinal) continue;
      const ts = seg.timestamp ? new Date(seg.timestamp).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
      const speaker = seg.speakerId ? `${seg.speakerId}: ` : "";
      if (seg.type === "photo") {
        lines.push(`[${ts}] 📷 Photo${seg.photoDescription ? ` — ${seg.photoDescription}` : ""}`);
      } else {
        lines.push(`[${ts}] ${speaker}${seg.text}`);
      }
    }
    zip.addFile(`transcripts/${date}.txt`, Buffer.from(lines.join("\n"), "utf-8"));
    transcriptDayCount++;
  }

  // ── Notes ──
  // Include trashed notes too — export-all should reflect the complete account,
  // not the filtered list the UI currently shows.
  const notes = await Note.find({ userId }).sort({ createdAt: 1 }).lean();
  const usedNames = new Set<string>();
  for (const note of notes) {
    const title = (note.title || "Untitled Note").trim();
    let baseName = safeFileName(title, `note-${String(note._id).slice(-6)}`);
    let fileName = `${baseName}.txt`;
    let dupSuffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${baseName} (${dupSuffix}).txt`;
      dupSuffix++;
    }
    usedNames.add(fileName);

    const createdStr = note.createdAt
      ? new Date(note.createdAt).toLocaleString("en-US", {
          year: "numeric", month: "short", day: "numeric",
          hour: "numeric", minute: "2-digit",
        })
      : "";

    const body = stripHtml(note.content || note.summary || "");

    const content = [
      title,
      createdStr ? `Created: ${createdStr}` : "",
      note.isAIGenerated ? "Source: AI" : "Source: Manual",
      "",
      body,
    ]
      .filter((l) => l !== null && l !== undefined)
      .join("\n");

    zip.addFile(`notes/${fileName}`, Buffer.from(content, "utf-8"));
  }

  // If the user has nothing at all, still return a non-empty ZIP with a README
  if (transcriptDayCount === 0 && notes.length === 0) {
    zip.addFile(
      "README.txt",
      Buffer.from("No transcripts or notes to export yet.\n", "utf-8"),
    );
  }

  return {
    buffer: zip.toBuffer(),
    transcriptCount: transcriptDayCount,
    noteCount: notes.length,
  };
}
