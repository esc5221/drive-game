import asyncio
from playwright.async_api import async_playwright
async def load(ctx, url, wait_veh):
    p = await ctx.new_page(); errs=[]
    p.on('pageerror', lambda e: errs.append(str(e)))
    await p.goto(url); await p.wait_for_timeout(500)
    if wait_veh:
        try: await p.wait_for_function('()=>!!window.__vehicle', timeout=15000)
        except: pass
    await p.wait_for_timeout(800)
    await p.close(); return errs
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--use-gl=angle']); ctx=await b.new_context()
        await ctx.add_init_script("localStorage.setItem('ns-track','nordschleife'); sessionStorage.setItem('ns-go','1');")
        e1=await load(ctx,'http://localhost:8741/',True)
        e2=await load(ctx,'http://localhost:8741/?screen=L',False)
        e3=await load(ctx,'http://localhost:8741/?screen=R',False)
        await b.close()
        print("main /        pageerrors:", e1[:3] if e1 else "none")
        print("view ?screen=L pageerrors:", e2[:3] if e2 else "none")
        print("view ?screen=R pageerrors:", e3[:3] if e3 else "none")
asyncio.run(main())
