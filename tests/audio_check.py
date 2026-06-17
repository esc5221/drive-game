#!/usr/bin/env python3
"""Functional check that the new audio layers actually fire + measure signal
ranges to calibrate thresholds. Loads the built game (vite preview :8743, which
resolves the `three` import) and drives an ISOLATED vehicle+audio on a flat road.
Usage: python3 tests/audio_check.py [car ...]"""
import asyncio, sys
from playwright.async_api import async_playwright
CARS = sys.argv[1:] or ['avante', 'gt3', 'gt3rs', 'kart', 'f1']
PORT = 8743

HARNESS = r"""
async (carId) => {
  const V=window.__Vehicle, CARS=window.__CARS, A=window.__CarAudio; const DT=1/240;
  const T={};
  T.poseAt=(s)=>({x:0,y:0,z:-s,tx:0,ty:0,tz:-1});
  T.query=(x,z,o)=>{o=o||{};o.s=-z;o.d=x;o.y=0;o.nx=0;o.ny=1;o.nz=0;o.tx=0;o.ty=0;o.tz=-1;o.rx=1;o.rz=0;o.surf=0;o.i=0;o.roll=0;return o;};
  const v=new V(T,CARS[carId]); v.reset(0); v.auto=true; v.tc=true; v.abs=true;
  const a=new A(); a.start(); await new Promise(r=>setTimeout(r,300)); a.setEngine(CARS[carId]);
  const cnt={shift:0,shiftUp:0,shiftDown:0,thump:0,burst:0};
  const oS=a._triggerShift.bind(a); a._triggerShift=(up,rf)=>{cnt.shift++;if(up)cnt.shiftUp++;else cnt.shiftDown++;oS(up,rf);};
  const oT=a._thump.bind(a); a._thump=(f,g,d)=>{if(g>0.0005)cnt.thump++;oT(f,g,d);};
  const oB=a._burst.bind(a); a._burst=(ft,f,q,g,d)=>{if(g>0.0005)cnt.burst++;oB(ft,f,q,g,d);};
  let maxSusp=0,maxLand=0,maxLock=0; const gears=new Set();
  const st=(vv)=>{vv.ctrl.steer=Math.max(-1,Math.min(1,-(vv.pos.x*0.05+vv.vel.x*0.02)));};
  const step=(thr,br,sec)=>{let t=0;while(t<sec){st(v);v.ctrl.throttle=thr;v.ctrl.brake=br;v.ctrl.handbrake=false;v.step(DT);a.update(v,DT);t+=DT;
    maxSusp=Math.max(maxSusp,v.suspActivity||0);maxLand=Math.max(maxLand,v.landImpact||0);
    for(const w of v.wheels){if(w.contact&&w.slipRatio<0)maxLock=Math.max(maxLock,-w.slipRatio);}
    gears.add(v.gear);}};
  step(1,0,14); step(0,1,5); step(1,0,3);
  // forced jump: drop the road 2m for 0.4s so all wheels leave the ground,
  // then restore — verifies the landing-slam path fires.
  const baseQ=T.query; T.query=(x,z,o)=>{o=baseQ(x,z,o);o.y=-2;return o;};
  step(0,0,0.45); T.query=baseQ; step(0,0,1.2);
  const landThump=cnt.thump;
  return {cnt,landThump,maxSusp:+maxSusp.toFixed(3),maxLand:+maxLand.toFixed(3),maxLock:+maxLock.toFixed(3),gears:[...gears].sort((x,y)=>x-y),gearbox:a._gearbox};
}
"""

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-gl=angle', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        pg.on("pageerror", lambda e: print("PAGEERR", e))
        await pg.goto(f"http://localhost:{PORT}/"); await pg.wait_for_timeout(700)
        await pg.reload(); await pg.wait_for_function("()=>!!window.__Vehicle && !!window.__CarAudio", timeout=40000)
        await pg.wait_for_timeout(400)
        for c in CARS:
            r = await pg.evaluate(HARNESS, c)
            cn = r['cnt']
            print(f"{c:7s} gb={r['gearbox']:10s} shift={cn['shift']}(U{cn['shiftUp']}/D{cn['shiftDown']}) "
                  f"thump={cn['thump']} burst={cn['burst']} maxLand={r['maxLand']} "
                  f"maxLock={r['maxLock']} gears={r['gears']}")
        await b.close()
asyncio.run(main())
