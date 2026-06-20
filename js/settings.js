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
  // api: { getState, setCar, setCam, setCtrl, setPreset, toggle(name),
  //        resetRecords, setPaused, isTouch,
  //        gfxCfg, gfxDefs, gfxPresets, setGfxPreset, setGfxOption,
  //        audioLayers, audioState, setAudioLayer }
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

    // Tabs (at the top): General | Sound. Sound has its own tab so the per-layer
    // mute toggles don't bury the regular settings. Resume stays shared below.
    const tabBar = document.createElement('div');
    tabBar.className = 'set-tabs';
    const gen = document.createElement('div');
    const gfxPane = document.createElement('div');
    const snd = document.createElement('div');
    this._panes = { general: gen, graphics: gfxPane, sound: snd };
    this._tabBtns = {};
    const mkTab = (key, label) => {
      const b = document.createElement('button');
      b.className = 'set-tab';
      b.textContent = label;
      b.addEventListener('click', e => { e.preventDefault(); this.selectTab(key); });
      this._tabBtns[key] = b;
      tabBar.appendChild(b);
    };
    mkTab('general', 'General');
    mkTab('graphics', 'Graphics');
    mkTab('sound', 'Sound');
    card.appendChild(tabBar);
    card.appendChild(gen);
    card.appendChild(gfxPane);
    card.appendChild(snd);

    // ---- General tab ----
    gen.appendChild(ROW('Car', group('car',
      Object.values(CARS).filter(c => !c.hidden).map(c => [c.name, () => this.api.setCar(c.id)]))));

    if (this.api.isTouch) {
      gen.appendChild(ROW('Steering', group('ctrl', [
        ['Button', () => this.api.setCtrl('buttons')],
        ['Tilt (gyro)', () => this.api.setCtrl('tilt')],
      ])));
    }

    gen.appendChild(ROW('Camera', group('cam', [
      ['Cockpit', () => this.api.setCam(0)],
      ['Hood', () => this.api.setCam(1)],
      ['Chase', () => this.api.setCam(2)],
    ])));

    gen.appendChild(ROW('Driver aids', [
      ...group('tc', [['TC/ESC', () => this.api.toggle('tc')]]),
      ...group('abs', [['ABS', () => this.api.toggle('abs')]]),
      ...group('auto', [['Auto shift', () => this.api.toggle('auto')]]),
    ]));

    gen.appendChild(ROW('Racing line', group('line', [
      ['Off', () => this.api.setLineMode(0)],
      ['Brake guide', () => this.api.setLineMode(1)],
      ['Full line', () => this.api.setLineMode(2)],
    ])));

    gen.appendChild(ROW('Display', [
      ...group('ghost', [['Ghost', () => this.api.toggle('ghost')]]),
    ]));

    gen.appendChild(ROW('Weather / Time', group('preset', [
      ['Noon', () => this.api.setPreset(0)],
      ['Eifel Morning', () => this.api.setPreset(1)],
      ['Sunset', () => this.api.setPreset(2)],
      ['Night', () => this.api.setPreset(3)],
      ['Rain', () => this.api.setPreset(4)],
      ['Night · Lit', () => this.api.setPreset(5)],
    ])));

    const danger = btn('Clear best lap / ghost', () => {
      this.api.resetRecords();
      this.refresh();
    });
    danger.classList.add('danger');
    gen.appendChild(ROW('Records', [danger]));

    // ---- Graphics tab: preset picker on top, individual options below ----
    if (this.api.gfxCfg) {
      const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
      this._gfxPresetBtns = this.api.gfxPresets().map(name =>
        btn(cap(name), () => this.api.setGfxPreset(name)));   // reloads to re-apply
      gfxPane.appendChild(ROW('Preset', this._gfxPresetBtns));

      this._gfxOptBtns = {};                                  // key -> [{val, b}]
      for (const d of this.api.gfxDefs()) {
        this._gfxOptBtns[d.key] = d.opts.map(([label, val]) => ({
          val, b: btn(label, () => { this.api.setGfxOption(d.key, val); this.refresh(); }),
        }));
        gfxPane.appendChild(ROW(d.label, this._gfxOptBtns[d.key].map(o => o.b)));
      }
    } else {
      this._tabBtns.graphics.style.display = 'none';
    }

    // ---- Sound tab: one toggle per layer, grouped (mute any single sound live) ----
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
        snd.appendChild(ROW(gname, row));
      }
    } else {
      this._tabBtns.sound.style.display = 'none';
    }

    const resume = btn('Resume', () => this.close());
    resume.id = 'set-resume';
    card.appendChild(resume);
    this.selectTab('general');

    el.appendChild(card);
    // tap outside the card closes the panel
    el.addEventListener('pointerdown', e => {
      if (e.target === el) this.close();
    });
    document.body.appendChild(el);
    this._mark = mark;
  }

  selectTab(key) {
    if (!this._panes) return;
    for (const k in this._panes) this._panes[k].style.display = (k === key) ? 'block' : 'none';
    for (const k in this._tabBtns) this._tabBtns[k].classList.toggle('active', k === key);
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
    if (this._gfxPresetBtns) {
      const cfg = this.api.gfxCfg();
      const presets = this.api.gfxPresets();
      this._gfxPresetBtns.forEach((b, i) => b.classList.toggle('active', presets[i] === cfg.preset));
      for (const k in this._gfxOptBtns)
        for (const o of this._gfxOptBtns[k]) o.b.classList.toggle('active', cfg[k] === o.val);
    }
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
