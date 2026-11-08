#!/usr/bin/env python3
"""
Riftbound meta + decklist updater (runs daily in GitHub Actions after the price update).

Source: riftbound.gg (DotGG) meta snapshot, built from tournament results.
Writes:
  data/decks.json    archetypes: tier, share, win rate, best finish, full best decklist
  data/rbcards.json  compact card attributes (domain, cost, type, tags) used for substitutes
  data/deckcache.json  decklists already downloaded (tournament lists never change)
Light on the source: 2 bulk requests + only decklists we haven't seen before.
"""
import io
import json
import os
import sys
import time

import requests

API = os.environ.get("DOTGG_API", "https://api.dotgg.gg/cgfw")
DATA = os.environ.get("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data"))
UA = "RiftboundTracker/1.0 (personal collection app; once-daily)"

s = requests.Session()
s.headers["User-Agent"] = UA


def get(path, tries=3):
    for i in range(tries):
        try:
            r = s.get(f"{API}/{path}", timeout=60)
            time.sleep(0.5)
            if r.status_code == 200:
                return r.json()
            print(f"  ! {path}: HTTP {r.status_code}")
        except (requests.RequestException, ValueError) as e:
            print(f"  ! {path}: {e}")
        time.sleep(4 * (i + 1))
    return None


def load(name, default):
    p = os.path.join(DATA, name)
    if os.path.exists(p):
        with open(p) as f:
            return json.load(f)
    return default


def save(name, obj):
    with open(os.path.join(DATA, name), "w") as f:
        json.dump(obj, f, separators=(",", ":"))


MAIN_SETS = {"OGN", "OGS", "SFD", "UNL", "VEN", "RAD", "LGC", "SGN"}
SET_TOTALS = {"298": "OGN", "024": "OGS", "221": "SFD", "219": "UNL", "166": "VEN", "167": "RAD"}
IMG = "https://static.dotgg.gg/riftbound/cards/{}.webp"


def base_name(n):
    import re
    n = re.sub(r"\(.*?\)", "", (n or "").lower()).replace(" - ", ", ")
    return re.sub(r"[^a-z0-9]", "", n)


def fill_missing_images(rb):
    """Some printings (new signatures, runes, promos) have no TCGplayer photo yet.
    Use the card gallery image instead, and fingerprint it for the scanner."""
    import re
    sys.path.insert(0, os.path.dirname(__file__))
    from update_prices import dhash_hex
    cards = load("cards.json", None)
    if not cards:
        return
    hashes = load("hashes.json", {})
    fix = load("imgfix.json", {})
    groups = {g["id"]: g["abbr"] for g in cards["groups"]}
    seen, added = set(), 0
    for it in cards["items"]:
        pid = str(it["p"])
        if it.get("sealed") or pid in seen or (pid in hashes and pid not in fix):
            continue
        seen.add(pid)
        if pid in fix and pid in hashes:
            continue
        m = re.match(r"^([A-Z]{0,3})0*(\d{1,3})([a-zA-Z*]?)(?:/(\d{2,3}))?$", (it.get("num") or "").strip())
        if not m:
            continue
        pre, n, suf, tot = m.groups()
        st = groups.get(it["g"])
        if st not in MAIN_SETS:
            st = SET_TOTALS.get((tot or "").zfill(3))
        if not st:
            continue
        num = f"{pre}{int(n):02d}" if pre else f"{int(n):03d}"
        ids = [f"{st}-{num}-STAR"] if suf == "*" else ([f"{st}-{num}{suf}", f"{st}-{num}{suf.upper()}"] if suf else [f"{st}-{num}"])
        for cid in ids:
            c = rb.get(cid)
            if c and base_name(c["n"]) != base_name(it["n"]):
                continue  # number points at a different card: don't guess
            try:
                r = s.get(IMG.format(cid), timeout=30)
            except requests.RequestException:
                continue
            time.sleep(0.2)
            if r.status_code == 200 and r.content:
                try:
                    hashes[pid] = dhash_hex(r.content)
                except Exception:  # noqa: BLE001
                    continue
                fix[pid] = IMG.format(cid)
                added += 1
                break
    save("imgfix.json", fix)
    save("hashes.json", hashes)
    print(f"Pictures filled in for {added} printings without a TCGplayer photo ({len(fix)} total)")


import re as _re

MAJOR_WORDS = _re.compile(r"regional|showdown|national|qualifier|championship|\bopen\b|major|invitational|\bRQ\b|continental|worlds", _re.I)


def prize_of(name):
    """Prize pool written in the event name, e.g. '$25,000', '$25k', '25k'."""
    best = 0
    for m in _re.finditer(r"\$?\s?(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?)\s?(k|K)?\b", name or ""):
        num, k = m.group(1), m.group(2)
        if not (k or "$" in m.group(0) or "," in num):
            continue
        v = float(num.replace(",", ""))
        if k:
            v *= 1000
        best = max(best, v)
    return int(best)


def event_kind(name):
    n = (name or "").lower()
    for k, label in (("regional championship", "Regional Championship"), ("regional qualifier", "Regional Qualifier"), ("rq ", "Regional Qualifier"),
                     ("showdown", "Showdown Series"), ("national", "National"), ("continental", "Continental"), ("worlds", "Worlds"),
                     ("invitational", "Invitational Qualifier"), ("open", "Open"), ("major", "Major")):
        if k in n:
            return label
    return "Tournament"


def build_news(snaps):
    """Recent big-event results (5k+ prize or major events) from the meta snapshots, plus official news headlines."""
    ev = {}

    def slot(name, slug=None, date=None, players=None):
        key = (slug or _re.sub(r"[^a-z0-9]", "", (name or "").lower()))
        if not key:
            return None
        e = ev.setdefault(key, {"name": name, "slug": slug or "", "date": date, "players": players or 0, "results": {}})
        e["date"] = e["date"] or date
        e["players"] = max(e["players"] or 0, players or 0)
        if slug and not e["slug"]:
            e["slug"] = slug
        return e

    names_to_slug = {}
    for sn in snaps:
        for a in sn.get("archetypes") or []:
            for f in (a.get("form") or []) + (a.get("best_decks") or []):
                if f.get("event_slug") and f.get("event"):
                    names_to_slug[f["event"]] = f["event_slug"]
    for sn in snaps:
        for e0 in sn.get("events") or []:
            slot(e0.get("name"), names_to_slug.get(e0.get("name")), e0.get("date"), e0.get("players"))
        for a in sn.get("archetypes") or []:
            arche = {"archetype": a.get("name"), "arch": a.get("slug"), "leader": a.get("leader")}
            for f in a.get("best_decks") or []:
                e = slot(f.get("event"), f.get("event_slug"), f.get("date"), f.get("players"))
                if e and f.get("place"):
                    k = (f["place"], a.get("slug"))
                    r = e["results"].get(k, {})
                    r.update({**arche, "place": f["place"], "record": f.get("record") or r.get("record") or "", "deck": f.get("slug") or r.get("deck") or ""})
                    e["results"][k] = r
            for f in a.get("form") or []:
                e = slot(f.get("event"), f.get("event_slug"), f.get("date"), f.get("players"))
                if e and f.get("place"):
                    k = (f["place"], a.get("slug"))
                    e["results"].setdefault(k, {**arche, "place": f["place"], "record": "", "deck": ""})
        for b in sn.get("best_performers") or []:
            e = slot(b.get("event"), b.get("event_slug"), b.get("date"), b.get("players"))
            if e and b.get("place"):
                k = (b["place"], b.get("slug"))
                r = e["results"].get(k, {})
                r.update({"archetype": b.get("archetype"), "arch": b.get("slug"), "leader": b.get("leader"), "place": b["place"], "record": b.get("record") or r.get("record") or "", "deck": r.get("deck", "")})
                e["results"][k] = r

    now = time.time()
    out = []
    for e in ev.values():
        prize = prize_of(e["name"])
        big_field = (e["players"] or 0) >= 200
        if prize:  # a stated prize under $5k only counts if the field was big
            major = prize >= 5000 or big_field
        else:
            major = big_field or ((e["players"] or 0) >= 100 and bool(MAJOR_WORDS.search(e["name"] or "")))
        try:
            e["date"] = int(float(e["date"]))
        except (TypeError, ValueError):
            continue
        if e["date"] > 1e11:
            e["date"] //= 1000
        if not major or now - e["date"] > 60 * 86400:
            continue
        res = sorted(e["results"].values(), key=lambda r: (r["place"], r.get("archetype") or ""))
        seen, top = set(), []
        for r in res:
            if (r["place"], r.get("arch")) in seen:
                continue
            seen.add((r["place"], r.get("arch")))
            top.append(r)
        out.append({"name": e["name"], "slug": e["slug"], "date": e["date"], "players": e["players"], "prize": prize,
                    "kind": event_kind(e["name"]), "results": top[:12]})
    out.sort(key=lambda x: -x["date"])

    # official news headlines
    headlines = []
    try:
        r = s.get("https://playriftbound.com/en-us/news/", timeout=30)
        m = _re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, _re.S)
        if m:
            data = json.loads(m.group(1))
            seen_t = set()

            def walk(o, d=0):
                if d > 14 or len(headlines) >= 15:
                    return
                if isinstance(o, dict):
                    t = o.get("title")
                    if isinstance(t, str) and t not in seen_t and (o.get("media") or o.get("image")) and (o.get("action") or o.get("url")):
                        blob = json.dumps(o)
                        url = (o.get("action") or {}).get("payload", {}).get("url") if isinstance(o.get("action"), dict) else o.get("url")
                        img = _re.search(r'https:[^"]+?\.(?:jpg|png|webp)', json.dumps(o.get("media") or o.get("image")))
                        date = next((o[k] for k in o if _re.search(r"date|publish", k, _re.I) and isinstance(o[k], str)), "")
                        if url:
                            seen_t.add(t)
                            headlines.append({"title": t, "url": url if url.startswith("http") else "https://playriftbound.com" + url,
                                              "img": (img.group(0) + "?w=320") if img else "", "date": date[:10], "kind": o.get("category", {}).get("title") if isinstance(o.get("category"), dict) else ""})
                    for v in o.values():
                        walk(v, d + 1)
                elif isinstance(o, list):
                    for v in o:
                        walk(v, d + 1)
            walk(data)
    except Exception as e:  # noqa: BLE001
        print(f"  ! official news: {e}")
    save("news.json", {"updated": int(now), "events": out[:20], "headlines": headlines})
    print(f"News: {len(out)} major events, {len(headlines)} headlines")


def fetch_set_art():
    """Download each set's official key art once, cropped to one consistent 16:9 size."""
    from PIL import Image
    root = os.path.join(os.path.dirname(__file__), "..")
    art = load("setart.json", {})
    out_dir = os.path.join(root, "assets", "sets")
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    for abbr, path in art.items():
        if abbr.startswith("_"):
            continue
        dest = os.path.join(out_dir, f"{abbr}.jpg")
        if os.path.exists(dest):
            continue
        r = s.get(f"https://cmsassets.rgpub.io/sanity/images/dsfx7636/{path}?w=960", timeout=60)
        if r.status_code != 200:
            print(f"  ! set art {abbr}: HTTP {r.status_code}")
            continue
        im = Image.open(io.BytesIO(r.content)).convert("RGB")
        w, h = im.size
        tw, th = (w, int(w * 9 / 16)) if w * 9 / 16 <= h else (int(h * 16 / 9), h)
        im = im.crop(((w - tw) // 2, (h - th) // 2, (w - tw) // 2 + tw, (h - th) // 2 + th)).resize((480, 270), Image.LANCZOS)
        im.save(dest, "JPEG", quality=84, optimize=True, progressive=True)
        n += 1
    print(f"Set art: {n} downloaded")


def main():
    os.makedirs(DATA, exist_ok=True)
    snap = get("getmetasnapshot?game=riftbound&window=30d")
    if not snap or not snap.get("archetypes"):
        print("Meta snapshot unavailable; keeping previous deck data.")
        return 0
    cards = get("getcards?game=riftbound&mode=indexed&part=cards")
    if not cards or "data" not in cards:
        print("Card data unavailable; keeping previous deck data.")
        return 0

    # ---- compact card table
    names = cards["names"]
    ix = {n: i for i, n in enumerate(names)}

    def col(row, n):
        i = ix.get(n)
        return row[i] if i is not None and i < len(row) else None

    rb = {}
    for row in cards["data"]:
        cid = col(row, "id")
        if not cid:
            continue
        cost = col(row, "cost")
        rb[cid] = {
            "n": col(row, "name"),
            "d": col(row, "color") or [],
            "c": int(cost) if str(cost or "").isdigit() else None,
            "t": (col(row, "type") or [""])[0] if isinstance(col(row, "type"), list) else (col(row, "type") or ""),
            "st": col(row, "supertype") or "",
            "tg": col(row, "tags") or [],
            "m": col(row, "might"),
            "r": col(row, "rarity") or "",
            "b": col(row, "banned") in ("1", 1, True),
        }
    save("rbcards.json", rb)
    sets_raw = get("getsets?game=riftbound")
    if sets_raw:
        save("dotgg_sets.json", sets_raw)

    # card text for "search card text" (loaded by the app only when used)
    import html as _html
    import re as _re
    texts = {}
    for row in cards["data"]:
        cid = col(row, "id")
        eff = col(row, "effect") or ""
        if not cid or not eff:
            continue
        t = _html.unescape(eff)
        t = _re.sub(r"<br\s*/?>", " ", t)
        t = _re.sub(r"<[^>]+>", "", t)
        t = _re.sub(r":rb_energy_(\d+):", r"\1 energy", t)
        t = _re.sub(r":rb_([a-z_]+):", lambda m: m.group(1).replace("_", " "), t)
        texts[cid] = _re.sub(r"\s+", " ", t).strip()
    save("cardtext.json", texts)
    print(f"{len(rb)} cards")

    # ---- decklists (cached forever by slug), one block per time window
    cache = load("deckcache.json", {})
    fetched = 0

    def build(snap):
        nonlocal fetched
        out = []
        for a in snap["archetypes"]:
            cands = [b for b in (a.get("best_decks") or []) if b.get("slug")]
            cands.sort(key=lambda b: (b.get("place") or 999, -(b.get("players") or 0)))
            best = cands[0] if cands else None
            lst = None
            if best:
                slug = best["slug"]
                if slug not in cache:
                    d = get(f"getdeck?game=riftbound&slug={slug}")
                    fetched += 1
                    if d and isinstance(d.get("deck"), dict):
                        boards = d.get("boards")
                        if isinstance(boards, dict):
                            boards = [boards.get("0") or boards.get(0) or {}, boards.get("1") or boards.get(1) or {}]
                        side = d.get("sideboard") if isinstance(d.get("sideboard"), dict) else None
                        if side is None:
                            side = boards[1] if isinstance(boards, list) and len(boards) > 1 and isinstance(boards[1], dict) else {}
                        cache[slug] = {
                            "main": {k: int(v) for k, v in d["deck"].items()},
                            "side": {k: int(v) for k, v in side.items()},
                            "leader": d.get("leader"),
                        }
                lst = cache.get(slug)
            out.append({
                "rank": a.get("rank"), "name": a.get("name"), "slug": a.get("slug"), "leader": a.get("leader"),
                "colors": a.get("colors") or [], "tier": a.get("tier"),
                "share": a.get("share"), "shareDelta": a.get("share_delta"),
                "winrate": a.get("winrate"), "winrateN": a.get("winrate_n"), "decks": a.get("decks"),
                "top8": a.get("top8_rate"), "topq": a.get("topq_rate"), "cutRate": a.get("cut_rate"),
                "momentum": a.get("momentum"),
                "key": [{"id": c.get("id"), "n": c.get("name"), "x": c.get("in_deck"), "w": c.get("weight")} for c in (a.get("cards") or [])],
                "best": best and {
                    "event": best.get("event"), "place": best.get("place"), "players": best.get("players"),
                    "record": best.get("record"), "date": best.get("date"), "slug": best.get("slug"),
                },
                "list": lst,
            })
        sample = snap.get("sample") or {}
        return {
            "updated": snap.get("generated_at"), "window": snap.get("window"), "set": snap.get("set_code"),
            "sample": {"decks": sample.get("decks"), "events": sample.get("events"), "matches": sample.get("matches")},
            "field": {"top8": snap.get("field_top8_rate"), "topq": snap.get("field_topq_rate")},
            "archetypes": out,
        }

    prev = load("decks.json", {}).get("windows", {})
    windows = {"30d": build(snap)}
    raw_snaps = [snap]
    for w in ("14d", "7d"):
        sw = get(f"getmetasnapshot?game=riftbound&window={w}")
        if sw and sw.get("archetypes"):
            windows[w] = build(sw)
            raw_snaps.append(sw)
        elif w in prev:
            windows[w] = prev[w]
            print(f"  {w} snapshot unavailable; kept previous")
    save("deckcache.json", cache)
    main30 = windows["30d"]
    save("decks.json", {
        **main30,
        "source": "riftbound.gg meta (tournament results)",
        "windows": windows,
    })
    out = main30["archetypes"]
    try:
        build_news(raw_snaps)
    except Exception as e:  # noqa: BLE001
        print(f"  ! news: {e}")
    try:
        fetch_set_art()
    except Exception as e:  # noqa: BLE001
        print(f"  ! set art: {e}")
    try:
        fill_missing_images(rb)
    except Exception as e:  # noqa: BLE001 - pictures are a nice-to-have
        print(f"  ! image fill: {e}")
    with_list = sum(1 for a in out if a["list"])
    print(f"{len(out)} archetypes, {with_list} with full lists ({fetched} new lists fetched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
