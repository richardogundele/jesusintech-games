// Real-time AI driving instructor backed by Claude.
// Calls the Anthropic API directly from the browser (requires user's own API key).
// Rate-limited to one call per 8 seconds so it never spams during continuous play.

const STORE = 'dreamlife.coach.key';
const RATE_MS = 8000;
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 100;

const SYSTEM = `You are a friendly UK driving instructor coaching a learner in a browser-based driving simulator set in Kent, UK. The learner is driving on real UK roads.

Give SHORT, specific responses — 1-2 sentences, max 25 words. Be warm and direct.
- When they make a fault: tell them what to do differently next time, briefly.
- When they get a tip: add one practical detail that makes it stick.
- When they ask for advice: tell them the single most useful thing to do right now.
UK terminology: give way, roundabout, MSM (mirror-signal-manoeuvre), carriageway, slip road. Vary your praise language — don't say "Great job!" every time.`;

export class ClaudeCoach {
  constructor() {
    this._key = null;
    this._lastMs = 0;
    this._busy = false;
  }

  get key() {
    if (!this._key) try { this._key = localStorage.getItem(STORE); } catch { /* private mode */ }
    return this._key || null;
  }

  setKey(k) {
    this._key = k ? k.trim() : null;
    try { if (this._key) localStorage.setItem(STORE, this._key); else localStorage.removeItem(STORE); } catch { /* private mode */ }
  }

  ready() { return !!this.key; }
  hasStoredKey() { try { return !!localStorage.getItem(STORE); } catch { return false; } }

  /**
   * Ask the AI coach a question based on a game event and current context.
   * @param {{ type: 'fault'|'tip'|'hint'|'good', text?: string, sev?: string }} event
   * @param {{ speedMph?: number, limitMph?: number, gear?: any, indicator?: string }} ctx
   * @param {(text: string, done: boolean) => void} onText  called with streaming chunks then final
   */
  async ask(event, ctx = {}, onText) {
    if (!this.key) return;
    if (this._busy) return;
    if (Date.now() - this._lastMs < RATE_MS) return;
    this._lastMs = Date.now();
    this._busy = true;

    const prompt = buildPrompt(event, ctx);

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });

      if (!res.ok) {
        if (res.status === 401) onText('⚠ API key invalid — press J to update it', true);
        else if (res.status === 429) { /* rate limit from Anthropic — silently skip */ }
        return;
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '', text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop(); // keep the incomplete last line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const ev = JSON.parse(data);
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              text += ev.delta.text;
              onText(text, false);
            }
          } catch { /* malformed SSE chunk */ }
        }
      }
      if (text) onText(text, true);
    } catch { /* network error: silently skip */ }
    finally { this._busy = false; }
  }
}

function buildPrompt(event, ctx) {
  const parts = [];

  if (event.type === 'fault') {
    parts.push(`The driver just received a ${event.sev ?? 'driving'} fault: "${event.text}".`);
    parts.push('React to this fault with a brief coaching comment.');
  } else if (event.type === 'tip') {
    parts.push(`The simulator just showed this coaching tip: "${event.text}".`);
    parts.push('Add one practical detail to make this tip more memorable.');
  } else if (event.type === 'hint') {
    parts.push('The driver pressed the hint key and wants advice. Give specific guidance on the single most useful thing to do right now.');
  } else if (event.type === 'good') {
    parts.push(`The driver just did something right: ${event.text}. Give brief encouraging feedback.`);
  }

  if (ctx.speedMph != null) parts.push(`Current speed: ${ctx.speedMph} mph, speed limit: ${ctx.limitMph ?? 30} mph.`);
  if (ctx.gear != null && ctx.gear !== undefined) parts.push(`Current gear: ${ctx.gear}.`);
  if (ctx.indicator) parts.push(`Indicator: ${ctx.indicator}.`);
  if (ctx.junctionAhead) parts.push('There is a junction or roundabout ahead.');
  if (ctx.mode) parts.push(`Driving mode: ${ctx.mode}.`);

  return parts.join(' ');
}
