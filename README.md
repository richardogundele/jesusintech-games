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
- M mute

## Where things live

- `src/worlds/monaco.js`, `src/worlds/dubai.js`: the maps
- `src/catalog.js`: cars, jets and routes (add a car here, then park it in a world's `garage`)
- `src/vehicle.js`: driving physics
- `src/state.js`: saved balance; `addFunds()` is the hook for real-life rewards (not wired yet)

## Credits

- Skies, textures and scenery models: [Poly Haven](https://polyhaven.com) (CC0)
- Ferrari 458 Italia model by vicent091036, via the three.js examples (original Sketchfab listing no longer online; keep this build private)
- Player character and animations: Mixamo "Vanguard" soldier, via the three.js examples (Soldier.glb). Add your own: see CHARACTER.md
- Pedestrians: "Cesium Man" from the Khronos glTF Sample Assets (CC-BY 4.0, Cesium)

## Privacy

Not deployed. Real brand names are used, so keep it private: put it behind auth before it goes on the `games` subdomain.
