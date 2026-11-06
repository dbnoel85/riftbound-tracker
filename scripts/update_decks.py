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


def main():
    os.makedirs(DATA, exist_ok=True)
    snap = get("getmetasnapshot?game=riftbound&window=auto")
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
    print(f"{len(rb)} cards")

    # ---- decklists (cached forever by slug)
    cache = load("deckcache.json", {})
    out = []
    fetched = 0
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
            "rank": a.get("rank"),
            "name": a.get("name"),
            "slug": a.get("slug"),
            "leader": a.get("leader"),
            "colors": a.get("colors") or [],
            "tier": a.get("tier"),
            "share": a.get("share"),
            "shareDelta": a.get("share_delta"),
            "winrate": a.get("winrate"),
            "winrateN": a.get("winrate_n"),
            "decks": a.get("decks"),
            "top8": a.get("top8_rate"),
            "momentum": a.get("momentum"),
            "key": [{"id": c.get("id"), "n": c.get("name"), "x": c.get("in_deck"), "w": c.get("weight")} for c in (a.get("cards") or [])],
            "best": best and {
                "event": best.get("event"), "place": best.get("place"), "players": best.get("players"),
                "record": best.get("record"), "date": best.get("date"), "slug": best.get("slug"),
            },
            "list": lst,
        })
    save("deckcache.json", cache)
    sample = snap.get("sample") or {}
    save("decks.json", {
        "updated": snap.get("generated_at"),
        "window": snap.get("window"),
        "set": snap.get("set_code"),
        "sample": {"decks": sample.get("decks"), "events": sample.get("events"), "matches": sample.get("matches")},
        "source": "riftbound.gg meta (tournament results)",
        "archetypes": out,
    })
    with_list = sum(1 for a in out if a["list"])
    print(f"{len(out)} archetypes, {with_list} with full lists ({fetched} new lists fetched)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
