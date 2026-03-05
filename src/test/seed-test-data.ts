/**
 * Test script to seed fake transcript data:
 * 1. Uploads yesterday's transcript to Cloudflare R2
 * 2. Creates today's transcript in MongoDB
 *
 * Run with: bun src/test/seed-test-data.ts
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";

// =============================================================================
// Configuration
// =============================================================================

const TEST_USER_ID = process.env.TEST_USER_ID || "test@example.com";

const MONGODB_URI = process.env.MONGODB_URI!;
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT!;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!;

// =============================================================================
// Helper: Get dates
// =============================================================================

function getToday(): string {
  return "2026-02-03"; // Hardcoded for testing
}

function getYesterday(): string {
  return "2026-02-03"; // Hardcoded for testing
}

// =============================================================================
// Fake transcript data
// =============================================================================

function generateFakeSegments(date: string, count: number) {
  const segments = [];
  const baseTime = new Date(`${date}T09:00:00.000Z`);

  const sampleTexts = [
    "Good morning, let's start the meeting.",
    "I've been working on the new feature implementation.",
    "The API integration is almost complete.",
    "We need to discuss the deployment timeline.",
    "The tests are passing now after the fix.",
    "I'll send the documentation later today.",
    "Let's schedule a follow-up for next week.",
    "The client feedback was very positive.",
    "We should prioritize the bug fixes first.",
    "The performance improvements are significant.",
  ];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(baseTime.getTime() + i * 30000); // 30 seconds apart
    segments.push({
      text: sampleTexts[i % sampleTexts.length],
      timestamp: timestamp.toISOString(),
      isFinal: true,
      speakerId: "1", // Match actual data format
      index: i + 1,
    });
  }

  return segments;
}

// =============================================================================
// Upload to R2 (yesterday's data)
// =============================================================================

async function uploadToR2(userId: string, date: string) {
  console.log(`\n📤 Uploading to R2 for ${date}...`);

  const s3Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });

  const segments = generateFakeSegments(date, 15);
  const key = `transcripts/${userId}/${date}/transcript.json`;

  const batchData = {
    userId,
    date,
    timezone: "America/Los_Angeles",
    batchedAt: new Date().toISOString(),
    segmentCount: segments.length,
    segments,
  };

  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: JSON.stringify(batchData, null, 2),
    ContentType: "application/json",
  });

  await s3Client.send(command);
  console.log(`✅ Uploaded ${segments.length} segments to R2: ${key}`);
}

// =============================================================================
// Insert into MongoDB (today's data)
// =============================================================================

async function insertToMongoDB(userId: string, date: string) {
  console.log(`\n📥 Inserting to MongoDB for ${date}...`);

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db("notes");
    const collection = db.collection("dailytranscripts");

    const segments = generateFakeSegments(date, 10).map((seg) => ({
      ...seg,
      timestamp: new Date(seg.timestamp), // MongoDB stores as Date objects
    }));

    // Upsert the document
    const result = await collection.updateOne(
      { userId, date },
      {
        $set: {
          userId,
          date,
          segments,
          totalSegments: segments.length,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );

    console.log(
      `✅ Inserted ${segments.length} segments to MongoDB for ${date}`,
    );
    console.log(`   Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`);
  } finally {
    await client.close();
  }
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("🧪 Seeding test transcript data...\n");
  console.log(`User ID: ${TEST_USER_ID}`);
  console.log(`Today: ${getToday()}`);
  console.log(`Yesterday: ${getYesterday()}`);

  // Check environment variables
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not set");
    process.exit(1);
  }
  if (!R2_ENDPOINT || !R2_ACCESS_KEY || !R2_SECRET_KEY) {
    console.error("❌ R2 credentials not set");
    process.exit(1);
  }

  try {
    // 1. Upload yesterday's data to R2
    await uploadToR2(TEST_USER_ID, getYesterday());

    // 2. Insert today's data to MongoDB
    await insertToMongoDB(TEST_USER_ID, getToday());

    console.log("\n✅ Test data seeded successfully!");
    console.log("\n📋 Next steps:");
    console.log("   1. Start the app: bun run dev");
    console.log("   2. Log in with the test user");
    console.log("   3. Check the folder list - you should see today and yesterday");
    console.log("   4. Click on yesterday's folder - should fetch from R2");
    console.log("   5. Click on today's folder - should fetch from MongoDB");
  } catch (error) {
    console.error("\n❌ Error seeding data:", error);
    process.exit(1);
  }
}

main();
