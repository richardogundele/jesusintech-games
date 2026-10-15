// Tribe Fuego radio: a whole YouTube channel played through YouTube's own embedded player
// (the official IFrame API), so it works on the public site with no downloads and no
// copyright trouble. YouTube requires the player to stay visible, hence the small card in
// the HUD. Needs a user gesture before the first play (a phone button or the Enter button).
let apiReady = null;
function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

export class YtRadio {
  /** opts: { el (the card), host (the div the player replaces), station: { list, name }, onState(info|null) } */
  constructor(opts) {
    this.opts = opts;
    this.player = null;
    this.on = false;
    this.title = '';
    this.muted = false;
    this.shuffle = true;
  }

  async start() {
    this.on = true;
    this.opts.el.classList.remove('hidden');
    const YT = await loadApi();
    if (!this.on) return; // switched off while the API loaded
    if (this.player) { this.player.playVideo(); return; }
    this.player = new YT.Player(this.opts.host, {
      width: '100%', height: '100%',
      playerVars: { listType: 'playlist', list: this.opts.station.list, autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
      events: {
        onReady: (e) => { e.target.setShuffle(this.shuffle); if (this.muted) e.target.mute(); e.target.playVideo(); },
        onStateChange: (e) => {
          const d = e.target.getVideoData?.() || {};
          this.title = d.title || '';
          const playing = e.data === YT.PlayerState.PLAYING;
          this.opts.onState?.(playing ? { title: this.title } : null, e.data);
        },
        onError: () => this.next(),
      },
    });
  }

  stop() {
    this.on = false;
    this.player?.pauseVideo?.();
    this.opts.el.classList.add('hidden');
    this.opts.onState?.(null);
  }
  toggle() { return this.on ? this.stop() : this.start(); }
  next() { if (this.on) this.player?.nextVideo?.(); }
  prev() { if (this.on) this.player?.previousVideo?.(); }
  setShuffle(v) { this.shuffle = v; this.player?.setShuffle?.(v); }
  setMuted(m) { this.muted = m; if (!this.player) return; m ? this.player.mute() : this.player.unMute(); }
  get playing() { return this.on && this.player?.getPlayerState?.() === 1; }
}
