# The Dream Life

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

## Hosting

Live at https://jesusintech-games.netlify.app (Netlify project `jesusintech-games`, public, no password; Richard chose this on 2026-10-14).
The Ferrari 458 model's licence is unconfirmed, so it only loads in local dev: production builds give the 458 a lofted body
and `vite.config.js` strips `ferrari.glb` / `ferrari_ao.png` from `dist`.

Deploys run from this folder (Netlify builds it with `npm run build`). Move `assets-src/` and `shots/` out of the folder
first or the upload is ~400 MB.
