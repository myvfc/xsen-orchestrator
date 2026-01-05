import express from "express";

const app = express();
app.use(express.json());

// ==============================
// CONFIG
// ==============================
const PORT = process.env.PORT || 3000;
const PMG_SECRET = process.env.PMG_SECRET;

// Video agent config
const VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL;
const VIDEO_AGENT_KEY = process.env.VIDEO_AGENT_KEY;

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
    // 1️⃣ Authenticate PMG
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${PMG_SECRET}`) {
      console.warn("❌ Unauthorized request");
      return res.status(401).json({
        reply: "Unauthorized."
      });
    }

    // 2️⃣ Extract user message
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    console.log("📨 Incoming message:", userText);

    if (!userText) {
      return res.json({
        reply: "Boomer Sooner! What can I help you with?"
      });
    }

    // ==============================
    // 🎬 VIDEO ROUTING
    // ==============================
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);
      console.log("🎬 Video intent detected:", refinedQuery);

      try {
        const videoResp = await fetch(VIDEO_AGENT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(VIDEO_AGENT_KEY
              ? { Authorization: `Bearer ${VIDEO_AGENT_KEY}` }
              : {})
          },
          body: JSON.stringify({ query: refinedQuery })
        });

        if (!videoResp.ok) {
          throw new Error(`Video agent HTTP ${videoResp.status}`);
        }

        const videoData = await videoResp.json();

        if (!videoData?.videos || videoData.videos.length === 0) {
          return res.json({
            reply:
              "Boomer Sooner! I couldn’t find a matching highlight. Try another player or game."
          });
        }

        let reply = "Boomer Sooner! Here are some highlights:\n\n";
        videoData.videos.slice(0, 3).forEach(v => {
          reply += `🎬 ${v.title}\n${v.url}\n\n`;
        });

        return res.json({ reply: reply.trim() });
      } catch (err) {
        console.error("❌ Video agent error:", err.message);
        return res.json({
          reply:
            "Sorry, Sooner — I had trouble reaching the video library. Try again in a moment."
        });
      }
    }

    // ==============================
    // DEFAULT RESPONSE
    // ==============================
    return res.json({
      reply: `Boomer Sooner! I heard you say: "${userText}".`
    });

  } catch (err) {
    console.error("❌ Orchestrator error:", err);
    return res.json({
      reply: "Sorry, Sooner — something went wrong on my end."
    });
  }
});

// ==============================
app.listen(PORT, () => {
  console.log(`🚀 XSEN Orchestrator running on port ${PORT}`);
});
