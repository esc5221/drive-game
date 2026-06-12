#!/usr/bin/env python3
"""Final integration test: FPS, lap-line crossing, Karussell banking shot,
Fuchsröhre downhill cockpit shot, Karussell chase shot."""
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

        # FPS over 2s
        fps = await page.evaluate('''() => new Promise(res => {
            let n = 0; const t0 = performance.now();
            const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
                                 else res(n / 2); };
            requestAnimationFrame(tick);
        })''')

        # lap-line crossing: teleport just before finish, drive across
        await page.evaluate('() => window.__vehicle.reset(20650)')
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(5000)
        await page.keyboard.up('ArrowUp')
        cross = await page.evaluate('''() => { const v = window.__vehicle;
            return { s: v.trackS, lapTimerRunning: !!document.getElementById('lap-cur').textContent }; }''')

        # Fuchsröhre downhill, cockpit, at speed
        await page.evaluate('() => window.__vehicle.reset(6950)')
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(6000)
        await page.screenshot(path=f'{OUT}/shot_fuchsroehre.png')
        await page.keyboard.up('ArrowUp')

        # Karussell, chase cam, slow
        await page.evaluate('() => window.__vehicle.reset(14880)')
        await page.keyboard.press('KeyC'); await page.keyboard.press('KeyC')
        await page.keyboard.down('ArrowUp')
        await page.wait_for_timeout(3500)
        await page.screenshot(path=f'{OUT}/shot_karussell.png')
        await page.keyboard.up('ArrowUp')

        await browser.close()
    print('errors:', errs or 'none')
    print(f'FPS: {fps:.0f}')
    print('after finish-line cross: s =', round(cross['s'], 1))

asyncio.run(main())
