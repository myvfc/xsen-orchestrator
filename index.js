import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

// ==============================
// MIDDLEWARE
// ==============================
app.use(cors({ origin: "*" }));
app.use(express.json());

// ==============================
// CONFIG
// ==============================
const PORT = process.env.PORT || 3000;

// MUST be something like:
// https://xsen-mcp-production.up.railway.app/videos
let VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL || "";

// normalize trailing slash bugs
VIDEO_AGENT_URL = VIDEO_AGENT_URL.replace(/\/+$/, "");

// ==============================
// HELPERS
// ==============================
function isVideoRequest(text = "") {
  return /(video|videos|highlight|highlights|clip|clips|replay|watch)/i.test(text);
}

function normalizeText(text = "") {
  // replace smart quotes that break matching
  return text.replace(/[“”‘’]/g, '"');
}

function refineVideoQuery(text = "") {
  return text
    .toLowerCase()

    // remove filler phrases
    .replace(/show me|watch|give me|find|please|can you|i want to see/gi, "")

    // normalize known players
    .replace(/baker mayfield|baker/gi, "baker mayfield oklahoma")

    // normalize teams
    .replace(/ou|soon ers|soon ers|sooners/gi, "oklahoma")

    // normalize highlights intent
    .replace(/videos?|clips?|replays?/gi, "")
    .replace(/highlights?/gi, "highlights")

    // opponents
    .replace(/bama|alabama/gi, "alabama")
    .replace(/texas|longhorns/gi, "texas")
    .replace(/osu|cowboys|pokes/gi, "oklahoma state")

    // cleanup
    .replace(/\s+/g, " ")
    .trim();
}



// ==============================
// HEALTH CHECK
// ==============================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    videoEndpoint: VIDEO_AGENT_URL || "NOT SET"
  });
});

// ==============================
// MAIN CHAT ENDPOINT
// ==============================
app.post("/chat", async (req, res) => {
  try {
    let userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    userText = normalizeText(userText);

    console.log("📨 Incoming message:", userText);

    if (!userText) {
      return res.json({
        response: "Boomer Sooner! What can I help you with?"
      });
    }

    // ==============================
    // 🎬 VIDEO ROUTING (REST)
    // ==============================
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);

      const fetchUrl =
        `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3`;

      console.log("🎬 VIDEO FETCH URL:", fetchUrl);

      try {
        const videoResp = await fetch(fetchUrl, { method: "GET" });

        if (!videoResp.ok) {
          throw new Error(`Video API HTTP ${videoResp.status}`);
        }

        const videoData = await videoResp.json();
        const results = Array.isArray(videoData?.results)
          ? videoData.results
          : [];

        console.log(`🎬 Video results returned: ${results.length}`);

        if (!results.length) {
          return res.json({
            response:
              "Boomer Sooner! I couldn’t find a matching highlight. Try another player or game."
          });
        }

        let reply = "Boomer Sooner! Here are some highlights:\n\n";

        results.forEach(v => {
          reply += `🎬 ${v.title}\n${v.url}\n\n`;
        });

        return res.json({
          response: reply.trim()
        });

      } catch (err) {
        console.error("❌ Video API error:", err.message);
        return res.json({
          response:
            "Sorry, Sooner — I had trouble reaching the video library."
        });
      }
    }

    // ==============================
    // DEFAULT RESPONSE
    // ==============================
    return res.json({
      response: `Boomer Sooner! I heard you say: "${userText}".`
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({
      response: "Sorry, Sooner — something went wrong on my end."
    });
  }
});

// ==============================
// START SERVER
// ==============================
app.listen(PORT, () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
