#!/usr/bin/env python3
"""Physics validation: straight-line accel, braking, hands-off stability."""
import asyncio, json
from playwright.async_api import async_playwright

URL = 'http://localhost:8741/index.html'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--use-gl=angle'])
        page = await browser.new_page(viewport={'width': 800, 'height': 500})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL)
        await page.wait_for_timeout(3500)
        await page.evaluate('() => window.__vehicle.reset(150)')   # Döttinger straight
        await page.wait_for_timeout(300)

        # full throttle from rest, sample every 250ms
        await page.keyboard.down('ArrowUp')
        samples = []
        for i in range(56):   # 14 s
            await page.wait_for_timeout(250)
            s = await page.evaluate(
                '() => { const v = window.__vehicle; return [v.speedKmh, v.trackD, v.rpm, v.gear, v.tcCut]; }')
            samples.append([round(i * 0.25 + 0.25, 2)] + [round(x, 2) for x in s])
        await page.keyboard.up('ArrowUp')

        # braking from current speed
        v0 = samples[-1][1]
        await page.keyboard.down('ArrowDown')
        brake = []
        for i in range(24):
            await page.wait_for_timeout(250)
            s = await page.evaluate('() => [window.__vehicle.speedKmh, window.__vehicle.trackD]')
            brake.append([round(x, 2) for x in s])
            if s[0] < 3: break
        await page.keyboard.up('ArrowDown')
        await browser.close()

    t100 = next((s[0] for s in samples if s[1] >= 100), None)
    t200 = next((s[0] for s in samples if s[1] >= 200), None)
    vmax = max(s[1] for s in samples)
    dmax = max(abs(s[2]) for s in samples)
    tstop = next((i * 0.25 + 0.25 for i, b in enumerate(brake) if b[0] < 5), None)
    print('errors:', errs or 'none')
    print(f'0-100 km/h: {t100}s   0-200: {t200}s   vmax(14s): {vmax:.0f} km/h')
    print(f'hands-off max |d| during accel: {dmax:.2f} m (road half=4.5)')
    print(f'braking {v0:.0f}->5 km/h: {tstop}s')
    print('t(s) v(km/h)   d(m)   rpm  gear tcCut')
    for s in samples[::4]: print(' '.join(f'{x:>7}' for x in s))

asyncio.run(main())
