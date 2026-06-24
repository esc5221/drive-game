// Mirror the INTENDED live autopilot: straight full-throttle launch (steer=0 until first
// reaching 50 km/h), then normal control with corner-exit TC. Standing start, 6 laps.
import { Track } from '../js/track.js';
import { CARS } from '../js/cars.js';
import { TRACK } from '../js/tracks/practice.js';
import { IDEAL_PRACTICE } from '../js/ideal-practice.js';
import { Vehicle } from '../js/physics.js';
const track=new Track(TRACK),n=track.n,step=track.step,total=track.total,L=2.65;
const off=new Float64Array(n),spd=new Float64Array(n),seen=new Uint8Array(n);
for(const p of IDEAL_PRACTICE.pts){const i=((Math.round(p.s/step)%n)+n)%n;off[i]=p.d;spd[i]=p.v;seen[i]=1;}
{let lo=0,lv=0;for(let i=0;i<n;i++){if(seen[i]){lo=off[i];lv=spd[i];}else{off[i]=lo;spd[i]=lv;}}}
const sk=new Float64Array(n),lx=new Float64Array(n),lz=new Float64Array(n);
for(let i=0;i<n;i++){lx[i]=track.px[i]+track.rx[i]*off[i];lz[i]=track.pz[i]+track.rz[i]*off[i];}
for(let i=0;i<n;i++){const a=(i-1+n)%n,b=(i+1)%n;let ax=lx[i]-lx[a],az=lz[i]-lz[a],bx=lx[b]-lx[i],bz=lz[b]-lz[i];const la=Math.hypot(ax,az)||1,lb=Math.hypot(bx,bz)||1;ax/=la;az/=la;bx/=lb;bz/=lb;sk[i]=(ax*bz-az*bx)/((la+lb)/2);}
for(let p=0;p<3;p++){const s=sk.slice();for(let i=0;i<n;i++){const a=(i-1+n)%n,b=(i+1)%n;sk[i]=(s[a]+2*s[i]+s[b])/4;}}
const cl=(v,a,b)=>v<a?a:v>b?b:v;
const rot=(q,x,y,z)=>{const{x:qx,y:qy,z:qz,w}=q;const tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);return[x+w*tx+(qy*tz-qz*ty),y+w*ty+(qz*tx-qx*tz),z+w*tz+(qx*ty-qy*tx)];};
const DT=1/240,q={};
const v=new Vehicle(track,CARS.gt3rs);v.reset(0);v.auto=true;v.tc=true;v.abs=true;
let t=0,launched=false,t100=null,lapIdx=0,lastLapT=0,lapStartDist=0,offCnt=0,steps=0;const laps=[];
while(t<480&&lapIdx<6){
  const r=track.query(v.pos.x,v.pos.z,q);if(!r)break;
  const i=((Math.floor(r.s/step)%n)+n)%n,sp=Math.abs(v.speed)*3.6;
  const la=cl(5+sp*0.22,4,22),j=(i+Math.max(1,Math.floor(la/step)))%n;
  const f=rot(v.quat,0,0,-1),rg=rot(v.quat,1,0,0);
  const tx=track.px[j]+track.rx[j]*off[j],tz=track.pz[j]+track.rz[j]*off[j];
  const dx=tx-v.pos.x,dz=tz-v.pos.z,dl=Math.hypot(dx,dz)||1;
  const sinA=cl(f[0]*(dz/dl)-f[2]*(dx/dl),-1,1);
  const vLat=v.vel.x*rg[0]+v.vel.z*rg[2],bsl=Math.atan2(vLat,Math.max(8,Math.abs(v.speed)));
  const ms=Math.max(0.08,v.maxSteerAngle());
  let steerT=cl(sinA*4.0+0.3*Math.atan(L*sk[j])/ms-0.5*bsl,-1,1);
  if(!launched){ if(sp>50)launched=true; else if(sp<35)steerT=0; }   // straight launch off the line
  v.ctrl.steer+=cl(steerT-v.ctrl.steer,-0.14,0.14);
  let vt=spd[i];const ah=Math.max(1,Math.floor(Math.abs(v.speed)*0.10/step));
  for(let d=1;d<=ah;d++){const k=(i+d)%n;if(spd[k]<vt)vt=spd[k];}
  const err=vt-sp,DE=0.8;let u;
  if(err>DE)u=cl((err-DE)*0.14,0,1);else if(err<-DE)u=cl((err+DE)*0.12,-1,0);else u=0;
  const cur=v.ctrl.throttle-v.ctrl.brake,rate=(u>cur?16:24)/240,cmd=cur+cl(u-cur,-rate,rate);
  v.ctrl.throttle=Math.max(0,cmd);v.ctrl.brake=Math.max(0,-cmd);v.ctrl.handbrake=false;
  const w0=v.wheels[2],w1=v.wheels[3];const srR=(w0.contact&&w1.contact)?(w0.slipRatio+w1.slipRatio)/2:0;
  if(!launched&&cmd>0){ v.ctrl.throttle=(srR>0.30)?Math.max(0,v.ctrl.throttle-0.10):1; v.ctrl.brake=0; }  // full-throttle launch
  else if(sp<60&&cmd>0){ if(srR>0.13)v.ctrl.throttle=Math.max(0,v.ctrl.throttle-0.15);else v.ctrl.throttle=Math.min(1,v.ctrl.throttle+0.02); v.ctrl.brake=0; }  // corner-exit TC (matches optimizer)
  v.step(DT);t+=DT;
  if(sp>=100&&t100===null)t100=t;
  if(lapIdx>=0&&t>0){steps++;if(!v.onTrack)offCnt++;}
  if(v.rollover){console.log(`*** CRASH lap ${lapIdx+1} s=${r.s.toFixed(0)} t=${t.toFixed(1)} ***`);break;}
  if(v.distAccum-lapStartDist>=total){laps.push({lap:lapIdx+1,t:+(t-lastLapT).toFixed(2),off:+(offCnt/Math.max(1,steps)*100).toFixed(1)});lastLapT=t;lapStartDist=v.distAccum;offCnt=0;steps=0;lapIdx++;}
}
console.log('0-100 km/h:',t100?t100.toFixed(2)+'s':'>',' | laps:',JSON.stringify(laps));
