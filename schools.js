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

function linkifyUrls(text) {
  // Convert (https://...) to clickable markdown links
  return text.replace(/\(https?:\/\/[^\s\)]+\)/g, (match) => {
    const url = match.slice(1, -1); // Remove parentheses
    return `[View Bio](${url})`;
  });
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
  
  if (/schedule|upcoming|next game|when|calendar
