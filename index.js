import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();

/* ==============================
   MIDDLEWARE
============================== */
app.use(cors({ origin: "*" }));
app.use(express.json());

/* ==============================
   CONFIG
============================== */
const PORT = Number(process.env.PORT);
if (!PORT) {
  console.error("❌ Missing process.env.PORT");
  process.exit(1);
}

const VIDEO_AGENT_URL =
  (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ==============================
   TRIVIA LOAD (PHASE 1)
============================== */
const TRIVIA_PATH = path.join(process.cwd(), "trivia.json");
let TRIVIA = [];

try {
  TRIVIA = JSON.parse(fs.readFileSync(TRIVIA_PATH, "utf8"));
  console.log(`🧠 Loaded ${TRIVIA.length} trivia questions`);
} catch (err) {
  console.error("❌ Trivia load failed:", err.message);
}

/* ==============================
   INTENT HELPERS
============================== */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function isTriviaRequest(text = "") {
  return /(trivia|quiz|question|test me|ask me trivia)/i.test(text);
}

function isNarrativeQuestion(text = "") {
  return [
    /\bwhy\b/i,
    /\bhow\b/i,
    /\bwhat made\b/i,
    /\btell me about\b/i,
    /\bexplain\b/i,
    /\blegacy\b/i,
    /\bimpact\b/i
  ].some(p => p.test(text));
}

function isPrecisionRequest(text = "") {
  return /(exact|exactly|how many|yards|tds|points|score|record|date|year|stats)/i.test(text);
}

/* ==============================
   TRIVIA HELPERS
============================== */
function getRandomTrivia() {
  if (!TRIVIA.length) return null;
  return TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
}

/**
 * 🔑 Preserve query meaning
 */
function refineVideoQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/\b(show me|watch|give me|find|please|can you|i want to see)\b/gi, "")
    .replace(/\bou\b|\bsooners\b/gi, "oklahoma")
    .replace(/\bbama\b/gi, "alabama")
    .replace(/\bosu\b|\bcowboys\b|\bpokes\b/gi, "oklahoma state")
    .replace(/\s+/g, " ")
    .trim();
}

/* ==============================
   OPENAI CALL (RESPONSES API)
============================== */
async function callOpenAI(userText) {
  if (!OPENAI_API_KEY || typeof OPENAI_API_KEY !== "string") {
    throw new Error("OPENAI_API_KEY missing or invalid");
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY.trim()}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      max_output_tokens: 300,
      input: userText
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("❌ OpenAI error:", errText);
    throw new Error(`OpenAI API error ${res.status}`);
  }

  const data = await res.json();
  return data.output_text || "";
}

/* ==============================
   HEALTHCHECKS
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    videoEndpoint: VIDEO_AGENT_URL || "NOT SET",
    llmEnabled: Boolean(OPENAI_API_KEY),
    triviaLoaded: TRIVIA.length
  });
});

app.get("/health", (req, res) => res.status(200).send("OK"));

/* ==============================
   MAIN CHAT ENDPOINT
============================== */
app.post("/chat", async (req, res) => {
  try {
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    if (!userText) {
      return res.json({
        response: "Boomer Sooner! What can I help you with?"
      });
    }

    /* 🧩 TRIVIA ROUTE (PHASE 1) */
    if (isTriviaRequest(userText)) {
      const q = getRandomTrivia();

      if (!q) {
        return res.json({
          response: "Trivia is warming up — try again in a moment!"
        });
      }

      return res.json({
        response:
`🧠 **OU Trivia**

❓ ${q.question}

_(Ask “answer” to reveal)_`
      });
    }

    /* 🎬 VIDEO ROUTE */
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);

      const fetchUrl =
        `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3&ts=${Date.now()}`;

      console.log("🎬 VIDEO SEARCH", {
        originalUserText: userText,
        refinedQuery,
        fetchUrl
      });

      const videoResp = await fetch(fetchUrl);
      if (!videoResp.ok) {
        return res.json({
          response: "Sorry, Sooner — I had trouble reaching the video library."
        });
      }

      const videoData = await videoResp.json();
      const results = Array.isArray(videoData?.results)
        ? videoData.results
        : [];

      if (!results.length) {
        return res.json({
          response:
            "Boomer Sooner! I couldn’t find a match.\n\nTry:\n• Baker Mayfield highlights\n• OU vs Alabama\n• Oklahoma playoff highlights"
        });
      }

      let reply = "Boomer Sooner! Here are some highlights:\n\n";
      results.forEach((v, i) => {
        reply += `🎬 ${i + 1}. ${v.title}\n${v.url}\n\n`;
      });

      return res.json({ response: reply.trim() });
    }

    /* 🔒 PRECISION BLOCK */
    if (isPrecisionRequest(userText)) {
      return res.json({
        response:
          "I don’t want to guess on exact numbers. Want highlights or context instead?"
      });
    }

    /* 🧠 OPENAI (GATED) */
    if (isNarrativeQuestion(userText) && OPENAI_API_KEY) {
      console.log("🧠 Calling OpenAI for:", userText);
      const llmReply = await callOpenAI(userText);
      if (llmReply) {
        return res.json({ response: llmReply.trim() });
      }
    }

    /* FALLBACK */
    return res.json({
      response: "Want highlights, trivia, history, or why a moment mattered?"
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({
      response: "Sorry, Sooner — something went wrong on my end."
    });
  }
});

/* ==============================
   START SERVER
============================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});

