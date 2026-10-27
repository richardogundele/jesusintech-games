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
- `src/songs.js`: your own music. The phone's Music tab takes audio files from your computer, keeps them in the browser (IndexedDB, never uploaded) and plays them in place of the radio; N skips
- `src/worlds/uk.js`, `src/lessons.js`: the UK town and the driving-lesson engine (lessons are data at the top of lessons.js)

## Credits

- Skies, textures and scenery models: [Poly Haven](https://polyhaven.com) (CC0)
- Kent roads, buildings, coastline and places: map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0. The derived file public/assets/kent/region.json (built by tools/kent-data.mjs) is itself offered under the ODbL (notice in public/assets/kent/ATTRIBUTION.txt)
- UK traffic signs and road markings: drawn in code (src/signs.js) to the Traffic Signs Regulations and General Directions 2016 and the Traffic Signs Manual; sign designs are Crown copyright, reproduced under the Open Government Licence v3.0
- Ferrari 458 Italia model by vicent091036, via the three.js examples (original Sketchfab listing no longer online; keep this build private)
- Lamborghini Revuelto: "Free Lamborghini Revuelto" by [ALIEEEN](https://sketchfab.com/ALIEEEN) on [Sketchfab](https://sketchfab.com/3d-models/free-lamborghini-revuelto-cf52245eb68f48daa909c7ad2a8deaa3), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); Draco/WebP-compressed, fitted and recoloured in the game (public/assets/models/cars, credits also in CREDITS.json there)
- Bugatti Chiron: "Free Bugatti Chiron" by [ALIEEEN](https://sketchfab.com/ALIEEEN) on [Sketchfab](https://sketchfab.com/3d-models/free-bugatti-chiron-374890e62c5a44e9a739ca638b6e0a18), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); Draco/WebP-compressed, fitted and recoloured in the game (public/assets/models/cars, credits also in CREDITS.json there)
- Rolls-Royce Cullinan: "Rolls Royce Cullinan" by [newvistudios](https://sketchfab.com/newvistudios) on [Sketchfab](https://sketchfab.com/3d-models/rolls-royce-cullinan-61f16a1d5be2403abcdd8fa552f730f7), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); Draco/WebP-compressed, fitted and recoloured in the game (public/assets/models/cars, credits also in CREDITS.json there)
- Mercedes-AMG G 63: "Mercedes-Benz G-Class G63 AMG" by [pranav27](https://sketchfab.com/pranav27) on [Sketchfab](https://sketchfab.com/3d-models/mercedes-benz-g-class-g63-amg-fa70ea228e5749c2b4951a895385b055), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); Draco/WebP-compressed, fitted and recoloured in the game (public/assets/models/cars, credits also in CREDITS.json there)
- Volkswagen Polo (learner car): "Volkswagen- Polo-GTI- Mk5- Typ-6R-2012" by [giuffrida.rosario](https://sketchfab.com/giuffrida.rosario) on [Sketchfab](https://sketchfab.com/3d-models/volkswagen-polo-gti-mk5-typ-6r-2012-021de920b682415c9de3737154cddedb), [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/); Draco/WebP-compressed, fitted and recoloured in the game (public/assets/models/cars, credits also in CREDITS.json there)
- Player character and animations: Military_Male_06 from the [Microsoft Rocketbox Avatar Library](https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License (full notice in public/assets/character/ROCKETBOX-LICENSE.md). See CHARACTER.md
- Wardrobe outfits (beret uniform, jeans and sweatshirt): a body built in code (src/character.js) on the skeleton and clips of the Mixamo "Vanguard" soldier, via the three.js examples (Soldier.glb)
- Arena crowd: Mixamo "Michelle" via the three.js examples (Michelle.glb) and Cesium Man, rendered into an impostor atlas
- Pedestrians: "Cesium Man" from the Khronos glTF Sample Assets (CC-BY 4.0, Cesium)

## Hosting

Live at **https://jesusintech.com/games** (public, no password; Richard chose this on 2026-10-14). The main site's netlify.toml proxies
`/games/*` to the `jesusintech-games` Netlify project with status 200, so the address bar stays on jesusintech.com. The game is built
for the `/games/` path (`base` and `outDir` in vite.config.js).
The Ferrari 458 model's licence is unconfirmed, so it only loads in local dev: production builds give the 458 a lofted body
and `vite.config.js` strips `ferrari.glb` / `ferrari_ao.png` from `dist`.

Deploys run from this folder (Netlify builds it with `npm run build`). Move `assets-src/`, `shots/` and `node_modules/` out of the folder
first (and delete `dist/`), or the upload is several hundred MB and can fail.

## Deploys

Live at https://driveuk.jesusintech.com. Netlify builds and deploys automatically on every push to `main` (`npm run build` → `dist/`).
