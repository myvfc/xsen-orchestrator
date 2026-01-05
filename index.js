import express from "express";

const app = express();
app.use(express.json());

// ==============================
// CONFIG
// ==============================
const PORT = process.env.PORT || 3000;
const PMG_SECRET = process.env.PMG_SECRET;

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
    // 1) Authenticate PMG
    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${PMG_SECRET}`) {
      console.warn("Unauthorized request");
      return res.status(401).json({
        reply: "Unauthorized."
      });
    }

    // 2) Extract user message
    const userText =
      req.body?.message?.text ||
      req.body?.message ||
      req.body?.text ||
      "";

    console.log("📨 Incoming message:", userText);

    // 3) Simple response (for now)
    if (!userText) {
      return res.json({
        reply: "Boomer Sooner! What can I help you with?"
      });
    }

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
