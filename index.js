import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import OpenAI from "openai";

console.log("MCP KEY PRESENT:", !!process.env.MCP_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.get("/", (req, res) => res.send("XSEN OK"));

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

const openai = new OpenAI({
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

// Check if request is for trivia
function isTriviaRequest(text) {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes("trivia") ||
    lowerText.includes("quiz") ||
    lowerText.includes("question") ||
    lowerText.includes("test my knowledge")
  );
}

// Check if request is for video
function isVideoRequest(text) {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes("video") ||
    lowerText.includes("highlight") ||
    lowerText.includes("clip") ||
    lowerText.includes("watch") ||
    lowerText.includes("show me")
  );
}

// Check if request is for ESPN stats
function isESPNStatsRequest(text) {
  const lowerText = text.toLowerCase();
  return (
    (lowerText.includes("stat") ||
     lowerText.includes("score") ||
     lowerText.includes("game") ||
     lowerText.includes("record")) &&
    !lowerText.includes("history") &&
    !lowerText.includes("all time")
  );
}

// Check if request is for CFBD historical data
function isCFBDHistoryRequest(text) {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes("history") ||
    lowerText.includes("all time") ||
    lowerText.includes("historical") ||
    lowerText.includes("past season") ||
    lowerText.includes("years ago")
  );
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

    session.chat = session.chat || [];

    /* -------------------------------------------------- */
    /* TRIVIA REQUEST                                     */
    /* -------------------------------------------------- */
    if (isTriviaRequest(rawText)) {
      if (TRIVIA.length === 0) {
        return res.json({
          response: "I'd love to quiz you, but my trivia database isn't loaded yet!"
        });
      }

      const randomTrivia = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
      session.lastTrivia = randomTrivia;

      return res.json({
        response: `🧠 Trivia Time!\n\n${randomTrivia.question}\n\nA) ${randomTrivia.options[0]}\nB) ${randomTrivia.options[1]}\nC) ${randomTrivia.options[2]}\nD) ${randomTrivia.options[3]}`
      });
    }

    // Check trivia answer
    if (session.lastTrivia && /^[abcd]$/i.test(text)) {
      const answer = text.toUpperCase();
      const correct = session.lastTrivia.answer;
      const isCorrect = answer === correct;

      session.lastTrivia = null;

      return res.json({
        response: isCorrect
          ? `✅ Correct! Boomer Sooner! 🎉`
          : `❌ Not quite. The correct answer was ${correct}. Better luck next time!`
      });
    }

    /* -------------------------------------------------- */
    /* VIDEO REQUEST                                      */
    /* -------------------------------------------------- */
    if (isVideoRequest(rawText)) {
      if (!VIDEO_AGENT_URL) {
        return res.json({
          response: "Video service isn't configured yet. Check back soon!"
        });
      }

      try {
        const videoResponse = await fetch(`${VIDEO_AGENT_URL}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: rawText })
        });

        const videoData = await videoResponse.json();

        if (videoData?.videos && videoData.videos.length > 0) {
          const video = videoData.videos[0];
          return res.json({
            response: `🎥 Found this for you:\n\n${video.title}\n${video.url}`
          });
        } else {
          return res.json({
            response: "I couldn't find any videos matching that. Try rephrasing your request!"
          });
        }
      } catch (err) {
        console.error("Video service error:", err);
        return res.json({
          response: "Having trouble connecting to the video service right now."
        });
      }
    }

    /* -------------------------------------------------- */
    /* ESPN STATS REQUEST                                 */
    /* -------------------------------------------------- */
    if (isESPNStatsRequest(rawText)) {
      if (!ESPN_MCP_URL || !process.env.MCP_API_KEY) {
        return res.json({
          response: "Stats service isn't configured yet. Check back soon!"
        });
      }

      try {
        const statsResponse = await fetch(`${ESPN_MCP_URL}/stats`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.MCP_API_KEY}`
          },
          body: JSON.stringify({ query: rawText })
        });

        const statsData = await statsResponse.json();

        if (statsData?.result) {
          return res.json({ response: statsData.result });
        } else {
          return res.json({
            response: "I couldn't find those stats. Try being more specific!"
          });
        }
      } catch (err) {
        console.error("ESPN stats error:", err);
        return res.json({
          response: "Having trouble fetching stats right now."
        });
      }
    }

    /* -------------------------------------------------- */
    /* CFBD HISTORY REQUEST                               */
    /* -------------------------------------------------- */
    if (isCFBDHistoryRequest(rawText)) {
      if (!CFBD_MCP_URL || !process.env.MCP_API_KEY) {
        return res.json({
          response: "Historical data service isn't configured yet. Check back soon!"
        });
      }

      try {
        const historyResponse = await fetch(`${CFBD_MCP_URL}/history`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.MCP_API_KEY}`
          },
          body: JSON.stringify({ query: rawText })
        });

        const historyData = await historyResponse.json();

        if (historyData?.result) {
          return res.json({ response: historyData.result });
        } else {
          return res.json({
            response: "I couldn't find that historical information. Try rephrasing!"
          });
        }
      } catch (err) {
        console.error("CFBD history error:", err);
        return res.json({
          response: "Having trouble fetching historical data right now."
        });
      }
    }

    /* -------------------------------------------------- */
    /* OPENAI FALLBACK CHAT                               */
    /* -------------------------------------------------- */

    session.chat.push({ role: "user", content: rawText });
    session.chat = session.chat.slice(-10);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are Boomer Bot, the official AI assistant for Oklahoma Sooners fans. You are friendly, concise, knowledgeable, and enthusiastic about Oklahoma Sooners football. If the user asks about stats, history, trivia, or video highlights, encourage them to ask directly so you can fetch it. Keep responses brief and engaging."
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
      response: "Sorry Sooner — something went wrong on my end. 🏈"
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
