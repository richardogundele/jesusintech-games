// Real-time AI driving instructor.
//
// On games.jesusintech.com the request goes through /.netlify/functions/coach so the
// Anthropic key stays server-side (set in Netlify env as CLAUDE_API_KEY).
// As a local-dev fallback the user can paste their own key in the in-game setup panel;
// it is stored in localStorage and sent directly to api.anthropic.com only in that case.

const STORE = 'dreamlife.coach.key';
const RATE_MS = 8000;
const MODEL = 'claude-haiku-4-5';
const MAX_TOKENS = 100;

const SYSTEM = `You are a friendly UK driving instructor coaching a learner in a browser-based driving simulator set in Kent, UK. The learner is driving on real UK roads.

Give SHORT, specific responses — 1-2 sentences, max 25 words. Be warm and direct.
- When they make a fault: tell them what to do differently next time, briefly.
- When they get a tip: add one practical detail that makes it stick.
- When they ask for advice: tell them the single most useful thing to do right now.
UK terminology: give way, roundabout, MSM (mirror-signal-manoeuvre), carriageway. Vary your praise language.`;

export class ClaudeCoach {
  constructor() {
    this._key = null;       // localStorage key for direct-API fallback
    this._lastMs = 0;
    this._busy = false;
    this._proxyOk = null;   // null=unknown, true=works, false=unavailable
  }

  get key() {
    if (!this._key) try { this._key = localStorage.getItem(STORE); } catch { /* private mode */ }
    return this._key || null;
  }

  setKey(k) {
    this._key = k ? k.trim() : null;
    try { if (this._key) localStorage.setItem(STORE, this._key); else localStorage.removeItem(STORE); } catch { /* private mode */ }
  }

  hasKey() { return !!this.key; }

  /**
   * Ask the AI coach a question.
   * @param {{ type: 'fault'|'tip'|'hint'|'good', text?: string, sev?: string }} event
   * @param {{ speedMph?: number, limitMph?: number, gear?: any, indicator?: string }} ctx
   * @param {(text: string, done: boolean) => void} onText
   */
  async ask(event, ctx = {}, onText) {
    if (this._busy) return;
    if (Date.now() - this._lastMs < RATE_MS) return;
    this._lastMs = Date.now();
    this._busy = true;

    const prompt = buildPrompt(event, ctx);

    try {
      let text = null;

      // 1. Try the server-side proxy (works on games.jesusintech.com)
      if (this._proxyOk !== false) {
        text = await this._proxy(prompt);
      }

      // 2. Fall back to direct API call with localStorage key (local dev)
      if (text === null && this.key) {
        text = await this._direct(prompt);
      }

      if (text) onText(text, true);
    } finally {
      this._busy = false;
    }
  }

  async _proxy(prompt) {
    try {
      const r = await fetch('/.netlify/functions/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (r.status === 404) { this._proxyOk = false; return null; } // not on Netlify
      if (r.status === 503) { this._proxyOk = false; return null; } // key not configured on server
      if (!r.ok) return null;
      this._proxyOk = true;
      const data = await r.json();
      return data.text || null;
    } catch { return null; }
  }

  async _direct(prompt) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
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
        }),
      });
      if (!r.ok) {
        if (r.status === 401) return '⚠ API key invalid — press J to update it';
        return null;
      }
      const data = await r.json();
      return data.content?.[0]?.text || null;
    } catch { return null; }
  }
}

function buildPrompt(event, ctx) {
  const parts = [];

  if (event.type === 'fault') {
    parts.push(`The driver just received a ${event.sev ?? 'driving'} fault: "${event.text}". React with a brief coaching comment.`);
  } else if (event.type === 'tip') {
    parts.push(`The simulator showed this coaching tip: "${event.text}". Add one practical detail to make it stick.`);
  } else if (event.type === 'hint') {
    parts.push('The driver pressed the hint key and wants advice. Give the single most useful thing to do right now.');
  } else if (event.type === 'good') {
    parts.push(`The driver just did something right: ${event.text}. Give brief encouraging feedback.`);
  }

  if (ctx.speedMph != null) parts.push(`Speed: ${ctx.speedMph} mph, limit: ${ctx.limitMph ?? 30} mph.`);
  if (ctx.gear != null) parts.push(`Gear: ${ctx.gear}.`);
  if (ctx.indicator) parts.push(`Indicator: ${ctx.indicator}.`);
  if (ctx.junctionAhead) parts.push('Junction or roundabout ahead.');

  return parts.join(' ');
}
