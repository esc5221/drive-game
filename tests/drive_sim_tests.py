#!/usr/bin/env python3
"""
주행/변속 종합 시나리오 테스트 스위트.

물리 엔진을 무한 평탄 직선으로 격리(트랙 쿼리 패치)해, 차량 거동을 결정적으로
측정하고 PASS/FAIL을 자동 판정한다. 변속 로직(업/다운/킥다운/코스팅/브레이킹),
런치, 후진 버그, 오버레브 등 "있을 만한 상황"을 망라한다.

전제: `npx vite preview --port 8743` 가 떠 있어야 한다.
실행: python3 tests/drive_sim_tests.py [--cars avante,gt3,kart,f1]
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

PORT = 8743
CARS = sys.argv[sys.argv.index('--cars')+1].split(',') if '--cars' in sys.argv else ['avante', 'gt3']

# ── 브라우저에서 실행할 시뮬레이터 (트랙=무한 평탄 직선으로 격리) ──────────────
HARNESS = r"""
async (carList) => {
  const T=window.__track, V=window.__Vehicle, CARS=window.__CARS; const DT=1/240;
  // 차종별 속도역(top이 크게 달라 동일 속도 시나리오는 부적합)
  const SPD = {
    avante:{cruise:[50,90,140], corner:[[150,55],[110,40],[80,45]]},
    gt3:   {cruise:[60,110,170], corner:[[180,60],[120,40],[90,50]]},
    kart:  {cruise:[40,70,110], corner:[[120,50],[85,40],[55,30]]},
    f1:    {cruise:[80,150,240], corner:[[250,90],[180,70],[130,75]]},
  };
  T.poseAt=(s)=>({x:0,y:0,z:-s,tx:0,ty:0,tz:-1});
  T.query=(x,z,o)=>{o=o||{};o.s=-z;o.d=x;o.y=0;o.nx=0;o.ny=1;o.nz=0;o.tx=0;o.ty=0;o.tz=-1;o.rx=1;o.rz=0;o.surf=0;o.i=0;o.roll=0;return o;};
  const mk=(id)=>{const v=new V(T,CARS[id]);v.reset(0);v.auto=true;v.tc=true;v.abs=true;return v;};
  const st=(v)=>{v.ctrl.steer=Math.max(-1,Math.min(1,-(v.pos.x*0.05+v.vel.x*0.02)));};
  const kmh=(v)=>Math.abs(v.speed)*3.6;
  const spinTo=(v,k)=>{let t=0;while(kmh(v)<k&&t<45){st(v);v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;}return t;};
  const drive=(v,thr,br,sec,onstep)=>{let t=0;while(t<sec){st(v);v.ctrl.throttle=thr;v.ctrl.brake=br;v.ctrl.handbrake=false;v.step(DT);t+=DT;if(onstep)onstep(v,t);}};

  function maxRpmDuring(v,thr,br,sec){let m=0;drive(v,thr,br,sec,(vv)=>{if(vv.rpm>m)m=vv.rpm;});return m;}

  const R={};
  for (const id of carList){
    const rl=CARS[id].engine.redline, ng=CARS[id].gears.length;
    const spd=SPD[id]||SPD.gt3;
    const c={redline:rl, gears:ng};

    // A. 런치 + 드래그: 0-100/200, 출발 첫 3초 1→2 오접변속, 풀스로틀 변속 rpm
    {
      const v=mk(id); let t=0,t100=null,t200=null,bad=0,pg=1; const ups=[]; let maxr=0;
      while(t<40){st(v);v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t+=DT;
        if(v.rpm>maxr)maxr=v.rpm;
        if(t<3 && v.gear>=2 && kmh(v)<25)bad++;        // 저속에 2단↑ = 오접변속
        if(v.gear!==pg){if(v.gear>pg)ups.push(Math.round(v.rpm));pg=v.gear;}
        if(t100==null&&kmh(v)>=100)t100=t; if(t200==null&&kmh(v)>=200)t200=t;
        if(kmh(v)>250 || (t>14 && v.gear>=ng))break;}   // 저속차는 톱기어 도달 시 종료
      c.launch={t100:t100&&+t100.toFixed(2),t200:t200&&+t200.toFixed(2),
                falseShiftFrames:bad, upshiftRpm:ups, maxRpm:Math.round(maxr)};
    }

    // B. 부분스로틀 가속: 레드라인까지 안 끌고 중간 rpm에서 변속(레이싱식: 살살
    //    밟으면 일찍, 확 밟으면 끝까지). rl*0.85 미만에서 변속하면 OK.
    {
      const v=mk(id); let t=0,pg=1; const ups=[];
      while(t<30){st(v);v.ctrl.throttle=0.4;v.ctrl.brake=0;v.step(DT);t+=DT;
        if(v.gear>pg){ups.push(Math.round(v.rpm));pg=v.gear;} if(kmh(v)>130)break;}
      c.partThrottle={upshiftRpm:ups};
    }

    // C. 정속 크루징: 안착 기어/rpm + 헌팅 횟수. 풀스로틀 도달 후 2초 안정화
    //    (저단→적정기어 정리변속 제외) 다음, 정상상태 8초의 헌팅만 카운트.
    c.cruise={};
    const holdThrottle=(v,tV)=>{const e=tV-v.speed;v.ctrl.throttle=Math.max(0,Math.min(1,0.25+e*0.045));v.ctrl.brake=e<-3?0.15:0;};
    for (const k of spd.cruise){
      const v=mk(id); spinTo(v,k); const tV=k/3.6;
      let t0=0;while(t0<2.5){st(v);holdThrottle(v,tV);v.step(DT);t0+=DT;}    // 안정화
      let shifts=0,pg=v.gear,t=0;
      while(t<8){st(v);holdThrottle(v,tV);v.step(DT);t+=DT;if(v.gear!==pg){shifts++;pg=v.gear;}}
      c.cruise[k]={gear:v.gear,rpm:Math.round(v.rpm),hunts:shifts};
    }

    // D. 코너 브레이킹: 순차 다운, 최저 기어, 탈출 기어, 오버레브
    c.corner={};
    for (const [a,b] of spd.corner){
      const v=mk(id); spinTo(v,a); const seq=[]; let pg=v.gear,minG=v.gear,maxr=0,t=0;
      while(kmh(v)>b && t<14){st(v);v.ctrl.throttle=0;v.ctrl.brake=0.85;v.step(DT);t+=DT;
        if(v.rpm>maxr)maxr=v.rpm; if(v.gear!==pg){seq.push([v.gear,Math.round(kmh(v))]);if(v.gear<minG)minG=v.gear;pg=v.gear;}}
      // 탈출 가속
      let t2=0;while(t2<1.2){st(v);v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t2+=DT;}
      c.corner[`${a}_${b}`]={seq,minGear:minG,exitGear:v.gear,exitKmh:Math.round(kmh(v)),maxRpm:Math.round(maxr)};
    }

    // E. 코스팅(발 뗌, 브레이크X): 톱기어 폭주 X, 기어 유지/정리
    c.coast={};
    for (const k of [120,80]){
      const v=mk(id); spinTo(v,k); const g0=v.gear; let maxG=v.gear,t=0;
      while(t<5){st(v);v.ctrl.throttle=0;v.ctrl.brake=0;v.step(DT);t+=DT;if(v.gear>maxG)maxG=v.gear;}
      c.coast[k]={startGear:g0,maxGear:maxG,endGear:v.gear};
    }

    // F. 킥다운: 고단 저rpm(고속에서 발 떼 감속하며 톱기어 유지) → 풀스로틀 추월
    //    가속 시 더 낮은 기어로 내려무는지.
    {
      const v=mk(id); spinTo(v,Math.min(170, spd.cruise[2]));
      // 발 떼고 감속 → 톱기어 저rpm 상태 만들기
      let t=0;while(t<3.5 && v.rpm>CARS[id].engine.redline*0.4){st(v);v.ctrl.throttle=0;v.ctrl.brake=0.12;v.step(DT);t+=DT;}
      const before=v.gear, beforeRpm=Math.round(v.rpm);
      let t2=0,minG=v.gear;
      while(t2<1.5){st(v);v.ctrl.throttle=1;v.ctrl.brake=0;v.step(DT);t2+=DT;if(v.gear<minG)minG=v.gear;}
      c.kickdown={before,beforeRpm,minGear:minG,kicked:minG<before};
    }

    // G. 무입력 정지: 후진 폭주 안 하는지 (이전 버그)
    {
      const v=mk(id); v.gear=1; let maxAbs=0,t=0;
      while(t<5){st(v);v.ctrl.throttle=0;v.ctrl.brake=0;v.ctrl.handbrake=false;v.step(DT);t+=DT;
        if(Math.abs(v.speed)>maxAbs)maxAbs=Math.abs(v.speed);}
      c.standstill={maxSpeed:+maxAbs.toFixed(3)};
    }

    // H. 트레일 브레이킹 후 재가속: 헌팅 없이 매끄러운지
    {
      const v=mk(id); spinTo(v,110); let pg=v.gear; const seq=[pg];
      const cnt=(vv)=>{if(vv.gear!==pg){seq.push(vv.gear);pg=vv.gear;}};
      drive(v,0,0.4,1.5,cnt);   // 가벼운 브레이크
      drive(v,1,0,2.0,cnt);     // 재가속
      // 헌팅 = 방향 전환(다운→업→다운…) 횟수. 순수 감속다운+재가속업(V자)은 1회.
      let reversals=0;
      for(let i=2;i<seq.length;i++){const a=seq[i]-seq[i-1],b=seq[i-1]-seq[i-2];if(a*b<0)reversals++;}
      c.trailBrake={totalShifts:seq.length-1,reversals,seq,gear:v.gear};
    }

    R[id]=c;
  }
  return R;
}
"""

# ── 판정 ──────────────────────────────────────────────────────────────────
def judge(cid, c):
    rl, ng = c['redline'], c['gears']
    out = []
    def t(name, ok, detail): out.append((name, ok, detail))

    L = c['launch']
    t("런치 오접변속 없음", L['falseShiftFrames'] == 0, f"저속2단↑ {L['falseShiftFrames']}프레임")
    t("풀스로틀=레드라인 직전", all(r > rl*0.88 for r in L['upshiftRpm']) if L['upshiftRpm'] else False,
      f"변속rpm {L['upshiftRpm']} (기준 >{int(rl*0.88)})")
    t("오버레브 없음(가속)", L['maxRpm'] <= rl + 260, f"max {L['maxRpm']} (한계 {rl+260})")

    P = c['partThrottle']
    t("부분스로틀 레드라인 안 끔", all(r < rl*0.85 for r in P['upshiftRpm']) if P['upshiftRpm'] else True,
      f"변속rpm {P['upshiftRpm']} (기준 <{int(rl*0.85)})")

    for k, cr in c['cruise'].items():
        t(f"크루징 {k}km/h 헌팅≤2", cr['hunts'] <= 2, f"{cr['hunts']}회, {cr['gear']}단 {cr['rpm']}rpm")

    for key, co in c['corner'].items():
        t(f"코너 {key} 1단 안 감", co['minGear'] >= 2, f"최저 {co['minGear']}단, 탈출 {co['exitGear']}단 {co['exitKmh']}km/h")
        t(f"코너 {key} 오버레브 없음", co['maxRpm'] <= rl + 260, f"max {co['maxRpm']}")

    for k, co in c['coast'].items():
        t(f"코스팅 {k} 톱기어 폭주X", co['maxGear'] <= min(ng, co['startGear']+2),
          f"{co['startGear']}→max{co['maxGear']}→{co['endGear']}단")

    K = c['kickdown']
    t("킥다운 작동", K['kicked'], f"{K['before']}단({K['beforeRpm']}rpm)→{K['minGear']}단")

    S = c['standstill']
    t("무입력 정지(후진X)", S['maxSpeed'] < 0.3, f"최대 {S['maxSpeed']}m/s")

    TB = c['trailBrake']
    # 헌팅 판정은 '방향 전환'(다운↔업 왕복)으로 — 감속 다운 + 재가속 업(V자)은 정상.
    t("트레일브레이크 헌팅 없음", TB['reversals'] <= 1, f"방향전환 {TB['reversals']}회, 시퀀스 {TB['seq']}")

    return out

async def main():
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--use-gl=angle'])
        p = await (await b.new_context()).new_page()
        errs = []; p.on('pageerror', lambda e: errs.append(str(e)))
        await p.goto(f'http://localhost:{PORT}/'); await p.wait_for_timeout(700)
        await p.evaluate("()=>{localStorage.setItem('ns-track','nordschleife');sessionStorage.setItem('ns-go','1');}")
        await p.reload(); await p.wait_for_function('()=>!!window.__Vehicle', timeout=40000); await p.wait_for_timeout(400)
        R = await p.evaluate(HARNESS, CARS)
        await b.close()

    total = 0; passed = 0
    for cid in CARS:
        c = R[cid]
        print(f"\n━━━ {cid}  (redline {c['redline']}, {c['gears']}단) ━━━")
        for name, ok, detail in judge(cid, c):
            total += 1; passed += ok
            print(f"  [{'PASS' if ok else 'FAIL'}] {name:24} {detail}")
    print(f"\n결과: {passed}/{total} PASS" + ("" if passed == total else f"  ← {total-passed} FAIL"))
    if errs: print("PAGE ERRORS:", errs[:3])
    sys.exit(0 if passed == total else 1)

asyncio.run(main())
