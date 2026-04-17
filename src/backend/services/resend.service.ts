import { Resend } from "resend";
import { readFileSync } from "fs";
import { resolve } from "path";
import { generateDownloadToken } from "./signedUrl.service";

const resend = new Resend(process.env.RESEND_API_KEY);
if (!process.env.RESEND_API_KEY) {
  console.warn("[Resend] RESEND_API_KEY not set — email sending will fail");
}

// Load templates once at startup
const templateDir = resolve(import.meta.dir, "../../public/resend-email-template");
const emailTemplate = readFileSync(resolve(templateDir, "notes-email.html"), "utf-8");
const transcriptTemplate = readFileSync(resolve(templateDir, "transcript-email.html"), "utf-8");
const dataExportTemplate = readFileSync(resolve(templateDir, "data-export-email.html"), "utf-8");

/** Escape plain text for safe HTML interpolation */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface NoteItem {
  noteId: string;
  noteTimestamp: string;
  noteTitle: string;
  noteContent: string;
  noteType: string;
}

interface SendNotesEmailRequest {
  to: string | string[];
  cc?: string | string[];
  sessionDate: string;
  sessionStartTime: string;
  sessionEndTime: string;
  notes: NoteItem[];
}

function buildNoteCardHtml(note: NoteItem, baseUrl: string): string {
  // Badge colors matching the app's warm stone design
  let badgeBg: string, badgeColor: string;
  if (note.noteType === "AI Generated") {
    badgeBg = "#FEE2E2"; badgeColor = "#DC2626";
  } else if (note.noteType === "Conversation") {
    badgeBg = "#F5F5F4"; badgeColor = "#78716C";
  } else {
    badgeBg = "#F5F5F4"; badgeColor = "#78716C";
  }

  const token = generateDownloadToken(note.noteId);
  const downloadBase = `${baseUrl}/api/notes/${note.noteId}/download`;

  // Only show download buttons for actual notes (not conversation summaries)
  const showDownloads = note.noteType !== "Conversation" && note.noteType !== "Transcript";

  return `<tr>
  <td style="padding:0 40px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;background-color:#F5F5F4;border:1px solid #E7E5E4;border-radius:12px;">
      <tr>
        <td style="padding:28px;word-wrap:break-word;overflow-wrap:break-word;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="table-layout:fixed;margin-bottom:20px;">
            <tr>
              <td>
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:${badgeBg};border-radius:4px;padding:3px 8px;">
                      <span style="color:${badgeColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.04em;line-height:14px;text-transform:uppercase;">${note.noteType}</span>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right">
                <span style="color:#A8A29E;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;">${note.noteTimestamp}</span>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 20px 0;color:#1C1917;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.02em;line-height:28px;word-wrap:break-word;">${note.noteTitle}</p>
          <div style="color:#78716C;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;max-width:484px;width:100%;word-wrap:break-word;overflow-wrap:break-word;overflow:hidden;">${note.noteContent}</div>${showDownloads ? `
          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
            <tr>
              <td align="center" style="background-color:#1C1917;border-radius:8px;padding:7px 14px;">
                <a href="${downloadBase}/pdf?token=${token}" style="color:#FAFAF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:16px;text-decoration:none;">PDF</a>
              </td>
              <td width="6"></td>
              <td align="center" style="background-color:#1C1917;border-radius:8px;padding:7px 14px;">
                <a href="${downloadBase}/txt?token=${token}" style="color:#FAFAF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:16px;text-decoration:none;">TXT</a>
              </td>
              <td width="6"></td>
              <td align="center" style="background-color:#1C1917;border-radius:8px;padding:7px 14px;">
                <a href="${downloadBase}/docx?token=${token}" style="color:#FAFAF9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;line-height:16px;text-decoration:none;">Word</a>
              </td>
            </tr>
          </table>` : ""}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function buildNotesEmailHtml({
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  notes,
  baseUrl,
}: Omit<SendNotesEmailRequest, "to" | "cc"> & { baseUrl: string }) {
  const sessionTimeRange = `${sessionStartTime}${sessionEndTime ? " &mdash; " + sessionEndTime : ""}`;
  const noteCards = notes.map((n) => buildNoteCardHtml(n, baseUrl)).join("\n");

  return emailTemplate
    .replaceAll("{{sessionDate}}", sessionDate)
    .replaceAll("{{sessionTimeRange}}", sessionTimeRange)
    .replaceAll("{{noteCards}}", noteCards);
}

export async function sendNotesEmail({
  to,
  cc,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  notes,
  baseUrl,
}: SendNotesEmailRequest & { baseUrl: string }) {
  const html = buildNotesEmailHtml({
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    notes,
    baseUrl,
  });

  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : undefined;
  const noteCount = notes.length;
  const subject = noteCount === 1
    ? `Your Notes: ${notes[0].noteTitle}`
    : `Your Notes: ${noteCount} Notes`;

  const { data, error } = await resend.emails.send({
    from: "Mentra Notes <notes@mentra.glass>",
    to: Array.isArray(to) ? to : [to],
    ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
    subject,
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
        : "border-bottom:1px solid #E7E5E4;";
      return `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="${borderStyle}">
  <tr>
    <td style="padding:12px 0;vertical-align:top;width:50px;">
      <span style="color:#A8A29E;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;line-height:16px;">${escapeHtml(seg.timestamp)}</span>
    </td>
    <td style="padding:12px 0;vertical-align:top;">
      <span style="color:#1C1917;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;">${escapeHtml(seg.text)}</span>
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
  baseUrl,
}: Omit<SendTranscriptEmailRequest, "to"> & { baseUrl: string }) {
  const token = generateDownloadToken(transcriptId);
  const downloadBase = `${baseUrl}/api/transcripts/${transcriptId}/download`;
  const downloadPdf = `${downloadBase}/pdf?token=${token}`;
  const downloadTxt = `${downloadBase}/txt?token=${token}`;
  const downloadDocx = `${downloadBase}/docx?token=${token}`;
  const sessionTimeRange = `${sessionStartTime}${sessionEndTime ? " &mdash; " + sessionEndTime : ""}`;
  const transcriptRows = buildTranscriptRowsHtml(segments);

  return transcriptTemplate
    .replaceAll("{{sessionDate}}", sessionDate)
    .replaceAll("{{sessionTimeRange}}", sessionTimeRange)
    .replaceAll("{{downloadPdf}}", downloadPdf)
    .replaceAll("{{downloadTxt}}", downloadTxt)
    .replaceAll("{{downloadDocx}}", downloadDocx)
    .replaceAll("{{transcriptRows}}", transcriptRows);
}

// =============================================================================
// Data Export Email (full-account ZIP)
// =============================================================================

interface SendDataExportEmailRequest {
  to: string | string[];
  cc?: string | string[];
  zipBuffer: Buffer;
  zipFilename: string;
  transcriptCount: number;
  noteCount: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function sendDataExportEmail({
  to,
  cc,
  zipBuffer,
  zipFilename,
  transcriptCount,
  noteCount,
}: SendDataExportEmailRequest) {
  const html = dataExportTemplate
    .replaceAll("{{transcriptCount}}", String(transcriptCount))
    .replaceAll("{{transcriptPlural}}", transcriptCount === 1 ? "" : "s")
    .replaceAll("{{noteCount}}", String(noteCount))
    .replaceAll("{{notePlural}}", noteCount === 1 ? "" : "s")
    .replaceAll("{{zipSize}}", formatBytes(zipBuffer.byteLength))
    .replaceAll("{{zipFilename}}", escapeHtml(zipFilename));

  const ccList = cc ? (Array.isArray(cc) ? cc : [cc]).filter(Boolean) : undefined;

  const { data, error } = await resend.emails.send({
    from: "Mentra Notes <notes@mentra.glass>",
    to: Array.isArray(to) ? to : [to],
    ...(ccList && ccList.length > 0 ? { cc: ccList } : {}),
    subject: "Your Mentra Notes data export",
    html,
    attachments: [
      {
        filename: zipFilename,
        content: zipBuffer,
      },
    ],
  });

  if (error) {
    throw new Error(`Failed to send data export email: ${error.message}`);
  }

  return data;
}

export async function sendTranscriptEmail({
  to,
  cc,
  transcriptId,
  sessionDate,
  sessionStartTime,
  sessionEndTime,
  segments,
  baseUrl,
}: SendTranscriptEmailRequest & { baseUrl: string }) {
  const html = buildTranscriptEmailHtml({
    transcriptId,
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    segments,
    baseUrl,
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
