// Minimum-lap-time trajectory optimization via sep-CMA-ES on the REAL 240Hz sim
// (run in Node, no browser). Optimizes the racing line (offset spline) + per-zone
// grip-usage. Each candidate is scored by simulating a flying lap; spins/off-track
// are penalized. Starts from the human line (proven ~85s) and pushes to the limit.
//
// Output: tmp/opt_lap.json = {lapTime, pts:[{s,v,d,a,st,th,br}...]} ready for Guide/Watch.
import { Track } from '../js/track.js';
import { CARS } from '../js/cars.js';
import { TRACK } from '../js/tracks/practice.js';
import { Vehicle } from '../js/physics.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
mkdirSync('tmp', { recursive: true });
const HUMAN_LAP = 79.5;   // reference (the player's ghost). Base profile = tmp/human_base.json

const track = new Track(TRACK);
const n = track.n, step = track.step, total = track.total, G = 9.81, L = 2.65;
const car = CARS.gt3rs, m = car.mass;
const kdf = 0.5*1.2*car.aero.cla/m, dragK = 0.5*1.2*car.aero.cda/m;
const CAP = 3.7;                                   // keep the whole car on asphalt (half 4.5 - body)
const cl=(v,a,b)=>v<a?a:v>b?b:v;
const rot=(q,x,y,z)=>{const{x:qx,y:qy,z:qz,w}=q;const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
  return [x+w*tx+(qy*tz-qz*ty),y+w*ty+(qz*tx-qx*tz),z+w*tz+(qx*ty-qy*tx)];};
const DT=1/240;

// ---- human line + speed (proven) from ideal-practice -----------------------
const humanBase=JSON.parse(readFileSync('tests/human_base.json','utf8'));   // [{s,v(km/h),d}], from the ghost
const humanOff=new Float64Array(n), humanV=new Float64Array(n), seen=new Uint8Array(n);
for(const p of humanBase){const i=((Math.round(p.s/step)%n)+n)%n; humanOff[i]=p.d; humanV[i]=p.v; seen[i]=1;}
{let lo=0,lv=0; for(let i=0;i<n;i++){if(seen[i]){lo=humanOff[i];lv=humanV[i];}else{humanOff[i]=lo;humanV[i]=lv;}}}
const humanMs=Float64Array.from(humanV,x=>x/3.6);

function smooth(a,p){const o=Float64Array.from(a);for(let k=0;k<p;k++){const t=Float64Array.from(o);
  for(let i=0;i<n;i++){const x=(i-1+n)%n,y=(i+1)%n;o[i]=(t[x]+2*t[i]+t[y])/4;}}return o;}

// ---- parametrization: K1 line nodes + K2 grip nodes (periodic, linear interp) ----
const K1=54, K2=44, DIM=K1+K2;
const VLO=0.90, VHI=1.45;                            // speed-multiplier range on the human profile
function nodesToFull(nodes, K, lo, hi){            // nodes in [-1,1] -> full[n] in [lo,hi], periodic linear
  const full=new Float64Array(n);
  for(let i=0;i<n;i++){
    const fp=i/n*K, a=Math.floor(fp)%K, b=(a+1)%K, fr=fp-Math.floor(fp);
    const va=(nodes[a]*0.5+0.5)*(hi-lo)+lo, vb=(nodes[b]*0.5+0.5)*(hi-lo)+lo;
    full[i]=va*(1-fr)+vb*fr;
  }
  return full;
}
function geom(off){
  const lx=new Float64Array(n),lz=new Float64Array(n),ds=new Float64Array(n),kap=new Float64Array(n),sk=new Float64Array(n);
  for(let i=0;i<n;i++){lx[i]=track.px[i]+track.rx[i]*off[i];lz[i]=track.pz[i]+track.rz[i]*off[i];}
  for(let i=0;i<n;i++){const b=(i+1)%n;ds[i]=Math.hypot(lx[b]-lx[i],lz[b]-lz[i])||0.1;}
  for(let i=0;i<n;i++){const a=(i-1+n)%n,b=(i+1)%n;let ax=lx[i]-lx[a],az=lz[i]-lz[a],bx=lx[b]-lx[i],bz=lz[b]-lz[i];
    const la=Math.hypot(ax,az)||1,lb=Math.hypot(bx,bz)||1;ax/=la;az/=la;bx/=lb;bz/=lb;
    const cr=ax*bz-az*bx; sk[i]=cr/((la+lb)/2); kap[i]=Math.abs(cr)/((la+lb)/2);}
  for(let p=0;p<2;p++){const t=Float64Array.from(kap);for(let i=0;i<n;i++){const a=(i-1+n)%n,b=(i+1)%n;kap[i]=(t[a]+2*t[i]+t[b])/4;}}
  return {ds,kap,sk:smooth(sk,3)};
}
function profile(g, gMul){                          // QSS grip-limit speed (m/s), grip scaled per-zone
  const {ds,kap}=g, v=new Float64Array(n), VMAX=125;
  for(let i=0;i<n;i++){const mu=gMul[i], k=kap[i], den=k-mu*kdf; v[i]=den<=1e-5?VMAX:Math.min(VMAX,Math.sqrt(mu*G/den));}
  const eng=x=>Math.min(12,270000/(m*Math.max(x,6)));
  for(let p=0;p<2;p++)for(let i=2*n-1;i>=0;i--){const a=i%n,b=(i+1)%n,mu=gMul[a];
    const aMx=mu*(G+kdf*v[a]*v[a]),aLat=v[a]*v[a]*kap[a],aL=Math.sqrt(Math.max(0,aMx*aMx-aLat*aLat))+dragK*v[a]*v[a];
    const lim=Math.sqrt(v[b]*v[b]+2*aL*ds[a]); if(v[a]>lim)v[a]=lim;}
  for(let p=0;p<2;p++)for(let i=0;i<2*n;i++){const a=i%n,b=(i+1)%n,mu=gMul[a];
    const aMx=mu*(G+kdf*v[a]*v[a]),aLat=v[a]*v[a]*kap[a],aL=Math.min(Math.sqrt(Math.max(0,aMx*aMx-aLat*aLat)),eng(v[a]))-dragK*v[a]*v[a];
    const lim=Math.sqrt(Math.max(0,v[a]*v[a]+2*aL*ds[a])); if(v[b]>lim)v[b]=lim;}
  // floor at human speed (QSS underestimates fast sweepers from noisy kappa)
  for(let i=0;i<n;i++) if(humanMs[i]>v[i]) v[i]=humanMs[i];
  return v;
}
function runLap(off, sk, prof, rec, cap){
  const v=new Vehicle(track, car); v.reset(20); v.auto=true; v.tc=true; v.abs=true;
  let t=0,lap=0,sd=0,st=0,lapT=null,o2=0,steps=0,spun=false; const q={};
  while(t<200){
    const r=track.query(v.pos.x, v.pos.z, q); if(!r) break;
    const i=((Math.floor(r.s/step)%n)+n)%n, sp=Math.abs(v.speed)*3.6;
    const la=cl(5+sp*0.22,4,22), j=(i+Math.max(1,Math.floor(la/step)))%n;
    const f=rot(v.quat,0,0,-1), rgt=rot(v.quat,1,0,0);
    const tx=track.px[j]+track.rx[j]*off[j], tz=track.pz[j]+track.rz[j]*off[j];
    const dx=tx-v.pos.x,dz=tz-v.pos.z,dl=Math.hypot(dx,dz)||1;
    const sinA=cl(f[0]*(dz/dl)-f[2]*(dx/dl),-1,1);
    const vLat=v.vel.x*rgt[0]+v.vel.z*rgt[2], bsl=Math.atan2(vLat,Math.max(8,Math.abs(v.speed)));
    const ms=Math.max(0.08,v.maxSteerAngle());
    const steerT=cl(sinA*4.0 + 0.3*Math.atan(L*sk[j])/ms - 0.5*bsl, -1, 1);
    v.ctrl.steer+=cl(steerT-v.ctrl.steer,-0.14,0.14);
    let vt=prof[i]*3.6; const ahead=Math.max(1,Math.floor(Math.abs(v.speed)*0.10/step));
    for(let d=1;d<=ahead;d++){const k=(i+d)%n; const vv=prof[k]*3.6; if(vv<vt)vt=vv;}
    const err=vt-sp,DE=0.8; let u;
    if(err>DE)u=cl((err-DE)*0.14,0,1); else if(err<-DE)u=cl((err+DE)*0.12,-1,0); else u=0;
    const cur=v.ctrl.throttle-v.ctrl.brake, rate=(u>cur?16:24)/240, cmd=cur+cl(u-cur,-rate,rate);
    v.ctrl.throttle=Math.max(0,cmd); v.ctrl.brake=Math.max(0,-cmd); v.ctrl.handbrake=false;
    // launch / low-speed traction control: the plan demands flying speed off the line,
    // so from a standstill the speed-PID floors it and the rears light up. Below 60 km/h
    // while accelerating, modulate throttle to the tyres' peak slip (fast cut, slow build).
    if(sp<60&&cmd>0){const a0=v.wheels[2],a1=v.wheels[3];const srR=(a0.contact&&a1.contact)?(a0.slipRatio+a1.slipRatio)/2:0;
      if(srR>0.13)v.ctrl.throttle=Math.max(0,v.ctrl.throttle-0.15);else v.ctrl.throttle=Math.min(1,v.ctrl.throttle+0.02);
      v.ctrl.brake=0;}
    v.step(DT); t+=DT;
    if(v.rollover){spun=true;break;}
    if(lap===2){steps++; if(!v.onTrack)o2++;
      if(cap) cap[i]={th:v.ctrl.throttle, br:v.ctrl.brake, st:v.ctrl.steer};}  // per-index capture (5m, 1:1)
    if(rec&&lap===2){const d2=Math.floor((v.distAccum-sd)/3);
      // record the PLAN (target speed + planned line offset) so the live controller,
      // which tracks idealSpd/offsets, reproduces this exact lap — not the achieved values.
      if(rec.length<d2+1)rec.push({s:+r.s.toFixed(1),v:+(prof[i]*3.6).toFixed(1),d:+off[i].toFixed(2),
        st:+v.ctrl.steer.toFixed(3),th:+v.ctrl.throttle.toFixed(2),br:+v.ctrl.brake.toFixed(2)});}
    if(lap===0&&v.distAccum>5)lap=1;
    if(lap===1&&v.distAccum>=total){lap=2;sd=v.distAccum;st=t;}
    if(lap===2&&v.distAccum-sd>=total){lapT=t-st;break;}
  }
  return {lapT, off:o2/Math.max(1,steps), spun};
}
function speedProfile(vMul){                         // free speed plan = human speed x optimized multiplier
  const prof=new Float64Array(n); for(let i=0;i<n;i++) prof[i]=humanMs[i]*vMul[i]; return prof;
}
function cost(x){                                   // x: DIM params in [-1,1]
  const lineNodes=x.slice(0,K1), spNodes=x.slice(K1);
  const off=smooth(nodesToFull(lineNodes,K1,-CAP,CAP),2);
  const vMul=smooth(nodesToFull(spNodes,K2,VLO,VHI),2);
  const g=geom(off), prof=speedProfile(vMul);
  const r=runLap(off,g.sk,prof);
  if(r.spun) return {c:300, ...r};
  if(r.lapT==null) return {c:250, ...r};
  return {c: r.lapT + 350*Math.max(0, r.off-0.001), ...r};  // lap time + HARSH off penalty (clean line)
}

// ---- finalize mode: re-record the best checkpoint with the PLAN (target) profile ----
function recordAndSave(x){
  const lineNodes=x.slice(0,K1), spNodes=x.slice(K1);
  const off=smooth(nodesToFull(lineNodes,K1,-CAP,CAP),2);
  const vMul=smooth(nodesToFull(spNodes,K2,VLO,VHI),2);
  const g=geom(off), prof=speedProfile(vMul);
  const cap=new Array(n); const fin=runLap(off,g.sk,prof,null,cap);
  // Emit ALL n track points at exact 5 m indices so the live arrays (offsets/idealSpd,
  // built via round(s/step)) are 1:1 identical to what the optimizer drove — exact reproduction.
  const pts=[];
  for(let i=0;i<n;i++){
    const c=cap[i]||{th:0,br:0,st:0};
    const a = c.br>0.15 ? (Math.abs(c.st)>0.25?'TRAIL':'BRAKE') : c.th>0.2?'THROTTLE':'COAST';
    pts.push({s:+(i*step).toFixed(1), v:+(prof[i]*3.6).toFixed(1), d:+off[i].toFixed(3), a});
  }
  const out={track:'practice',car:'gt3rs',lapTime:+(fin.lapT||0).toFixed(2),offFrac:+(fin.off||0).toFixed(4),pts};
  writeFileSync('tmp/opt_lap.json', JSON.stringify(out));
  return out;
}
if(process.argv.includes('finalize')){
  const ck=JSON.parse(readFileSync('tmp/cma_best.json','utf8'));
  const dbg=cost(Float64Array.from(ck.x));
  console.log(`checkpoint claims ${ck.lapT}; re-scored cost ${dbg.c.toFixed(2)} lap ${dbg.lapT} off ${(dbg.off*100).toFixed(1)}% spun ${dbg.spun}`);
  const out=recordAndSave(Float64Array.from(ck.x));
  console.log(`finalize: ${out.lapTime}s off ${(out.offFrac*100).toFixed(1)}% ${out.pts.length}pts -> tmp/opt_lap.json`);
  process.exit(0);
}

// ---- sep-CMA-ES ------------------------------------------------------------
function randn(){ let u=0,v=0; while(u===0)u=Math.random(); while(v===0)v=Math.random();
  return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
const N=DIM, lam=24, mu=12;
const wpre=[]; for(let i=0;i<mu;i++) wpre.push(Math.log(mu+0.5)-Math.log(i+1));
const wsum=wpre.reduce((a,b)=>a+b,0), w=wpre.map(x=>x/wsum);
const mueff=1/w.reduce((a,b)=>a+b*b,0);
const cs=(mueff+2)/(N+mueff+5), ds=1+2*Math.max(0,Math.sqrt((mueff-1)/(N+1))-1)+cs;
const cc=(4+mueff/N)/(N+4+2*mueff/N);
const sepf=(N+2)/3;                                  // sep-CMA speedup
const c1=Math.min(1, sepf*2/((N+1.3)**2+mueff));
const cmu=Math.min(1-c1, sepf*2*(mueff-2+1/mueff)/((N+2)**2+mueff));
const chiN=Math.sqrt(N)*(1-1/(4*N)+1/(21*N*N));

// init mean from human line (sample at nodes) + grip ~1.05
const mean=new Float64Array(N);
for(let kk=0;kk<K1;kk++){const idx=Math.round(kk/K1*n)%n; mean[kk]=cl(humanOff[idx]/CAP,-1,1);}
const vInit=(1.0-VLO)/(VHI-VLO)*2-1;                 // start speed multiplier at 1.0 (= human)
for(let kk=0;kk<K2;kk++) mean[K1+kk]=vInit;
const C=new Float64Array(N).fill(1), ps=new Float64Array(N), pc=new Float64Array(N);
let sigma=0.30;
const WARM = process.argv.includes('warm');
if(WARM && existsSync('tmp/cma_best.json')){         // continue from previous best
  const prev=JSON.parse(readFileSync('tmp/cma_best.json','utf8'));
  if(prev.x && prev.x.length===N){ for(let i=0;i<N;i++) mean[i]=prev.x[i]; sigma=0.12;
    console.log(`warm-start from prev best ${prev.lapT}s`); }
}

let best={c:1e9}, bestX=null, sinceImprove=0;
const GENS=parseInt(process.argv.find(a=>/^\d+$/.test(a))||'70');
for(let gen=0; gen<GENS; gen++){
  if(sinceImprove>=18){                              // IPOP-style restart: re-inflate to escape local optima
    sigma=0.35; C.fill(1); ps.fill(0); pc.fill(0);
    if(bestX) for(let i=0;i<N;i++) mean[i]=bestX[i];  // restart around the best found
    sinceImprove=0; console.log('  -- restart (sigma re-inflated) --');
  }
  const sols=[];
  for(let k=0;k<lam;k++){
    const z=new Float64Array(N), x=new Float64Array(N);
    for(let i=0;i<N;i++){ z[i]=randn(); x[i]=cl(mean[i]+sigma*Math.sqrt(C[i])*z[i],-1,1); }
    const r=cost(x); sols.push({x,z,...r});
    if(r.c<best.c-1e-3){best={c:r.c,lapT:r.lapT,off:r.off,spun:r.spun}; bestX=Float64Array.from(x); sinceImprove=-1;
      writeFileSync('tmp/cma_best.json', JSON.stringify({lapT:best.lapT,off:best.off,x:Array.from(bestX)}));}
  }
  sinceImprove++;
  sols.sort((a,b)=>a.c-b.c);
  // recombination
  const yw=new Float64Array(N);
  for(let i=0;i<N;i++){ let s=0; for(let kk=0;kk<mu;kk++) s+=w[kk]*(sols[kk].x[i]-mean[i])/sigma; yw[i]=s; }
  for(let i=0;i<N;i++) mean[i]=cl(mean[i]+sigma*yw[i],-1,1);
  // paths (diagonal: C^{-1/2} y = y/sqrt(C))
  let psNorm=0;
  for(let i=0;i<N;i++){ ps[i]=(1-cs)*ps[i]+Math.sqrt(cs*(2-cs)*mueff)*yw[i]/Math.sqrt(C[i]); psNorm+=ps[i]*ps[i]; }
  psNorm=Math.sqrt(psNorm);
  const hsig = psNorm/Math.sqrt(1-(1-cs)**(2*(gen+1))) < (1.4+2/(N+1))*chiN ? 1:0;
  for(let i=0;i<N;i++) pc[i]=(1-cc)*pc[i]+hsig*Math.sqrt(cc*(2-cc)*mueff)*yw[i];
  for(let i=0;i<N;i++){
    let cmuTerm=0; for(let kk=0;kk<mu;kk++){const yi=(sols[kk].x[i]-mean[i])/sigma; cmuTerm+=w[kk]*yi*yi;}
    C[i]=(1-c1-cmu)*C[i]+c1*(pc[i]*pc[i]+(1-hsig)*cc*(2-cc)*C[i])+cmu*cmuTerm;
    if(C[i]<1e-6)C[i]=1e-6;
  }
  sigma*=Math.exp((cs/ds)*(psNorm/chiN-1));
  sigma=cl(sigma,0.01,1.0);
  const b=sols[0];
  console.log(`gen ${String(gen).padStart(3)}  best ${best.lapT?best.lapT.toFixed(2):'-'}  genBest ${b.lapT?b.lapT.toFixed(2):'DNF'} off ${(b.off*100).toFixed(1)}% ${b.spun?'SPUN':''}  sigma ${sigma.toFixed(3)}`);
}

// ---- record best trajectory and save --------------------------------------
const lineNodes=bestX.slice(0,K1), spNodes=bestX.slice(K1);
const off=smooth(nodesToFull(lineNodes,K1,-CAP,CAP),2);
const vMul=smooth(nodesToFull(spNodes,K2,VLO,VHI),2);
const g=geom(off), prof=speedProfile(vMul);
const rec=[]; const fin=runLap(off,g.sk,prof,rec);
// action color from throttle/brake/steer
for(const p of rec){ p.a = p.br>0.15 ? (Math.abs(p.st)>0.25?'TRAIL':'BRAKE') : p.th>0.2?'THROTTLE':'COAST'; }
const out={track:'practice',car:'gt3rs',lapTime:+(fin.lapT||0).toFixed(2),offFrac:+(fin.off||0).toFixed(4),pts:rec};
writeFileSync('tmp/opt_lap.json', JSON.stringify(out));
console.log(`\nFINAL: ${out.lapTime}s  off ${(out.offFrac*100).toFixed(1)}%  ${rec.length} pts -> tmp/opt_lap.json`);
console.log(`(human ${HUMAN_LAP}s, prev autopilot ~85s)`);
