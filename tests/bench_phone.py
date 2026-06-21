#!/usr/bin/env python3
"""On-device graphics benchmark via CDP. Connects to the phone's game WebView
(adb forward tcp:9222), cycles gfx configs (localStorage + reload), runs the
deterministic auto-drive, and reads window.__bench (GPU ms + fps + 1% low).
Prereq: app running + `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`."""
import asyncio, json
from playwright.async_api import async_playwright

PRESETS = {
    'ultra':  dict(pr=2.0, msaa=4, shadow=2048, soft=1, bloom=1, blur=1, mirror=2, trees=1.0, far=1.0,  aniso=8),
    'high':   dict(pr=2.0, msaa=4, shadow=1024, soft=0, bloom=1, blur=1, mirror=3, trees=0.7, far=0.85, aniso=4),
    'medium': dict(pr=1.5, msaa=2, shadow=512,  soft=0, bloom=1, blur=0, mirror=6, trees=0.7, far=0.85, aniso=4),
    'low':    dict(pr=1.0, msaa=0, shadow=0,    soft=0, bloom=0, blur=0, mirror=0, trees=0.4, far=0.6,  aniso=2),
}
BASE = PRESETS['high']
VARIANTS = {'pr': [1.0, 1.5, 2.0], 'msaa': [0, 2, 4], 'shadow': [0, 512, 1024, 2048],
            'soft': [0, 1], 'bloom': [0, 1], 'blur': [0, 1], 'trees': [0.4, 0.7, 1.0],
            'far': [0.6, 0.85, 1.0], 'aniso': [2, 4, 8], 'mirror': [0, 8, 3]}
configs = [('preset:' + n, PRESETS[n]) for n in ['low', 'medium', 'high', 'ultra']]
for k, vals in VARIANTS.items():
    for v in vals:
        if BASE[k] == v:
            continue
        c = dict(BASE); c[k] = v; configs.append((f'{k}={v}', c))

async def main():
    async with async_playwright() as pw:
        br = await pw.chromium.connect_over_cdp('http://localhost:9222')
        ctx = br.contexts[0]
        page = next((p for p in ctx.pages if 'localhost' in p.url), ctx.pages[0])
        backup = await page.evaluate("()=>localStorage.getItem('ns-gfx')")
        results = []
        for i, (label, gfx) in enumerate(configs):
            cfg = dict(gfx); cfg['preset'] = 'custom'
            await page.evaluate("(c)=>{localStorage.setItem('ns-gfx',JSON.stringify(c));localStorage.setItem('ns-bench','1');}", cfg)
            await page.reload()
            await page.wait_for_function("()=>!!window.__vehicle && !!window.__bench", timeout=25000)
            await page.wait_for_timeout(2500)                       # warmup (shader compile/JIT)
            await page.evaluate("()=>window.__benchReset && window.__benchReset()")
            await page.wait_for_timeout(6000)                       # measure window
            b = await page.evaluate("()=>window.__bench")
            results.append((label, b))
            print(f"[{i+1}/{len(configs)}] {label:14} gpu={b.get('gpuMs')}ms fps={b.get('avgFps')} low1={b.get('low1Fps')} ft={b.get('avgMs')}ms")
        # restore user settings
        await page.evaluate("(bak)=>{localStorage.removeItem('ns-bench'); if(bak)localStorage.setItem('ns-gfx',bak); else localStorage.removeItem('ns-gfx');}", backup)
        await page.reload()

        gpu_ok = any(b.get('gpuMs') for _, b in results)
        base = dict(results)[ 'preset:high']
        print("\n================ GRID (Galaxy Note 10 · 60Hz) ================")
        key = 'gpuMs' if gpu_ok else 'avgMs'
        unit = 'GPU ms' if gpu_ok else 'frame ms'
        print(f"{'config':16}{unit:>10}{'fps':>7}{'1%low':>7}{'Δ vs high':>11}")
        for label, b in results:
            val = b.get(key)
            d = (val - base.get(key)) if (val is not None and base.get(key) is not None) else None
            ds = f"{d:+.2f}" if d is not None else ''
            print(f"{label:16}{(val if val is not None else '-'):>10}{b.get('avgFps'):>7}{b.get('low1Fps'):>7}{ds:>11}")
        if not gpu_ok:
            print("\n(GPU timer query unsupported → frame-ms/fps only; 60Hz ceiling may hide light options)")

asyncio.run(main())
