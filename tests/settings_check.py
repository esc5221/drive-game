import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--use-gl=angle']); p=await (await b.new_context()).new_page()
        errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto('http://localhost:8741/'); await p.wait_for_timeout(500)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__vehicle',timeout=15000); await p.wait_for_timeout(600)
        # open settings, go to Graphics tab, Triple sub-tab
        r = await p.evaluate("""async()=>{
          const fire=(el)=>el&&el.dispatchEvent(new MouseEvent('click',{bubbles:true}));
          document.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyP'}));
          await new Promise(r=>setTimeout(r,200));
          const tabs=[...document.querySelectorAll('.set-tab')].map(b=>b.textContent);
          // click Graphics main tab
          const g=[...document.querySelectorAll('.set-tab')].find(b=>b.textContent==='Graphics'); fire(g);
          await new Promise(r=>setTimeout(r,150));
          const subs=[...document.querySelectorAll('.set-subtabs .set-tab')].map(b=>b.textContent);
          const tri=[...document.querySelectorAll('.set-subtabs .set-tab')].find(b=>b.textContent==='Triple'); fire(tri);
          await new Promise(r=>setTimeout(r,150));
          const titles=[...document.querySelectorAll('#settings .set-title')].map(t=>t.textContent);
          const cardW=document.getElementById('settings-card').offsetWidth;
          return {tabs, subs, hasTriRows: titles.filter(t=>/angle|distance|Monitor|Bezel|Default|Triple|FOV/i.test(t)), cardW};
        }""")
        await b.close()
        print("main tabs:", r['tabs'])
        print("graphics sub-tabs:", r['subs'])
        print("triple rows:", r['hasTriRows'])
        print("card width:", r['cardW'])
        print("pageerrors:", errs[:3] if errs else "none")
asyncio.run(main())
