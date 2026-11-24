"""Self-test run before every publish: opens the app in a headless browser, walks every screen and the
main features, and fails (so nothing is published) if the page throws an error or a check doesn't hold.
Run locally:  python scripts/smoke_test.py   (needs: pip install playwright && python -m playwright install chromium)
"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PORT = 8099


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


CHECKS = [
    ("cards loaded", "S.cards && S.cards.items.length > 1000"),
    ("collection renders", "(show('collection'), renderCollection(), !!document.querySelector('#col-list'))"),
    ("card page opens", "(openDetail(S.cards.items.find(i => !i.sealed).k), !!document.querySelector('#sheet-content h2'))"),
    ("printings + languages", "!!document.querySelector('#langrow')"),
    ("close sheet", "(closeSheet(), true)"),
    ("import matches alt art", "matchImport(parseImport('Qty,Name,Set,Number\\n1,\"Darius, Trifarian\",Origins,027a')[0])?.num?.startsWith('027a')"),
    ("filters", "(S.prefs.cf = {v:['foil']}, renderCollection(), S.prefs.cf = {}, renderCollection(), true)"),
    ("movers", "(show('movers'), renderMovers(), true)"),
    ("today + milestones", "(show('collection'), renderToday(), milestones().length > 10)"),
    ("milestones sheet", "(pushSheet(renderMilestones), closeSheet(), true)"),
    ("trade sheet", "(pushSheet(renderTrade), closeSheet(), true)"),
    ("share sheet", "(pushSheet(renderShare), closeSheet(), true)"),
    ("card page holo + condition", "(openDetail(Object.keys(S.inv.items)[0]), !!document.querySelector('.holo') && !!document.querySelector('#cond'))"),
    ("close sheet 2", "(closeSheet(), true)"),
    ("score", "(show('score'), renderScore(), true)"),
]
ASYNC = [
    ("deck data", "async () => { await loadDecks(); return ranked().length > 5; }"),
    ("deck analysis", "async () => { const a = ranked()[0]; const an = analyzeDeck(a, { legal: true }); return an.lines.length > 5; }"),
    ("decks tab", "async () => { show('decks'); await renderDecks(); return true; }"),
    ("share link round trip", "async () => { const c = await packShare({ i: [[Object.keys(S.inv.items)[0], 2]] }); const d = await unpackShare(c); return d.i[0][1] === 2; }"),
    ("deck test draw", "async () => { const a = ranked()[0]; openDeckTest(a.list.main, a.list.leader || a.leader, a.name); const ok = DT.hand.length === 4 && !!document.querySelector('.dt-odds'); closeSheet(); return ok; }"),
    ("matchups", "async () => { D.tab = 'matrix'; await renderMatrix(); return !!document.querySelector('table.mx'); }"),
    ("events tab", "async () => { show('events'); await new Promise(r => setTimeout(r, 300)); return true; }"),
    ("tips data", "async () => { const t = (await loadTips()).items; return t.length >= 20 && t.every(x => x.id && x.title && x.body); }"),
    ("tip of the day", "async () => { await loadTips(); const a = tipOfDay(localDay()); return !!(a && a.title); }"),
    ("tips archive", "async () => { pushSheet(renderTipList); await new Promise(r => setTimeout(r, 300)); const ok = document.querySelectorAll('.tiplist li').length >= 20; closeSheet(); return ok; }"),
    ("all-sets binder", "async () => { show('collection'); S.prefs.colSet = 'all'; S.prefs.colModeAll = 'binder'; renderCollection(); const ok = document.querySelectorAll('details.bset').length > 2 && document.querySelectorAll('.bslot').length > 50; S.prefs.colModeAll = 'list'; renderCollection(); return ok; }"),
    ("rules & guide", "async () => { pushSheet(renderLearn); await new Promise(r => setTimeout(r, 500)); const ok = !!document.querySelector('#sheet-content h2'); closeSheet(); return ok; }"),
]


def main():
    srv = serve()
    errors, failed = [], []
    with sync_playwright() as pw:
        b = pw.chromium.launch(args=["--no-sandbox"], executable_path=os.environ.get("CHROME") or None)
        for vw, vh, label in [(390, 844, "phone"), (1024, 1366, "tablet")]:
            ctx = b.new_context(viewport={"width": vw, "height": vh}, service_workers="block")
            p = ctx.new_page()
            p.route("**/*", lambda r: r.continue_() if r.request.url.startswith(f"http://127.0.0.1:{PORT}") else r.abort())
            p.on("pageerror", lambda e, l=label: errors.append(f"[{l}] {e}"))
            p.add_init_script("localStorage.setItem('rbt.prefs.v1', JSON.stringify({tourDone:1}));"
                              "localStorage.setItem('rbt.inventory.v1', JSON.stringify({items:{}}));")
            p.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            p.wait_for_function("typeof S !== 'undefined' && S.cards && S.cards.items.length > 0", timeout=30000)
            # own a spread of cards so every screen has something to draw
            p.evaluate("(() => { const it = S.cards.items.filter(i => !i.sealed); for (let i = 0; i < it.length; i += 9) S.inv.items[it[i].k] = { qty: 1 + (i % 3), added: Date.now() }; saveInv(); })()")
            for name, js in CHECKS:
                try:
                    ok = p.evaluate(js)
                except Exception as e:
                    ok = False; errors.append(f"[{label}] {name}: {str(e)[:200]}")
                if not ok: failed.append(f"[{label}] {name}")
            for name, js in ASYNC:
                try:
                    ok = p.evaluate(js)
                except Exception as e:
                    ok = False; errors.append(f"[{label}] {name}: {str(e)[:200]}")
                if not ok: failed.append(f"[{label}] {name}")
            ctx.close()
        b.close()
    srv.shutdown()
    for e in errors: print("ERROR", e)
    for f in failed: print("FAILED", f)
    if errors or failed:
        print("Self-test failed — not publishing."); sys.exit(1)
    print(f"Self-test passed ({len(CHECKS) + len(ASYNC)} checks × 2 screen sizes).")


if __name__ == "__main__":
    main()
