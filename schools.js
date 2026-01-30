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
  // Remove parentheses around URLs - let frontend auto-linkify
  return text.replace(/\((https?:\/\/[^\s\)]+)\)/g, '$1');
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