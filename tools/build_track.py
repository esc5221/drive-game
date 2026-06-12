#!/usr/bin/env python3
"""
Nordschleife track builder.
1. Stitch OSM raceway ways into the full Nordschleife loop (graph walk).
2. Convert lat/lon -> local meters, resample at even spacing, smooth.
3. Fetch real elevation (open-meteo, 90m DEM) and smooth it.
4. Emit data/track.json + js/track_data.js (for file:// usage).
"""
import json, math, re, sys, time, urllib.request, urllib.parse

ROOT = '/Users/lullu/mainpy/drive-game'
RAW = f'{ROOT}/data/osm_raw.json'

EXCLUDE = re.compile(
    r'Boxengasse|Rallycross|Sprintstrecke|M.llenbachschleife|Anbindung|'
    r'Variante', re.I)

def load_ways():
    d = json.load(open(RAW))
    ways = []
    for w in d['elements']:
        name = w.get('tags', {}).get('name', '')
        if EXCLUDE.search(name):
            continue
        ways.append({
            'id': w['id'], 'name': name,
            'nodes': w['nodes'],
            'geom': [(g['lat'], g['lon']) for g in w['geometry']],
        })
    return ways

def heading(p, q):
    return math.atan2(q[1] - p[1], q[0] - p[0])

def angdiff(a, b):
    d = a - b
    while d > math.pi: d -= 2 * math.pi
    while d < -math.pi: d += 2 * math.pi
    return abs(d)

def stitch(ways):
    by_start = {}
    for w in ways:
        by_start.setdefault(w['nodes'][0], []).append(w)

    start = next(w for w in ways if w['name'] == 'Döttinger Höhe')
    loop_start_node = start['nodes'][0]
    used = {start['id']}
    chain = [start]
    cur = start
    for _ in range(200):
        endnode = cur['nodes'][-1]
        if endnode == loop_start_node:
            return chain
        cands = [w for w in by_start.get(endnode, []) if w['id'] not in used]
        if not cands:
            sys.exit(f"dead end after '{cur['name']}' (way {cur['id']}) at node {endnode}")
        if len(cands) == 1:
            nxt = cands[0]
        else:
            # prefer the way that continues straight ahead
            h = heading(cur['geom'][-2], cur['geom'][-1])
            nxt = min(cands, key=lambda w: angdiff(heading(w['geom'][0], w['geom'][1]), h))
            others = [w['name'] or w['id'] for w in cands if w is not nxt]
            print(f"  branch after '{cur['name'] or cur['id']}': took "
                  f"'{nxt['name'] or nxt['id']}', skipped {others}")
        used.add(nxt['id'])
        chain.append(nxt)
        cur = nxt
    sys.exit('loop did not close')

def to_local(latlons):
    lat0 = sum(p[0] for p in latlons) / len(latlons)
    lon0 = sum(p[1] for p in latlons) / len(latlons)
    kx = 111320.0 * math.cos(math.radians(lat0))   # m per deg lon
    ky = 110574.0                                   # m per deg lat
    # x = east, z = -north (three.js convention, y is up)
    return [((lon - lon0) * kx, -(lat - lat0) * ky) for lat, lon in latlons], (lat0, lon0, kx, ky)

def resample(pts, step):
    out = [pts[0]]
    acc = 0.0
    for i in range(1, len(pts)):
        ax, az = pts[i - 1]; bx, bz = pts[i]
        seg = math.hypot(bx - ax, bz - az)
        while acc + seg >= step:
            t = (step - acc) / seg
            ax, az = ax + (bx - ax) * t, az + (bz - az) * t
            out.append((ax, az))
            seg = math.hypot(bx - ax, bz - az)
            acc = 0.0
        acc += seg
    return out

def smooth_closed(vals, window, passes=1):
    n = len(vals)
    half = window // 2
    for _ in range(passes):
        out = []
        for i in range(n):
            s = 0.0
            for k in range(-half, half + 1):
                s += vals[(i + k) % n]
            out.append(s / (2 * half + 1))
        vals = out
    return vals

def fetch_elevation(latlons):
    elev = []
    B = 500
    for i in range(0, len(latlons), B):
        batch = latlons[i:i + B]
        body = json.dumps({'locations': [
            {'latitude': p[0], 'longitude': p[1]} for p in batch]}).encode()
        req = urllib.request.Request(
            'https://api.open-elevation.com/api/v1/lookup', data=body,
            headers={'Content-Type': 'application/json'})
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    elev += [pt['elevation'] for pt in json.load(r)['results']]
                break
            except Exception:
                if attempt == 4: raise
                time.sleep(5 * (attempt + 1))
        print(f'  elevation {min(i+B,len(latlons))}/{len(latlons)}', end='\r')
        time.sleep(1.0)
    print()
    return elev

def main():
    step = 5.0
    ways = load_ways()
    print(f'{len(ways)} candidate ways')
    chain = stitch(ways)
    print(f'stitched {len(chain)} ways:')

    # concat geometry, dropping duplicated junction points
    latlons = []
    seg_marks = []  # (name, index into latlons)
    for w in chain:
        seg_marks.append((w['name'], len(latlons)))
        pts = w['geom'] if not latlons else w['geom'][1:]
        latlons += pts

    local, (lat0, lon0, kx, ky) = to_local(latlons)

    # arc-length positions of segment marks (before resampling)
    cum = [0.0]
    for i in range(1, len(local)):
        cum.append(cum[-1] + math.hypot(local[i][0] - local[i-1][0],
                                        local[i][1] - local[i-1][1]))
    total_raw = cum[-1] + math.hypot(local[0][0] - local[-1][0],
                                     local[0][1] - local[-1][1])
    print(f'raw length: {total_raw/1000:.3f} km')

    segs = [{'name': n, 's': cum[idx]} for n, idx in seg_marks if n]

    pts = resample(local, step)
    n = len(pts)
    xs = smooth_closed([p[0] for p in pts], 5, passes=2)
    zs = smooth_closed([p[1] for p in pts], 5, passes=2)

    # back to lat/lon for elevation query
    ll = [(lat0 - z / ky, lon0 + x / kx) for x, z in zip(xs, zs)]
    print('fetching elevation...')
    ys = fetch_elevation(ll)
    ys = smooth_closed(ys, 9, passes=3)

    total = n * step
    data = {
        'name': 'Nürburgring Nordschleife',
        'step': step,
        'total': total,
        'points': [[round(x, 2), round(y, 2), round(z, 2)]
                   for x, y, z in zip(xs, ys, zs)],
        'segments': segs,
        'origin': {'lat': lat0, 'lon': lon0},
    }
    json.dump(data, open(f'{ROOT}/data/track.json', 'w'))
    with open(f'{ROOT}/js/track_data.js', 'w') as f:
        f.write('export const TRACK = ')
        json.dump(data, f)
        f.write(';\n')
    print(f'{n} points, {total/1000:.3f} km, '
          f'elev {min(ys):.0f}-{max(ys):.0f} m, {len(segs)} named sections')
    for s in segs:
        print(f"  {s['s']/1000:7.3f} km  {s['name']}")

if __name__ == '__main__':
    main()
