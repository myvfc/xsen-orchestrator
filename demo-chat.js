// ── demo-chat.js ──────────────────────────────────────────────────────────────
// Add this route to your existing Railway orchestrator (glorious-appreciation)
// Route: POST /demo-chat
// Body:  { message: string, school: string, schoolName: string }
//
// Requires: ANTHROPIC_API_KEY in Railway environment variables
// ─────────────────────────────────────────────────────────────────────────────

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Simple in-memory rate limiter (resets on deploy — fine for demo)
const rateLimitMap = new Map();
const RATE_LIMIT   = 20;   // max requests per IP per hour
const RATE_WINDOW  = 3600000; // 1 hour in ms

function isRateLimited(ip) {
  const now  = Date.now();
  const data = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - data.start > RATE_WINDOW) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  if (data.count >= RATE_LIMIT) return true;
  rateLimitMap.set(ip, { count: data.count + 1, start: data.start });
  return false;
}

function buildSystemPrompt(schoolName, schoolSlug) {
  return `You are the official AI fan companion for ${schoolName}, part of the XSEN sports network.

Your job is to answer fan questions about ${schoolName} sports — schedules, scores, rosters, history, highlights, and news.

RULES — follow these strictly:
1. ALWAYS use the web_search tool to find current information before answering factual questions about scores, schedules, rosters, injuries, or recent events. Never answer these from memory alone.
2. If web search returns no useful results, say clearly: "I don't have that information right now — I'll have better coverage once the full channel is live."
3. NEVER make up scores, stats, player names, or events. If uncertain, say so.
4. Only answer questions about ${schoolName} sports or XSEN. For off-topic questions, politely redirect.
5. Keep answers concise — 2-4 sentences max unless the fan asks for detail.
6. End responses with 2-3 suggested follow-up questions labeled: SUGGESTED:\n- Question 1\n- Question 2
7. You are a demo — if asked, you can acknowledge this is a preview of what fans would experience on a live channel.
8. Tone: enthusiastic, knowledgeable, fan-friendly. You're a superfan, not a press release.

School: ${schoolName} (slug: ${schoolSlug})
Current date context: use web search for anything time-sensitive.`;
}

async function demoChatHandler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST')   { res.writeHead(405); res.end('Method not allowed'); return; }

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }));
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

      // Sanitize
      const cleanMessage    = String(message).slice(0, 500);
      const cleanSchool     = String(school).slice(0, 50).toLowerCase().replace(/[^a-z0-9-]/g, '');
      const cleanSchoolName = String(schoolName || school).slice(0, 100);

      const response = await client.messages.create({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 600,
        system:     buildSystemPrompt(cleanSchoolName, cleanSchool),
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ],
        messages: [
          { role: 'user', content: cleanMessage }
        ]
      });

      // Extract text from response (may include tool_use blocks)
      const textContent = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: textContent || "I couldn't find that information right now — try asking something else." }));

    } catch (err) {
      console.error('[demo-chat] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', response: "Something went wrong — please try again." }));
    }
  });
}

module.exports = { demoChatHandler };

// ── HOW TO WIRE THIS INTO YOUR EXISTING SERVER ────────────────────────────────
//
// In your main server.js / index.js, add:
//
//   const { demoChatHandler } = require('./demo-chat');
//
//   // Inside your request router:
//   if (pathname === '/demo-chat' && req.method === 'POST') {
//     return demoChatHandler(req, res);
//   }
//
// Make sure ANTHROPIC_API_KEY is set in Railway environment variables.
// The @anthropic-ai/sdk package is likely already in your package.json.
// If not: npm install @anthropic-ai/sdk
// ─────────────────────────────────────────────────────────────────────────────
