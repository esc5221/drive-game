import asyncio
from playwright.async_api import async_playwright
H = r"""
async () => {
  const T=window.__track,V=window.__Vehicle,CARS=window.__CARS,DT=1/240;
  T.poseAt=(s)=>({x:0,y:0,z:-s,tx:0,ty:0,tz:-1});
  T.query=(x,z,o)=>{o=o||{};o.s=-z;o.d=x;o.y=0;o.nx=0;o.ny=1;o.nz=0;o.tx=0;o.ty=0;o.tz=-1;o.rx=1;o.rz=0;o.surf=0;o.i=0;o.roll=0;return o;};
  const v=new V(T,CARS.f1); v.reset(0); v.auto=true; v.tc=true; v.abs=true;
  const cl=(x)=>Math.max(-1,Math.min(1,x));
  const log=[]; let t=0,nx=0,maxScrape=0;
  while(t<6){ v.ctrl.steer=cl(-(v.pos.x*0.05+v.vel.x*0.02)); v.ctrl.throttle=1; v.ctrl.brake=0; v.step(DT); t+=DT;
    if((v.scrape||0)>maxScrape)maxScrape=v.scrape||0;
    if(t>=nx){ log.push({t:+t.toFixed(2), kmh:+(Math.abs(v.speed)*3.6).toFixed(1), rpm:Math.round(v.rpm), gear:v.gear,
        x:+v.pos.x.toFixed(2), scr:+(v.scrape||0).toFixed(2), maxScr:+maxScrape.toFixed(2)});
      nx+=0.5; } }
  return log;
}
"""
async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--use-gl=angle']); p=await (await b.new_context()).new_page()
        await p.goto('http://localhost:8743/'); await p.wait_for_timeout(600)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__Vehicle', timeout=40000); await p.wait_for_timeout(400)
        for r in await p.evaluate(H): print(r)
        await b.close()
asyncio.run(main())
