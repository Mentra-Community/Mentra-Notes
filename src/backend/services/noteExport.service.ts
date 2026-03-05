import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  BorderStyle,
} from "docx";

// =============================================================================
// Helpers
// =============================================================================

/** Keep only printable ASCII (0x20-0x7E), mapping common Unicode to ASCII equivalents. */
function toAscii(text: string): string {
  const mapped = text
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "*")
    .replace(/\u00A0/g, " ");
  let out = "";
  for (let i = 0; i < mapped.length; i++) {
    const c = mapped.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7E) out += mapped[i];
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Extract image URLs from HTML */
function extractImages(html: string): string[] {
  const urls: string[] = [];
  const regex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/** Fetch image as buffer */
async function fetchImage(url: string): Promise<{ buffer: Buffer; type: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), type: contentType };
  } catch {
    return null;
  }
}

interface ParsedBlock {
  type: "heading1" | "heading2" | "heading3" | "paragraph" | "bullet" | "image" | "spacer";
  text?: string;
  bold?: boolean;
  parts?: { text: string; bold: boolean; italic: boolean }[];
  imageUrl?: string;
}

/** Parse HTML into structured blocks */
function parseHtmlToBlocks(html: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Normalize: remove newlines, collapse whitespace between tags
  let normalized = html.replace(/\n/g, "").replace(/>\s+</g, "><");

  // Split into block-level elements
  const blockRegex = /<(h[1-3]|p|ul|ol|li|img)([^>]*)>([\s\S]*?)<\/\1>|<img([^>]*)\/?>|<br\s*\/?>/gi;
  let match;

  // Simple approach: process the HTML sequentially
  const parts = normalized.split(/(<(?:h[1-3]|p|ul|ol|li)[^>]*>[\s\S]*?<\/(?:h[1-3]|p|ul|ol|li)>|<img[^>]*\/?>|<br\s*\/?>)/gi);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Heading
    const headingMatch = trimmed.match(/^<(h([1-3]))[^>]*>([\s\S]*?)<\/h[1-3]>$/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[2]);
      const text = stripInlineTags(headingMatch[3]);
      if (text.trim()) {
        blocks.push({
          type: level === 1 ? "heading1" : level === 2 ? "heading2" : "heading3",
          text: text.trim(),
          parts: parseInlineFormatting(headingMatch[3]),
        });
      }
      continue;
    }

    // Image
    const imgMatch = trimmed.match(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/i);
    if (imgMatch) {
      blocks.push({ type: "image", imageUrl: imgMatch[1] });
      continue;
    }

    // List item
    const liMatch = trimmed.match(/^<li[^>]*>([\s\S]*?)<\/li>$/i);
    if (liMatch) {
      const text = stripInlineTags(liMatch[1]);
      if (text.trim()) {
        blocks.push({ type: "bullet", text: text.trim(), parts: parseInlineFormatting(liMatch[1]) });
      }
      continue;
    }

    // Paragraph
    const pMatch = trimmed.match(/^<p[^>]*>([\s\S]*?)<\/p>$/i);
    if (pMatch) {
      const inner = pMatch[1].trim();
      // Check for image inside paragraph
      const innerImg = inner.match(/<img[^>]+src=["']([^"']+)["'][^>]*\/?>/i);
      if (innerImg) {
        blocks.push({ type: "image", imageUrl: innerImg[1] });
      }
      const text = stripInlineTags(inner);
      if (text.trim()) {
        blocks.push({ type: "paragraph", text: text.trim(), parts: parseInlineFormatting(inner) });
      } else if (!innerImg) {
        blocks.push({ type: "spacer" });
      }
      continue;
    }

    // UL/OL — extract li children
    const listMatch = trimmed.match(/^<[uo]l[^>]*>([\s\S]*?)<\/[uo]l>$/i);
    if (listMatch) {
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch2;
      while ((liMatch2 = liRegex.exec(listMatch[1])) !== null) {
        const text = stripInlineTags(liMatch2[1]);
        if (text.trim()) {
          blocks.push({ type: "bullet", text: text.trim(), parts: parseInlineFormatting(liMatch2[1]) });
        }
      }
      continue;
    }
  }

  return blocks;
}

/** Parse inline bold/italic formatting */
function parseInlineFormatting(html: string): { text: string; bold: boolean; italic: boolean }[] {
  const parts: { text: string; bold: boolean; italic: boolean }[] = [];
  // Remove images first
  const cleaned = html.replace(/<img[^>]*\/?>/gi, "");
  // Split by strong/em/b/i tags
  const regex = /(<(?:strong|b|em|i)[^>]*>[\s\S]*?<\/(?:strong|b|em|i)>)/gi;
  const segments = cleaned.split(regex);

  for (const seg of segments) {
    const strongMatch = seg.match(/^<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>$/i);
    const emMatch = seg.match(/^<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>$/i);

    if (strongMatch) {
      const text = stripInlineTags(strongMatch[1]);
      if (text) parts.push({ text, bold: true, italic: false });
    } else if (emMatch) {
      const text = stripInlineTags(emMatch[1]);
      if (text) parts.push({ text, bold: false, italic: true });
    } else {
      const text = stripInlineTags(seg);
      if (text) parts.push({ text, bold: false, italic: false });
    }
  }

  return parts;
}

/** Strip all HTML tags and decode entities */
function stripInlineTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&hellip;/g, "\u2026")
    .trim();
}

/** Strip HTML for plain text (TXT export) */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  * ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&hellip;/g, "\u2026")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface NoteExportData {
  title: string;
  content: string;
  sessionDate?: string;
  noteType?: string;
  noteTimestamp?: string;
}

// =============================================================================
// TXT
// =============================================================================

export function generateTxt({ title, content, sessionDate, noteType, noteTimestamp }: NoteExportData): Buffer {
  const plainContent = stripHtml(content);
  const lines = [
    title,
    "=".repeat(Math.min(title.length, 60)),
    "",
  ];
  if (sessionDate) lines.push(`Date: ${sessionDate}`);
  if (noteTimestamp) lines.push(`Time: ${noteTimestamp}`);
  if (noteType) lines.push(`Type: ${noteType}`);
  if (sessionDate || noteTimestamp || noteType) lines.push("");
  lines.push(plainContent);

  return Buffer.from(lines.join("\n"), "utf-8");
}

// =============================================================================
// PDF
// =============================================================================

export async function generatePdf({ title, content, sessionDate, noteType, noteTimestamp }: NoteExportData): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const plainContent = stripHtml(content);
  const imageUrls = extractImages(content);

  // Pre-fetch all images
  const imageCache = new Map<string, { buffer: Buffer; type: string }>();
  await Promise.all(
    imageUrls.map(async (url) => {
      const img = await fetchImage(url);
      if (img) imageCache.set(url, img);
    }),
  );

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const ensureSpace = (needed: number) => {
    if (y < margin + needed) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const drawText = (text: string, font: typeof helvetica, size: number, color = rgb(0.1, 0.1, 0.1)) => {
    const safeText = toAscii(text);
    if (!safeText) return;
    const words = safeText.split(" ");
    let line = "";
    const lines: string[] = [];

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, size);
      if (width > contentWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);

    for (const l of lines) {
      ensureSpace(size * 1.5 + 5);
      page.drawText(l, { x: margin, y, font, size, color });
      y -= size * 1.5;
    }
  };

  // Title
  drawText(title, helveticaBold, 20, rgb(0.1, 0.1, 0.1));
  y -= 10;

  // Metadata
  if (sessionDate || noteTimestamp || noteType) {
    const meta = [sessionDate, noteTimestamp, noteType].filter(Boolean).join("  -  ");
    drawText(meta, helvetica, 10, rgb(0.5, 0.5, 0.5));
    y -= 10;
  }

  // Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: pageWidth - margin, y },
    thickness: 0.5,
    color: rgb(0.85, 0.85, 0.85),
  });
  y -= 20;

  // Content — simple plain text approach (the one that was working)
  const paragraphs = plainContent.split("\n");
  for (const para of paragraphs) {
    if (para.trim() === "") {
      y -= 8;
      continue;
    }
    const isBullet = para.trim().startsWith("*");
    drawText(para, helvetica, 11, rgb(0.2, 0.2, 0.2));
    if (!isBullet) y -= 4;
  }

  // Images — embed at the end of the text content
  for (const url of imageUrls) {
    const imgData = imageCache.get(url);
    if (!imgData) continue;
    try {
      let pdfImage;
      if (imgData.type.includes("png")) {
        pdfImage = await pdfDoc.embedPng(imgData.buffer);
      } else {
        pdfImage = await pdfDoc.embedJpg(imgData.buffer);
      }

      const scale = Math.min(contentWidth / pdfImage.width, 350 / pdfImage.height, 1);
      const imgWidth = pdfImage.width * scale;
      const imgHeight = pdfImage.height * scale;

      ensureSpace(imgHeight + 20);
      y -= 10;
      page.drawImage(pdfImage, {
        x: margin,
        y: y - imgHeight,
        width: imgWidth,
        height: imgHeight,
      });
      y -= imgHeight + 14;
    } catch (err) {
      console.error("[PDF] Failed to embed image:", err);
    }
  }

  return pdfDoc.save();
}

// =============================================================================
// DOCX
// =============================================================================

export async function generateDocx({ title, content, sessionDate, noteType, noteTimestamp }: NoteExportData): Promise<Buffer> {
  // Use the same reliable stripHtml approach as PDF, plus image support
  const plainContent = stripHtml(content);
  const imageUrls = extractImages(content);
  console.log("[DOCX] Found", imageUrls.length, "images in content");
  if (imageUrls.length > 0) console.log("[DOCX] Image URLs:", imageUrls);

  // Pre-fetch images
  const imageCache = new Map<string, { buffer: Buffer; type: string }>();
  await Promise.all(
    imageUrls.map(async (url) => {
      const img = await fetchImage(url);
      if (img) {
        console.log("[DOCX] Fetched image:", url, "size:", img.buffer.length, "type:", img.type);
        imageCache.set(url, img);
      } else {
        console.log("[DOCX] Failed to fetch image:", url);
      }
    }),
  );

  const metaParts = [sessionDate, noteTimestamp, noteType].filter(Boolean);

  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 48, // 24pt
          font: "Helvetica Neue",
          color: "1A1A1A",
        }),
      ],
      spacing: { after: 120 },
    }),
  );

  // Metadata
  if (metaParts.length > 0) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metaParts.join("  \u2022  "),
            color: "888888",
            size: 20, // 10pt
            font: "Helvetica Neue",
          }),
        ],
        spacing: { after: 200 },
      }),
    );
  }

  // Divider
  children.push(
    new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      },
      spacing: { after: 300 },
    }),
  );

  // Content — split plain text into lines, same as PDF approach
  const lines = plainContent.split("\n");
  for (const line of lines) {
    if (line.trim() === "") {
      children.push(new Paragraph({ text: "", spacing: { after: 80 } }));
      continue;
    }

    const isBullet = line.trim().startsWith("\u2022");

    if (isBullet) {
      // Remove the bullet character and leading whitespace
      const bulletText = line.trim().replace(/^\u2022\s*/, "");
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: bulletText,
              size: 22,
              font: "Helvetica Neue",
              color: "3A3A3A",
            }),
          ],
          bullet: { level: 0 },
          spacing: { after: 80 },
        }),
      );
    } else {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: line,
              size: 22, // 11pt
              font: "Helvetica Neue",
              color: "3A3A3A",
            }),
          ],
          spacing: { after: 120 },
        }),
      );
    }
  }

  // Images — embed after text content
  for (const url of imageUrls) {
    const imgData = imageCache.get(url);
    if (!imgData) continue;
    try {
      // Use fixed dimensions scaled to fit — avoids fragile JPEG header parsing
      const imgType = imgData.type.includes("png") ? "png" : "jpg";
      console.log("[DOCX] Embedding image:", url, "type:", imgType, "bufferLen:", imgData.buffer.length);

      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: new Uint8Array(imgData.buffer),
              transformation: { width: 500, height: 350 },
              type: imgType,
            }),
          ],
          spacing: { before: 200, after: 200 },
        }),
      );
      console.log("[DOCX] Image paragraph added successfully");
    } catch (err) {
      console.error("[DOCX] Failed to embed image:", err);
    }
  }

  // Footer
  children.push(
    new Paragraph({
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
      },
      spacing: { before: 400 },
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "Generated by Mentra Notes",
          color: "AAAAAA",
          size: 16, // 8pt
          font: "Helvetica Neue",
        }),
      ],
    }),
  );

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  return Buffer.from(buffer);
}
