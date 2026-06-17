# Show HN draft

**Title**

    Show HN: Web-based Nürburgring driving game – custom physics, synthesized sound

**URL**

    https://drive-game.pages.dev

**First comment** (post right after submitting)

---

A first-person Nürburgring driving game that runs in the browser. It leans arcade — keyboard/touch with assists, not a hardcore sim — but the parts I cared most about are the physics and the sound.

I like racing games with realistic engine behavior, but sometimes I just want a quick drive and can't find a good fit. I love slowroads.io — I wanted something similar but built around race track, so I made this.

Physics: a 240 Hz rigid body with raycast suspension, combined-slip tires, a clutch launch model, and aero/weather grip — none of it from a game engine. The five cars (Elantra N, 992 GT3 / GT3 RS, a kart, an F1 car) are tuned to their real 0–100 and top speed.

Sound is synthesized rather than recorded — the engine runs in an AudioWorklet, tuned per car against spectrograms of real onboard recordings. Brakes, tires, shifts, kerbs and the rev limiter are separate layers you can toggle. The track is real OpenStreetMap geometry with SRTM elevation.

Most of the code was written by Fable 5, then tuned and cleaned up afterward.

Source: https://github.com/esc5221/drive-game — press H for controls. Feedback welcome.
