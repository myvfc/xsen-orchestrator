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
   INTENT HELPERS
============================== */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function isTriviaRequest(text = "") {
  return /(trivia|quiz|question|test me|ask me trivia)/i.test(text);
}

function isAnswer(text = "") {
  return /^[abcd1234]$/i.test(text.trim());
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

/* ==============================
   VIDEO QUERY NORMALIZER
============================== */
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
   OPENAI CALL
============================== */
async function callOpenAI(userText) {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

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

  const data = await res.json();
  return data.output_text || "";
}

/* ==============================
   HEALTH
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
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
       ANSWER MODE (MCQ)
    ========================== */
    if (isAnswer(userText) && ACTIVE_TRIVIA) {
      const map = { a:0, b:1, c:2, d:3, 1:0, 2:1, 3:2, 4:3 };
      const index = map[userText.toLowerCase()];
      const chosen = ACTIVE_TRIVIA.choices[index];

      const correct = chosen === ACTIVE_TRIVIA.answer;

      const reply = correct
        ? `✅ **Correct!**\n\n${ACTIVE_TRIVIA.explanation || ""}`
        : `❌ **Not quite.**\n\nCorrect answer: **${ACTIVE_TRIVIA.answer}**\n${ACTIVE_TRIVIA.explanation || ""}`;

      ACTIVE_TRIVIA = null;

      return res.json({ response: reply });
    }

    /* ==========================
       TRIVIA REQUEST
    ========================== */
    if (isTriviaRequest(userText)) {
      const q = getRandomTrivia();
      if (!q) return res.json({ response: "Trivia is warming up…" });

      ACTIVE_TRIVIA = q;

      const letters = ["A", "B", "C", "D"];
      const choices = q.choices
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
      const refinedQuery = refineVideoQuery(userText);
      const fetchUrl =
        `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3&ts=${Date.now()}`;

      const videoResp = await fetch(fetchUrl);
      const videoData = await videoResp.json();

      const results = Array.isArray(videoData?.results)
        ? videoData.results
        : [];

      if (!results.length) {
        return res.json({
          response:
            "Boomer Sooner! Try:\n• Baker Mayfield highlights
