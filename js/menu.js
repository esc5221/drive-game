// Main menu: pick a track (with a minimap preview drawn from the point data)
// and a car, then START. Track change reloads into that track; same-track just
// resumes (car change applies live).
import { TRACKS } from './tracks/index.js';
import { CARS } from './cars.js';
import { generateRandomTrack } from './tracks/random.js';

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
// isTouch + currentCtrl/onCtrl: show a Button/Tilt steering chooser (mobile only).
export function showMenu({ trackData, currentTrack, currentCar, onStart, isTouch, currentCtrl, onCtrl }) {
  let selTrack = currentTrack, selCar = currentCar;

  const steerSec = isTouch ? `
      <div class="menu-sec">STEERING</div>
      <div id="menu-ctrl"></div>` : '';

  const ov = document.createElement('div');
  ov.id = 'menu';
  ov.innerHTML = `
    <div id="menu-inner">
      <h1>NÜRBURGRING<span>DRIVE</span></h1>
      <div class="menu-sec">TRACK</div>
      <div id="menu-tracks"></div>
      <div class="menu-sec">CAR</div>
      <div id="menu-cars"></div>
      ${steerSec}
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
        <span style="color:#3e4348;margin:0 9px;">·</span>
        <a href="https://sketchfab.com/3d-models/free-porsche-911-carrera-4s-d01b254483794de3819786d93e0e1ebf" target="_blank" rel="noopener"
           style="color:#6a7177;text-decoration:none;" title="Porsche 911 Carrera 4S by Karol Miklas, CC-BY-SA 4.0">911 model © Karol Miklas &nearr;</a>
      </div>
    </div>`;
  document.body.appendChild(ov);

  const trackWrap = ov.querySelector('#menu-tracks');
  const carWrap = ov.querySelector('#menu-cars');

  for (const t of TRACKS) {
    if (t.hidden) continue;
    const card = document.createElement('div');
    card.className = 'menu-card' + (t.id === selTrack ? ' active' : '');
    const nameHtml = t.random ? `${t.name} <span class="mc-reroll" title="reroll">🎲</span>` : t.name;
    card.innerHTML = `<canvas width="150" height="110"></canvas>
      <div class="mc-text">
        <div class="mc-name">${nameHtml}</div>
        <div class="mc-meta">${t.loc} · ${fmt(t.km)} km</div>
      </div>`;
    const cv = card.querySelector('canvas');

    if (t.random) {
      // procedural: a fresh layout every time the menu opens (feels newly generated),
      // and the 🎲 badge rerolls to another one.
      let seed = 0;
      const meta = card.querySelector('.mc-meta');
      const roll = () => {
        seed = (Math.random() * 0xffffffff) >>> 0;
        const gen = generateRandomTrack(seed);
        try { localStorage.setItem('ns-random-seed', String(seed)); } catch (e) {}
        if (gen) { drawPreview(cv, gen.points); meta.textContent = `Procedural · ${(gen.total / 1000).toFixed(1)} km`; }
      };
      roll();
      card.querySelector('.mc-reroll').addEventListener('click', e => {
        e.stopPropagation();
        selTrack = t.id;
        trackWrap.querySelectorAll('.menu-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        roll();                                       // new layout each tap
      });
    } else if (trackData[t.id]) {
      drawPreview(cv, trackData[t.id].points);
    }

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

  if (isTouch) {
    const ctrlWrap = ov.querySelector('#menu-ctrl');
    for (const [m, label] of [['buttons', 'Buttons'], ['tilt', 'Tilt (gyro)']]) {
      const b = document.createElement('button');
      b.className = 'menu-carbtn' + (m === (currentCtrl || 'buttons') ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        ctrlWrap.querySelectorAll('.menu-carbtn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (onCtrl) onCtrl(m);
      });
      ctrlWrap.appendChild(b);
    }
  }

  ov.querySelector('#menu-start').addEventListener('click', () => {
    ov.remove();
    onStart(selTrack, selCar);
  });
}
