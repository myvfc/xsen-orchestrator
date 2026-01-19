import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const VIDEO_AGENT_URL =
  (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");

/* ------------------------------------------------------------------ */
/*                            LOAD TRIVIA                              */
/* ------------------------------------------------------------------ */

let TRIVIA = [];

try {
  const triviaPath = path.join(__dirname, "trivia.json");
  const raw = fs.readFileSync(triviaPath, "utf-8");
  TRIVIA = JSON.parse(raw);
  console.log(`🧠 Loaded ${TRIVIA.length} trivia questions`);
} catch (err) {
  console.error("❌ Failed to load trivia.json", err);
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

function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

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

function isVideoRequest(text) {
  return /(video|highlight|highlights|watch|clip|replay)/i.test(text);
}

function buildMCQ(q) {
  const pool = TRIVIA.filter(
    t =>
      t.answer !== q.answer &&
      t.answer.length > 3 &&
      Math.abs(t.answer.length - q.answer.length) < 15
  );

  const wrong = [];
  const used = new Set();

  while (wrong.length < 3 && pool.length > 0) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (!used.has(pick.answer)) {
      used.add(pick.answer);
      wrong.push(pick.answer);
    }
  }

  const options = shuffle([q.answer, ...wrong]);

  return {
    question: q.question,
    options,
    correct: options.indexOf(q.answer)
  };
}

/* ------------------------------------------------------------------ */
/*                           CHAT ROUTE                                */
/* ------------------------------------------------------------------ */

app.post("/chat", async (req, res) => {
  try {
    const sessionId = req.body?.sessionId || "default";
    const text = getText(req.body).toLowerCase();

    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {});
    }

    const session = sessions.get(sessionId);

    /* ------------------ ANSWER MODE ------------------ */
    if (session.active && ["a", "b", "c", "d"].includes(text)) {
      const idx = { a: 0, b: 1, c: 2, d: 3 }[text];
      const isCorrect = idx === session.correct;
      session.active = false;

      return res.json({
        response: isCorrect
          ? `✅ **Correct!** 🎉

${session.explain}

Want to:
• watch a highlight
• try another trivia question
• learn why this mattered?

Type **trivia** or **video**`
          : `❌ **Not quite — good guess!**

Correct answer: **${["A", "B", "C", "D"][session.correct]}**

${session.explain}

Want to:
• see this moment
• try another question
• learn the story behind it?

Type **trivia** or **video**`
      });
    }

    /* ------------------ TRIVIA REQUEST ------------------ */
    if (text.includes("trivia")) {
      const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
      const mcq = buildMCQ(q);

      session.active = true;
      session.correct = mcq.correct;
      session.explain = q.explanation || q.answer;

      return res.json({
        response:
          `🧠 **OU Trivia**\n\n❓ ${mcq.question}\n\n` +
          mcq.options
            .map((o, i) => `${["A", "B", "C", "D"][i]}. ${o}`)
            .join("\n") +
          `\n\nReply with **A, B, C, or D**`
      });
    }

    /* ------------------ VIDEO REQUEST ------------------ */
    if (isVideoRequest(text) && VIDEO_AGENT_URL) {
      const refined = refineVideoQuery(text);
      const fetchUrl = `${VIDEO_AGENT_URL}?query=${encodeURIComponent(
        refined
      )}&limit=3&ts=${Date.now()}`;

      const resp = await fetch(fetchUrl);
      const data = await resp.json();
      const results = Array.isArray(data?.results) ? data.results : [];

      if (!results.length) {
        return res.json({
          response:
            "Boomer Sooner! I couldn’t find a highlight.\n\nTry:\n• Baker Mayfield highlights\n• OU vs Alabama\n• Oklahoma playoff highlights"
        });
      }

      let reply = "🎬 **Sooner Highlights**\n\n";
      results.forEach((v, i) => {
        reply += `${i + 1}. ${v.title}\n${v.url}\n\n`;
      });

      return res.json({ response: reply.trim() });
    }

    /* ------------------ DEFAULT ------------------ */
    return res.json({
      response:
        "Boomer Sooner! Ask me for **trivia**, **video highlights**, or history."
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    res.json({ response: "Sorry Sooner — something went wrong on my end." });
  }
});

/* ------------------------------------------------------------------ */
/*                           START SERVER                              */
/* ------------------------------------------------------------------ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
