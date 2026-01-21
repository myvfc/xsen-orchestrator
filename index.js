import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

console.log("MCP KEY PRESENT:", !!process.env.MCP_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

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

app.use(cors());
app.use(express.json());

/* ------------------------------------------------------------------ */
/*                           HEARTBEAT                                 */
/* ------------------------------------------------------------------ */

setInterval(() => {
  console.log("💓 XSEN heartbeat", new Date().toISOString());
}, 60_000);

const PORT = process.env.PORT || 3000;

console.log("🔍 Environment check:");
console.log("  PORT:", PORT);
console.log("  RAILWAY_ENVIRONMENT:", process.env.RAILWAY_ENVIRONMENT || "not set");
console.log("  NODE_ENV:", process.env.NODE_ENV || "not set");

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
  return /\b(score|scores|record|standings|stats|stat line|yards|tds|touchdowns|who won|final|rankings|game|games|today|this week|last week|schedule|recent|latest)\b/i.test(
    text
  );
}

function isCFBDHistoryRequest(text = "") {
  const lowerText = text.toLowerCase().trim();
  
  // If the ENTIRE query is just "history", treat it as a history request
  if (lowerText === "history") return true;
  
  return /\b(all[- ]time|historical|record in|season|since|bowl|championship|national title|conference title|series|head to head|vs\.?|coaches|heisman|recruiting|talent|matchup)\b/i.test(
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
    // Ensure URL ends with /mcp for MCP servers
    if (!url.endsWith('/mcp')) {
      url = url.replace(/\/$/, '') + '/mcp';
    }

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
  if (!baseUrl) {
    console.log("❌ getMcpTools: No baseUrl provided");
    return [];
  }
  
  console.log(`🔍 Fetching tools from: ${baseUrl}`);
  const resp = await fetchJson(baseUrl, {}, 5000, "tools/list");
  
  console.log(`📥 tools/list response - ok: ${resp.ok}, status: ${resp.status}`);
  
  if (resp.json) {
    console.log(`📦 tools/list JSON:`, JSON.stringify(resp.json, null, 2));
  } else {
    console.log(`📝 tools/list text:`, resp.text?.substring(0, 200));
  }
  
  if (resp.ok && resp.json?.result?.tools) {
    const tools = resp.json.result.tools;
    console.log(`✅ Found ${tools.length} tools:`, tools.map(t => t.name).join(", "));
    return tools;
  }
  
  console.log(`⚠️ No tools found in response`);
  return [];
}

async function callMcp(baseUrl, userText) {
  if (!baseUrl) return { ok: false, text: "MCP URL not set" };

  const tools = await getMcpTools(baseUrl);
  
  let toolName = "query";
  if (tools.length > 0) {
    const toolNames = tools.map(t => t.name);
    
    // For score queries, prefer get_score tool
    if (/score|game|final|result/i.test(userText)) {
      toolName = toolNames.find(name => name === "get_score") || toolName;
    }
    
    // For CFBD history queries, use appropriate tool
    if (baseUrl.includes("cfbd")) {
      const lowerText = userText.toLowerCase();
      
      if (lowerText === "history" || /what happened|tell me about|recent history/i.test(userText)) {
        // Generic history - use team records
        toolName = toolNames.find(name => name === "get_team_records") || toolName;
      } else if (/matchup|vs\.?|head to head|against/i.test(userText)) {
        toolName = toolNames.find(name => name === "get_team_matchup") || toolName;
      } else if (/recruiting|recruit/i.test(userText)) {
        toolName = toolNames.find(name => name === "get_recruiting") || toolName;
      } else if (/talent|composite/i.test(userText)) {
        toolName = toolNames.find(name => name === "get_team_talent") || toolName;
      } else if (/ranking|rank/i.test(userText)) {
        toolName = toolNames.find(name => name === "get_team_rankings") || toolName;
      } else {
        toolName = toolNames.find(name => name === "get_team_records") || toolName;
      }
    }
    
    // Otherwise look for general query tools
    if (toolName === "query") {
      toolName = toolNames.find(name => 
        /query|search|get|fetch|ask/i.test(name)
      ) || toolNames[0];
    }
    
    console.log(`✅ Using MCP tool: ${toolName} (available: ${toolNames.join(", ")})`);
  } else {
    console.log(`⚠️ No tools found, using default: ${toolName}`);
  }

  // Extract team name and detect sport
  let teamName = userText;
  let sport = null;
  
  if (toolName === "get_score") {
    // Detect gender-specific queries
    const isMens = /\bmen'?s\b|\bmale\b/i.test(userText);
    const isWomens = /\bwomen'?s\b|\bfemale\b|\blady\b|\bladies\b/i.test(userText);
    
    // Extract team name - look for common patterns
    teamName = userText
      .toLowerCase()
      .replace(/\b(score|game|final|result|what's|whats|get|show|tell me)\b/gi, "")
      .replace(/\b(men'?s|women'?s|male|female|lady|ladies)\b/gi, "")
      .replace(/\bou\b/gi, "oklahoma")
      .replace(/\bsooners\b/gi, "oklahoma")
      .trim();
    
    // Detect sport from query
    if (/basketball|hoops|bball/i.test(userText)) {
      sport = "basketball";
      // ESPN typically uses "mens-basketball" and "womens-basketball"
      if (isMens) sport = "mens-basketball";
      if (isWomens) sport = "womens-basketball";
    } else if (/baseball/i.test(userText)) {
      sport = "baseball";
    } else if (/softball/i.test(userText)) {
      sport = "softball";
    } else if (/volleyball|vball/i.test(userText)) {
      sport = "volleyball";
      if (isMens) sport = "mens-volleyball";
      if (isWomens) sport = "womens-volleyball";
    } else if (/football|fb/i.test(userText)) {
      sport = "football";
    } else if (/soccer/i.test(userText)) {
      sport = "soccer";
      if (isMens) sport = "mens-soccer";
      if (isWomens) sport = "womens-soccer";
    } else if (/golf/i.test(userText)) {
      sport = "golf";
      if (isMens) sport = "mens-golf";
      if (isWomens) sport = "womens-golf";
    } else if (/gymnastics/i.test(userText)) {
      sport = "gymnastics";
      if (isMens) sport = "mens-gymnastics";
      if (isWomens) sport = "womens-gymnastics";
    } else if (/wrestling/i.test(userText)) {
      sport = "wrestling";
    } else if (/tennis/i.test(userText)) {
      sport = "tennis";
      if (isMens) sport = "mens-tennis";
      if (isWomens) sport = "womens-tennis";
    } else if (/track|cross country/i.test(userText)) {
      sport = "track";
      if (isMens) sport = "mens-track";
      if (isWomens) sport = "womens-track";
    }
    // If no sport specified, try multiple sports
  }

  const payloadVariations = [];
  
  // For get_score, try multiple sports if not specified
  if (toolName === "get_score") {
    if (sport) {
      // Specific sport requested - try multiple team name variations
      const teamVariations = [teamName, "Oklahoma Sooners", "Oklahoma", "OU"];
      teamVariations.forEach(team => {
        payloadVariations.push({ name: toolName, arguments: { team: team, sport: sport } });
        // Also try without the "mens-" or "womens-" prefix
        if (sport.includes("-")) {
          const baseSport = sport.split("-")[1];
          payloadVariations.push({ name: toolName, arguments: { team: team, sport: baseSport } });
        }
      });
    } else {
      // Try all major OU sports with different team name formats
      const teamVariations = ["Oklahoma", "Oklahoma Sooners", "OU"];
      const sports = [
        "mens-basketball", "basketball",
        "womens-basketball", 
        "football",
        "baseball", "softball",
        "mens-soccer", "soccer",
        "womens-soccer",
        "womens-volleyball", "volleyball",
        "mens-golf", "golf",
        "womens-golf",
        "womens-gymnastics", "gymnastics",
        "wrestling",
        "mens-tennis", "tennis",
        "womens-tennis"
      ];
      
      // Try Oklahoma first, then other variations
      teamVariations.forEach(team => {
        sports.forEach(s => {
          payloadVariations.push({ name: toolName, arguments: { team: team, sport: s } });
        });
      });
    }
  }
  
  // For CFBD history tools, use Oklahoma as default team
  if (baseUrl.includes("cfbd")) {
    const teamVariations = ["Oklahoma", "oklahoma", "Oklahoma Sooners", "OU"];
    
    if (toolName === "get_team_records") {
      teamVariations.forEach(team => {
        payloadVariations.push({ 
          name: toolName, 
          arguments: { team: team, startYear: 2020, endYear: 2024 } 
        });
        payloadVariations.push({ 
          name: toolName, 
          arguments: { team: team } 
        });
      });
    } else if (toolName === "get_team_matchup") {
      // Extract opponent from query
      const opponent = userText
        .toLowerCase()
        .replace(/\b(oklahoma|sooners|ou)\b/gi, "")
        .replace(/\b(vs\.?|against|versus|head to head)\b/gi, "")
        .trim();
      
      if (opponent) {
        teamVariations.forEach(team => {
          payloadVariations.push({ 
            name: toolName, 
            arguments: { team1: team, team2: opponent, minYear: 2000 } 
          });
        });
      }
    } else if (toolName === "get_team_rankings") {
      teamVariations.forEach(team => {
        payloadVariations.push({ 
          name: toolName, 
          arguments: { team: team, year: 2024 } 
        });
        payloadVariations.push({ 
          name: toolName, 
          arguments: { team: team } 
        });
      });
    } else if (toolName === "get_recruiting" || toolName === "get_team_talent") {
      teamVariations.forEach(team => {
        payloadVariations.push({ 
          name: toolName, 
          arguments: { team: team } 
        });
      });
    }
  }
  
  // Fallback variations for other tools
  payloadVariations.push(
    { name: toolName, arguments: { team: teamName } },
    { name: toolName, arguments: { query: userText } },
    { name: toolName, arguments: { text: userText } },
    { name: toolName, arguments: { message: userText } },
    { name: toolName, arguments: { q: userText } },
    { name: toolName, arguments: { input: userText } }
  );

  for (let i = 0; i < payloadVariations.length; i++) {
    const payload = payloadVariations[i];
    console.log(`🔄 Trying payload variation ${i + 1}/${payloadVariations.length}:`, JSON.stringify(payload));
    
    const resp = await fetchJson(baseUrl, payload, 7000, "tools/call");
    
    console.log(`📥 Response ok: ${resp.ok}, status: ${resp.status}`);
    
    if (resp.ok && !resp.json?.error) {
      const out = extractMcpText(resp.json) || resp.text || "";
      
      // Check if this is a "no game found" message
      if (out.includes("No recent game found")) {
        console.log(`⚠️ No game found, trying next variation...`);
        continue; // Try next variation
      }
      
      if (out.trim()) {
        console.log(`✅ Found game! Response:`, out.substring(0, 200));
        return { ok: true, text: out.trim() };
      }
      
      if (resp.json) {
        const jsonStr = JSON.stringify(resp.json, null, 2);
        if (jsonStr.length > 20 && !jsonStr.includes("No recent game found")) {
          console.log(`✅ Returning JSON string`);
          return { ok: true, text: jsonStr };
        }
      }
    }
  }

  console.log(`❌ All payload variations failed`);
  return { ok: false, text: "No valid response from MCP" };
}

/* ------------------------------------------------------------------ */
/*                              HEALTH                                 */
/* ------------------------------------------------------------------ */

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

      console.log(`\n🏈 ESPN Stats Request: "${rawText}"`);
      console.log(`🔗 ESPN_MCP_URL: ${ESPN_MCP_URL}`);
      
      const out = await callMcp(ESPN_MCP_URL, rawText);
      
      console.log(`📊 ESPN Result - ok: ${out.ok}, text length: ${out.text?.length || 0}`);
      
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
      response: "Boomer Sooner! I can help you with:\n\n🎬 **Videos** - \"show me Baker Mayfield highlights\"\n📊 **Scores/Stats** - \"what's the OU score?\" or \"recent games\"\n📚 **History** - \"OU all-time record\" or \"history\"\n🧠 **Trivia** - \"trivia\" for a fun question\n\nWhat would you like to know?"
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

console.log("🚪 Binding to PORT:", PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
