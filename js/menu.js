// Main menu: pick a track (with a minimap preview drawn from the point data)
// and a car, then START. Track change reloads into that track; same-track just
// resumes (car change applies live).
import { TRACKS } from './tracks/index.js';
import { CARS } from './cars.js';

function fmt(km) { return km >= 10 ? km.toFixed(1) : km.toFixed(1); }

// draw a track outline into a canvas from its point array
function drawPreview(cv, points) {
  const g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of points) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
  }
  const pad = 14, W = cv.width, H = cv.height;
  const sc = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxZ - minZ || 1));
  const ox = pad + (W - pad * 2 - (maxX - minX) * sc) / 2;
  const oz = pad + (H - pad * 2 - (maxZ - minZ) * sc) / 2;
  g.strokeStyle = '#7ec8ff'; g.lineWidth = 2.5; g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i <= points.length; i += 2) {
    const p = points[i % points.length];
    const x = ox + (p[0] - minX) * sc, y = oz + (p[2] - minZ) * sc;
    i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
  }
  g.closePath(); g.stroke();
  const [sx, sz] = [ox + (points[0][0] - minX) * sc, oz + (points[0][2] - minZ) * sc];
  g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(sx, sz, 4, 0, 7); g.fill();
}

// trackData: { id -> TRACK }, onStart(trackId, carId)
export function showMenu({ trackData, currentTrack, currentCar, onStart }) {
  let selTrack = currentTrack, selCar = currentCar;

  const ov = document.createElement('div');
  ov.id = 'menu';
  ov.innerHTML = `
    <div id="menu-inner">
      <h1>NÜRBURGRING<span>DRIVE</span></h1>
      <div class="menu-sec">TRACK</div>
      <div id="menu-tracks"></div>
      <div class="menu-sec">CAR</div>
      <div id="menu-cars"></div>
      <button id="menu-start">DRIVE</button>
      <div id="menu-links"
         style="margin-top:16px;text-align:center;font-family:'Space Mono',monospace;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">
        <a href="./data/game_logic.html" target="_blank" rel="noopener"
           style="color:#6a7177;text-decoration:none;">System Overview &nearr;</a>
        <span style="color:#3e4348;margin:0 9px;">·</span>
        <a href="https://github.com/esc5221/drive-game" target="_blank" rel="noopener"
           style="color:#6a7177;text-decoration:none;">Source &nearr;</a>
        <span style="color:#3e4348;margin:0 9px;">·</span>
        <a href="./making.html" target="_blank" rel="noopener"
           style="color:#6a7177;text-decoration:none;">Build log &nearr;</a>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const trackWrap = ov.querySelector('#menu-tracks');
  const carWrap = ov.querySelector('#menu-cars');

  for (const t of TRACKS) {
    if (t.hidden) continue;
    const card = document.createElement('div');
    card.className = 'menu-card' + (t.id === selTrack ? ' active' : '');
    card.innerHTML = `<canvas width="150" height="110"></canvas>
      <div class="mc-name">${t.name}</div>
      <div class="mc-meta">${t.loc} · ${fmt(t.km)} km</div>`;
    const cv = card.querySelector('canvas');
    if (trackData[t.id]) drawPreview(cv, trackData[t.id].points);
    card.addEventListener('click', () => {
      selTrack = t.id;
      trackWrap.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
    trackWrap.appendChild(card);
  }

  for (const c of Object.values(CARS)) {
    if (c.hidden) continue;
    const b = document.createElement('button');
    b.className = 'menu-carbtn' + (c.id === selCar ? ' active' : '');
    b.textContent = c.name;
    b.addEventListener('click', () => {
      selCar = c.id;
      carWrap.querySelectorAll('.menu-carbtn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    carWrap.appendChild(b);
  }

  ov.querySelector('#menu-start').addEventListener('click', () => {
    ov.remove();
    onStart(selTrack, selCar);
  });
}
