import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

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
/*                         TOOL FUNCTIONS FOR LLM                      */
/* ------------------------------------------------------------------ */

async function getTriviaQuestion() {
  if (!TRIVIA.length) {
    return { error: "Trivia not loaded" };
  }
  
  const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
  const mcq = buildMCQ(q);
  
  if (!mcq.question || !mcq.options?.length || mcq.correctIndex < 0) {
    return { error: "Failed to generate trivia question" };
  }
  
  return {
    question: mcq.question,
    options: mcq.options.map((o, i) => `${["A", "B", "C", "D"][i]}. ${o}`),
    correctIndex: mcq.correctIndex,
    explanation: mcq.explanation
  };
}

async function searchVideos(query) {
  if (!VIDEO_AGENT_URL) {
    return { error: "Video service not configured" };
  }
  
  const refinedQuery = refineVideoQuery(query);
  const fetchUrl = `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3&ts=${Date.now()}`;
  
  try {
    const headers = {};
    if (process.env.VIDEO_AGENT_KEY) {
      headers["Authorization"] = `Bearer ${process.env.VIDEO_AGENT_KEY}`;
    }
    
    const r = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(7000) });
    
    if (!r.ok) {
      return { error: `Video service returned ${r.status}` };
    }
    
    const data = await r.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    
    return { videos: results };
  } catch (err) {
    return { error: err.message };
  }
}

async function getESPNStats(query) {
  if (!ESPN_MCP_URL) {
    return { error: "ESPN stats not configured" };
  }
  
  console.log(`\n📊 ESPN Stats Request: "${query}"`);
  console.log(`🔗 ESPN_MCP_URL: ${ESPN_MCP_URL}`);
  
  const lowerQuery = query.toLowerCase();
  
  let toolName = "get_score"; // default
  let args = { team: "Oklahoma", sport: "football" };
  
  // Detect sport
  let sport = "football";
  if (/basketball|hoops|bball/i.test(query)) {
    sport = /women|lady|ladies/i.test(query) ? "womens-basketball" : "mens-basketball";
  } else if (/baseball/i.test(query)) {
    sport = "baseball";
  } else if (/softball/i.test(query)) {
    sport = "softball";
  } else if (/volleyball|vball/i.test(query)) {
    sport = /women/i.test(query) ? "womens-volleyball" : "volleyball";
  } else if (/soccer/i.test(query)) {
    sport = /women/i.test(query) ? "womens-soccer" : "mens-soccer";
  } else if (/gymnastics/i.test(query)) {
    sport = "womens-gymnastics";
  } else if (/golf/i.test(query)) {
    sport = /women/i.test(query) ? "womens-golf" : "mens-golf";
  } else if (/tennis/i.test(query)) {
    sport = /women/i.test(query) ? "womens-tennis" : "mens-tennis";
  } else if (/wrestling/i.test(query)) {
    sport = "wrestling";
  }
  
  // Determine which ESPN tool to use
  if (/player stats|individual stats|who scored|leading scorer/i.test(query)) {
    toolName = "get_game_player_stats";
    // Need eventId - this is tricky, might need to get score first then get player stats
    // For now, return error suggesting they ask for score first
    return { error: "For player stats, please ask for the game score first, then I can get detailed player statistics." };
  }
  else if (/schedule|upcoming|next game|when does|when do/i.test(query)) {
    toolName = "get_schedule";
    args = { team: "Oklahoma", sport: sport };
  }
  else if (/ncaa rankings?|college rankings?|division rankings?/i.test(query)) {
    toolName = "get_ncaa_rankings";
    args = { sport: sport };
  }
  else if (/rankings?|poll|top 25|ap poll|coaches poll/i.test(query)) {
    toolName = "get_rankings";
    args = { sport: sport, poll: "ap" };
    if (/coaches/i.test(query)) args.poll = "coaches";
  }
  else if (/ncaa scoreboard|college scoreboard|all college games/i.test(query)) {
    toolName = "get_ncaa_scoreboard";
    args = { sport: sport };
  }
  else if (/scoreboard|all games|today'?s games|games today/i.test(query) && !/oklahoma|ou|sooners/i.test(query)) {
    toolName = "get_scoreboard";
    args = { sport: sport };
    // Add date if specified
    const dateMatch = query.match(/\d{8}/);
    if (dateMatch) args.date = dateMatch[0];
  }
  else {
    // Default to get_score for OU-specific queries
    toolName = "get_score";
    args = { team: "Oklahoma", sport: sport };
  }
  
  console.log(`🔧 Using ESPN tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(ESPN_MCP_URL, payload, 7000, "tools/call");
  
  console.log(`📊 ESPN Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ ESPN Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || "ESPN request failed";
    console.error(`❌ ESPN Error:`, errorMsg);
    return { error: errorMsg };
  }
}

async function getCFBDHistory(query) {
  if (!CFBD_MCP_URL) {
    return { error: "CFBD history not configured" };
  }
  
  // DEFENSIVE CHECK: Reject basketball queries
  if (/basketball|hoops|bball|court|sam godwin|jalon moore|javian mcollum/i.test(query)) {
    console.log(`⚠️ BASKETBALL query detected in football function, redirecting...`);
    return { error: "This appears to be a basketball query. Please use the basketball tool instead." };
  }
  
  console.log(`\n📚 CFBD History Request: "${query}"`);
  console.log(`🔗 CFBD_MCP_URL: ${CFBD_MCP_URL}`);
  
  const lowerQuery = query.toLowerCase();
  
  // Extract year from query if mentioned
  let year = null;
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/); // Matches 1900-2099
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    console.log(`📅 Extracted year from query: ${year}`);
  } else {
    year = new Date().getFullYear() - 1; // Default to last completed season
    console.log(`📅 Using default year: ${year}`);
  }
  
  let toolName = "get_team_records"; // default
  let args = { team: "Oklahoma" };
  
  // Game-by-game stats - CHECK FIRST before matchup check!
  if (/game[- ]?by[- ]?game|each game|every game/i.test(query) || 
      (/game stats/i.test(query) && /\bvs\.?\b|\bagainst\b/i.test(query))) {
    toolName = "get_game_stats";
    args = { team: "Oklahoma", year: year };
  }
  // Detect matchup queries (vs, against, etc.) - but NOT if asking for game stats
  else if (/\bvs\.?\b|\bagainst\b|\bversus\b|head[- ]?to[- ]?head/i.test(query)) {
    toolName = "get_team_matchup";
    // Extract opponent
    let opponent = query
      .toLowerCase()
      .replace(/\b(oklahoma|sooners|ou)\b/gi, "")
      .replace(/\b(vs\.?|against|versus|all[- ]time|record|history|head[- ]?to[- ]?head)\b/gi, "")
      .replace(/\b(football|basketball|game)\b/gi, "")
      .replace(/\b(19\d{2}|20\d{2})\b/gi, "") // Remove year
      .trim();
    
    // Common team name mappings
    if (/texas/i.test(opponent) && !/tech|state/i.test(opponent)) opponent = "Texas";
    else if (/nebraska/i.test(opponent)) opponent = "Nebraska";
    else if (/alabama|bama/i.test(opponent)) opponent = "Alabama";
    else if (/oklahoma state|osu|cowboys|pokes/i.test(opponent)) opponent = "Oklahoma State";
    else if (/kansas/i.test(opponent) && !/state/i.test(opponent)) opponent = "Kansas";
    else if (!opponent) opponent = "Texas"; // default if we can't parse
    
    args = {
      team1: "Oklahoma",
      team2: opponent,
      minYear: 1900
    };
  }
  // Play-by-play for specific game
  else if (/play[- ]?by[- ]?play|plays|scoring|drive/i.test(query)) {
    toolName = "get_play_by_play";
    return { error: "For play-by-play, please ask for the game score first, then I can get detailed play information." };
  }
  // Player stats - detect "player stats" OR "Name Name stats" patterns
  else if (
    /player stats|individual stats|who led|leading|top player/i.test(query) ||
    (/\b[A-Z][a-z]+\s+[A-Z][a-z]+.*stats/i.test(query) && !/team stats|season stats/i.test(query))
  ) {
    toolName = "get_player_stats";
    args = { team: "Oklahoma", year: year, query: query }; // Pass query so CFBD can extract player name
  }
  // Team season stats
  else if (/team stats|season stats|total yards|total touchdowns|offensive stats|defensive stats/i.test(query)) {
    toolName = "get_team_stats";
    args = { team: "Oklahoma", year: year };
  }
  // Conference standings
  else if (/standings?|conference|big 12|sec/i.test(query)) {
    toolName = "get_conference_standings";
    const conference = /sec/i.test(query) ? "SEC" : "Big 12";
    args = { conference: conference, year: year };
  }
  // Recruiting query
  else if (/recruit/i.test(query)) {
    toolName = "get_recruiting";
    args = { team: "Oklahoma", year: year };
  }
  // Talent/composite ranking
  else if (/talent|composite/i.test(query)) {
    toolName = "get_team_talent";
    args = { team: "Oklahoma", year: year };
  }
  // Rankings (AP, Coaches, CFP) - FIXED to use extracted year
  else if (/ranking|poll|ap|coaches|playoff ranking|final ranking/i.test(query)) {
    toolName = "get_team_rankings";
    args = { team: "Oklahoma", year: year };
  }
  // Schedule
  else if (/schedule|upcoming|next game|remaining games/i.test(query)) {
    toolName = "get_schedule";
    args = { team: "Oklahoma", year: year };
  }
  // Returning production
  else if (/returning|production|who'?s back|veterans/i.test(query)) {
    toolName = "get_returning_production";
    args = { team: "Oklahoma", year: year };
  }
  // Venue/stadium info
  else if (/stadium|venue|gaylord|memorial stadium|where do they play/i.test(query)) {
    toolName = "get_venue_info";
    args = { team: "Oklahoma" };
  }
  // Default to team records for general history
  else {
    toolName = "get_team_records";
    args = { team: "Oklahoma", startYear: 2020, endYear: year };
  }
  
  console.log(`🔧 Using CFBD tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(CFBD_MCP_URL, payload, 7000, "tools/call");
  
  console.log(`📊 CFBD Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ CFBD Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || "CFBD request failed";
    console.error(`❌ CFBD Error:`, errorMsg);
    return { error: errorMsg };
  }
}

async function getCFBDBasketball(query) {
  if (!CFBD_BASKETBALL_MCP_URL) {
    return { error: "CFBD Basketball not configured" };
  }
  
  console.log(`\n🏀 CFBD Basketball Request: "${query}"`);
  console.log(`🔗 CFBD_BASKETBALL_MCP_URL: ${CFBD_BASKETBALL_MCP_URL}`);
  
  const lowerQuery = query.toLowerCase();
  
  // Extract year from query if mentioned
  let year = null;
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    console.log(`📅 Extracted year from query: ${year}`);
  } else {
    year = new Date().getFullYear(); // Basketball season is current year
    console.log(`📅 Using default year: ${year}`);
  }
  
  let toolName = "get_basketball_score"; // default
  let args = { team: "Oklahoma", year: year };
  
  // Shooting stats - CHECK FIRST before player stats!
  if (/shooting|3pt|three point|fg%|field goal|free throw|ft%/i.test(query)) {
    toolName = "get_basketball_shooting_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  // Player stats - detect "player stats" OR "Name Name stats" patterns
  else if (
    /player stats|individual stats|who led|leading|top scorer/i.test(query) ||
    (/\b[A-Z][a-z]+\s+[A-Z][a-z]+.*stats/i.test(query) && !/team stats|season stats/i.test(query))
  ) {
    toolName = "get_basketball_player_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  // Team stats
  else if (/team stats|season stats/i.test(query)) {
    toolName = "get_basketball_team_stats";
    args = { team: "Oklahoma", year: year };
  }
  // Schedule
  else if (/schedule|upcoming|next game|remaining games/i.test(query)) {
    toolName = "get_basketball_schedule";
    args = { team: "Oklahoma", year: year };
  }
  // Rankings
  else if (/ranking|poll|ap|coaches/i.test(query)) {
    toolName = "get_basketball_rankings";
    args = { team: "Oklahoma", year: year };
  }
  // Shooting stats
  else if (/shooting|3pt|three point|fg%|field goal|free throw|ft%/i.test(query)) {
    toolName = "get_basketball_shooting_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  // Roster
  else if (/roster|players|team list/i.test(query)) {
    toolName = "get_basketball_roster";
    args = { team: "Oklahoma", year: year };
  }
  
  console.log(`🔧 Using Basketball tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(CFBD_BASKETBALL_MCP_URL, payload, 7000, "tools/call");
  
  console.log(`📊 Basketball Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ Basketball Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || "Basketball request failed";
    console.error(`❌ Basketball Error:`, errorMsg);
    return { error: errorMsg };
  }
}

/* ------------------------------------------------------------------ */
/*                      OPENAI FUNCTION TOOLS                         */
/* ------------------------------------------------------------------ */

const tools = [
  {
    type: "function",
    function: {
      name: "get_trivia_question",
      description: "Get a random OU Sooners trivia question with multiple choice answers. ONLY use when user explicitly asks for 'trivia', 'quiz', or 'test my knowledge'.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_videos",
      description: "Search for OU Sooners video highlights and game footage. ONLY use when user specifically asks for 'video', 'highlight', 'watch', 'clip', or 'show me' something visual.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query for videos (e.g., 'Baker Mayfield highlights', 'OU vs Alabama', 'softball championship')"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_espn_stats",
      description: "Get CURRENT/RECENT game scores, today's games, this week's schedule, and live stats from ESPN. Use for: current score, recent game, today's game, this week, latest game, schedule, current standings. DO NOT use for player season stats, all-time records, or historical matchups.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The stats query focused on recent/current games (e.g., 'OU basketball score today', 'football schedule this week')"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cfbd_basketball",
      description: "Get BASKETBALL data ONLY. Use for ANY and ALL basketball-related queries including: scores, player stats, team stats, schedule, rankings, shooting stats, roster. ALWAYS use this for basketball, hoops, or court-related questions. Keywords: 'basketball', 'hoops', 'bball', 'court', 'dunk', 'three-pointer', '3PT', 'roster' (if basketball context), 'sam godwin', 'jalon moore'. If the query mentions 'basketball' or basketball players, ALWAYS use this tool.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The basketball query (e.g., 'What was the OU basketball score?', 'Sam Godwin stats', 'OU basketball schedule', 'list basketball roster')"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cfbd_history",
      description: "Get FOOTBALL data ONLY. HISTORICAL football data, ALL-TIME football records, and FOOTBALL PLAYER SEASON STATISTICS. Use ONLY for FOOTBALL queries. Keywords: 'football', 'fb', 'gridiron', plus 'player stats', 'season stats', 'all-time', 'history', 'vs', 'against', 'series', 'bowl games', 'championships', 'final ranking', 'season ranking'. DO NOT use for basketball - use get_cfbd_basketball instead.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Pass the user's EXACT question without modification. Do not change years or rephrase. Example: if user asks '2024', pass '2024' exactly."
          }
        },
        required: ["query"]
      }
    }
  }
];

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
const CFBD_BASKETBALL_MCP_URL = (process.env.CFBD_BASKETBALL_MCP_URL || "").replace(/\/+$/, "");

const openai = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || "").trim().replace(/\s+/g, '')
});

console.log("🔧 Configuration:");
console.log("  VIDEO_AGENT_URL:", VIDEO_AGENT_URL || "(not set)");
console.log("  ESPN_MCP_URL:", ESPN_MCP_URL || "(not set)");
console.log("  CFBD_MCP_URL:", CFBD_MCP_URL || "(not set)");
console.log("  CFBD_BASKETBALL_MCP_URL:", CFBD_BASKETBALL_MCP_URL || "(not set)");
console.log("  MCP_API_KEY:", process.env.MCP_API_KEY ? "✅ Set" : "❌ Not set");
console.log("  OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Not set");

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

  // ALWAYS use wrongAnswers if they exist
  if (Array.isArray(q?.wrongAnswers) && q.wrongAnswers.length >= 3) {
    const wrongAnswers = q.wrongAnswers.slice(0, 3).map(a => sanitize(a));
    const options = shuffle([correct, ...wrongAnswers]);
    
    return {
      question: sanitize(q?.question),
      options,
      correctIndex: options.findIndex(o => normalizeAnswer(o) === correctNorm),
      explanation: sanitize(q?.explanation) || correct
    };
  }

  // Otherwise, generate wrong answers from other trivia questions
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
  return /(video|videos|highlight|highlights|clip|clips|replay|watch|vod|see this moment|see this|show this)/i.test(text);
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
  
  // Check for specific history patterns - prioritize vs/matchup queries
  if (/\bvs\.?\b|\bagainst\b|\bversus\b/i.test(text)) return true;
  
  return /\b(all[- ]time|historical|record in|season|since|bowl|championship|national title|conference title|series|head to head|coaches|heisman|recruiting|talent|matchup)\b/i.test(
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
/*                        TEXT-TO-SPEECH ENDPOINT                      */
/* ------------------------------------------------------------------ */

app.post("/tts", async (req, res) => {
  try {
    const text = req.body?.text;
    const voice = req.body?.voice || "onyx"; // Default to Onyx (sports announcer voice)

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    console.log(`🔊 TTS Request: "${text.substring(0, 50)}..." with voice: ${voice}`);

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length
    });

    res.send(buffer);
    console.log(`✅ TTS audio generated successfully`);

  } catch (err) {
    console.error("❌ TTS error:", err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});

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

    if (!rawText) {
      return res.json({ response: "Boomer Sooner! What can I help you with?" });
    }

    if (!sessions.has(sessionId)) sessions.set(sessionId, { chat: [] });
    const session = sessions.get(sessionId);

    // Handle trivia answers (A, B, C, D)
    if (session.active && isAnswerChoice(rawText.toLowerCase())) {
      const idx = { a: 0, b: 1, c: 2, d: 3 }[rawText.toLowerCase()];
      const isCorrect = idx === session.correctIndex;
      session.active = false;

      return res.json({
        response: isCorrect
          ? `✅ **Correct!** 🎉\n\n${session.explain}\n\nTry **trivia**, **video**, **stats**, or **history** — and don't forget to tune in to Boomer Bot Radio! 🎙️📻`
          : `❌ **Not quite!**\n\nCorrect answer: **${["A", "B", "C", "D"][session.correctIndex]}** - ${session.explain}\n\nTry **trivia**, **video**, **stats**, or **history** — and don't forget to tune in to Boomer Bot Radio! 🎙️📻`
      });
    }

    // Add user message to conversation history
    session.chat.push({ role: "user", content: rawText });
    session.chat = session.chat.slice(-10); // Keep last 10 messages

    // Call OpenAI with function calling
    const messages = [
      {
        role: "system",
        content: `You are Boomer Bot, the enthusiastic AI assistant for Oklahoma Sooners fans. You love OU sports and provide helpful, engaging responses.

IMPORTANT TOOL USAGE RULES:
- get_trivia_question: ONLY when user explicitly says "trivia", "quiz", or "test me"
- search_videos: ONLY when user asks for "video", "highlight", "watch", or "show me"
- get_espn_stats: For CURRENT/RECENT games (today, this week, latest score)
- get_cfbd_history: For FOOTBALL all-time records, historical matchups, "vs", series records, AND PLAYER SEASON STATS
- get_cfbd_basketball: For ANY BASKETBALL queries (scores, stats, schedule, rankings, roster)

When tools return errors, acknowledge the issue and provide what information you can from your general knowledge about OU sports.

Common queries:
- "what's the score?" → use get_espn_stats
- "OU vs Texas all-time" → use get_cfbd_history  
- "John Mateer stats 2025" → use get_cfbd_history (player season stats)
- "basketball score" → use get_cfbd_basketball
- "Sam Godwin stats" → use get_cfbd_basketball
- "OU hoops schedule" → use get_cfbd_basketball
- "history" (alone) → ask what kind of history they want
- "trivia" → use get_trivia_question
- "show me highlights" → use search_videos

Be conversational and enthusiastic. Use "Boomer Sooner!" appropriately.`
      },
      ...session.chat
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages,
      tools: tools,
      tool_choice: "auto"
    });

    let assistantMessage = response.choices[0].message;

    // Handle function calls
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      session.chat.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        console.log(`🔧 Calling function: ${functionName}`, functionArgs);

        let functionResult;

        switch (functionName) {
          case "get_trivia_question":
            functionResult = await getTriviaQuestion();
            // Store trivia state for answer checking
            if (!functionResult.error) {
              session.active = true;
              session.correctIndex = functionResult.correctIndex;
              session.explain = functionResult.explanation;
            }
            break;
          
          case "search_videos":
            console.log(`🎬 Video search for: "${functionArgs.query}"`);
            functionResult = await searchVideos(functionArgs.query);
            break;
          
          case "get_espn_stats":
            console.log(`📊 ESPN stats for: "${functionArgs.query}"`);
            functionResult = await getESPNStats(functionArgs.query);
            break;
          
          case "get_cfbd_history":
            console.log(`📚 CFBD history for: "${functionArgs.query}"`);
            functionResult = await getCFBDHistory(functionArgs.query);
            // If CFBD fails, add helpful error message
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing historical data right now. The CFBD service might be down or the query format needs adjustment.";
            }
            break;
          
          case "get_cfbd_basketball":
            console.log(`🏀 CFBD basketball for: "${functionArgs.query}"`);
            functionResult = await getCFBDBasketball(functionArgs.query);
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing basketball data right now. The basketball service might be down or the query format needs adjustment.";
            }
            break;
          
          default:
            functionResult = { error: "Unknown function" };
        }

        session.chat.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult)
        });
      }

      // Get next response from GPT with function results
      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: session.chat,
        tools: tools,
        tool_choice: "auto"
      });

      assistantMessage = response.choices[0].message;
    }

    // Add final assistant response to chat history
    session.chat.push(assistantMessage);

    return res.json({ response: assistantMessage.content });

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

