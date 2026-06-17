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
    h.textContent = 'Settings';
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

    card.appendChild(ROW('Car', group('car',
      Object.values(CARS).filter(c => !c.hidden).map(c => [c.name, () => this.api.setCar(c.id)]))));

    if (this.api.isTouch) {
      card.appendChild(ROW('Steering', group('ctrl', [
        ['Button', () => this.api.setCtrl('buttons')],
        ['Tilt (gyro)', () => this.api.setCtrl('tilt')],
      ])));
    }

    card.appendChild(ROW('Camera', group('cam', [
      ['Cockpit', () => this.api.setCam(0)],
      ['Hood', () => this.api.setCam(1)],
      ['Chase', () => this.api.setCam(2)],
    ])));

    card.appendChild(ROW('Driver aids', [
      ...group('tc', [['TC/ESC', () => this.api.toggle('tc')]]),
      ...group('abs', [['ABS', () => this.api.toggle('abs')]]),
      ...group('auto', [['Auto shift', () => this.api.toggle('auto')]]),
    ]));

    card.appendChild(ROW('Racing line', group('line', [
      ['Off', () => this.api.setLineMode(0)],
      ['Brake guide', () => this.api.setLineMode(1)],
      ['Full line', () => this.api.setLineMode(2)],
    ])));

    card.appendChild(ROW('Display', [
      ...group('ghost', [['Ghost', () => this.api.toggle('ghost')]]),
    ]));

    card.appendChild(ROW('Weather / Time', group('preset', [
      ['Noon', () => this.api.setPreset(0)],
      ['Eifel Morning', () => this.api.setPreset(1)],
      ['Sunset', () => this.api.setPreset(2)],
      ['Night', () => this.api.setPreset(3)],
      ['Rain', () => this.api.setPreset(4)],
      ['Night · Lit', () => this.api.setPreset(5)],
    ])));

    card.appendChild(ROW('Graphics (restart to apply)', group('tier', [
      ['Auto', () => this.api.setTier(null)],
      ['Ultra', () => this.api.setTier('ultra')],
      ['High', () => this.api.setTier('high')],
      ['Low', () => this.api.setTier('low')],
    ])));

    // Sound layers — one toggle per layer, grouped. Lets you mute any single
    // sound live (engine, shift, tires, brakes…) if it isn't to your taste.
    if (this.api.audioLayers) {
      const defs = this.api.audioLayers();
      const groups = {};
      for (const d of defs) (groups[d.group] = groups[d.group] || []).push(d);
      this._audioBtns = {};
      for (const gname in groups) {
        const row = groups[gname].map(d => {
          const b = btn(d.label, () => {
            const st = this.api.audioState()[d.key];
            this.api.setAudioLayer(d.key, !(st && st.on));
            this.refresh();
          });
          this._audioBtns[d.key] = b;
          return b;
        });
        card.appendChild(ROW('Sound · ' + gname, row));
      }
    }

    const danger = btn('Clear best lap / ghost', () => {
      this.api.resetRecords();
      this.refresh();
    });
    danger.classList.add('danger');
    card.appendChild(ROW('Records', [danger]));

    const resume = btn('Resume', () => this.close());
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
    const carIds = Object.values(CARS).filter(c => !c.hidden).map(c => c.id);
    this._mark('car', carIds.indexOf(s.car));
    if (this.btns.ctrl) this._mark('ctrl', s.ctrl === 'tilt' ? 1 : 0);
    this._mark('cam', s.cam);
    this.btns.tc[0].classList.toggle('active', s.tc);
    this.btns.abs[0].classList.toggle('active', s.abs);
    this.btns.auto[0].classList.toggle('active', s.auto);
    this._mark('line', s.line);
    this.btns.ghost[0].classList.toggle('active', s.ghost);
    this._mark('preset', s.preset);
    const tierIdx = { ultra: 1, high: 2, low: 3 }[localStorage.getItem('ns-tier')] || 0;
    this._mark('tier', tierIdx);
    if (this._audioBtns) {
      const ast = this.api.audioState();
      for (const k in this._audioBtns) this._audioBtns[k].classList.toggle('active', !!(ast[k] && ast[k].on));
    }
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
