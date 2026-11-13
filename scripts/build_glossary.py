"""Keyword glossary from the reminder text printed on cards: "[Tank] (I must be assigned combat damage first.)"."""
import json, re, collections
t = json.load(open("data/cardtext.json"))
seen = collections.defaultdict(collections.Counter)
for v in t.values():
    for m in re.finditer(r"\[([A-Z][A-Za-z' ]+?)(?: (\d+|X))?\]\.?\s*\(([^()]{8,240})\)", v):
        kw, n, rem = m.group(1).strip(), m.group(2), m.group(3).strip()
        if n:
            rem = rem.replace(n, "N", 1) if n.isdigit() else rem
            kw = kw + " N"
        seen[kw][rem] += 1
out = {}
for kw, c in seen.items():
    rem, cnt = c.most_common(1)[0]
    COL = {"fury", "calm", "mind", "body", "chaos", "order", "rainbow"}
    def rune(m):
        n, col = m.group(1), m.group(2).lower()
        if col not in COL:
            return m.group(0)
        what = "a rune of any color" if col == "rainbow" else f"a {col.capitalize()} rune"
        return f"{n} energy and {what}" if n else what
    rem = re.sub(r"(?:rune rainbow)+", "rune rainbow", rem)
    txt = re.sub(r"(?:(\d+) energy\s*)?rune (\w+)", rune, rem)
    out[kw] = {"text": txt, "cards": sum(c.values())}
json.dump(dict(sorted(out.items())), open("data/glossary.json", "w"), indent=0)
print(f"Glossary: {len(out)} keywords")
