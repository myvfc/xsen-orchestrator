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
   OPENAI CALL (RESPONSES API)
============================== */
async function callOpenAI(userText) {
  const systemPrompt = `
You are Boomer Bot, an Oklahoma Sooners fan guide.

You may explain history, legacy, and why moments mattered.
You must NOT invent statistics, scores, dates, or exact numbers.
If unsure, speak generally and honestly.
`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      temperature: 0.5,
      max_output_tokens: 300,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("❌ OpenAI raw error:", errText);
    throw new Error(`OpenAI API error ${res.status}`);
  }

  const data = await res.json();

  // 🔍 FULL RAW RESPONSE LOG (temporary – for debugging)
  console.log("🧠 OpenAI raw response:", JSON.stringify(data, null, 2));

  // ✅ SAFEST POSSIBLE EXTRACTION
  if (typeof data.output_text === "string") {
    return data.output_text;
  }

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "output_text" && part.text) {
            return part.text;
          }
        }
      }
    }
  }

  throw new Error("No usable text in OpenAI response");
}

/* ==============================
   HEALTHCHECKS
============================== */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "XSEN Orchestrator",
    uptime: process.uptime(),
    videoEndpoint: VIDEO_AGENT_URL || "NOT SET",
    llmEnabled: Boolean(OPENAI_API_KEY)
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

    console.log("🧠 LLM gate check:", {
      narrative: isNarrativeQuestion(userText),
      hasOpenAIKey: Boolean(OPENAI_API_KEY)
    });

    /* 🎬 VIDEO ROUTE */
    if (isVideoRequest(userText) && VIDEO_AGENT_URL) {
      const refinedQuery = refineVideoQuery(userText);
      const fetchUrl =
        `${VIDEO_AGENT_URL}?query=${encodeURIComponent(refinedQuery)}&limit=3`;

      const videoResp = await fetch(fetchUrl);
      if (!videoResp.ok) {
        return res.json({
          response: "Sorry, Sooner — I had trouble reaching the video library."
        });
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
    }

    /* 🔒 PRECISION BLOCK */
    if (isPrecisionRequest(userText)) {
      return res.json({
        response:
          "I don’t want to guess on exact numbers. Want highlights or official stats instead?"
      });
    }

    /* 🧠 OPENAI (GATED) */
    if (isNarrativeQuestion(userText) && OPENAI_API_KEY) {
      console.log("🧠 Calling OpenAI for:", userText);

      const llmReply = await callOpenAI(userText);
      if (llmReply) {
        return res.json({ response: llmReply.trim() });
      }
    }

    /* FALLBACK */
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
