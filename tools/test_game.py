#!/usr/bin/env python3
"""Headless smoke test: load the game, collect console errors, drive forward,
capture screenshots, and dump telemetry."""
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = 'http://localhost:8741/index.html'
OUT = '/Users/lullu/mainpy/drive-game/data'

async def main():
    errors, logs = [], []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=['--use-gl=angle', '--enable-webgl'])
        page = await browser.new_page(viewport={'width': 1280, 'height': 760})
        page.on('console', lambda m: (errors if m.type == 'error' else logs).append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL)
        await page.wait_for_timeout(4500)   # world build
        await page.screenshot(path=f'{OUT}/shot_start.png')

        # drive: hold up arrow 8s with slight steering wiggle
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(6000)
        await page.keyboard.down('ArrowLeft')
        await page.wait_for_timeout(400)
        await page.keyboard.up('ArrowLeft')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f'{OUT}/shot_driving.png')

        tele = await page.evaluate('''() => {
            const v = window.__vehicle;
            if (!v) return null;
            return { speedKmh: v.speedKmh, rpm: v.rpm, gear: v.gear,
                     s: v.trackS, d: v.trackD, pos: [v.pos.x, v.pos.y, v.pos.z],
                     onTrack: v.onTrack, airborne: v.airborne,
                     comps: v.wheels.map(w => +w.comp.toFixed(3)),
                     contact: v.wheels.map(w => w.contact) };
        }''')
        await page.keyboard.up('ArrowUp')

        # chase cam screenshot
        await page.keyboard.press('KeyC')
        await page.keyboard.press('KeyC')
        await page.wait_for_timeout(800)
        await page.screenshot(path=f'{OUT}/shot_chase.png')

        await browser.close()

    print('ERRORS:', json.dumps(errors[:10], indent=1) if errors else 'none')
    print('TELEMETRY:', json.dumps(tele, indent=1))
    if errors or not tele or tele['speedKmh'] < 30:
        sys.exit(1)
    print('SMOKE TEST PASS')

asyncio.run(main())
