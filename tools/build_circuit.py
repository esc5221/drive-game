#!/usr/bin/env python3
"""
Generalized circuit builder — same pipeline as the Nordschleife (OSM raceway
stitch + real elevation), driven by a per-circuit CONFIG so we can add famous
tracks at the same data quality.

Usage: python3 tools/build_circuit.py spa
Emits: data/<id>.json  and  js/tracks/<id>.js  (export const TRACK = {...})
"""
import json, math, os, re, sys, time, urllib.request, urllib.parse

ROOT = '/Users/lullu/mainpy/drive-game'

CONFIGS = {
    'spa': {
        'name': 'Circuit de Spa-Francorchamps',
        'bbox': (50.42, 5.95, 50.47, 6.00),
        'exclude': r'Kart|Pit Lane|Support Pit|Moto layout',
        'start': 'La Source',
        'step': 5.0,
        'elev_node': 55,        # spline nodes wide enough to bridge SRTM plateaus
        'max_grade': 0.19,      # gentle backstop; spline already continuous
        # hand-sculpt Eau Rouge/Raidillon — the free DEM can't capture its
        # signature compression + steep launch. Absolute elevations (m) at arc
        # positions, crossfaded into the DEM over `blend` m at each end.
        # Bottom dip ~390, then ~17% up through Raidillon to the crest, then
        # the Kemmel straight keeps climbing (rejoining the DEM).
        'elev_sculpt': {
            'range': (628, 1015), 'blend': 55,
            'points': [(628, 391.5), (663, 389.5), (700, 390.5), (735, 393.5),
                       (770, 401), (805, 409), (840, 415), (880, 418.5),
                       (950, 419.5), (1015, 419)],
        },
    },
}


def load_ways(raw, exclude):
    ex = re.compile(exclude, re.I)
    ways = []
    for w in raw['elements']:
        name = w.get('tags', {}).get('name', '')
        if name and ex.search(name):
            continue
        ways.append({'id': w['id'], 'name': name, 'nodes': w['nodes'],
                     'geom': [(g['lat'], g['lon']) for g in w['geometry']]})
    return ways


def heading(p, q):
    return math.atan2(q[1] - p[1], q[0] - p[0])


def angdiff(a, b):
    d = a - b
    while d > math.pi: d -= 2 * math.pi
    while d < -math.pi: d += 2 * math.pi
    return abs(d)


def stitch(ways, start_name):
    by_start = {}
    for w in ways:
        by_start.setdefault(w['nodes'][0], []).append(w)
    start = next(w for w in ways if w['name'] == start_name)
    loop_start = start['nodes'][0]
    used = {start['id']}
    chain = [start]
    cur = start
    for _ in range(300):
        endnode = cur['nodes'][-1]
        if endnode == loop_start:
            return chain
        cands = [w for w in by_start.get(endnode, []) if w['id'] not in used]
        if not cands:
            sys.exit(f"dead end after '{cur['name'] or cur['id']}' at node {endnode}")
        if len(cands) == 1:
            nxt = cands[0]
        else:
            h = heading(cur['geom'][-2], cur['geom'][-1])
            nxt = min(cands, key=lambda w: angdiff(heading(w['geom'][0], w['geom'][1]), h))
            skipped = [w['name'] or w['id'] for w in cands if w is not nxt]
            print(f"  branch after '{cur['name'] or cur['id']}': took "
                  f"'{nxt['name'] or nxt['id']}', skipped {skipped}")
        used.add(nxt['id'])
        chain.append(nxt)
        cur = nxt
    sys.exit('loop did not close (300 ways)')


def to_local(latlons):
    lat0 = sum(p[0] for p in latlons) / len(latlons)
    lon0 = sum(p[1] for p in latlons) / len(latlons)
    kx = 111320.0 * math.cos(math.radians(lat0))
    ky = 110574.0
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
    n = len(vals); half = window // 2
    for _ in range(passes):
        out = []
        for i in range(n):
            s = sum(vals[(i + k) % n] for k in range(-half, half + 1))
            out.append(s / (2 * half + 1))
        vals = out
    return vals


def smooth_elev_spline(ys, step, node_m):
    """Kill DEM stair-stepping without blurring features: average elevation into
    coarse nodes (~node_m apart), then closed Catmull-Rom back to per-point. The
    raw open DEM returns quantized plateaus + jumps; this restores a continuous
    profile that keeps the real climb location/magnitude."""
    n = len(ys)
    ns = max(2, round(node_m / step))
    m = max(4, round(n / ns))
    ns = n / m
    nodes = []
    for k in range(m):
        c = k * ns
        i0, i1 = int(c - ns / 2), int(c + ns / 2)
        s = cnt = 0
        for i in range(i0, i1 + 1):
            s += ys[i % n]; cnt += 1
        nodes.append(s / cnt)

    def cr(p0, p1, p2, p3, t):
        t2, t3 = t * t, t * t * t
        return 0.5 * (2*p1 + (-p0+p2)*t + (2*p0-5*p1+4*p2-p3)*t2 + (-p0+3*p1-3*p2+p3)*t3)

    out = []
    for i in range(n):
        f = i / ns                  # node-space position
        k = int(math.floor(f)) % m
        t = f - math.floor(f)
        out.append(cr(nodes[(k-1) % m], nodes[k], nodes[(k+1) % m], nodes[(k+2) % m], t))
    return out


def apply_sculpt(ys, step, sc):
    """Override a region's elevation with hand-authored anchors, crossfaded into
    the DEM profile over `blend` m at each end so it joins seamlessly."""
    (r0, r1), blend = sc['range'], sc['blend']
    anchors = sc['points']
    arcs = [a for a, _ in anchors]; yv = [y for _, y in anchors]

    def target(s):
        if s <= arcs[0]: return yv[0]
        if s >= arcs[-1]: return yv[-1]
        for k in range(1, len(arcs)):
            if s <= arcs[k]:
                t = (s - arcs[k - 1]) / (arcs[k] - arcs[k - 1])
                return yv[k - 1] + (yv[k] - yv[k - 1]) * t
        return yv[-1]

    n = len(ys); out = list(ys)
    for i in range(n):
        s = i * step
        if not (r0 - blend <= s <= r1 + blend):
            continue
        w = 1.0
        if s < r0: w = (s - (r0 - blend)) / blend
        elif s > r1: w = ((r1 + blend) - s) / blend
        w = max(0.0, min(1.0, w))
        w = w * w * (3 - 2 * w)                  # smoothstep crossfade
        out[i] = ys[i] * (1 - w) + target(s) * w
    return smooth_closed(out, 5, 1)


def slope_limit(ys, step, max_grade):
    n = len(ys); mx = step * max_grade
    ys = list(ys)
    for _ in range(4):
        changed = False
        for i in range(1, 2 * n):
            a, b = (i - 1) % n, i % n
            if ys[b] > ys[a] + mx: ys[b] = ys[a] + mx; changed = True
        for i in range(2 * n, 0, -1):
            a, b = i % n, (i - 1) % n
            if ys[b] > ys[a] + mx: ys[b] = ys[a] + mx; changed = True
        if not changed: break
    half = 2
    return [sum(ys[(i + k) % n] for k in range(-half, half + 1)) / (2 * half + 1) for i in range(n)]


def fetch_elevation(latlons):
    elev = []; B = 500
    for i in range(0, len(latlons), B):
        batch = latlons[i:i + B]
        body = json.dumps({'locations': [{'latitude': p[0], 'longitude': p[1]} for p in batch]}).encode()
        req = urllib.request.Request('https://api.open-elevation.com/api/v1/lookup',
                                     data=body, headers={'Content-Type': 'application/json'})
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


def main(cid):
    cfg = CONFIGS[cid]
    step = cfg['step']
    print(f'fetching OSM for {cfg["name"]}...')
    q = (f'[out:json][timeout:90];way["highway"="raceway"]'
         f'({cfg["bbox"][0]},{cfg["bbox"][1]},{cfg["bbox"][2]},{cfg["bbox"][3]});out geom;')
    req = urllib.request.Request(
        'https://overpass-api.de/api/interpreter',
        data=urllib.parse.urlencode({'data': q}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded',
                 'User-Agent': 'nordschleife-game/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = json.load(r)

    ways = load_ways(raw, cfg['exclude'])
    print(f'{len(ways)} candidate ways')
    chain = stitch(ways, cfg['start'])
    print(f'stitched {len(chain)} ways')

    latlons = []; seg_marks = []
    for w in chain:
        seg_marks.append((w['name'], len(latlons)))
        latlons += w['geom'] if not latlons else w['geom'][1:]

    local, (lat0, lon0, kx, ky) = to_local(latlons)
    cum = [0.0]
    for i in range(1, len(local)):
        cum.append(cum[-1] + math.hypot(local[i][0]-local[i-1][0], local[i][1]-local[i-1][1]))
    total_raw = cum[-1] + math.hypot(local[0][0]-local[-1][0], local[0][1]-local[-1][1])
    print(f'raw length: {total_raw/1000:.3f} km')
    segs = [{'name': n, 's': cum[idx]} for n, idx in seg_marks if n]

    pts = resample(local, step)
    n = len(pts)
    xs = smooth_closed([p[0] for p in pts], 5, passes=2)
    zs = smooth_closed([p[1] for p in pts], 5, passes=2)

    ll = [(lat0 - z/ky, lon0 + x/kx) for x, z in zip(xs, zs)]
    print('fetching elevation...')
    ys = fetch_elevation(ll)
    if cfg.get('elev_node'):
        ys = smooth_elev_spline(ys, step, cfg['elev_node'])
    else:
        sw, sp = cfg.get('elev_smooth', (9, 3))
        ys = smooth_closed(ys, sw, passes=sp)
    if cfg.get('elev_sculpt'):
        ys = apply_sculpt(ys, step, cfg['elev_sculpt'])
    g0 = max(abs(ys[(i+1) % n]-ys[i]) for i in range(n)) / step
    if cfg.get('max_grade'):
        ys = slope_limit(ys, step, cfg['max_grade'])
    g1 = max(abs(ys[(i+1) % n]-ys[i]) for i in range(n)) / step
    print(f'max grade: {g0*100:.0f}% -> {g1*100:.0f}%')

    total = n * step
    data = {'name': cfg['name'], 'step': step, 'total': total,
            'points': [[round(x, 2), round(y, 2), round(z, 2)] for x, y, z in zip(xs, ys, zs)],
            'segments': segs, 'origin': {'lat': lat0, 'lon': lon0}}
    json.dump(data, open(f'{ROOT}/data/{cid}.json', 'w'))
    os.makedirs(f'{ROOT}/js/tracks', exist_ok=True)
    with open(f'{ROOT}/js/tracks/{cid}.js', 'w') as f:
        f.write('export const TRACK = '); json.dump(data, f); f.write(';\n')
    print(f'{n} points, {total/1000:.3f} km, elev {min(ys):.0f}-{max(ys):.0f} m, {len(segs)} sections')
    for s in segs:
        print(f"  {s['s']/1000:7.3f} km  {s['name']}")


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'spa')
