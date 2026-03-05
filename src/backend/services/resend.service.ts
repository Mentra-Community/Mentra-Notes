import { Resend } from "resend";
import { readFileSync } from "fs";
import { resolve } from "path";

const resend = new Resend(process.env.RESEND_API_KEY);

const BASE_URL = process.env.BASE_URL || "https://general.dev.tpa.ngrok.app";

// Load templates once at startup
const templateDir = resolve(import.meta.dir, "../../public/resend-email-template");
const emailTemplate = readFileSync(resolve(templateDir, "notes-email.html"), "utf-8");
const transcriptTemplate = readFileSync(resolve(templateDir, "transcript-email.html"), "utf-8");

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

function buildNoteCardHtml(note: NoteItem): string {
  const badgeBg = note.noteType === "AI Generated" ? "#E8F5E9" : "#E3F2FD";
  const badgeColor = note.noteType === "AI Generated" ? "#2E7D32" : "#1565C0";
  const downloadBase = `${BASE_URL}/api/notes/${note.noteId}/download`;

  return `<tr>
  <td style="padding:0 40px 16px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F7F5;border:1px solid #EBEBEB;border-radius:12px;">
      <tr>
        <td style="padding:28px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
            <tr>
              <td>
                <table cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:${badgeBg};border-radius:4px;padding:3px 8px;">
                      <span style="color:${badgeColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.04em;line-height:14px;text-transform:uppercase;">${note.noteType}</span>
                    </td>
                  </tr>
                </table>
              </td>
              <td align="right">
                <span style="color:#999999;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:16px;">${note.noteTimestamp}</span>
              </td>
            </tr>
          </table>
          <p style="margin:0 0 20px 0;color:#1A1A1A;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:-0.02em;line-height:28px;">${note.noteTitle}</p>
          <div style="color:#3A3A3A;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;">${note.noteContent}</div>
          <table cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">
            <tr>
              <td align="center" style="background-color:#1A1A1A;border-radius:6px;padding:6px 12px;">
                <a href="${downloadBase}/pdf" style="color:#FFFFFF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;line-height:16px;text-decoration:none;">PDF</a>
              </td>
              <td width="6"></td>
              <td align="center" style="background-color:#1A1A1A;border-radius:6px;padding:6px 12px;">
                <a href="${downloadBase}/txt" style="color:#FFFFFF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;line-height:16px;text-decoration:none;">TXT</a>
              </td>
              <td width="6"></td>
              <td align="center" style="background-color:#1A1A1A;border-radius:6px;padding:6px 12px;">
                <a href="${downloadBase}/docx" style="color:#FFFFFF;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;line-height:16px;text-decoration:none;">Word</a>
              </td>
            </tr>
          </table>
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
}: Omit<SendNotesEmailRequest, "to" | "cc">) {
  const sessionTimeRange = `${sessionStartTime}${sessionEndTime ? " &mdash; " + sessionEndTime : ""}`;
  const noteCards = notes.map(buildNoteCardHtml).join("\n");

  return emailTemplate
    .replaceAll("{{baseUrl}}", BASE_URL)
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
}: SendNotesEmailRequest) {
  const html = buildNotesEmailHtml({
    sessionDate,
    sessionStartTime,
    sessionEndTime,
    notes,
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
