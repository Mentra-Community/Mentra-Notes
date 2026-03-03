/**
 * Notes - All-day transcription and AI-powered note generation
 *
 * A MentraOS app that:
 * - Transcribes user speech throughout the day
 * - Generates AI-powered notes from transcripts
 * - Persists data to MongoDB
 * - Syncs state in real-time via WebSocket
 */

import { NotesApp } from "./backend/NotesApp";
import { api } from "./backend/api/router";
import { createMentraAuthRoutes } from "@mentra/sdk";
import indexDev from "./frontend/index.html";
import indexProd from "./frontend/index.prod.html";
import { sessions } from "./backend/session";

// Configuration from environment
const PORT = parseInt(process.env.PORT || "3000", 10);
const PACKAGE_NAME = process.env.PACKAGE_NAME;
const API_KEY = process.env.MENTRAOS_API_KEY;
const COOKIE_SECRET = process.env.COOKIE_SECRET || API_KEY;

// Validate required environment variables
if (!PACKAGE_NAME) {
  console.error("❌ PACKAGE_NAME environment variable is not set");
  process.exit(1);
}

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY environment variable is not set");
  process.exit(1);
}

// Check optional integrations
const hasGemini = !!process.env.GEMINI_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const hasAI = hasGemini || hasAnthropic;
const hasMongoDB = !!process.env.MONGODB_URI;

console.log("🚀 Starting Notes - All-day transcription app\n");
console.log(`   Package: ${PACKAGE_NAME}`);
console.log(`   Port: ${PORT}`);
console.log("");
console.log("   Integrations:");
console.log(
  `   • AI Provider: ${hasAI ? (hasGemini ? "✅ Gemini" : "✅ Anthropic") : "⚠️  (Optional - Set GEMINI_API_KEY or ANTHROPIC_API_KEY for AI summaries)"}`,
);
console.log(
  `   • MongoDB:     ${hasMongoDB ? "✅ MongoDB URI" : "⚠️  (Optional - Set MONGODB_URI for persistence)"}`,
);
console.log("");

// Initialize App (extends Hono via AppServer)
const app = new NotesApp({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
  cookieSecret: COOKIE_SECRET,
});

// Mount Mentra auth routes for frontend token exchange
app.route(
  "/api/mentra/auth",
  createMentraAuthRoutes({
    apiKey: API_KEY,
    packageName: PACKAGE_NAME,
    cookieSecret: COOKIE_SECRET || "",
  }),
);

// Mount API routes
// @ts-ignore - Hono type compatibility
app.route("/api", api);

// Start the SDK app (registers SDK routes, checks version)
await app.start();

console.log(`✅ Notes app running at http://localhost:${PORT}`);
console.log(`   • Webview: http://localhost:${PORT}`);
console.log(`   • API: http://localhost:${PORT}/api/health`);
console.log("");

// Determine environment
const isDevelopment = process.env.NODE_ENV === "development";

// Start Bun server with HMR support and WebSocket
Bun.serve({
  port: PORT,
  idleTimeout: 120, // 2 minutes for SSE connections
  development: isDevelopment && {
    hmr: true,
    console: true,
  },
  routes: {
    // Serve webview at root and /app
    "/": isDevelopment ? indexDev : indexProd,
    "/app": isDevelopment ? indexDev : indexProd,
    "/day/*": isDevelopment ? indexDev : indexProd,
    "/note/*": isDevelopment ? indexDev : indexProd,
    "/settings": isDevelopment ? indexDev : indexProd,
  },
  fetch(request, server) {
    const url = new URL(request.url);

    // WebSocket upgrade for synced clients
    if (url.pathname === "/ws/sync") {
      const userId = url.searchParams.get("userId");
      if (!userId) {
        return new Response("userId required", { status: 400 });
      }

      const upgraded = server.upgrade(request, {
        data: { userId } as any,
      });

      if (!upgraded) {
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return undefined;
    }

    // Handle all other requests through Hono app
    return app.fetch(request);
  },

  websocket: {
    async open(ws: any) {
      const { userId } = ws.data as { userId: string };
      console.log(`[WS/Sync] Client connecting for ${userId}`);

      // Get or create session - works with or without glasses
      const session = await sessions.getOrCreate(userId);
      session.addClient(ws);
    },

    async message(ws: any, message: any) {
      const { userId } = ws.data as { userId: string };
      const session = sessions.get(userId);

      if (session) {
        await session.handleMessage(ws, message.toString());
      }
    },

    async close(ws: any) {
      const { userId } = ws.data as { userId: string };
      console.log(`[WS/Sync] Client disconnected for ${userId}`);

      const session = sessions.get(userId);
      if (session) {
        session.removeClient(ws);
      }
    },
  },
});

if (isDevelopment) {
  console.log(`🔥 HMR enabled for development`);
}
console.log("");

// Graceful shutdown
const shutdown = async () => {
  console.log("\n🛑 Shutting down Notes...");
  await app.stop();
  console.log("👋 Goodbye!");
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
