import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let SCHOOLS = [];
try {
  const schoolsPath = path.join(__dirname, "schools.json");
  const raw = fs.readFileSync(schoolsPath, "utf-8");
  const config = JSON.parse(raw);
  SCHOOLS = config.schools || [];
  console.log(`🏫 Loaded ${SCHOOLS.length} schools:`, SCHOOLS.map(s => s.displayName).join(", "));
} catch (err) {
  console.error("❌ Failed to load schools.json", err?.message || err);
}

export function detectSchool(query) {
  const lowerQuery = query.toLowerCase();
  
  for (const school of SCHOOLS) {
    if (school.isDefault) continue;
    
    for (const keyword of school.keywords) {
      if (lowerQuery.includes(keyword.toLowerCase())) {
        console.log(`🎯 Detected school: ${school.displayName} (keyword: "${keyword}")`);
        return school;
      }
    }
  }
  
  const defaultSchool = SCHOOLS.find(s => s.isDefault);
  console.log(`🎯 Using default school: ${defaultSchool?.displayName || "OU"}`);
  return defaultSchool;
}

export function getSchoolById(id) {
  return SCHOOLS.find(s => s.id === id);
}

export function getAllSchools() {
  return SCHOOLS;
}

export function parseSport(query) {
  const lowerQuery = query.toLowerCase();
  
  if (/softball/i.test(query)) return "softball";
  if (/baseball/i.test(query)) return "baseball";
  if (/\bfootball\b|\bfb\b/i.test(query)) return "football";
  if (/women'?s basketball|lady|womens hoops/i.test(query)) return "womens-basketball";
  if (/men'?s basketball|basketball|hoops|bball/i.test(query)) return "mens-basketball";
  if (/volleyball|vball/i.test(query)) return "womens-volleyball";
  if (/women'?s soccer|womens soccer/i.test(query)) return "womens-soccer";
  if (/men'?s soccer|mens soccer/i.test(query)) return "mens-soccer";
  if (/wrestling/i.test(query)) return "wrestling";
  if (/gymnastics/i.test(query)) return "womens-gymnastics";
  if (/track|cross country/i.test(query)) return "womens-track-and-field";
  
  return "football";
}

export function parseToolName(query) {
  const lowerQuery = query.toLowerCase();
  
  if (/roster|players|team list|who'?s on/i.test(query)) {
    return "get_roster";
  }
  
  if (/schedule|upcoming|next game|when|calendar/i.test(query)) {
    return "get_schedule";
  }
  
  if (/stats|statistics|performance|numbers/i.test(query)) {
    return "get_stats";
  }
  
  if (/news|article|story|headline/i.test(query)) {
    return "get_news";
  }
  
  if (/score|result|final|game/i.test(query)) {
    return "get_recent_results";
  }
  
  if (/dashboard|overview|everything|complete|full info/i.test(query)) {
    return "get_team_dashboard";
  }
  
  if (/find player|search player|who is/i.test(query)) {
    return "search_player";
  }
  
  return "get_team_dashboard";
}

export async function fetchSchoolData(school, toolName, args, fetchJsonFn, extractMcpTextFn) {
  if (!school.mcpUrl) {
    return { error: `${school.displayName} MCP server not configured` };
  }
  
  console.log(`\n🏫 ${school.displayName} Request`);
  console.log(`🔧 Tool: ${toolName}`, args);
  console.log(`🔗 URL: ${school.mcpUrl}`);
  
  const payload = { name: toolName, arguments: args };
  const result = await fetchJsonFn(school.mcpUrl, payload, 7000, "tools/call");
  
  console.log(`📊 ${school.displayName} Result - ok: ${result.ok}, status: ${result.status}`);
  
  if (result.ok && !result.json?.error) {
    const responseText = extractMcpTextFn(result.json) || result.text || "";
    console.log(`✅ ${school.displayName} Response:`, responseText.substring(0, 200));
    return { data: responseText };
  } else {
    const errorMsg = result.json?.error?.message || result.text || `${school.displayName} request failed`;
    console.error(`❌ ${school.displayName} Error:`, errorMsg);
    return { error: errorMsg };
  }
}