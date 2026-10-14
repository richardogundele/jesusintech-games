# The player character

You walk around as **Military_Male_06** from the Microsoft Rocketbox Avatar Library
(https://github.com/microsoft/Microsoft-Rocketbox, MIT License, Copyright (c) 2020 Microsoft).
The MIT notice ships with the game in `public/assets/character/ROCKETBOX-LICENSE.md`; keep it there.

## Files (`public/assets/character/`)

| File | What it is |
| --- | --- |
| `rocketbox.fbx` | the skinned avatar (`Export/Military_Male_06.fbx`, Bip01 biped rig, centimetres) |
| `rb_idle.fbx`, `rb_walk.fbx`, `rb_run.fbx`, `rb_sprint.fbx` | Rocketbox animation clips on the same rig |
| `body_color.jpg`, `body_normal.jpg`, `head_color.jpg`, `head_normal.jpg` | the avatar's TGA textures converted to JPG |

The raw downloads (TGAs etc.) are in `assets-src/rocketbox/` (gitignored).

## How it is wired

- `loadRocketbox` in `src/assets.js` loads the files, keeps only tracks for bones the model has, measures each
  clip's forward speed from the `Bip01` root track, then pins the root so the game moves you instead of the clip.
- `buildRocketboxSoldier` in `src/models.js` assigns the textures by material name (the FBX's own materials load
  black) and blends idle / walk (1.4 m/s) / run (3.1 m/s) / sprint (5.8 m/s) by your real speed, so feet don't slide.
- `buildPlayer` holds this avatar plus the built-in body from `src/character.js`. The phone's **Wardrobe** tab
  switches between "Realistic soldier" (this avatar), "Military uniform" (beret, pick the camouflage and skin tone)
  and "Jeans & sweatshirt".
- If `rocketbox.fbx` is missing the game falls back to the built-in body.

## Swapping in another Rocketbox avatar

Any avatar from the library uses the same Bip01 rig, so the same clips work. Copy its `Export/<Name>.fbx` to
`rocketbox.fbx`, convert its `<name>_body_color.tga`, `_body_normal.tga`, `_head_color.tga` and `_head_normal.tga`
to the four JPGs above, and refresh.
