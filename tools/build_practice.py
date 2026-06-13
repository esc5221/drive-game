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
# Generous spacing keeps Catmull-Rom radii gentle; only the hairpin is tight.
# (name marks the feature that STARTS near this control point)
# A driving-school circuit: a short straight then one of every corner type to
# practise. CCW; travel never reverses; the final corner sweeps back onto the
# straight tangentially (clean closure, no cramped flick).
CTRL = [
    (0, 0, '직선'),            # short straight — accel + braking
    (130, 0, None),
    (250, 6, None),
    (335, 45, '헤어핀'),        # tight 180 hairpin
    (335, 105, None),
    (260, 125, None),
    (185, 100, None),
    (120, 128, '에스'),         # quick left-right-left esses / chicane
    (55, 95, None),
    (-20, 140, None),
    (-110, 158, '고속 코너'),    # fast, wide-radius sweeper (one clean arc)
    (-200, 152, None),
    (-280, 110, None),
    (-320, 45, '감속 코너'),     # decreasing-radius: opens wide then tightens...
    (-330, -25, None),
    (-300, -70, None),
    (-255, -82, None),         # ...exit pinches tight (the classic trap)
    (-195, -80, '슬라럼'),       # continuous slalom (quick transitions)
    (-230, -140, None),
    (-165, -160, None),
    (-205, -215, None),
    (-130, -230, None),
    (-45, -220, '스키드패드'),    # big constant-radius loop (steady-state)
    (35, -250, None),
    (110, -225, None),
    (135, -150, None),
    (75, -120, '복합 코너'),     # long double-apex left, back toward start...
    (-10, -130, None),
    (-55, -75, None),
    (-40, -12, None),          # ...sweeping up-right, tangent into the straight
    (-12, -4, None),
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
    # smooth the centerline to round Catmull-Rom overshoot kinks (closed loop)
    def smooth(vals, win, passes):
        n = len(vals); half = win // 2
        for _ in range(passes):
            vals = [sum(vals[(i + k) % n] for k in range(-half, half + 1)) / (2 * half + 1) for i in range(n)]
        return vals
    xs = smooth([p[0] for p in rs], 3, 1)   # light — only kill overshoot hooks, keep slalom sharp
    zs = smooth([p[1] for p in rs], 3, 1)
    rs = list(zip(xs, zs))

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
    # gentle crest over the fast-sweeper/decreasing section (blind-crest practice)
    # — a raised-cosine hill so the flat track isn't monotonous.
    def elev(i):
        f = i / m
        c = 0.0
        for center, width, height in [(0.34, 0.16, 7.5), (0.58, 0.12, -4.0)]:
            d = abs(((f - center + 0.5) % 1.0) - 0.5) / width
            if d < 1: c += height * 0.5 * (1 + math.cos(math.pi * d))
        return Y + c
    data = {'name': '연습 트랙 (Test Track)', 'step': STEP, 'total': total,
            'points': [[round(x, 2), round(elev(i), 2), round(z, 2)] for i, (x, z) in enumerate(rs)],
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
