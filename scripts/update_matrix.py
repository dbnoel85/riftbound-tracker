"""Legend-vs-legend win-rate matrix for the Decks > Matchups view.

Source: TopDeck.gg tournament rounds (https://topdeck.gg — free API key,
stored as the TOPDECK_KEY repository secret). Each Riftbound player carries a
`leader` (their legend), so every completed 1v1 table becomes one match
between two legends. Without a key the script does nothing and the app falls
back to the matchup pairs in data/decks.json.

Output: data/matrix.json
  {updated, source, windows: {"30d"|"14d"|"7d": {events, matches,
    legends: {name: {n, w}}, cells: {"A|B": [winsA, winsB, draws]}}}}
Cells are stored once per pair with A < B alphabetically.
"""
import json, os, sys, time, re
import requests

KEY = os.environ.get("TOPDECK_KEY", "").strip()
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "matrix.json")
API = "https://topdeck.gg/api/v2/tournaments"
WINDOWS = {"30d": 30, "14d": 14, "7d": 7}


def legend_name(p):
    v = p.get("leader")
    if isinstance(v, dict):
        v = v.get("name") or v.get("leader") or ""
    if isinstance(v, list):
        v = " / ".join(str(x) for x in v)
    v = re.sub(r"\s+", " ", str(v or "")).strip()
    return v


def fetch():
    body = {
        "game": "Riftbound",
        "last": 30,
        "columns": ["id", "name", "wins", "losses", "draws"],
        "rounds": True,
        "tables": ["players", "winner", "status"],
        "players": ["name", "id"],
    }
    for attempt in range(3):
        r = requests.post(API, json=body, headers={"Authorization": KEY}, timeout=120)
        if r.status_code == 429:
            time.sleep(65)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("TopDeck rate limit")


def build(events, days):
    cutoff = time.time() - days * 86400
    legends, cells, n_ev, n_m = {}, {}, 0, 0
    for t in events:
        if (t.get("startDate") or 0) < cutoff:
            continue
        lead = {}
        for s in t.get("standings") or []:
            if s.get("id") and legend_name(s):
                lead[s["id"]] = legend_name(s)
        used = False
        for rnd in t.get("rounds") or []:
            for tb in rnd.get("tables") or []:
                ps = tb.get("players") or []
                if len(ps) != 2 or tb.get("status") not in (None, "Completed"):
                    continue
                a, b = ps
                la = legend_name(a) or lead.get(a.get("id"), "")
                lb = legend_name(b) or lead.get(b.get("id"), "")
                if not la or not lb:
                    continue
                win = tb.get("winner")
                wid = tb.get("winner_id")
                if win in (None, ""):
                    continue
                if win == "Draw":
                    res = 0
                elif (wid and wid == a.get("id")) or win == a.get("name"):
                    res = 1
                elif (wid and wid == b.get("id")) or win == b.get("name"):
                    res = -1
                else:
                    continue
                used = True
                n_m += 1
                for nm, r in ((la, res), (lb, -res)):
                    e = legends.setdefault(nm, {"n": 0, "w": 0})
                    e["n"] += 1
                    e["w"] += 1 if r == 1 else 0
                if la == lb:
                    continue  # mirror matches count for play rate, not the matrix
                x, y, r = (la, lb, res) if la < lb else (lb, la, -res)
                c = cells.setdefault(f"{x}|{y}", [0, 0, 0])
                c[0 if r == 1 else 1 if r == -1 else 2] += 1
        n_ev += used
    return {"events": n_ev, "matches": n_m, "legends": legends, "cells": cells}


def main():
    if not KEY:
        print("No TOPDECK_KEY secret — skipping (app uses deck-data matchups).")
        return
    events = fetch()
    if not isinstance(events, list):
        print("Unexpected response", str(events)[:300])
        sys.exit(1)
    out = {"updated": int(time.time()), "source": "TopDeck.gg",
           "windows": {k: build(events, d) for k, d in WINDOWS.items()}}
    if out["windows"]["30d"]["matches"] < 50:
        print("Too few matches with legends:", out["windows"]["30d"]["matches"], "— keeping old file")
        return
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("matrix:", {k: (v["events"], v["matches"], len(v["legends"])) for k, v in out["windows"].items()})


if __name__ == "__main__":
    main()
