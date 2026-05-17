const https = require('https');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── Rate limiter (in-memory, resets on deploy) ────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT   = 20;       // requests per IP per window
const RATE_WINDOW  = 3600000;  // 1 hour

function isRateLimited(ip) {
  const now  = Date.now();
  const data = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - data.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (data.count >= RATE_LIMIT) return true;
  rateLimitMap.set(ip, { count: data.count + 1, start: data.start });
  return false;
}

// ── System prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(schoolName, schoolSlug) {
  return `You are the official AI fan companion for ${schoolName}, part of the XSEN sports network.

Your job is to answer fan questions about ${schoolName} sports — schedules, scores, rosters, history, highlights, and news.

RULES — follow these strictly:
1. Use web search to find current information before answering factual questions about scores, schedules, rosters, injuries, or recent events. Never answer these from memory alone.
2. If you cannot find reliable information, say clearly: "I don't have that information right now — I'll have better coverage once the full channel is live."
3. NEVER make up scores, stats, player names, or events. If uncertain, say so.
4. Only answer questions about ${schoolName} sports or XSEN. For off-topic questions, politely redirect.
5. Keep answers concise — 2-4 sentences unless the fan asks for detail.
6. End every response with 2-3 suggested follow-up questions in this exact format:
SUGGESTED:
- Question 1
- Question 2
7. Tone: enthusiastic, knowledgeable, fan-friendly. You are a superfan, not a press release.
8. This is a demo — if asked, acknowledge it's a preview of what fans experience on a live XSEN channel.

School: ${schoolName} (slug: ${schoolSlug})`;
}

// ── OpenAI call with web search ───────────────────────────────────────────────
function callOpenAI(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: 'gpt-4o-search-preview',
      web_search_options: { search_context_size: 'medium' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  }
      ],
      max_tokens: 600
    });

    const options = {
      hostname: 'api.openai.com',
      path:     '/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) { reject(new Error(parsed.error.message)); return; }
          const text = parsed.choices?.[0]?.message?.content || '';
          resolve(text.trim());
        } catch(e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Route handler ─────────────────────────────────────────────────────────────
async function demoChatHandler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return; }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: 'Too many requests — please try again in a little while.' }));
    return;
  }

  if (!OPENAI_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ response: 'API key not configured.' }));
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { message, school, schoolName } = JSON.parse(body);

      if (!message || !school) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'message and school are required' }));
        return;
      }

      const cleanMessage    = String(message).slice(0, 500);
      const cleanSchool     = String(school).slice(0, 50).toLowerCase().replace(/[^a-z0-9-]/g, '');
      const cleanSchoolName = String(schoolName || school).slice(0, 100);

      const response = await callOpenAI(buildSystemPrompt(cleanSchoolName, cleanSchool), cleanMessage);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: response || "I couldn't find that right now — try asking something else." }));

    } catch (err) {
      console.error('[demo-chat] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: "Something went wrong — please try again in a moment." }));
    }
  });
}

module.exports = { demoChatHandler };

// ── WIRING ────────────────────────────────────────────────────────────────────
// In your main server.js / index.js add:
//
//   const { demoChatHandler } = require('./demo-chat');
//
//   if (pathname === '/demo-chat') return demoChatHandler(req, res);
//
// Uses your existing OPENAI_API_KEY env var. No new packages needed.
// ─────────────────────────────────────────────────────────────────────────────


