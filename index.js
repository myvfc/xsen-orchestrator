import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

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
   TRIVIA LOAD (PHASE 1)
============================== */
const TRIVIA_PATH = path.join(process.cwd(), "trivia.json");
let TRIVIA = [];

try {
  TRIVIA = JSON.parse(fs.readFileSync(TRIVIA_PATH, "utf8"));
  console.log(`🧠 Loaded ${TRIVIA.length} trivia questions
