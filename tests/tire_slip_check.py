#!/usr/bin/env python3
"""
타이어 슬립 사운드 게이트 실측.

실제 nordschleife에서 격리 Vehicle을 코너 한계/드리프트/락업까지 몰아넣고,
audio.js가 쓰는 슬립 신호(latSlip=max|sin slipAngle|, longSlip=max|slipRatio|)와
'현재 공식'으로 계산한 squeal/scrub/lockup gain의 피크를 측정한다.
→ "슬립 소리가 안 들린다"가 게이트/스케일 탓인지 수치로 확인.

전제: dev/preview 서버가 떠 있어야 한다(기본 8741).
실행: python3 tests/tire_slip_check.py
"""
import asyncio, sys
from playwright.async_api import async_playwright
PORT = int(sys.argv[sys.argv.index('--port')+1]) if '--port' in sys.argv else 8741

HARNESS = r"""
async () => {
  const T=window.__track, V=window.__Vehicle, CARS=window.__CARS; const DT=1/240;
  const kmh=(v)=>Math.abs(v.speed)*3.6;
  const mk=(id,tc,abs)=>{const v=new V(T,CARS[id]);v.reset(200);v.auto=true;v.tc=tc;v.abs=abs;return v;};
  // 새 audio.js 공식(slipAngle 기반) 그대로 재현
  const ss=(e0,e1,x)=>{x=Math.max(0,Math.min(1,(x-e0)/(e1-e0)));return x*x*(3-2*x);};
  const squealGain=(maxSA,v,tcCut)=>{const speedF=0.3+0.7*ss(2,18,v);const sq=ss(0.05,0.18,maxSA);return Math.min(0.34,Math.pow(sq,1.15)*0.30*speedF+(tcCut||0)*0.07);};
  const scrubGain =(maxSR,maxSA,v)=>{const speedF=0.3+0.7*ss(2,18,v);const comb=Math.hypot(maxSR/0.10,maxSA/0.14);const sc=ss(0.8,1.7,comb);return Math.min(0.26,sc*0.22*speedF);};

  function run(id, mode){
    const tc = mode!=='limit_tcoff' && mode!=='drift' && mode!=='lockup';
    const abs = mode!=='lockup';
    const v=mk(id,tc,abs);
    // 가속
    let t=0; while(kmh(v)<150 && t<25){v.ctrl.steer=0;v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;}
    let maxSA=0,maxSR=0,maxSq=0,maxSc=0,maxLock=0,absFrames=0,tt=0,N=0;
    while(tt<3.0){
      if(mode==='lockup'){ v.ctrl.steer=0; v.ctrl.throttle=0; v.ctrl.brake=1; }
      else if(mode==='drift'){ v.ctrl.steer=1; v.ctrl.throttle=0.6; v.ctrl.brake=0; v.ctrl.handbrake=true; }
      else { v.ctrl.steer=1; v.ctrl.throttle=0.5; v.ctrl.brake=0; }   // 풀스티어 코너 한계
      v.step(DT); tt+=DT; N++;
      const spd=Math.abs(v.speed);
      let sa=0,sr=0,lock=0;
      for(const w of v.wheels){ if(!w.contact)continue;
        if(w.surf!==2){ sa=Math.max(sa,Math.abs(w.slipAngle)); sr=Math.max(sr,Math.abs(w.slipRatio)); }
        if(w.slipRatio<-0.10 && v.ctrl.brake>0.1)lock=Math.max(lock,-w.slipRatio);
      }
      if(v._absActive)absFrames++;
      maxSA=Math.max(maxSA,sa); maxSR=Math.max(maxSR,sr); maxLock=Math.max(maxLock,lock);
      maxSq=Math.max(maxSq,squealGain(sa,spd,v.tcCut));
      maxSc=Math.max(maxSc,scrubGain(sr,sa,spd));
    }
    return {id,mode,kmh:Math.round(kmh(v)),
            maxLat:+maxSA.toFixed(3),maxLong:+maxSR.toFixed(3),maxLock:+maxLock.toFixed(3),
            squealGain:+maxSq.toFixed(4),scrubGain:+maxSc.toFixed(4),
            absPct:Math.round(100*absFrames/N)};
  }
  const R=[];
  for(const id of ['gt3','avante']){
    for(const m of ['limit_tcon','limit_tcoff','drift','lockup']) R.push(run(id,m));
  }
  return R;
}
"""

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle'])
        p = await (await b.new_context()).new_page()
        errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_timeout(600)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__Vehicle', timeout=40000); await p.wait_for_timeout(800)
        R = await p.evaluate(HARNESS)
        await b.close()
    print(f"{'car/mode':22} {'kmh':>4} {'lat':>6} {'long':>6} {'lock':>6} {'squeal':>8} {'scrub':>7} {'abs%':>5}")
    print("-"*70)
    for r in R:
        print(f"{r['id']+'/'+r['mode']:22} {r['kmh']:>4} {r['maxLat']:>6} {r['maxLong']:>6} {r['maxLock']:>6} "
              f"{r['squealGain']:>8} {r['scrubGain']:>7} {r['absPct']:>5}")
    if errs: print("ERRORS:", errs[:3])

asyncio.run(main())
