// Pause / settings panel: car, steering mode, camera, assists, time of day,
// graphics tier, record reset. Opening it pauses the game.
import { CARS } from './cars.js';

const ROW = (title, buttons) => {
  const row = document.createElement('div');
  row.className = 'set-row';
  const h = document.createElement('div');
  h.className = 'set-title';
  h.textContent = title;
  row.appendChild(h);
  const wrap = document.createElement('div');
  wrap.className = 'set-btns';
  for (const b of buttons) wrap.appendChild(b);
  row.appendChild(wrap);
  return row;
};

function btn(label, onClick) {
  const b = document.createElement('button');
  b.className = 'set-btn';
  b.textContent = label;
  b.addEventListener('click', e => { e.preventDefault(); onClick(b); });
  return b;
}

export class SettingsPanel {
  // api: { getState, setCar, setCam, setCtrl, setPreset, setTier,
  //        toggle(name), resetRecords, setPaused, isTouch }
  constructor(api) {
    this.api = api;
    this.open = false;
    this._build();
  }

  _build() {
    const el = this.el = document.createElement('div');
    el.id = 'settings';
    el.style.display = 'none';

    const card = document.createElement('div');
    card.id = 'settings-card';
    const h = document.createElement('h2');
    h.textContent = '설정';
    card.appendChild(h);

    this.btns = {};
    const mark = (group, idx) => {
      (this.btns[group] || []).forEach((b, i) =>
        b.classList.toggle('active', i === idx));
    };
    const group = (name, defs) => {
      this.btns[name] = defs.map(([label, fn], i) =>
        btn(label, () => { fn(); this.refresh(); }));
      return this.btns[name];
    };

    card.appendChild(ROW('차량', group('car',
      Object.values(CARS).map(c => [c.name, () => this.api.setCar(c.id)]))));

    if (this.api.isTouch) {
      card.appendChild(ROW('조향', group('ctrl', [
        ['버튼', () => this.api.setCtrl('buttons')],
        ['틸트 (자이로)', () => this.api.setCtrl('tilt')],
      ])));
    }

    card.appendChild(ROW('카메라', group('cam', [
      ['콕핏', () => this.api.setCam(0)],
      ['후드', () => this.api.setCam(1)],
      ['체이스', () => this.api.setCam(2)],
    ])));

    card.appendChild(ROW('주행 보조', [
      ...group('tc', [['TC/ESC', () => this.api.toggle('tc')]]),
      ...group('abs', [['ABS', () => this.api.toggle('abs')]]),
      ...group('auto', [['자동변속', () => this.api.toggle('auto')]]),
    ]));

    card.appendChild(ROW('표시', [
      ...group('line', [['레이싱 라인', () => this.api.toggle('line')]]),
      ...group('ghost', [['고스트', () => this.api.toggle('ghost')]]),
    ]));

    card.appendChild(ROW('트래픽 (투어리스트 주행)', group('traffic', [
      ['없음', () => this.api.setTraffic(0)],
      ['적음', () => this.api.setTraffic(6)],
      ['보통', () => this.api.setTraffic(12)],
    ])));

    card.appendChild(ROW('시간대', group('preset', [
      ['정오', () => this.api.setPreset(0)],
      ['아침 안개', () => this.api.setPreset(1)],
      ['석양', () => this.api.setPreset(2)],
    ])));

    card.appendChild(ROW('그래픽 (변경 시 재시작)', group('tier', [
      ['자동', () => this.api.setTier(null)],
      ['울트라', () => this.api.setTier('ultra')],
      ['하이', () => this.api.setTier('high')],
      ['로우', () => this.api.setTier('low')],
    ])));

    const danger = btn('베스트랩/고스트 기록 초기화', () => {
      this.api.resetRecords();
      this.refresh();
    });
    danger.classList.add('danger');
    card.appendChild(ROW('기록', [danger]));

    const resume = btn('계속하기', () => this.close());
    resume.id = 'set-resume';
    card.appendChild(resume);

    el.appendChild(card);
    // tap outside the card closes the panel
    el.addEventListener('pointerdown', e => {
      if (e.target === el) this.close();
    });
    document.body.appendChild(el);
    this._mark = mark;
  }

  refresh() {
    const s = this.api.getState();
    const carIds = Object.keys(CARS);
    this._mark('car', carIds.indexOf(s.car));
    if (this.btns.ctrl) this._mark('ctrl', s.ctrl === 'tilt' ? 1 : 0);
    this._mark('cam', s.cam);
    this.btns.tc[0].classList.toggle('active', s.tc);
    this.btns.abs[0].classList.toggle('active', s.abs);
    this.btns.auto[0].classList.toggle('active', s.auto);
    this.btns.line[0].classList.toggle('active', s.line);
    this.btns.ghost[0].classList.toggle('active', s.ghost);
    this._mark('traffic', s.traffic >= 12 ? 2 : s.traffic > 0 ? 1 : 0);
    this._mark('preset', s.preset);
    const tierIdx = { ultra: 1, high: 2, low: 3 }[localStorage.getItem('ns-tier')] || 0;
    this._mark('tier', tierIdx);
  }

  show() {
    this.open = true;
    this.refresh();
    this.el.style.display = 'flex';
    this.api.setPaused(true);
  }
  close() {
    this.open = false;
    this.el.style.display = 'none';
    this.api.setPaused(false);
  }
  toggle() { this.open ? this.close() : this.show(); }
}
