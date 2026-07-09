# Nürburgring Drive

First-person Nürburgring driving simulator (web + Android).

> **[drive-game.pages.dev](https://drive-game.pages.dev)**

![Nürburgring Drive](docs/hero.png)

A first-person driving simulator running on **real OpenStreetMap track geometry** —
Three.js rendering over a hand-written **240 Hz vehicle physics engine**. One
codebase, shipped to web and Android (Capacitor).

**System Overview — [drive-game.pages.dev/data/game_logic.html](https://drive-game.pages.dev/data/game_logic.html)**

**Build log — [drive-game.pages.dev/making](https://drive-game.pages.dev/making)** — the full session it was built in (Korean, with an English toggle).

## Features

- **Real tracks** — Nürburgring (20.7 km, OSM geometry + DEM elevation),
  Spa-Francorchamps, and a practice circuit.
- **Custom physics (240 Hz)** — raycast suspension, Pacejka combined-slip tires,
  clutch launch model, aerodynamics, per-surface and weather grip.
- **Weather & time** — noon, Eifel morning fog, sunset, night, rain (wet road +
  reduced grip), and night with street lighting.
- **Feel** — AudioWorklet waveguide engine sound, instrument cluster with shift
  lights, ghost laps, and a dynamic racing line.

## Run

```bash
npm install
npm run dev      # http://localhost:8741
npm run build    # → dist/
```

Android (Capacitor): `npm run build && npx cap sync android`, then Gradle `assembleDebug`.

## Controls

```
↑ / W       Throttle
↓ / S       Brake  (reverse at standstill)
← → / A D   Steer
Space       Handbrake
M           Auto / manual shift
C           Camera  (cockpit / hood / chase)
N           Weather / time of day
L           Racing line
G           Ghost lap
R           Reset to track
H           Help
```

## Data & Credits

- **Track geometry** — © [OpenStreetMap](https://www.openstreetmap.org/copyright)
  contributors, **ODbL 1.0** (derived via the Overpass API).
- **Elevation** — [open-elevation.com](https://open-elevation.com/) (SRTM, public domain).
- **Engine sound** — ported from
  [engine-sound-generator](https://github.com/Antonio-R1/engine-sound-generator)
  © Antonio-R1 (MIT).
- **Fonts** — Google Fonts: Doto, Space Grotesk, Space Mono, Noto Sans KR (OFL / Apache 2.0).

## License

Code is **MIT** (see [LICENSE](LICENSE)). Bundled track data is **ODbL 1.0**
(derived from OpenStreetMap).

Fan project, non-commercial. Car and track names and other marks belong to their
respective owners and are used for identification only — not affiliated with or
endorsed by Hyundai, Porsche, Nürburgring GmbH, or any trademark holder.

## Credits
- 3D model: ["Porsche 911 Carrera 4S"](https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf) by [Karol Miklas](https://sketchfab.com/karolmiklas), licensed [CC-BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) (recoloured; wheels split for physics binding).
- 3D model: ["2024 Hyundai Elantra N"](https://sketchfab.com/3d-models/2024-hyundai-elantra-n-4ba1b1b0eb844e318cc708ada1f2f51f) by [Ddiaz Design](https://sketchfab.com/ddiaz-design), licensed [CC-BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (recoloured; wheels rebound to physics).
