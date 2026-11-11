"""Scanner reference data: one small thumbnail per printing packed into data/scan/sprite.jpg,
plus groups of printings that share identical artwork ("twins"). Only new printings are downloaded.

data/scan/sprite.jpg   48x66 thumbnails, 40 per row, in the order of sprite.json "ids"
data/scan/sprite.json  {w,h,cols,ids,twins,v}
scan-src/master.png    lossless copy of the sprite (so adding cards never re-compresses old ones)
scan-src/refhash.json  per-printing 16x16 difference hash, used to find twins
LOCAL_IMG=<dir>        optional: read <dir>/<productId>.jpg instead of downloading
"""
import io, json, os, sys, time
import numpy as np, cv2, requests

TW, TH, COLS = 48, 66, 40
DATA, SRC = "data/scan", "scan-src"
os.makedirs(DATA, exist_ok=True); os.makedirs(SRC, exist_ok=True)
s = requests.Session(); s.headers["User-Agent"] = "riftbound-tracker (github.com/dbnoel85/riftbound-tracker)"
LOCAL = os.environ.get("LOCAL_IMG")


def load(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def fetch(pid, url):
    if LOCAL and os.path.exists(f"{LOCAL}/{pid}.jpg"):
        return cv2.imread(f"{LOCAL}/{pid}.jpg")
    urls = [url.replace("_200w.jpg", "_in_1000x1000.jpg"), url] if "tcgplayer" in url else [url]
    for u in urls:
        try:
            r = s.get(u, timeout=30)
            if r.status_code == 200 and len(r.content) > 2000:
                im = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
                if im is not None:
                    return im
        except Exception as e:  # noqa: BLE001
            print(f"  ! {pid}: {e}")
    return None


def crop_card(im):
    """tcgplayer's 1000x1000 images pad the card with white; trim to the card itself"""
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
    mask = g < 245
    ys, xs = np.nonzero(mask)
    if len(xs) < 100:
        return im
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    if (x1 - x0) * (y1 - y0) < 0.3 * im.shape[0] * im.shape[1]:
        return im
    return im[y0:y1, x0:x1]


def dhash(im):
    g = cv2.cvtColor(cv2.resize(im, (630, 880), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, (17, 16), interpolation=cv2.INTER_AREA).astype(np.int16)
    bits = (g[:, :-1] > g[:, 1:]).flatten()
    return "".join("%x" % int("".join("1" if b else "0" for b in bits[i:i + 4]), 2) for i in range(0, 256, 4))


# --- same maths as scanner.js, used to find printings the scanner cannot tell apart by artwork
def _box2(a):
    h, w = a.shape[:2]; return a[:h // 2 * 2, :w // 2 * 2].reshape(h // 2, 2, w // 2, 2, *a.shape[2:]).mean((1, 3))


def _blur121(a):
    p = np.pad(a, [(1, 1), (1, 1)] + [(0, 0)] * (a.ndim - 2), mode="edge")
    a = (p[:-2] + 2 * p[1:-1] + p[2:]) / 4
    return (a[:, :-2] + 2 * a[:, 1:-1] + a[:, 2:]) / 4


def _zn(v):
    v = v.astype(np.float32).ravel(); v = v - v.mean(); return v / (np.linalg.norm(v) + 1e-6)


def color_desc(t):
    c = _blur121(_box2(t.astype(np.float32)))
    B, G, R = c[..., 0], c[..., 1], c[..., 2]
    return np.concatenate([_zn((R + G + B) / 3), _zn(R - G) * 0.7, _zn((R + G) / 2 - B) * 0.7])


def gray(t):
    t = t.astype(np.float32); return _blur121(0.299 * t[..., 2] + 0.587 * t[..., 1] + 0.114 * t[..., 0])


def cell_score(f, r, GX=4, GY=6, R=3):
    fp = np.pad(f, R, mode="edge").astype(np.float32); cw, ch = TW // GX, TH // GY; tot = []
    for gy in range(GY):
        for gx in range(GX):
            tpl = r[gy * ch:(gy + 1) * ch, gx * cw:(gx + 1) * cw].astype(np.float32)
            if tpl.std() < 1e-3:
                tot.append(0.0); continue
            m = cv2.matchTemplate(fp[gy * ch:gy * ch + ch + 2 * R, gx * cw:gx * cw + cw + 2 * R], tpl, cv2.TM_CCOEFF_NORMED)
            tot.append(float(m.max()))
    tot = np.sort(tot); return float(tot[4:].mean())


def lookalikes(thumbs):
    """pairs of printings whose artwork (top half of the card) matches about as well as a photo matches its own card"""
    C = np.stack([color_desc(t) for t in thumbs]); G = [gray(t) for t in thumbs]
    A = [g[:TH // 2] for g in G]
    S = C @ C.T
    pairs = []
    for a in range(len(thumbs)):
        for b in np.nonzero(S[a, a + 1:] >= 0.93)[0] + a + 1:
            if min(art_score(A[a], A[b]), art_score(A[b], A[a])) >= 0.95:
                pairs.append((a, b))
    return pairs


def art_score(f, r, R=3):
    """like cell_score but on the artwork half only and keeping every cell"""
    h = r.shape[0]; fp = np.pad(f, R, mode="edge").astype(np.float32); cw, ch = TW // 4, h // 3; tot = []
    for gy in range(3):
        for gx in range(4):
            tpl = r[gy * ch:(gy + 1) * ch, gx * cw:(gx + 1) * cw].astype(np.float32)
            if tpl.std() < 1e-3:
                tot.append(0.0); continue
            m = cv2.matchTemplate(fp[gy * ch:gy * ch + ch + 2 * R, gx * cw:gx * cw + cw + 2 * R], tpl, cv2.TM_CCOEFF_NORMED)
            tot.append(float(m.max()))
    return float(np.mean(tot))

def main():
    cards = load("data/cards.json", {})
    fix = load("data/imgfix.json", {})
    want = {}
    for it in cards.get("items", []):
        if it.get("sealed") or not it.get("img"):
            continue
        want.setdefault(str(it["p"]), fix.get(str(it["p"])) or it["img"])
    meta = load(f"{DATA}/sprite.json", {"ids": []})
    hashes = load(f"{SRC}/refhash.json", {})
    ids = [str(i) for i in meta.get("ids", [])]
    master = cv2.imread(f"{SRC}/master.png") if ids and os.path.exists(f"{SRC}/master.png") else None
    if master is None:
        ids = []
    have = set(ids)
    todo = [p for p in want if p not in have]
    print(f"Scanner thumbnails: {len(ids)} cached, {len(todo)} new")
    if not todo and os.path.exists(f"{DATA}/sprite.jpg"):
        return
    thumbs = [master[(i // COLS) * TH:(i // COLS + 1) * TH, (i % COLS) * TW:(i % COLS + 1) * TW] for i in range(len(ids))]
    for n, pid in enumerate(todo):
        im = fetch(pid, want[pid])
        if im is None:
            continue
        im = crop_card(im)
        if im.shape[1] > im.shape[0]:  # battlefields are printed sideways
            im = cv2.rotate(im, cv2.ROTATE_90_CLOCKWISE)
        thumbs.append(cv2.resize(im, (TW, TH), interpolation=cv2.INTER_AREA))
        hashes[pid] = dhash(im)
        ids.append(pid)
        if not LOCAL:
            time.sleep(0.05)
        if n and n % 200 == 0:
            print(f"  ...{n}")
    rows = (len(ids) + COLS - 1) // COLS
    sheet = np.zeros((rows * TH, COLS * TW, 3), np.uint8)
    for i, t in enumerate(thumbs):
        sheet[(i // COLS) * TH:(i // COLS + 1) * TH, (i % COLS) * TW:(i % COLS + 1) * TW] = t
    cv2.imwrite(f"{SRC}/master.png", sheet, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    cv2.imwrite(f"{DATA}/sprite.jpg", sheet, [cv2.IMWRITE_JPEG_QUALITY, 86])
    # printings with (nearly) identical artwork
    H = np.array([[int(c, 16) for c in hashes[p]] for p in ids], np.uint8)
    bits = np.unpackbits(H[:, :, None], axis=2)[:, :, 4:].reshape(len(ids), -1)
    parent = list(range(len(ids)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for a in range(len(ids)):
        d = (bits[a + 1:] != bits[a]).sum(1)
        for b in np.nonzero(d <= 10)[0]:
            parent[find(a)] = find(a + 1 + b)
    like = {}
    for a, b in lookalikes(thumbs):  # kept as neighbours, not merged into groups (avoids chains)
        like.setdefault(ids[a], []).append(int(ids[b])); like.setdefault(ids[b], []).append(int(ids[a]))
    groups = {}
    for i in range(len(ids)):
        groups.setdefault(find(i), []).append(int(ids[i]))
    twins = [g for g in groups.values() if len(g) > 1]
    with open(f"{SRC}/refhash.json", "w") as f:
        json.dump(hashes, f, separators=(",", ":"))
    with open(f"{DATA}/sprite.json", "w") as f:
        json.dump({"w": TW, "h": TH, "cols": COLS, "v": f"{len(ids)}-{int(time.time())}", "ids": [int(i) for i in ids], "twins": twins, "like": like}, f, separators=(",", ":"))
    print(f"Scanner sprite: {len(ids)} printings, {len(twins)} shared-art groups, {len(like)} look-alikes")


if __name__ == "__main__":
    main()
