#!/usr/bin/env python3
"""Showroom capture loop — grabs fixed-view screenshots of a car (or reference GLB)
and stitches them into one grid image for visual iteration.
  usage: shot_car.py gt3rs out.png [color]
         shot_car.py src=tmp/ref/ferrari.glb out.png
Prereq: vite dev on 8741."""
import asyncio, sys
from playwright.async_api import async_playwright
from PIL import Image

target = sys.argv[1] if len(sys.argv) > 1 else 'gt3rs'
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/car_grid.png'
color = sys.argv[3] if len(sys.argv) > 3 else None
VIEWS = ['f34', 'side', 'rear34', 'front', 'rear', 'top']

async def main():
    qp = target if target.startswith('src=') else 'car=' + target
    if color: qp += '&color=' + color
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle'])
        ctx = await b.new_context(viewport={'width': 780, 'height': 480}, device_scale_factor=2)
        shots = []
        for v in VIEWS:
            p = await ctx.new_page()
            await p.goto(f'http://localhost:8741/showroom.html?{qp}&view={v}')
            await p.wait_for_function('()=>window.__ready', timeout=30000)
            await p.wait_for_timeout(350)
            path = f'/tmp/sv_{v}.png'
            await p.screenshot(path=path)
            shots.append(path)
            await p.close()
        await b.close()
    ims = [Image.open(s) for s in shots]
    w, h = ims[0].size
    grid = Image.new('RGB', (w * 3, h * 2), (25, 27, 30))
    for i, im in enumerate(ims):
        grid.paste(im, ((i % 3) * w, (i // 3) * h))
    grid.save(out)
    print('saved', out, grid.size)

asyncio.run(main())
