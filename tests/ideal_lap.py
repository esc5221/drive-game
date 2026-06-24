#!/usr/bin/env python3
"""Ideal-lap solver: drive the GT3 RS around the practice track in the REAL
240Hz physics with a racing-line-following controller, sweeping grip-usage (α)
and look-ahead to push to the limit. Records the fastest clean lap's input/state
profile (steer/throttle/brake/speed/action per trackS) for the guide/watch modes.

Prereq: npx vite preview --port 8743 running.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright
PORT = 8743

HARNESS = r"""
async (args) => {
  const T = window.__track, V = window.__Vehicle, CARS = window.__CARS, RL = window.__raceLine;
  const DT = 1/240, n = T.n, step = T.step, total = T.total;
  const off = RL.offsets, va = RL.vAllowed;
  // racing-line world points
  const lx = new Float64Array(n), lz = new Float64Array(n);
  for (let i=0;i<n;i++){ lx[i]=T.px[i]+T.rx[i]*off[i]; lz[i]=T.pz[i]+T.rz[i]*off[i]; }
  const rot=(q,x,y,z)=>{const{x:qx,y:qy,z:qz,w}=q;const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
    return [x+w*tx+(qy*tz-qz*ty), y+w*ty+(qz*tx-qx*tz), z+w*tz+(qx*ty-qy*tx)];};
  const clamp=(v,a,b)=>v<a?a:v>b?b:v;

  // one lap. alpha = grip-usage on the speed target; kSteer/laBase tune the line follow.
  function runLap(p){
    const v = new V(T, CARS.gt3rs);
    v.reset(args.spawn); v.auto=true; v.tc=p.tc; v.abs=p.tc;
    let t=0, startDist=null, lapT=null, offCnt=0, steps=0, spun=false, rec=[];
    const maxT=170;
    // standing start: do up to 2 laps, measure the 2nd (rolling)
    let lap=0, lapStartDist=0, lapStartT=0, prevS=null;
    while(t<maxT){
      const q=T.query(v.pos.x, v.pos.z, {}); if(!q){ break; }
      const s=q.s, i=((Math.floor(s/step)%n)+n)%n;
      const spd=Math.abs(v.speed)*3.6;            // km/h
      // pure-pursuit: look ahead proportional to speed
      const la=clamp(p.laBase + spd*p.laK, 4, 22);
      const j=(i+Math.max(1,Math.floor(la/step)))%n;
      const fwd=rot(v.quat,0,0,-1);
      const dx=lx[j]-v.pos.x, dz=lz[j]-v.pos.z, dl=Math.hypot(dx,dz)||1;
      const cross=fwd[0]*(dz/dl)-fwd[2]*(dx/dl);  // sign: steer toward the line point
      v.ctrl.steer=clamp(cross*p.kSteer, -1, 1);
      // speed target: look ahead within braking distance and aim for the SLOWEST
      // allowed speed coming up (so we brake early enough for the corner), ×grip-usage.
      const spdMs=Math.abs(v.speed);
      const bd=Math.min(160, spdMs*spdMs/(2*11.5)+7);
      let vmin=va[i]||60;
      for(let d=4; d<bd; d+=4){ const k=(i+Math.floor(d/step))%n; const vv=va[k]; if(vv&&vv<vmin)vmin=vv; }
      const vt=vmin*3.6*p.alpha;                       // corner speed ceiling (lookahead)
      // ---- slip-limited longitudinal control with grip ellipse ----
      const di=v.drivenFront?0:2, w0=v.wheels[di], w1=v.wheels[di+1];
      const srDrv=(w0.contact&&w1.contact)?(w0.slipRatio+w1.slipRatio)/2:0;   // longitudinal (driven)
      let saMax=0; for(const w of v.wheels){ if(w.contact){ const a=Math.abs(w.slipAngle); if(a>saMax)saMax=a; } }
      const SR=0.11, SA=0.14;                          // tyre peak-grip slips
      const latUse=Math.min(1, saMax/SA);
      const longHead=Math.sqrt(Math.max(0, 1-latUse*latUse));   // ellipse: longitudinal headroom
      const srAllow=SR*longHead;                       // allowed driving slip given lateral load
      let thr=v.ctrl.throttle, brk=v.ctrl.brake, act='COAST';
      if(spd < vt-1){
        brk=0;
        thr = srDrv > srAllow+0.02 ? Math.max(0,thr-0.10) : Math.min(1,thr+0.07);  // traction-limited accel
        act = thr>0.05?'THROTTLE':'COAST';
      } else {
        thr=0;
        const lockLim=-SR*Math.max(0.3,longHead)*1.1;
        brk = srDrv < lockLim ? Math.max(0,brk-0.12) : Math.min(1,brk+0.10);       // ABS-style, trail-aware
        act = Math.abs(v.ctrl.steer)>0.25?'TRAIL':'BRAKE';
      }
      v.ctrl.throttle=thr; v.ctrl.brake=brk; v.ctrl.handbrake=false;
      v.step(DT); t+=DT; steps++;
      if(v.rollover){ spun=true; break; }
      if(!v.onTrack) offCnt++;
      // lap timing via distAccum (wraps not needed; physics accumulates forward dist)
      const d=v.distAccum;
      if(lap===0 && d>5){ lap=1; lapStartDist=d; lapStartT=t; }            // rolling-ish: start after launch
      if(lap===1 && d-lapStartDist >= total){ lapT=t-lapStartT; break; }   // one full lap measured
      // record state for the measured lap (downsample ~ every 3 m)
      if(lap===1){ const rd=Math.floor((d-lapStartDist)/3); if(rec.length<rd+1){
        rec.push({s:+s.toFixed(1), st:+v.ctrl.steer.toFixed(3), th:+thr.toFixed(2), br:+brk.toFixed(2), v:+spd.toFixed(1), a:act}); } }
    }
    return { lapT: lapT, offFrac:+(offCnt/Math.max(1,steps)).toFixed(3), spun, rec };
  }

  // sweep grip-usage α (and a couple of follow params); keep fastest CLEAN lap.
  const sweep=[];
  for(const alpha of args.alphas){
    let best=null;
    for(const kSteer of [3.0]){
      const r=runLap({alpha, kSteer, laBase:5, laK:0.22, tc:false});
      if(r.lapT && !r.spun) { if(!best || r.lapT<best.lapT) best={alpha,kSteer,...r}; }
    }
    sweep.push(best || {alpha, lapT:null, note:'no clean lap'});
  }
  // pick fastest clean with low off-track
  const clean=sweep.filter(s=>s.lapT && s.offFrac<0.08).sort((a,b)=>a.lapT-b.lapT);
  const best=clean[0]||null;
  return { sweep:sweep.map(s=>({alpha:s.alpha,lapT:s.lapT?+s.lapT.toFixed(2):null,off:s.offFrac??null,spun:!!s.spun})),
           best: best?{alpha:best.alpha,kSteer:best.kSteer,lapT:+best.lapT.toFixed(2),off:best.offFrac,points:best.rec.length}:null,
           bestRec: best?best.rec:null };
}
"""

async def main():
    async with async_playwright() as pw:
        b=await pw.chromium.launch(args=['--use-gl=angle'])
        p=await (await b.new_context()).new_page()
        errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_timeout(500)
        await p.evaluate("()=>{localStorage.setItem('ns-track','practice');localStorage.setItem('ns-car','gt3rs');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function("()=>!!window.__raceLine && !!window.__Vehicle", timeout=40000); await p.wait_for_timeout(400)
        spawn = await p.evaluate("()=>{const m=window.__track; return 20;}")
        alphas = [1.08,1.15,1.22,1.30,1.40]
        res = await p.evaluate(HARNESS, {"alphas":alphas, "spawn":spawn})
        await b.close()
    print("=== α sweep (practice · GT3 RS, real physics) ===")
    print(f"{'α':>6}{'lapT':>9}{'offTrack':>10}{'spun':>7}")
    for s in res['sweep']:
        print(f"{s['alpha']:>6}{(str(s['lapT'])if s['lapT']else'-'):>9}{(str(s['off'])if s['off'] is not None else'-'):>10}{('Y'if s['spun']else''):>7}")
    if res['best']:
        bb=res['best']; print(f"\nBEST clean lap: α={bb['alpha']} kSteer={bb['kSteer']} → {bb['lapT']}s (off {bb['off']}, {bb['points']} pts)")
        with open('/tmp/ideal_lap.json','w') as f: json.dump(res['bestRec'], f)
        print("profile → /tmp/ideal_lap.json")
    else:
        print("\n(no clean lap — controller/α needs tuning)")
    if errs: print("PAGEERR", errs[:2])

asyncio.run(main())
