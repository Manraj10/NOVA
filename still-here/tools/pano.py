# 360 experiment helper. Usage:
#   pano.py strip FRONT.png OUT.jpg          build the pass-2 input: right strip | gray | left strip
#   pano.py loop FRONT.png BACK.png OUT.png  composite front + back into one loop, align + feather, report seams
import sys
import numpy as np
from PIL import Image

S = 0.15  # strip fraction


def strip(front, out):
    f = np.asarray(Image.open(front).convert('RGB'))
    h, w, _ = f.shape
    s = int(w * S)
    o = np.full_like(f, 128)
    o[:, :s] = f[:, w - s:]
    o[:, w - s:] = f[:, :s]
    Image.fromarray(o).save(out, quality=92)


def best_shift(a, b, m, lo, hi):
    """a: image whose columns [x0 - d, x0 - d + m) should match b[:, :m]; returns d with lowest diff."""
    best = None
    for d in range(lo, hi, 4):
        x = a.shape[1] - d - m
        if x < 0: break
        e = np.abs(a[:, x:x + m] - b[:, :m]).mean()
        if best is None or e < best[1]: best = (d, e)
    return best


def loop(front, backf, out):
    f = np.asarray(Image.open(front).convert('RGB')).astype(np.float32)
    h, w, _ = f.shape
    b = np.asarray(Image.open(backf).convert('RGB').resize((w, h), Image.LANCZOS)).astype(np.float32)
    s = int(w * S)
    g = lambda im: im.mean(axis=2)[::4, ::2]
    # join 1: front's end vs back's start. Overlap = s columns minus a shift d1 (d1 > 0 = the model drew more overlap)
    # find where f's right strip sits in b's left part
    best1 = None
    for d in range(0, int(w * 0.3), 4):
        e = np.abs(g(b[:, d:d + s]) - g(f[:, w - s:])).mean()
        if best1 is None or e < best1[1]: best1 = (d, e)
    # join 2: where f's left strip sits in b's right part (search leftward)
    best2 = None
    for d in range(0, int(w * 0.45), 4):
        x = w - s - d
        e = np.abs(g(b[:, x:x + s]) - g(f[:, :s])).mean()
        if best2 is None or e < best2[1]: best2 = (d, e)
    d1, e1 = best1; d2, e2 = best2
    print('join1 shift', d1, 'diff', round(e1, 1), '| join2 shift', d2, 'diff', round(e2, 1))
    # b's own columns [d1, d1+s) == f[w-s, w); b's [w-s-d2, w-d2) == f[0, s)
    t = np.linspace(0, 1, s)[None, :, None]
    o1 = f[:, w - s:] * (1 - t) + b[:, d1:d1 + s] * t
    o2 = b[:, w - s - d2:w - d2] * (1 - t) + f[:, :s] * t
    full = np.concatenate([f[:, s:w - s], o1, b[:, d1 + s:w - s - d2], o2], axis=1)
    a = full
    wrap = np.abs(a[:, 0] - a[:, -1]).mean(); nb = np.abs(a[:, 1:] - a[:, :-1]).mean()
    cols = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(0, 2))
    print('loop', a.shape[1], 'x', h, 'wrap', round(wrap, 1), 'neighbor', round(nb, 1), 'worst column jump', round(cols.max(), 1), 'at', int(cols.argmax()))
    Image.fromarray(a.clip(0, 255).astype(np.uint8)).save(out)


if __name__ == '__main__' and sys.argv[1] in ('strip', 'loop'):
    {'strip': strip, 'loop': loop}[sys.argv[1]](*sys.argv[2:])


def strip2(front, out):
    """Like strip, but the gap is a soft blend of the two edges, so the painter sees no hard border."""
    f = np.asarray(Image.open(front).convert('RGB')).astype(np.float32)
    h, w, _ = f.shape
    s = int(w * S)
    o = np.zeros_like(f)
    o[:, :s] = f[:, w - s:]
    o[:, w - s:] = f[:, :s]
    L = o[:, s - 1:s].copy(); R = o[:, w - s:w - s + 1].copy()
    t = np.linspace(0, 1, w - 2 * s)[None, :, None]
    o[:, s:w - s] = L * (1 - t) + R * t
    im = Image.fromarray(o.clip(0, 255).astype(np.uint8))
    from PIL import ImageFilter
    bl = np.asarray(im.filter(ImageFilter.GaussianBlur(25))).astype(np.float32)
    o[:, s:w - s] = bl[:, s:w - s] * 0.6 + 128 * 0.4
    Image.fromarray(o.clip(0, 255).astype(np.uint8)).save(out, quality=92)


def edges(backf):
    b = np.asarray(Image.open(backf).convert('RGB')).astype(np.float32)
    h, w, _ = b.shape; s = int(w * S)
    c = np.abs(b[:, 1:] - b[:, :-1]).mean(axis=(0, 2))
    print(backf.split('/')[-1], 'edge at left strip', round(c[s - 3:s + 2].max(), 1), 'right strip', round(c[w - s - 3:w - s + 2].max(), 1), 'median', round(np.median(c), 1))


if __name__ == '__main__' and sys.argv[1] in ('strip2', 'edges'):
    {'strip2': strip2, 'edges': edges}[sys.argv[1]](*sys.argv[2:])
