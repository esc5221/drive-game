import asyncio
from playwright.async_api import async_playwright
async def check(p, url, label):
    errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(url); 
    await p.wait_for_timeout(1500)
    print(f"{label:18} pageerrors: {errs[:3] if errs else 'none'}")
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--use-gl=angle'])
        c=await b.new_context()
        # main window: set track + go so it boots into driving
        p1=await c.new_page()
        await p1.goto('http://localhost:8743/'); await p1.wait_for_timeout(400)
        await p1.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        e1=[]; p1.on('pageerror', lambda e: e1.append(str(e)))
        await p1.reload(); await p1.wait_for_function('()=>!!window.__vehicle', timeout=40000); await p1.wait_for_timeout(1200)
        print(f"{'main /':18} pageerrors: {e1[:3] if e1 else 'none'}")
        # view window: ?eye=left
        p2=await c.new_page(); e2=[]; p2.on('pageerror', lambda e: e2.append(str(e)))
        await p2.goto('http://localhost:8743/?eye=left'); await p2.wait_for_function('()=>!!window.__vehicle', timeout=40000); await p2.wait_for_timeout(1500)
        print(f"{'view ?eye=left':18} pageerrors: {e2[:3] if e2 else 'none'}")
        await b.close()
asyncio.run(main())
