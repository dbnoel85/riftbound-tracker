#!/usr/bin/env python3
"""
Riftbound price updater.

Runs once a day in GitHub Actions. Pulls the full Riftbound catalog (every set,
promo group, alt art, signature, overnumbered, foil/normal printing) and the
TCGplayer market prices from tcgcsv.com, then writes small JSON files the phone
app reads:

  data/cards.json    catalog + current price + 7-day $ / % change
  data/history.json  one price point per week per printing (for charts)
  data/daily.json    last ~15 daily snapshots (used for the 7-day change)
  data/hashes.json   image fingerprints used by the camera scanner
  data/meta.json     bookkeeping (last source timestamp, etc.)

New sets need no code changes: every run re-reads the list of Riftbound groups.
"""
import datetime as dt
import io
import json
import os
import sys
import tempfile
import time

import requests

BASE = os.environ.get("TCGCSV_BASE", "https://tcgcsv.com").rstrip("/")
DATA = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
FORCE = os.environ.get("FORCE", "") == "1"
BACKFILL_WEEKS = int(os.environ.get("BACKFILL_WEEKS", "8"))
SKIP_HASHES = os.environ.get("SKIP_HASHES", "") == "1"
UA = "RiftboundTracker/1.0 (personal collection app; github actions daily)"

session = requests.Session()
session.headers["User-Agent"] = UA


# ---------------------------------------------------------------- helpers
def get(url, kind="json", tries=4):
    for attempt in range(tries):
        try:
            r = session.get(url, timeout=60)
            time.sleep(0.15)  # tcgcsv asks for ~100ms between requests
            if r.status_code == 200:
                if kind == "json":
                    return r.json()
                if kind == "text":
                    return r.text
                return r.content
            if r.status_code == 404:
                return None
        except requests.RequestException as e:
            print(f"  ! {url}: {e}")
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}")


def load(name, default):
    path = os.path.join(DATA, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def save(name, obj, pretty=False):
    path = os.path.join(DATA, name)
    with open(path, "w") as f:
        if pretty:
            json.dump(obj, f, indent=1, sort_keys=True)
        else:
            json.dump(obj, f, separators=(",", ":"))


def rnd(x):
    return None if x is None else round(float(x), 2)


def price_of(row):
    """TCGplayer market price; if TCGplayer has none yet, the lowest listing (flagged as an estimate)."""
    for f in ("marketPrice", "lowPrice", "midPrice"):
        v = row.get(f)
        if v is not None:
            return rnd(v)
    return None


def key(pid, sub):
    return f"{pid}|{sub or 'Normal'}"


def find_category():
    cats = get(f"{BASE}/tcgplayer/categories")["results"]
    for c in cats:
        text = f"{c.get('name','')} {c.get('displayName','')} {c.get('seoCategoryName','')}".lower()
        if "riftbound" in text:
            return c["categoryId"], c.get("displayName") or c.get("name")
    raise RuntimeError("Riftbound category not found on tcgcsv")


# ---------------------------------------------------------------- backfill
def archive_prices(day, cat_id):
    """Prices for one past day from tcgcsv's immutable daily archive (downloaded once)."""
    import py7zr

    url = f"{BASE}/archive/tcgplayer/prices-{day}.ppmd.7z"
    blob = get(url, kind="bytes")
    if not blob:
        print(f"  archive {day}: not available")
        return None
    out = {}
    prefix = f"{day}/{cat_id}/"
    with tempfile.TemporaryDirectory() as tmp:
        with py7zr.SevenZipFile(io.BytesIO(blob), "r") as z:
            names = [n for n in z.getnames() if n.startswith(prefix) and n.endswith("/prices")]
            if not names:
                return out
            z.extract(path=tmp, targets=names)
        for n in names:
            with open(os.path.join(tmp, n)) as f:
                try:
                    rows = json.load(f).get("results", [])
                except json.JSONDecodeError:
                    continue
            for row in rows:
                p = price_of(row)
                if p is not None:
                    out[key(row["productId"], row.get("subTypeName"))] = p
    print(f"  archive {day}: {len(out)} prices")
    return out


# ---------------------------------------------------------------- image fingerprints
def dhash_hex(img_bytes, size=16):
    """Difference hash (size x size bits) of the whole card, matched on-phone by the scanner."""
    from PIL import Image

    im = Image.open(io.BytesIO(img_bytes)).convert("L").resize((size + 1, size), Image.BILINEAR)
    px = list(im.tobytes())
    bits = []
    for y in range(size):
        row = px[y * (size + 1):(y + 1) * (size + 1)]
        for x in range(size):
            bits.append(1 if row[x] > row[x + 1] else 0)
    val = 0
    for b in bits:
        val = (val << 1) | b
    return f"{val:0{size*size//4}x}"


def update_hashes(products):
    hashes = load("hashes.json", {})
    todo = [p for p in products if str(p["productId"]) not in hashes and p.get("imageUrl")]
    print(f"Image fingerprints: {len(hashes)} cached, {len(todo)} new")
    for i, p in enumerate(todo[:4000]):
        try:
            r = session.get(p["imageUrl"], timeout=30)
            if r.status_code == 200 and r.content:
                hashes[str(p["productId"])] = dhash_hex(r.content)
        except Exception as e:  # noqa: BLE001 - one bad image must not stop the run
            print(f"  ! image {p['productId']}: {e}")
        time.sleep(0.05)
        if i and i % 200 == 0:
            print(f"  ...{i}")
    save("hashes.json", hashes)


# ---------------------------------------------------------------- main
def main():
    os.makedirs(DATA, exist_ok=True)
    meta = load("meta.json", {})

    source_stamp = (get(f"{BASE}/last-updated.txt", kind="text") or "").strip()
    if source_stamp and source_stamp == meta.get("sourceStamp") and not FORCE:
        print(f"tcgcsv not updated since {source_stamp}; nothing to do.")
        return

    cat_id, cat_name = find_category()
    print(f"Category {cat_id}: {cat_name}")
    groups = get(f"{BASE}/tcgplayer/{cat_id}/groups")["results"]
    print(f"{len(groups)} groups (sets/promos)")

    products, prices = [], {}
    for g in groups:
        gid = g["groupId"]
        pr = get(f"{BASE}/tcgplayer/{cat_id}/{gid}/products") or {"results": []}
        pc = get(f"{BASE}/tcgplayer/{cat_id}/{gid}/prices") or {"results": []}
        products.extend(pr.get("results", []))
        for row in pc.get("results", []):
            prices.setdefault(row["productId"], []).append(row)
        print(f"  {g.get('abbreviation') or ''} {g['name']}: {len(pr.get('results', []))} products")

    # Today's snapshot (date in UTC)
    today = dt.datetime.now(dt.timezone.utc).date()
    today_s = today.isoformat()
    current = {}
    for pid, rows in prices.items():
        for row in rows:
            p = price_of(row)
            if p is not None:
                current[key(pid, row.get("subTypeName"))] = p

    daily = load("daily.json", {})
    history = load("history.json", {"dates": [], "series": {}})

    # First run: backfill a few weekly points from the archive so changes work on day one
    if not history["dates"] and BACKFILL_WEEKS > 0:
        print(f"Backfilling {BACKFILL_WEEKS} weeks of history from archive")
        for w in range(BACKFILL_WEEKS, 0, -1):
            d = (today - dt.timedelta(days=7 * w)).isoformat()
            snap = archive_prices(d, cat_id)
            if snap:
                append_history(history, d, snap)
                if w == 1:
                    daily[d] = snap

    daily[today_s] = current
    for d in sorted(daily)[:-15]:
        del daily[d]

    if not history["dates"] or (today - dt.date.fromisoformat(history["dates"][-1])).days >= 7:
        append_history(history, today_s, current)
    else:
        # keep the latest weekly point fresh within the week? no - weekly points stay fixed.
        pass

    # 7-day reference: most recent daily snapshot at least 7 days old, else oldest weekly point
    ref_day = None
    for d in sorted(daily, reverse=True):
        if (today - dt.date.fromisoformat(d)).days >= 7:
            ref_day = d
            break
    ref = daily.get(ref_day, {}) if ref_day else {}
    if not ref and len(history["dates"]) >= 2:
        ref_day = history["dates"][-2]
        idx = len(history["dates"]) - 2
        ref = {k: v[idx] for k, v in history["series"].items() if idx < len(v) and v[idx] is not None}

    group_info = {
        g["groupId"]: {
            "id": g["groupId"],
            "name": g["name"],
            "abbr": g.get("abbreviation") or "",
            "published": (g.get("publishedOn") or "")[:10],
        }
        for g in groups
    }

    items = []
    for p in products:
        ext = {e.get("name"): e.get("value") for e in (p.get("extendedData") or [])}
        rows = prices.get(p["productId"]) or [{}]
        for row in rows:
            sub = row.get("subTypeName") or "Normal"
            k = key(p["productId"], sub)
            m = current.get(k)
            w = ref.get(k)
            d_abs = rnd(m - w) if (m is not None and w is not None) else None
            d_pct = round((m - w) / w * 100, 1) if (m is not None and w) else None
            items.append({
                "k": k,
                "p": p["productId"],
                "s": sub,
                "n": p.get("name"),
                "g": p.get("groupId"),
                "num": ext.get("Number") or "",
                "r": ext.get("Rarity") or "",
                "t": ext.get("CardType") or ext.get("Card Type") or ext.get("Type") or "",
                "sealed": not ext.get("Number") and not ext.get("Rarity"),
                "img": p.get("imageUrl") or "",
                "u": p.get("url") or "",
                "m": m,
                "low": rnd(row.get("lowPrice")),
                "mid": rnd(row.get("midPrice")),
                "dl": rnd(row.get("directLowPrice")),
                "tm": rnd(row.get("marketPrice")),   # TCGplayer market price exactly as published (None if TCGplayer has none)
                "est": 1 if (row.get("marketPrice") is None and m is not None) else 0,
                "w": w,
                "d": d_abs,
                "pc": d_pct,
            })

    known = set(meta.get("knownGroups", []))
    new_groups = [gid for gid in group_info if gid not in known]
    if known and new_groups:
        meta.setdefault("newGroups", [])
        meta["newGroups"] = (
            [{"id": gid, "name": group_info[gid]["name"], "added": today_s} for gid in new_groups]
            + meta["newGroups"]
        )[:10]
    meta["knownGroups"] = sorted(group_info)
    meta["sourceStamp"] = source_stamp
    meta["updated"] = today_s
    meta["categoryId"] = cat_id

    cards = {
        "updated": today_s,
        "refDate": ref_day,
        "source": "TCGplayer market price via tcgcsv.com",
        "category": cat_name,
        "groups": sorted(group_info.values(), key=lambda g: g["published"] or "9999"),
        "newGroups": meta.get("newGroups", []),
        "items": items,
    }
    save("cards.json", cards)
    save("daily.json", daily)
    save("history.json", history)
    save("meta.json", meta, pretty=True)
    print(f"Wrote {len(items)} printings; reference date {ref_day}")

    if not SKIP_HASHES:
        update_hashes(products)


def append_history(history, day, snap):
    if day in history["dates"]:
        return
    history["dates"].append(day)
    n = len(history["dates"])
    for k, series in history["series"].items():
        series.append(snap.get(k))
    for k, v in snap.items():
        if k not in history["series"]:
            history["series"][k] = [None] * (n - 1) + [v]
    # keep ~3 years of weekly points
    if n > 160:
        history["dates"] = history["dates"][-160:]
        for k in history["series"]:
            history["series"][k] = history["series"][k][-160:]


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"ERROR: {e}", file=sys.stderr)
        raise
