import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import type { TranscriptSegmentI } from "../models/daily-transcript.model";

// Singleton S3Client — reused across all R2 operations to prevent memory leaks
// (each S3Client holds connection pools + buffers that accumulate if created per-request)
let _s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!_s3Client) {
    const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials not configured");
    }
    _s3Client = new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _s3Client;
}

// =============================================================================
// Interfaces
// =============================================================================

export interface R2TranscriptSegment {
  text: string;
  timestamp: string; // UTC ISO string
  isFinal: boolean;
  speakerId?: string;
  index: number;
  type?: "transcript" | "photo";
  photoUrl?: string;
  photoMimeType?: string;
  photoDescription?: string;
  timezone?: string;
}

export interface R2BatchData {
  userId: string;
  date: string; // YYYY-MM-DD
  timezone: string;
  batchedAt: string; // UTC ISO string
  segmentCount: number;
  segments: R2TranscriptSegment[];
}

export interface UploadResult {
  success: boolean;
  url?: string;
  error?: Error;
}

// =============================================================================
// Photo Upload Function
// =============================================================================

/**
 * Upload a photo to R2 immediately
 * Path: transcripts/{userId}/{date}/photos/photo-{timestamp}.{ext}
 */
export async function uploadPhotoToR2(params: {
  userId: string;
  date: string; // YYYY-MM-DD
  buffer: Buffer;
  mimeType: string;
  timestamp: Date;
  timezone?: string;
}): Promise<UploadResult> {
  const { userId, date, buffer, mimeType, timestamp, timezone } = params;

  const extension = mimeType === "image/png" ? "png" : "jpg";
  const photoFilename = `photo-${timestamp.getTime()}.${extension}`;
  const key = `transcripts/${userId}/${date}/photos/${photoFilename}`;

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(`[R2-Photo] Missing R2 credentials`);
    return { success: false, error: new Error("R2 credentials not configured") };
  }

  const s3Client = getS3Client();

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[R2-Photo] Uploading ${key} (attempt ${attempt}/3, ${buffer.length} bytes)`);

      await s3Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: buffer,
          ContentType: mimeType,
          Metadata: {
            userId,
            date,
            capturedAt: timestamp.toISOString(),
            capturedAtLocal: timezone
              ? new Date(timestamp).toLocaleString("en-US", { timeZone: timezone })
              : timestamp.toISOString(),
            timezone: timezone || "UTC",
          },
        }),
      );

      const publicBase = process.env.CLOUDFLARE_R2_PUBLIC_URL;
      const publicUrl = publicBase
        ? `${publicBase}/${key}`
        : `/api/photos/${date}/${photoFilename}`;
      console.log(`[R2-Photo] Upload successful: ${publicUrl}`);
      return { success: true, url: publicUrl };
    } catch (error) {
      console.error(
        `[R2-Photo] Attempt ${attempt} failed:`,
        error instanceof Error ? error.message : error,
      );
      if (attempt < 3) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt - 1) * 1000),
        );
      }
    }
  }

  return { success: false, error: new Error("Photo upload failed after 3 attempts") };
}

// =============================================================================
// Main Upload Function
// =============================================================================

/**
 * Upload batch of transcript segments to Cloudflare R2 storage
 * Implements retry logic with exponential backoff and deduplication
 */
export async function uploadBatchToR2(params: {
  userId: string;
  date: string; // YYYY-MM-DD
  segments: R2TranscriptSegment[];
  timezone: string;
}): Promise<UploadResult> {
  const { userId, date, segments, timezone } = params;

  console.log(`\n[R2] Starting batch upload for ${userId} (${date})`);
  console.log(`[R2] Segments count: ${segments.length}`);
  console.log(`[R2] Timezone: ${timezone}`);

  const key = `transcripts/${userId}/${date}/transcript.json`;
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";

  // Fetch existing file if it exists to merge with new segments
  let allSegments = [...segments];

  try {
    const existingData = await fetchExistingBatch(endpoint, bucketName, key);
    if (
      existingData &&
      existingData.segments &&
      Array.isArray(existingData.segments)
    ) {
      // Deduplicate by index to avoid duplicate segments if merge happens multiple times
      const existingIndices = new Set(
        existingData.segments.map((s: R2TranscriptSegment) => s.index),
      );
      const newSegments = segments.filter((s) => !existingIndices.has(s.index));

      allSegments = [...existingData.segments, ...newSegments];
      console.log(
        `[R2] Merged with existing ${existingData.segments.length} segments, added ${newSegments.length} new ones`,
      );

      if (newSegments.length < segments.length) {
        console.log(
          `[R2] Skipped ${segments.length - newSegments.length} duplicate segments`,
        );
      }
    }
  } catch {
    console.log(`[R2] No existing file found, starting fresh`);
  }

  // Format batch data with metadata
  const batchData: R2BatchData = {
    userId,
    date,
    timezone,
    batchedAt: new Date().toISOString(),
    segmentCount: allSegments.length,
    segments: allSegments,
  };

  const jsonContent = JSON.stringify(batchData, null, 2);
  const contentSize = Buffer.byteLength(jsonContent);

  console.log(`[R2] JSON content size: ${(contentSize / 1024).toFixed(2)} KB`);
  console.log(`[R2] R2 key: ${key}`);

  if (!endpoint) {
    console.error(`[R2] ERROR: CLOUDFLARE_R2_ENDPOINT not configured`);
    return {
      success: false,
      error: new Error("CLOUDFLARE_R2_ENDPOINT not configured"),
    };
  }

  console.log(`[R2] Endpoint: ${endpoint}`);

  // Check credentials
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    console.error(`[R2] ERROR: R2 credentials not configured`);
    console.error(
      `[R2]    - ACCESS_KEY_ID: ${accessKeyId ? "Set" : "Missing"}`,
    );
    console.error(
      `[R2]    - SECRET_ACCESS_KEY: ${secretAccessKey ? "Set" : "Missing"}`,
    );
    return {
      success: false,
      error: new Error("R2 credentials not configured"),
    };
  }

  console.log(`[R2] Credentials configured`);

  // Retry logic: 3 attempts with exponential backoff
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`\n[R2] Upload attempt ${attempt}/3...`);
      const result = await uploadToR2(
        endpoint,
        bucketName,
        key,
        jsonContent,
        accessKeyId,
        secretAccessKey,
        attempt,
      );

      if (result.success) {
        const url = `${endpoint}/${bucketName}/${key}`;
        console.log(`[R2] UPLOAD SUCCESSFUL on attempt ${attempt}`);
        console.log(`[R2] URL: ${url}`);
        return { success: true, url };
      }
    } catch (error) {
      console.error(
        `[R2] Upload attempt ${attempt} failed:`,
        error instanceof Error ? error.message : error,
      );

      if (attempt < 3) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        console.log(`[R2] Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        console.error(`[R2] All 3 upload attempts failed`);
        return { success: false, error: error as Error };
      }
    }
  }

  console.error(`[R2] Upload failed after 3 attempts`);
  return {
    success: false,
    error: new Error("Upload failed after 3 attempts"),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Upload file to R2 using AWS SDK
 */
async function uploadToR2(
  endpoint: string,
  bucketName: string,
  key: string,
  content: string,
  accessKeyId: string,
  secretAccessKey: string,
  attempt: number,
): Promise<{ success: boolean }> {
  const s3Client = getS3Client();

  try {
    console.log(`[R2] Uploading to: ${endpoint}/${bucketName}/${key}`);
    console.log(`[R2] Content: ${content.length} bytes`);

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: "application/json",
    });

    const response = await s3Client.send(command);

    console.log(`[R2] Response status: 200 (Success)`);
    console.log(`[R2] ETag: ${response.ETag}`);
    if (response.VersionId) {
      console.log(`[R2] Version ID: ${response.VersionId}`);
    }
    console.log(`[R2] Attempt ${attempt}: Upload successful`);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[R2] Request error:`, errorMessage);
    throw error;
  }
}

/**
 * Fetch existing batch file from R2 to merge with new segments
 */
async function fetchExistingBatch(
  endpoint: string | undefined,
  bucketName: string,
  key: string,
): Promise<R2BatchData | null> {
  if (!endpoint) {
    throw new Error("Endpoint not configured");
  }

  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  const s3Client = getS3Client();

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await s3Client.send(command);
    const bodyStream = response.Body;

    // Convert stream to string
    let bodyContent = "";
    for await (const chunk of bodyStream as AsyncIterable<Uint8Array>) {
      bodyContent += new TextDecoder().decode(chunk);
    }

    return JSON.parse(bodyContent);
  } catch {
    // File doesn't exist or error occurred
    return null;
  }
}

/**
 * Convert TranscriptSegmentI to R2TranscriptSegment format
 * Converts timestamps to UTC ISO strings
 */
export function formatSegmentForR2(
  segment: TranscriptSegmentI,
): R2TranscriptSegment {
  const result: R2TranscriptSegment = {
    text: segment.text,
    timestamp: segment.timestamp.toISOString(), // Already UTC
    isFinal: segment.isFinal,
    speakerId: segment.speakerId,
    index: segment.index,
  };

  if (segment.type === "photo") {
    result.type = "photo";
    result.photoUrl = segment.photoUrl;
    result.photoMimeType = segment.photoMimeType;
    result.timezone = segment.timezone;
  }

  return result;
}

/**
 * Delete a transcript file from R2 storage
 */
export async function deleteFromR2(params: {
  userId: string;
  date: string; // YYYY-MM-DD
}): Promise<{ success: boolean; error?: Error }> {
  const { userId, date } = params;

  const key = `transcripts/${userId}/${date}/transcript.json`;
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  console.log(`[R2] Deleting transcript for ${userId} (${date})`);

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error(`[R2] ERROR: R2 credentials not configured for delete`);
    return {
      success: false,
      error: new Error("R2 credentials not configured"),
    };
  }

  const s3Client = getS3Client();

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`[R2] Successfully deleted: ${key}`);
    return { success: true };
  } catch (error) {
    console.error(`[R2] Delete failed:`, error);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
