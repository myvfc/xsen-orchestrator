import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
console.log("MCP KEY PRESENT:", !!process.env.MCP_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* ------------------------------------------------------------------ */
/*                             ENV URLS                                */
/* ------------------------------------------------------------------ */

const VIDEO_AGENT_URL = (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");
const ESPN_MCP_URL = (process.env.ESPN_MCP_URL || "").replace(/\/+$/, "");
const CFBD_MCP_URL = (process.env.CFBD_MCP_URL || "").replace(/\/+$/, "");

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

function shuffle(arr) {
  // Fisher-Yates (better than sort(() => Math.random() - 0.5))
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sanitize(s) {
  return (s ?? "").toString().trim();
}

function normalizeAnswer(s) {
  return sanitize(s).replace(/\s+/g, " ").toLowerCase();
}

/**
 * Build better MCQ options:
 * - prefer plausible answers (length similarity)
 * - avoid repeating the same 3 junk answers over and over
 * - guarantee 4 options when possible
 */
function buildMCQ(q) {
  const correct = sanitize(q?.answer);
  const correctNorm = normalizeAnswer(correct);

  // Filter to answers that look like real answers
  const allOtherAnswers = TRIVIA
    .map(t => sanitize(t?.answer))
    .filter(a => a && normalizeAnswer(a) !== correctNorm);

  // Plausibility filter
  const plausible = allOtherAnswers.filter(a => {
    const lenOK =
      a.length >= 3 &&
      Math.abs(a.length - correct.length) <= 18;
    const notSame = normalizeAnswer(a) !== correctNorm;
    return lenOK && notSame;
  });

  // Randomize pools
  const pool1 = shuffle(plausible);
  const pool2 = shuffle(allOtherAnswers);

  const wrong = [];
  const used = new Set([correctNorm]);

  function tryAddFrom(pool) {
    for (const a of pool) {
      const n = normalizeAnswer(a);
      if (!used.has(n)) {
        used.add(n);
        wrong.push(a);
      }
      if (wrong.length >= 3) break;
    }
  }

  // Prefer plausible wrong answers first, then fill from any other answers
  tryAddFrom(pool1);
  if (wrong.length < 3) tryAddFrom(pool2);

  const options = shuffle([correct, ...wrong]).slice(0, 4);

  return {
    question: sanitize(q?.question),
    options,
    correctIndex: options.findIndex(o => normalizeAnswer(o) === correctNorm),
    explanation: sanitize(q?.explanation) || correct
  };
}

/* ------------------------------------------------------------------ */
/*                         INTENT HELPERS                              */
/* ------------------------------------------------------------------ */

function isTriviaRequest(text = "") {
  return /\btrivia\b|\bquiz\b|\btest me\b|\bask me trivia\b/i.test(text);
}

function isAnswerChoice(text = "") {
  return /^[abcd]$/i.test(text.trim());
}

function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch|vod)/i.test(text);
}

function refineVideoQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/\b(show me|watch|give me|find|please|can you|i want to see|pull up)\b/gi, "")
    .replace(/\bou\b|\bsooners\b/gi, "oklahoma")
    .replace(/\bbama\b/gi, "alabama")
    .replace(/\bosu\b|\bcowboys\b|\bpokes\b/gi, "oklahoma state")
    .replace(/\s+/g, " ")
    .trim();
}

function isESPNStatsRequest(text = "") {
  // ESPN: live score/record/stats/today/game info
  return /\b(score|scores|record|standings|stats|stat line|yards|tds|touchdowns|who won|final|rankings|game|today|this week|schedule)\b/i.test(
    text
  );
}

function isCFBDHistoryRequest(text = "") {
  // CFBD: historical records/seasons/championships/all-time/bowls/series
  return /\b(all[- ]time|history|historical|record in|season|since|bowl|championship|national title|conference title|series|head to head|vs\.?|coaches|heisman)\b/i.test(
    text
  );
}

/* ------------------------------------------------------------------ */
/*                         SAFE FETCH HELPERS                          */
/* ------------------------------------------------------------------ */

async function fetchJson(url, payload, timeoutMs = 7000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();

    if (!r.ok) {
      return { ok: false, status: r.status, text };
    }

    if (contentType.includes("application/json")) {
      try {
        return { ok: true, json: JSON.parse(text) };
      } catch {
        return { ok: true, json: null, text };
      }
    }

    return { ok: true, json: null, text };
  } catch (e) {
    return { ok: false, status: 0, text: e?.message || String(e) };
  } finally {
    clearTimeout(t);
  }
}

function extractMcpText(data) {
  if (!data) return "";
  if (typeof data === "string") return data;

  // common patterns
  return (
    data.response ||
    data.reply ||
    data.output_text ||
    data.output ||
    data.result ||
    data.message ||
    (data.data && (data.data.response || data.data.reply || data.data.output)) ||
    ""
  ).toString();
}

/**
 * Call MCP server robustly:
 * - tries common endpoints
 * - sends multiple field names many servers expect
 */
async function callMcp(baseUrl, userText) {
  if (!baseUrl) return { ok: false, text: "MCP URL not set" };

  const paths = ["/query", "/chat", "/mcp", "/invoke", ""]; // most likely first
  const payloads = [
    { query: userText },
    { text: userText },
    { message: userText },
    { message: { text: userText } }
  ];

  for (const p of paths) {
    const url = (baseUrl + p).replace(/\/+$/, "") + (p === "" ? "" : "");
    for (const payload of payloads) {
      const resp = await fetchJson(url, payload);
      if (resp.ok) {
        const out = extractMcpText(resp.json) || resp.text || "";
        if (out.trim()) return { ok: true, text: out.trim(), urlTried: url };
        // If JSON but no obvious fields, stringify safely
        if (resp.json) return { ok: true, text: JSON.stringify(resp.json, null, 2), urlTried: url };
      }
    }
  }

  return { ok: false, text: "No valid response from MCP" };
}

/* ------------------------------------------------------------------ */
/*                              HEALTH                                 */
/* ------------------------------------------------------------------ */

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    triviaLoaded: TRIVIA.length,
    videoEnabled: Boolean(VIDEO_AGENT_URL),
    espnEnabled: Boolean(ESPN_MCP_URL),
    cfbdEnabled: Boolean(CFBD_MCP_URL)
  });
});

app.get("/health", (req, res) => res.status(200).send("OK"));

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

    /* ------------------ ANSWER MODE (TRIVIA) ------------------ */
    if (session.active && isAnswerChoice(text)) {
      const idx = { a: 0, b: 1, c: 2, d: 3 }[text];

      const isCorrect = idx === session.correctIndex;
      session.active = false;

      return res.json({
        response: isCorrect
          ? `✅ **Correct!** 🎉\n\n${session.explain}\n\nWant to:\n• watch a highlight\n• try another trivia question\n• learn why this mattered?\n\nType **trivia** to keep going or **video** to watch.`
          : `❌ **Not quite — good guess!**\n\nCorrect answer: **${["A", "B", "C", "D"][session.correctIndex]}**\n\n${session.explain}\n\nWant to:\n• see this moment\n• try another question\n• learn the story behind it?\n\nType **trivia** to keep going or **video** to watch.`
      });
    }

    /* ------------------ TRIVIA REQUEST ------------------ */
    if (isTriviaRequest(rawText)) {
      if (!TRIVIA.length) {
        return res.json({ response: "Trivia is warming up… (trivia.json not loaded)" });
      }

      const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
      const mcq = buildMCQ(q);

      // If buildMCQ failed to form 4 options for some reason
      if (!mcq.question || !mcq.options?.length || mcq.correctIndex < 0) {
        return res.json({ response: "Trivia hiccup — try **trivia** again!" });
      }

      session.active = true;
      session.correctIndex = mcq.correctIndex;
      session.explain = mcq.explanation;

      const optionsText = mcq.options
        .map((o, i) => `${["A", "B", "C", "D"][i]}. ${o}`)
        .join("\n");

      return res.json({
        response: `🧠 **OU Trivia**\n\n❓ ${mcq.question}\n\n${optionsText}\n\nReply with **A, B, C, or D**`
      });
    }

    /* ------------------ VIDEO (VOD) ------------------ */
    if (isVideoRequest(rawText)) {
      if (!VIDEO_AGENT_URL) {
        return res.json({
          response: "🎬 Video is not enabled yet (VIDEO_AGENT_URL not set)."
        });
      }

      const refinedQuery = refineVideoQuery(rawText);
      const fetchUrl = `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3&ts=${Date.now()}`;

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 7000);

      try {
        const r = await fetch(fetchUrl, { signal: controller.signal });
        if (!r.ok) {
          return res.json({
            response: "Sorry, Sooner — I had trouble reaching the video library."
          });
        }

        const data = await r.json();
        const results = Array.isArray(data?.results) ? data.results : [];

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
      } finally {
        clearTimeout(t);
      }
    }

    /* ------------------ ESPN MCP (STATS) ------------------ */
    if (isESPNStatsRequest(rawText)) {
      if (!ESPN_MCP_URL) {
        return res.json({ response: "📊 ESPN stats are not enabled yet (ESPN_MCP_URL not set)." });
      }

      const out = await callMcp(ESPN_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });

      console.error("❌ ESPN MCP failed:", out.text);
      return res.json({ response: "Sorry, Sooner — I couldn’t reach ESPN stats right now." });
    }

    /* ------------------ CFBD MCP (HISTORY/RECORDS) ------------------ */
    if (isCFBDHistoryRequest(rawText)) {
      if (!CFBD_MCP_URL) {
        return res.json({ response: "📚 CFBD history is not enabled yet (CFBD_MCP_URL not set)." });
      }

      const out = await callMcp(CFBD_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });

      console.error("❌ CFBD MCP failed:", out.text);
      return res.json({ response: "Sorry, Sooner — I couldn’t reach CFBD history right now." });
    }

    /* ------------------ DEFAULT ------------------ */
    return res.json({
      response: "Boomer Sooner! Ask for **trivia**, **video**, **score/stats**, or **history/records**."
    });

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});

