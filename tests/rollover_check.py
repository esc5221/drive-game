#!/usr/bin/env python3
"""
가드레일 충돌 → 롤오버 거동 실측.

실제 nordschleife 트랙을 그대로 로드하고, 차를 가드레일 직전으로 옮긴 뒤
전진속도 + 측면속도를 조합해 비스듬히/측면으로 박게 한다. 충돌 후 4초간
차의 자세(bodyUp.y: 1=정상, 0=옆면, -1=완전뒤집힘)와 각속도, 부양 여부를
0.1초 간격으로 로깅한다.

사용자 가설: "벽에 박으면 살짝 기울며 옆면으로 서고, 그 뒤 거꾸로 뒤집힌다."
→ bodyUp.y 가 1 → ~0(옆) → 음수(뒤집힘)로 진행하는지, roll rate가 충돌
   임펄스로 튀는지를 본다.

전제: npx vite preview --port 8743 가 떠 있어야 한다.
실행: python3 tests/rollover_check.py [--cars avante,gt3]
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

PORT = 8743
CARS = sys.argv[sys.argv.index('--cars')+1].split(',') if '--cars' in sys.argv else ['avante', 'gt3']

HARNESS = r"""
async (carList) => {
  const T=window.__track, V=window.__Vehicle, CARS=window.__CARS; const DT=1/240;
  const kmh=(v)=>Math.abs(v.speed)*3.6;
  // quaternion으로 벡터 회전
  const rot=(q,vx,vy,vz)=>{const{x,y,z,w}=q;
    const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
    return [vx+w*tx+(y*tz-z*ty), vy+w*ty+(z*tx-x*tz), vz+w*tz+(x*ty-y*tx)];};
  const dot=(a,bx,by,bz)=>a[0]*bx+a[1]*by+a[2]*bz;
  const mk=(id)=>{const v=new V(T,CARS[id]);v.auto=true;v.tc=true;v.abs=true;return v;};

  // 결정적 측면 충돌 주입: 직선 가속 후 차를 벽 직전으로 옮기고 측면속도 부여
  function crash(id, S0, Vfwd, Vlat, side){
    const v=mk(id); v.reset(S0);
    // 목표 전진속도까지 직진 가속
    let t=0; while(kmh(v)<Vfwd*3.6 && t<25){v.ctrl.steer=0;v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;}
    // 현재 트랙 가로 기준
    const q=T.query(v.pos.x,v.pos.z,{}); if(!q) return null;
    const WALL=window.__WALL_D!=null?window.__WALL_D:6.9;
    // outward 단위(트랙 바깥) — side: +1 오른쪽 벽, -1 왼쪽 벽
    const ox=side*q.rx, oz=side*q.rz;
    // 차를 벽 직전(d≈side*(WALL-0.3))으로 가로 이동
    const targetD=side*(WALL-0.3); const shift=targetD-q.d;
    v.pos.x+=q.rx*shift; v.pos.z+=q.rz*shift;
    // 속도: 전진 + 측면 outward
    const fwd=rot(v.quat,0,0,-1);
    v.vel.x=fwd[0]*Vfwd+ox*Vlat; v.vel.z=fwd[2]*Vfwd+oz*Vlat; v.vel.y=0;
    // 충돌 후 4초 로깅
    const log=[]; let minUp=1, flipped=false, flipT=null, sideT=null;
    let tt=0, sample=0;
    while(tt<4.0){
      v.ctrl.steer=0; v.ctrl.throttle=0; v.ctrl.brake=0; v.step(DT); tt+=DT;
      const up=rot(v.quat,0,1,0); const upy=up[1];
      const fwdW=rot(v.quat,0,0,-1);
      const rollRate=dot([v.angVel.x,v.angVel.y,v.angVel.z],fwdW[0],fwdW[1],fwdW[2]);
      if(upy<minUp)minUp=upy;
      if(sideT==null && upy<0.35) sideT=+tt.toFixed(2);
      if(!flipped && upy<-0.2){flipped=true; flipT=+tt.toFixed(2);}
      if(tt>=sample){
        log.push({t:+tt.toFixed(2),kmh:Math.round(kmh(v)),upy:+upy.toFixed(2),
                  roll:+rollRate.toFixed(2),air:v.airborne?1:0,scr:+(v.scrape||0).toFixed(2)});
        sample+=0.25;
      }
    }
    return {id,S0,Vfwd,Vlat,side,minUp:+minUp.toFixed(2),sideT,flipped,flipT,
            finalUp:+rot(v.quat,0,1,0)[1].toFixed(2),log};
  }

  // 격렬한 측면 슬램: yaw(스핀) 동반 + 강한 측면속도
  function slam(id, S0, Vfwd, Vlat, yaw, side){
    const v=mk(id); v.reset(S0);
    let t=0; while(kmh(v)<Vfwd*3.6 && t<25){v.ctrl.steer=0;v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;}
    const q=T.query(v.pos.x,v.pos.z,{}); if(!q) return null;
    const WALL=window.__WALL_D!=null?window.__WALL_D:6.9;
    const ox=side*q.rx, oz=side*q.rz;
    const targetD=side*(WALL-0.3); const shift=targetD-q.d;
    v.pos.x+=q.rx*shift; v.pos.z+=q.rz*shift;
    const fwd=rot(v.quat,0,0,-1);
    v.vel.x=fwd[0]*Vfwd+ox*Vlat; v.vel.z=fwd[2]*Vfwd+oz*Vlat; v.vel.y=0;
    v.angVel.y=yaw;                         // 스핀 부여 (차체 측면이 벽으로)
    const log=[]; let minUp=1, flipped=false, flipT=null, sideT=null, recT=null, tt=0, sample=0;
    while(tt<6.0){
      v.ctrl.steer=0; v.ctrl.throttle=0; v.ctrl.brake=0; v.step(DT); tt+=DT;
      if(v.rollover && recT==null){ recT=+tt.toFixed(2); v.reset(v.trackS); }  // 게임루프 자동회복 모사
      const upy=rot(v.quat,0,1,0)[1]; const fwdW=rot(v.quat,0,0,-1);
      const rollRate=dot([v.angVel.x,v.angVel.y,v.angVel.z],fwdW[0],fwdW[1],fwdW[2]);
      if(upy<minUp)minUp=upy;
      if(sideT==null && upy<0.35) sideT=+tt.toFixed(2);
      if(!flipped && upy<-0.2){flipped=true; flipT=+tt.toFixed(2);}
      if(tt>=sample){log.push({t:+tt.toFixed(2),kmh:Math.round(kmh(v)),upy:+upy.toFixed(2),
                  roll:+rollRate.toFixed(2),air:v.airborne?1:0,scr:+(v.scrape||0).toFixed(2)}); sample+=0.25;}
    }
    return {id,S0,Vfwd,Vlat,yaw,side,minUp:+minUp.toFixed(2),sideT,flipped,flipT,recT,
            finalUp:+rot(v.quat,0,1,0)[1].toFixed(2),log,kind:'slam'};
  }

  // 실주행: 풀스로틀 + 풀스티어 유지하다 벽에 자연 충돌 (tc on/off)
  function steerInto(id, S0, Vfwd, dir, tc){
    const v=mk(id); v.reset(S0); v.tc=tc;
    let t=0; while(kmh(v)<Vfwd*3.6 && t<25){v.ctrl.steer=0;v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;}
    const WALL=window.__WALL_D!=null?window.__WALL_D:6.9;
    const log=[]; let minUp=1, flipped=false, flipT=null, sideT=null, hitT=null, recT=null, tt=0, sample=0;
    while(tt<7.0){
      v.ctrl.steer=dir; v.ctrl.throttle=0.6; v.ctrl.brake=0; v.step(DT); tt+=DT;
      if(v.rollover && recT==null){ recT=+tt.toFixed(2); v.reset(v.trackS); }  // 게임루프 자동회복 모사
      const q=T.query(v.pos.x,v.pos.z,{});
      const upy=rot(v.quat,0,1,0)[1];
      if(q && hitT==null && Math.abs(q.d)>WALL-0.5) hitT=+tt.toFixed(2);
      if(upy<minUp)minUp=upy;
      if(sideT==null && upy<0.35) sideT=+tt.toFixed(2);
      if(!flipped && upy<-0.2){flipped=true; flipT=+tt.toFixed(2);}
      if(hitT!=null && tt>=sample){
        const fwdW=rot(v.quat,0,0,-1);
        const rollRate=dot([v.angVel.x,v.angVel.y,v.angVel.z],fwdW[0],fwdW[1],fwdW[2]);
        log.push({t:+tt.toFixed(2),kmh:Math.round(kmh(v)),upy:+upy.toFixed(2),
                  roll:+rollRate.toFixed(2),air:v.airborne?1:0,d:q?+q.d.toFixed(1):0}); sample=tt+0.25;}
    }
    return {id,S0,Vfwd,dir,tc,hitT,minUp:+minUp.toFixed(2),sideT,flipped,flipT,recT,
            finalUp:+rot(v.quat,0,1,0)[1].toFixed(2),log,kind:'steer'};
  }

  const R={};
  for(const id of carList){
    R[id]=[];
    const cases=[
      [400, 40, 4,  +1],
      [400, 40, 8,  +1],
      [200, 25, 6,  +1],
      [600, 55, 5,  +1],
    ];
    for(const [S0,vf,vl,sd] of cases){ const r=crash(id,S0,vf,vl,sd); if(r)R[id].push(r); }
    // 격렬한 스핀 슬램
    for(const [S0,vf,vl,yw,sd] of [[400,40,15,4,+1],[400,40,20,6,+1],[600,55,18,5,+1],[200,28,12,3,+1]]){
      const r=slam(id,S0,vf,vl,yw,sd); if(r)R[id].push(r);
    }
    // 실주행 풀스티어 (tc on/off)
    for(const [S0,vf,dr,tc] of [[200,45,1,true],[200,45,1,false],[400,55,-1,false]]){
      const r=steerInto(id,S0,vf,dr,tc); if(r)R[id].push(r);
    }
  }
  return R;
}
"""

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle'])
        p = await (await b.new_context()).new_page()
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_timeout(700)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__Vehicle', timeout=40000); await p.wait_for_timeout(400)
        # WALL_D 노출 (track 모듈 상수)
        await p.evaluate("async()=>{const m=await import('./js/track.js').catch(()=>null); if(m&&m.WALL_D!=null)window.__WALL_D=m.WALL_D;}")
        R = await p.evaluate(HARNESS, CARS)
        await b.close()

    for cid in CARS:
        print(f"\n━━━ {cid} ━━━")
        for r in R[cid]:
            rec = r.get('recT')
            tag = ("REC" if rec is not None else "FLIP") if r['flipped'] else ("SIDE" if r['sideT'] is not None else "ok")
            kind = r.get('kind', 'crash')
            if kind == 'steer':
                desc = f"steer dir={r['dir']:+d} tc={r['tc']} Vf={r['Vfwd']} hitT={r['hitT']}"
            elif kind == 'slam':
                desc = f"slam Vf={r['Vfwd']} Vlat={r['Vlat']} yaw={r['yaw']}"
            else:
                desc = f"crash Vf={r['Vfwd']} Vlat={r['Vlat']} side={r['side']:+d}"
            print(f"  [{tag:4}] {desc:40} minUp={r['minUp']:+.2f} finalUp={r['finalUp']:+.2f} "
                  f"flipT={r['flipT']} recT={rec}")
            traj = " ".join(f"{s['t']}:u{s['upy']:+.2f}/r{s['roll']:+.1f}/a{s['air']}" for s in r['log'])
            print(f"         {traj}")
    if errs: print("\nPAGE ERRORS:", errs[:3])

asyncio.run(main())
