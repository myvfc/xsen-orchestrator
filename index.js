import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();

// Middleware
app.use(cors({ origin: "*" }));
app.use(express.json());

// Config
const PORT = process.env.PORT || 3000;
const PMG_SECRET = process.env.PMG_SECRET;

const VIDEO_AGENT_URL = process.env.VIDEO_AGENT_URL;
const VIDEO_AGENT_KEY = process.env.VIDEO_AGENT_KEY;

// Helpers
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

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime()
  });
});

// Main chat endpoint
app.post("/chat", async (req, res) => {
  try {
    const auth = req.headers.authorization || "";
    const isPMG = auth === `Bearer ${PMG_SECRET}`;

    if (!isPMG && PMG_SECRET) {
      console.log("Browser UI request");
    }

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

    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);

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
          throw new Error("Video agent error");
        }

        const videoData = await videoResp.json();

        if (!videoData?.videos || videoData.videos.length === 0) {
          return res.json({
            response:
              "Boomer Sooner! I could not find a matching highlight."
          });
        }

        let reply = "Boomer Sooner! Here are some highlights:\n\n";
        videoData.videos.slice(0, 3).forEach(v => {
          reply += `${v.title}\n${v.url}\n\n`;
        });

        return res.json({ response: reply.trim() });

      } catch (err) {
        console.error("Video agent error:", err.message);
        return res.json({
          response:
            "Sorry, Sooner. I had trouble reaching the video library."
        });
      }
    }

    return res.json({
      response: `Boomer Sooner! I heard you say: "${userText}".`
    });

  } catch (err) {
    console.error("Orchestrator error:", err);
    return res.json({
      response: "Sorry, Sooner. Something went wrong."
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`XSEN Orchestrator running on port ${PORT}`);
});


