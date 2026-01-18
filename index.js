import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

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
    .trim()
    .toLowerCase();
}

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

function buildMCQ(q) {
  const wrong = shuffle(
    TRIVIA.filter(t => t.answer !== q.answer)
      .slice(0, 3)
      .map(t => t.answer)
  );

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

app.post("/chat", (req, res) => {
  try {
    const sessionId = req.body?.sessionId || "default";
    const text = getText(req.body);

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
        reply: isCorrect
          ? `✅ **Correct!**\n\n${session.explain}\n\nType **trivia** for another.`
          : `❌ **Not quite.**\n\nCorrect answer: **${
              ["A", "B", "C", "D"][session.correct]
            }**\n\n${session.explain}\n\nType **trivia** to try again.`
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
        reply:
          `🧠 **OU Trivia**\n\n❓ ${mcq.question}\n\n` +
          mcq.options
            .map((o, i) => `${["A", "B", "C", "D"][i]}. ${o}`)
            .join("\n") +
          `\n\nReply with **A, B, C, or D**`
      });
    }

    /* ------------------ DEFAULT ------------------ */
    return res.json({
      reply: "Boomer Sooner! Ask me for trivia, highlights, or history."
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    res.json({ reply: "Sorry Sooner — something went wrong on my end." });
  }
});

/* ------------------------------------------------------------------ */
/*                           START SERVER                              */
/* ------------------------------------------------------------------ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
