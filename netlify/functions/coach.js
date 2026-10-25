// Proxy for the AI driving coach — keeps the Anthropic key server-side.
// The game POSTs { prompt } to /.netlify/functions/coach and gets back { text }.
// package.json is "type": "module", so this is an ESM Netlify function.

const MODEL = 'claude-haiku-5-5';
const MAX_TOKENS = 100;

const SYSTEM = `You are a friendly UK driving instructor coaching a learner in a browser-based driving simulator set in Kent, UK. The learner is driving on real UK roads.

Give SHORT, specific responses — 1-2 sentences, max 25 words. Be warm and direct.
- When they make a fault: tell them what to do differently next time, briefly.
- When they get a tip: add one practical detail that makes it stick.
- When they ask for advice: tell them the single most useful thing to do right now.
UK terminology: give way, roundabout, MSM (mirror-signal-manoeuvre), carriageway. Vary your praise language.`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const key = process.env.CLAUDE_API_KEY;
  if (!key) return json({ error: 'not_configured' }, 503);

  let prompt;
  try { ({ prompt } = await req.json()); } catch { return json({ error: 'bad_request' }, 400); }
  if (!prompt) return json({ error: 'missing_prompt' }, 400);

  // an org-level key has to name the workspace it is billing to; a workspace-scoped key does not
  const workspace = process.env.CLAUDE_WORKSPACE_ID;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      ...(workspace ? { 'anthropic-workspace-id': workspace } : {}),
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  // workspaceSet says whether CLAUDE_WORKSPACE_ID reached this deploy; it never reveals the key
  if (!res.ok) return json({ error: 'upstream', status: res.status, workspaceSet: !!workspace, detail: await res.text() }, 502);

  const data = await res.json();
  return json({ text: data.content?.[0]?.text || '' });
};
