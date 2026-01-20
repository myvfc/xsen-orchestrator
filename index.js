import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import OpenAI from "openai"; // 🔧 ADDED
console.log("MCP KEY PRESENT:", !!process.env.MCP_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
/* ------------------------------------------------------------------ */
/*                           HEARTBEAT                                 */
/* ------------------------------------------------------------------ */

setInterval(() => {
  console.log("💓 XSEN heartbeat", new Date().toISOString());
}, 60_000);

const PORT = process.env.PORT || 3000;



/* ------------------------------------------------------------------ */
/*                             ENV URLS                                */
/* ------------------------------------------------------------------ */

const VIDEO_AGENT_URL = (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");
const ESPN_MCP_URL = (process.env.ESPN_MCP_URL || "").replace(/\/+$/, "");
const CFBD_MCP_URL = (process.env.CFBD_MCP_URL || "").replace(/\/+$/, "");

const openai = new OpenAI({ // 🔧 ADDED
  apiKey: process.env.OPENAI_API_KEY
});

console.log("🔧 Configuration:");
console.log("  VIDEO_AGENT_URL:", VIDEO_AGENT_URL || "(not set)");
console.log("  ESPN_MCP_URL:", ESPN_MCP_URL || "(not set)");
console.log("  CFBD_MCP_URL:", CFBD_MCP_URL || "(not set)");
console.log("  MCP_API_KEY:", process.env.MCP_API_KEY ? "✅ Set" : "❌ Not set");

/* ------------------------------------------------------------------ */
/*                            LOAD TRIVIA                              */
/* ------------------------------------------------------------------ */

let TRIVIA = [];

try {
  const triviaPath = path.join(__dirname, "trivia.json");
  const raw = fs.readFileSync(triviaPath, "utf-8");
  TRIVIA = JSON.parse(raw);

  if (!Array.isArray(TRIVIA)) TRIVIA = [];

  console.log(`🧠 Loaded ${TRIVIA.length} trivia questions`);
} catch (err) {
  console.error("❌ Failed to load trivia.json", err?.message || err);
}

/* ------------------------------------------------------------------ */
/*                      SIMPLE SESSION MEMORY                          */
/* ------------------------------------------------------------------ */

const sessions = new Map();

/* ------------------------------------------------------------------ */
/*                         UTIL FUNCTIONS                              */
/* ------------------------------------------------------------------ */

function getText(body) {
  return (
    body?.message?.text ||
    body?.message ||
    body?.text ||
    body?.input ||
    ""
  )
    .toString()
    .trim();
}

/* ------------------------------------------------------------------ */
/*                           CHAT ROUTE                                */
/* ------------------------------------------------------------------ */

app.post("/chat", async (req, res) => {
  try {
    const sessionId = req.body?.sessionId || req.body?.session_id || "default";
    const rawText = getText(req.body);
    const text = rawText.toLowerCase();

    if (!rawText) {
      return res.json({ response: "Boomer Sooner! What can I help you with?" });
    }

    if (!sessions.has(sessionId)) sessions.set(sessionId, {});
    const session = sessions.get(sessionId);

    session.chat = session.chat || []; // 🔧 ADDED

    /* ---------- existing logic above remains untouched ---------- */

    if (isTriviaRequest(rawText)) {
      /* existing trivia logic */
    }

    if (isVideoRequest(rawText)) {
      /* existing video logic */
    }

    if (isESPNStatsRequest(rawText)) {
      /* existing stats logic */
    }

    if (isCFBDHistoryRequest(rawText)) {
      /* existing history logic */
    }

    /* -------------------------------------------------- */
    /* 🔧 OpenAI fallback chat (ADDED)                    */
    /* -------------------------------------------------- */

    session.chat.push({ role: "user", content: rawText });
    session.chat = session.chat.slice(-10);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Boomer Bot, the official AI assistant for Oklahoma Sooners fans. You are friendly, concise, knowledgeable, and enthusiastic. If the user asks about stats, history, trivia, or video, encourage them to ask directly so you can fetch it."
        },
        ...session.chat
      ]
    });

    const reply = completion.choices[0].message.content;
    session.chat.push({ role: "assistant", content: reply });

    return res.json({ response: reply });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({
      response: "Sorry Sooner — something went wrong on my end."
    });
  }
});

/* ------------------------------------------------------------------ */
/*                           START SERVER                              */
/* ------------------------------------------------------------------ */

console.log("🚪 Binding to PORT:", PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});



