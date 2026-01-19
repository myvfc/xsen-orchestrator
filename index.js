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

function buildMCQ(q) {
  const correct = sanitize(q?.answer);
  const correctNorm = normalizeAnswer(correct);

  const allOtherAnswers = TRIVIA
    .map(t => sanitize(t?.answer))
    .filter(a => a && normalizeAnswer(a) !== correctNorm);

  const plausible = allOtherAnswers.filter(a => {
    const lenOK =
      a.length >= 3 &&
      Math.abs(a.length - correct.length) <= 18;
    const notSame = normalizeAnswer(a) !== correctNorm;
    return lenOK && notSame;
  });

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
  return /\b(score|scores|record|standings|stats|stat line|yards|tds|touchdowns|who won|final|rankings|game|today|this week|schedule)\b/i.test(
    text
  );
}

function isCFBDHistoryRequest(text = "") {
  return /\b(all[- ]time|history|historical|record in|season|since|bowl|championship|national title|conference title|series|head to head|vs\.?|coaches|heisman)\b/i.test(
    text
  );
}

/* ------------------------------------------------------------------ */
/*                         SAFE FETCH HELPERS                          */
/* ------------------------------------------------------------------ */

async function fetchJson(url, payload, timeoutMs = 7000, method = "tools/call") {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { "Content-Type": "application/json" };
    
    if (process.env.MCP_API_KEY) {
      headers["Authorization"] = `Bearer ${process.env.MCP_API_KEY}`;
    }

    const jsonRpcPayload = {
      jsonrpc: "2.0",
      method: method,
      params: payload,
      id: Date.now()
    };

    const r = await fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(jsonRpcPayload),
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

  if (data.result) {
    const result = data.result;
    
    if (Array.isArray(result.content)) {
      return result.content
        .map(item => item.text || item.data || "")
        .filter(Boolean)
        .join("\n");
    }
    
    if (result.text) return result.text;
    if (typeof result === "string") return result;
  }

  return (
    data.response ||
    data.reply ||
    data.output_text ||
    data.output ||
    data.message ||
    (data.data && (data.data.response || data.data.reply || data.data.output)) ||
    ""
  ).toString();
}

async function getMcpTools(baseUrl) {
  if (!baseUrl) return [];
  
  const resp = await fetchJson(baseUrl, {}, 5000, "tools/list");
  if (resp.ok && resp.json?.result?.tools) {
    return resp.json.result.tools;
  }
  return [];
}

async function callMcp(baseUrl, userText) {
  if (!baseUrl) return { ok: false, text: "MCP URL not set" };

  const tools = await getMcpTools(baseUrl);
  
  let toolName = "query";
  if (tools.length > 0) {
    const toolNames = tools.map(t => t.name);
    toolName = toolNames.find(name => 
      /query|search|get|fetch|ask/i.test(name)
    ) || toolNames[0];
    
    console.log(`Using MCP tool: ${toolName} (available: ${toolNames.join(", ")})`);
  }

  const payloadVariations = [
    { name: toolName, arguments: { query: userText } },
    { name: toolName, arguments: { text: userText } },
    { name: toolName, arguments: { message: userText } },
    { name: toolName, arguments: { q: userText } },
    { name: toolName, arguments: { input: userText } }
  ];

  for (const payload of payloadVariations) {
    const resp = await fetchJson(baseUrl, payload, 7000, "tools/call");
    if (resp.ok) {
      const out = extractMcpText(resp.json) || resp.text || "";
      if (out.trim()) return { ok: true, text: out.trim() };
      
      if (resp.json) {
        const jsonStr = JSON.stringify(resp.json, null, 2);
        if (jsonStr.length > 20) return { ok: true, text: jsonStr };
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

    if (isTriviaRequest(rawText)) {
      if (!TRIVIA.length) {
        return res.json({ response: "Trivia is warming up… (trivia.json not loaded)" });
      }

      const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
      const mcq = buildMCQ(q);

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
        const headers = {};
        if (process.env.VIDEO_AGENT_KEY) {
          headers["Authorization"] = `Bearer ${process.env.VIDEO_AGENT_KEY}`;
        }

        const r = await fetch(fetchUrl, { 
          headers: headers,
          signal: controller.signal 
        });

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
              "Boomer Sooner! I couldn't find a match.\n\nTry:\n• Baker Mayfield highlights\n• OU vs Alabama\n• Oklahoma playoff highlights"
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

    if (isESPNStatsRequest(rawText)) {
      if (!ESPN_MCP_URL) {
        return res.json({ response: "📊 ESPN stats are not enabled yet (ESPN_MCP_URL not set)." });
      }

      const out = await callMcp(ESPN_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });

      console.error("❌ ESPN MCP failed:", out.text);
      return res.json({ response: "Sorry, Sooner — I couldn't reach ESPN stats right now." });
    }

    if (isCFBDHistoryRequest(rawText)) {
      if (!CFBD_MCP_URL) {
        return res.json({ response: "📚 CFBD history is not enabled yet (CFBD_MCP_URL not set)." });
      }

      const out = await callMcp(CFBD_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });

      console.error("❌ CFBD MCP failed:", out.text);
      return res.json({ response: "Sorry, Sooner — I couldn't reach CFBD history right now." });
    }

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
