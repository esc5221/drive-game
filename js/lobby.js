// Multiplayer lobby (multi.html) — lightweight entry: no Three.js, no game boot.
// Create a room (snapshotting track+seed) or join via code/link, watch the
// roster fill up live over the same Room DO websocket, then "주행 시작" hands
// off to the game page (/?room=CODE). The game reconnects with the same nick.
import { TRACKS } from './tracks/index.js';
import { CARS } from './cars.js';       // pure data — safe in the lobby (no Three.js)

const HOST = localStorage.getItem('ns-mp-host') || 'https://drive-mp.esc5221.workers.dev';
const $ = id => document.getElementById(id);

// ---- nickname ---------------------------------------------------------------
const defaultNick = () => 'Driver-' + Math.random().toString(36).slice(2, 6).toUpperCase();
const nickEl = $('nick');
nickEl.value = localStorage.getItem('ns-nick') || defaultNick();
const saveNick = () => {
  const n = (nickEl.value.trim() || defaultNick()).slice(0, 16);
  localStorage.setItem('ns-nick', n);
  return n;
};

// ---- track picker (create flow) ----------------------------------------------
let selTrack = localStorage.getItem('ns-track') || 'practice';
if (!TRACKS.some(t => t.id === selTrack && !t.hidden)) selTrack = 'practice';
let seed = (Math.random() * 0xffffffff) >>> 0;
const trackRow = $('trackrow');
for (const t of TRACKS) {
  if (t.hidden) continue;
  const b = document.createElement('button');
  b.className = 'opt' + (t.id === selTrack ? ' active' : '');
  b.textContent = t.random ? '랜덤 🎲' : t.name;
  b.onclick = () => {
    if (t.random && selTrack === 'random') seed = (Math.random() * 0xffffffff) >>> 0;  // reroll on re-tap
    selTrack = t.id;
    trackRow.querySelectorAll('.opt').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  };
  trackRow.appendChild(b);
}

// ---- car picker: 자유(각자) or a unified car for everyone -----------------------
let selCar = null;                       // null = free choice
{
  const row = $('carrow');
  const opts = [[null, '자유 (각자 선택)'], ...Object.values(CARS).filter(c => !c.hidden).map(c => [c.id, c.name])];
  for (const [id, label] of opts) {
    const b = document.createElement('button');
    b.className = 'opt' + (id === selCar ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      selCar = id;
      row.querySelectorAll('.opt').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    };
    row.appendChild(b);
  }
}

// ---- weather picker: always room-owned (rain changes grip => must match) --------
const WX = [[0, '☀️ 맑음'], [2, '🌅 석양'], [5, '🌙 밤'], [4, '🌧 비']];   // atmo preset indices
let selWx = 0;
{
  const row = $('wxrow');
  for (const [idx, label] of WX) {
    const b = document.createElement('button');
    b.className = 'opt' + (idx === selWx ? ' active' : '');
    b.textContent = label;
    b.onclick = () => {
      selWx = idx;
      row.querySelectorAll('.opt').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    };
    row.appendChild(b);
  }
}

// ---- state -------------------------------------------------------------------
let ws = null, room = null, meta = null, you = 0, roster = [];
const err = m => { $('err').textContent = m || ''; };

function trackName(id) {
  const t = TRACKS.find(x => x.id === id);
  return t ? (t.random ? '랜덤 트랙' : t.name) : id;
}
function metaSummary(m) {
  const car = m.car ? (CARS[m.car]?.name || m.car) + ' 통일' : '차량 자유';
  const wx = (WX.find(w => w[0] === (m.preset ?? 0)) || WX[0])[1];
  return `${trackName(m.track)}${m.track === 'random' ? ` #${m.seed >>> 0}` : ''} · ${car} · ${wx}`;
}
const tintCss = i => `hsl(${(i * 137.508) % 360}, 72%, 55%)`;

// ---- screens -------------------------------------------------------------------
function showRoom() {
  $('s-entry').hidden = true;
  $('s-room').hidden = false;
  $('rc').textContent = room;
  $('rt').textContent = metaSummary(meta);
  renderRoster();
}
function showEntry() {
  $('s-room').hidden = true;
  $('s-entry').hidden = false;
}
function renderRoster() {
  const ul = $('roster');
  ul.innerHTML = '';
  for (const p of roster) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot'; dot.style.background = tintCss(p.i);
    const name = document.createElement('span');
    name.textContent = p.nick;
    li.append(dot, name);
    if (p.i === you) { const me = document.createElement('span'); me.className = 'me'; me.textContent = '나'; li.appendChild(me); }
    ul.appendChild(li);
  }
}

// ---- room ops ------------------------------------------------------------------
async function createRoom() {
  saveNick(); err('');
  $('create').disabled = true;
  try {
    const body = { track: selTrack, seed: selTrack === 'random' ? seed : 0, car: selCar, preset: selWx };
    const r = await fetch(HOST + '/create', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const { code } = await r.json();
    joinRoom(code);
  } catch (e) { err('서버에 연결할 수 없습니다'); }
  $('create').disabled = false;
}

async function joinRoom(code) {
  saveNick(); err('');
  code = code.toUpperCase().trim();
  try {
    const r = await fetch(`${HOST}/room/${code}/meta`);
    if (!r.ok) { err('방을 찾을 수 없습니다: ' + code); return; }
    meta = await r.json();
    room = code;
    const u = new URL(location.href); u.searchParams.set('room', code);
    history.replaceState(null, '', u);
    connect();
  } catch (e) { err('서버에 연결할 수 없습니다'); }
}

function connect() {
  const q = `nick=${encodeURIComponent(saveNick())}&car=${encodeURIComponent(localStorage.getItem('ns-car') || 'gt3rs')}`;
  ws = new WebSocket(`${HOST.replace(/^http/, 'ws')}/room/${room}/ws?${q}`);
  ws.onmessage = e => {
    if (typeof e.data !== 'string') return;            // lobby ignores state packets
    let m; try { m = JSON.parse(e.data); } catch (x) { return; }
    if (m.t === 'hello') { you = m.you; meta = m.meta; roster = m.roster; showRoom(); }
    else if (m.t === 'join') { if (!roster.some(p => p.i === m.p.i)) roster.push(m.p); renderRoster(); }
    else if (m.t === 'leave') { roster = roster.filter(p => p.i !== m.i); renderRoster(); }
  };
  ws.onclose = () => { if (room) setTimeout(() => room && connect(), 2500); };  // quiet reconnect
  // keepalive so proxies don't drop the idle waiting-room socket (autoResponse, no DO wake)
  clearInterval(connect._ka);
  connect._ka = setInterval(() => { try { ws && ws.readyState === 1 && ws.send('ping'); } catch (e) {} }, 25000);
}

function leaveRoom() {
  const w = ws; ws = null; room = null;
  clearInterval(connect._ka);
  if (w) { w.onclose = null; w.close(); }
  const u = new URL(location.href); u.searchParams.delete('room');
  history.replaceState(null, '', u);
  showEntry();
}

function startDriving() {
  // hand off to the game: align the room's world (track+seed+car+weather), skip the menu
  localStorage.setItem('ns-track', meta.track);
  if (meta.track === 'random') localStorage.setItem('ns-random-seed', String(meta.seed >>> 0));
  if (meta.car) localStorage.setItem('ns-car', meta.car);           // unified car -> forced
  if (meta.preset != null) localStorage.setItem('ns-preset', String(meta.preset));
  sessionStorage.setItem('ns-go', '1');
  const code = room;
  const w = ws; ws = null; room = null;                // stop the reconnect loop
  clearInterval(connect._ka);
  if (w) { w.onclose = null; w.close(); }              // lobby seat frees; game reconnects
  location.href = './?room=' + code;
}

// ---- wire up --------------------------------------------------------------------
$('create').onclick = createRoom;
$('joinbtn').onclick = () => { const c = $('code').value; if (c.trim().length >= 4) joinRoom(c); };
$('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinbtn').click(); });
$('copy').onclick = () => {
  const link = location.origin + '/multi?room=' + room;
  navigator.clipboard?.writeText(link).then(() => {
    $('copy').textContent = '복사됨!';
    setTimeout(() => $('copy').textContent = '🔗 초대 링크 복사', 1200);
  });
};
$('drive').onclick = startDriving;
$('leave').onclick = leaveRoom;
$('joingo').onclick = () => joinRoom($('jb-code').textContent);

// invite link: show a focused one-tap join entry (nick still editable)
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  $('joinbanner').hidden = false;
  $('jb-code').textContent = invited.toUpperCase();
  $('createui').style.display = 'none';
  $('orsep').style.display = 'none';
  $('coderow').style.display = 'none';
  $('joingo').hidden = false;
}
