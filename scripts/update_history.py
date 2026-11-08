#!/usr/bin/env python3
"""
Price history for the card chart (7 / 14 / 30 days / max).

Keeps one file per set: data/hist/<groupId>.json
  {"dates": ["2026-08-01", ...], "s": {"<productId>|<finish>": [price or null, ...]}}

Every run adds the newest daily snapshots (from data/daily.json). The first runs also
backfill from tcgcsv's daily archive: every day for the last 120 days, then one point per
week back to Riftbound's launch. Backfill is resumable and capped per run.
"""
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import update_prices as up  # noqa: E402

DATA = up.DATA
HIST = os.path.join(DATA, "hist")
DAILY_DAYS = 120
START = dt.date(2025, 8, 1)
MAX_ARCHIVES = int(os.environ.get("HIST_MAX_ARCHIVES", "200"))


def load_json(path, default):
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    return default


def main():
    os.makedirs(HIST, exist_ok=True)
    cards = load_json(os.path.join(DATA, "cards.json"), None)
    meta = load_json(os.path.join(DATA, "meta.json"), {})
    if not cards:
        print("No cards.json yet")
        return
    key_group = {it["k"]: it["g"] for it in cards["items"]}
    groups = sorted({g for g in key_group.values()})

    # load existing per-set history into {group: {key: {date: price}}}
    store = {}
    for g in groups:
        h = load_json(os.path.join(HIST, f"{g}.json"), {"dates": [], "s": {}})
        m = {}
        for k, vals in h["s"].items():
            m[k] = {d: v for d, v in zip(h["dates"], vals) if v is not None}
        store[g] = m
    known_dates = set()
    for g in store.values():
        for series in g.values():
            known_dates.update(series)

    def put(day, snap):
        for k, v in snap.items():
            g = key_group.get(k)
            if g is None or v is None:
                continue
            store[g].setdefault(k, {})[day] = v
        known_dates.add(day)

    # 1) newest daily snapshots
    daily = load_json(os.path.join(DATA, "daily.json"), {})
    for day, snap in daily.items():
        if day not in known_dates:
            put(day, snap)

    # 2) backfill from the archive (newest first so short ranges fill in first)
    prog = load_json(os.path.join(HIST, "_progress.json"), {"done": []})
    done = set(prog["done"]) | known_dates
    today = dt.datetime.now(dt.timezone.utc).date()
    want = [today - dt.timedelta(days=i) for i in range(1, DAILY_DAYS + 1)]
    d = today - dt.timedelta(days=DAILY_DAYS + 7)
    while d >= START:
        want.append(d)
        d -= dt.timedelta(days=7)
    todo = [x.isoformat() for x in want if x.isoformat() not in done]
    cat = meta.get("categoryId")
    fetched = 0
    for day in todo[:MAX_ARCHIVES]:
        try:
            snap = up.archive_prices(day, cat) if cat else None
        except Exception as e:  # noqa: BLE001 - one bad archive must not stop the run
            print(f"  ! archive {day}: {e}")
            snap = None
        prog["done"].append(day)
        if snap:
            put(day, snap)
        fetched += 1
    print(f"History: {fetched} archive days read, {max(0, len(todo) - fetched)} still to backfill")

    # write per-set files
    total = 0
    for g, m in store.items():
        dates = sorted({d for s in m.values() for d in s})
        out = {"dates": dates, "s": {k: [s.get(d) for d in dates] for k, s in m.items()}}
        with open(os.path.join(HIST, f"{g}.json"), "w") as f:
            json.dump(out, f, separators=(",", ":"))
        total += len(dates)
    prog["done"] = sorted(set(prog["done"]))
    with open(os.path.join(HIST, "_progress.json"), "w") as f:
        json.dump(prog, f)
    print(f"History files written for {len(store)} sets")


if __name__ == "__main__":
    main()
