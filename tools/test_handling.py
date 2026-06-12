#!/usr/bin/env python3
"""Handling test: steer tap at high speed must not spin the car;
sustained corner at moderate speed must track. Also fresh cockpit screenshot."""
import asyncio
from playwright.async_api import async_playwright

URL = 'http://localhost:8741/index.html'
OUT = '/Users/lullu/mainpy/drive-game/data'

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--use-gl=angle'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 760})
        errs = []
        page.on('pageerror', lambda e: errs.append(str(e)))
        await page.goto(URL)
        await page.wait_for_timeout(3500)
        await page.evaluate('() => window.__vehicle.reset(150)')   # straight
        await page.wait_for_timeout(300)

        # accelerate to ~170
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(11000)
        v0 = await page.evaluate('() => window.__vehicle.speedKmh')

        # steer tap 0.5 s at speed, keep throttle
        await page.keyboard.down('ArrowLeft')
        await page.wait_for_timeout(500)
        await page.keyboard.up('ArrowLeft')
        # watch yaw recovery for 2.5 s
        recov = []
        for i in range(10):
            await page.wait_for_timeout(250)
            s = await page.evaluate('''() => { const v = window.__vehicle;
                return [v.speedKmh, v.trackD, v.slipRear, v.angVel.y]; }''')
            recov.append([round(x, 2) for x in s])
        await page.keyboard.up('ArrowUp')
        await page.screenshot(path=f'{OUT}/shot_hispeed.png')

        # full reset to a twisty section: Hatzenbach (s ~ 3650)
        await page.evaluate('() => { window.__vehicle.reset(3700); }')
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(4000)
        await page.screenshot(path=f'{OUT}/shot_cockpit2.png')
        await page.keyboard.up('ArrowUp')

        await browser.close()
    print('errors:', errs or 'none')
    print(f'speed before tap: {v0:.0f} km/h')
    print('after-tap [v, d, slipRear, yawRate]:')
    for r in recov: print(' ', r)
    spin = any(abs(r[3]) > 1.2 for r in recov)
    off = any(abs(r[1]) > 6.8 for r in recov)
    print('SPIN' if spin else 'no spin', '| HIT WALL/OFF' if off else '| stayed near road')

asyncio.run(main())
