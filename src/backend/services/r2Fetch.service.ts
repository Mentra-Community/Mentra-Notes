import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import type { R2BatchData } from "./r2Upload.service";

// =============================================================================
// Interfaces
// =============================================================================

export interface R2FetchResult {
  success: boolean;
  data?: R2BatchData;
  error?: Error;
}

export interface R2DateListResult {
  success: boolean;
  dates: string[]; // Array of YYYY-MM-DD strings
  error?: Error;
}

// =============================================================================
// Helper: Get S3 Client
// =============================================================================

// Singleton S3Client — reused across all fetch operations to prevent memory leaks
let _r2Client: S3Client | null = null;
function getR2Client(): S3Client | null {
  if (_r2Client) return _r2Client;

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error("[R2Fetch] R2 credentials not configured");
    return null;
  }

  _r2Client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _r2Client;
}

// =============================================================================
// Fetch Transcript from R2
// =============================================================================

/**
 * Fetch a transcript for a specific user and date from R2
 * Path: transcripts/{userId}/{date}/transcript.json
 */
export async function fetchTranscriptFromR2(params: {
  userId: string;
  date: string; // YYYY-MM-DD
}): Promise<R2FetchResult> {
  const { userId, date } = params;
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
  const key = `transcripts/${userId}/${date}/transcript.json`;

  console.log(`[R2Fetch] Fetching transcript for ${userId} on ${date}`);

  const client = getR2Client();
  if (!client) {
    return { success: false, error: new Error("R2 not configured") };
  }

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);
    const bodyStream = response.Body;

    // Convert stream to string
    let bodyContent = "";
    for await (const chunk of bodyStream as AsyncIterable<Uint8Array>) {
      bodyContent += new TextDecoder().decode(chunk);
    }

    const data: R2BatchData = JSON.parse(bodyContent);
    console.log(
      `[R2Fetch] Successfully fetched ${data.segmentCount} segments for ${date}`,
    );

    return { success: true, data };
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) {
      console.log(`[R2Fetch] No transcript found in R2 for ${date}`);
      return { success: false, error: new Error("Transcript not found") };
    }
    console.error(`[R2Fetch] Error fetching transcript:`, error);
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

// =============================================================================
// List Available Dates in R2
// =============================================================================

/**
 * List all dates that have transcripts in R2 for a user
 * Lists prefixes under transcripts/{userId}/ and extracts date folders
 */
export async function listR2TranscriptDates(
  userId: string,
): Promise<R2DateListResult> {
  const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
  const prefix = `transcripts/${userId}/`;

  console.log(`[R2Fetch] Listing dates for ${userId}`);

  const client = getR2Client();
  if (!client) {
    return { success: false, dates: [], error: new Error("R2 not configured") };
  }

  try {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      Delimiter: "/", // Use delimiter to get "folders" only
    });

    const response = await client.send(command);

    // CommonPrefixes contains the "folders" (dates)
    const dates: string[] = [];
    if (response.CommonPrefixes) {
      for (const prefixObj of response.CommonPrefixes) {
        if (prefixObj.Prefix) {
          // Extract date from path: transcripts/{userId}/{date}/
          const match = prefixObj.Prefix.match(
            /transcripts\/[^/]+\/(\d{4}-\d{2}-\d{2})\//,
          );
          if (match && match[1]) {
            dates.push(match[1]);
          }
        }
      }
    }

    // Sort dates descending (most recent first)
    dates.sort((a, b) => b.localeCompare(a));

    console.log(`[R2Fetch] Found ${dates.length} dates in R2 for ${userId}`);
    return { success: true, dates };
  } catch (error) {
    console.error(`[R2Fetch] Error listing dates:`, error);
    return {
      success: false,
      dates: [],
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
