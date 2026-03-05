/**
 * Verify test data exists in both R2 and MongoDB
 *
 * Run with: bun src/test/verify-test-data.ts
 */

import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { MongoClient } from "mongodb";

const TEST_USER_ID = process.env.TEST_USER_ID || "test@example.com";

const MONGODB_URI = process.env.MONGODB_URI!;
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT!;
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME || "mentra-notes";
const R2_ACCESS_KEY = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!;
const R2_SECRET_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!;

async function verifyR2() {
  console.log("\n📦 Checking R2...");

  const s3Client = new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY,
      secretAccessKey: R2_SECRET_KEY,
    },
  });

  // List dates in R2
  const listCommand = new ListObjectsV2Command({
    Bucket: R2_BUCKET,
    Prefix: `transcripts/${TEST_USER_ID}/`,
    Delimiter: "/",
  });

  const listResult = await s3Client.send(listCommand);
  const dates: string[] = [];

  if (listResult.CommonPrefixes) {
    for (const prefix of listResult.CommonPrefixes) {
      const match = prefix.Prefix?.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) dates.push(match[1]);
    }
  }

  console.log(`   Found ${dates.length} dates in R2:`, dates);

  // Fetch content for each date
  for (const date of dates) {
    const key = `transcripts/${TEST_USER_ID}/${date}/transcript.json`;
    try {
      const getCommand = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      });
      const response = await s3Client.send(getCommand);
      let content = "";
      for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        content += new TextDecoder().decode(chunk);
      }
      const data = JSON.parse(content);
      console.log(`   ✅ ${date}: ${data.segmentCount} segments`);
    } catch (err) {
      console.log(`   ❌ ${date}: Error reading file`);
    }
  }
}

async function verifyMongoDB() {
  console.log("\n🗄️  Checking MongoDB...");

  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db("mentra-notes");
    const collection = db.collection("dailytranscripts");

    const docs = await collection
      .find({ userId: TEST_USER_ID })
      .project({ date: 1, totalSegments: 1, _id: 0 })
      .toArray();

    console.log(`   Found ${docs.length} dates in MongoDB:`);
    for (const doc of docs) {
      console.log(`   ✅ ${doc.date}: ${doc.totalSegments} segments`);
    }
  } finally {
    await client.close();
  }
}

async function main() {
  console.log("🔍 Verifying test data for user:", TEST_USER_ID);

  await verifyR2();
  await verifyMongoDB();

  console.log("\n✅ Verification complete!");
}

main().catch(console.error);
