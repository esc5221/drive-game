// Track registry — metadata for the main menu. The actual point data is
// imported statically in main.js (small enough to bundle) and selected by id.
export const TRACKS = [
  { id: 'nordschleife', name: 'Nürburgring Nordschleife', loc: 'Germany',     km: 20.7, spawn: 3550 },
  { id: 'spa',          name: 'Spa-Francorchamps',         loc: 'Belgium',     km: 7.0,  spawn: 40 },
  { id: 'practice',     name: '연습 트랙',                  loc: 'Test Facility', km: 2.05, spawn: 20 },
];

export function trackMeta(id) {
  return TRACKS.find(t => t.id === id) || TRACKS[0];
}
