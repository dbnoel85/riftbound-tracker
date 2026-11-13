"""Official card errata from playriftbound.com -> data/errata.json  {card name: [{new, old, title, url, date}]}"""
import html, json, re, requests

s = requests.Session(); s.headers["User-Agent"] = "riftbound-tracker (github.com/dbnoel85/riftbound-tracker)"
BASE = "https://playriftbound.com"


def text(frag):
    frag = re.sub(r"<br\s*/?>", "\n", frag)
    frag = re.sub(r"</p>\s*<p[^>]*>", "\n", frag)
    t = html.unescape(re.sub(r"<[^>]+>", "", frag)).replace("\xa0", " ")
    return "\n".join(l.strip() for l in t.split("\n") if l.strip() and l.strip() != "▲")


def main():
    urls = set()
    for listing in ["/en-us/rules-hub/", "/en-us/news/rules-and-releases/", "/en-us/news/announcements/"]:
        try:
            h = s.get(BASE + listing, timeout=30).text
            urls |= {u for u in re.findall(r'"(/en-us/news/[a-z-]+/[a-z0-9-]*errata[a-z0-9-]*)/?"', h)}
        except Exception as e:  # noqa: BLE001
            print("  !", listing, e)
    out = {}
    for u in sorted(urls):
        try:
            h = s.get(BASE + u + "/", timeout=30).text
        except Exception as e:  # noqa: BLE001
            print("  !", u, e); continue
        tm = re.search(r"<title>(.*?)</title>", h)
        title = html.unescape(tm.group(1)).split("|")[0].strip() if tm else u
        date = (re.search(r'dateTime="(\d{4}-\d{2}-\d{2})', h) or [None, ""])[1]
        blocks = re.findall(r'id="rich-text-html">(.*?)</div></div></div>', h, re.S)
        body = max(blocks, key=len) if blocks else ""
        for m in re.finditer(r"<h2[^>]*>(.*?)</h2>(.*?)(?=<h2|<h1|$)", body, re.S):
            name = text(m.group(1)); chunk = m.group(2)
            parts = re.split(r"\[OLD TEXT\]", chunk, maxsplit=1)
            if len(parts) != 2 or "[NEW TEXT]" not in parts[0]:
                continue
            new = text(parts[0].split("[NEW TEXT]", 1)[1]); old = text(parts[1].split("<hr", 1)[0])
            if not name or not new:
                continue
            key = name.replace(", ", " - ")
            out.setdefault(key, []).append({"new": new, "old": old, "title": title, "url": BASE + u + "/", "date": date})
    for v in out.values():
        v.sort(key=lambda e: e["date"], reverse=True)
    json.dump(dict(sorted(out.items())), open("data/errata.json", "w"), indent=0, ensure_ascii=False)
    print(f"Errata: {len(out)} cards from {len(urls)} articles")


if __name__ == "__main__":
    main()
