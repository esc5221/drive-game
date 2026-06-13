#!/usr/bin/env python3
"""Procedural practice track — a flat test facility for learning car control:
a long straight (accel/braking), a hairpin, a slalom, a big constant-radius
loop (skidpad feel), and a chicane. Closed Catmull-Rom through hand-placed
control points; emits js/tracks/practice.js in the same TRACK format."""
import json, math, os

ROOT = '/Users/lullu/mainpy/drive-game'
STEP = 5.0
Y = 80.0  # flat

# control points (x, z), counter-clockwise closed loop, with named features.
# (name marks the feature that STARTS near this control point)
CTRL = [
    (0, 0, '메인 직선'),        # long straight (accel / braking)
    (170, 0, None),
    (340, 0, None),
    (470, 2, '헤어핀'),         # tight 180 right-up
    (545, 25, None),
    (555, 80, None),
    (505, 120, None),
    (435, 120, '슬라럼'),       # weave top, heading left
    (375, 92, None),
    (315, 140, None),
    (250, 92, None),
    (185, 140, None),
    (120, 108, '스키드패드'),    # big constant-radius left loop
    (35, 140, None),
    (-55, 95, None),
    (-85, 5, None),
    (-45, -70, None),
    (45, -75, '시케인'),        # quick chicane back toward start
    (120, -38, None),
    (95, -8, None),
    (35, -18, None),
]


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return (
        0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0]) * t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0]) * t3),
        0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1]) * t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1]) * t3),
    )


def main():
    pts = [(c[0], c[1]) for c in CTRL]
    n = len(pts)
    # dense closed Catmull-Rom
    dense = []
    seg_arc = {}      # control index -> approx arc length where it falls
    for i in range(n):
        p0, p1, p2, p3 = pts[(i-1) % n], pts[i], pts[(i+1) % n], pts[(i+2) % n]
        if CTRL[i][2]:
            seg_arc[i] = len(dense)
        for k in range(24):
            dense.append(catmull(p0, p1, p2, p3, k / 24))

    # arc-length resample at STEP
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

    # segment names: map each named control to nearest resampled index -> arc s
    segs = []
    for i, c in enumerate(CTRL):
        if not c[2]:
            continue
        di = seg_arc[i]
        frac = di / len(dense)
        s = round(frac * m) % m * STEP
        segs.append({'name': c[2], 's': s})
    segs.sort(key=lambda x: x['s'])

    total = m * STEP
    data = {'name': '연습 트랙 (Test Track)', 'step': STEP, 'total': total,
            'points': [[round(x, 2), Y, round(z, 2)] for x, z in rs],
            'segments': segs, 'origin': {'lat': 0, 'lon': 0}}
    json.dump(data, open(f'{ROOT}/data/practice.json', 'w'))
    os.makedirs(f'{ROOT}/js/tracks', exist_ok=True)
    with open(f'{ROOT}/js/tracks/practice.js', 'w') as f:
        f.write('export const TRACK = '); json.dump(data, f); f.write(';\n')
    print(f'{m} points, {total/1000:.3f} km, {len(segs)} sections')
    for s in segs:
        print(f"  {s['s']/1000:6.3f} km  {s['name']}")


if __name__ == '__main__':
    main()
