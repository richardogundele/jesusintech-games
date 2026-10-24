// Proxy for the AI driving coach — keeps the Anthropic API key server-side.
// Called by the game at /.netlify/functions/coach with { prompt: string }.
// Returns { text: string }.

const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 100;

const SYSTEM = `You are a friendly UK driving instructor coaching a learner in a browser-based driving simulator set in Kent, UK. The learner is driving on real UK roads.

Give SHORT, specific responses — 1-2 sentences, max 25 words. Be warm and direct.
- When they make a fault: tell them what to do differently next time, briefly.
- When they get a tip: add one practical detail that makes it stick.
- When they ask for advice: tell them the single most useful thing to do right now.
UK terminology: give way, roundabout, MSM (mirror-signal-manoeuvre), carriageway. Vary your praise language.`;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const key = process.env.CLAUDE_API_KEY;
  if (!key) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'not_configured' }),
    };
  }

  let prompt;
  try {
    ({ prompt } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, body: 'Bad request' };
  }
  if (!prompt) return { statusCode: 400, body: 'Missing prompt' };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      return { statusCode: res.status, body: await res.text() };
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    return { statusCode: 500, body: String(err) };
  }
};
