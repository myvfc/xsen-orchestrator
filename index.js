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
const PORT = Number(process.env.PORT || 8080);

const VIDEO_AGENT_URL =
  (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ==============================
   TRIVIA LOAD
============================== */
const TRIVIA_PATH = path.join(process.cwd(), "trivia.json");

let TRIVIA = [];
let ACTIVE_TRIVIA = null;

try {
  TRIVIA = JSON.parse(fs.readFileSync(TRIVIA_PATH, "utf8"));
  console.log(`🧠 Loaded ${TRIVIA.length} trivia questions`);
} catch (err) {
  console.error("❌ Trivia load failed:", err.message);
}

/* ==============================
   HELPERS
============================== */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function isTriviaRequest(text = "") {
  return /(trivia|quiz|question|test me)/i.test(text);
}

function isAnswer(text = "") {
  return /^[abcd1234]$/i.test(text.trim());
}

function isNarrativeQuestion(text = "") {
  return /(why|how|explain|tell me|legacy|impact)/i.test(text);
}

function refineVideoQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/\b(show me|watch|find|give me|please|can you)\b/gi, "")
    .replace(/\bou\b|\bsooners\b/gi, "oklahoma")
    .replace(/\bbama\b/gi, "alabama")
    .replace(/\bosu\b|\bpokes\b/gi, "oklahoma state")
    .replace(/\s+/g, " ")
    .trim();
}

function getRandomTrivia() {
  if (!TRIVIA.length) return null;
  return TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
}

/* ==============================
   OPENAI
============================== */
async function callOpenAI(text) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: text,
      temperature: 0.5,
      max_output_tokens: 300
    })
  });

  const data = await res.json();
  return data.output_text || "";
}

/* ==============================
   HEALTH
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    triviaLoaded: TRIVIA.length,
    uptime: process.uptime()
  });
});

/* ==============================
   CHAT ENDPOINT
============================== */
app.post("/chat", async (req, res) => {
  try {
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    if (!userText) {
      return res.json({ response: "Boomer Sooner! What can I help you with?" });
    }

    /* ==========================
       ANSWER MODE
    ========================== */
    if (isAnswer(userText) && ACTIVE_TRIVIA) {
      const map = { a: 0, b: 1, c: 2, d: 3, 1: 0, 2: 1, 3: 2, 4: 3 };
      const index = map[userText.toLowerCase()];

      const correctAnswer = ACTIVE_TRIVIA.answer;
      const chosen = ACTIVE_TRIVIA.choices[index];

      const correct = chosen === correctAnswer;

      ACTIVE_TRIVIA = null;

      return res.json({
        response: correct
          ? `✅ **Correct!**\n\n${correctAnswer}`
          : `❌ **Not quite**\n\nCorrect answer: **${correctAnswer}**`
      });
    }

    /* ==========================
       TRIVIA REQUEST
    ========================== */
    if (isTriviaRequest(userText)) {
      const q = getRandomTrivia();
      if (!q) return res.json({ response: "Trivia loading…" });

      // Normalize in case file is messy
      if (!Array.isArray(q.choices) || q.choices.length < 4) {
        q.choices = [
          q.answer,
          "None of the above",
          "Not sure",
          "All of the above"
        ];
      }

      ACTIVE_TRIVIA = q;

      const letters = ["A", "B", "C", "D"];
      const choices = q.choices
        .slice(0, 4)
        .map((c, i) => `${letters[i]}. ${c}`)
        .join("\n");

      return res.json({
        response:
`🧠 **OU Trivia**

❓ ${q.question}

${choices}

Reply with **A, B, C, or D**`
      });
    }

    /* ==========================
       VIDEO REQUEST
    ========================== */
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refined = refineVideoQuery(userText);
      const url = `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refined)}&limit=3`;

      const r = await fetch(url);
      const data = await r.json();
      const results = Array.isArray(data?.results) ? data.results : [];

      if (!results.length) {
        return res.json({
          response:
            "Boomer Sooner! Try:\n• Baker Mayfield highlights\n• OU vs Alabama\n• Oklahoma playoff highlights"
        });
      }

      let reply = "🎬 **Highlights**\n\n";
      results.forEach((v, i) => {
        reply += `${i + 1}. ${v.title}\n${v.url}\n\n`;
      });

      return res.json({ response: reply.trim() });
    }

    /* ==========================
       LLM
    ========================== */
    if (isNarrativeQuestion(userText) && OPENAI_API_KEY) {
      const out = await callOpenAI(userText);
      if (out) return res.json({ response: out });
    }

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
v
