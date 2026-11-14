/* Riftbound Tracker — phone app (runs entirely in the browser; collection stays on this device). */
'use strict';

const SHELL_VERSION = 'v43';
const INV_KEY = 'rbt.inventory.v1';
const PREF_KEY = 'rbt.prefs.v1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

/* ---- card languages. English is the plain key ("pid|Foil"); other languages add "~zh" etc.
   S.byKey.get() hands back a language copy of the English printing, so the rest of the app just works. */
const LANGS = [['en', 'English', 'EN'], ['zh', 'Chinese (Simplified)', '中文'], ['zh-tw', 'Chinese (Traditional)', '繁中'], ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'], ['fr', 'French', 'FR'], ['de', 'German', 'DE'], ['es', 'Spanish', 'ES'], ['it', 'Italian', 'IT'], ['pt', 'Portuguese', 'PT']];
const langOf = (k) => { const i = String(k).indexOf('~'); return i < 0 ? 'en' : String(k).slice(i + 1); };
const baseKey = (k) => String(k).split('~')[0];
const withLang = (k, l) => (!l || l === 'en' ? baseKey(k) : baseKey(k) + '~' + l);
const langName = (l) => (LANGS.find((x) => x[0] === l) || [l, l])[1];
const langTag = (l) => (LANGS.find((x) => x[0] === l) || [l, l, String(l).toUpperCase()])[2];
class LangMap extends Map {
  get(k) {
    const v = super.get(k); if (v !== undefined || typeof k !== 'string' || !k.includes('~')) return v;
    const b = super.get(baseKey(k)); if (!b) return undefined;
    const it = { ...b, k, bk: b.k, lang: langOf(k) };
    const la = langArt(b, it.lang);
    if (la) { if (la[0]) { it.img = LA.base + la[0] + '?accountingTag=RB&auto=format&w=300'; it.limg = true; } if (la[1]) it.ln = la[1]; }
    if (S.prefs.langValue === 'none') { it.m = null; it.w = null; it.d = null; it.pc = null; }
    return it;
  }
}
/* official other-language pictures and names (data/langart.json, from Riot's card gallery) */
const LA = { base: '', cards: null };
function loadLangArt() { return fetch('data/langart.json').then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { LA.base = j.base; LA.cards = j.cards; } }).catch(() => {}); }
function cardCode(it) {
  const g = S.groups.get(it.g), ab = g && g.abbr ? g.abbr.toUpperCase() : '', m = String(it.num || '').match(/^0*(\d+)([a-z*]?)/i);
  return ab && m ? `${ab}-${+m[1]}${(m[2] || '').toLowerCase()}` : '';
}
function langArt(it, lang) { if (!LA.cards || !lang || lang === 'en') return null; const c = LA.cards[cardCode(it)]; return c && c[lang] || null; }
const LANG_ART = ['zh', 'zh-tw', 'ko'];   // languages with their own printed pictures in the official gallery
/** key to store when adding from the Scan or Search screens: the language picked there */
function addKey(k) { return String(k).includes('~') || !['scan', 'add'].includes(S.view) ? k : withLang(k, S.prefs.cardLang || 'en'); }

const S = {
  cards: null,          // data/cards.json
  byKey: new LangMap(), // "productId|Normal" -> item ("…~zh" -> Chinese copy)
  byPid: new Map(),     // productId -> [items]
  groups: new Map(),    // groupId -> group
  history: null,        // data/history.json (lazy)
  hashes: null,         // data/hashes.json (lazy, for scanner)
  inv: null,            // view of the collection being looked at (see colItems)
  prefs: Object.assign({ addSet: 'all', mvScope: 'mine', mvMetric: 'pct', mvMin: '1', sort: 'value', seenNew: [] }, loadJSON(PREF_KEY, {})),
  view: 'collection',
};

/* ---------------------------------------------------------------- utils */
function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } }
/* ---- collections. rbt.inventory.v1 = { items: main collection, name, cols: { id: { name, items, decks, created } } }
   S.inv.items always points at the collection being viewed, so the rest of the app doesn't need to know. */
let INV = loadJSON(INV_KEY, { items: {} });
function colList() { return [{ id: '', name: INV.name || 'My collection', decks: true }, ...Object.entries(INV.cols || {}).map(([id, c]) => ({ id, name: c.name, decks: c.decks !== false }))]; }
function colItems(id) { if (id && INV.cols && INV.cols[id]) return INV.cols[id].items || (INV.cols[id].items = {}); return INV.items || (INV.items = {}); }
const curCol = () => (S.prefs.colId && INV.cols && INV.cols[S.prefs.colId] ? S.prefs.colId : '');
const colName = (id = curCol()) => (colList().find((c) => c.id === id) || {}).name || 'My collection';
S.inv = { get items() { return colItems(curCol()); }, set items(v) { if (curCol()) INV.cols[curCol()].items = v; else INV.items = v; } };
function saveInv() { try { localStorage.setItem(INV_KEY, JSON.stringify(INV)); } catch { toast('Could not save on this device'); } }
/** cards that count for deck building and the wishlist: every collection marked "use for decks" */
function poolItems() {
  const out = {};
  for (const c of colList()) if (c.decks) for (const [k, e] of Object.entries(colItems(c.id))) { const o = out[k]; out[k] = o ? { ...o, qty: o.qty + (e.qty || 0) } : { ...e }; }
  return out;
}
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(S.prefs)); } catch {} }
const money = (v) => v == null ? '—' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function chg(d, pc) {
  if (d == null) return '<span class="flat">no change data</span>';
  const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : 'flat';
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const pcs = pc == null ? '' : ` (${sign}${Math.abs(pc).toFixed(1)}%)`;
  return `<span class="${cls}">${sign}${money(Math.abs(d))}${pcs}</span>`;
}
function img(u, cls = '') { return u ? `<img loading="lazy" decoding="async" class="${cls}" src="${esc(u)}" alt="">` : `<div class="thumb ${cls}"></div>`; }
function bigImg(u) { return u ? (u.includes('rgpub.io') ? u.replace(/([?&])w=\d+/, '$1w=744') : u.replace(/_\d+w\.jpg$/, '_in_1000x1000.jpg')) : ''; }
function setAbbr(g) { const gr = S.groups.get(g); return gr ? (gr.abbr || gr.name) : ''; }
function setName(g) { const gr = S.groups.get(g); return gr ? gr.name : ''; }
function toast(msg, ms = 2200) {
  const t = $('#toast'); t.innerHTML = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
function confirmBox(text) {
  return new Promise((res) => {
    $('#confirm-text').textContent = text; $('#confirm').classList.remove('hidden');
    const done = (v) => { $('#confirm').classList.add('hidden'); $('#confirm-yes').onclick = $('#confirm-no').onclick = null; res(v); };
    $('#confirm-yes').onclick = () => done(true); $('#confirm-no').onclick = () => done(false);
  });
}
function variantTags(it) {
  let t = it.lang && it.lang !== 'en' ? `<span class="tag lang" title="${esc(langName(it.lang))}">${esc(langTag(it.lang))}</span>` : '';
  if (it.s && it.s !== 'Normal') t += `<span class="tag foil">${esc(it.s)}</span>`;
  return t + banTag(it.n);
}

/* ---------------------------------------------------------------- ban list (data/bans.json, updated from Riot's announcements) */
const BAN = { data: null, byKey: new Map() };
const banKey = (n) => String(n || '').replace(/\u2019/g, "'").replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*-\s*starter$/i, '').replace(/, /g, ' - ').replace(/\s+/g, ' ').trim().toLowerCase();
async function loadBans() {
  try { BAN.data = await (await fetch('data/bans.json', { cache: 'no-cache' })).json(); } catch { BAN.data = { announcements: [] }; }
  BAN.byKey.clear();
  for (const a of BAN.data.announcements || []) {
    if (a.review) continue;
    for (const c of a.cards || []) {
      const k = banKey(c.name), e = BAN.byKey.get(k) || { name: c.name, fmt: {} };
      for (const f of a.formats || ['standard']) if (!e.fmt[f] || (a.effective || '') < e.fmt[f].effective) e.fmt[f] = { effective: a.effective || a.announced, url: a.url, title: a.title };
      BAN.byKey.set(k, e);
    }
  }
}
/** {state:'banned'|'soon', fmt, effective, url} for Standard (or 2v2-only), or null */
function banInfo(name) {
  const e = BAN.byKey.get(banKey(name)); if (!e) return null;
  const mine = S.prefs.format === '2v2' ? '2v2' : 'standard';
  // 2v2 uses the whole Standard list plus its own; Standard ignores 2v2-only bans except to mention them
  const f = e.fmt[mine] ? mine : e.fmt.standard ? 'standard' : mine === 'standard' && e.fmt['2v2'] ? '2v2' : null;
  if (!f) return null;
  const x = e.fmt[f];
  return { state: (x.effective || '') <= todayISO() ? 'banned' : 'soon', fmt: f, both: !!(e.fmt.standard && e.fmt['2v2']), effective: x.effective, url: x.url, title: x.title };
}
const shortDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
function banTag(name) {
  const b = banInfo(name); if (!b) return '';
  const where = b.fmt === '2v2' ? ' 2v2' : '';
  return b.state === 'banned' ? `<span class="tag ban">Banned${where}</span>` : `<span class="tag ban soon">Banned${where} ${esc(shortDate(b.effective))}</span>`;
}
function banBox(name) {
  const b = banInfo(name); if (!b) return '';
  const fmts = b.both ? 'Standard and 2v2 Constructed' : b.fmt === '2v2' ? '2v2 Constructed' : 'Standard Constructed';
  return `<div class="card-box banbox"><b>${b.state === 'banned' ? '⛔ Banned' : '⚠ Being banned'} in ${fmts}</b>
    <div class="sub">${b.state === 'banned' ? 'Since' : 'From'} ${esc(new Date(b.effective + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}${b.state === 'soon' ? ' — still legal until then' : ''}. <a href="${esc(b.url)}" target="_blank" rel="noopener">Riot's announcement ↗</a></div></div>`;
}
function metaLine(it) { return [setAbbr(it.g), it.num, it.r].filter(Boolean).map(esc).join(' · '); }

/* ---------------------------------------------------------------- data */
async function loadData(force) {
  const url = 'data/cards.json' + (force ? `?t=${Date.now()}` : '');
  const r = await fetch(url, { cache: force ? 'reload' : 'default' });
  if (!r.ok) throw new Error('No price data yet');
  const cards = await r.json();
  // pictures for printings TCGplayer has no photo of yet
  try { const fix = await (await fetch('data/imgfix.json', { cache: force ? 'reload' : 'default' })).json(); for (const it of cards.items) if (fix[it.p]) it.img = fix[it.p]; } catch { /* optional */ }
  await loadLangArt();
  S.cards = cards; S.byKey.clear(); S.byPid.clear(); S.groups.clear();
  for (const g of cards.groups) S.groups.set(g.id, g);
  for (const it of cards.items) {
    S.byKey.set(it.k, it);
    if (!S.byPid.has(it.p)) S.byPid.set(it.p, []);
    S.byPid.get(it.p).push(it);
  }
  for (const list of S.byPid.values()) list.sort((a, b) => (a.s === 'Normal' ? -1 : b.s === 'Normal' ? 1 : a.s.localeCompare(b.s)));
}
async function loadHistory() {
  if (!S.history) { try { S.history = await (await fetch('data/history.json')).json(); } catch { S.history = { dates: [], series: {} }; } }
  return S.history;
}
async function loadHashes() {
  if (!S.hashes) { try { S.hashes = await (await fetch('data/hashes.json')).json(); } catch { S.hashes = {}; } }
  return S.hashes;
}

/* ---------------------------------------------------------------- inventory */
function addCard(k, n = 1) {
  k = addKey(k);
  const it = S.byKey.get(k); if (!it) return;
  const e = S.inv.items[k] || { qty: 0, added: Date.now() };
  e.qty += n; e.added = Date.now();
  S.inv.items[k] = e; saveInv();
  toast(`Added <b>${esc(it.n)}</b>${it.s !== 'Normal' ? ' (' + esc(it.s) + ')' : ''} · ${e.qty} owned`);
  if (S.view === 'collection') renderCollection();
}
function setQty(k, q) {
  if (q <= 0) delete S.inv.items[k]; else S.inv.items[k].qty = q;
  saveInv();
}
function ownedRows() {
  const rows = [];
  for (const [k, e] of Object.entries(S.inv.items)) {
    const it = S.byKey.get(k) || { k, n: e.name || 'Unknown card', s: k.split('|')[1], m: null, d: null, pc: null, g: null, num: '', img: '' };
    rows.push({ it, e, value: (it.m || 0) * e.qty, dval: it.d == null ? null : it.d * e.qty });
  }
  return rows;
}

/* ---------------------------------------------------------------- views */
function show(view) {
  S.view = view;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#v-' + view).classList.remove('hidden');
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#title').textContent = { collection: 'Collection', scan: 'Scan cards', add: 'Add cards', movers: 'Top movers', decks: 'Meta decks', events: 'Events & News', score: 'Score', more: 'Settings' }[view];
  // Settings and Search-by-name aren't bottom tabs: give them a back arrow like the sheets have
  const sub = view === 'add' || view === 'more';
  if (!sub) S.tabView = view;
  $('#hdr-back').classList.toggle('hidden', !sub);
  $('#hdr-more').classList.toggle('hidden', view === 'more' || view === 'score');
  if (view === 'score') { renderScore(); keepAwake(true); } else keepAwake(false);
  if (view === 'decks') renderDecks();
  if (view === 'events') renderEvents();
  if (view === 'scan') { startCamera(); if (typeof renderColPickers === 'function') renderColPickers(); } else { stopCamera(); clearTimeout(SCAN.timer); }
  if (view === 'collection') renderCollection();
  if (view === 'add') renderAdd();
  if (view === 'movers') renderMovers();
  if (view === 'more') renderMore();
  window.scrollTo(0, 0);
}

/* ---- card attributes for sorting (domain, energy, type) */
const NEEDS_INFO = new Set(['color', 'cost', 'type']);
let CI = null;
function cardInfo(name) {
  if (!D.rb) return null;
  if (!CI) { CI = new Map(); for (const [id, c] of Object.entries(D.rb)) { const n = normName(c.n); if (n && (!CI.has(n) || /^[A-Z]+-\d+$/.test(id))) CI.set(n, c); } }
  return CI.get(normName(name)) || null;
}
const DOMAINS = ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'];
function domainRank(c) { const d = (c?.d || []).filter((x) => x !== 'Colorless'); if (!c) return 99; if (!d.length) return 50; if (d.length === 1) return DOMAINS.indexOf(d[0]); return 10 + DOMAINS.indexOf(d[0]); }
function domainLabel(c) { if (!c) return 'Unknown'; const d = (c.d || []).filter((x) => x !== 'Colorless'); return d.length ? d.join(' / ') : 'Colorless'; }
const RARITY = { Common: 1, Uncommon: 2, Rare: 3, Epic: 4, Showcase: 5, Promo: 6 };
const rarityRank = (r) => RARITY[r] || 0;
function typeLabel(c) { if (!c) return 'Other'; if (c.st === 'Champion') return 'Champion units'; return ({ Unit: 'Units', Spell: 'Spells', Gear: 'Gear', Legend: 'Legends', Rune: 'Runes', Battlefield: 'Battlefields', Token: 'Tokens' })[c.t] || c.t || 'Other'; }

/* ---- sets: picture, completion, filter */
function setImage(gid) {
  const sealed = [], cards = [];
  for (const items of S.byPid.values()) { const it = items[0]; if (it.g !== gid || !it.img) continue; (it.sealed ? sealed : cards).push(it); }
  const rank = (n) => /- Booster Pack$/.test(n) ? 0 : /Booster Pack/.test(n) ? 1 : /Box Set|Bundle|Box/.test(n) ? 2 : /Booster Display$/.test(n) ? 3 : 9;
  sealed.sort((a, b) => rank(a.n) - rank(b.n));
  if (sealed.length && rank(sealed[0].n) < 9) return { src: sealed[0].img, pack: true };
  const r = cards.find((c) => /Legend|Showcase|Epic/.test(c.r)) || cards[0];
  return r ? { src: r.img, pack: false } : null;
}
const shortSet = (n) => n.replace(/^Riftbound:?\s*/i, '').replace(/ Promotional Cards$/, ' Promos').replace(/^Organized Play/, 'Org. Play').replace(/ 2025 Worlds Champion Bundles$/, ' Worlds Champion');
function setStats() {
  const owned = new Set(); for (const [k, e] of Object.entries(S.inv.items)) if (e.qty > 0) owned.add(+k.split('|')[0]);
  const st = new Map();
  for (const [pid, items] of S.byPid) {
    const it = items[0]; if (it.sealed) continue;
    const x = st.get(it.g) || { total: 0, have: 0 }; x.total++; if (owned.has(pid)) x.have++; st.set(it.g, x);
  }
  return { st, owned };
}
function renderSetStrip() {
  const { st } = setStats();
  let all = { total: 0, have: 0 }; for (const x of st.values()) { all.total += x.total; all.have += x.have; }
  const cur = S.prefs.colSet || 'all';
  const tile = (key, name, x, abbr) => { const pc = x.total ? Math.floor(x.have / x.total * 100) : 0;
    const art = abbr ? `<img loading="lazy" decoding="async" src="assets/sets/${esc(abbr)}.jpg" alt="" onerror="this.remove()">` : '<span class="allicon">✦</span>';
    return `<button class="settile ${cur === key ? 'on' : ''} ${pc === 100 ? 'done' : ''}" data-colset="${key}" aria-label="${esc(name)}: ${x.have} of ${x.total}">
      <span class="setart">${art}<span class="setcode">${esc(abbr || 'ALL')}</span><span class="setname">${esc(name)}</span></span>
      <span class="setfoot"><span class="setnum"><b>${x.have}</b> / ${x.total}</span><span class="setpc">${pc === 100 ? '✓ ' : ''}${pc}%</span></span>
      <span class="bar"><i style="width:${pc}%"></i></span></button>`; };
  $('#col-sets').innerHTML = tile('all', 'All sets', all, null) +
    S.cards.groups.filter((g) => st.get(g.id)?.total).map((g) => tile(String(g.id), shortSet(g.name), st.get(g.id), g.abbr)).join('');
  const on = $('#col-sets .settile.on'); if (on && !renderSetStrip.scrolled) { on.scrollIntoView({ inline: 'center', block: 'nearest' }); renderSetStrip.scrolled = true; }
}
/** under a set's value: the whole collection, so the total is always on screen */
function sumAllLine(cur) {
  let el = $('#sum-all'); if (!el) { el = document.createElement('div'); el.id = 'sum-all'; el.className = 'sumall'; $('#sum-change').after(el); }
  const many = colList().length > 1;
  let html = '';
  if (cur !== 'all') { let v = 0, n = 0; for (const r of ownedRows()) { v += r.value; n += r.e.qty; }
    html += `<div>Whole ${many ? esc(colName()) : 'collection'} <b>${money(v)}</b> · ${n.toLocaleString()} cards <button class="linkbtn" id="sum-allbtn">Show all</button></div>`; }
  if (many) { let v = 0, n = 0; for (const c of colList()) for (const [k, e] of Object.entries(colItems(c.id))) { v += (e.qty || 0) * ((S.byKey.get(k) || {}).m || 0); n += e.qty || 0; }
    html += `<div>All ${colList().length} collections <b>${money(v)}</b> · ${n.toLocaleString()} cards</div>`; }
  el.innerHTML = html; el.classList.toggle('hidden', !html);
  const b = $('#sum-allbtn'); if (b) b.onclick = () => { S.prefs.colSet = 'all'; savePrefs(); renderCollection(); };
}
function renderCollection() {
  if (!S.cards) return;
  const wish = S.prefs.colView === 'wish';
  $$('#col-top button').forEach((b) => b.classList.toggle('on', (b.dataset.c === 'wish') === wish));
  $('#col-main').classList.toggle('hidden', wish); $('#wish-view').classList.toggle('hidden', !wish);
  wishAlert();
  if (wish) { renderWishlist(); return; }
  renderSetStrip();
  const cur = S.prefs.colSet || 'all';
  const inSet = (it) => cur === 'all' || String(it.g) === cur;
  $('#col-setmode').classList.toggle('hidden', cur === 'all');
  if (cur !== 'all') {
    const g = S.groups.get(+cur); const x = setStats().st.get(+cur) || { total: 0, have: 0 };
    $$('#col-setmode button').forEach((b) => b.classList.toggle('on', b.dataset.m === (S.prefs.colMode || 'owned')));
    $('#col-setmode [data-m=owned]').textContent = `Owned (${x.have})`;
    $('#col-setmode [data-m=missing]').textContent = `Missing (${x.total - x.have})`;
    $('#col-setmode [data-m=binder]').textContent = 'Binder';
    $('#sum-label').textContent = `${g ? g.name : 'Set'} value${colList().length > 1 ? ' · ' + colName() : ''}`;
  } else $('#sum-label').textContent = colList().length > 1 ? `${colName()} value` : 'Collection value';
  if (typeof renderColPickers === 'function') renderColPickers();
  if (cur !== 'all' && S.prefs.colMode === 'missing') { renderMissing(+cur); return; }
  if (cur !== 'all' && S.prefs.colMode === 'binder') { $('#col-list').innerHTML = '<li style="list-style:none">' + renderBinder(cur) + '</li>'; $$('#col-list .bslot').forEach((b) => b.onclick = () => openDetail(b.dataset.k)); return; }
  $('#col-list').classList.remove('missing');
  const langs = [...new Set(Object.keys(S.inv.items).map(langOf))];
  const lf = $('#col-lang'); const curL = langs.includes(S.prefs.colLang) ? S.prefs.colLang : 'all';
  if (lf) { lf.classList.toggle('hidden', langs.length < 2 && curL === 'all'); const o = `<option value="all">All languages</option>` + LANGS.filter(([l]) => langs.includes(l)).map(([l, n]) => `<option value="${l}" ${l === curL ? 'selected' : ''}>${esc(n)}</option>`).join(''); if (lf.innerHTML !== o) lf.innerHTML = o; lf.value = curL; }
  const rows = ownedRows().filter((r) => inSet(r.it) && (curL === 'all' || langOf(r.it.k) === curL));
  let total = 0, totalPrev = 0, count = 0;
  for (const r of rows) {
    total += r.value; count += r.e.qty;
    if (r.it.w != null) totalPrev += r.it.w * r.e.qty; else totalPrev += r.value;
  }
  $('#sum-value').textContent = money(total);
  $('#sum-count').textContent = count;
  sumAllLine(cur);
  const d = total - totalPrev;
  $('#sum-change').innerHTML = rows.length ? chg(d, totalPrev ? (d / totalPrev) * 100 : null) + ' <span class="flat">this week</span>' : '';

  const q = $('#col-filter').value.trim().toLowerCase();
  let list = rows.filter((r) => !q || `${r.it.n} ${r.it.num} ${setName(r.it.g)}`.toLowerCase().includes(q));
  const sort = $('#col-sort').value;
  const nz = (v, d) => (v == null ? d : v);
  if (NEEDS_INFO.has(sort) && !D.rb) { loadDecks().then(renderCollection, () => {}); }
  const info = (r) => cardInfo(r.it.n);
  const cmp = {
    priceHi: (a, b) => nz(b.it.m, -1) - nz(a.it.m, -1),
    priceLo: (a, b) => nz(a.it.m, 1e9) - nz(b.it.m, 1e9),
    color: (a, b) => (domainRank(info(a)) - domainRank(info(b))) || domainLabel(info(a)).localeCompare(domainLabel(info(b))) || b.value - a.value,
    cost: (a, b) => (nz(info(a)?.c, 99) - nz(info(b)?.c, 99)) || a.it.n.localeCompare(b.it.n),
    rarity: (a, b) => (rarityRank(b.it.r) - rarityRank(a.it.r)) || b.value - a.value,
    type: (a, b) => typeLabel(info(a)).localeCompare(typeLabel(info(b))) || a.it.n.localeCompare(b.it.n),
    qty: (a, b) => (b.e.qty - a.e.qty) || a.it.n.localeCompare(b.it.n),
    value: (a, b) => b.value - a.value,
    'gain$': (a, b) => nz(b.dval, -1e9) - nz(a.dval, -1e9),
    'gain%': (a, b) => nz(b.it.pc, -1e9) - nz(a.it.pc, -1e9),
    'loss%': (a, b) => nz(a.it.pc, 1e9) - nz(b.it.pc, 1e9),
    name: (a, b) => a.it.n.localeCompare(b.it.n),
    set: (a, b) => (a.it.g - b.it.g) || String(a.it.num).localeCompare(String(b.it.num), undefined, { numeric: true }),
    added: (a, b) => b.e.added - a.e.added,
  }[sort];
  list.sort(cmp);
  const groupOf = {
    color: (r) => domainLabel(info(r)), cost: (r) => info(r)?.c != null ? `${info(r).c} energy` : 'No energy cost',
    rarity: (r) => r.it.r || 'Other', type: (r) => typeLabel(info(r)), set: (r) => setName(r.it.g),
  }[sort];
  $('#col-empty').classList.toggle('hidden', rows.length > 0 || cur !== 'all');
  if (!rows.length && cur !== 'all') { $('#col-list').innerHTML = '<li class="empty">You don\'t have any cards from this set yet. Tap <b>Missing</b> to see them all.</li>'; return; }
  let lastG = null;
  $('#col-list').innerHTML = list.map((r) => {
    let head = '';
    if (groupOf) { const g = groupOf(r); if (g !== lastG) { lastG = g; const n = list.filter((x) => groupOf(x) === g); head = `<li class="dsec grp">${esc(g)} <span class="flat">· ${n.reduce((t, x) => t + x.e.qty, 0)} cards · ${money(n.reduce((t, x) => t + x.value, 0))}</span></li>`; } }
    return head + `
    <li class="item" data-k="${esc(r.it.k)}">
      ${img(r.it.img)}
      <div class="info">
        <div class="nm">${esc(r.it.n)}${variantTags(r.it)}</div>
        <div class="meta"><span class="qty">×${r.e.qty}</span>${metaLine(r.it)}</div>
        <div class="meta">${r.it.est ? '~' : ''}${money(r.it.m)} each${r.it.est ? ' <span class="flat">(no market price yet)</span>' : ''}</div>
      </div>
      <div class="px"><b>${money(r.value)}</b><small>${chg(r.dval, r.it.pc)}</small></div>
    </li>`; }).join('');

  // new-set banner
  const fresh = (S.cards.newGroups || []).filter((g) => !S.prefs.seenNew.includes(g.id));
  const nb = $('#newset');
  if (fresh.length) {
    nb.innerHTML = `🆕 New set added: <b>${fresh.map((g) => esc(g.name)).join(', ')}</b> — now searchable and scannable. <a href="#" id="newset-ok">OK</a>`;
    nb.classList.remove('hidden');
    $('#newset-ok').onclick = (e) => { e.preventDefault(); S.prefs.seenNew.push(...fresh.map((g) => g.id)); savePrefs(); nb.classList.add('hidden'); };
  } else nb.classList.add('hidden');
}

function renderMissing(gid) {
  const { owned } = setStats();
  const miss = [];
  const q = $('#col-filter').value.trim().toLowerCase();
  for (const [pid, items] of S.byPid) { const it = items[0]; if (it.g === gid && !it.sealed && !owned.has(pid) && (!q || `${it.n} ${it.num} ${it.r}`.toLowerCase().includes(q))) miss.push(items); }
  const lo = (items) => Math.min(...items.map((v) => v.m ?? Infinity));
  const srt = $('#col-sort').value;
  if (srt === 'priceHi' || srt === 'value') miss.sort((a, b) => lo(b) - lo(a)); else if (srt === 'priceLo') miss.sort((a, b) => lo(a) - lo(b));
  else if (srt === 'rarity') miss.sort((a, b) => rarityRank(b[0].r) - rarityRank(a[0].r) || lo(b) - lo(a));
  else miss.sort((a, b) => String(a[0].num).localeCompare(String(b[0].num), undefined, { numeric: true }) || a[0].n.localeCompare(b[0].n));
  let cost = 0; for (const items of miss) { const m = Math.min(...items.map((v) => v.m ?? Infinity)); if (isFinite(m)) cost += m; }
  const rows = ownedRows().filter((r) => r.it.g === gid);
  let total = 0; for (const r of rows) total += r.value;
  $('#sum-value').textContent = money(total); $('#sum-count').textContent = rows.reduce((t, r) => t + r.e.qty, 0); $('#sum-change').innerHTML = ''; sumAllLine(String(gid));
  $('#col-empty').classList.add('hidden');
  $('#col-list').classList.add('missing');
  $('#col-list').innerHTML = miss.length
    ? `<li class="sub" style="padding:2px 4px 8px">${miss.length} printings to go · about <b>${money(cost)}</b> to complete at the cheapest finish</li>` + miss.map((items) => productRow(items)).join('')
    : '<li class="empty">🎉 Set complete — you have every printing.</li>';
}
/* ----- manual add */
function productRow(items, extra = '') {
  const L = S.view === 'add' || S.view === 'scan' ? (S.prefs.cardLang || 'en') : 'en';
  if (L !== 'en') items = items.map((v) => S.byKey.get(withLang(v.k, L)) || v);
  const it = items[0];
  const btns = items.map((v) => `<button data-add="${esc(v.k)}">+ ${esc(v.s)}${L !== 'en' ? ' ' + esc(langTag(L)) : ''} <b>${money(v.m)}</b></button>`).join('')
    + (S.view === 'add' ? `<button class="langbtn" data-langs="${esc(it.k)}">🌐 Languages</button>` : '');
  if (it.ln) extra = `<div class="ln">${esc(it.ln)}</div>` + extra;
  return `<li class="item" data-k="${esc(it.k)}">
      ${img(it.img)}
      <div class="info">
        <div class="nm">${esc(it.n)}${banTag(it.n)}</div>
        <div class="meta">${metaLine(it)}</div>
        ${extra}
      </div>
      <div class="addbtns">${btns}</div>
    </li>`;
}
/* ---- card text search */
const TXT = { byName: null, loading: null };
function loadCardText() {
  if (TXT.byName) return Promise.resolve();
  if (!TXT.loading) TXT.loading = Promise.all([loadDecks(), fetch('data/cardtext.json').then((r) => r.json())]).then(([, t]) => {
    TXT.byName = new Map();
    for (const [id, c] of Object.entries(D.rb)) {
      const n = normName(c.n); if (!n || TXT.byName.has(n) && !t[id]) continue;
      const extra = [c.t, c.st, ...(c.tg || []), ...(c.d || [])].filter(Boolean).join(' ');
      TXT.byName.set(n, { text: t[id] || '', extra });
    }
  }).catch((e) => { TXT.loading = null; throw e; });
  return TXT.loading;
}
/** "word word" or "exact phrase" (in quotes) -> terms that must all appear */
function searchTerms(q) {
  const out = []; q.replace(/"([^"]+)"|(\S+)/g, (_, ph, w) => { out.push((ph || w).toLowerCase()); });
  return out;
}
function textOf(name) { const e = TXT.byName && TXT.byName.get(normName(name)); return e ? e : null; }
function snippet(text, terms) {
  const low = text.toLowerCase(); let i = -1, term = '';
  for (const t of terms) { const j = low.indexOf(t); if (j >= 0 && (i < 0 || j < i)) { i = j; term = t; } }
  if (i < 0) return '';
  const a = Math.max(0, i - 45), b = Math.min(text.length, i + term.length + 60);
  let out = esc(text.slice(a, b));
  for (const t of terms) out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  return `<div class="snip">${a ? '…' : ''}${out}${b < text.length ? '…' : ''}</div>`;
}
async function renderAdd() {
  if (!S.cards) return;
  const byText = $('#add-text').checked;
  if (byText && !TXT.byName) { $('#add-list').innerHTML = '<li class="empty">Loading card text…</li>'; try { await loadCardText(); } catch { toast('Card text isn\'t available yet'); $('#add-text').checked = false; } }
  const chips = [['all', 'All sets'], ...S.cards.groups.map((g) => [String(g.id), g.abbr || g.name])];
  $('#add-sets').innerHTML = chips.map(([v, l]) => `<button data-set="${v}" class="${S.prefs.addSet === v ? 'on' : ''}">${esc(l)}</button>`).join('');
  const q = $('#add-q').value.trim().toLowerCase();
  const sealed = $('#add-sealed').checked;
  // search everywhere: offer decks and keyword help for what was typed
  const ev = $('#add-everywhere');
  if (ev) {
    const kw = q.length >= 3 && typeof GL !== 'undefined' && GL ? Object.keys(GL).find((k) => k.toLowerCase().replace(/ n$/, '') === q) : null;
    ev.innerHTML = q.length >= 3 ? `<button data-go="decks">Decks with “${esc(q)}” ›</button>${kw ? `<button data-go="kw">What is ${esc(kw.replace(/ N$/, ''))}? ›</button>` : ''}` : '';
    ev.onclick = (e) => { const b = e.target.closest('[data-go]'); if (!b) return; if (b.dataset.go === 'decks') { show('decks'); D.q = $('#add-q').value.trim(); $('#dk-q').value = D.q; renderDecks(); } else { GLQ = kw.replace(/ N$/, ''); pushSheet(renderGlossary); } };
  }
  const toks = q.split(/\s+/).filter(Boolean);
  const terms = searchTerms(q);
  const res = []; ADD.snip = new Map();
  for (const [pid, items] of S.byPid) {
    const it = items[0];
    if (!sealed && it.sealed) continue;
    if (S.prefs.addSet !== 'all' && String(it.g) !== S.prefs.addSet) continue;
    const hay = `${it.n} ${it.num} ${setName(it.g)} ${setAbbr(it.g)} ${it.r}`.toLowerCase().replace(/[^\w/*\- ]/g, '');
    const hay2 = hay.replace(/-/g, ' ');
    if (byText && terms.length) {
      const tx = textOf(it.n);
      const full = `${it.n} ${it.num} ${setAbbr(it.g)} ${it.r} ${tx ? tx.text + ' ' + tx.extra : ''}`.toLowerCase();
      if (!terms.every((t) => full.includes(t))) continue;
      if (tx && tx.text) ADD.snip.set(it.p, snippet(tx.text, terms));
    } else if (toks.length && !toks.every((t) => hay.includes(t.replace(/[^\w/*\-]/g, '')) || hay2.includes(t))) continue;
    res.push(items);
  }
  if (!q && S.prefs.addSet === 'all') {
    $('#add-list').innerHTML = '<li class="empty">Type a card name or number, or pick a set.</li>';
    return;
  }
  res.sort((a, b) => (a[0].g - b[0].g) || String(a[0].num).localeCompare(String(b[0].num), undefined, { numeric: true }) || a[0].n.localeCompare(b[0].n));
  // show everything: render in pages of 60 as you scroll, so big sets stay smooth
  ADD.res = res; ADD.n = 0;
  $('#add-list').innerHTML = res.length ? `<li class="sub" id="add-count">${res.length} card${res.length === 1 ? '' : 's'}</li>` : '<li class="empty">No matches.</li>';
  addMore();
}
const ADD = { res: [], n: 0, obs: null, snip: null };
function addMore() {
  const list = $('#add-list');
  $('#add-sentinel')?.remove();
  const next = ADD.res.slice(ADD.n, ADD.n + 60);
  ADD.n += next.length;
  list.insertAdjacentHTML('beforeend', next.map((items) => productRow(items, (ADD.snip && ADD.snip.get(items[0].p)) || '')).join(''));
  if (ADD.n < ADD.res.length) {
    list.insertAdjacentHTML('beforeend', `<li id="add-sentinel" class="empty">Loading more… (${ADD.res.length - ADD.n} to go)</li>`);
    if (!ADD.obs && 'IntersectionObserver' in window) ADD.obs = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) addMore(); }, { rootMargin: '600px' });
    if (ADD.obs) ADD.obs.observe($('#add-sentinel')); else $('#add-sentinel').onclick = addMore;
  }
}

/* ----- movers */
function renderMovers() {
  if (!S.cards) return;
  const scope = S.prefs.mvScope, metric = S.prefs.mvMetric, min = parseFloat(S.prefs.mvMin);
  $$('#mv-scope button').forEach((b) => b.classList.toggle('on', b.dataset.v === scope));
  $$('#mv-metric button').forEach((b) => b.classList.toggle('on', b.dataset.v === metric));
  $('#mv-min').value = S.prefs.mvMin;
  $('#mv-period').textContent = S.cards.refDate ? `Change from ${fmtDate(S.cards.refDate)} to ${fmtDate(S.cards.updated)}` : 'Weekly change will appear after the first week of prices.';
  $('#mv-metric').classList.toggle('hidden', scope === 'sealed');
  const q = normName($('#mv-q').value || '');
  const hitQ = (it) => !q || normName(it.n + ' ' + setName(it.g)).includes(q);
  $('#mv-kind').classList.toggle('hidden', scope !== 'sealed'); $('#mv-ssort-wrap').classList.toggle('hidden', scope !== 'sealed');
  $('#mv-min-wrap').classList.toggle('hidden', scope === 'sealed');
  if (scope === 'sealed') {
    const kind = S.prefs.mvKind || 'all', ss = S.prefs.mvSort || 'price';
    $$('#mv-kind button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind)); $('#mv-ssort').value = ss;
    const rows = sealedRows().filter((it) => (kind === 'all' || sealedKind(it.n) === kind) && hitQ(it));
    const pc = (it) => it.pc == null ? (ss === 'down' ? Infinity : -Infinity) : it.pc;
    if (ss === 'up') rows.sort((a, b) => pc(b) - pc(a)); else if (ss === 'down') rows.sort((a, b) => pc(a) - pc(b)); else if (ss === 'name') rows.sort((a, b) => a.n.localeCompare(b.n));
    $('#mv-up').innerHTML = (typeof boxEvHTML === 'function' && kind === 'all' && !q ? boxEvHTML() : '') + rows.map((it) => `<li class="item" data-k="${esc(it.k)}">${img(it.img)}<div class="info"><div class="nm">${esc(it.n)}</div><div class="meta">${esc(setName(it.g))}</div></div><div class="px"><b>${money(it.m)}</b><small>${chg(it.d, it.pc)}</small></div></li>`).join('') || '<li class="empty">No sealed products yet.</li>';
    $('#mv-down').innerHTML = '';
    $$('#v-movers h2, #v-movers .mvh').forEach((h, i) => { h.dataset.orig = h.dataset.orig || h.textContent; h.textContent = i === 0 ? 'Sealed product prices' : ''; });
    return;
  }
  $$('#v-movers h2, #v-movers .mvh').forEach((h) => { if (h.dataset.orig) h.textContent = h.dataset.orig; });
  let pool;
  if (scope === 'mine') pool = ownedRows().map((r) => ({ it: r.it, qty: r.e.qty }));
  else pool = S.cards.items.filter((it) => !it.sealed).map((it) => ({ it, qty: 0 }));
  pool = pool.filter((x) => x.it.d != null && x.it.m != null && Math.max(x.it.m, x.it.w || 0) >= min && hitQ(x.it));
  const val = (x) => metric === 'pct' ? x.it.pc : (scope === 'mine' ? x.it.d * x.qty : x.it.d);
  const up = pool.filter((x) => val(x) > 0).sort((a, b) => val(b) - val(a)).slice(0, 15);
  const down = pool.filter((x) => val(x) < 0).sort((a, b) => val(a) - val(b)).slice(0, 15);
  const row = (x) => `<li class="item" data-k="${esc(x.it.k)}">${img(x.it.img)}
      <div class="info"><div class="nm">${esc(x.it.n)}${variantTags(x.it)}</div>
      <div class="meta">${x.qty ? `<span class="qty">×${x.qty}</span>` : ''}${metaLine(x.it)}</div>
      <div class="meta">${money(x.it.w)} → ${money(x.it.m)}</div></div>
      <div class="px"><b>${chg(scope === 'mine' && metric === 'usd' ? x.it.d * x.qty : x.it.d, x.it.pc)}</b>${scope === 'mine' && metric === 'usd' && x.qty > 1 ? '<small class="flat">all copies</small>' : ''}</div></li>`;
  const none = scope === 'mine' && !Object.keys(S.inv.items).length ? 'Add cards to see your movers.' : 'Nothing here this week.';
  $('#mv-up').innerHTML = up.map(row).join('') || `<li class="empty">${none}</li>`;
  $('#mv-down').innerHTML = down.map(row).join('') || `<li class="empty">${none}</li>`;
}
function sealedKind(n) {
  if (/\bcase\b/i.test(n)) return 'case';
  if (/pack/i.test(n)) return 'pack';
  if (/display|\bbox\b/i.test(n)) return 'box';
  return 'other';
}
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

/* ----- more / settings */
function renderMore() {
  renderBackupInfo(); renderSync(); renderPrefs();
  if (!S.cards) return;
  const cardsCount = new Set(S.cards.items.filter((i) => !i.sealed).map((i) => i.p)).size;
  $('#data-info').innerHTML = `Last updated <b>${fmtDate(S.cards.updated)}</b> · ${cardsCount.toLocaleString()} cards & variants across ${S.cards.groups.length} sets/promo groups.`;
  $('#set-list').innerHTML = S.cards.groups.map((g) => {
    const n = new Set(S.cards.items.filter((i) => i.g === g.id && !i.sealed).map((i) => i.p)).size;
    return `<li><span>${esc(g.name)} ${g.abbr ? `<span class="sub">${esc(g.abbr)}</span>` : ''}</span><span class="sub">${g.published ? fmtDate(g.published) + ' · ' : ''}${n} cards</span></li>`;
  }).join('');
}
function checkStale() {
  if (!S.cards) return;
  const [y, m, d] = S.cards.updated.split('-').map(Number);
  const days = Math.floor((Date.now() - Date.UTC(y, m - 1, d)) / 864e5);
  const el = $('#stale');
  if (days >= 3) { el.textContent = `Prices ${days} days old`; el.classList.remove('hidden'); } else el.classList.add('hidden');
}

/* ----- detail sheet */
function openDetail(k) { if (S.byKey.get(k)) pushSheet(() => renderDetail(k)); }
/** every language this printing comes in, with the real picture where Riot publishes one; tap to view or count it */
function langRowHTML(it) {
  const b = baseKey(it.k), all = poolAndView(), base = S.byKey.get(b);
  const owned = (l) => (all[withLang(b, l)] || {}).qty || 0;
  const show = LANGS.filter(([l]) => l === 'en' || LANG_ART.includes(l) || owned(l) || l === it.lang);
  const tile = ([l, n, t]) => { const v = l === 'en' ? base : S.byKey.get(withLang(b, l)); const own = langArt(base, l), q = owned(l);
    return `<button class="lt ${l === (it.lang || 'en') ? 'on' : ''}" data-open="${esc(withLang(b, l))}" title="${esc(n)}">
      <img loading="lazy" src="${esc(v.img)}" alt="">
      <span class="lt-t">${esc(t)}${q ? ` <b>×${q}</b>` : ''}</span>
      <small>${l === 'en' ? 'English' : own && own[0] ? esc(own[1] || n) : 'English art'}</small></button>`; };
  return `<div class="langrow" id="langrow"><div class="row" style="justify-content:space-between;align-items:baseline"><span class="label">Languages</span><span class="sub" style="font-size:12px">Tap one to view and count it</span></div>
    <div class="ltiles">${show.map(tile).join('')}</div>
    <select data-langadd="${esc(b)}" aria-label="Another language"><option value="">＋ Other language…</option>${LANGS.filter(([l]) => !show.some((h) => h[0] === l)).map(([l, n]) => `<option value="${esc(l)}">${esc(n)}</option>`).join('')}</select></div>`;
}
function poolAndView() { return { ...poolItems(), ...S.inv.items }; }
function renderDetail(k) {
  const it = S.byKey.get(k); if (!it) return;
  const owned = S.inv.items[k];
  const siblings = (S.byPid.get(it.p) || []).filter((v) => v.k !== baseKey(k));
  const html = `<div class="detail">
    <img class="detail-img" src="${esc(bigImg(it.img))}" onerror="this.onerror=null;this.src='${esc(it.img)}'" alt="">
    <h2>${esc(it.n)}${variantTags(it)}</h2>${it.ln ? `<div class="ln">${esc(it.ln)}</div>` : ''}
    <div class="sub">${esc(setName(it.g))}${it.num ? ' · ' + esc(it.num) : ''}${it.r ? ' · ' + esc(it.r) : ''}</div>
    ${banBox(it.n)}
    ${langRowHTML(it)}
    <div id="detail-text"></div>
    <div class="card-box mkt">
      <span class="label">${it.lang && it.lang !== 'en' ? `English TCGplayer price — used for ${esc(langName(it.lang))} copies` : 'TCGplayer market price'}${it.s !== 'Normal' ? ' · ' + esc(it.s) : ''}</span>
      <b class="big">${it.tm != null || !('tm' in it) ? money(it.m) : '—'}</b>
      <div class="chg">${chg(it.d, it.pc)} <span class="flat">vs. last week (${money(it.w)})</span></div>
      ${it.est ? `<p class="sub" style="margin:6px 0 0">TCGplayer hasn't set a market price for this one yet, so the app values it at <b>${money(it.m)}</b> (its lowest listing) until it does.</p>` : ''}
    </div>
    <div class="kv">
      <div><span class="label">Lowest listing</span><b>${money(it.low)}</b></div>
      <div><span class="label">Mid price</span><b>${money(it.mid)}</b></div>
      ${it.dl != null ? `<div><span class="label">TCGplayer Direct low</span><b>${money(it.dl)}</b></div>` : ''}
      <div><span class="label">Last sold</span>${it.u ? `<a class="sold" href="${esc(it.u)}" target="_blank" rel="noopener">See latest sales ↗</a>` : '<b>—</b>'}</div>
    </div>
    <p class="sub" style="margin-top:-4px">Market price is TCGplayer's own figure, based on recent completed sales. Prices refresh daily${S.cards ? ' · updated ' + fmtDate(S.cards.updated) : ''}.</p>
    <div class="row" style="justify-content:space-between;align-items:center;margin:14px 0 2px"><span class="label">Price history</span>
      <div class="rng" id="rng"><button data-r="7">7D</button><button data-r="14">14D</button><button data-r="30">30D</button><button data-r="max">Max</button></div></div>
    <div class="sub" id="rngsum" style="margin-bottom:4px"></div>
    <svg class="chart" id="chart" viewBox="0 0 320 150"></svg>
    <input type="range" id="chart-slider" class="slider" min="0" max="0" value="0" aria-label="Move along the price chart">
    <div class="readout" id="readout"></div>
    <div class="row" style="justify-content:space-between;align-items:center;margin-top:14px">
      <div class="stepper"><button data-q="-1">−</button><span id="qty">${owned ? owned.qty : 0}</span><button data-q="1">+</button></div>
      <div class="sub">${owned ? 'Value ' + money((it.m || 0) * owned.qty) : 'Not in collection'}</div>
    </div>
    <div class="row" style="align-items:center">
      <label class="sub" for="cost">Paid per card $</label>
      <input id="cost" type="number" inputmode="decimal" step="0.01" min="0" style="width:110px" value="${owned && owned.cost != null ? owned.cost : ''}" ${owned ? '' : 'disabled'}>
      <span id="pl" class="sub"></span>
    </div>
    <div class="card-box wishbox" id="wishbox"></div>
    ${siblings.length ? `<div class="row">${siblings.map((v) => `<button class="ghost" data-open="${esc(withLang(v.k, it.lang))}">${esc(v.s)} · ${money(v.m)}</button>`).join('')}</div>` : ''}
    ${it.u ? `<p><a href="${esc(it.u)}" target="_blank" rel="noopener">View on TCGplayer ↗</a></p>` : ''}
  </div>`;
  $('#sheet-content').innerHTML = html;
  const upd = () => {
    const e = S.inv.items[k];
    $('#qty').textContent = e ? e.qty : 0;
    $('#cost').disabled = !e;
    if (e && e.cost != null && it.m != null) {
      const pl = (it.m - e.cost) * e.qty;
      $('#pl').innerHTML = 'Profit ' + chg(pl, e.cost ? ((it.m - e.cost) / e.cost) * 100 : null);
    } else $('#pl').textContent = '';
  };
  upd();
  $$('#sheet [data-q]').forEach((b) => b.onclick = () => {
    const cur = S.inv.items[k]?.qty || 0;
    if (+b.dataset.q > 0) { S.inv.items[k] = S.inv.items[k] || { qty: 0, added: Date.now() }; }
    if (cur + +b.dataset.q <= 0 && cur > 0) { setQty(k, 0); } else if (cur + +b.dataset.q > 0) { S.inv.items[k].qty = cur + +b.dataset.q; saveInv(); }
    upd(); refreshCurrent();
  });
  $('#cost').oninput = (e) => { const en = S.inv.items[k]; if (!en) return; const v = parseFloat(e.target.value); en.cost = isNaN(v) ? null : v; saveInv(); upd(); };
  $$('#sheet [data-open]').forEach((b) => b.onclick = () => { SHEET[SHEET.length - 1] = () => renderDetail(b.dataset.open); renderDetail(b.dataset.open); });
  const la = $('#sheet [data-langadd]'); if (la) la.onchange = () => { if (!la.value) return; const nk = withLang(la.dataset.langadd, la.value); SHEET[SHEET.length - 1] = () => renderDetail(nk); renderDetail(nk); };
  renderWishBox(k);
  drawChart(it);
  if (typeof fillDetailText === 'function') fillDetailText(it);
}
/* ---- price chart: 7 / 14 / 30 days / max, with a slider to read exact points */
const HIST = {};
async function loadHist(g) {
  if (!HIST[g]) HIST[g] = fetch(`data/hist/${g}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return HIST[g];
}
const CH = { range: '30' };
async function drawChart(it) {
  const svg = $('#chart'); if (!svg) return;
  const [h, w] = await Promise.all([loadHist(it.g), loadHistory()]);
  let pts = [];
  const hk = it.bk || it.k;
  if (h && h.s[hk]) pts = h.s[hk].map((v, i) => ({ d: h.dates[i], v })).filter((p) => p.v != null);
  if (!pts.length && w.series[hk]) pts = w.series[hk].map((v, i) => ({ d: w.dates[i], v })).filter((p) => p.v != null); // weekly fallback
  if (it.m != null && (!pts.length || pts[pts.length - 1].d < S.cards.updated)) pts.push({ d: S.cards.updated, v: it.m });
  CH.all = pts; CH.it = it;
  $$('#rng button').forEach((b) => { b.classList.toggle('on', b.dataset.r === CH.range); b.onclick = () => { CH.range = b.dataset.r; drawChart(it); }; });
  const end = new Date(S.cards.updated + 'T00:00:00');
  const since = CH.range === 'max' ? null : new Date(end - (+CH.range) * 864e5);
  const P = since ? pts.filter((p) => new Date(p.d + 'T00:00:00') >= since) : pts;
  CH.P = P;
  const slider = $('#chart-slider');
  if (P.length < 2) {
    svg.innerHTML = '<text x="160" y="78" fill="#97a2c8" font-size="12" text-anchor="middle">Not enough price history for this range yet</text>';
    slider.classList.add('hidden'); $('#readout').textContent = ''; $('#rngsum').textContent = '';
    return;
  }
  slider.classList.remove('hidden');
  const W = 320, H = 150, L = 6, R = 6, T = 14, B = 22;
  const t0 = +new Date(P[0].d), t1 = +new Date(P[P.length - 1].d);
  const vs = P.map((p) => p.v); let lo = Math.min(...vs), hi = Math.max(...vs);
  if (hi === lo) { hi += 0.5; lo = Math.max(0, lo - 0.5); }
  const pad = (hi - lo) * 0.12; const y0 = lo - pad, y1 = hi + pad;
  const X = (d) => L + ((+new Date(d) - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  CH.X = X; CH.Y = Y; CH.W = W;
  const up = P[P.length - 1].v >= P[0].v; const col = up ? '#45e0d0' : '#ff6a57';
  const line = P.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const area = `${line}L${X(P[P.length - 1].d).toFixed(1)},${H - B}L${X(P[0].d).toFixed(1)},${H - B}Z`;
  CH.yr = P[0].d.slice(0, 4) !== P[P.length - 1].d.slice(0, 4);
  const fd = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', CH.yr ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
  const iHi = vs.indexOf(Math.max(...vs)), iLo = vs.indexOf(Math.min(...vs));
  svg.innerHTML = `<defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".35"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75].map((f) => `<line x1="${L}" x2="${W - R}" y1="${T + f * (H - T - B)}" y2="${T + f * (H - T - B)}" stroke="#2a3360" stroke-dasharray="2 4"/>`).join('')}
    <path d="${area}" fill="url(#cg)"/>
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${Math.min(W - R - 2, Math.max(L + 2, X(P[iHi].d)))}" y="${Y(P[iHi].v) - 5}" fill="#ece5d3" font-size="9.5" text-anchor="${X(P[iHi].d) > W - 40 ? 'end' : X(P[iHi].d) < 40 ? 'start' : 'middle'}">${money(P[iHi].v)}</text>
    <text x="${Math.min(W - R - 2, Math.max(L + 2, X(P[iLo].d)))}" y="${Math.min(H - B - 3, Y(P[iLo].v) + 12)}" fill="#97a2c8" font-size="9.5" text-anchor="${X(P[iLo].d) > W - 40 ? 'end' : X(P[iLo].d) < 40 ? 'start' : 'middle'}">${money(P[iLo].v)}</text>
    <text x="${L}" y="${H - 6}" fill="#97a2c8" font-size="9.5">${fd(P[0].d)}</text>
    <text x="${W - R}" y="${H - 6}" fill="#97a2c8" font-size="9.5" text-anchor="end">${fd(P[P.length - 1].d)}</text>
    <g id="xh"><line id="xh-l" y1="${T - 6}" y2="${H - B}" stroke="#f1d48e" stroke-width="1" stroke-dasharray="3 3"/><circle id="xh-c" r="4.5" fill="#0c1124" stroke="#f1d48e" stroke-width="2"/></g>`;
  const chg0 = P[P.length - 1].v - P[0].v;
  $('#rngsum').innerHTML = `${chg(chg0, P[0].v ? chg0 / P[0].v * 100 : null)} <span class="flat">· high ${money(Math.max(...vs))} · low ${money(Math.min(...vs))}</span>`;
  slider.max = P.length - 1; slider.value = P.length - 1;
  slider.oninput = () => chartPoint(+slider.value);
  const pick = (e) => { const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W; let best = 0, bd = 1e9; P.forEach((p, i) => { const dd = Math.abs(X(p.d) - x); if (dd < bd) { bd = dd; best = i; } }); slider.value = best; chartPoint(best); };
  svg.onpointerdown = (e) => { svg.setPointerCapture(e.pointerId); pick(e); };
  svg.onpointermove = (e) => { if (e.buttons || e.pointerType === 'touch') pick(e); };
  chartPoint(P.length - 1);
}
function chartPoint(i) {
  const P = CH.P; if (!P || !P[i]) return;
  const p = P[i], x = CH.X(p.d), y = CH.Y(p.v);
  const l = $('#xh-l'), c = $('#xh-c'); if (!l) return;
  l.setAttribute('x1', x); l.setAttribute('x2', x); c.setAttribute('cx', x); c.setAttribute('cy', y);
  const d0 = p.v - P[0].v;
  $('#readout').innerHTML = `<b>${new Date(p.d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b> · <b class="rv">${money(p.v)}</b> · ${i ? chg(d0, P[0].v ? d0 / P[0].v * 100 : null) + ' <span class="flat">since ' + new Date(P[0].d + 'T00:00:00').toLocaleDateString('en-US', CH.yr ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }) + '</span>' : '<span class="flat">start of range</span>'}`;
}
/* Full-screen pages (card, deck) stack up; Back / the phone's back gesture steps out one level. */
const SHEET = [];
function pushSheet(render) {
  SHEET.push(render);
  render();
  $('#sheet').classList.remove('hidden');
  $('#sheet .sheet-body').scrollTop = 0;
  try { history.pushState({ sheet: SHEET.length }, '', '#card'); } catch { /* still works via buttons */ }
}
function popSheetUI() {
  SHEET.pop();
  if (SHEET.length) { SHEET[SHEET.length - 1](); $('#sheet .sheet-body').scrollTop = 0; }
  else hideSheet();
}
function hideSheet() { SHEET.length = 0; $('#sheet').classList.add('hidden'); refreshCurrent(); }
function sheetBack() {
  if (!SHEET.length) return;
  if (history.state && history.state.sheet) history.back(); else popSheetUI();
}
function closeSheet() { // Done: leave every level
  if (!SHEET.length) return;
  const n = SHEET.length;
  if (history.state && history.state.sheet) { SHEET.length = 1; history.go(-n); } else hideSheet();
}
window.addEventListener('popstate', () => { if (SHEET.length) popSheetUI(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') sheetBack(); });
function refreshCurrent() { if (S.view === 'collection') renderCollection(); if (S.view === 'movers') renderMovers(); if (S.view === 'decks') renderDecks(); if (S.view === 'events') renderEvents(); }

/* ---------------------------------------------------------------- scanner */
let stream = null, ocrWorker = null, ocrLoading = null;
async function startCamera() {
  const msg = $('#cam-msg');
  if (stream) return;
  if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Live camera not available here — use Photo.'; return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
    const v = $('#video'); v.srcObject = stream; await v.play().catch(() => {});
    msg.textContent = 'Line the card up inside the frame';
    try { const tr = stream.getVideoTracks()[0]; const caps = tr.getCapabilities ? tr.getCapabilities() : {}; if ((caps.focusMode || []).includes('continuous')) await tr.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch {}
    await Promise.all([getOCR(), loadHashes(), window.CardScan ? CardScan.load().catch(() => { SCAN.legacy = true; }) : null]).catch(() => {});
    setAuto(SCAN.auto);
    camPaint();
  } catch (e) {
    msg.textContent = 'Camera blocked — allow camera access in settings, or use Photo.';
  }
}
function stopCamera() { if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; } }

function getOCR() {
  if (ocrWorker) return Promise.resolve(ocrWorker);
  if (ocrLoading) return ocrLoading;
  ocrLoading = new Promise((resolve, reject) => {
    const go = async () => {
      try {
        const w = await Tesseract.createWorker('eng', 1, {
          workerPath: new URL('vendor/tesseract/worker.min.js', location.href).href,
          corePath: new URL('vendor/tesseract/core', location.href).href,
          langPath: new URL('vendor/tesseract/lang', location.href).href,
          workerBlobURL: false,
        });
        ocrWorker = w; resolve(w);
      } catch (e) { ocrLoading = null; reject(e); }
    };
    if (window.Tesseract) return go();
    const s = document.createElement('script'); s.src = 'vendor/tesseract/tesseract.min.js'; s.onload = go; s.onerror = () => { ocrLoading = null; reject(new Error('OCR failed to load')); };
    document.head.appendChild(s);
  });
  return ocrLoading;
}

/* ---- manual camera rotation: some devices (iPhone Duo opened flat) hand the browser a picture turned 90° */
const camRot = () => (+S.prefs.camRot || 0) % 360;
let ROT = null;
function camSource() {
  const v = $('#video'); if (!v || !v.videoWidth) return null;
  const r = camRot(); if (!r) return { src: v, w: v.videoWidth, h: v.videoHeight };
  const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
  const vw = Math.round(v.videoWidth * k), vh = Math.round(v.videoHeight * k);
  const sw = r % 180 ? vh : vw, sh = r % 180 ? vw : vh;
  if (!ROT) ROT = document.createElement('canvas');
  if (ROT.width !== sw || ROT.height !== sh) { ROT.width = sw; ROT.height = sh; }
  const x = ROT.getContext('2d', { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0); x.translate(sw / 2, sh / 2); x.rotate(r * Math.PI / 180); x.drawImage(v, -vw / 2, -vh / 2, vw, vh);
  return { src: ROT, w: sw, h: sh };
}
function camPaint() {
  const c = $('#cam-rot'), r = camRot(); if (!c) return;
  c.classList.toggle('hidden', !r); $('#video').style.opacity = r ? '0' : '';
  if (!r || S.view !== 'scan' || !stream) { camPaint.on = false; return; }
  camPaint.on = true;
  const cs = camSource();
  if (cs) {
    const wr = $('.cam-wrap').getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(wr.width * dpr), H = Math.round(wr.height * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const sc = Math.max(W / cs.w, H / cs.h), dw = cs.w * sc, dh = cs.h * sc;
    c.getContext('2d').drawImage(cs.src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
  requestAnimationFrame(camPaint);
}
function rotateCam() {
  S.prefs.camRot = (camRot() + 90) % 360; savePrefs();
  if (!camPaint.on) camPaint();
  toast(S.prefs.camRot ? `Camera view turned ${S.prefs.camRot}° — tap ⟳ again until the card looks right` : 'Camera view back to normal');
}
/** Crop the card from the live video using the on-screen guide box. */
function grabFromVideo() {
  const cs = camSource(); if (!cs) return null;
  const wrap = $('.cam-wrap').getBoundingClientRect(), box = $('.guide-box').getBoundingClientRect();
  // object-fit: cover mapping from screen to video pixels
  const scale = Math.max(wrap.width / cs.w, wrap.height / cs.h);
  const offX = (cs.w * scale - wrap.width) / 2, offY = (cs.h * scale - wrap.height) / 2;
  const sx = (box.left - wrap.left + offX) / scale, sy = (box.top - wrap.top + offY) / scale;
  const sw = box.width / scale, sh = box.height / scale;
  const c = document.createElement('canvas'); c.width = 945; c.height = 1320;
  c.getContext('2d').drawImage(cs.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
/** The whole visible camera area at full resolution, plus where the on-screen guide sits in it. */
function grabFrame() {
  const cs = camSource(); if (!cs) return null;
  const wrap = $('.cam-wrap').getBoundingClientRect(), box = $('.guide-box').getBoundingClientRect();
  const scale = Math.max(wrap.width / cs.w, wrap.height / cs.h);
  const offX = (cs.w * scale - wrap.width) / 2, offY = (cs.h * scale - wrap.height) / 2;
  const sx = offX / scale, sy = offY / scale, sw = wrap.width / scale, sh = wrap.height / scale;
  const k = Math.min(1, 1600 / Math.max(sw, sh));
  const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k);
  c.getContext('2d', { willReadFrequently: true }).drawImage(cs.src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const f = c.width / wrap.width; // screen px -> frame px
  const gx = (box.left - wrap.left) * f, gy = (box.top - wrap.top) * f, gw = box.width * f, gh = box.height * f;
  c.guide = [[gx, gy], [gx + gw, gy], [gx + gw, gy + gh], [gx, gy + gh]];
  c.screenScale = 1 / f;
  return c;
}
/** card-shaped centre crop of a canvas (old reader's input) */
async function grabCentre(src) {
  const r = 63 / 88; let cw = src.width, ch = cw / r; if (ch > src.height) { ch = src.height; cw = ch * r; }
  cw *= 0.94; ch *= 0.94;
  const c = document.createElement('canvas'); c.width = 945; c.height = 1320;
  c.getContext('2d').drawImage(src, (src.width - cw) / 2, (src.height - ch) / 2, cw, ch, 0, 0, 945, 1320); return c;
}
/** From a still photo: assume the card fills most of the frame; crop to card shape around the centre. */
async function grabFromFile(file) {
  const bmp = await createImageBitmap(file);
  if (window.CardScan) { // new recognizer finds the card anywhere in the photo
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0, c.width, c.height);
    c.isPhoto = true; return c;
  }
  const r = 63 / 88; let w = bmp.width, h = bmp.height;
  let cw = w, ch = cw / r; if (ch > h) { ch = h; cw = ch * r; }
  cw *= 0.94; ch *= 0.94;
  const c = document.createElement('canvas'); c.width = 945; c.height = 1320;
  c.getContext('2d').drawImage(bmp, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, 945, 1320);
  return c;
}

/* Difference hash — must match scripts/update_prices.py dhash_hex() */
function dhash(canvas, size = 16) {
  let c = canvas;
  while (c.width > (size + 1) * 4) {
    const n = document.createElement('canvas'); n.width = Math.max(size + 1, Math.round(c.width / 2)); n.height = Math.max(size, Math.round(c.height / 2));
    const x = n.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); c = n;
  }
  const f = document.createElement('canvas'); f.width = size + 1; f.height = size;
  const fx = f.getContext('2d', { willReadFrequently: true }); fx.imageSmoothingQuality = 'high'; fx.drawImage(c, 0, 0, size + 1, size);
  const d = fx.getImageData(0, 0, size + 1, size).data;
  const g = []; for (let i = 0; i < d.length; i += 4) g.push((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000);
  let hex = '', nib = 0, nb = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    nib = (nib << 1) | (g[y * (size + 1) + x] > g[y * (size + 1) + x + 1] ? 1 : 0);
    if (++nb === 4) { hex += nib.toString(16); nib = 0; nb = 0; }
  }
  return hex;
}
const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
function hamming(a, b) { let d = 0; for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)]; return d; }

/* ---- card identification: read the collector number (bottom-left), then the name, then confirm with the artwork */
const CODE_BOX = [0.01, 0.928, 0.5, 0.072];   // x, y, w, h as fractions of the card
const NAME_BOX = [0.07, 0.52, 0.86, 0.15];
const SET_TOTALS = { 298: 'OGN', 24: 'OGS', 221: 'SFD', 219: 'UNL', 166: 'VEN', 167: 'RAD' };
const MAIN_SETS = new Set(['OGN', 'OGS', 'SFD', 'UNL', 'VEN', 'RAD', 'LGC']);
let NUMIDX = null;
function numIndex() {
  if (NUMIDX) return NUMIDX;
  NUMIDX = new Map();
  for (const [pid, items] of S.byPid) {
    const it = items[0]; if (it.sealed) continue;
    const m = String(it.num || '').match(/^(?:[A-Z]{1,3}\s*)?0*(\d{1,3})([a-z*]?)\/0*(\d{2,3})$/i);
    if (!m) continue;
    const key = `${+m[1]}/${+m[3]}`;
    if (!NUMIDX.has(key)) NUMIDX.set(key, []);
    NUMIDX.get(key).push({ pid, items, suf: (m[2] || '').toLowerCase() });
  }
  return NUMIDX;
}
function cropScaled(canvas, box, scale, invertLight) {
  const [bx, by, bw, bh] = box;
  const sw = canvas.width * bw, sh = canvas.height * bh;
  const c = document.createElement('canvas'); c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(canvas, canvas.width * bx, canvas.height * by, sw, sh, 0, 0, c.width, c.height);
  // grayscale + Otsu threshold -> dark text on white, which is what OCR reads best
  const im = x.getImageData(0, 0, c.width, c.height), d = im.data, hist = new Array(256).fill(0), g = new Uint8Array(d.length / 4);
  // 'whiteness' (darkest channel): card text is white/grey; gold trim and coloured art drop out
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const v = invertLight ? Math.min(d[i], d[i + 1], d[i + 2]) : (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; g[j] = v; hist[v]++; }
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sB = 0, wB = 0, best = 0, thr = 128; const tot = g.length;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }
  for (let j = 0, i = 0; j < g.length; j++, i += 4) { const on = invertLight ? g[j] > thr : g[j] < thr; const v = on ? 0 : 255; d[i] = d[i + 1] = d[i + 2] = v; }
  x.putImageData(im, 0, 0);
  return c;
}
async function ocr(canvas, mode) {
  const w = await getOCR();
  if (mode === 'code') await w.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZa*.-' });
  else await w.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: '' });
  const r = await w.recognize(canvas);
  return r.data.text || '';
}
function parseCode(text) {
  const t = text.toUpperCase().replace(/[|\]\[!I]/g, '1').replace(/[OQD](?=\d)/g, '0').replace(/(\d)[OQD]/g, (m, d) => d + '0').replace(/S(?=\d{2}\/)/g, '5');
  const out = []; const re = /0*(\d{1,3})\s*([A*]?)\s*[\/\\7]\s*0*(\d{2,3})/g; let m;
  while ((m = re.exec(t))) { const tot = +m[3]; out.push({ n: +m[1], suf: (m[2] || '').toLowerCase(), tot, known: !!SET_TOTALS[tot] }); }
  return out.sort((a, b) => b.known - a.known);
}
const baseName = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/* the number sits on one thin line at the bottom-left; try a few tight windows so trim lines don't confuse the reader */
const CODE_WINDOWS = [[0.04, 0.948, 0.46, 0.042], [0.04, 0.938, 0.46, 0.046], [0.04, 0.958, 0.46, 0.04], [0.04, 0.925, 0.46, 0.05]];
async function readCode(canvas) {
  const cs = Math.max(1.5, 1900 / canvas.width);
  for (const box of CODE_WINDOWS) {
    try {
      const codes = parseCode(await ocr(cropScaled(canvas, box, cs, true), 'code'));
      if (codes.some((c) => c.known)) return codes;
    } catch (e) { console.warn(e); return []; }
  }
  return [];
}
function rotated(canvas) { // battlefields are printed sideways
  const c = document.createElement('canvas'); c.width = canvas.height; c.height = canvas.width;
  const x = c.getContext('2d'); x.translate(c.width, 0); x.rotate(Math.PI / 2); x.drawImage(canvas, 0, 0); return c;
}
/* ---- new recognizer: outline -> flatten -> match artwork against every printing; the printed number settles look-alikes */
function codeMatches(items, codes) {
  const m = String(items[0].num || '').match(/^(?:[A-Z]{1,3}\s*)?0*(\d{1,3})([a-z*]?)\/0*(\d{2,3})$/i);
  if (!m) return 0;
  for (const c of codes) if (c.n === +m[1] && c.tot === +m[3]) return (c.suf || '') === (m[2] || '').toLowerCase() ? 2 : 1;
  return 0;
}
const REFTW = (pid) => { const g = CardScan.twinsOf ? CardScan.twinsOf(pid) : [String(pid)]; return g.slice().sort().join(','); };
async function identifyArt(canvas) {
  const r = await CardScan.recognise(canvas);
  const prod = (pid) => { const items = S.byPid.get(+pid) || S.byPid.get(String(pid)); return items && !items[0].sealed ? { pid: items[0].p, items } : null; };
  const out = { sure: false, best: null, cands: [], why: 'art', quad: null, score: r.score || 0, margin: r.margin || 0, group: null, codes: [] };
  if (!r.best) return out;
  out.quad = r.best.quad;
  const group = (r.best.twins || [String(r.best.pid)]).map(prod).filter(Boolean);
  out.group = group.map((g) => String(g.pid)).sort().join(',');
  const seen = new Set(group.map((g) => String(g.pid)));
  const rest = r.cands.map((c) => prod(c.pid)).filter((c) => c && !seen.has(String(c.pid)) && seen.add(String(c.pid)));
  // same artwork in several printings (promo reprints, signed/numbered versions): read the number
  let pick = group[0];
  if (group.length > 1) {
    let codes = [];
    try { codes = await readCode(CardScan.flatten(canvas, r.best.quad)); } catch (e) { console.warn(e); }
    out.codes = codes;
    const byCode = group.map((g) => ({ g, m: codeMatches(g.items, codes) })).sort((a, b) => b.m - a.m);
    if (byCode[0].m) { pick = byCode[0].g; out.why = 'number'; }
    else {
      const main = group.find((g) => { const grp = S.groups.get(g.items[0].g); return grp && MAIN_SETS.has(grp.abbr); });
      if (main) pick = main;
    }
  }
  out.best = pick;
  out.cands = [pick, ...group.filter((g) => g !== pick), ...rest].map((c) => ({ ...c, art: true }));
  // confident when the artwork clearly beats every different-looking card (or agrees across two frames)
  // (tuned on test footage: true matches score ~0.9-1.0, look-alike backgrounds and misreads stay under ~0.82)
  const prev = SCAN.prevGroup; SCAN.prevGroup = out.score >= 0.85 && out.margin >= 0.03 ? out.group : null;
  out.sure = out.score >= 0.85 && (out.margin >= 0.05 || (out.margin >= 0.03 && prev === out.group));
  // look-alikes (e.g. a signed or alternate version of the same art): the printed number decides
  if (!out.sure && out.score >= 0.85 && out.margin < 0.05 && !(SCAN.ocrFor === out.group && Date.now() - SCAN.ocrAt < 1500)) {
    SCAN.ocrFor = out.group; SCAN.ocrAt = Date.now();
    let codes = out.codes;
    if (!codes.length) { try { codes = await readCode(CardScan.flatten(canvas, r.best.quad)); } catch (e) { console.warn(e); } }
    const close = r.cands.filter((c) => c.score >= r.best.score - 0.1).map((c) => prod(c.pid)).filter(Boolean);
    const hit = close.find((c) => codeMatches(c.items, codes) === 2) || close.find((c) => codeMatches(c.items, codes) === 1);
    if (hit) { out.best = hit; out.cands = [hit, ...out.cands.filter((c) => String(c.pid) !== String(hit.pid))]; out.sure = true; out.why = 'number'; out.group = (REFTW(hit.pid)); }
  }
  return out;
}
function drawOutline(canvas, quad, state) {
  const ov = $('#scan-overlay'); if (!ov) return;
  const r = ov.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (ov.width !== Math.round(r.width * dpr)) { ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr); }
  const x = ov.getContext('2d'); x.clearRect(0, 0, ov.width, ov.height);
  if (!quad || !canvas || canvas.isPhoto) return;
  const k = (canvas.screenScale || 1) * dpr;
  x.lineWidth = 4 * dpr; x.lineJoin = 'round';
  x.strokeStyle = state === 'ok' ? '#5fe08a' : state === 'maybe' ? '#f1d48e' : 'rgba(241,212,142,.5)';
  x.shadowColor = x.strokeStyle; x.shadowBlur = 12 * dpr;
  x.beginPath(); quad.forEach(([px, py], i) => (i ? x.lineTo(px * k, py * k) : x.moveTo(px * k, py * k))); x.closePath(); x.stroke();
}
/** Returns { sure, best, cands, why } */
async function identify(canvas, { useName = true } = {}) {
  const hashes = await loadHashes();
  const h = dhash(canvas);
  const scoreHash = (pid) => { const ph = hashes[String(pid)]; return ph ? hamming(h, ph) : 128; };
  let cands = [], why = '';
  // 1) collector number — the most reliable signal
  let codes = [];
  codes = await readCode(canvas);
  const idx = numIndex();
  for (const c of codes) {
    const hits = idx.get(`${c.n}/${c.tot}`);
    if (hits && hits.length) { cands = hits.map((x) => ({ ...x, code: true, sufOk: x.suf === c.suf })); why = 'number'; break; }
  }
  if (!cands.length) { // maybe a battlefield held sideways
    const r = rotated(canvas); const r2 = rotated(rotated(r));
    for (const rc of [r, r2]) {
      const cc = parseCode((await ocr(cropScaled(rc, [0.03, 0.9, 0.5, 0.1], Math.max(1.5, 1900 / rc.width), true), 'code').catch(() => '')));
      for (const c of cc) { const hits = idx.get(`${c.n}/${c.tot}`); if (hits && hits.length) { cands = hits.map((x) => ({ ...x, code: true, sufOk: x.suf === c.suf })); why = 'number'; codes = cc; break; } }
      if (cands.length) break;
    }
  }
  // 2) card name
  if (!cands.length && useName) {
    let txt = '';
    try { txt = await ocr(cropScaled(canvas, NAME_BOX, Math.max(1, 1000 / canvas.width), true), 'name'); } catch (e) { console.warn(e); }
    const words = baseName(txt).split(' ').filter((w) => w.length > 2);
    if (words.length) {
      const ws = new Set(words);
      for (const [pid, items] of S.byPid) {
        const it = items[0]; if (it.sealed) continue;
        const nw = baseName(it.n).split(' ').filter((w) => w.length > 2);
        if (!nw.length) continue;
        const hit = nw.filter((w) => ws.has(w)).length / nw.length;
        if (hit >= 0.6) cands.push({ pid, items, name: hit });
      }
      if (cands.length) why = 'name';
    }
  }
  // 3) nothing readable: fall back to the artwork alone (only close matches)
  if (!cands.length) {
    const all = [];
    for (const [pid, items] of S.byPid) { if (items[0].sealed) continue; const d = scoreHash(pid); if (d < 70) all.push({ pid, items, art: true, d }); }
    all.sort((x, y) => x.d - y.d); cands = all.slice(0, 5); if (cands.length) why = 'art';
  }
  // 4) score: text evidence first, artwork decides between versions
  for (const c of cands) {
    c.d = scoreHash(c.pid);
    const grp = S.groups.get(c.items[0].g);
    c.main = grp && MAIN_SETS.has(grp.abbr);
    c.s = (c.code ? 60 : 0) + (c.sufOk && c.suf ? 10 : 0) + (c.name ? 30 * c.name : 0) + Math.max(0, 80 - c.d) * 0.6 + (c.main ? 3 : 0);
  }
  cands.sort((a, b) => b.s - a.s);
  const [a, b] = cands;
  let sure = false;
  if (a && a.art) sure = a.d <= 38 && (!b || b.d - a.d >= 18);   // picture alone: only when it's unmistakable
  else if (a && ((a.code && a.d <= 75) || (a.name >= 0.99 && a.d < 90))) {
    if (!b) sure = true;
    else if (a.code && b.code && a.sufOk !== b.sufOk && codes.some((c) => c.suf)) sure = a.sufOk; // a printed letter (e.g. 066a) settles it
    else if (b.d - a.d >= 12) sure = true;                       // artwork clearly closer
    else if (a.main && !b.main && b.d - a.d >= -4) sure = true;  // same art as a promo reprint: take the set version (switchable)
  }
  return { sure, best: a || null, cands: cands.slice(0, 5), why, hash: h, codes };
}

/* ---- scanning UI: auto mode adds cards on its own */
const SCAN = { auto: true, busy: false, timer: 0, last: null, holdHash: null, shownFor: null };
function pickFinish(items) {
  const foil = $('#scan-foil').checked;
  return items.find((v) => (foil ? v.s !== 'Normal' : v.s === 'Normal')) || items[0];
}
function showAdded(it, product, cands) {
  const others = cands.filter((c) => c.pid !== product.pid).slice(0, 3);
  const finishes = product.items.filter((v) => v.k !== it.k);
  const e = SCAN.last && sessGet(SCAN.last.id), dup = SCAN.last && SCAN.last.dup;
  $('#scan-status').innerHTML = '';
  $('#scan-results').innerHTML = `<li class="item scan-hit ${dup ? 'dup' : ''}">
      ${img(it.img)}
      <div class="info">
        <div class="nm"><span class="${dup ? 'part' : 'ok'}">${dup ? '↺' : '✓'}</span> ${esc(it.n)}${variantTags(it)}</div>
        <div class="meta">${metaLine(it)}</div>
        <div class="meta">${money(it.m)} · ${dup ? 'already scanned — skipped' : e && !e.done ? `${e.qty} in review list` : `${S.inv.items[it.k]?.qty || 1} owned`}</div>
      </div>
      <div class="addbtns">
        ${dup ? '<button data-scan="more">+1 copy anyway</button>' : '<button data-scan="undo">Undo</button><button data-scan="more">+1 copy</button>'}
        ${dup ? '' : finishes.map((v) => `<button data-scan="swap" data-k="${esc(v.k)}">${esc(v.s)} instead</button>`).join('')}
      </div></li>
    ${others.length && !dup ? `<li class="sub" style="padding:6px 2px">Different version? Tap to switch:</li>` + others.map((c) => {
      const v = pickFinish(c.items);
      return `<li class="item" data-scan="swap" data-k="${esc(v.k)}">${img(v.img)}<div class="info"><div class="nm">${esc(v.n)}</div><div class="meta">${metaLine(v)}</div></div><div class="px"><b>${money(v.m)}</b></div></li>`;
    }).join('') : ''}`;
}
function showMaybe(res) {
  if (!res.cands.length) return;
  $('#scan-status').textContent = 'Which one is it? Tap to add:';
  $('#scan-results').innerHTML = res.cands.slice(0, 3).map((c) => productRow(c.items, `<div class="match">${c.code ? 'number match' : c.name ? 'name match' : 'artwork match'}</div>`)).join('');
}
async function runScan(canvas, manual) {
  if (SCAN.busy) return; SCAN.busy = true;
  const msg = $('#cam-msg');
  try {
    let res;
    if (window.CardScan && !SCAN.legacy) {
      try { res = await identifyArt(canvas); } catch (e) { console.warn('recognizer', e); SCAN.legacy = true; }
    }
    if (res) {
      drawOutline(canvas, res.score >= 0.6 ? res.quad : null, res.sure ? 'ok' : res.score >= 0.85 ? 'maybe' : '');
      if (!manual && SCAN.holdGroup) {
        // the card we just added is still in view: wait until it is taken away or a different card shows up
        const present = res.best && res.score >= 0.8;
        if (present && res.group === SCAN.holdGroup) { SCAN.holdMiss = 0; drawOutline(canvas, res.quad, 'ok'); msg.textContent = 'Added ✓ — show the next card'; return; }
        if (!present) {
          if (++SCAN.holdMiss < 2) { msg.textContent = 'Added ✓ — show the next card'; return; }
          SCAN.holdGroup = null; SCAN.holdMiss = 0; if (SCAN.lastAdd) SCAN.lastAdd.gap = true; msg.textContent = 'Ready for the next card'; return;
        }
        SCAN.holdGroup = null; SCAN.holdMiss = 0;
      }
      if (!res.best || res.score < 0.6) { res = { sure: false, best: null, cands: [], hash: null }; if (SCAN.lastAdd) SCAN.lastAdd.gap = true; }
      // the same card coming back into view without having been taken away: don't count it twice
      if (!manual && res.sure && SCAN.lastAdd && SCAN.lastAdd.group === res.group && !SCAN.lastAdd.gap && Date.now() - SCAN.lastAdd.t < 5000) { SCAN.holdGroup = res.group; msg.textContent = 'Added ✓ — show the next card'; return; }
      res.hash = res.group;
      if (manual && !res.best) { try { const old = await identify(canvas.isPhoto ? await grabCentre(canvas) : canvas, { useName: true }); if (old.cands.length) res = old; } catch (e) { console.warn(e); } }
    } else {
      if (!manual && SCAN.holdHash) {
        if (hamming(dhash(canvas), SCAN.holdHash) < 46) { msg.textContent = 'Added ✓ — show the next card'; return; }
        SCAN.holdHash = null;
      }
      msg.textContent = 'Reading…';
      res = await identify(canvas, { useName: true });
    }
    if (res.sure && res.best) {
      const it = pickFinish(res.best.items);
      const { e, dup } = sessionAdd(it.k);
      if (navigator.vibrate) navigator.vibrate(dup ? 15 : [20, 40, 20]);
      SCAN.last = { id: e.id, k: e.k, res, dup };
      if (res.group) { SCAN.holdGroup = res.group; SCAN.holdMiss = 0; SCAN.prevGroup = null; SCAN.lastAdd = { group: res.group, t: Date.now(), gap: false }; } else SCAN.holdHash = res.hash;
      const shown = S.byKey.get(e.k) || it;
      scanFlash(shown, dup ? 'dup' : e.done ? 'added' : 'review');
      showAdded(shown, res.best, res.cands);
      msg.textContent = dup ? `Already scanned: ${it.n}` : e.done ? `Added ✓ ${it.n}` : `✓ ${it.n} — in review list`;
    } else if (res.cands.length) {
      const changed = res.group ? res.group !== SCAN.shownFor : (SCAN.shownFor === null || hamming(res.hash, SCAN.shownFor) > 46);
      if (manual || changed) { showMaybe(res); SCAN.shownFor = res.hash; }
      msg.textContent = 'Not sure which version — pick below, or hold steady';
    } else {
      msg.textContent = manual ? 'Couldn\'t recognize that card — try more light or less glare' : 'Looking for a card…';
      if (manual) $('#scan-status').textContent = 'Couldn\'t read the number or name. Fill the frame with the card, avoid glare, or tap Search by name.';
    }
  } finally { SCAN.busy = false; }
}
function scanLoop() {
  clearTimeout(SCAN.timer);
  if (!SCAN.auto || S.view !== 'scan' || !stream || document.hidden) return;
  const c = window.CardScan && !SCAN.legacy ? grabFrame() : grabFromVideo();
  const next = () => { SCAN.timer = setTimeout(scanLoop, 120); };
  if (!c) return next();
  runScan(c, false).then(next, next);
}
function setAuto(on) {
  SCAN.auto = on; S.prefs.autoScan = on; savePrefs();
  $('#scan-autotoggle').checked = on;
  const b = $('#btn-capture');
  b.textContent = on ? 'Auto' : 'Scan'; b.classList.toggle('live', on);
  $('#scan-mode').textContent = on ? 'Auto-add is on — cards are added as soon as they\'re recognized' : 'Tap Scan for each card';
  if (on) scanLoop(); else clearTimeout(SCAN.timer);
}
function wireScan() {
  SCAN.auto = S.prefs.autoScan !== false;
  $('#btn-capture').onclick = async () => {
    if (SCAN.auto) { setAuto(false); return; }
    const c = window.CardScan && !SCAN.legacy ? grabFrame() : grabFromVideo(); if (!c) { toast('Camera not ready — try Photo'); return; }
    SCAN.holdHash = null; SCAN.holdGroup = null; runScan(c, true);
  };
  $('#scan-autotoggle').onchange = (e) => setAuto(e.target.checked);
  $('#cam-rotbtn').onclick = rotateCam;
  $('#scan-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scan]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.scan, last = SCAN.last;
    if (!last) return;
    const prodOf = (k) => last.res.cands.find((c) => c.items.some((v) => v.k === k)) || last.res.best || { pid: S.byKey.get(k).p, items: S.byPid.get(S.byKey.get(k).p) };
    if (act === 'undo') { const e = sessGet(last.id); if (e) sessSetQty(e.id, e.qty - 1); toast('Removed'); $('#scan-results').innerHTML = ''; SCAN.last = null; }
    if (act === 'more') { const { e } = sessionAdd(last.k, { force: true }); SCAN.last = { ...last, id: e.id, k: e.k, dup: false }; scanFlash(S.byKey.get(e.k), e.done ? 'added' : 'review'); showAdded(S.byKey.get(e.k), prodOf(e.k), last.res.cands); }
    if (act === 'swap') {
      const k = withLang(b.dataset.k, langOf(last.k)); const e = sessSwap(last.id, k) || sessionAdd(k, { force: true }).e; SCAN.last = { ...last, id: e.id, k };
      const prod = prodOf(k);
      showAdded(S.byKey.get(k), prod, last.res.cands);
    }
  }, true);
}

/* ---------------------------------------------------------------- backup */
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: name }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/* ---------------------------------------------------------------- backups + automatic snapshots
   Everything the app saves lives under localStorage keys starting with "rbt.". A backup (and a snapshot)
   is a copy of all of them, so new features that add new keys are covered automatically. */
const allStored = (skipBig) => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('rbt.') && !(skipBig && (k === 'rbt.oppbg.v1' || k === 'rbt.mybg.v1'))) o[k] = localStorage.getItem(k); } } catch {} return o; };
function exportBackup() {
  const items = {};
  for (const [k, e] of Object.entries(S.inv.items)) { const it = S.byKey.get(k); items[k] = { ...e, name: it ? it.n : e.name, number: it ? it.num : '' }; }
  download(`riftbound-collection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'riftbound-tracker', version: 5, saved: new Date().toISOString(), items, decks: MD.decks, events: EV.events, wishlist: WL.items, store: allStored(false) }, null, 1), 'application/json');
  S.prefs.lastBackup = Date.now(); savePrefs(); renderBackupInfo();
}
const SNAP = { db: null };
function snapDB() {
  if (SNAP.db) return SNAP.db;
  SNAP.db = new Promise((res, rej) => { const r = indexedDB.open('rbt-snapshots', 1); r.onupgradeneeded = () => r.result.createObjectStore('snaps', { keyPath: 't' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return SNAP.db;
}
async function snapAll() { const db = await snapDB(); return new Promise((res) => { const q = db.transaction('snaps').objectStore('snaps').getAll(); q.onsuccess = () => res(q.result.sort((a, b) => b.t - a.t)); q.onerror = () => res([]); }); }
/** copy every saved key into IndexedDB (separate from localStorage, so a broken save can't take the copies with it) */
async function takeSnapshot(why) {
  try {
    const data = allStored(true); if (!Object.keys(data).length) return;
    const db = await snapDB(); const list = await snapAll();
    const counts = { cards: Object.values(S.inv.items).reduce((t, e) => t + (e.qty || 0), 0), decks: MD.decks.length, wish: Object.keys(WL.items || {}).length, events: EV.events.length };
    await new Promise((res) => { const tx = db.transaction('snaps', 'readwrite'); const st = tx.objectStore('snaps');
      st.put({ t: Date.now(), why, data, counts, app: SHELL_VERSION }); for (const old of list.slice(13)) st.delete(old.t); tx.oncomplete = res; tx.onerror = res; });
  } catch (e) { console.warn('snapshot', e); }
}
async function dailySnapshot() {
  const list = await snapAll().catch(() => []);
  const last = list[0];
  const today = new Date().toDateString();
  if (!last || new Date(last.t).toDateString() !== today) await takeSnapshot('Daily');
  else if (last.app !== SHELL_VERSION) await takeSnapshot('Before app update');
}
async function restoreSnapshot(t) {
  const s = (await snapAll()).find((x) => x.t === t); if (!s) return;
  if (!(await confirmBox(`Restore your data as it was on ${new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}? (${s.counts.cards} cards, ${s.counts.decks} decks). Your current data is snapshotted first, so this can be undone.`))) return;
  await takeSnapshot('Before restore');
  for (const [k, v] of Object.entries(s.data)) { try { localStorage.setItem(k, v); } catch {} }
  location.reload();
}
/* ---- settings: sync, format, text size */
function applyCamGap() { document.documentElement.classList.toggle('camgap', !!S.prefs.camGap); }
function renderPrefs() {
  const cg = $('#pref-camgap'); if (cg) { cg.checked = !!S.prefs.camGap; cg.onchange = () => { S.prefs.camGap = cg.checked; savePrefs(); applyCamGap(); }; }
  const ib = $('#btn-import'); if (ib) ib.onclick = () => openImport();
  $$('#pref-langval button').forEach((b) => { b.classList.toggle('on', b.dataset.v === (S.prefs.langValue || 'en')); b.onclick = () => { S.prefs.langValue = b.dataset.v; savePrefs(); renderPrefs(); }; });
  $$('#pref-format button').forEach((b) => b.classList.toggle('on', b.dataset.v === (S.prefs.format || 'standard')));
  $$('#pref-text button').forEach((b) => b.classList.toggle('on', b.dataset.v === (S.prefs.text || 'm')));
}
function applyTextSize() { document.documentElement.dataset.text = S.prefs.text || 'm'; applyCamGap(); }
function renderSync() {
  const box = $('#sync-body'); if (!box) return;
  const st = window.RBTSync ? RBTSync.state() : { configured: false };
  if (!st.configured) { box.innerHTML = '<p class="sub">Cloud sync is being set up. Until then your data stays on this device (and in your backups).</p>'; return; }
  if (st.email) {
    const when = st.last ? new Date(st.last).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    box.innerHTML = `<p class="sub">Signed in as <b>${esc(st.email)}</b>. Your cards, decks, wishlist, events and matches sync automatically to every device you sign in on.</p>
      <p class="sub">${st.status === 'error' ? '⚠ ' + esc(st.err || 'Sync problem — will retry') : st.status === 'saving' ? 'Saving…' : st.status === 'joining' ? 'Combining this device with your account…' : when ? '✓ Up to date · ' + when : '✓ Connected'}</p>
      <div class="row"><button class="ghost" id="sync-now">Sync now</button><button class="ghost" id="sync-out">Sign out</button></div>`;
    $('#sync-now').onclick = () => RBTSync.syncNow();
    $('#sync-out').onclick = async () => { if (await confirmBox('Sign out? Your data stays on this device; it just stops syncing.')) RBTSync.signOut(); };
    return;
  }
  box.innerHTML = `<p class="sub">Sign in to keep your collection and decks the same on your phone, iPad and computer. The first time you sign in, everything already on this device is added to your account — nothing is replaced.</p>
    <button class="primary" id="sync-google" style="width:100%">Continue with Google</button>
    <div class="or sub center" style="margin:10px 0">or with email</div>
    <input id="sync-email" type="email" placeholder="Email" autocomplete="email" style="width:100%;margin-bottom:6px">
    <input id="sync-pw" type="password" placeholder="Password (6+ characters)" autocomplete="current-password" style="width:100%">
    <div class="row" style="margin-top:8px"><button class="ghost" id="sync-in">Sign in</button><button class="ghost" id="sync-new">Create account</button></div>
    <button class="linkbtn sub" id="sync-forgot" style="margin-top:6px">Forgot password?</button>
    ${st.err && st.status !== 'signed-out' ? `<p class="sub">⚠ ${esc(st.err)}</p>` : ''}`;
  const err = (e) => toast(({ 'auth/invalid-credential': 'Email or password is wrong', 'auth/wrong-password': 'Email or password is wrong', 'auth/user-not-found': 'No account with that email — tap Create account', 'auth/email-already-in-use': 'That email already has an account — tap Sign in', 'auth/weak-password': 'Use at least 6 characters', 'auth/invalid-email': 'That email doesn\'t look right', 'auth/popup-closed-by-user': 'Sign-in was cancelled' })[e.code] || 'Sign-in failed: ' + (e.message || e), 4000);
  $('#sync-google').onclick = () => RBTSync.google().catch(err);
  const em = () => $('#sync-email').value.trim(), pw = () => $('#sync-pw').value;
  $('#sync-in').onclick = () => RBTSync.email(em(), pw(), false).catch(err);
  $('#sync-new').onclick = () => RBTSync.email(em(), pw(), true).catch(err);
  $('#sync-forgot').onclick = () => { if (!em()) return toast('Type your email first'); RBTSync.reset(em()).then(() => toast('Password reset email sent'), err); };
}
/** another device changed synced data: reload it into the app and redraw */
function reloadFromStorage() {
  INV = loadJSON(INV_KEY, { items: {} });
  MD.decks = (loadJSON(MD_KEY, {}).decks) || [];
  EV.events = (loadJSON(EV_KEY, {}).events) || [];
  WL.items = (loadJSON(WL_KEY, {}).items) || {};
  if (typeof MT !== 'undefined') MT.list = (loadJSON(MT_KEY, {}).list) || [];
  if (!$('#sheet').classList.contains('hidden')) return; // don't yank an open card/deck screen
  show(S.view);
}
async function renderBackupInfo() {
  const last = S.prefs.lastBackup;
  $('#bk-last').innerHTML = last ? `Last backup file saved ${new Date(last).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.` : '<b>You haven\'t saved a backup file yet.</b>';
  const list = await snapAll().catch(() => []);
  $('#snap-list').innerHTML = list.map((s) => `<li class="item" style="padding:9px 12px"><div class="info"><div class="nm">${esc(new Date(s.t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>
    <div class="meta">${esc(s.why)} · ${s.counts.cards} cards · ${s.counts.decks} decks · ${s.counts.wish} wishlist</div></div><button class="ghost sm" data-snap="${s.t}">Restore</button></li>`).join('') || '<li class="sub">None yet.</li>';
  $$('#snap-list [data-snap]').forEach((b) => b.onclick = () => restoreSnapshot(+b.dataset.snap));
}
function exportCSV() {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [['Name', 'Set', 'Number', 'Rarity', 'Version', 'Qty', 'Market each', 'Total', 'Week $', 'Week %', 'Paid each', 'TCGplayer ID'].join(',')];
  for (const r of ownedRows()) lines.push([q(r.it.n), q(setName(r.it.g)), q(r.it.num), q(r.it.r), q(r.it.s), r.e.qty, r.it.m ?? '', r.value.toFixed(2), r.it.d ?? '', r.it.pc ?? '', r.e.cost ?? '', r.it.p ?? ''].join(','));
  download(`riftbound-collection-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n'), 'text/csv');
}
async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.items) throw new Error();
    const n = Object.keys(data.items).length;
    if (!(await confirmBox(`Replace your current data with this backup (${n} collection entries)? A snapshot of what you have now is kept under Settings → Automatic snapshots.`))) return;
    await takeSnapshot('Before restoring a backup file');
    if (data.store && typeof data.store === 'object') { // version 5+: every saved setting, deck, score...
      for (const [k, v] of Object.entries(data.store)) if (k.startsWith('rbt.')) { try { localStorage.setItem(k, v); } catch {} }
      toast('Backup restored'); setTimeout(() => location.reload(), 600); return;
    }
    INV.items = {}; S.prefs.colId = ''; savePrefs();
    for (const [k, e] of Object.entries(data.items)) INV.items[k] = { qty: +e.qty || 1, added: e.added || Date.now(), cost: e.cost ?? null, name: e.name };
    if (Array.isArray(data.decks)) { MD.decks = data.decks; saveMD(); }
    if (Array.isArray(data.events)) { EV.events = data.events; saveEV(); }
    if (data.wishlist && typeof data.wishlist === 'object') { WL.items = data.wishlist; saveWL(); }
    saveInv(); toast('Backup restored'); show('collection');
  } catch { toast('That file isn\'t a Riftbound Tracker backup'); }
}

/* ---------------------------------------------------------------- wiring */
function wire() {
  $$('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.view));
  $('#hdr-back').onclick = () => show(S.tabView || 'collection');
  document.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (!g) return; e.preventDefault(); if (g.dataset.go === 'import') openImport(); else show(g.dataset.go); });
  // stop double-taps zooming the page (fast taps on −/+ and the score buttons)
  let lastTouch = 0;
  document.addEventListener('touchend', (e) => { const t = Date.now(); if (t - lastTouch < 350 && e.target.closest('button, .sbtn, .snum, [data-undo], [data-qty]')) e.preventDefault(); lastTouch = t; }, { passive: false });
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => { if (S.view === 'score' || S.view === 'scan') e.preventDefault(); }, { passive: false });
  $('#hdr-more').onclick = () => show('more');
  $('#pref-format').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.format = b.dataset.v; savePrefs(); renderPrefs(); toast(b.dataset.v === '2v2' ? 'Showing 2v2 bans and legality' : 'Showing Standard bans and legality'); };
  $('#pref-text').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.text = b.dataset.v; savePrefs(); applyTextSize(); renderPrefs(); };
  wireDecks(); wireScore(); wireEvents();
  $('#col-filter').oninput = renderCollection;
  $('#col-top').onclick = (e) => { const b = e.target.closest('[data-c]'); if (!b) return; S.prefs.colView = b.dataset.c; savePrefs(); renderCollection(); };
  // mouse wheel scrolls side-scrolling strips on a computer
  document.addEventListener('wheel', (e) => { const el = e.target.closest('.setstrip,.chips'); if (!el || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return; el.scrollLeft += e.deltaY; e.preventDefault(); }, { passive: false });
  $('#col-sets').onclick = (e) => { const b = e.target.closest('[data-colset]'); if (!b) return; S.prefs.colSet = b.dataset.colset; savePrefs(); renderCollection(); };
  $('#col-setmode').onclick = (e) => { const b = e.target.closest('[data-m]'); if (!b) return; S.prefs.colMode = b.dataset.m; savePrefs(); renderCollection(); };
  $('#col-sort').value = S.prefs.sort;
  $('#col-sort').onchange = (e) => { S.prefs.sort = e.target.value; savePrefs(); renderCollection(); };
  let t; $('#add-q').oninput = () => { clearTimeout(t); t = setTimeout(renderAdd, 150); };
  $('#add-sealed').onchange = renderAdd;
  $('#add-text').onchange = () => { $('#add-q').placeholder = $('#add-text').checked ? 'Card text, e.g. "draw 1" or deflect' : 'Name or number, e.g. Jinx or OGN-066'; renderAdd(); };
  $('#add-sets').onclick = (e) => { const b = e.target.closest('[data-set]'); if (!b) return; S.prefs.addSet = b.dataset.set; savePrefs(); renderAdd(); };
  $('#mv-scope').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mvScope = b.dataset.v; savePrefs(); renderMovers(); };
  $('#mv-metric').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mvMetric = b.dataset.v; savePrefs(); renderMovers(); };
  $('#mv-min').onchange = (e) => { S.prefs.mvMin = e.target.value; savePrefs(); renderMovers(); };
  $('#mv-q').oninput = () => renderMovers();
  $('#mv-kind').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mvKind = b.dataset.k; savePrefs(); renderMovers(); };
  $('#mv-ssort').onchange = (e) => { S.prefs.mvSort = e.target.value; savePrefs(); renderMovers(); };
  // list clicks: add buttons or open detail
  document.body.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    const lb = e.target.closest('[data-langs]');
    if (lb) { e.stopPropagation(); openDetail(lb.dataset.langs); setTimeout(() => $('#langrow')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120); return; }
    if (add) {
      e.stopPropagation();
      if (S.view === 'scan') { const r = sessionAdd(add.dataset.add, { force: true }); const it = S.byKey.get(r.e.k); scanFlash(it, r.e.done ? 'added' : 'review'); toast(r.e.done ? `Added <b>${esc(it.n)}</b>` : `<b>${esc(it.n)}</b> is in your review list`); return; }
      addCard(add.dataset.add); return;
    }
    const row = e.target.closest('.list .item[data-k]');
    if (row) openDetail(row.dataset.k);
    const cl = e.target.closest('[data-close]');
    if (cl) { e.preventDefault(); if (cl.classList.contains('back')) sheetBack(); else closeSheet(); return; }
    const cd = e.target.closest('[data-card]');
    if (cd) { openDetail(cd.dataset.card); return; }
    const dk = e.target.closest('[data-deck]');
    if (dk) { openDeck(dk.dataset.deck); return; }
    const md = e.target.closest('[data-mydeck]');
    if (md) { pushSheet(() => renderMyDeck(md.dataset.mydeck)); return; }
  });
  wireScan();
  $('#scan-file').onchange = async (e) => { const f = e.target.files[0]; if (f) { SCAN.holdHash = null; SCAN.holdGroup = null; runScan(await grabFromFile(f), true); } e.target.value = ''; };
  $('#btn-export').onclick = exportBackup;
  $('#btn-csv').onclick = exportCSV;
  $('#import-file').onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('#btn-clear').onclick = async () => { if (await confirmBox(`Delete every card from "${colName()}"? Make a backup first if unsure.`)) { S.inv.items = {}; saveInv(); toast('Collection cleared'); } };
  $('#btn-refresh').onclick = async () => { try { await loadData(true); S.history = null; renderMore(); checkStale(); toast('Prices are up to date (' + fmtDate(S.cards.updated) + ')'); } catch { toast('Could not reach the price data'); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopCamera(); clearTimeout(SCAN.timer); } else if (S.view === 'scan') startCamera(); });
}

/* ---------------------------------------------------------------- meta decks */
const D = { data: null, rb: null, loading: null, tab: 'meta', byName: null, pop: null };
const normName = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s-\s(starter)$/, '').replace(/[^a-z0-9]/g, '');
const SECTION_ORDER = [['Legend', 'Legend'], ['Champion', 'Chosen champion'], ['Unit', 'Units'], ['Spell', 'Spells'], ['Gear', 'Gear'], ['Battlefield', 'Battlefields'], ['Rune', 'Runes']];

function loadDecks() {
  if (D.data) return Promise.resolve();
  if (!D.loading) D.loading = Promise.all([fetch('data/decks.json').then((r) => r.json()), fetch('data/rbcards.json').then((r) => r.json()), loadHashes()])
    .then(([d, rb]) => { D.data = d; D.rb = rb; buildDeckIndexes(); })
    .catch((e) => { D.loading = null; throw e; });
  return D.loading;
}
function buildDeckIndexes() {
  // TCGplayer printings by card name (any printing counts as owning the card)
  D.byName = new Map();
  for (const it of S.cards.items) {
    if (it.sealed) continue;
    const n = normName(it.n);
    if (!D.byName.has(n)) D.byName.set(n, []);
    D.byName.get(n).push(it);
  }
  // card popularity across all tournament lists, overall and by domain
  const lists = D.data.archetypes.filter((a) => a.list);
  D.pop = {}; D.popDom = {};
  for (const a of lists) for (const id of new Set([...Object.keys(a.list.main), ...Object.keys(a.list.side)])) {
    D.pop[id] = (D.pop[id] || 0) + 1;
    for (const c of a.colors) { const k = id + '|' + c; D.popDom[k] = (D.popDom[k] || 0) + 1; }
  }
  D.nLists = lists.length || 1;
  D.domLists = {};
  for (const a of lists) for (const c of a.colors) D.domLists[c] = (D.domLists[c] || 0) + 1;
}
function ownedCountByName() {
  const m = new Map();
  for (const [k, e] of Object.entries(poolItems())) {
    const it = S.byKey.get(k); const n = normName(it ? it.n : e.name);
    m.set(n, (m.get(n) || 0) + e.qty);
  }
  return m;
}
function cardPrice(name) {
  const list = D.byName.get(normName(name)) || [];
  let best = null;
  for (const it of list) if (it.m != null && (best == null || it.m < best.m)) best = it;
  return best; // cheapest printing
}
function cardRef(name) { // the printing to show: has a picture, standard art, non-foil
  const list = D.byName.get(normName(name)) || [];
  const h = S.hashes || {};
  let best = null, bs = -1;
  for (const i of list) {
    const sc = (h[String(i.p)] ? 4 : 0) + (/\(/.test(i.n) ? 0 : 2) + (i.s === 'Normal' ? 1 : 0);
    if (sc > bs) { bs = sc; best = i; }
  }
  return best;
}
function sectionOf(id, legendTags) {
  const c = D.rb[id]; if (!c) return 'Unit';
  if (c.t === 'Legend' || c.t === 'Rune' || c.t === 'Battlefield') return c.t;
  if (c.st === 'Champion' && (c.tg || []).some((t) => legendTags.includes(t))) return 'Champion';
  return c.t || 'Unit';
}

/** Ownership of a list + suggested substitutes from cards you own (or cheap picks to buy). */
/** banned (now or already announced) in the format you play — never suggest these, and replace them in "My version" */
const bannedForMe = (name) => { const b = banInfo(name); return !!b && (b.fmt === (S.prefs.format === '2v2' ? '2v2' : 'standard') || (b.fmt === 'standard')); };
function analyzeDeck(a, opts = {}) {
  const legal = opts.legal;
  const owned = ownedCountByName();
  const used = new Map();
  const legend = D.rb[a.list.leader || a.leader] || D.rb[a.leader] || { d: a.colors, tg: [] };
  const colors = new Set([...(legend.d || a.colors), 'Colorless']);
  const legendTags = legend.tg || [];
  const lines = [];
  let champTaken = false;
  for (const [id, cnt] of Object.entries(a.list.main)) {
    const c = D.rb[id] || { n: id, t: '' };
    let sec = sectionOf(id, legendTags);
    if (sec === 'Champion') { if (champTaken) sec = 'Unit'; else champTaken = true; } // one chosen champion copy; extras are units
    const n = normName(c.n);
    const banned = legal && sec !== 'Legend' && bannedForMe(c.n);
    const have = banned ? 0 : Math.max(0, Math.min(cnt, (owned.get(n) || 0) - (used.get(n) || 0)));
    used.set(n, (used.get(n) || 0) + have);
    lines.push({ id, c, cnt, have, miss: cnt - have, sec, banned });
  }
  // a chosen champion line counts 1; any remaining copies of that card are listed as units
  for (const l of lines) if (l.sec === 'Champion' && l.cnt > 1) {
    const extra = { ...l, cnt: l.cnt - 1, sec: 'Unit' };
    extra.have = Math.max(0, l.have - 1); extra.miss = extra.cnt - extra.have;
    l.cnt = 1; l.have = Math.min(1, l.have); l.miss = 1 - l.have;
    lines.push(extra);
  }
  const side = Object.entries(a.list.side || {}).map(([id, cnt]) => {
    const c = D.rb[id] || { n: id }; const n = normName(c.n);
    const have = Math.max(0, Math.min(cnt, (owned.get(n) || 0) - (used.get(n) || 0)));
    return { id, c, cnt, have, miss: cnt - have, sec: 'Side' };
  });

  // substitutes for missing main-deck cards
  const inDeck = new Map(); for (const l of lines) inDeck.set(normName(l.c.n), (inDeck.get(normName(l.c.n)) || 0) + l.cnt);
  const spare = (n) => (owned.get(n) || 0) - (used.get(n) || 0);
  const keyW = Object.fromEntries((a.key || []).map((k) => [k.id, k.w || 0]));
  const scoreCand = (id, cand, miss) => {
    let s = 0;
    s += 3 * (keyW[id] || 0);
    let dom = 0; for (const col of cand.d) if (D.domLists[col]) dom = Math.max(dom, (D.popDom[id + '|' + col] || 0) / D.domLists[col]);
    s += 2 * dom + 0.6 * ((D.pop[id] || 0) / D.nLists);
    if (miss.c.c != null && cand.c != null) s += 0.8 * Math.max(0, 1 - Math.abs(cand.c - miss.c.c) / 3);
    if (cand.st === miss.c.st) s += 0.2;
    return s;
  };
  const okCand = (id, cand, miss) => {
    if (!cand || cand.b || !cand.n || id === miss.id || bannedForMe(cand.n)) return false;
    if (miss.sec === 'Battlefield') return cand.t === 'Battlefield';
    if (miss.sec === 'Rune') return cand.t === 'Rune' && cand.d.some((d) => miss.c.d.includes(d));
    if (miss.sec === 'Champion') return cand.st === 'Champion' && (cand.tg || []).some((t) => legendTags.includes(t));
    if (!['Unit', 'Spell', 'Gear'].includes(cand.t) || cand.st === 'Token') return false;
    if (cand.t !== miss.c.t) return false;
    if (cand.st === 'Signature' && !(cand.tg || []).some((t) => legendTags.includes(t))) return false;
    return cand.d.every((d) => colors.has(d));
  };
  const allIds = Object.keys(D.rb);
  const subs = [];
  for (const miss of lines.filter((l) => l.miss > 0).sort((x, y) => y.miss - x.miss)) {
    let need = miss.miss; const picks = [];
    const cands = allIds.filter((id) => okCand(id, D.rb[id], miss))
      .map((id) => ({ id, c: D.rb[id], s: scoreCand(id, D.rb[id], miss) }))
      .sort((x, y) => y.s - x.s);
    for (const cd of cands) {
      if (need <= 0) break;
      const n = normName(cd.c.n);
      const room = (miss.sec === 'Rune' ? 99 : 3) - (inDeck.get(n) || 0);
      const take = Math.min(need, spare(n), room);
      if (take > 0) {
        picks.push({ ...cd, take }); need -= take;
        used.set(n, (used.get(n) || 0) + take); inDeck.set(n, (inDeck.get(n) || 0) + take);
      }
    }
    // nothing owned left: suggest the best cheap card to buy instead
    let buy = null;
    if (need > 0) {
      const affordable = cands.slice(0, 12).map((cd) => ({ ...cd, p: cardPrice(cd.c.n) })).filter((x) => x.p && x.p.m != null);
      affordable.sort((x, y) => (y.s - x.s) - (y.p.m - x.p.m) * 0.02);
      buy = affordable[0] || null;
    }
    subs.push({ miss, picks, still: need, buy });
  }
  const mainTotal = lines.filter((l) => !['Legend', 'Rune', 'Battlefield'].includes(l.sec)).reduce((t, l) => t + l.cnt, 0);
  const mainHave = lines.filter((l) => !['Legend', 'Rune', 'Battlefield'].includes(l.sec)).reduce((t, l) => t + l.have, 0);
  const allLines = lines.concat(side);
  let cost = 0, costMain = 0;
  for (const l of allLines) if (l.miss > 0 && !l.banned) { const p = cardPrice(l.c.n); if (p) { cost += p.m * l.miss; if (l.sec !== 'Side') costMain += p.m * l.miss; } }
  const pct = lines.reduce((t, l) => t + l.have, 0) / Math.max(1, lines.reduce((t, l) => t + l.cnt, 0));
  return { lines, side, subs, mainTotal, mainHave, cost, costMain, pct, legendTags };
}

/* ---- time windows and strength ranking */
function winData() {
  const ws = D.data.windows || {};
  return ws[D.win] || ws['30d'] || D.data;
}
function ranked() {
  const w = winData();
  if (w._ranked) return w._ranked;
  const by30 = new Map(((D.data.windows || {})['30d'] || D.data).archetypes.map((a) => [a.slug, a]));
  const minN = Math.min(120, Math.max(40, Math.round((w.sample?.matches || 0) * 0.008)));
  const f = w.field || {};
  const list = w.archetypes.map((a0) => {
    const a = { ...a0 };
    if (!a.list && by30.get(a.slug)?.list) { a.list = by30.get(a.slug).list; a.best = by30.get(a.slug).best; a.listFrom30 = true; }
    const n = a.winrateN || 0, k = 80;
    a.wrAdj = a.winrate == null ? 0.5 : (a.winrate * n + 0.5 * k) / (n + k);           // win rate, pulled toward 50% when few matches
    const tq = a.topq != null && f.topq ? a.topq - f.topq : 0;                           // top-25% finishes vs. the field
    const t8 = a.top8 != null && f.top8 ? a.top8 - f.top8 : 0;                           // top-8 finishes vs. the field
    a.strength = a.wrAdj + 0.35 * tq + 0.25 * t8;
    a.enough = n >= minN;
    return a;
  });
  list.sort((x, y) => (y.enough - x.enough) || (y.strength - x.strength));
  list.forEach((a, i) => { a.pos = i + 1; });
  w._ranked = list;
  return list;
}
function findArch(slug) { return ranked().find((x) => x.slug === slug) || ((D.data.windows || {})['30d'] || D.data).archetypes.find((x) => x.slug === slug); }
function deckCandidates() {
  let all = ranked();
  if (S.prefs.legalOnly) all = all.filter((a) => !deckBans(a).length);
  if (D.tab === 'meta') return all.slice(0, 10);
  if (D.tab === 'other') return all.slice(10);
  return all.filter((a) => a.list).map((a) => ({ a, an: analyzeDeck(a) })).sort((x, y) => (y.an.pct - x.an.pct) || (x.an.costMain - y.an.costMain)).slice(0, 20).map((x) => x.a);
}
const tierRank = (t) => ({ S: 0, A: 1, B: 2, C: 3, D: 4 }[t] ?? 5);
const pctTxt = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const domTags = (cols) => (cols || []).map((c) => `<span class="dom ${esc(c)}">${esc(c)}</span>`).join('');

async function renderDecks() {
  if (!S.cards) return;
  $$('#dk-tab button').forEach((b) => b.classList.toggle('on', b.dataset.v === D.tab));
  $$('#dk-win button').forEach((b) => b.classList.toggle('on', b.dataset.w === D.win));
  try { await loadDecks(); } catch { $('#dk-list').innerHTML = '<li class="empty">Deck data isn\'t available yet — check back after the next daily update.</li>'; return; }
  $('#dk-win').classList.toggle('hidden', D.tab === 'mine' && !deckQuery());
  if (deckQuery()) { renderDeckSearch(); return; }
  if (D.tab === 'staples') { $('#dk-win').classList.remove('hidden'); $('#dk-legal-wrap').classList.add('hidden'); renderStaples(); return; }
  if (D.tab === 'matrix') { $('#dk-win').classList.remove('hidden'); $('#dk-legal-wrap').classList.add('hidden'); renderMatrix(); return; }
  if (D.tab === 'mine') { renderMyDecksList(); return; }
  const d = winData();
  const days = { '30d': '30', '14d': '14', '7d': '7' }[D.win] || '30';
  const upd = d.updated ? new Date(d.updated * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  const src = `last ${days} days · ${(d.sample?.decks || 0).toLocaleString()} decks from ${d.sample?.events || 0} events · updated ${upd}`;
  $('#dk-info').innerHTML = {
    meta: `The 10 strongest legends, ranked by win rate and how often they finish in the top 25% and top 8 of tournaments. <span class="flat">(${src})</span>`,
    other: `Every other legend, strongest first. Ones with too few matches to judge are at the end. <span class="flat">(${src})</span>`,
    ready: `Lists you're closest to building with the cards you own. <span class="flat">(${src})</span>`,
  }[D.tab];
  // "Legal from <next ban date>" view: hide lists that use banned cards
  const nextBan = [...BAN.byKey.values()].map((e) => (e.fmt.standard || {}).effective).filter((d) => d && d > todayISO()).sort()[0];
  $('#dk-legal').checked = !!S.prefs.legalOnly;
  $('#dk-legal-lbl').textContent = nextBan ? `Legal from ${shortDate(nextBan)} only` : 'Legal decks only';
  $('#dk-legal-wrap').classList.toggle('hidden', D.tab === 'mine' || D.tab === 'staples');
  if (S.prefs.legalOnly) {
    const lastBan = [...BAN.byKey.values()].map((e) => (e.fmt.standard || {}).effective).filter(Boolean).sort().pop();
    const post = lastBan && lastBan <= todayISO() ? Math.floor((Date.now() - new Date(lastBan + 'T00:00:00')) / 864e5) : -1;
    $('#dk-info').innerHTML += `<br><span class="banline">Showing only decks with no banned cards. ${post < 0 ? `Stats still come from tournaments before the ${shortDate(lastBan)} bans — once they take effect, the 7-day view shows only post-ban play after a week.` : post < 7 ? `Bans took effect ${post} day${post === 1 ? '' : 's'} ago; the 7-day view will be fully post-ban in ${7 - post} day${7 - post === 1 ? '' : 's'}.` : 'The 7-day view now reflects only post-ban tournaments.'}</span>`;
  }
  const rows = deckCandidates();
  $('#dk-list').innerHTML = rows.map((a) => deckRowHTML(a)).join('') || `<li class="empty">${S.prefs.legalOnly ? 'No decks here are free of banned cards yet — new lists appear as post-ban tournaments are reported.' : 'Nothing here yet.'}</li>`;
}
function deckBans(a) {
  const ids = a.list ? [a.leader, ...Object.keys(a.list.main || {}), ...Object.keys(a.list.side || {})] : [a.leader, ...(a.key || []).map((k) => k.id)];
  const seen = new Map();
  for (const id of ids) { const n = D.rb[id]?.n; const b = n && banInfo(n); if (b && b.fmt === 'standard' && !seen.has(banKey(n))) seen.set(banKey(n), { n, b }); }
  return [...seen.values()];
}
function deckBanLine(a) {
  const bs = deckBans(a); if (!bs.length) return '';
  const soon = bs.every((x) => x.b.state === 'soon');
  return `<div class="meta banline">${soon ? '⚠' : '⛔'} ${bs.length} card${bs.length === 1 ? '' : 's'} ${soon ? 'banned from ' + esc(shortDate(bs[0].b.effective)) : 'now banned'}: ${bs.slice(0, 3).map((x) => esc(x.n)).join(', ')}${bs.length > 3 ? '…' : ''}</div>`;
}
function deckRowHTML(a, why = '') {
    const an = a.list ? analyzeDeck(a) : null;
    const leg = cardRef(D.rb[a.leader]?.n || a.name);
    return `<li class="item" data-deck="${esc(a.slug)}">
      ${img(leg && leg.img)}
      <div class="info">
        <div class="nm">${a.tier ? `<span class="tier ${esc(a.tier)}">${esc(a.tier)}</span>` : ''}${esc(a.name)}</div>
        <div class="meta wrap">${domTags(a.colors)} <b class="rk">#${a.pos ?? a.rank}</b> ${pctTxt(a.winrate)} wins · top 8 ${pctTxt(a.top8)} · ${a.share}% of decks${a.enough === false ? ' · <span class="part">small sample</span>' : ''}</div>
        ${an ? `<div class="meta">You own ${Math.round(an.pct * 100)}% · ${an.costMain > 0 ? money(an.costMain) + ' to finish' : 'ready to play'}</div><div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>`
        : '<div class="meta">No public decklist yet</div>'}
        ${why ? `<div class="meta hitwhy">${why}</div>` : ''}
        ${deckBanLine(a)}
      </div>
    </li>`;
}

/* ---- deck search: by legend or by any card in the list */
const normDeckName = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const deckQuery = () => normDeckName(D.q).length >= 2 ? normDeckName(D.q) : '';
function deckNameIndex() {
  if (D.nameIdx) return D.nameIdx;
  const m = new Map(); // name -> {name, legend, ids[]}
  for (const [id, c] of Object.entries(D.rb)) {
    if (!c.n) continue;
    const base = c.n.replace(/\s*\([^)]*\)\s*$/, ''); // "Jinx - Loose Cannon (Metal Promo)" -> one entry
    const k = normDeckName(base), e = m.get(k) || { name: base, legend: false, ids: [] };
    e.ids.push(id); if (c.t === 'Legend') e.legend = true; m.set(k, e);
  }
  return (D.nameIdx = m);
}
function renderDeckSearch() {
  const q = deckQuery(), idx = deckNameIndex();
  // suggestions: legends first, then cards; names starting with the text first
  const hits = [...idx.entries()].filter(([k]) => k.includes(q))
    .sort((a, b) => (b[1].legend - a[1].legend) || (b[0].startsWith(q) - a[0].startsWith(q)) || a[0].localeCompare(b[0]));
  const exact = idx.get(q);
  $('#dk-sug').innerHTML = exact ? `<button class="on" data-clear="1">${exact.legend ? 'Legend' : 'Card'}: ${esc(exact.name)} ✕</button>`
    : hits.slice(0, 10).map(([, e]) => `<button data-name="${esc(e.name)}">${e.legend ? '<b>Legend</b> · ' : ''}${esc(e.name)}</button>`).join('');
  const ids = new Set((exact ? [exact] : hits.map(([, e]) => e)).flatMap((e) => e.ids));
  const isLeg = (id) => D.rb[id]?.t === 'Legend';
  const all = ranked(); const out = [];
  for (const a of all) {
    const legHit = ids.has(a.leader) || (!exact && normDeckName(a.name).includes(q)) || (exact && exact.legend && normDeckName(a.name).startsWith(normDeckName(exact.name)));
    let why = '', score = 0;
    if (legHit) { why = '<b>Legend</b>'; score = 3; }
    const uses = [];
    if (a.list) {
      for (const [zone, z] of [['main', a.list.main || {}], ['side', a.list.side || {}]]) for (const [id, n] of Object.entries(z)) {
        if (ids.has(id) && !isLeg(id)) uses.push(`${n}× ${esc(D.rb[id]?.n || id)}${zone === 'side' ? ' (sideboard)' : ''}`);
      }
    } else for (const k of a.key || []) if (ids.has(k.id) || (!exact && normDeckName(k.n).includes(q))) uses.push(`${k.x || ''}× ${esc(k.n)} <span class="flat">(${Math.round((k.w || 0) * 100)}% of lists)</span>`);
    if (uses.length) { why = (why ? why + ' · ' : '') + 'Runs ' + uses.slice(0, 3).join(', ') + (uses.length > 3 ? ` +${uses.length - 3} more` : ''); score = Math.max(score, uses.some((u) => !u.includes('sideboard')) ? 2 : 1); }
    if (score) out.push({ a, why, score });
  }
  out.sort((x, y) => (y.score - x.score) || ((x.a.pos ?? x.a.rank) - (y.a.pos ?? y.a.rank)));
  const mine = MD.decks.filter((dk) => [dk.leader, ...Object.keys(dk.main || {}), ...Object.keys(dk.side || {})].some((id) => ids.has(id)));
  const days = { '30d': '30', '14d': '14', '7d': '7' }[D.win] || '30';
  const label = exact ? esc(exact.name) : `“${esc(D.q.trim())}”`;
  $('#dk-info').innerHTML = out.length || mine.length
    ? `${out.length} meta deck${out.length === 1 ? '' : 's'} with ${label} (last ${days} days), strongest first.${exact ? '' : ' Tap a name above to narrow it down.'}`
    : `No decks found with ${label}.${hits.length && !exact ? ' Try one of the names above.' : ''}`;
  let html = out.map((o) => deckRowHTML(o.a, o.why)).join('');
  if (mine.length) {
    html += '<li class="dsec" style="list-style:none">My decks</li>' + mine.map((dk) => {
      const leg = cardRef(D.rb[dk.leader]?.n || '');
      return `<li class="item" data-mydeck="${esc(dk.id)}">${img(leg && leg.img)}<div class="info"><div class="nm">${esc(dk.name)}</div><div class="meta">${esc(D.rb[dk.leader]?.n || '')}</div></div></li>`;
    }).join('');
  }
  $('#dk-list').innerHTML = html || '<li class="empty">Nothing matches yet.</li>';
}

/** YouTube search for guides on this legend's deck (no hand-curated links to go stale) */
function guideURL(a) { const champ = a.name.split(' - ')[0]; return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`Riftbound ${champ} deck guide`); }
function openDeck(slug) { pushSheet(() => renderDeck(slug)); }
function renderDeck(slug) {
  const a = findArch(slug); if (!a) return;
  const leg = cardRef(D.rb[a.leader]?.n || a.name);
  const b = a.best;
  const when = b && b.date ? new Date(b.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  let html = `<div class="detail">
    ${leg ? `<img class="detail-img" style="width:44%" src="${esc(bigImg(leg.img))}" onerror="this.onerror=null;this.src='${esc(leg.img)}'" alt="">` : ''}
    <h2>${a.tier ? `<span class="tier ${esc(a.tier)}">${esc(a.tier)}</span>` : ''}${esc(a.name)}</h2>
    <div class="sub">${domTags(a.colors)} Strength rank #${a.pos ?? a.rank} · last ${{ '30d': 30, '14d': 14, '7d': 7 }[D.win] || 30} days</div>
    <div class="kv">
      <div><span class="label">Win rate</span><b>${pctTxt(a.winrate)}</b><small class="sub">${a.winrateN ? a.winrateN.toLocaleString() + ' matches' : ''}</small></div>
      <div><span class="label">Top-8 rate</span><b>${pctTxt(a.top8)}</b></div>
      <div><span class="label">Top-25% rate</span><b>${pctTxt(a.topq)}</b></div>
      <div><span class="label">Meta share</span><b>${a.share}%</b><small class="sub">${(a.decks || 0).toLocaleString()} decks</small></div>
    </div>`;
  if (!a.list) {
    html += `<p class="sub">No full decklist has been published for this legend yet.</p>
      ${a.key && a.key.length ? `<div class="dsec">Key cards</div><ul class="dl">${a.key.map((k) => `<li><span class="cnt">${k.x || ''}×</span><span class="nm">${esc(k.n)}</span><span class="st">${Math.round((k.w || 0) * 100)}% of lists</span></li>`).join('')}</ul>` : ''}</div>`;
    $('#sheet-content').innerHTML = html; return;
  }
  const an = analyzeDeck(a, { legal: (D.deckMode || 'list') === 'mine' });
  const mode = D.deckMode || 'list';
  const dbans = deckBans(a);
  if (dbans.length) html += `<div class="card-box banbox"><b>${dbans.every((x) => x.b.state === 'soon') ? '⚠ This list has cards being banned' : '⛔ This list has banned cards'}</b>
    <div class="sub">${dbans.map((x) => `${esc(x.n)} (${x.b.state === 'soon' ? 'from ' + esc(shortDate(x.b.effective)) : 'banned'})`).join(' · ')}. The stats come from tournaments played before the ban. Use <b>My version</b> or save it to My decks to replace them.</div></div>`;
  html += `${b ? `<p class="sub">${a.listFrom30 ? 'Best list from the last 30 days: ' : 'List: '}<b>${ordinal(b.place)} of ${b.players}</b> · ${esc(b.event)}${b.record ? ' · ' + esc(b.record) : ''}${when ? ' · ' + when : ''}</p>` : ''}
    <div class="card-box">
      <b>You own ${an.mainHave} of ${an.mainTotal} main-deck cards</b> (${Math.round(an.pct * 100)}% of the whole list)
      <div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>
      <div class="sub" style="margin-top:6px">${an.costMain > 0 ? `Missing cards cost about <b>${money(an.costMain)}</b> (cheapest printings)${an.cost > an.costMain ? `, ${money(an.cost)} with sideboard` : ''}.` : 'You have everything for the main deck. 🎉'}</div>
      <div class="row" style="margin-top:10px;gap:8px">${an.cost > 0 ? '<button class="ghost sm" id="dk-wish2">♡ Wishlist what I\'m missing</button>' : ''}<a class="ghost sm btnlink" href="${esc(guideURL(a))}" target="_blank" rel="noopener">▶ Video guides</a></div>
    </div>
    <div class="seg" id="dk-mode"><button data-m="list" class="${mode === 'list' ? 'on' : ''}">Tournament list</button><button data-m="mine" class="${mode === 'mine' ? 'on' : ''}">My version</button><button data-m="buy" class="${mode === 'buy' ? 'on' : ''}">Buy list</button></div>`;

  if (mode === 'list') {
    for (const [sec, title] of SECTION_ORDER) {
      const ls = an.lines.filter((l) => l.sec === sec); if (!ls.length) continue;
      html += `<div class="dsec">${title} (${ls.reduce((t, l) => t + l.cnt, 0)})</div><ul class="dl">` + ls.map(lineHTML).join('') + '</ul>';
    }
    if (an.side.length) html += `<div class="dsec">Sideboard (${an.side.reduce((t, l) => t + l.cnt, 0)})</div><ul class="dl">` + an.side.map(lineHTML).join('') + '</ul>';
    html += '<div class="row" style="margin-top:10px"><button class="ghost" id="dk-export">Copy deck list</button></div><p class="sub">Plain text list (e.g. <i>3 Defy</i>) — pastes into riftbound.gg, other deck builders, Discord, or this app\'s Import list.</p>';
    if ((a.mu || []).length) {
      const mu = a.mu.slice().sort((x, y) => (y.n || 0) - (x.n || 0)).slice(0, 12);
      html += `<div class="dsec">Matchups (last ${{ '30d': 30, '14d': 14, '7d': 7 }[D.win] || 30} days)</div><ul class="dl">` + mu.map((m) => `<li ${findArch(m.slug) ? `data-deck="${esc(m.slug)}"` : ''}><span class="nm">vs ${esc(m.vs)}<small>${(m.n || 0).toLocaleString()} matches</small></span><span class="st"><b class="${m.wr >= 0.5 ? 'pos' : 'neg'}">${Math.round(m.wr * 100)}%</b></span></li>`).join('') + '</ul>';
    }
  } else if (mode === 'mine') {
    if (!an.subs.length) html += '<p class="sub">Nothing to swap — you own every card in this list.</p>';
    else {
      html += '<p class="sub">Swaps from your own cards for what you\'re missing (and for any banned cards), chosen by how often they appear in winning lists of the same domains, then closest cost.</p><ul class="dl">';
      for (const sb of an.subs) {
        const m = sb.miss;
        html += `<li${m.banned ? ' class="banned"' : ''}><span class="cnt no">−${m.miss}</span><span class="nm">${esc(m.c.n)}${m.banned ? banTag(m.c.n) : ''}<small>${esc(m.sec)}${m.c.c != null ? ' · ' + m.c.c + ' energy' : ''}</small></span><span class="st">${m.banned ? '<span class="no">replace</span>' : money(cardPrice(m.c.n)?.m)}</span></li>`;
        for (const p of sb.picks) html += `<li class="sub-line">↳ play <b>${p.take}× ${esc(p.c.n)}</b> (you own it${p.c.c != null ? ' · ' + p.c.c + ' energy' : ''}${D.pop[p.id] ? ' · in ' + Math.round(D.pop[p.id] / D.nLists * 100) + '% of top lists' : ''})</li>`;
        if (sb.still > 0) html += sb.buy
          ? `<li class="sub-line">↳ still short ${sb.still} — budget pick: <b>${esc(sb.buy.c.n)}</b> ${money(sb.buy.p.m)}</li>`
          : `<li class="sub-line">↳ still short ${sb.still} — ${m.banned ? 'no legal substitute found' : 'no owned substitute; get the original'}</li>`;
      }
      html += '</ul>';
    }
  } else {
    const buy = an.lines.concat(an.side).filter((l) => l.miss > 0);
    if (!buy.length) html += '<p class="sub">Nothing to buy.</p>';
    else {
      html += '<ul class="dl">' + buy.map((l) => { const p = cardPrice(l.c.n), r = cardRef(l.c.n); return `<li data-card="${esc(r ? r.k : '')}"><span class="cnt">${l.miss}×</span><span class="nm">${esc(l.c.n)}<small>${l.sec === 'Side' ? 'Sideboard' : esc(l.sec)}</small></span><span class="st">${p ? money(p.m * l.miss) : '—'}</span></li>`; }).join('') + '</ul>';
      html += `<div class="row"><button class="ghost" id="dk-copy">Copy list</button><button class="ghost" id="dk-wish">♡ Add all to wishlist</button></div><p class="sub">Copy list, then paste it into <a href="https://www.tcgplayer.com/massentry" target="_blank" rel="noopener">TCGplayer Mass Entry ↗</a> to buy everything at once.</p>`;
    }
  }
  html += `<button class="primary ghost" id="dk-save" style="width:100%;padding:13px;margin-top:14px">Save to My decks</button>
    <p><a href="https://riftbound.gg/decks/${esc(b.slug)}/" target="_blank" rel="noopener">View this list on riftbound.gg ↗</a></p></div>`;
  $('#sheet-content').innerHTML = html;
  $$('#dk-mode button').forEach((x) => x.onclick = () => { D.deckMode = x.dataset.m; renderDeck(slug); });
  const sv = $('#dk-save'); if (sv) sv.onclick = () => saveMetaToMine(a);
  const wishMissing = () => {
    let n = 0; for (const l of an.lines.concat(an.side)) { if (l.miss <= 0) continue; const r = cardRef(l.c.n); if (!r) continue; const w = WL.items[r.k] || { qty: 0, added: Date.now() }; w.qty = Math.max(w.qty, l.miss); w.note = w.note || a.name.split(' - ')[0] + ' deck'; WL.items[r.k] = w; n++; }
    saveWL(); toast(`${n} card${n === 1 ? '' : 's'} added to your wishlist`);
  };
  const wb = $('#dk-wish'); if (wb) wb.onclick = wishMissing;
  const wb2 = $('#dk-wish2'); if (wb2) wb2.onclick = wishMissing;
  const ex = $('#dk-export');
  if (ex) ex.onclick = async () => {
    const lines = []; for (const [id, n] of Object.entries(a.list.main)) lines.push(`${n} ${D.rb[id]?.n || id}`);
    if (Object.keys(a.list.side || {}).length) { lines.push('', 'Sideboard'); for (const [id, n] of Object.entries(a.list.side)) lines.push(`${n} ${D.rb[id]?.n || id}`); }
    try { await navigator.clipboard.writeText(`${a.name}\n` + lines.join('\n')); toast('Deck list copied'); } catch { toast('Couldn\'t copy on this device'); }
  };
  const cp = $('#dk-copy');
  if (cp) cp.onclick = async () => {
    const txt = an.lines.concat(an.side).filter((l) => l.miss > 0).map((l) => `${l.miss} ${l.c.n}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Copied — paste into TCGplayer Mass Entry'); } catch { toast('Couldn\'t copy on this device'); }
  };
}
function lineHTML(l) {
  const p = cardPrice(l.c.n);
  const st = l.miss === 0 ? '<span class="ok">✓ own</span>' : l.have > 0 ? `<span class="part">own ${l.have}/${l.cnt}</span>` : '<span class="no">need</span>';
  const r = cardRef(l.c.n);
  return `<li data-card="${esc(r ? r.k : '')}"${banInfo(l.c.n) ? ' class="banned"' : ''}><span class="cnt">${l.cnt}×</span><span class="nm">${esc(l.c.n)}${banTag(l.c.n)}<small>${[l.c.t, l.c.c != null ? l.c.c + ' energy' : '', (l.c.d || []).join('/')].filter(Boolean).map(esc).join(' · ')}</small></span><span class="st">${st}<br><small class="sub">${money(p && p.m)}</small></span></li>`;
}
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function wireDecks() {
  D.win = S.prefs.deckWin || '30d';
  $('#dk-tab').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; D.tab = b.dataset.v; D.q = ''; $('#dk-q').value = ''; $('#dk-sug').innerHTML = ''; renderDecks(); };
  let qt;
  $('#dk-q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { D.q = e.target.value; if (!deckQuery()) $('#dk-sug').innerHTML = ''; renderDecks(); }, 180); };
  $('#dk-sug').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    D.q = b.dataset.clear ? '' : b.dataset.name; $('#dk-q').value = D.q;
    if (!D.q) $('#dk-sug').innerHTML = '';
    renderDecks(); if (!D.q) $('#dk-q').focus();
  };
  $('#dk-legal').onchange = (e) => { S.prefs.legalOnly = e.target.checked; savePrefs(); renderDecks(); };
  $('#dk-win').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; D.win = b.dataset.w; S.prefs.deckWin = D.win; savePrefs(); renderDecks(); };
}

/* ---------------------------------------------------------------- my decks (personal builds) */
const MD_KEY = 'rbt.mydecks.v1';
const MD = Object.assign({ decks: [] }, loadJSON(MD_KEY, {}));
const MDS = { q: '', type: 'all', zone: 'main' };
function saveMD() { try { localStorage.setItem(MD_KEY, JSON.stringify(MD)); } catch { toast('Could not save on this device'); } }
const mdGet = (id) => MD.decks.find((d) => d.id === id);
const isBaseId = (id) => /^[A-Z]+-\d+$/.test(id);
function mdArch(dk) {
  const leg = D.rb[dk.leader] || {};
  return { slug: 'my:' + dk.id, name: dk.name, leader: dk.leader, colors: leg.d || [], key: [], list: { main: dk.main, side: dk.side, leader: dk.leader } };
}
function mdCounts(dk) {
  const c = { main: 0, runes: 0, bf: 0, legend: 0, side: 0 };
  for (const [id, n] of Object.entries(dk.main)) {
    const t = D.rb[id]?.t;
    if (t === 'Rune') c.runes += n; else if (t === 'Battlefield') c.bf += n; else if (t === 'Legend') c.legend += n; else c.main += n;
  }
  for (const n of Object.values(dk.side)) c.side += n;
  return c;
}
function mdProblems(dk) {
  const c = mdCounts(dk), out = [];
  const leg = D.rb[dk.leader]; const colors = new Set([...(leg?.d || []), 'Colorless']); const tags = leg?.tg || [];
  if (c.main !== 40) out.push(`Main deck has ${c.main} of 40 cards`);
  if (c.runes !== 12) out.push(`${c.runes} of 12 runes`);
  if (c.bf !== 3) out.push(`${c.bf} of 3 battlefields`);
  const byName = new Map();
  for (const z of [dk.main, dk.side]) for (const [id, n] of Object.entries(z)) {
    const r = D.rb[id]; if (!r || r.t === 'Rune' || r.t === 'Legend') continue;
    byName.set(r.n, (byName.get(r.n) || 0) + n);
    if (!r.d.every((d) => colors.has(d))) out.push(`${r.n} is outside your legend's domains`);
  }
  for (const [n, k] of byName) if (k > 3) out.push(`${k} copies of ${n} (max 3)`);
  for (const id of [dk.leader, ...Object.keys(dk.main), ...Object.keys(dk.side)]) {
    const b = D.rb[id] && banInfo(D.rb[id].n);
    if (b && b.fmt === 'standard') out.push(`${D.rb[id].n} is ${b.state === 'banned' ? 'banned' : 'banned from ' + shortDate(b.effective)}`);
  }
  const champ = Object.keys(dk.main).some((id) => D.rb[id]?.st === 'Champion' && (D.rb[id].tg || []).some((t) => tags.includes(t)));
  if (!champ) out.push('No chosen champion yet (a champion unit of your legend)');
  return [...new Set(out)];
}

function renderMyDecksList() {
  $('#dk-info').innerHTML = 'Decks you build. Start from scratch, or open any meta deck and tap <b>Save to My decks</b> to copy it and tweak.';
  const rows = MD.decks.slice().sort((a, b) => b.updated - a.updated).map((dk) => {
    const a = mdArch(dk); const an = analyzeDeck(a); const c = mdCounts(dk); const leg = cardRef(D.rb[dk.leader]?.n || '');
    const ok = !mdProblems(dk).length;
    return `<li class="item" data-mydeck="${esc(dk.id)}">${img(leg && leg.img)}
      <div class="info"><div class="nm">${esc(dk.name)}</div>
      <div class="meta wrap">${domTags(a.colors)} ${c.main}/40 · ${c.runes}/12 runes · ${c.bf}/3 battlefields ${ok ? '<span class="ok">✓ legal</span>' : '<span class="part">in progress</span>'}</div>
      <div class="meta">You own ${Math.round(an.pct * 100)}% · ${an.costMain > 0 ? money(an.costMain) + ' to finish' : 'ready to play'}</div>
      <div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div></div></li>`;
  }).join('');
  $('#dk-list').innerHTML = `<li class="row" style="list-style:none;margin-bottom:10px"><button class="primary ghost" id="md-new" style="flex:2;padding:13px">＋ New deck</button><button class="ghost" id="md-import" style="flex:1">Import list</button></li>` +
    (rows || '<li class="empty">No decks yet. Tap <b>New deck</b> and pick a legend to start.</li>');
  $('#md-new').onclick = () => pushSheet(renderLegendPicker);
  $('#md-import').onclick = () => pushSheet(renderDeckImport);
}

function renderLegendPicker() {
  const q = (MDS.lq || '').toLowerCase();
  const strength = new Map(ranked().map((a) => [a.leader, a]));
  const legends = Object.entries(D.rb).filter(([id, c]) => c.t === 'Legend' && isBaseId(id) && (!q || c.n.toLowerCase().includes(q)))
    .sort((x, y) => (strength.get(x[0])?.pos ?? 999) - (strength.get(y[0])?.pos ?? 999) || x[1].n.localeCompare(y[1].n));
  $('#sheet-content').innerHTML = `<h2 style="margin:6px 0 10px">Pick a legend</h2>
    <div class="toolbar"><input id="lg-q" type="search" placeholder="Search legends" value="${esc(MDS.lq || '')}" autocomplete="off"></div>
    <ul class="list">${legends.map(([id, c]) => { const r = cardRef(c.n); const a = strength.get(id);
      return `<li class="item" data-pickleg="${esc(id)}">${img(r && r.img)}<div class="info"><div class="nm">${esc(c.n)}</div><div class="meta wrap">${domTags(c.d)}${a ? ` #${a.pos} · ${pctTxt(a.winrate)} wins` : ''}</div></div></li>`; }).join('')}</ul>`;
  const inp = $('#lg-q'); inp.oninput = () => { MDS.lq = inp.value; const pos = inp.selectionStart; renderLegendPicker(); const n = $('#lg-q'); n.focus(); n.setSelectionRange(pos, pos); };
  $$('#sheet [data-pickleg]').forEach((li) => li.onclick = () => {
    const id = li.dataset.pickleg, c = D.rb[id];
    const main = { [id]: 1 };
    // start with 12 runes split across the legend's two domains
    const runes = Object.entries(D.rb).filter(([rid, r]) => r.t === 'Rune' && isBaseId(rid) && r.d.length === 1 && c.d.includes(r.d[0]));
    const per = runes.length ? Math.floor(12 / Math.min(runes.length, c.d.length || 1)) : 0;
    const used = new Set();
    for (const [rid, r] of runes) if (!used.has(r.d[0]) && used.size < 2) { main[rid] = per; used.add(r.d[0]); }
    const dk = { id: Date.now().toString(36), name: c.n.split(' - ')[0] + ' deck', leader: id, main, side: {}, created: Date.now(), updated: Date.now() };
    MD.decks.push(dk); saveMD();
    SHEET[SHEET.length - 1] = () => renderMyDeck(dk.id); renderMyDeck(dk.id);
    $('#sheet .sheet-body').scrollTop = 0;
  });
}

function mdLine(dk, id, n, zone, an) {
  const c = D.rb[id] || { n: id }; const p = cardPrice(c.n); const r = cardRef(c.n);
  const l = an && an.all.find((x) => x.id === id && (zone === 'side' ? x.sec === 'Side' : x.sec !== 'Side'));
  const st = !l ? '' : l.miss === 0 ? '<span class="ok">✓ own</span>' : l.have > 0 ? `<span class="part">own ${l.have}/${l.cnt}</span>` : '<span class="no">need</span>';
  return `<li><span class="nm" data-card="${esc(r ? r.k : '')}">${esc(c.n)}<small>${[c.t, c.c != null ? c.c + ' energy' : '', (c.d || []).join('/')].filter(Boolean).map(esc).join(' · ')} · ${money(p && p.m)}</small></span>
    <span class="st">${st}</span>
    <span class="mstep"><button data-md="dec" data-id="${esc(id)}" data-zone="${zone}" aria-label="Remove one">−</button><b>${n}</b><button data-md="inc" data-id="${esc(id)}" data-zone="${zone}" aria-label="Add one">+</button></span></li>`;
}
function renderMyDeck(id) {
  const dk = mdGet(id); if (!dk) { closeSheet(); return; }
  const a = mdArch(dk); const an = analyzeDeck(a, { legal: true }); an.all = an.lines.concat(an.side);
  const c = mdCounts(dk); const probs = mdProblems(dk);
  const leg = cardRef(D.rb[dk.leader]?.n || '');
  const groups = {};
  for (const l of an.lines) { (groups[l.sec] = groups[l.sec] || new Map()).set(l.id, (groups[l.sec].get(l.id) || 0) + l.cnt); }
  let html = `<div class="detail">
    <div class="row" style="align-items:center;gap:12px">
      ${leg ? `<img src="${esc(leg.img)}" style="width:64px;border-radius:4px;box-shadow:0 0 0 1px var(--brass)" alt="">` : ''}
      <div style="flex:1;min-width:0"><input id="md-name" type="text" value="${esc(dk.name)}" aria-label="Deck name" style="width:100%;font:400 20px var(--display);color:#fff6dc">
      <div class="sub" style="margin-top:4px">${domTags(a.colors)} ${esc(D.rb[dk.leader]?.n || '')}</div></div>
    </div>
    <div class="card-box" style="margin-top:12px">
      <div class="row" style="justify-content:space-between"><b>${c.main}/40 main</b><b>${c.runes}/12 runes</b><b>${c.bf}/3 battlefields</b><b>${c.side} side</b></div>
      ${probs.length ? `<div class="sub" style="margin-top:6px">${probs.slice(0, 5).map((p) => '• ' + esc(p)).join('<br>')}</div>` : '<div class="ok" style="margin-top:6px">✓ Deck is complete and legal</div>'}
      <div class="sub" style="margin-top:8px">You own ${Math.round(an.pct * 100)}% of it${an.cost > 0 ? ` · missing cards about <b>${money(an.cost)}</b>` : ''}</div>
      <div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>
    </div>
    <div class="row"><button class="primary ghost" id="md-add" style="flex:1">＋ Add cards</button><button class="ghost" id="md-copy">Copy list</button></div>`;
  for (const [sec, title] of SECTION_ORDER) {
    const g = groups[sec]; if (!g || !g.size) continue;
    if (sec === 'Legend') { html += `<div class="dsec">Legend</div><ul class="dl"><li><span class="nm">${esc(D.rb[dk.leader]?.n || '')}</span><span class="st"><button class="ghost sm" id="md-chleg">Change</button></span></li></ul>`; continue; }
    html += `<div class="dsec">${title} (${[...g.values()].reduce((t, n) => t + n, 0)})</div><ul class="dl">` + [...g].map(([cid, n]) => mdLine(dk, cid, n, 'main', an)).join('') + '</ul>';
  }
  const sideIds = Object.entries(dk.side);
  html += `<div class="dsec">Sideboard (${c.side})</div><ul class="dl">${sideIds.length ? sideIds.map(([cid, n]) => mdLine(dk, cid, n, 'side', an)).join('') : '<li class="sub">Empty — use Add cards and choose Sideboard.</li>'}</ul>`;
  const subs = an.subs.filter((s) => s.picks.length);
  if (subs.length) html += `<div class="dsec">Swaps from your collection</div><ul class="dl">` + subs.map((sb) => `<li class="sub-line">for ${sb.miss.miss}× <b style="color:var(--text)">${esc(sb.miss.c.n)}</b>, you could play ${sb.picks.map((p) => `<b>${p.take}× ${esc(p.c.n)}</b>`).join(', ')}</li>`).join('') + '</ul>';
  html += `<div class="row" style="margin-top:16px"><button class="ghost" id="md-dup">Duplicate</button><button class="danger" id="md-del">Delete deck</button></div></div>`;
  $('#sheet-content').innerHTML = html;
  $$('#sheet-content .detail [data-md]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const body = $('#sheet .sheet-body'), y = body.scrollTop;
    mdBump(id, b.dataset.id, b.dataset.zone, b.dataset.md === 'inc' ? 1 : -1);
    renderMyDeck(id); body.scrollTop = y;
  });
  $('#md-name').onchange = (e) => { dk.name = e.target.value.trim() || dk.name; dk.updated = Date.now(); saveMD(); };
  $('#md-add').onclick = () => pushSheet(() => renderMdAdd(id));
  const ch = $('#md-chleg'); if (ch) ch.onclick = () => pushSheet(() => renderLegendSwap(id));
  $('#md-copy').onclick = async () => {
    const lines = []; for (const [cid, n] of Object.entries(dk.main)) lines.push(`${n} ${D.rb[cid]?.n || cid}`);
    if (sideIds.length) { lines.push('', 'Sideboard'); for (const [cid, n] of sideIds) lines.push(`${n} ${D.rb[cid]?.n || cid}`); }
    try { await navigator.clipboard.writeText(`${dk.name}\n` + lines.join('\n')); toast('Deck list copied'); } catch { toast('Couldn\'t copy on this device'); }
  };
  $('#md-dup').onclick = () => { const cp = { ...structuredClone(dk), id: Date.now().toString(36), name: dk.name + ' (copy)', created: Date.now(), updated: Date.now() }; MD.decks.push(cp); saveMD(); toast('Duplicated'); SHEET[SHEET.length - 1] = () => renderMyDeck(cp.id); renderMyDeck(cp.id); };
  $('#md-del').onclick = async () => { if (await confirmBox(`Delete "${dk.name}"?`)) { MD.decks = MD.decks.filter((d) => d.id !== id); saveMD(); closeSheet(); } };
}
function renderLegendSwap(id) {
  const dk = mdGet(id);
  MDS.lq = '';
  renderLegendPicker();
  $$('#sheet [data-pickleg]').forEach((li) => li.onclick = () => {
    delete dk.main[dk.leader]; dk.leader = li.dataset.pickleg; dk.main[dk.leader] = 1; dk.updated = Date.now(); saveMD(); sheetBack();
  });
  $('#sheet-content h2').textContent = 'Change legend';
}
function mdBump(id, cid, zone, d) {
  const dk = mdGet(id); const z = zone === 'side' ? dk.side : dk.main;
  z[cid] = (z[cid] || 0) + d; if (z[cid] <= 0) delete z[cid];
  dk.updated = Date.now(); saveMD();
}
function renderMdAdd(id) {
  const dk = mdGet(id); if (!dk) return;
  const leg = D.rb[dk.leader]; const colors = new Set([...(leg?.d || []), 'Colorless']);
  const types = [['all', 'Deck cards'], ['Unit', 'Units'], ['Spell', 'Spells'], ['Gear', 'Gear'], ['Battlefield', 'Battlefields'], ['Rune', 'Runes']];
  $('#sheet-content').innerHTML = `<h2 style="margin:6px 0 10px">Add to ${esc(dk.name)}</h2>
    <div class="toolbar"><input id="mda-q" type="search" placeholder="Card name" value="${esc(MDS.q)}" autocomplete="off"></div>
    <div class="chips" id="mda-type">${types.map(([v, l]) => `<button data-t="${v}" class="${MDS.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg" id="mda-zone"><button data-z="main" class="${MDS.zone === 'main' ? 'on' : ''}">Main deck</button><button data-z="side" class="${MDS.zone === 'side' ? 'on' : ''}">Sideboard</button></div>
    <div class="row"><label class="toggle small"><input type="checkbox" id="mda-owned" ${MDS.owned ? 'checked' : ''}> Only cards I own</label>
    <label class="toggle small"><input type="checkbox" id="mda-text" ${MDS.text ? 'checked' : ''}> Search card text</label></div>
    <p class="sub" id="mda-sum"></p>
    <ul class="dl" id="mda-list"></ul>`;
  const draw = () => {
    const q = MDS.q.toLowerCase().trim(); const owned = ownedCountByName(); const terms = searchTerms(q);
    const hit = (c) => { if (!q) return true; if (!MDS.text) return c.n.toLowerCase().includes(q); const tx = textOf(c.n); const full = `${c.n} ${tx ? tx.text + ' ' + tx.extra : ''}`.toLowerCase(); return terms.every((t) => full.includes(t)); };
    const res = Object.entries(D.rb).filter(([cid, c]) => isBaseId(cid) && c.n && !c.b && c.t !== 'Legend' && c.st !== 'Token' && (c.t === 'Rune' ? c.d.some((x) => colors.has(x)) : c.d.every((x) => colors.has(x)))
      && (MDS.type === 'all' ? ['Unit', 'Spell', 'Gear'].includes(c.t) : c.t === MDS.type) && ['Unit', 'Spell', 'Gear', 'Battlefield', 'Rune'].includes(c.t)
      && hit(c) && (!MDS.owned || owned.get(normName(c.n))))
      .map(([cid, c]) => ({ cid, c, pop: D.pop[cid] || 0 }))
      .sort((x, y) => (y.pop - x.pop) || ((x.c.c ?? 99) - (y.c.c ?? 99)) || x.c.n.localeCompare(y.c.n)).slice(0, 150);
    const z = MDS.zone === 'side' ? dk.side : dk.main; const cnt = mdCounts(dk);
    $('#mda-sum').innerHTML = `${cnt.main}/40 main · ${cnt.runes}/12 runes · ${cnt.bf}/3 battlefields · ${cnt.side} side — most-played cards first`;
    $('#mda-list').innerHTML = res.map(({ cid, c }) => { const own = owned.get(normName(c.n)) || 0; const p = cardPrice(c.n);
      const sn = MDS.text && q ? snippet(textOf(c.n)?.text || '', terms) : '';
      return `<li><span class="nm">${esc(c.n)}<small>${[c.t, c.c != null ? c.c + ' energy' : '', c.d.join('/')].filter(Boolean).map(esc).join(' · ')} · ${money(p && p.m)}${own ? ` · <span class="ok">own ${own}</span>` : ''}</small>${sn}</span>
        <span class="mstep"><button data-md="dec" data-id="${esc(cid)}" aria-label="Remove one">−</button><b>${z[cid] || 0}</b><button data-md="inc" data-id="${esc(cid)}" aria-label="Add one">+</button></span></li>`; }).join('') || '<li class="sub">No matching cards for this legend.</li>';
  };
  draw();
  const inp = $('#mda-q'); let t; inp.oninput = () => { MDS.q = inp.value; clearTimeout(t); t = setTimeout(draw, 120); };
  $('#mda-type').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; MDS.type = b.dataset.t; $$('#mda-type button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  $('#mda-zone').onclick = (e) => { const b = e.target.closest('[data-z]'); if (!b) return; MDS.zone = b.dataset.z; $$('#mda-zone button').forEach((x) => x.classList.toggle('on', x === b)); draw(); };
  $('#mda-owned').onchange = (e) => { MDS.owned = e.target.checked; draw(); };
  $('#mda-text').onchange = async (e) => { MDS.text = e.target.checked; if (MDS.text) { try { await loadCardText(); } catch { toast('Card text isn\'t available yet'); } } draw(); };
  if (MDS.text && !TXT.byName) loadCardText().then(draw, () => {});
  $('#mda-list').onclick = (e) => { const b = e.target.closest('[data-md]'); if (!b) return; mdBump(id, b.dataset.id, MDS.zone, b.dataset.md === 'inc' ? 1 : -1); draw(); };
}
async function saveMetaToMine(a) {
  const dk = { id: Date.now().toString(36), name: a.name.split(' - ')[0] + ' (from meta)', leader: a.list.leader || a.leader, main: { ...a.list.main }, side: { ...(a.list.side || {}) }, created: Date.now(), updated: Date.now() };
  const banned = Object.keys(dk.main).filter((id) => D.rb[id] && D.rb[id].t !== 'Legend' && bannedForMe(D.rb[id].n));
  if (banned.length && await confirmBox(`This list has ${banned.length} banned card${banned.length === 1 ? '' : 's'} (${banned.map((id) => D.rb[id].n).join(', ')}). Swap ${banned.length === 1 ? 'it' : 'them'} for the suggested replacements?`)) {
    const an = analyzeDeck(a, { legal: true });
    for (const sb of an.subs.filter((x) => x.miss.banned)) {
      delete dk.main[sb.miss.id];
      for (const p of sb.picks) dk.main[p.id] = (dk.main[p.id] || 0) + p.take;
      if (sb.still > 0 && sb.buy) dk.main[sb.buy.id] = (dk.main[sb.buy.id] || 0) + sb.still;
    }
  }
  MD.decks.push(dk); saveMD(); toast('Saved to My decks — tweak away');
  pushSheet(() => renderMyDeck(dk.id));
}

/* ---------------------------------------------------------------- events */
const EV_KEY = 'rbt.events.v1';
const EV = Object.assign({ events: [] }, loadJSON(EV_KEY, {}));
const EVS = { tab: 'news', up: null, news: null, nf: 'all' };
const EV_TYPES = ['Nexus Night', 'Summoner Skirmish', 'Pre-Rift', 'Showdown Series', 'Regional Qualifier', 'Regional', 'Regional Championship', 'Continental', 'Store tournament', 'Casual / other'];
const BIG = new Set(['Showdown Series', 'Regional Qualifier', 'Regional', 'Regional Championship', 'Continental']);
function saveEV() { try { localStorage.setItem(EV_KEY, JSON.stringify(EV)); } catch { toast('Could not save on this device'); } }
const evGet = (id) => EV.events.find((e) => e.id === id);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function evRecord(e) { const r = { W: 0, L: 0, D: 0 }; for (const x of e.rounds || []) if (r[x.res] != null) r[x.res]++; return r; }
const recTxt = (r) => `${r.W}-${r.L}${r.D ? '-' + r.D : ''}`;
function dateBox(iso) {
  if (!iso) return '<div class="date"><b>?</b><small>TBD</small></div>';
  const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d);
  return `<div class="date"><b>${d}</b><small>${dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</small></div>`;
}
const deckLabel = (e) => e.deckId ? (MD.decks.find((d) => d.id === e.deckId)?.name || e.deckName || '') : (e.deckName || '');

async function renderEvents() {
  $$('#ev-tab button').forEach((b) => b.classList.toggle('on', b.dataset.v === EVS.tab));
  if (EVS.tab === 'upcoming') return renderUpcoming();
  if (EVS.tab === 'news') return renderNews();
  const body = $('#ev-body'); const today = todayISO();
  setTimeout(() => { if (EVS.tab === 'mine' && typeof MT !== 'undefined' && MT.list.length) body.insertAdjacentHTML('afterbegin', matchupHTML()); }, 0);
  const up = EV.events.filter((e) => (e.date || '9999') >= today).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const past = EV.events.filter((e) => e.date && e.date < today).sort((a, b) => b.date.localeCompare(a.date));
  // overall stats
  const tot = { W: 0, L: 0, D: 0 }; const byLeg = new Map(); const byDeck = new Map(); let best = null;
  for (const e of EV.events) {
    const r = evRecord(e); tot.W += r.W; tot.L += r.L; tot.D += r.D;
    const dl = deckLabel(e); if (dl && (r.W + r.L + r.D)) { const x = byDeck.get(dl) || { W: 0, L: 0, D: 0 }; x.W += r.W; x.L += r.L; x.D += r.D; byDeck.set(dl, x); }
    for (const rd of e.rounds || []) if (rd.leg) { const x = byLeg.get(rd.leg) || { W: 0, L: 0, D: 0 }; x[rd.res]++; byLeg.set(rd.leg, x); }
    if (e.place && e.players && (!best || e.place / e.players < best.place / best.players)) best = e;
  }
  const games = tot.W + tot.L + tot.D;
  const pctW = (r) => { const n = r.W + r.L + r.D; return n ? Math.round(r.W / n * 100) + '%' : '—'; };
  const row = (e) => { const r = evRecord(e); const n = r.W + r.L + r.D;
    return `<li class="item evrow" data-ev="${esc(e.id)}">${dateBox(e.date)}<div class="info">
      <div class="nm">${esc(e.name || 'Event')}</div>
      <div class="meta wrap">${e.type ? `<span class="evtype ${BIG.has(e.type) ? 'big' : ''}">${esc(e.type)}</span>` : ''}${esc(e.loc || '')}</div>
      <div class="meta">${[deckLabel(e) && '🃏 ' + deckLabel(e), n ? 'Record ' + recTxt(r) : '', e.place ? `${ordinal(+e.place)}${e.players ? ' of ' + e.players : ''}` : ''].filter(Boolean).map(esc).join(' · ') || '<span class="flat">No results yet</span>'}</div>
    </div></li>`; };
  body.innerHTML = `
    <button class="primary ghost" id="ev-new" style="width:100%;padding:13px;margin-bottom:12px">＋ Add event</button>
    ${EV.events.length ? `<div class="card-box"><div class="statgrid">
      <div><b>${EV.events.filter((e) => (e.rounds || []).length || e.place).length}</b><span>events played</span></div>
      <div><b>${recTxt(tot)}</b><span>match record</span></div>
      <div><b>${games ? Math.round(tot.W / games * 100) + '%' : '—'}</b><span>match wins</span></div></div>
      ${best ? `<p class="sub" style="margin:10px 0 0">Best finish: <b>${ordinal(+best.place)} of ${best.players}</b> at ${esc(best.name)}</p>` : ''}
      ${byDeck.size ? `<p class="sub" style="margin:6px 0 0">By deck: ${[...byDeck].sort((a, b) => (b[1].W + b[1].L) - (a[1].W + a[1].L)).slice(0, 3).map(([k, r]) => `${esc(k)} <b>${recTxt(r)}</b> (${pctW(r)})`).join(' · ')}</p>` : ''}
      ${byLeg.size ? `<p class="sub" style="margin:6px 0 0">Vs. legends: ${[...byLeg].sort((a, b) => (b[1].W + b[1].L + b[1].D) - (a[1].W + a[1].L + a[1].D)).slice(0, 4).map(([k, r]) => `${esc(k.split(' - ')[0])} <b>${recTxt(r)}</b>`).join(' · ')}</p>` : ''}
    </div>` : ''}
    <p class="sub howto">To fill in your record: open an event below and tap <b>＋ Add round</b> for each match (win, loss or draw, and their legend). Finishing a game on the <b>Score</b> screen also offers to add it to today's event.</p>
    <h2>Coming up</h2>
    <ul class="list">${up.map(row).join('') || '<li class="empty">Nothing scheduled. Add an event, or pick one from <b>Upcoming</b>.</li>'}</ul>
    <h2>Results</h2>
    <ul class="list">${past.map(row).join('') || '<li class="empty">Past events and your results will show here.</li>'}</ul>`;
  $('#ev-new').onclick = () => { const e = newEvent({}); pushSheet(() => renderEvent(e.id)); };
}
const kPrize = (v) => v >= 1000 ? '$' + (v % 1000 ? (v / 1000).toFixed(1) : v / 1000) + 'k' : '$' + v;
const unixDay = (t) => new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
function unixBox(t) { const d = new Date(t * 1000); return `<div class="date"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</small></div>`; }
async function newsTopHTML() {
  if (!BAN.data) await loadBans();
  if (!EVS.rel) { try { EVS.rel = await (await fetch('data/releases.json', { cache: 'no-cache' })).json(); } catch { EVS.rel = { releases: [] }; } }
  let h = '';
  const a = (BAN.data.announcements || [])[0];
  if (a) {
    const pending = a.effective && a.effective > todayISO();
    const cardsHTML = (a.cards || []).map((c) => { const r = cardRef(c.name); return `<li class="banc" ${r ? `data-k="${esc(r.k)}"` : ''}>${img(r && r.img)}<span>${esc(c.name)}</span></li>`; }).join('');
    h += `<h2>Ban list</h2><div class="card-box newsban">
      <div class="nm" style="white-space:normal">${esc(a.title)}</div>
      <div class="meta wrap"><span class="evtype big">${pending ? 'Takes effect ' + esc(shortDate(a.effective)) : 'In effect'}</span> Announced ${esc(shortDate(a.announced))} · ${(a.formats || []).map((f) => f === '2v2' ? '2v2' : 'Standard').join(' & ')}</div>
      ${a.summary ? `<p class="sub" style="margin:8px 0">${esc(a.summary)}</p>` : ''}
      ${a.incomplete ? '<p class="sub">Some names in this announcement couldn\'t be matched to cards — check Riot\'s article for the full list.</p>' : ''}
      ${a.review ? '<p class="sub">The card list for this announcement is being checked — see Riot\'s article for details.</p>' : `<ul class="banlist">${cardsHTML}</ul>`}
      <div class="row" style="justify-content:space-between;margin-top:8px"><a class="sub" href="${esc(a.url)}" target="_blank" rel="noopener">Read Riot's announcement ↗</a><button class="ghost sm" id="ban-all">Full ban list</button></div>
    </div>`;
  }
  const pvN = typeof previewCards === 'function' ? previewCards().length : 0;
  if (pvN) h += `<div class="card-box" style="display:flex;justify-content:space-between;align-items:center"><span>✨ <b>${pvN} new cards revealed</b> for upcoming sets</span><button class="ghost sm" id="news-prev">See them</button></div>`;
  const rel = (EVS.rel.releases || []).filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || r.date >= todayISO());
  if (rel.length) {
    h += '<h2>Upcoming releases</h2><ul class="list rel">' + rel.map((r) => {
      const exact = /^\d{4}-\d{2}-\d{2}$/.test(r.date);
      const d = exact ? new Date(r.date + 'T12:00:00') : null;
      const days = d ? Math.ceil((d - new Date()) / 86400000) : null;
      const pr = r.prerift ? r.prerift.split('/').map(shortDate).join('–') : '';
      return `<li class="item evrow"><a href="${esc(r.url)}" target="_blank" rel="noopener" style="display:contents;color:inherit;text-decoration:none">
        ${d ? `<div class="date"><b>${d.getDate()}</b><small>${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</small></div>` : `<div class="date"><b style="font-size:15px">${esc(r.date.split('-')[1] || '')}</b><small>${esc(r.date.split('-')[0])}</small></div>`}
        <div class="info"><div class="nm" style="white-space:normal">${esc(r.name)}</div>
        <div class="meta wrap">${esc(r.kind || '')}${days != null ? ` · <b>${days} day${days === 1 ? '' : 's'} away</b>` : ''}</div>
        ${pr || r.previews ? `<div class="meta wrap">${pr ? 'Pre-Rift ' + esc(pr) : ''}${pr && r.previews ? ' · ' : ''}${r.previews ? 'Previews: ' + esc(r.previews) : ''}</div>` : ''}
        ${r.cards || r.products ? `<div class="meta wrap flat">${[r.cards, r.products].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
        </div></a></li>`;
    }).join('') + '</ul>';
  }
  return h;
}
function renderBanList() {
  const groups = { standard: [], '2v2': [] };
  for (const [, e] of BAN.byKey) for (const f of Object.keys(e.fmt)) groups[f].push({ n: e.name, ...e.fmt[f] });
  const today = todayISO();
  const block = (title, arr) => arr.length ? `<div class="dsec">${title} (${arr.length})</div><ul class="dl">` + arr.sort((x, y) => (y.effective || '').localeCompare(x.effective || '') || x.n.localeCompare(y.n)).map((x) => {
    const r = cardRef(x.n);
    return `<li ${r ? `data-card="${esc(r.k)}"` : ''}><span class="nm">${esc(x.n)}<small>${esc(D.rb && r ? (D.rb[Object.keys(D.rb).find((id) => banKey(D.rb[id].n) === banKey(x.n))]?.t || '') : '')}</small></span><span class="st">${x.effective > today ? '<span class="part">from ' + esc(shortDate(x.effective)) + '</span>' : '<span class="no">since ' + esc(shortDate(x.effective)) + '</span>'}</span></li>`;
  }).join('') + '</ul>' : '';
  const only2 = groups['2v2'].filter((x) => !groups.standard.some((y) => banKey(y.n) === banKey(x.n)));
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Ban list</h2><p class="sub">Every card banned in Riftbound Constructed, newest first. Banned cards are also marked across the app — in your collection, card pages and deck lists. This list updates itself when Riot announces new bans.</p>
    ${block('Standard (also 2v2)', groups.standard)}${block('2v2 only', only2)}
    <p class="sub">Official list: <a href="${esc(BAN.data.rulesHub || 'https://playriftbound.com/en-us/rules-hub/')}" target="_blank" rel="noopener">Riftbound Rules Hub ↗</a></p></div>`;
}
async function renderNews() {
  const body = $('#ev-body');
  if (!EVS.news) {
    body.innerHTML = '<p class="sub">Loading…</p>';
    try { EVS.news = await (await fetch('data/news.json')).json(); } catch { EVS.news = { events: [], headlines: [] }; }
    try { await loadDecks(); } catch { /* deck links optional */ }
  }
  const N = EVS.news; const evs = (N.events || []).filter((e) => EVS.nf === 'all' || (EVS.nf === 'prize' ? e.prize >= 5000 : true));
  const place = (p) => p === 1 ? '<span class="plc g">1st</span>' : p === 2 ? '<span class="plc s">2nd</span>' : p <= 4 ? `<span class="plc b">${ordinal(p)}</span>` : `<span class="plc">${p <= 8 ? 'Top 8' : ordinal(p)}</span>`;
  const resRow = (r) => {
    const inApp = r.arch && D.data && findArch(r.arch);
    return `<li class="nres" ${inApp ? `data-arch="${esc(r.arch)}"` : ''}>${place(r.place)}<span class="nm">${esc(r.archetype || 'Unknown deck')}</span>${r.record ? `<span class="rec">${esc(r.record)}</span>` : ''}${r.deck ? `<a href="https://riftbound.gg/decks/${encodeURIComponent(r.deck)}/" target="_blank" rel="noopener" class="lnk" aria-label="Decklist">List ↗</a>` : ''}</li>`;
  };
  let html = await newsTopHTML();
  html += `<div class="seg mini" id="news-f"><button data-f="all" class="${EVS.nf === 'all' ? 'on' : ''}">Major events</button><button data-f="prize" class="${EVS.nf === 'prize' ? 'on' : ''}">$5k+ prize pool</button></div>
    <h2>Recent results</h2>`;
  html += '<div class="ngrid">';
  if (!evs.length) html += '<p class="empty">No big-event results in the last 60 days yet — they appear here after the next daily update.</p>';
  for (const e of evs) {
    const top = (e.results || []).slice(0, 8);
    html += `<div class="card-box newsev">
      <div class="nhead evrow">${unixBox(e.date)}<div class="info">
        <div class="nm" style="white-space:normal">${esc(e.name)}</div>
        <div class="meta wrap"><span class="evtype big">${esc(e.kind)}</span>${e.prize ? `<span class="prize">${kPrize(e.prize)} prize pool</span>` : ''}${e.players ? `${e.players} players` : ''}</div>
      </div></div>
      ${top.length ? `<ul class="nlist">${top.map(resRow).join('')}</ul>` : '<p class="sub">Standings not posted yet.</p>'}
    </div>`;
  }
  html += '</div>';
  const hl = N.headlines || [];
  if (hl.length) {
    html += '<h2>Official news</h2><ul class="list">' + hl.map((h) => `<li class="item hl"><a href="${esc(h.url)}" target="_blank" rel="noopener">
      ${h.img ? `<img src="${esc(h.img)}" alt="" loading="lazy" onerror="this.remove()">` : ''}<div class="info"><div class="nm" style="white-space:normal">${esc(h.title)}</div>
      <div class="meta">${[h.kind, h.date && fmtDate(h.date)].filter(Boolean).map(esc).join(' · ')}</div></div></a></li>`).join('') + '</ul>';
  }
  html += `<p class="sub center">Results from tournament data (riftbound.gg / dotgg)${hl.length ? ' and playriftbound.com' : ''}. Updated ${N.updated ? unixDay(N.updated) : '—'}.</p>`;
  body.innerHTML = html;
  const ba = $('#ban-all'); if (ba) ba.onclick = () => pushSheet(renderBanList);
  const np = $('#news-prev'); if (np) np.onclick = () => pushSheet(renderPreviews);
  $$('#ev-body .banc[data-k]').forEach((li) => li.onclick = () => openDetail(li.dataset.k));
  $('#news-f').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; EVS.nf = b.dataset.f; renderNews(); };
  $$('#ev-body .nres[data-arch]').forEach((li) => li.onclick = (ev) => { if (ev.target.closest('a')) return; openDeck(li.dataset.arch); });
}
function newEvent(f) {
  const e = { id: Date.now().toString(36), name: f.name || '', date: f.date || todayISO(), end: f.end || '', time: f.time || '', loc: f.loc || '', type: f.type || 'Nexus Night', format: 'Constructed', deckId: '', deckName: '', fee: '', prize: '', notes: '', place: '', players: '', url: f.url || '', rounds: [], created: Date.now(), mod: Date.now() };
  EV.events.push(e); saveEV(); return e;
}
async function renderUpcoming() {
  const body = $('#ev-body');
  if (!EVS.up) { body.innerHTML = '<p class="sub">Loading…</p>'; try { EVS.up = await (await fetch('data/upcoming.json')).json(); } catch { EVS.up = { events: [] }; } }
  const today = todayISO();
  const list = EVS.up.events.filter((e) => (e.end || e.start) >= today);
  let month = '', html = `<div class="card-box"><h3>Local events near you</h3>
    <p class="sub">Nexus Nights, Summoner Skirmishes, Pre-Rifts and store tournaments are now listed and registered for on PlayRiftbound.com (sign in with your Riot account). Find one, then tap <b>＋ Add event</b> under My events to track it.</p>
    <a class="ghost" style="display:inline-block;text-decoration:none" href="https://playriftbound.com/en-us/events" target="_blank" rel="noopener">Find events on PlayRiftbound.com ↗</a></div>
    <p class="sub">Major events from Riot's official schedule (updated ${fmtDate(EVS.up.updated)}).</p><ul class="list">`;
  for (const e of list) {
    const [y, m] = e.start.split('-').map(Number); const mo = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (mo !== month) { html += `<li class="dsec" style="list-style:none">${mo}</li>`; month = mo; }
    const added = EV.events.some((x) => x.name === e.name && x.date === e.start);
    html += `<li class="item evrow">${dateBox(e.start)}<div class="info">
      <div class="nm" style="white-space:normal">${esc(e.name)}</div>
      <div class="meta wrap"><span class="evtype ${BIG.has(e.type) ? 'big' : ''}">${esc(e.type)}</span>${esc(e.loc || '')}${e.end ? ` · until ${fmtDate(e.end)}` : ''}</div>
      <div class="row" style="margin:6px 0 0">${added ? '<span class="ok sub">✓ In my events</span>' : `<button class="ghost sm" data-upadd="${esc(e.name)}|${esc(e.start)}">＋ Add to my events</button>`}${e.url ? `<a class="sub" style="align-self:center" href="${esc(e.url)}" target="_blank" rel="noopener">More info ↗</a>` : ''}</div>
    </div></li>`;
  }
  html += `</ul><p class="sub center">Source: <a href="${esc(EVS.up.source)}" target="_blank" rel="noopener">playriftbound.com</a></p>`;
  body.innerHTML = html;
  $$('#ev-body [data-upadd]').forEach((b) => b.onclick = () => {
    const [name, start] = b.dataset.upadd.split('|'); const u = EVS.up.events.find((x) => x.name === name && x.start === start);
    newEvent({ name: u.name, date: u.start, end: u.end, loc: u.loc, type: EV_TYPES.includes(u.type) ? u.type : 'Casual / other', url: u.url });
    toast('Added to My events'); renderUpcoming();
  });
}
function legendNames() { return D.rb ? [...new Set(Object.entries(D.rb).filter(([id, c]) => c.t === 'Legend' && isBaseId(id)).map(([, c]) => c.n))].sort() : []; }
function renderEvent(id) {
  const e = evGet(id); if (!e) { closeSheet(); return; }
  const r = evRecord(e);
  const decks = MD.decks.slice().sort((a, b) => a.name.localeCompare(b.name));
  $('#sheet-content').innerHTML = `<div class="detail form">
    <h2 style="margin:6px 0 4px">${esc(e.name || 'New event')}</h2>
    <label>Event name</label><input data-f="name" value="${esc(e.name)}" placeholder="e.g. Friday Nexus Night">
    <div class="two"><div><label>Date</label><input type="date" data-f="date" value="${esc(e.date)}"></div><div><label>Start time</label><input type="time" data-f="time" value="${esc(e.time)}"></div></div>
    <label>Store / location</label><input data-f="loc" value="${esc(e.loc)}" placeholder="Store name, city">
    <div class="two"><div><label>Type</label><select data-f="type">${EV_TYPES.map((t) => `<option ${t === e.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div><label>Format</label><select data-f="format">${['Constructed', 'Sealed', '2v2', 'Other'].map((t) => `<option ${t === e.format ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
    <label>Deck I played</label><select data-f="deckId"><option value="">${decks.length ? '— pick one of My decks —' : '— no saved decks —'}</option>${decks.map((d) => `<option value="${esc(d.id)}" ${d.id === e.deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
    <input data-f="deckName" value="${esc(e.deckName)}" placeholder="…or type a deck / legend" style="margin-top:6px">
    <div class="two"><div><label>Entry fee</label><input data-f="fee" value="${esc(e.fee)}" placeholder="$"></div><div><label>Prizes won</label><input data-f="prize" value="${esc(e.prize)}" placeholder="packs, promo, credit…"></div></div>
    <div class="two"><div><label>Final place</label><input type="number" min="1" inputmode="numeric" data-f="place" value="${esc(e.place)}"></div><div><label>Players</label><input type="number" min="1" inputmode="numeric" data-f="players" value="${esc(e.players)}"></div></div>

    <div class="dsec">Rounds · record ${recTxt(r)}</div>
    <datalist id="leg-list">${legendNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
    <ul class="dl">${(e.rounds || []).map((rd, i) => `<li style="display:block;padding:10px 0">
      <div class="row" style="align-items:center;margin:0 0 6px"><b style="min-width:70px">Round ${i + 1}</b>
        <div class="rbtn" style="flex:1">${['W', 'L', 'D'].map((x) => `<button class="${rd.res === x ? 'on ' + x : ''}" data-rres="${i}|${x}">${{ W: 'Win', L: 'Loss', D: 'Draw' }[x]}</button>`).join('')}</div>
        <button class="ghost sm" data-rdel="${i}" aria-label="Delete round">✕</button></div>
      <div class="two"><input data-r="${i}|opp" value="${esc(rd.opp || '')}" placeholder="Opponent"><input data-r="${i}|leg" list="leg-list" value="${esc(rd.leg || '')}" placeholder="Their legend"></div>
      <div class="two" style="margin-top:6px"><input data-r="${i}|g" value="${esc(rd.g || '')}" placeholder="Games, e.g. 2-1"><input data-r="${i}|notes" value="${esc(rd.notes || '')}" placeholder="Notes"></div>
    </li>`).join('') || '<li class="sub">No rounds yet.</li>'}</ul>
    <button class="ghost" id="ev-addround" style="width:100%;margin-top:8px">＋ Add round</button>
    <label>Notes</label><textarea data-f="notes" rows="3" placeholder="What worked, what to change…">${esc(e.notes)}</textarea>
    ${e.url ? `<p><a href="${esc(e.url)}" target="_blank" rel="noopener">Event info ↗</a></p>` : ''}
    <div class="row" style="margin-top:14px"><button class="ghost" id="ev-ics">Add to calendar</button><button class="danger" id="ev-del">Delete event</button></div>
  </div>`;
  const save = () => { e.mod = Date.now(); saveEV(); };
  $$('#sheet-content [data-f]').forEach((inp) => inp.onchange = () => { e[inp.dataset.f] = inp.value.trim(); if (inp.dataset.f === 'deckId' && inp.value) e.deckName = ''; save(); if (inp.dataset.f === 'name') $('#sheet-content h2').textContent = e.name || 'New event'; });
  $$('#sheet-content [data-r]').forEach((inp) => inp.onchange = () => { const [i, k] = inp.dataset.r.split('|'); e.rounds[+i][k] = inp.value.trim(); save(); });
  const keep = (fn) => { const b = $('#sheet .sheet-body'), y = b.scrollTop; fn(); renderEvent(id); b.scrollTop = y; };
  $$('#sheet-content [data-rres]').forEach((b) => b.onclick = () => keep(() => { const [i, x] = b.dataset.rres.split('|'); e.rounds[+i].res = x; save(); }));
  $$('#sheet-content [data-rdel]').forEach((b) => b.onclick = () => keep(() => { e.rounds.splice(+b.dataset.rdel, 1); save(); }));
  $('#ev-addround').onclick = () => keep(() => { e.rounds.push({ res: '', opp: '', leg: '', g: '', notes: '' }); save(); });
  $('#ev-del').onclick = async () => { if (await confirmBox(`Delete "${e.name || 'this event'}"?`)) { EV.events = EV.events.filter((x) => x.id !== id); saveEV(); closeSheet(); } };
  $('#ev-ics').onclick = () => {
    const d = (e.date || todayISO()).replace(/-/g, ''); const t = (e.time || '').replace(':', '');
    const end = (e.end || e.date || todayISO()).replace(/-/g, '');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Riftbound Tracker//EN', 'BEGIN:VEVENT', `UID:${e.id}@riftbound-tracker`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      t ? `DTSTART:${d}T${t}00` : `DTSTART;VALUE=DATE:${d}`, t ? `DTEND:${d}T${String(+t.slice(0, 2) + 4).padStart(2, '0')}${t.slice(2)}00` : `DTEND;VALUE=DATE:${String(+end + 1)}`,
      `SUMMARY:${(e.name || 'Riftbound event').replace(/[,;]/g, ' ')}`, `LOCATION:${(e.loc || '').replace(/[,;]/g, ' ')}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    download(`${(e.name || 'event').replace(/[^\w]+/g, '-')}.ics`, ics, 'text/calendar');
  };
  if (!D.rb) loadDecks().then(() => { const dl = $('#leg-list'); if (dl) dl.innerHTML = legendNames().map((n) => `<option value="${esc(n)}">`).join(''); }, () => {});
}
/** after a best-of-3 ends on the Score screen, offer to log it to today's event */
async function offerRoundLog(win, me, opp, oppName) {
  const t = todayISO();
  const e = EV.events.filter((x) => x.date && x.date <= t && (x.end || x.date) >= t).sort((a, b) => (b.mod || b.created) - (a.mod || a.created))[0];
  if (!e) return;
  if (!(await confirmBox(`Add this match (${win ? 'win' : 'loss'} ${me}–${opp} vs ${oppName}) to "${e.name || 'today\'s event'}" as round ${(e.rounds || []).length + 1}?`))) return;
  e.rounds = e.rounds || []; e.rounds.push({ res: win ? 'W' : 'L', opp: oppName === 'Opponent' ? '' : oppName, leg: SC.oppLeg || '', g: `${me}-${opp}`, notes: '' });
  saveEV(); toast('Round saved to ' + (e.name || 'event'));
}
function wireEvents() {
  $('#ev-tab').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; EVS.tab = b.dataset.v; renderEvents(); };
}

/* ---------------------------------------------------------------- wishlist */
const WL_KEY = 'rbt.wish.v1';
const WL = Object.assign({ items: {} }, loadJSON(WL_KEY, {}));
function saveWL() { try { localStorage.setItem(WL_KEY, JSON.stringify(WL)); } catch { toast('Could not save on this device'); } }
const ownedQty = (k) => poolItems()[k]?.qty || 0;
const wlHit = (it, w) => w.max != null && it.m != null && it.m <= w.max;
function renderWishBox(k) {
  const box = $('#wishbox'); if (!box) return;
  const it = S.byKey.get(k); const w = WL.items[k];
  if (!w) {
    box.innerHTML = `<button class="ghost" id="wl-add" style="width:100%">♡ Add to wishlist</button>`;
    $('#wl-add').onclick = () => { WL.items[k] = { qty: 1, max: null, added: Date.now() }; saveWL(); toast('Added to wishlist'); renderWishBox(k); };
    return;
  }
  box.innerHTML = `<div class="row" style="justify-content:space-between;align-items:center;margin:0"><b class="wishon">♥ On your wishlist</b><button class="ghost sm" id="wl-rm">Remove</button></div>
    <div class="row" style="align-items:center;gap:12px">
      <span class="sub">Want</span><div class="stepper"><button data-wq="-1">−</button><span>${w.qty}</span><button data-wq="1">+</button></div>
      <span class="sub">Buy at or under $</span><input id="wl-max" type="number" inputmode="decimal" step="0.01" min="0" style="width:96px" value="${w.max ?? ''}" placeholder="any">
    </div>
    ${wlHit(it, w) ? `<p class="ok" style="margin:4px 0 0">✓ Market price ${money(it.m)} is at or under your target.</p>` : w.max != null && it.m != null ? `<p class="sub" style="margin:4px 0 0">Market is ${money(it.m)}, ${money(it.m - w.max)} above your target.</p>` : w.max != null ? '<p class="sub" style="margin:4px 0 0">No market price yet — you\'ll see a match here once TCGplayer has one.</p>' : ''}`;
  $('#wl-rm').onclick = () => { delete WL.items[k]; saveWL(); renderWishBox(k); };
  $$('#wishbox [data-wq]').forEach((b) => b.onclick = () => { w.qty = Math.max(1, w.qty + +b.dataset.wq); saveWL(); renderWishBox(k); });
  $('#wl-max').onchange = (e) => { const v = parseFloat(e.target.value); w.max = isNaN(v) ? null : v; saveWL(); renderWishBox(k); };
}
function renderWishlist() {
  const body = $('#wish-view');
  const rows = Object.entries(WL.items).map(([k, w]) => ({ k, w, it: S.byKey.get(k) })).filter((r) => r.it);
  let total = 0, hits = 0;
  for (const r of rows) { const need = Math.max(0, r.w.qty - ownedQty(r.k)); total += (r.it.m || 0) * need; if (wlHit(r.it, r.w)) hits++; }
  rows.sort((a, b) => (wlHit(b.it, b.w) - wlHit(a.it, a.w)) || ((b.it.m || 0) - (a.it.m || 0)));
  body.innerHTML = `<div class="summary"><div><div class="label">Wishlist cost at market</div><div class="big">${money(total)}</div>
      <div class="chg">${hits ? `<span class="ok">${hits} at or under your target price</span>` : '<span class="flat">Set a target price on any card to watch for deals</span>'}</div></div>
      <div class="right"><div class="label">Cards</div><div class="mid">${rows.reduce((t, r) => t + r.w.qty, 0)}</div></div></div>
    ${rows.length ? `<div class="row"><button class="ghost" id="wl-copy">Copy for TCGplayer Mass Entry</button></div>` : ''}
    <ul class="list">${rows.map(({ k, w, it }) => { const own = ownedQty(k); const hit = wlHit(it, w);
      return `<li class="item ${hit ? 'hit' : ''}" data-k="${esc(k)}">${img(it.img)}<div class="info">
        <div class="nm">${esc(it.n)}${variantTags(it)}</div>
        <div class="meta">${metaLine(it)}</div>
        <div class="meta">Want ${w.qty}${own ? ` · <span class="ok">own ${own}</span>` : ''}${w.max != null ? ` · target ≤ ${money(w.max)}` : ''}${w.note ? ' · ' + esc(w.note) : ''}</div>
      </div><div class="px"><b class="${hit ? 'ok' : ''}">${money(it.m)}</b><small>${chg(it.d, it.pc)}</small>
        <button class="ghost sm" data-gotit="${esc(k)}" style="margin-top:6px">Got it</button></div></li>`; }).join('') ||
      '<li class="empty">Nothing here yet. Open any card and tap <b>♡ Add to wishlist</b>, or use <b>Add all to wishlist</b> on a deck\'s buy list.</li>'}</ul>`;
  $$('#wish-view [data-gotit]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation(); const k = b.dataset.gotit; const w = WL.items[k]; const need = Math.max(1, w.qty - ownedQty(k));
    addCard(k, need); delete WL.items[k]; saveWL(); renderWishlist();
  });
  const cp = $('#wl-copy'); if (cp) cp.onclick = async () => {
    const txt = rows.map(({ k, w, it }) => `${Math.max(1, w.qty - ownedQty(k))} ${it.n.replace(/\s*\(.*?\)\s*/g, ' ').trim()}`).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Copied — paste into TCGplayer Mass Entry'); } catch { toast('Couldn\'t copy on this device'); }
  };
}
function wishAlert() {
  const n = Object.entries(WL.items).filter(([k, w]) => { const it = S.byKey.get(k); return it && wlHit(it, w); }).length;
  const t = $('#col-top [data-c=wish]'); if (t) t.innerHTML = `Wishlist${n ? ` <span class="dot">${n}</span>` : ''}`;
  return n;
}

/* ---------------------------------------------------------------- score counter */
const SC_KEY = 'rbt.score.v1';
const SC = Object.assign({ me: 0, opp: 0, target: 8, gamesMe: 0, gamesOpp: 0, undo: [], hist: [], oppName: 'Opponent', flip: true, done: false }, loadJSON(SC_KEY, {}));
const BG_KEY = 'rbt.oppbg.v1';
let OPP_BG = (() => { try { return localStorage.getItem(BG_KEY) || ''; } catch { return ''; } })();
function shrinkPhoto(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file); const im = new Image();
    im.onload = () => { const s = Math.min(1, 900 / Math.max(im.width, im.height)); const c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.82)); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    im.src = url;
  });
}
function saveScore() { try { localStorage.setItem(SC_KEY, JSON.stringify({ ...SC, undo: SC.undo.slice(-50) })); } catch {} }
const MYBG_KEY = 'rbt.mybg.v1';
let MY_BG = (() => { try { return localStorage.getItem(MYBG_KEY) || ''; } catch { return ''; } })();
/** background for one side of the score screen: default, a legend artwork (any printing, or the champion's other cards), or a photo */
function legendArt(name) { const r = name && cardRef(name); return r && r.img ? bigImg(r.img) : ''; }
function myLegend() {
  if (SC.myLeg != null) return SC.myLeg;
  const dk = MD.decks.find((d) => d.id === SC.myDeck); return dk && D.rb && D.rb[dk.leader] ? D.rb[dk.leader].n : '';
}
const champOf = (n) => normName(String(n || '').split(/\s*,\s*|\s+-\s+/)[0]);
/** every artwork we can show for a legend: its printings first (standard, overnumbered, signature, metal, promos), then the champion's other cards */
function artOptions(name) {
  if (!name || !D.byName || !S.cards) return [];
  const seen = new Set(), out = [];
  const push = (it, label) => { if (!it || !it.img || seen.has(it.p)) return; seen.add(it.p); out.push({ k: it.k, img: it.img, label }); };
  const tag = (it) => { const m = it.n.match(/\(([^)]*)\)/g), g = setName(it.g); return m ? m.map((x) => x.slice(1, -1)).join(' · ') : /K\/DA/.test(g) ? 'K/DA' : /Promo/i.test(g) ? 'Promo' : 'Standard'; };
  const odd = (it) => (/\(/.test(it.n) ? 1 : 0) + (/K\/DA|Promo/i.test(setName(it.g)) ? 2 : 0);
  const leg = (D.byName.get(normName(name)) || []).slice().sort((a, b) => odd(a) - odd(b));
  for (const it of leg) push(it, tag(it));
  const ch = champOf(name);
  for (const it of S.cards.items) if (!it.sealed && champOf(it.n) === ch && !leg.includes(it)) push(it, it.n.split(/\s*,\s*|\s+-\s+/).slice(1).join(' ') || it.n);
  const seenL = new Map(); for (const o of out) { const n = (seenL.get(o.label) || 0) + 1; seenL.set(o.label, n); if (n > 1) o.label += ' ' + n; }
  return out.slice(0, 18);
}
function pickArt(side) {
  const opp = side === 'opp', opts = artOptions(opp ? SC.oppLeg : myLegend()); if (!opts.length) return null;
  const want = opp ? SC.oppArt : SC.myArt;
  if (want === 'random') { const n = (SC.gamesMe + SC.gamesOpp + (SC.roll || 0)) * (opp ? 7 : 13); return opts[n % opts.length]; }
  return opts.find((o) => o.k === want) || opts[0];
}
function sideBg(side) {
  const opp = side === 'opp', mode = (opp ? SC.bg : SC.bgMe) || 'default', photo = opp ? OPP_BG : MY_BG;
  let urls = [];
  if (mode === 'photo' && photo) urls = [photo];
  if (mode === 'legend') { const a = pickArt(side); if (a) urls = [bigImg(a.img), a.img]; }
  const el = $(opp ? '#pl-opp' : '#pl-me'), id = opp ? 'sc-bg' : 'sc-mybg';
  const fit = mode === 'photo' ? 'fill' : (SC.fit || 'card');
  el.classList.toggle('photo', !!urls.length);
  el.dataset.fit = fit;
  el.style.backgroundImage = '';
  const bg = urls.map((u) => `url("${u}")`).join(',');
  const [blur, main] = el.querySelectorAll('.pl-bg i, .pl-bg b');
  if (blur) blur.style.backgroundImage = bg; if (main) main.style.backgroundImage = bg;
  $$(`#${id} button`).forEach((b) => b.classList.toggle('on', b.dataset.bg === (urls.length ? mode : 'default')));
  $(`#${id}choose`).textContent = photo ? 'Change photo…' : 'Choose photo…';
  $(`#${id}del`).classList.toggle('hidden', !photo);
  $(`#${id}row`).classList.toggle('hidden', mode !== 'photo');
  // the art strip: tap a printing or another card of that champion; 🎲 changes art every game
  const strip = $(opp ? '#sc-oppart' : '#sc-myart');
  if (mode === 'legend') {
    const opts = artOptions(opp ? SC.oppLeg : myLegend()), want = opp ? SC.oppArt : SC.myArt, cur = pickArt(side);
    strip.innerHTML = opts.length ? `<button class="art rnd ${want === 'random' ? 'on' : ''}" data-art="random" title="Different art every game"><span>🎲</span><small>Every game</small></button>` +
      opts.map((o) => `<button class="art ${want !== 'random' && cur && cur.k === o.k ? 'on' : ''}" data-art="${esc(o.k)}" title="${esc(o.label)}"><img loading="lazy" src="${esc(o.img)}" alt=""><small>${esc(o.label)}</small></button>`).join('')
      : `<p class="sub">Choose ${opp ? 'their' : 'your'} legend above to pick artwork.</p>`;
    strip.classList.remove('hidden');
  } else { strip.innerHTML = ''; strip.classList.add('hidden'); }
}
function renderScore() {
  scoreExtras();
  $('#sc-me').textContent = SC.me; $('#sc-opp').textContent = SC.opp;
  $('#sc-target').textContent = SC.target;
  $('#sc-games').textContent = `Games ${SC.gamesMe}–${SC.gamesOpp}`;
  $('#sc-oppname').value = SC.oppName;
  $('#sc-flip').checked = SC.flip;
  $('#pl-opp').classList.toggle('flipped', SC.flip);
  sideBg('opp'); sideBg('me');
  $('#pl-me').classList.toggle('won', SC.me >= SC.target);
  $('#pl-opp').classList.toggle('won', SC.opp >= SC.target);
  const w = $('#sc-win');
  const winner = SC.me >= SC.target ? 'me' : SC.opp >= SC.target ? 'opp' : null;
  if (winner && !SC.done) {
    w.innerHTML = `<h2>${winner === 'me' ? '🏆 You win!' : esc(SC.oppName) + ' wins'}</h2><p class="sub">${SC.me} – ${SC.opp}</p>
      <div class="row" style="justify-content:center"><button class="ghost" id="sc-oops">Oops, undo</button><button class="primary ghost" id="sc-next">Record &amp; next game</button></div>`;
    w.classList.remove('hidden');
    $('#sc-oops').onclick = () => scoreUndo();
    $('#sc-next').onclick = () => finishGame(winner);
  } else w.classList.add('hidden');
  const wins = SC.hist.filter((h) => h.win).length, losses = SC.hist.length - wins;
  $('#sc-record').textContent = SC.hist.length ? `${wins}W – ${losses}L` : '';
  $('#sc-hist').innerHTML = SC.hist.slice(0, 15).map((h) => `<li><span>${h.win ? '<span class="ok">W</span>' : '<span class="no">L</span>'} vs ${esc(h.opp)}</span><span class="sub">${h.me}–${h.os} · ${new Date(h.t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></li>`).join('') || '<li class="sub">Finished games show up here.</li>';
}
function scoreBump(p, d) {
  const v = Math.max(0, SC[p] + d);
  if (v === SC[p]) return;
  SC.undo.push({ p, from: SC[p] }); SC[p] = v;
  if (navigator.vibrate) navigator.vibrate(15);
  saveScore(); renderScore();
}
function scoreUndo() { const u = SC.undo.pop(); if (!u) return; SC[u.p] = u.from; SC.done = false; saveScore(); renderScore(); }
function finishGame(winner) {
  SC.hist.unshift({ t: Date.now(), win: winner === 'me', me: SC.me, os: SC.opp, opp: SC.oppName });
  if (typeof logMatch === 'function') logMatch({ res: winner === 'me' ? 'W' : 'L', leg: SC.oppLeg || '', deck: myLegend() || (MD.decks.find((d) => d.id === SC.myDeck) || {}).name || '', opp: SC.oppName === 'Opponent' ? '' : SC.oppName, score: `${SC.me}-${SC.opp}` });
  SC.hist = SC.hist.slice(0, 200);
  if (winner === 'me') SC.gamesMe++; else SC.gamesOpp++;
  let msg = '';
  let matchEnd = null;
  if (SC.gamesMe === 2 || SC.gamesOpp === 2) { msg = SC.gamesMe === 2 ? `Match won ${SC.gamesMe}–${SC.gamesOpp}!` : `Match lost ${SC.gamesMe}–${SC.gamesOpp}`; matchEnd = [SC.gamesMe === 2, SC.gamesMe, SC.gamesOpp, SC.oppName]; SC.gamesMe = SC.gamesOpp = 0; }
  SC.me = SC.opp = 0; SC.undo = []; SC.done = false;
  saveScore(); renderScore(); if (msg) toast(msg, 3500);
  if (matchEnd) setTimeout(() => offerRoundLog(...matchEnd), 600);
}
async function newGame() {
  if ((SC.me || SC.opp) && !(await confirmBox('Reset the score to 0–0? (Use this to abandon a game without recording it.)'))) return;
  SC.me = SC.opp = 0; SC.undo = []; SC.done = false; saveScore(); renderScore();
}
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* not supported */ }
}
function scoreExtras() {
  const leg = $('#sc-oppleg'), my = $('#sc-myleg'); if (!leg) return;
  if (!D.rb) { if (!scoreExtras.loading) scoreExtras.loading = loadDecks().then(() => { if (S.view === 'score') renderScore(); }, () => {}); return; }
  const names = legendNames(), fill = (sel, cur, ph) => { const o = `<option value="">${ph}</option>` + names.map((n) => `<option ${n === cur ? 'selected' : ''}>${esc(n)}</option>`).join(''); if (sel.dataset.sig !== cur + '|' + names.length) { sel.innerHTML = o; sel.dataset.sig = cur + '|' + names.length; } sel.value = cur || ''; };
  fill(leg, SC.oppLeg || '', 'Choose their legend…'); fill(my, myLegend() || '', 'Choose my legend…');
  $$('#sc-fit button').forEach((b) => b.classList.toggle('on', b.dataset.f === (SC.fit || 'card')));
}
function wireScore() {
  $('#sc-oppleg').onchange = (e) => { SC.oppLeg = e.target.value; SC.oppArt = ''; if (SC.oppLeg && (!SC.bg || SC.bg === 'default')) SC.bg = 'legend'; saveScore(); renderScore(); };
  $('#sc-myleg').onchange = (e) => { SC.myLeg = e.target.value; SC.myArt = ''; if (SC.myLeg && (!SC.bgMe || SC.bgMe === 'default')) SC.bgMe = 'legend'; saveScore(); renderScore(); };
  $('#sc-fit').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SC.fit = b.dataset.f; saveScore(); renderScore(); };
  const artPick = (side) => (e) => { const b = e.target.closest('[data-art]'); if (!b) return; if (side === 'opp') SC.oppArt = b.dataset.art; else SC.myArt = b.dataset.art; if (b.dataset.art === 'random') SC.roll = (SC.roll || 0) + 1; saveScore(); renderScore(); };
  $('#sc-oppart').onclick = artPick('opp'); $('#sc-myart').onclick = artPick('me');
  $$('#v-score [data-p]').forEach((b) => b.onclick = () => scoreBump(b.dataset.p, +b.dataset.d));
  $('#sc-undo').onclick = scoreUndo;
  $('#sc-new').onclick = newGame;
  $('#sc-tminus').onclick = () => { SC.target = Math.max(1, SC.target - 1); saveScore(); renderScore(); };
  $('#sc-tplus').onclick = () => { SC.target = Math.min(30, SC.target + 1); saveScore(); renderScore(); };
  $('#sc-oppname').onchange = (e) => { SC.oppName = e.target.value.trim() || 'Opponent'; saveScore(); };
  $('#sc-bg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.bg === 'photo' && !OPP_BG) { $('#sc-bgfile').click(); return; }
    if (b.dataset.bg === 'legend' && !SC.oppLeg) toast('Choose their legend above first');
    SC.bg = b.dataset.bg; saveScore(); renderScore(); };
  $('#sc-mybg').onclick = (e) => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.bg === 'photo' && !MY_BG) { $('#sc-mybgfile').click(); return; }
    if (b.dataset.bg === 'legend' && !myLegend()) toast('Choose your legend above first');
    SC.bgMe = b.dataset.bg; saveScore(); renderScore(); };
  $('#sc-mybgfile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const d = await shrinkPhoto(f); localStorage.setItem(MYBG_KEY, d); MY_BG = d; SC.bgMe = 'photo'; saveScore(); renderScore(); toast('Your background set'); }
    catch { toast('Could not use that photo'); } };
  $('#sc-mybgdel').onclick = () => { try { localStorage.removeItem(MYBG_KEY); } catch {} MY_BG = ''; SC.bgMe = 'default'; saveScore(); renderScore(); };
  $('#sc-bgfile').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { const d = await shrinkPhoto(f); localStorage.setItem(BG_KEY, d); OPP_BG = d; SC.bg = 'photo'; saveScore(); renderScore(); toast('Opponent background set'); }
    catch { toast('Could not use that photo'); } };
  $('#sc-bgdel').onclick = () => { try { localStorage.removeItem(BG_KEY); } catch {} OPP_BG = ''; SC.bg = 'default'; saveScore(); renderScore(); };
  $('#sc-flip').onchange = (e) => { SC.flip = e.target.checked; saveScore(); renderScore(); };
  $('#sc-clearhist').onclick = async () => { if (await confirmBox('Clear your game history?')) { SC.hist = []; SC.gamesMe = SC.gamesOpp = 0; saveScore(); renderScore(); } };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.view === 'score') keepAwake(true); });
}

async function init() {
  document.addEventListener('error', (e) => { const t = e.target; if (t.tagName === 'IMG' && !t.dataset.dead) { t.dataset.dead = 1; t.removeAttribute('src'); t.classList.add('thumb'); t.alt = ''; } }, true);
  if (location.hash === '#card') { try { history.replaceState(null, '', location.pathname); } catch {} }
  wire();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  applyTextSize();
  window.RBTSnapshot = (why) => takeSnapshot(why);
  window.addEventListener('rbt-sync', reloadFromStorage);
  window.addEventListener('rbt-sync-status', () => { if (S.view === 'more') renderSync(); });
  if (window.RBTSync) RBTSync.start();
  try { await Promise.all([loadData(), loadBans()]); }
  catch { $('#col-empty').classList.remove('hidden'); $('#col-empty').innerHTML = '<p>Price data is still being prepared. Check back in a few minutes.</p>'; return; }
  checkStale();
  if (typeof featuresReady === 'function') featuresReady();
  dailySnapshot().then(() => { if (!$('#v-more').classList.contains('hidden')) renderBackupInfo(); });
  setTimeout(() => { const n = wishAlert(); if (n) toast(`♥ ${n} wishlist card${n === 1 ? ' is' : 's are'} at or under your target price`, 4000); }, 1200);
  show(location.hash === '#scan' ? 'scan' : location.hash === '#score' ? 'score' : location.hash === '#events' ? 'events' : 'collection');
}
init();
