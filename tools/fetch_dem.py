#!/usr/bin/env python3
"""Fetch a real-elevation DEM grid around the track (open-elevation),
emit data/dem.json + js/dem_data.js."""
import json, math, time, urllib.request

ROOT = '/Users/lullu/mainpy/drive-game'
track = json.load(open(f'{ROOT}/data/track.json'))
lat0 = track['origin']['lat']; lon0 = track['origin']['lon']
kx = 111320.0 * math.cos(math.radians(lat0)); ky = 110574.0

xs = [p[0] for p in track['points']]; zs = [p[2] for p in track['points']]
M = 900.0; STEP = 65.0
x0 = min(xs) - M; x1 = max(xs) + M
z0 = min(zs) - M; z1 = max(zs) + M
nx = int((x1 - x0) / STEP) + 1
nz = int((z1 - z0) / STEP) + 1
print(f'grid {nx} x {nz} = {nx*nz} points, step {STEP} m')

pts = []
for j in range(nz):
    for i in range(nx):
        x = x0 + i * STEP; z = z0 + j * STEP
        pts.append((lat0 - z / ky, lon0 + x / kx))

elev = []
B = 500
for i in range(0, len(pts), B):
    batch = pts[i:i + B]
    body = json.dumps({'locations': [{'latitude': a, 'longitude': b} for a, b in batch]}).encode()
    req = urllib.request.Request('https://api.open-elevation.com/api/v1/lookup',
                                 data=body, headers={'Content-Type': 'application/json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                elev += [p['elevation'] for p in json.load(r)['results']]
            break
        except Exception:
            if attempt == 5: raise
            time.sleep(5 * (attempt + 1))
    print(f'  {min(i+B, len(pts))}/{len(pts)}', end='\r')
    time.sleep(1.0)
print()

data = {'x0': round(x0, 1), 'z0': round(z0, 1), 'step': STEP, 'nx': nx, 'nz': nz,
        'h': [round(v, 1) for v in elev]}
json.dump(data, open(f'{ROOT}/data/dem.json', 'w'))
with open(f'{ROOT}/js/dem_data.js', 'w') as f:
    f.write('export const DEM = ')
    json.dump(data, f)
    f.write(';\n')
print(f'saved: elev {min(elev):.0f}-{max(elev):.0f} m')
