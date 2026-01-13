import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

/* ==============================
   MIDDLEWARE
============================== */
app.use(cors({ origin: "*" }));
app.use(express.json());

/* ==============================
   CONFIG
============================== */
const PORT = Number(process.env.PORT);
if (!PORT) {
  console.error("❌ Missing process.env.PORT");
  process.exit(1);
}

const VIDEO_AGENT_URL =
  (process.env.VIDEO_AGENT_URL || "").replace(/\/+$/, "");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/* ==============================
   INTENT HELPERS
============================== */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function isNarrativeQuestion(text = "") {
  const patterns = [
    /\bwhy\b/i,
    /\bhow\b/i,
    /\bwhat made\b/i,
    /\btell me about\b/i,
    /\bexplain\b/i,
    /\bwhy do fans\b/i,
    /\bwhat was special\b/i,
    /\blegacy\b/i,
    /\bimpact\b/i
  ];
  return patterns.some(p => p.test(text));
}

function isPrecisionRequest(text = "") {
  return /(exact|exactly|how many|yards|tds|points|score|record|date|year|stats)/i.test(text);
}

function refineVideoQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/show me|watch|give me|find|please|can you|i want to see/

