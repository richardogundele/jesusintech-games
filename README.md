# The Dream Life (games.jesusintech.com)

Private 3D browser game. Monaco and Dubai, real cars and jets. Three.js + Vite, no downloaded assets: every model is built in code.

## Run

```
npm install
npm run dev
```

## Controls

- On foot: W/S walk, A/D turn, Shift run, E interact
- In a car: W/S drive and brake, A/D steer, Space handbrake (drift), E get out, C camera
- P or Tab: your phone (daily goals, log real wins, dealer, hangar, giving, driving lessons, profile)
- R: car radio. M: mute
- Driving lessons (Whitmore, England): Z/X indicators, Q check mirrors. Drive on the left; limits are in mph

## Where things live

- `src/worlds/monaco.js`, `src/worlds/dubai.js`: the maps
- `src/catalog.js`: cars, jets and routes (add a car here, then park it in a world's `garage`)
- `src/vehicle.js`: driving physics
- `src/state.js`: the save (one localStorage key; old saves are upgraded in place)
- `src/progress.js`, `src/phone.js`: daily goals, streaks, real-life wins, purchases, fame
- `src/trials.js`: time trials. `src/music.js`, `src/audio.js`: all sound is synthesised
- `src/worlds/uk.js`, `src/lessons.js`: the UK town and the driving-lesson engine (lessons are data at the top of lessons.js)

## Credits

- Skies, textures and scenery models: [Poly Haven](https://polyhaven.com) (CC0)
- Ferrari 458 Italia model by vicent091036, via the three.js examples (original Sketchfab listing no longer online; keep this build private)
- Player character and animations: Mixamo "Vanguard" soldier, via the three.js examples (Soldier.glb). Add your own: see CHARACTER.md
- Arena crowd: Mixamo "Michelle" via the three.js examples (Michelle.glb) and Cesium Man, rendered into an impostor atlas
- Pedestrians: "Cesium Man" from the Khronos glTF Sample Assets (CC-BY 4.0, Cesium)

## Privacy and hosting

Real brand names and an unlicensed Ferrari model are in here, so it must stay private.
`netlify/edge-functions/private.js` puts a password on every request (pages, scripts and models).
It reads the password from the `GAME_PASSWORD` environment variable in Netlify (scope: Functions) and
**fails closed**: until that variable is set, nobody can get in.

First deploy (from this folder, with your own Netlify login). Set the password *before* deploying:
edge functions only see environment values that existed when the deploy was made.

```bash
npx netlify-cli login
npx netlify-cli sites:create --name jesusintech-games
npx netlify-cli env:set GAME_PASSWORD "your-password-here" --scope functions
npx netlify-cli deploy --build --prod
```

If you set or change `GAME_PASSWORD` later in the Netlify UI (Project configuration > Environment variables,
scope must include Functions), run the deploy command again. Until then the site shows a password prompt
that no password gets past. That's the fail-closed setting doing its job.

After deploying, check both of these return 401 without the password:
`curl -I https://<site>.netlify.app/` and `curl -I https://<site>.netlify.app/assets/models/ferrari.glb`.
