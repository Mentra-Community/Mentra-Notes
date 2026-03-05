import { Resend } from "resend";
import { readFileSync } from "fs";
import { resolve } from "path";

const resend = new Resend(process.env.RESEND_API_KEY);

const BASE_URL = process.env.BASE_URL || "https://general.dev.tpa.ngrok.app";

// Load templates once at startup
const templateDir = resolve(import.meta.dir, "../../public/resend-email-template");
const emailTemplate = readFileSync(resolve(templateDir, "notes-email.html"), "utf-8");
const transcriptTemplate = readFileSync(resolve(templateDir, "transcript-email.html"), "utf-8");

interface SendNoteEmailRequest {
  to: string | string[];
  cc?: string | string[];
  noteId: string;
  sessionDate: string;
  sessionStartTime: string;
  sessionEndTime: string;
  noteTimestamp: string;
  noteTitle: string;
  noteContent: string;
  noteType: string;
}

function buildNoteEmailHtml({
  noteId,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  noteTimestamp,
  noteTitle,
  noteContent,
  noteType,
}: Omit<SendNoteEmailRequest, "to">) {
  const badgeBg = noteType === "AI Generated" ? "#E8F5E9" : "#E3F2FD";
  const badgeColor = noteType === "AI Generated" ? "#2E7D32" : "#1565C0";
  const downloadBase = `${BASE_URL}/api/notes/${noteId}/download`;
  const sessionTimeRange = `${sessionStartTime}${sessionEndTime ? " &mdash; " + sessionEndTime : ""}`;

  return emailTemplate
    .replaceAll("{{sessionDate}}", sessionDate)
    .replaceAll("{{sessionTimeRange}}", sessionTimeRange)
    .replaceAll("{{downloadBase}}", downloadBase)
    .replaceAll("{{badgeBg}}", badgeBg)
    .replaceAll("{{badgeColor}}", badgeColor)
    .replaceAll("{{noteType}}", noteType)
    .replaceAll("{{noteTimestamp}}", noteTimestamp)
    .replaceAll("{{noteTitle}}", noteTitle)
    .replaceAll("{{noteContent}}", noteContent);
}

export async function sendNoteEmail({
  to,
  cc,
  noteId,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  noteTimestamp,
  noteTitle,
  noteContent,
  noteType,
}: SendNoteEmailRequest) {
  const html = buildNoteEmailHtml({
    noteId,
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    noteTimestamp,
    noteTitle,
    noteContent,
    noteType,
  });

  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : undefined;

  const { data, error } = await resend.emails.send({
    from: "Mentra Notes <notes@mentra.glass>",
    to: Array.isArray(to) ? to : [to],
    ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
    subject: `Your Notes: ${noteTitle}`,
    html,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}

// =============================================================================
// Transcript Email
// =============================================================================

interface TranscriptEmailSegment {
  timestamp: string;
  text: string;
}

interface SendTranscriptEmailRequest {
  to: string | string[];
  cc?: string | string[];
  transcriptId: string;
  sessionDate: string;
  sessionStartTime: string;
  sessionEndTime: string;
  segments: TranscriptEmailSegment[];
}

function buildTranscriptRowsHtml(segments: TranscriptEmailSegment[]): string {
  return segments
    .map((seg, i) => {
      const isLast = i === segments.length - 1;
      const borderStyle = isLast
        ? ""
        : "border-bottom:1px solid #E8E8E6;";
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="${borderStyle}">
  <tr>
    <td style="padding:12px 0;vertical-align:top;width:42px;">
      <span style="color:#999999;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;line-height:16px;">${seg.timestamp}</span>
    </td>
    <td style="padding:12px 0;vertical-align:top;">
      <span style="color:#3A3A3A;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;">${seg.text}</span>
    </td>
  </tr>
</table>`;
    })
    .join("");
}

function buildTranscriptEmailHtml({
  transcriptId,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  segments,
}: Omit<SendTranscriptEmailRequest, "to">) {
  const downloadBase = `${BASE_URL}/api/transcripts/${transcriptId}/download`;
  const sessionTimeRange = `${sessionStartTime}${sessionEndTime ? " &mdash; " + sessionEndTime : ""}`;
  const transcriptRows = buildTranscriptRowsHtml(segments);

  return transcriptTemplate
    .replaceAll("{{sessionDate}}", sessionDate)
    .replaceAll("{{sessionTimeRange}}", sessionTimeRange)
    .replaceAll("{{downloadBase}}", downloadBase)
    .replaceAll("{{transcriptRows}}", transcriptRows);
}

export async function sendTranscriptEmail({
  to,
  cc,
  transcriptId,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  segments,
}: SendTranscriptEmailRequest) {
  const html = buildTranscriptEmailHtml({
    transcriptId,
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    segments,
  });

  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : undefined;

  const { data, error } = await resend.emails.send({
    from: "Mentra Notes <notes@mentra.glass>",
    to: Array.isArray(to) ? to : [to],
    ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
    subject: `Your Transcription: ${sessionDate}`,
    html,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }

  return data;
}
