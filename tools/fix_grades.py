#!/usr/bin/env python3
"""Slope-limit track elevations: the 90m DEM bleeds valley-wall heights into
the road in the Adenau gorge (70% grades near Exmühle). Real Nordschleife
max gradient is ~17%. Lower-only min-propagation, both directions, closed
loop, then light re-smoothing."""
import json

ROOT = '/Users/lullu/mainpy/drive-game'
MAX_GRADE = 0.17

track = json.load(open(f'{ROOT}/data/track.json'))
pts = track['points']
n = len(pts)
step = track['step']
ys = [p[1] for p in pts]
max_step = step * MAX_GRADE

worst_before = max(abs(ys[(i + 1) % n] - ys[i]) / step for i in range(n))

# lower-only slope limiting (cuts DEM wall spikes, keeps genuine summits
# whose approaches are within grade)
for _ in range(4):
    changed = False
    for i in range(1, 2 * n):           # forward, wraps twice for closure
        a, b = (i - 1) % n, i % n
        lim = ys[a] + max_step
        if ys[b] > lim: ys[b] = lim; changed = True
    for i in range(2 * n, 0, -1):       # backward
        a, b = i % n, (i - 1) % n
        lim = ys[a] + max_step
        if ys[b] > lim: ys[b] = lim; changed = True
    if not changed: break

# light smoothing to round the clamp creases
half = 2
sm = [sum(ys[(i + k) % n] for k in range(-half, half + 1)) / (2 * half + 1) for i in range(n)]
ys = sm

worst_after = max(abs(ys[(i + 1) % n] - ys[i]) / step for i in range(n))
moved = [(i, pts[i][1] - ys[i]) for i in range(n) if abs(pts[i][1] - ys[i]) > 1.0]
print(f'max grade: {worst_before*100:.0f}% -> {worst_after*100:.1f}%')
print(f'points lowered >1m: {len(moved)} (max cut {max(m[1] for m in moved):.1f} m)' if moved else 'no big cuts')

for i in range(n):
    pts[i][1] = round(ys[i], 2)

json.dump(track, open(f'{ROOT}/data/track.json', 'w'))
with open(f'{ROOT}/js/track_data.js', 'w') as f:
    f.write('export const TRACK = ')
    json.dump(track, f)
    f.write(';\n')
print('saved track.json + track_data.js')
