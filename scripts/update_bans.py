"""Pick up new ban announcements from playriftbound.com and add them to data/bans.json.

Reads the official headlines saved by update_decks.py (data/news.json). For any headline about
bans that isn't in bans.json yet, it opens the article, takes the bulleted card names that match
real Riftbound cards, reads the "Effective:" date, and appends an announcement. Anything it can't
read confidently is saved with "review": true and no cards, so the app never marks a wrong card.
"""
import html, json, re, sys, time
import requests

s = requests.Session(); s.headers["User-Agent"] = "riftbound-tracker (github.com/dbnoel85/riftbound-tracker)"


def load(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return d


def norm(n):
    n = html.unescape(n or "").replace("’", "'").strip()
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n)
    n = re.sub(r"\s*-\s*starter$", "", n, flags=re.I)
    n = n.replace(", ", " - ")  # official text writes "Riven, Broken Blade"; card data uses "Riven - Broken Blade"
    return re.sub(r"\s+", " ", n).lower()


def main():
    bans = load("data/bans.json", {"announcements": []})
    news = load("data/news.json", {})
    rb = load("data/rbcards.json", {})
    names = {}
    for cid, c in rb.items():
        if re.match(r"^[A-Z]+-\d+$", cid):
            names.setdefault(norm(c.get("n")), (cid, re.sub(r"\s*\([^)]*\)\s*$", "", c.get("n", ""))))
    known = {a.get("url", "").rstrip("/") for a in bans["announcements"]}
    new = 0
    for h in news.get("headlines", []):
        title, url = h.get("title", ""), (h.get("url") or "").rstrip("/")
        if not re.search(r"\bban", title, re.I) or url in known:
            continue
        try:
            r = s.get(url + "/", timeout=30); r.raise_for_status(); page = r.text
        except Exception as e:  # noqa: BLE001
            print(f"  ! {url}: {e}"); continue
        text = re.sub(r"<[^>]+>", " ", page); text = html.unescape(re.sub(r"\s+", " ", text))
        eff = re.search(r"Effective\s*\**\s*:?\s*\**\s*([A-Z][a-z]+ \d{1,2},? \d{4})", text)
        effective = time.strftime("%Y-%m-%d", time.strptime(eff.group(1).replace(",", ""), "%B %d %Y")) if eff else None
        # bulleted items that are exactly a card name, in the part of the article before the explanations
        cut = page
        m = re.search(r"Timing and Effective Date|Why |Explanation|Future Bans", page)
        if m:
            cut = page[:m.start()]
        items = [html.unescape(re.sub(r"<[^>]+>", "", li)).strip() for li in re.findall(r"<li(?:\s[^>]*)?>(.*?)</li>", cut, re.S)]
        cards = []
        for it in items:
            k = norm(it)
            if k in names and names[k][0] not in [c["id"] for c in cards]:
                cards.append({"name": names[k][1], "id": names[k][0]})
            elif len(it) < 60:
                print(f"  (not a card name: {it!r})")
        # cross-check with "Eight cards and two battlefields ..." when the article says how many
        words = {w: i for i, w in enumerate("zero one two three four five six seven eight nine ten eleven twelve".split())}
        cnt = re.search(r"\b(\w+) cards?(?: and (\w+) battlefields?)?(?: are| is)? being added", text, re.I)
        expected = None
        if cnt:
            f = lambda w: int(w) if w and w.isdigit() else words.get((w or "").lower())
            if f(cnt.group(1)) is not None:
                expected = f(cnt.group(1)) + (f(cnt.group(2)) or 0)
        lead = text[:4000].lower()
        unban = bool(re.search(r"unban|removed from the ban|no longer banned|lifting", lead))
        formats = ["standard", "2v2"] if "2v2" in lead else ["standard"]
        a = {"title": title, "announced": (h.get("date") or time.strftime("%Y-%m-%d"))[:10], "effective": effective,
             "url": url + "/", "formats": formats, "cards": [] if unban else cards, "auto": True}
        if expected is not None and expected != len(cards):
            a["incomplete"] = True  # some names weren't recognised: the app points to Riot's article
            print(f"  ! expected {expected} cards, matched {len(cards)}")
        if unban or not cards or not effective:
            a["review"] = True  # shown as news, but no cards are marked until checked
        desc = re.search(r'<meta[^>]+name="description"[^>]+content="([^"]+)"', page)
        if desc:
            a["summary"] = html.unescape(desc.group(1))
        bans["announcements"].insert(0, a); known.add(url); new += 1
        print(f"Ban announcement: {title} — {len(cards)} cards, effective {effective}{' (needs review)' if a.get('review') else ''}")
    if new:
        bans["announcements"].sort(key=lambda a: a.get("announced") or "", reverse=True)
        bans["updated"] = time.strftime("%Y-%m-%d")
        with open("data/bans.json", "w") as f:
            json.dump(bans, f, indent=1)
    else:
        print("Bans: no new announcements")


if __name__ == "__main__":
    main()
