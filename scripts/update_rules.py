"""Keep the official rule documents handy: scrapes the Riftbound Rules Hub for the current PDFs (Core Rules,
Tournament Rules, How to Play...) and the rules articles (patch notes, FAQs, errata), and keeps a local copy of
each PDF under assets/rules/ so the app can open it offline. Writes data/rules.json."""
import hashlib, html, json, os, re, requests

s = requests.Session(); s.headers["User-Agent"] = "riftbound-tracker (github.com/dbnoel85/riftbound-tracker)"
BASE = "https://playriftbound.com"
os.makedirs("assets/rules", exist_ok=True)


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t or ""))).strip()


def main():
    old = {}
    try:
        old = json.load(open("data/rules.json"))
    except Exception:  # noqa: BLE001
        pass
    docs, articles = [], []
    pages = [BASE + "/en-us/rules-hub/", BASE + "/en-us/news/rules-and-releases/"]
    seen = set()
    for page in pages:
        try:
            h = s.get(page, timeout=30).text
        except Exception as e:  # noqa: BLE001
            print("  !", page, e); continue
        for m in re.finditer(r'<a[^>]+href="([^"]+?\.pdf[^"]*)"[^>]*>(.*?)</a>', h, re.S | re.I):
            url, label = html.unescape(m.group(1)), clean(m.group(2))
            if url.startswith("/"):
                url = BASE + url
            if url in seen:
                continue
            seen.add(url)
            docs.append({"title": label or os.path.basename(url.split("?")[0]), "url": url})
        # article cards in __NEXT_DATA__: title + url + date + category
        nd = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', h, re.S)
        if nd:
            for t, u, d in re.findall(r'"title":"([^"]{4,140})","action":\{"type":"weblink","payload":\{"url":"(/en-us/news/[^"]+)"\}\},"analytics":\{[^}]*?"publishDate":"(\d{4}-\d{2}-\d{2})', nd.group(1)):
                if any(a["url"].endswith(u) for a in articles):
                    continue
                if re.search(r"rule|errata|faq|patch|ban|tournament", t, re.I):
                    articles.append({"title": html.unescape(t), "url": BASE + u, "date": d})
    # local copies of the PDFs (only re-downloaded when they change)
    for d in docs:
        try:
            r = s.get(d["url"], timeout=60)
            if r.status_code != 200 or not r.content.startswith(b"%PDF"):
                continue
            slug = re.sub(r"[^a-z0-9]+", "-", d["title"].lower()).strip("-")[:60] or hashlib.md5(d["url"].encode()).hexdigest()[:10]
            path = f"assets/rules/{slug}.pdf"
            digest = hashlib.sha1(r.content).hexdigest()
            prev = next((x for x in old.get("docs", []) if x.get("local") == path), None)
            if not os.path.exists(path) or not prev or prev.get("sha1") != digest:
                open(path, "wb").write(r.content)
                d["changed"] = True
            d.update({"local": path, "sha1": digest, "kb": len(r.content) // 1024})
        except Exception as e:  # noqa: BLE001
            print("  !", d["url"], e)
    articles.sort(key=lambda a: a["date"], reverse=True)
    out = {"docs": docs or old.get("docs", []), "articles": articles or old.get("articles", []), "hub": BASE + "/en-us/rules-hub/"}
    json.dump(out, open("data/rules.json", "w"), indent=1)
    print(f"Rules: {len(docs)} documents ({sum(1 for d in docs if d.get('changed'))} updated), {len(articles)} articles")


if __name__ == "__main__":
    main()
