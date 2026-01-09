import express from "express";
import cors from "cors";

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
   HELPERS
============================== */
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

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
   HEALTH CHECK
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    videoEndpoint: VIDEO_AGENT_URL || "NOT SET"
  });
});

// Railway-friendly health endpoint
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});


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

    /* ---------- VIDEO REQUEST ---------- */
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
            response: `Boomer Sooner! I couldn't find an exact match.

Try one of these:
• Oklahoma highlights
• Baker Mayfield Oklahoma
• OU vs Alabama highlights`
          });
        }

        let reply = "Boomer Sooner! Here are some highlights:\n\n";
        results.forEach(v => {
          reply += `🎬 ${v.title}\n${v.url}\n\n`;
        });

        return res.json({ response: reply.trim() });

      } catch (videoErr) {
        console.error("Video API error:", videoErr.message);
        return res.json({
          response: "Sorry, Sooner — I had trouble reaching the video library."
        });
      }
    }

    /* ---------- DEFAULT RESPONSE ---------- */
    return res.json({
      response: `Boomer Sooner! I heard you say: "${userText}".`
    });

  } catch (err) {
    console.error("Orchestrator error:", err);
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
