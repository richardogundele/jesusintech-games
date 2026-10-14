// Keeps the whole game private: every request (pages, scripts, models, textures) needs the password.
// The password lives in the GAME_PASSWORD environment variable in Netlify, never in this repo.
// Fails closed: if GAME_PASSWORD isn't set, nobody gets in.
const challenge = (msg) => new Response(msg, {
  status: 401,
  headers: { 'WWW-Authenticate': 'Basic realm="The Dream Life", charset="UTF-8"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
});

function same(a, b) {
  // constant-time compare so the password can't be guessed by timing
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export default async (request) => {
  const pass = Netlify.env.get('GAME_PASSWORD');
  if (!pass) return challenge('This game is private.');
  const auth = request.headers.get('authorization') || '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const given = decoded.slice(decoded.indexOf(':') + 1); // any username, just the password matters
      if (same(given, pass)) return; // carry on to the game
    } catch { /* malformed header */ }
  }
  return challenge('This game is private.');
};

export const config = { path: '/*' };
