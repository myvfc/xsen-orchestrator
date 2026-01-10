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
  console.error("❌ Missing process.env.PORT. Railway must provide it.");
  process.exit(1);
}

// Browser-safe REST video endpoint
// Example: https://xsen-mcp-production.up.railway.app/videos
let VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL || "";
VIDEO_AGENT_URL = VIDEO_AGENT_URL.replace(/\/+$/, "");

/* ==============================
   INTENT HELPERS
============================== */

// Video intent
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

// Narrative / explanation intent (LLM-safe)
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

// Precision / fact request (LLM NOT allowed)
function isPrecisionRequest(text = "") {
  return /(exact|exactly|how many|yards|tds|points|score|record|date|year|stats)/i.test(text);
}

// Normalize & improve video search
function refineVideoQuery(text = "") {
  return text
    .toLowerCase()
    .replace(/show me|watch|give me|find|please|can you|i want to see/gi, "")
    .replace(/baker mayfield|baker/gi, "baker mayfield oklahoma")
    .replace(/ou|sooners/gi, "oklahoma")
    .replace(/videos?|clips?|replays?/gi, "")
    .replace(/highlights?/gi, "highlights")
    .replace(/bama|alabama/gi, "alabama")
    .replace(/texas|longhorns/gi, "texas")
    .replace(/osu|cowboys|pokes/gi, "oklahoma state")
    .replace(/\s+/g, " ")
    .trim();
}

/* ==============================
   HEALTHCHECKS
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    videoEndpoint: VIDEO_AGENT_URL || "NOT SET"
  });
});

app.get("/health", (req, res) => res.status(200).send("OK"));

/* ==============================
   MAIN CHAT ENDPOINT
============================== */
app.post("/chat", async (req, res) => {
  try {
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    if (!userText) {
      return res.json({
        response: "Boomer Sooner! What can I help you with?"
      });
    }

    /* ==============================
       🎬 VIDEO ROUTE (TOOL)
    ============================== */
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);
      const fetchUrl =
        `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3`;

      try {
        const videoResp = await fetch(fetchUrl);
        if (!videoResp.ok) {
          throw new Error(`Video API HTTP ${videoResp.status}`);
        }

        const videoData = await videoResp.json();
        const results = Array.isArray(videoData?.results)
          ? videoData.results
          : [];

        if (!results.length) {
          return res.json({
            response:
              "Boomer Sooner! I couldn’t find a match.\n\nTry:\n• Oklahoma highlights\n• Baker Mayfield Oklahoma\n• OU vs Alabama highlights"
          });
        }

        let reply = "Boomer Sooner! Here are some highlights:\n\n";
        results.forEach((v, i) => {
          reply += `🎬 ${i + 1}. ${v.title}\n${v.url}\n\n`;
        });

        return res.json({ response: reply.trim() });

      } catch (err) {
        console.error("Video API error:", err.message);
        return res.json({
          response: "Sorry, Sooner — I had trouble reaching the video library."
        });
      }
    }

    /* ==============================
       🔒 PRECISION BLOCK (NO LLM)
    ============================== */
    if (isPrecisionRequest(userText)) {
      return res.json({
        response:
          "I don’t want to guess on exact numbers. Want highlights or official stats instead?"
      });
    }

    /* ==============================
       🧠 LLM GATE (PLACEHOLDER)
    ============================== */
    if (isNarrativeQuestion(userText)) {
      // 🔜 LLM will be called here later
      return res.json({
        response:
          "That’s a great question. I’ll be able to explain moments like that soon — want highlights in the meantime?"
      });
    }

    /* ==============================
       FALLBACK
    ============================== */
    return res.json({
      response:
        "Want highlights, history, or why a moment mattered?"
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({
      response: "Sorry, Sooner — something went wrong on my end."
    });
  }
});

/* ==============================
   START SERVER
============================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
