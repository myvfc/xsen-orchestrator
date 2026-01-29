import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { detectSchool, parseSport, parseToolName, fetchSchoolData } from "./schools.js";

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
    cfbdEnabled: Boolean(CFBD_MCP_URL),
    ncaaWomensEnabled: Boolean(NCAA_WOMENS_MCP_URL),
    gymnasticsEnabled: Boolean(GYMNASTICS_MCP_URL)
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
    year = new Date().getFullYear() - 1;
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
    console.log(`📅 Extracted year from query: ${year}`);
  } else {
    year = new Date().getFullYear();
    console.log(`📅 Using default year: ${year}`);
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
      args.year = String(new Date().getFullYear());
      args.month = String(new Date().getMonth() + 1).padStart(2, '0');
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
  const result = await fetchJson(NCAA_WOMENS_MCP_URL, payload, 7000, "tools/call");
  
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
  
  const lowerQuery = query.toLowerCase();
  
  const isMens = /\bmen'?s\b|\bmale\b/i.test(query);
  const gender = isMens ? "mens" : "womens";
  
  console.log(`🎯 Detected gender: ${gender}`);
  
  let toolName = null;
  let args = { year: "2025" };
  
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
  
  if (school.usesExistingTools) {
    return { 
      error: "For Oklahoma Sooners, please use the specific ESPN, CFBD, NCAA, or Gymnastics tools instead.",
      school: school.displayName
    };
  }
  
  const toolName = parseToolName(query);
  const sport = parseSport(query);
  
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
  
  return await fetchSchoolData(school, toolName, args, fetchJson, extractMcpText);
}

/* ------------------------------------------------------------------ */
/*

