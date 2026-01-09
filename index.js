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

// Browser-safe Video API (REST, not MCP)
const VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL;
// Example:
// https://xsen-mcp-production.up.railway.app/videos

// ==============================
// HELPERS
// ==============================
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

// ==============================
// HEALTH CHECK
// ==============================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime()
  });
});

// ==============================
// MAIN CHAT ENDPOINT
// ==============================
app.post("/chat", async (req, res) => {
  try {
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    console.log("Incoming message:", userText);

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

      try {
        const url =
          `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3`;

        const videoResp = await fetch(url);

        if (!videoResp.ok) {
          throw new Error(`Video API HTTP ${videoResp.status}`);
        }

        const videoData = await videoResp.json();
        const results = videoData?.results || [];

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
        console.error("Video API error:", err.message);
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
    console.error("Orchestrator error:", err);
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
