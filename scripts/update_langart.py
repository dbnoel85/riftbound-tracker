"""Other-language card pictures and names from Riot's official card gallery (playriftbound.com).

The gallery is published per locale. Chinese (Simplified / Traditional) and Korean have their own card
pictures; the other locales currently reuse the English ones, so only those three are stored.

Output data/langart.json:
  { "updated": ..., "base": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/",
    "cards": { "OGN-095": { "zh": ["<file>", "<name>"], "zh-tw": [...], "ko": [...] }, ... } }
Keys are SET-number(+variant letter or *) from the card's public code, e.g. "SFD-227*", "OGN-066a".
"""
import json, os, re, sys, time
import requests

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "langart.json")
BASE = "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/"
LOCALES = {"en": "en-us", "zh": "zh-cn", "zh-tw": "zh-tw", "ko": "ko-kr"}


def gallery(loc):
    r = requests.get(f"https://playriftbound.com/{loc}/card-gallery/", headers={"User-Agent": "Mozilla/5.0 (riftbound-tracker)"}, timeout=90)
    r.raise_for_status()
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.S)
    if not m:
        return {}
    d = json.loads(m.group(1))
    out = {}
    for b in d["props"]["pageProps"]["page"].get("blades", []):
        cs = b.get("cards")
        if isinstance(cs, dict):
            for c in cs.get("items", []):
                out[c["id"]] = c
    return out


def key(c):
    code = (c.get("publicCode") or "").split("/")[0].upper()
    m = re.match(r"^([A-Z0-9]+)-0*(\d+)([A-Z*]?)", code)
    return f"{m.group(1)}-{int(m.group(2))}{m.group(3).lower()}" if m else None


def file_of(c):
    u = ((c.get("cardImage") or {}).get("url") or "")
    return u.split("game_data_live/")[-1].split("?")[0] if "game_data_live/" in u else None


def main():
    data = {l: gallery(loc) for l, loc in LOCALES.items()}
    en = data.pop("en")
    if len(en) < 500:
        print("English gallery looks incomplete:", len(en)); sys.exit(0)
    cards = {}
    for lang, cs in data.items():
        for cid, c in cs.items():
            e = en.get(cid); f = file_of(c); k = key(c)
            if not f or not k or not e:
                continue
            same_img = f == file_of(e)
            name = c.get("name") if c.get("name") != e.get("name") else ""
            if same_img and not name:
                continue
            cards.setdefault(k, {})[lang] = [None if same_img else f, name]
    out = {"updated": int(time.time()), "base": BASE, "cards": cards}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("langart:", len(cards), "cards;", {l: sum(1 for v in cards.values() if l in v and v[l][0]) for l in data})


if __name__ == "__main__":
    main()
