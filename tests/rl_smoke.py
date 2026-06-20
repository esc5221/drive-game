import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle'])
        p = await (await b.new_context()).new_page()
        errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto('http://localhost:8741/'); await p.wait_for_timeout(600)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__track', timeout=40000); await p.wait_for_timeout(1500)
        stats = await p.evaluate("""async()=>{
          const m=await import('/js/raceline.js'); const t=window.__track;
          const d=m.racingLineOffsets(t);
          let mx=0,sum=0,nz=0,bad=0;
          for(let i=0;i<d.length;i++){const a=Math.abs(d[i]); if(!isFinite(d[i])||a>3.12)bad++; if(a>mx)mx=a; sum+=a; if(a>0.5)nz++;}
          return {n:d.length, maxAbs:+mx.toFixed(2), avgAbs:+(sum/d.length).toFixed(2), fracOffCenter:+(nz/d.length).toFixed(2), bad};
        }""")
        await b.close()
        print("offsets:", stats)
        print("pageerrors:", errs[:4] if errs else "none")
asyncio.run(main())
