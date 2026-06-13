#!/usr/bin/env python3
"""Procedural kart circuit — narrow (7.5m), flat, tight & technical the way a
real kart track is (hairpins, esses, chicanes, one short straight). Karts love
it; other cars fit too (just snug). Same TRACK format + a roadHalf field."""
import json, math, os

ROOT = '/Users/lullu/mainpy/drive-game'
STEP = 4.0           # finer step for a small tight track
Y = 60.0
ROAD_HALF = 3.75     # ~7.5 m wide

# CCW closed loop. Compact (~280x210 m) and deliberately tight. Closure
# approaches the start from the lower-left, tangent to the straight.
CTRL = [
    (0, 0, '메인 직선'),        # short straight — the only real overtaking spot
    (110, 0, None),
    (200, 6, None),
    (255, 48, '1번 헤어핀'),     # tight right hairpin
    (232, 100, None),
    (170, 110, None),
    (120, 78, '에스'),          # quick esses
    (88, 112, None),
    (38, 80, None),
    (-12, 112, None),
    (-58, 80, '왼쪽 헤어핀'),     # tight left hairpin
    (-88, 28, None),
    (-58, -8, None),
    (-8, 6, '시케인'),          # snap chicane
    (34, -28, None),
    (-12, -46, None),
    (-66, -30, '스위퍼'),        # flowing left sweeper down
    (-112, -66, None),
    (-98, -122, None),
    (-40, -140, '복합 코너'),    # double-apex
    (28, -124, None),
    (62, -80, None),
    (28, -46, None),           # ease back up toward the start...
    (-30, -34, None),
    (-42, -10, None),          # ...approach from the left, tangent to straight
]


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return (
        0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
        0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
    )


def main():
    pts = [(c[0], c[1]) for c in CTRL]
    n = len(pts)
    dense = []; seg_at = {}
    for i in range(n):
        if CTRL[i][2]:
            seg_at[i] = len(dense)
        p0, p1, p2, p3 = pts[(i-1) % n], pts[i], pts[(i+1) % n], pts[(i+2) % n]
        for k in range(28):
            dense.append(catmull(p0, p1, p2, p3, k / 28))

    def resample(poly, step):
        out = [poly[0]]; acc = 0.0
        for i in range(1, len(poly) + 1):
            a = poly[(i-1) % len(poly)]; b = poly[i % len(poly)]
            seg = math.hypot(b[0]-a[0], b[1]-a[1])
            while acc + seg >= step:
                t = (step - acc) / seg
                a = (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)
                out.append(a); seg = math.hypot(b[0]-a[0], b[1]-a[1]); acc = 0.0
            acc += seg
        return out

    rs = resample(dense, STEP)
    m = len(rs)

    def smooth(vals, win, passes):
        nn = len(vals); half = win // 2
        for _ in range(passes):
            vals = [sum(vals[(i+k) % nn] for k in range(-half, half+1)) / (2*half+1) for i in range(nn)]
        return vals
    xs = smooth([p[0] for p in rs], 3, 1)
    zs = smooth([p[1] for p in rs], 3, 1)
    rs = list(zip(xs, zs))

    segs = []
    for i, c in enumerate(CTRL):
        if not c[2]:
            continue
        s = round(seg_at[i] / len(dense) * m) % m * STEP
        segs.append({'name': c[2], 's': s})
    segs.sort(key=lambda x: x['s'])

    total = m * STEP
    data = {'name': '카트 서킷 (Kart Circuit)', 'step': STEP, 'total': total,
            'roadHalf': ROAD_HALF,
            'points': [[round(x, 2), Y, round(z, 2)] for x, z in rs],
            'segments': segs, 'origin': {'lat': 0, 'lon': 0}}
    json.dump(data, open(f'{ROOT}/data/kart.json', 'w'))
    os.makedirs(f'{ROOT}/js/tracks', exist_ok=True)
    with open(f'{ROOT}/js/tracks/kart.js', 'w') as f:
        f.write('export const TRACK = '); json.dump(data, f); f.write(';\n')
    print(f'{m} points, {total/1000:.2f} km, width {ROAD_HALF*2:.1f}m, {len(segs)} sections')


if __name__ == '__main__':
    main()
