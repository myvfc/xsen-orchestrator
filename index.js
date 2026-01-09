import express from "express";
import cors from "cors";

const app = express();

/**
 * ==============================
 * MIDDLEWARE
 * ==============================
 */
app.use(cors({
  origin: "*" // later restrict to boomerbot.fun
}));
app.use(express.json());

/**
 * ==============================
 * CONFIG
 * ==============================
 */
const PORT = process.env.PORT || 3000;
const PMG_SECRET = process.env.PMG_SECRET;

// Video agent config
const VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL;
const VIDEO_AGENT_KEY = process.env.VIDEO_AGENT_KEY;

/**
 * ==============================
 * HELPERS
 * ==============================
 */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function refineVideoQuery(text = "") {
  return text
    .replace(/the play/i, "")
    .replace(/longhorns/i, "Texas")
    .replace(/pokes|cowboys/i, "Oklahoma State")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ==============================
 * HEALTH CHECK
 * ==============================
 */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime()
  });
});

/**
 * ==============================
 * MAIN CHAT ENDPOINT
 * ==============================
 */
app.post("/chat", async (req, res) => {
  try {
    /**
     * 1️⃣ AUTH HANDLING
     * - PMG calls REQUIRE Bearer token
     * - Browser UI calls do NOT
     */
    const auth = req.headers.authorization || "";
    const isPMG = auth === `Bearer ${PMG_SECRET}`;

    if (!isPMG && PMG_SECRET) {
      console.log("🌐 Browser UI request (no auth)");
    }

    /**
     * 2️⃣ EXTRACT USER MESSAGE
     */
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    console.log("📨 Incoming message:", userText);

    if (!userText) {
      return res.json({
        response: "Boomer Sooner! What can I help you with?"
      });
    }

    /**
     * ==============================
     * 🎬 VIDEO ROUTIN*

