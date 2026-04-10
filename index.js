import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import { detectSchool, parseSport, parseToolName, fetchSchoolData, getAllSchools } from "./schools.js";

console.log("MCP KEY PRESENT:", !!process.env.MCP_API_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── CORS MUST BE FIRST ───────────────────────────────
app.use(cors({
  origin: /^https:\/\/(.*\.)?xsen\.fun$/,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false
}));

app.options("*", cors());
app.use(express.json());

// ─── ROUTES COME AFTER ────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    triviaLoaded: TRIVIA.length,
    videoEnabled: Boolean(VIDEO_AGENT_URL),
    espnEnabled: Boolean(ESPN_MCP_URL),
    cfbdEnabled: Boolean(CFBD_MCP_URL),
    ncaaWomensEnabled: Boolean(NCAA_WOMENS_MCP_URL),
    gymnasticsEnabled: Boolean(GYMNASTICS_MCP_URL)
  });
});

/* ------------------------------------------------------------------ */
/*                         TOOL FUNCTIONS FOR LLM                      */
/* ------------------------------------------------------------------ */

async function getTriviaQuestion(schoolId) {
  const TRIVIA = loadTrivia(schoolId || 'sooners');
  if (!TRIVIA.length) {
    return { error: "Trivia not loaded" };
  }
  
  const q = TRIVIA[Math.floor(Math.random() * TRIVIA.length)];
  const mcq = buildMCQ(q, TRIVIA);
  
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

async function searchVideos(query, schoolId) {
  if (!VIDEO_AGENT_URL) {
    return { error: "Video service not configured" };
  }

  const refinedQuery = refineVideoQuery(query);
  const school = schoolId || 'sooners';
  const fetchUrl = `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&school=${school}&limit=3&ts=${Date.now()}`;

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
  
  let toolName = "get_score";
  let args = { team: "Oklahoma", sport: "football" };
  
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
  
  if (/player stats|individual stats|who scored|leading scorer/i.test(query)) {
    toolName = "get_game_player_stats";
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
    const dateMatch = query.match(/\d{8}/);
    if (dateMatch) args.date = dateMatch[0];
  }
  else {
    toolName = "get_score";
    args = { team: "Oklahoma", sport: sport };
  }
  
  console.log(`🔧 Using ESPN tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(ESPN_MCP_URL, payload, 15000, "tools/call");
  
  console.log(`📊 ESPN Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ ESPN Response:`, responseText.substring(0, 200));
    if (toolName === "get_schedule" && responseText && !responseText.includes("TBD") && !responseText.includes("upcoming")) {
      return { data: responseText + "\n\nNote: This is the completed 2025 season schedule. The 2026 schedule has not been released yet." };
    }
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
  
  if (/basketball|hoops|bball|court|sam godwin|jalon moore|javian mcollum/i.test(query)) {
    console.log(`⚠️ BASKETBALL query detected in football function, redirecting...`);
    return { error: "This appears to be a basketball query. Please use the basketball tool instead." };
  }
  
  console.log(`\n📚 CFBD History Request: "${query}"`);
  console.log(`🔗 CFBD_MCP_URL: ${CFBD_MCP_URL}`);
  
  const lowerQuery = query.toLowerCase();
  
  let year = null;
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    console.log(`📅 Extracted year from query: ${year}`);
  } else {
    year = new Date().getMonth() < 7 ? new Date().getFullYear() - 1 : new Date().getFullYear();
    console.log(`📅 Using default year: ${year}`);
  }
  
  let toolName = "get_team_records";
  let args = { team: "Oklahoma" };
  
  if (/game[- ]?by[- ]?game|each game|every game/i.test(query) || 
      (/game stats/i.test(query) && /\bvs\.?\b|\bagainst\b/i.test(query))) {
    toolName = "get_game_stats";
    args = { team: "Oklahoma", year: year };
    
    if (/\bvs\.?\b|\bagainst\b/i.test(query)) {
      let opponent = query
        .toLowerCase()
        .replace(/\b(oklahoma|sooners|ou)\b/gi, "")
        .replace(/\b(vs\.?|against|game|stats|football)\b/gi, "")
        .replace(/\b(19\d{2}|20\d{2})\b/gi, "")
        .trim();
      
      if (/texas/i.test(opponent) && !/tech|state/i.test(opponent)) opponent = "Texas";
      else if (/nebraska/i.test(opponent)) opponent = "Nebraska";
      else if (/alabama|bama/i.test(opponent)) opponent = "Alabama";
      else if (/oklahoma state|osu|cowboys|pokes/i.test(opponent)) opponent = "Oklahoma State";
      
      if (opponent) {
        args.opponent = opponent;
      }
    }
  }
  else if (/\bvs\.?\b|\bagainst\b|\bversus\b|head[- ]?to[- ]?head/i.test(query)) {
    toolName = "get_team_matchup";
    let opponent = query
      .toLowerCase()
      .replace(/\b(oklahoma|sooners|ou)\b/gi, "")
      .replace(/\b(vs\.?|against|versus|all[- ]time|record|history|head[- ]?to[- ]?head)\b/gi, "")
      .replace(/\b(football|basketball|game)\b/gi, "")
      .replace(/\b(19\d{2}|20\d{2})\b/gi, "")
      .trim();
    
    if (/texas/i.test(opponent) && !/tech|state/i.test(opponent)) opponent = "Texas";
    else if (/nebraska/i.test(opponent)) opponent = "Nebraska";
    else if (/alabama|bama/i.test(opponent)) opponent = "Alabama";
    else if (/oklahoma state|osu|cowboys|pokes/i.test(opponent)) opponent = "Oklahoma State";
    else if (/kansas/i.test(opponent) && !/state/i.test(opponent)) opponent = "Kansas";
    else if (!opponent) opponent = "Texas";
    
    args = {
      team1: "Oklahoma",
      team2: opponent,
      minYear: 1900
    };
  }
  else if (/play[- ]?by[- ]?play|plays|scoring|drive/i.test(query)) {
    toolName = "get_play_by_play";
    return { error: "For play-by-play, please ask for the game score first, then I can get detailed play information." };
  }
  else if (
    /player stats|individual stats|who led|leading|top player/i.test(query) ||
    (/\b[A-Z][a-z]+\s+[A-Z][a-z]+.*stats/i.test(query) && !/team stats|season stats/i.test(query))
  ) {
    toolName = "get_player_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  else if (/team stats|season stats|total yards|total touchdowns|offensive stats|defensive stats/i.test(query)) {
    toolName = "get_team_stats";
    args = { team: "Oklahoma", year: year };
  }
  else if (/standings?|conference|big 12|sec/i.test(query)) {
    toolName = "get_conference_standings";
    const conference = /sec/i.test(query) ? "SEC" : "Big 12";
    args = { conference: conference, year: year };
  }
  else if (/recruit/i.test(query)) {
    toolName = "get_recruiting";
    args = { team: "Oklahoma", year: year };
  }
  else if (/talent|composite/i.test(query)) {
    toolName = "get_team_talent";
    args = { team: "Oklahoma", year: year };
  }
  else if (/ranking|poll|ap|coaches|playoff ranking|final ranking/i.test(query)) {
    toolName = "get_team_rankings";
    args = { team: "Oklahoma", year: year };
  }
  else if (/schedule|upcoming|next game|remaining games/i.test(query)) {
    toolName = "get_schedule";
    args = { team: "Oklahoma", year: year };
  }
  else if (/returning|production|who'?s back|veterans/i.test(query)) {
    toolName = "get_returning_production";
    args = { team: "Oklahoma", year: year };
  }
  else if (/stadium|venue|gaylord|memorial stadium|where do they play/i.test(query)) {
    toolName = "get_venue_info";
    args = { team: "Oklahoma" };
  }
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
    if (toolName === "get_schedule" && responseText && !responseText.includes("TBD") && !responseText.includes("upcoming")) {
      return { data: responseText + "\n\nNote: This is the completed 2025 season schedule. The 2026 schedule has not been released yet." };
    }
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
  
  let year = null;
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[1]);
  } else {
    year = new Date().getFullYear();
  }
  
  let toolName = "get_basketball_score";
  let args = { team: "Oklahoma", year: year };
  
  if (/shooting|3pt|three point|fg%|field goal|free throw|ft%/i.test(query)) {
    toolName = "get_basketball_shooting_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  else if (
    /player stats|individual stats|who led|leading|top scorer/i.test(query) ||
    (/\b[A-Z][a-z]+\s+[A-Z][a-z]+.*stats/i.test(query) && !/team stats|season stats/i.test(query))
  ) {
    toolName = "get_basketball_player_stats";
    args = { team: "Oklahoma", year: year, query: query };
  }
  else if (/team stats|season stats/i.test(query)) {
    toolName = "get_basketball_team_stats";
    args = { team: "Oklahoma", year: year };
  }
  else if (/schedule|upcoming|next game|remaining games/i.test(query)) {
    toolName = "get_basketball_schedule";
    args = { team: "Oklahoma", year: year };
  }
  else if (/ranking|poll|ap|coaches/i.test(query)) {
    toolName = "get_basketball_rankings";
    args = { team: "Oklahoma", year: year };
  }
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

async function getNCAAWomensSports(query) {
  if (!NCAA_WOMENS_MCP_URL) {
    return { error: "NCAA Women's Sports not configured" };
  }
  
  console.log(`\n🏐 NCAA Women's Sports Request: "${query}"`);
  console.log(`🔗 NCAA_WOMENS_MCP_URL: ${NCAA_WOMENS_MCP_URL}`);
  
  const lowerQuery = query.toLowerCase();
  
  let sport = null;
  if (/softball/i.test(query)) {
    sport = "softball";
  } else if (/volleyball|vball/i.test(query)) {
    sport = "volleyball";
  } else if (/soccer/i.test(query)) {
    sport = "soccer";
  } else if (/women'?s basketball|lady sooners|womens hoops/i.test(query)) {
    sport = "womens_basketball";
  }
  
  if (!sport) {
    return { error: "Please specify which women's sport: softball, volleyball, soccer, or women's basketball" };
  }
  
  let toolName = null;
  let args = {};
  
  if (/score|game|result|final/i.test(query)) {
    toolName = `get_${sport}_scores`;
    const dateMatch = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (dateMatch) {
      args.date = dateMatch[0];
    }
  }
  else if (/schedule|upcoming|next game|when|calendar/i.test(query)) {
    toolName = `get_${sport}_schedule`;
    const yearMatch = query.match(/\b(20\d{2})\b/);
    const monthMatch = query.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2})\b/i);
    
    if (yearMatch) {
      args.year = yearMatch[1];
      if (monthMatch) {
        const monthMap = {
          'january': '01', 'february': '02', 'march': '03', 'april': '04',
          'may': '05', 'june': '06', 'july': '07', 'august': '08',
          'september': '09', 'october': '10', 'november': '11', 'december': '12'
        };
        const monthStr = monthMatch[1].toLowerCase();
        args.month = monthMap[monthStr] || monthStr.padStart(2, '0');
      } else {
        args.month = String(new Date().getMonth() + 1).padStart(2, '0');
      }
   } else {
      const now = new Date();
      const month = now.getMonth() + 1;

      if (sport === 'volleyball' || sport === 'soccer') {
        if (month >= 8) {
          args.year = String(now.getFullYear());
          args.month = String(month).padStart(2, '0');
        } else {
          args.year = String(now.getFullYear() - 1);
          args.month = '11';
        }
      } else if (sport === 'softball') {
        if (month >= 2 && month <= 5) {
          args.year = String(now.getFullYear());
          args.month = String(month).padStart(2, '0');
        } else {
          args.year = month > 5
            ? String(now.getFullYear())
            : String(now.getFullYear() - 1);
          args.month = '04';
        }
      } else {
        args.year = String(now.getFullYear());
        args.month = String(month).padStart(2, '0');
      }
    }
  }
  else if (/ranking|ranked|poll|top 25/i.test(query)) {
    toolName = `get_${sport}_rankings`;
  }
  else if (/stats|statistics|performance|numbers/i.test(query)) {
    toolName = `get_${sport}_stats`;
  }
  else if (/standing|conference|record/i.test(query)) {
    toolName = `get_${sport}_standings`;
  }
  else {
    toolName = `get_${sport}_scores`;
  }
  
  console.log(`🔧 Using NCAA Women's tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(NCAA_WOMENS_MCP_URL, payload, 30000, "tools/call");
  
  console.log(`📊 NCAA Women's Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ NCAA Women's Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || "NCAA Women's Sports request failed";
    console.error(`❌ NCAA Women's Error:`, errorMsg);
    return { error: errorMsg };
  }
}

async function getGymnastics(query) {
  if (!GYMNASTICS_MCP_URL) {
    return { error: "Gymnastics not configured" };
  }
  
  console.log(`\n🤸 Gymnastics Request: "${query}"`);
  console.log(`🔗 GYMNASTICS_MCP_URL: ${GYMNASTICS_MCP_URL}`);
  
  const isMens = /\bmen'?s\b|\bmale\b/i.test(query);
  const gender = isMens ? "mens" : "womens";
  
  console.log(`🎯 Detected gender: ${gender}`);
  
  let toolName = null;
  let args = { year: String(new Date().getFullYear()) };
  
  if (/score|result|meet|final/i.test(query)) {
    toolName = `get_${gender}_gymnastics_scores`;
  }
  else if (/schedule|upcoming|next meet|when/i.test(query)) {
    toolName = `get_${gender}_gymnastics_schedule`;
    const dateMatch = query.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (dateMatch) {
      args.date = dateMatch[0];
    }
  }
  else if (/ranking|ranked|poll|where|position/i.test(query)) {
    toolName = `get_${gender}_gymnastics_rankings`;
  }
  else if (/roster|gymnasts|team|who'?s on|athletes/i.test(query)) {
    toolName = `get_${gender}_gymnastics_roster`;
  }
  else if (/team info|dashboard|everything|complete|full|all info/i.test(query)) {
    toolName = `get_${gender}_gymnastics_team_info`;
  }
  else {
    toolName = `get_${gender}_gymnastics_rankings`;
  }
  
  console.log(`🔧 Using Gymnastics tool: ${toolName}`, args);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJson(GYMNASTICS_MCP_URL, payload, 7000, "tools/call");
  
  console.log(`📊 Gymnastics Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpText(result.json) || result.text || "";
    console.log(`✅ Gymnastics Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || "Gymnastics request failed";
    console.error(`❌ Gymnastics Error:`, errorMsg);
    return { error: errorMsg };
  }
}

async function getSchoolAthletics(query) {
  console.log(`\n🏫 School Athletics Request: "${query}"`);
  
  const school = detectSchool(query);
  
  if (!school) {
    return { error: "Could not determine which school you're asking about" };
  }
  
  // ── Map new tool names to what the MCP server understands ──
  const rawToolName = parseToolName(query);
  const sport = parseSport(query);

  // Translate intent-based queries to specific MCP tools
  let toolName = rawToolName;
  if (/depth.?chart|who.?s starting|starter|starters/i.test(query)) {
    toolName = "get_depth_chart";
  } else if (/injur|who.?s hurt|who.?s out|injury report/i.test(query)) {
    toolName = "get_injuries";
  } else if (/standing|conference.?rank|where.?in.?conference/i.test(query)) {
    toolName = "get_standings";
  } else if (/stat leader|statistical leader|leading passer|leading rusher|leading scorer|top stats/i.test(query)) {
    toolName = "get_player_stats";
  } else if (/team info|team details|colors|stadium|mascot/i.test(query)) {
    toolName = "get_team_info";
  } else if (/recruit|commits|signing class|class rank|who signed|who committed/i.test(query)) {
    toolName = "get_recruiting";
  }

  console.log(`🎯 School: ${school.displayName}, Tool: ${toolName}, Sport: ${sport}`);
  
  let args = { sport: sport };
  
  if (toolName === "search_player") {
    const searchTerm = query
      .toLowerCase()
      .replace(new RegExp(school.keywords.join("|"), "gi"), "")
      .replace(/\b(find|search|who is|player|roster)\b/gi, "")
      .trim();
    args = { sport: sport, searchTerm: searchTerm };
  }
  
  if (toolName === "get_news") {
    args.limit = 5;
  }

  // Recruiting — no sport arg, but extract year if mentioned
  if (toolName === "get_recruiting") {
    const yearMatch = query.match(/\b(20\d{2})\b/);
    args = yearMatch ? { year: parseInt(yearMatch[1]) } : {};
  }

  if (toolName === "get_team_info") {
    args = {};
  }

  // get_recruiting_by_position — extract position from query
  if (/recruit.*\b(qb|rb|wr|te|ol|dl|lb|db|cb|s|k|p|quarterback|running back|wide receiver|tight end|lineman|linebacker|defensive back|kicker|punter)\b/i.test(query)) {
    toolName = "get_recruiting_by_position";
    const posMatch = query.match(/\b(qb|rb|wr|te|ol|dl|lb|db|cb|quarterback|running back|wide receiver|tight end|lineman|linebacker|defensive back|kicker|punter)\b/i);
    args = { position: posMatch ? posMatch[1].toUpperCase() : 'QB' };
  }
  
  return await fetchSchoolData(school, toolName, args, fetchJson, extractMcpText);
}

async function getSchoolNews(query, schoolId) {
  console.log(`\n📰 School News Request: "${query}" for school: ${schoolId}`);

  try {
    const school = schoolId || 'oklahoma';

    const { data, error } = await supabase
      .from('xsen_news')
      .select('*')
      .eq('active', true)
      .or(`school.eq.${school},school.eq.ALL`)
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) throw error;
    console.log(`📰 Supabase query result: ${data?.length} rows, error: ${JSON.stringify(error)}`);
    if (!data || data.length === 0) {
      return { data: "No current news or updates available right now. Check soonersports.com for the latest." };
    }

    const now = new Date();
    const valid = data.filter(n => !n.expires_at || new Date(n.expires_at) > now);

    if (!valid.length) {
      return { data: "No current news or updates available right now. Check soonersports.com for the latest." };
    }

    const formatted = valid.map(n => {
      const date = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `[${n.category.toUpperCase()}] ${n.title}\n${n.body}${n.source ? `\nSource: ${n.source}` : ''}\n(${date})`;
    }).join('\n\n---\n\n');

    console.log(`✅ Found ${valid.length} news items`);
    return { data: formatted };

  } catch (err) {
    console.error('❌ School news error:', err);
    return { error: err.message };
  }
}

// ─── PRE-ROUTING: NEWS INTENT DETECTION ──────────────────────────────────────
function isNewsQuery(text = "") {
  return /\b(latest news|breaking news|recent news|what'?s new|any news|news today|football news|softball news|baseball news|basketball news|gymnastics news|volleyball news|soccer news|wrestling news|injury report|who is hurt|who'?s hurt|who is out|who'?s out|roster move|transfer portal|transfer news|recruiting news|update|updates)\b/i.test(text);
}
// ─────────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/*                      OPENAI FUNCTION TOOLS                         */
/* ------------------------------------------------------------------ */

const tools = [
  {
    type: "function",
    function: {
      name: "get_trivia_question",
      description: "Get a random OU Sooners trivia question with multiple choice answers. ONLY use when user explicitly asks for 'trivia', 'quiz', or 'test my knowledge'.",
      parameters: { type: "object", properties: {}, required: [] }
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
          query: { type: "string", description: "The search query for videos (e.g., 'Baker Mayfield highlights', 'OU vs Alabama', 'softball championship')" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_espn_stats",
      description: "Get CURRENT/RECENT game scores, today's games, and live stats from ESPN. Use for: current score, recent game, today's game, this week, latest game. DO NOT use for schedule queries — use get_cfbd_history for schedules. DO NOT use for player season stats, all-time records, historical matchups, or conference standings.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The stats query focused on recent/current games (e.g., 'OU basketball score today', 'football schedule this week')" }
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
          query: { type: "string", description: "The basketball query (e.g., 'What was the OU basketball score?', 'Sam Godwin stats', 'OU basketball schedule', 'list basketball roster')" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_cfbd_history",
      description: "Get FOOTBALL data ONLY. HISTORICAL football data, ALL-TIME football records, CONFERENCE STANDINGS, and FOOTBALL PLAYER SEASON STATISTICS. Use ONLY for FOOTBALL queries. Keywords: 'football', 'fb', 'gridiron', plus 'player stats', 'season stats', 'all-time', 'history', 'vs', 'against', 'series', 'bowl games', 'championships', 'final ranking', 'season ranking', 'standings', 'conference', 'Big 12', 'SEC'. DO NOT use for basketball - use get_cfbd_basketball instead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Pass the user's EXACT question without modification. Do not change years or rephrase." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_ncaa_womens_sports",
      description: "Get NCAA WOMEN'S SPORTS data for softball, volleyball, soccer, and women's basketball. Use for ANY women's sports queries including scores, schedules, rankings, stats, and standings. DO NOT use for rosters - use get_school_athletics instead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The women's sports query (e.g., 'OU softball score', 'volleyball schedule', 'women's basketball rankings', 'soccer standings')" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_gymnastics",
      description: "Get GYMNASTICS data for both men's and women's programs. Use for ANY gymnastics-related queries including scores, schedules, rankings, rosters, and team info. BOTH OU teams are currently ranked #1!",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The gymnastics query (e.g., 'OU gymnastics rankings', 'women's gymnastics score', 'men's gymnastics roster', 'gymnastics schedule')" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_school_athletics",
      // ── UPDATED: expanded to cover all new athletics.js capabilities ──
      description: "Get school athletics data via ESPN/CFBD APIs. Use for: ROSTERS (player name, position, year, hometown), PLAYER BIOS, DEPTH CHARTS (who is starting at each position), INJURY REPORTS (who is hurt or out), CONFERENCE STANDINGS, SEASON STATS (statistical leaders), TEAM INFO (record, stadium, colors, mascot), and FOOTBALL RECRUITING (class ranking, commits, star ratings, positions). Available for: Oklahoma (OU, Sooners). NOTE: Recruiting data is FOOTBALL ONLY — do not use for basketball recruiting. For OU scores/rankings use ESPN/CFBD tools instead.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The query (e.g., 'OU football depth chart', 'who is starting at QB', 'injury report', 'football recruiting class', 'top commits', 'conference standings', 'statistical leaders')" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_school_news",
      description: "Get the latest breaking news, injury reports, roster moves, recruiting updates, and game updates for the school. Use for ANY query about: injuries, who is hurt, who is out, roster changes, transfers, recruiting news, breaking news, latest updates, game status, weather delays. ALWAYS use this before answering injury or roster move questions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The news query (e.g., 'injury report', 'who is out this week', 'latest roster news')" }
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
const NCAA_WOMENS_MCP_URL = (process.env.NCAA_WOMENS_MCP_URL || "").replace(/\/+$/, "");
const GYMNASTICS_MCP_URL = (process.env.GYMNASTICS_MCP_URL || "").replace(/\/+$/, "");

const openai = new OpenAI({
  apiKey: (process.env.OPENAI_API_KEY || "").trim().replace(/\s+/g, '')
});

console.log("🔧 Configuration:");
console.log("  VIDEO_AGENT_URL:", VIDEO_AGENT_URL || "(not set)");
console.log("  ESPN_MCP_URL:", ESPN_MCP_URL || "(not set)");
console.log("  CFBD_MCP_URL:", CFBD_MCP_URL || "(not set)");
console.log("  CFBD_BASKETBALL_MCP_URL:", CFBD_BASKETBALL_MCP_URL || "(not set)");
console.log("  NCAA_WOMENS_MCP_URL:", NCAA_WOMENS_MCP_URL || "(not set)");
console.log("  GYMNASTICS_MCP_URL:", GYMNASTICS_MCP_URL || "(not set)");
console.log("  MCP_API_KEY:", process.env.MCP_API_KEY ? "✅ Set" : "❌ Not set");
console.log("  OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✅ Set" : "❌ Not set");

/* ------------------------------------------------------------------ */
/*                            LOAD TRIVIA                              */
/* ------------------------------------------------------------------ */

function loadTrivia(schoolId) {
  try {
    const triviaPath = path.join(__dirname, "trivia", `${schoolId}.json`);
    const raw = fs.readFileSync(triviaPath, "utf-8");
    const data = JSON.parse(raw);
    console.log(`🧠 Loaded ${data.length} trivia questions for ${schoolId}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    try {
      const defaultPath = path.join(__dirname, "trivia", "sooners.json");
      const raw = fs.readFileSync(defaultPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
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

function buildMCQ(q, TRIVIA) {
  const correct = sanitize(q?.answer);
  const correctNorm = normalizeAnswer(correct);

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

  const allOtherAnswers = TRIVIA
    .map(t => sanitize(t?.answer))
    .filter(a => a && normalizeAnswer(a) !== correctNorm);

  const plausible = allOtherAnswers.filter(a => {
    const lenOK = a.length >= 3 && Math.abs(a.length - correct.length) <= 18;
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
  return /\b(score|scores|record|stats|stat line|yards|tds|touchdowns|who won|final|rankings|game|games|today|this week|last week|schedule|recent|latest)\b/i.test(text);
}

function isCFBDHistoryRequest(text = "") {
  const lowerText = text.toLowerCase().trim();
  if (lowerText === "history") return true;
  if (/\bvs\.?\b|\bagainst\b|\bversus\b/i.test(text)) return true;
  return /\b(all[- ]time|historical|record in|season|since|bowl|championship|national title|conference title|series|head to head|coaches|heisman|recruiting|talent|matchup)\b/i.test(text);
}

/* ------------------------------------------------------------------ */
/*                         SAFE FETCH HELPERS                          */
/* ------------------------------------------------------------------ */

async function fetchJson(url, payload, timeoutMs = 7000, method = "tools/call") {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
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
    
    if (/score|game|final|result/i.test(userText)) {
      toolName = toolNames.find(name => name === "get_score") || toolName;
    }
    
    if (baseUrl.includes("cfbd")) {
      const lowerText = userText.toLowerCase();
      
      if (lowerText === "history" || /what happened|tell me about|recent history/i.test(userText)) {
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
    
    if (toolName === "query") {
      toolName = toolNames.find(name => 
        /query|search|get|fetch|ask/i.test(name)
      ) || toolNames[0];
    }
    
    console.log(`✅ Using MCP tool: ${toolName} (available: ${toolNames.join(", ")})`);
  } else {
    console.log(`⚠️ No tools found, using default: ${toolName}`);
  }

  let teamName = userText;
  let sport = null;
  
  if (toolName === "get_score") {
    const isMens = /\bmen'?s\b|\bmale\b/i.test(userText);
    const isWomens = /\bwomen'?s\b|\bfemale\b|\blady\b|\bladies\b/i.test(userText);
    
    teamName = userText
      .toLowerCase()
      .replace(/\b(score|game|final|result|what's|whats|get|show|tell me)\b/gi, "")
      .replace(/\b(men'?s|women'?s|male|female|lady|ladies)\b/gi, "")
      .replace(/\bou\b/gi, "oklahoma")
      .replace(/\bsooners\b/gi, "oklahoma")
      .trim();
    
    if (/basketball|hoops|bball/i.test(userText)) {
      sport = "basketball";
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
  }

  const payloadVariations = [];
  
  if (toolName === "get_score") {
    if (sport) {
      const teamVariations = [teamName, "Oklahoma Sooners", "Oklahoma", "OU"];
      teamVariations.forEach(team => {
        payloadVariations.push({ name: toolName, arguments: { team: team, sport: sport } });
        if (sport.includes("-")) {
          const baseSport = sport.split("-")[1];
          payloadVariations.push({ name: toolName, arguments: { team: team, sport: baseSport } });
        }
      });
    } else {
      const teamVariations = ["Oklahoma", "Oklahoma Sooners", "OU"];
      const sports = [
        "mens-basketball", "basketball", "womens-basketball", 
        "football", "baseball", "softball",
        "mens-soccer", "soccer", "womens-soccer",
        "womens-volleyball", "volleyball",
        "mens-golf", "golf", "womens-golf",
        "womens-gymnastics", "gymnastics",
        "wrestling", "mens-tennis", "tennis", "womens-tennis"
      ];
      
      teamVariations.forEach(team => {
        sports.forEach(s => {
          payloadVariations.push({ name: toolName, arguments: { team: team, sport: s } });
        });
      });
    }
  }
  
  if (baseUrl.includes("cfbd")) {
    const teamVariations = ["Oklahoma", "oklahoma", "Oklahoma Sooners", "OU"];
    
    if (toolName === "get_team_records") {
      teamVariations.forEach(team => {
        payloadVariations.push({ name: toolName, arguments: { team: team, startYear: 2020, endYear: 2024 } });
        payloadVariations.push({ name: toolName, arguments: { team: team } });
      });
    } else if (toolName === "get_team_matchup") {
      const opponent = userText
        .toLowerCase()
        .replace(/\b(oklahoma|sooners|ou)\b/gi, "")
        .replace(/\b(vs\.?|against|versus|head to head)\b/gi, "")
        .trim();
      
      if (opponent) {
        teamVariations.forEach(team => {
          payloadVariations.push({ name: toolName, arguments: { team1: team, team2: opponent, minYear: 2000 } });
        });
      }
    } else if (toolName === "get_team_rankings") {
      teamVariations.forEach(team => {
        payloadVariations.push({ name: toolName, arguments: { team: team, year: 2024 } });
        payloadVariations.push({ name: toolName, arguments: { team: team } });
      });
    } else if (toolName === "get_recruiting" || toolName === "get_team_talent") {
      teamVariations.forEach(team => {
        payloadVariations.push({ name: toolName, arguments: { team: team } });
      });
    }
  }
  
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
      
      if (out.includes("No recent game found")) {
        console.log(`⚠️ No game found, trying next variation...`);
        continue;
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
    const voice = req.body?.voice || "onyx";

    if (!text) {
      return res.status(400).json({ error: "No text provided" });
    }

    console.log(`🔊 TTS Request: "${text.substring(0, 50)}..." with voice: ${voice}`);

    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: voice,
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
/*                      HANDLE CORS PREFLIGHT                          */
/* ------------------------------------------------------------------ */
app.options("/chat", cors());

/* ------------------------------------------------------------------ */
/*                           CHAT ROUTE                                */
/* ------------------------------------------------------------------ */
async function logMessages(userId, schoolId, userMessage, replyMessage, tokenCount) {
  try {
    await supabase.from('message_logs').insert([
      {
        user_id: userId,
        school_id: schoolId,
        role: 'user',
        message: userMessage,
        token_count: null
      },
      {
        user_id: userId,
        school_id: schoolId,
        role: 'assistant',
        message: replyMessage,
        token_count: tokenCount
      }
    ]);
    console.log(`📊 Logged messages for ${userId} / ${schoolId}`);
  } catch (err) {
    console.error('❌ Message log error:', err);
  }
}

app.post("/chat", async (req, res) => {
  console.log(`📨 ${req.body?.school || "?"} - ${req.body?.message?.substring(0, 40) || "?"}`);
  try {
    const sessionId = req.body?.userId || req.body?.sessionId || req.body?.session_id || "default";
    const rawText = getText(req.body);
    const schoolId = req.body?.school || "sooners";

    const school = getAllSchools().find(s => s.id === schoolId) || getAllSchools().find(s => s.isDefault);
    if (!school) {
      return res.json({ response: "School not found. Please try again." });
    }

    // ─── MONTHLY MESSAGE LIMIT (authenticated users only) ─────────
    if (sessionId !== 'anonymous' && sessionId !== 'default') {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from('message_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', sessionId)
        .eq('role', 'user')
        .gte('created_at', startOfMonth.toISOString());

      if (!error && count >= 150) {
        return res.json({
          response: `You've reached your 150 message limit for this month. Your messages reset on the 1st. Thank you for being a ${school.displayName} fan! 🏈`
        });
      }
    }
    // ──────────────────────────────────────────────────────────────

    const greeting = school.greeting || "Hello!";
    const mascotName = school.mascotName || "Bot";

    if (!rawText) {
      return res.json({ response: `${greeting} What can I help you with?` });
    }

    // ─── PRE-ROUTING: bypass GPT for news queries ─────────────────
    if (isNewsQuery(rawText)) {
      console.log(`📰 Pre-routing news query: "${rawText}"`);
      const newsResult = await getSchoolNews(rawText, schoolId);
      const newsText = newsResult.data || "No current news available. Check soonersports.com for the latest.";
      await logMessages(sessionId, schoolId, rawText, newsText, 0);
      return res.json({ response: newsText });
    }
    // ─────────────────────────────────────────────────────────────

    if (!sessions.has(sessionId)) sessions.set(sessionId, { chat: [] });
    const session = sessions.get(sessionId);

    if (session.active && isAnswerChoice(rawText.toLowerCase())) {
      const idx = { a: 0, b: 1, c: 2, d: 3 }[rawText.toLowerCase()];
      const isCorrect = idx === session.correctIndex;
      session.active = false;

      return res.json({
        response: isCorrect
          ? `✅ **Correct!** 🎉\n\n${session.explain}\n\nTry **trivia**, **video**, **stats**, or **history** — and don't forget to tune in to ${school.displayName} Radio! 🎙️📻`
          : `❌ **Not quite!**\n\nCorrect answer: **${["A", "B", "C", "D"][session.correctIndex]}** - ${session.explain}\n\nTry **trivia**, **video**, **stats**, or **history** — and don't forget to tune in to ${school.displayName} Radio! 🎙️📻`
      });
    }

    session.chat.push({ role: "user", content: rawText });
    session.chat = session.chat.slice(-4);

    const messages = [
      {
        role: "system",
        content: `${school.systemPrompt || `You are ${mascotName}, the enthusiastic AI assistant for ${school.name} fans. You love ${school.displayName} sports and provide helpful, engaging responses.`}
Today's date: ${new Date().toDateString()}. The current/most recent completed football season is ${new Date().getMonth() < 7 ? new Date().getFullYear() - 1 : new Date().getFullYear()}. When users ask about "this season", "current season", or "this year", always use that year — never default to 2023 or prior seasons. For ANY question about how the team is doing, current record, season performance, or outlook — you MUST call get_cfbd_history. Never answer football season questions from memory. The 2025 football season is COMPLETE. There are no upcoming games. When asked about upcoming games, present the 2025 completed schedule and say the 2026 schedule is not yet available.
The 2025-2026 men's basketball season is COMPLETE. There are no upcoming games. When asked about upcoming games or next games, present the completed season record and say the next season schedule is not yet available.
IMPORTANT TOOL USAGE RULES:
- get_trivia_question: ONLY when user explicitly says "trivia", "quiz", or "test me"
- search_videos: ONLY when user asks for "video", "highlight", "watch", or "show me"
- get_espn_stats: For CURRENT/RECENT games (today, this week, latest score). DO NOT use for schedule queries if get_cfbd_history already returned data.
- get_cfbd_history: For FOOTBALL all-time records, historical matchups, "vs", series records, AND PLAYER SEASON STATS
- get_cfbd_basketball: For ANY BASKETBALL queries (scores, stats, schedule, rankings, roster)
- get_ncaa_womens_sports: For WOMEN'S SPORTS scores/schedules/rankings/stats (NOT rosters)
- get_gymnastics: For GYMNASTICS queries (both men's and women's) - BOTH OU TEAMS ARE #1!
- get_school_athletics: For ROSTERS, PLAYER BIOS, DEPTH CHARTS, INJURY REPORTS, STANDINGS, PLAYER STATS, TEAM INFO, and FOOTBALL RECRUITING
- get_school_news: For BREAKING NEWS, ROSTER MOVES, TRANSFERS, and RECRUITING UPDATES from our news feed

SUPPORTED SCHOOLS (for get_school_athletics):
- Oklahoma (OU, Sooners) - data via ESPN/CFBD APIs

IMPORTANT — get_school_athletics routing:
- "who is starting at [position]" / "depth chart" / "starters" → use get_school_athletics
- "who is hurt" / "injury report" / "who is out" → use get_school_news FIRST, then get_school_athletics if no results
- "conference standings" / "where is OU in the Big 12" → use get_school_athletics
- "statistical leaders" / "leading passer" / "leading rusher" → use get_school_athletics
- "team info" / "stadium" / "team colors" → use get_school_athletics
- "recruiting class" / "top commits" / "who did OU sign" / "recruiting ranking" → use get_school_athletics
- "recruiting at [position]" / "QB recruits" / "WR commits" → use get_school_athletics

IMPORTANT — RECRUITING IS FOOTBALL ONLY:
get_school_athletics recruiting data covers FOOTBALL recruiting only via CFBD API.
If asked about basketball recruiting or any other sport's recruiting, respond:
"Basketball recruiting data isn't available in my current data sources — for the latest OU basketball recruiting news, check soonersports.com or 247Sports."

IMPORTANT GYMNASTICS NOTE: Women's gymnastics has individual event rankings (vault, bars, beam, floor). Men's gymnastics only has OVERALL TEAM rankings - do not make up individual event rankings for men's gymnastics.

When tools return errors, acknowledge the issue and provide what information you can from your general knowledge about OU sports. When get_cfbd_history returns a completed season schedule with W/L results, present it as the most recent completed season and note that the next season schedule will be available closer to fall.
Common queries:
- Any question about a specific player, position, or starter → use get_school_athletics
- "what's the score?" → use get_espn_stats
- "OU vs Texas all-time" → use get_cfbd_history
- "John Mateer stats 2025" → use get_cfbd_history (player season stats)
- "OU football schedule" → use get_cfbd_history
- "what games does OU have coming up" → use get_cfbd_history
- "upcoming games" → use get_cfbd_history ONLY, do not also call get_espn_stats
- "basketball score" → use get_cfbd_basketball
- "Sam Godwin stats" → use get_cfbd_basketball
- "OU hoops schedule" → use get_cfbd_basketball
- "softball score" → use get_ncaa_womens_sports
- "softball roster" → use get_school_athletics (NOT get_ncaa_womens_sports)
- "volleyball schedule" → use get_ncaa_womens_sports
- "women's basketball rankings" → use get_ncaa_womens_sports
- "soccer standings" → use get_ncaa_womens_sports
- "gymnastics rankings" → use get_gymnastics (BOTH teams #1!)
- "women's gymnastics score" → use get_gymnastics
- "men's gymnastics roster" → use get_gymnastics
- "OU softball roster" → use get_school_athletics
- "player bio" → use get_school_athletics
- "team news" → use get_school_athletics
- "history" (alone) → ask what kind of history they want
- "trivia" → use get_trivia_question
- "show me highlights" → use search_videos
- "injury report" → use get_school_news
- "who is hurt" → use get_school_news
- "who is out" → use get_school_news
- "latest news" → use get_school_news
- "roster move" → use get_school_news
- "transfer" → use get_school_news
- "breaking news" → use get_school_news
- "who is starting at QB" → use get_school_athletics (depth chart)
- "depth chart" → use get_school_athletics
- "conference standings" → use get_school_athletics
- "statistical leaders" → use get_school_athletics
- "recruiting class" → use get_school_athletics (FOOTBALL ONLY)
- "top commits" → use get_school_athletics (FOOTBALL ONLY)
- "QB recruits" → use get_school_athletics (FOOTBALL ONLY)

GYMNASTICS FUN FACT: Both OU men's and women's gymnastics teams are currently ranked #1 in the nation! This is incredibly rare and worth celebrating!

Be conversational and enthusiastic. Use "Boomer Sooner!" appropriately. ALWAYS end every response with the SUGGESTED: block from your persona prompt — no exceptions, even when data is sparse.`
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

    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      session.chat.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        console.log(`🔧 Calling function: ${functionName}`, functionArgs);

        let functionResult;

        switch (functionName) {
         case "get_trivia_question":
            functionResult = await getTriviaQuestion(schoolId);
            if (!functionResult.error) {
              session.active = true;
              session.correctIndex = functionResult.correctIndex;
              session.explain = functionResult.explanation;
            }
            break;
          
         case "search_videos":
           console.log(`🎬 Video search for: "${functionArgs.query}"`);
           functionResult = await searchVideos(functionArgs.query, schoolId);
           break;
          
          case "get_espn_stats":
            console.log(`📊 ESPN stats for: "${functionArgs.query}"`);
            functionResult = await getESPNStats(functionArgs.query);
            break;
          
          case "get_cfbd_history":
            console.log(`📚 CFBD history for: "${functionArgs.query}"`);
            functionResult = await getCFBDHistory(functionArgs.query);
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
          
          case "get_ncaa_womens_sports":
            console.log(`🏐 NCAA Women's Sports for: "${functionArgs.query}"`);
            functionResult = await getNCAAWomensSports(functionArgs.query);
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing women's sports data right now. The NCAA women's sports service might be down or the query format needs adjustment.";
            }
            break;
          
          case "get_gymnastics":
            console.log(`🤸 Gymnastics for: "${functionArgs.query}"`);
            functionResult = await getGymnastics(functionArgs.query);
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing gymnastics data right now. The gymnastics service might be down or the query format needs adjustment.";
            }
            break;
          
          case "get_school_athletics":
            console.log(`🏫 School Athletics for: "${functionArgs.query}"`);
            functionResult = await getSchoolAthletics(functionArgs.query);
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing that school's athletics data right now.";
            }
            break;

          case "get_school_news":
            console.log(`📰 School news for: "${functionArgs.query}"`);
            functionResult = await getSchoolNews(functionArgs.query, schoolId);
            if (functionResult.error) {
              functionResult.userMessage = "I'm having trouble accessing the latest news right now.";
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

      response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: session.chat,
        tools: tools,
        tool_choice: "auto"
      });

      assistantMessage = response.choices[0].message;
    }

    session.chat.push(assistantMessage);

    if (assistantMessage.content) {
      assistantMessage.content = assistantMessage.content.replace(/(\]\(https?:\/\/[^\)]+)\)+(\))/g, '$1$2');
      assistantMessage.content = assistantMessage.content.replace(/(https?:\/\/[^\s\)]+)\)+(?!\))/g, '$1');
    }

    const tokenCount = response.usage?.total_tokens || 0;
    await logMessages(sessionId, schoolId, rawText, assistantMessage.content, tokenCount);
    return res.json({ response: assistantMessage.content });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    const schoolId = req.body?.school || "sooners";
    const school = getAllSchools().find(s => s.id === schoolId) || getAllSchools().find(s => s.isDefault);
    const errorGreeting = school?.displayName === "OSU" ? "Sorry Cowboy" : "Sorry Sooner";
    
    return res.json({
      response: `${errorGreeting} — something went wrong on my end. Please try again.`
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

