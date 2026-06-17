#!/usr/bin/env python3
"""Offline-render the engine synth at given rpm via headless Chromium, write wav.
Usage: python3 tests/engine_render.py <carId> <rpm> <thr> <dur> <out.wav>
Needs `npx vite preview --port 8743` (or any static server of repo root) running."""
import asyncio, sys, numpy as np
from scipy.io import wavfile
from playwright.async_api import async_playwright

carId, rpm, thr, dur, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
PORT = 8743

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        await pg.goto(f"http://localhost:{PORT}/tests/engine_render.html")
        await pg.wait_for_function("window.__ready === true", timeout=10000)
        data = await pg.evaluate(
            "async ([c,r,t,d]) => await window.__renderEngine(c,r,t,d)",
            [carId, rpm, thr, dur])
        await b.close()
    x = np.array(data, dtype=np.float64)
    x = x / (np.abs(x).max()+1e-9)
    wavfile.write(out, 48000, (x*32767).astype(np.int16))
    print(f"wrote {out}  {len(x)/48000:.2f}s rms={np.sqrt((x**2).mean()):.3f}")

asyncio.run(main())
