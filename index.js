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

  console.log(🧠 Loaded ${TRIVIA.length} trivia questions);
} catch (err) {
  console.error("❌ Failed to load trivia.json", err?.message || err);
}

/* ------------------------------------------------------------------ */
/*                      SIMPLE SESSION MEMORY                          */
/* ------------------------------------------------------------------ */

const sessions = new Map();

/* 🔧 ADDED: session TTL cleanup (item 2) */
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - (s.lastSeen || now) > 15 * 60 * 1000) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

/* ------------------------------------------------------------------ */
/*                         UTIL FUNCTIONS                              */
/* ------------------------------------------------------------------ */

/* ... ALL YOUR UTIL FUNCTIONS UNCHANGED ... */

/* ------------------------------------------------------------------ */
/*                         MCP TOOL CACHE                              */
/* ------------------------------------------------------------------ */

/* 🔧 ADDED: MCP tool cache (item 3) */
const toolCache = new Map();

async function getCachedTools(baseUrl) {
  if (toolCache.has(baseUrl)) return toolCache.get(baseUrl);
  const tools = await getMcpTools(baseUrl);
  toolCache.set(baseUrl, tools);
  return tools;
}

/* ------------------------------------------------------------------ */
/*                         SAFE FETCH HELPERS                          */
/* ------------------------------------------------------------------ */

/* ... fetchJson, extractMcpText unchanged ... */

async function getMcpTools(baseUrl) {
  if (!baseUrl) {
    console.log("❌ getMcpTools: No baseUrl provided");
    return [];
  }

  console.log(🔍 Fetching tools from: ${baseUrl});
  const resp = await fetchJson(baseUrl, {}, 5000, "tools/list");

  if (resp.ok && resp.json?.result?.tools) {
    return resp.json.result.tools;
  }
  return [];
}

async function callMcp(baseUrl, userText) {
  if (!baseUrl) return { ok: false, text: "MCP URL not set" };

  /* 🔧 CHANGED: cached tools instead of direct call (item 3) */
  const tools = await getCachedTools(baseUrl);

  let toolName = "query";
  if (tools.length > 0) {
    const toolNames = tools.map(t => t.name);
    if (/score|game|final|result/i.test(userText)) {
      toolName = toolNames.find(name => name === "get_score") || toolName;
    }
    if (toolName === "query") {
      toolName = toolNames.find(name =>
        /query|search|get|fetch|ask/i.test(name)
      ) || toolNames[0];
    }
  }

  /* ... REST OF callMcp COMPLETELY UNCHANGED ... */
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

    /* 🔧 ADDED: session heartbeat (item 2) */
    session.lastSeen = Date.now();

    /* -------------------------------------------------- */
    /* 🔧 INTENT PRECEDENCE FIX (item 1)                  */
    /* -------------------------------------------------- */

    /* 1. trivia answer */
    if (session.active && isAnswerChoice(text)) {
      const idx = { a: 0, b: 1, c: 2, d: 3 }[text];
      const isCorrect = idx === session.correctIndex;
      session.active = false;

      return res.json({
        response: isCorrect
          ? ✅ **Correct!** 🎉\n\n${session.explain}\n\nType **trivia** or **video**
          : ❌ **Not quite!**\n\nCorrect answer: **${["A", "B", "C", "D"][session.correctIndex]}**\n\n${session.explain}\n\nType **trivia** or **video**
      });
    }

    /* 2. trivia request */
    if (isTriviaRequest(rawText)) {
      /* unchanged trivia logic */
      const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
      const mcq = buildMCQ(q);
      session.active = true;
      session.correctIndex = mcq.correctIndex;
      session.explain = mcq.explanation;
      const optionsText = mcq.options
        .map((o, i) => ${["A", "B", "C", "D"][i]}. ${o})
        .join("\n");
      return res.json({
        response: 🧠 **OU Trivia**\n\n❓ ${mcq.question}\n\n${optionsText}\n\nReply with **A, B, C, or D**
      });
    }

    /* 3. ESPN stats */
    if (isESPNStatsRequest(rawText)) {
      if (!ESPN_MCP_URL) {
        return res.json({ response: "📊 ESPN not enabled." });
      }
      const out = await callMcp(ESPN_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });
      return res.json({ response: "ESPN unavailable." });
    }

    /* 4. CFBD history */
    if (isCFBDHistoryRequest(rawText)) {
      if (!CFBD_MCP_URL) {
        return res.json({ response: "📚 CFBD not enabled." });
      }
      const out = await callMcp(CFBD_MCP_URL, rawText);
      if (out.ok) return res.json({ response: out.text });
      return res.json({ response: "CFBD unavailable." });
    }

    /* 5. video */
    if (isVideoRequest(rawText)) {
      /* unchanged video logic */
      const refinedQuery = refineVideoQuery(rawText);
      const fetchUrl = ${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3;
      const r = await fetch(fetchUrl);
      const data = await r.json();
      const results = data.results || [];
      let reply = "Boomer Sooner! Here are some highlights:\n\n";
      results.forEach((v, i) => {
        reply += 🎬 ${i + 1}. ${v.title}\n${v.url}\n\n;
      });
      return res.json({ response: reply.trim() });
    }

    /* fallback */
    return res.json({
      response: "Boomer Sooner! Ask for **trivia**, **video**, **score**, or **history**."
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({ response: "Sorry Sooner — something went wrong." });
  }
});

/* ------------------------------------------------------------------ */
/*                           START SERVER                              */
/* ------------------------------------------------------------------ */

app.listen(PORT, "0.0.0.0", () => {
  console.log(🚀 XSEN Orchestrator running on port ${PORT});
});
