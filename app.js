/* Riftbound Tracker — phone app (runs entirely in the browser; collection stays on this device). */
'use strict';

const INV_KEY = 'rbt.inventory.v1';
const PREF_KEY = 'rbt.prefs.v1';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const S = {
  cards: null,          // data/cards.json
  byKey: new Map(),     // "productId|Normal" -> item
  byPid: new Map(),     // productId -> [items]
  groups: new Map(),    // groupId -> group
  history: null,        // data/history.json (lazy)
  hashes: null,         // data/hashes.json (lazy, for scanner)
  inv: loadJSON(INV_KEY, { items: {} }),
  prefs: loadJSON(PREF_KEY, { addSet: 'all', mvScope: 'mine', mvMetric: 'pct', mvMin: '1', sort: 'value', seenNew: [] }),
  view: 'collection',
};

/* ---------------------------------------------------------------- utils */
function loadJSON(k, d) { try { return JSON.parse(localStorage.getItem(k)) || d; } catch { return d; } }
function saveInv() { try { localStorage.setItem(INV_KEY, JSON.stringify(S.inv)); } catch { toast('Could not save on this device'); } }
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
function img(u, cls = '') { return u ? `<img loading="lazy" class="${cls}" src="${esc(u)}" alt="">` : `<div class="thumb ${cls}"></div>`; }
function bigImg(u) { return u ? u.replace(/_\d+w\.jpg$/, '_in_1000x1000.jpg') : ''; }
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
  let t = '';
  if (it.s && it.s !== 'Normal') t += `<span class="tag foil">${esc(it.s)}</span>`;
  return t;
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
  $('#title').textContent = { collection: 'Collection', scan: 'Scan cards', add: 'Add cards', movers: 'Top movers', decks: 'Meta decks', events: 'Events', score: 'Score', more: 'Settings' }[view];
  $('#hdr-add').classList.toggle('hidden', view === 'add' || view === 'score');
  $('#hdr-more').classList.toggle('hidden', view === 'more' || view === 'score');
  if (view === 'score') { renderScore(); keepAwake(true); } else keepAwake(false);
  if (view === 'decks') renderDecks();
  if (view === 'events') renderEvents();
  if (view === 'scan') startCamera(); else { stopCamera(); clearTimeout(SCAN.timer); }
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
    const art = abbr ? `<img loading="lazy" src="assets/sets/${esc(abbr)}.jpg" alt="" onerror="this.remove()">` : '<span class="allicon">✦</span>';
    return `<button class="settile ${cur === key ? 'on' : ''} ${pc === 100 ? 'done' : ''}" data-colset="${key}" aria-label="${esc(name)}: ${x.have} of ${x.total}">
      <span class="setart">${art}<span class="setcode">${esc(abbr || 'ALL')}</span><span class="setname">${esc(name)}</span></span>
      <span class="setfoot"><span class="setnum"><b>${x.have}</b> / ${x.total}</span><span class="setpc">${pc === 100 ? '✓ ' : ''}${pc}%</span></span>
      <span class="bar"><i style="width:${pc}%"></i></span></button>`; };
  $('#col-sets').innerHTML = tile('all', 'All sets', all, null) +
    S.cards.groups.filter((g) => st.get(g.id)?.total).map((g) => tile(String(g.id), shortSet(g.name), st.get(g.id), g.abbr)).join('');
  const on = $('#col-sets .settile.on'); if (on && !renderSetStrip.scrolled) { on.scrollIntoView({ inline: 'center', block: 'nearest' }); renderSetStrip.scrolled = true; }
}
function renderCollection() {
  if (!S.cards) return;
  renderSetStrip();
  const cur = S.prefs.colSet || 'all';
  const inSet = (it) => cur === 'all' || String(it.g) === cur;
  $('#col-setmode').classList.toggle('hidden', cur === 'all');
  if (cur !== 'all') {
    const g = S.groups.get(+cur); const x = setStats().st.get(+cur) || { total: 0, have: 0 };
    $$('#col-setmode button').forEach((b) => b.classList.toggle('on', b.dataset.m === (S.prefs.colMode || 'owned')));
    $('#col-setmode [data-m=owned]').textContent = `Owned (${x.have})`;
    $('#col-setmode [data-m=missing]').textContent = `Missing (${x.total - x.have})`;
    $('#sum-label').textContent = `${g ? g.name : 'Set'} value`;
  } else $('#sum-label').textContent = 'Collection value';
  if (cur !== 'all' && S.prefs.colMode === 'missing') { renderMissing(+cur); return; }
  $('#col-list').classList.remove('missing');
  const rows = ownedRows().filter((r) => inSet(r.it));
  let total = 0, totalPrev = 0, count = 0;
  for (const r of rows) {
    total += r.value; count += r.e.qty;
    if (r.it.w != null) totalPrev += r.it.w * r.e.qty; else totalPrev += r.value;
  }
  $('#sum-value').textContent = money(total);
  $('#sum-count').textContent = count;
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
  $('#sum-value').textContent = money(total); $('#sum-count').textContent = rows.reduce((t, r) => t + r.e.qty, 0); $('#sum-change').innerHTML = '';
  $('#col-empty').classList.add('hidden');
  $('#col-list').classList.add('missing');
  $('#col-list').innerHTML = miss.length
    ? `<li class="sub" style="padding:2px 4px 8px">${miss.length} printings to go · about <b>${money(cost)}</b> to complete at the cheapest finish</li>` + miss.map((items) => productRow(items)).join('')
    : '<li class="empty">🎉 Set complete — you have every printing.</li>';
}
/* ----- manual add */
function productRow(items, extra = '') {
  const it = items[0];
  const btns = items.map((v) => `<button data-add="${esc(v.k)}">+ ${esc(v.s)} <b>${money(v.m)}</b></button>`).join('');
  return `<li class="item" data-k="${esc(it.k)}">
      ${img(it.img)}
      <div class="info">
        <div class="nm">${esc(it.n)}</div>
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
  let pool;
  if (scope === 'mine') pool = ownedRows().map((r) => ({ it: r.it, qty: r.e.qty }));
  else pool = S.cards.items.filter((it) => !it.sealed).map((it) => ({ it, qty: 0 }));
  pool = pool.filter((x) => x.it.d != null && x.it.m != null && Math.max(x.it.m, x.it.w || 0) >= min);
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
function fmtDate(s) { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }

/* ----- more / settings */
function renderMore() {
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
function renderDetail(k) {
  const it = S.byKey.get(k); if (!it) return;
  const owned = S.inv.items[k];
  const siblings = (S.byPid.get(it.p) || []).filter((v) => v.k !== k);
  const html = `<div class="detail">
    <img class="detail-img" src="${esc(bigImg(it.img))}" onerror="this.onerror=null;this.src='${esc(it.img)}'" alt="">
    <h2>${esc(it.n)}${variantTags(it)}</h2>
    <div class="sub">${esc(setName(it.g))}${it.num ? ' · ' + esc(it.num) : ''}${it.r ? ' · ' + esc(it.r) : ''}</div>
    <div class="card-box mkt">
      <span class="label">TCGplayer market price${it.s !== 'Normal' ? ' · ' + esc(it.s) : ''}</span>
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
    <div class="label">Price history (weekly)</div>
    <svg class="chart" id="chart" viewBox="0 0 300 120" preserveAspectRatio="none"></svg>
    <div class="row" style="justify-content:space-between;align-items:center;margin-top:14px">
      <div class="stepper"><button data-q="-1">−</button><span id="qty">${owned ? owned.qty : 0}</span><button data-q="1">+</button></div>
      <div class="sub">${owned ? 'Value ' + money((it.m || 0) * owned.qty) : 'Not in collection'}</div>
    </div>
    <div class="row" style="align-items:center">
      <label class="sub" for="cost">Paid per card $</label>
      <input id="cost" type="number" inputmode="decimal" step="0.01" min="0" style="width:110px" value="${owned && owned.cost != null ? owned.cost : ''}" ${owned ? '' : 'disabled'}>
      <span id="pl" class="sub"></span>
    </div>
    ${siblings.length ? `<div class="row">${siblings.map((v) => `<button class="ghost" data-open="${esc(v.k)}">${esc(v.s)} · ${money(v.m)}</button>`).join('')}</div>` : ''}
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
  $$('#sheet [data-open]').forEach((b) => b.onclick = () => openDetail(b.dataset.open));
  drawChart(it);
}
async function drawChart(it) {
  const h = await loadHistory();
  const ser = (h.series[it.k] || []).map((v, i) => ({ v, d: h.dates[i] })).filter((p) => p.v != null);
  if (it.m != null && (!ser.length || ser[ser.length - 1].d !== S.cards.updated)) ser.push({ v: it.m, d: S.cards.updated });
  const svg = $('#chart'); if (!svg) return;
  if (ser.length < 2) { svg.innerHTML = '<text x="150" y="64" fill="#97a2c8" font-size="12" text-anchor="middle">History builds up week by week</text>'; return; }
  const vs = ser.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const pts = ser.map((p, i) => [8 + (i / (ser.length - 1)) * 284, 108 - ((p.v - lo) / span) * 92]);
  const col = vs[vs.length - 1] >= vs[0] ? '#45e0d0' : '#ff6a57';
  svg.innerHTML = `<polyline fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${pts.map((p) => p.join(',')).join(' ')}"/>
    <text x="6" y="12" fill="#97a2c8" font-size="10">${money(hi)}</text><text x="6" y="118" fill="#97a2c8" font-size="10">${money(lo)}</text>
    <text x="294" y="118" fill="#97a2c8" font-size="10" text-anchor="end">${fmtDate(ser[0].d)} – now</text>`;
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
    await Promise.all([getOCR(), loadHashes()]).catch(() => {});
    setAuto(SCAN.auto);
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

/** Crop the card from the live video using the on-screen guide box. */
function grabFromVideo() {
  const v = $('#video'); if (!v.videoWidth) return null;
  const wrap = $('.cam-wrap').getBoundingClientRect(), box = $('.guide-box').getBoundingClientRect();
  // object-fit: cover mapping from screen to video pixels
  const scale = Math.max(wrap.width / v.videoWidth, wrap.height / v.videoHeight);
  const offX = (v.videoWidth * scale - wrap.width) / 2, offY = (v.videoHeight * scale - wrap.height) / 2;
  const sx = (box.left - wrap.left + offX) / scale, sy = (box.top - wrap.top + offY) / scale;
  const sw = box.width / scale, sh = box.height / scale;
  const c = document.createElement('canvas'); c.width = 945; c.height = 1320;
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
/** From a still photo: assume the card fills most of the frame; crop to card shape around the centre. */
async function grabFromFile(file) {
  const bmp = await createImageBitmap(file);
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
  $('#scan-status').innerHTML = '';
  $('#scan-results').innerHTML = `<li class="item scan-hit">
      ${img(it.img)}
      <div class="info">
        <div class="nm"><span class="ok">✓</span> ${esc(it.n)}${variantTags(it)}</div>
        <div class="meta">${metaLine(it)}</div>
        <div class="meta">${money(it.m)} · ${S.inv.items[it.k]?.qty || 1} owned</div>
      </div>
      <div class="addbtns">
        <button data-scan="undo">Undo</button>
        <button data-scan="more">+1 copy</button>
        ${finishes.map((v) => `<button data-scan="swap" data-k="${esc(v.k)}">${esc(v.s)} instead</button>`).join('')}
      </div></li>
    ${others.length ? `<li class="sub" style="padding:6px 2px">Different version? Tap to switch:</li>` + others.map((c) => {
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
    if (!manual && SCAN.holdHash) {
      // the card we just added is still in view: wait until it changes
      if (hamming(dhash(canvas), SCAN.holdHash) < 46) { msg.textContent = 'Added ✓ — show the next card'; return; }
      SCAN.holdHash = null;
    }
    msg.textContent = 'Reading…';
    const res = await identify(canvas, { useName: true });
    if (res.sure && res.best) {
      const it = pickFinish(res.best.items);
      addCard(it.k);
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      SCAN.last = { k: it.k, res };
      SCAN.holdHash = res.hash;
      showAdded(it, res.best, res.cands);
      msg.textContent = `Added ✓ ${it.n}`;
    } else if (res.cands.length) {
      if (manual || SCAN.shownFor === null || hamming(res.hash, SCAN.shownFor) > 46) { showMaybe(res); SCAN.shownFor = res.hash; }
      msg.textContent = 'Not sure which version — pick below, or hold steady';
    } else {
      msg.textContent = manual ? 'Couldn\'t read that card — try more light or fill the frame' : 'Looking for a card…';
      if (manual) $('#scan-status').textContent = 'Couldn\'t read the number or name. Fill the frame with the card, avoid glare, or use ＋ to search.';
    }
  } finally { SCAN.busy = false; }
}
function scanLoop() {
  clearTimeout(SCAN.timer);
  if (!SCAN.auto || S.view !== 'scan' || !stream || document.hidden) return;
  const c = grabFromVideo();
  const next = () => { SCAN.timer = setTimeout(scanLoop, 350); };
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
    const c = grabFromVideo(); if (!c) { toast('Camera not ready — try Photo'); return; }
    SCAN.holdHash = null; runScan(c, true);
  };
  $('#scan-autotoggle').onchange = (e) => setAuto(e.target.checked);
  $('#scan-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scan]'); if (!b) return;
    e.stopPropagation();
    const act = b.dataset.scan, last = SCAN.last;
    if (!last) return;
    if (act === 'undo') { const q = S.inv.items[last.k]?.qty || 0; setQty(last.k, q - 1); toast('Removed'); $('#scan-results').innerHTML = ''; SCAN.last = null; }
    if (act === 'more') { addCard(last.k); showAdded(S.byKey.get(last.k), last.res.cands.find((c) => c.items.some((v) => v.k === last.k)) || last.res.best, last.res.cands); }
    if (act === 'swap') {
      const q = S.inv.items[last.k]?.qty || 0; setQty(last.k, q - 1);
      const k = b.dataset.k; addCard(k); SCAN.last.k = k;
      const prod = last.res.cands.find((c) => c.items.some((v) => v.k === k)) || { pid: S.byKey.get(k).p, items: S.byPid.get(S.byKey.get(k).p) };
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
function exportBackup() {
  const items = {};
  for (const [k, e] of Object.entries(S.inv.items)) { const it = S.byKey.get(k); items[k] = { ...e, name: it ? it.n : e.name, number: it ? it.num : '' }; }
  download(`riftbound-collection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'riftbound-tracker', version: 3, items, decks: MD.decks, events: EV.events }, null, 1), 'application/json');
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
    if (!(await confirmBox(`Replace your current collection with the ${n} entries in this backup?`))) return;
    S.inv = { items: {} };
    for (const [k, e] of Object.entries(data.items)) S.inv.items[k] = { qty: +e.qty || 1, added: e.added || Date.now(), cost: e.cost ?? null, name: e.name };
    if (Array.isArray(data.decks)) { MD.decks = data.decks; saveMD(); }
    if (Array.isArray(data.events)) { EV.events = data.events; saveEV(); }
    saveInv(); toast('Backup restored'); show('collection');
  } catch { toast('That file isn\'t a Riftbound Tracker backup'); }
}

/* ---------------------------------------------------------------- wiring */
function wire() {
  $$('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.view));
  $('#hdr-add').onclick = () => show('add');
  $('#hdr-more').onclick = () => show('more');
  wireDecks(); wireScore(); wireEvents();
  $('#col-filter').oninput = renderCollection;
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
  // list clicks: add buttons or open detail
  document.body.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { e.stopPropagation(); addCard(add.dataset.add); return; }
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
  $('#scan-file').onchange = async (e) => { const f = e.target.files[0]; if (f) { SCAN.holdHash = null; runScan(await grabFromFile(f), true); } e.target.value = ''; };
  $('#btn-export').onclick = exportBackup;
  $('#btn-csv').onclick = exportCSV;
  $('#import-file').onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('#btn-clear').onclick = async () => { if (await confirmBox('Delete every card from your collection? Make a backup first if unsure.')) { S.inv = { items: {} }; saveInv(); toast('Collection cleared'); } };
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
  for (const [k, e] of Object.entries(S.inv.items)) {
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
function analyzeDeck(a) {
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
    const have = Math.max(0, Math.min(cnt, (owned.get(n) || 0) - (used.get(n) || 0)));
    used.set(n, (used.get(n) || 0) + have);
    lines.push({ id, c, cnt, have, miss: cnt - have, sec });
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
    if (!cand || cand.b || !cand.n || id === miss.id) return false;
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
  for (const l of allLines) if (l.miss > 0) { const p = cardPrice(l.c.n); if (p) { cost += p.m * l.miss; if (l.sec !== 'Side') costMain += p.m * l.miss; } }
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
  const all = ranked();
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
  $('#dk-win').classList.toggle('hidden', D.tab === 'mine');
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
  const rows = deckCandidates();
  $('#dk-list').innerHTML = rows.map((a) => {
    const an = a.list ? analyzeDeck(a) : null;
    const leg = cardRef(D.rb[a.leader]?.n || a.name);
    return `<li class="item" data-deck="${esc(a.slug)}">
      ${img(leg && leg.img)}
      <div class="info">
        <div class="nm">${a.tier ? `<span class="tier ${esc(a.tier)}">${esc(a.tier)}</span>` : ''}${esc(a.name)}</div>
        <div class="meta wrap">${domTags(a.colors)} <b class="rk">#${a.pos ?? a.rank}</b> ${pctTxt(a.winrate)} wins · top 8 ${pctTxt(a.top8)} · ${a.share}% of decks${a.enough === false ? ' · <span class="part">small sample</span>' : ''}</div>
        ${an ? `<div class="meta">You own ${Math.round(an.pct * 100)}% · ${an.costMain > 0 ? money(an.costMain) + ' to finish' : 'ready to play'}</div><div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>`
        : '<div class="meta">No public decklist yet</div>'}
      </div>
    </li>`;
  }).join('') || '<li class="empty">Nothing here yet.</li>';
}

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
  const an = analyzeDeck(a);
  const mode = D.deckMode || 'list';
  html += `${b ? `<p class="sub">${a.listFrom30 ? 'Best list from the last 30 days: ' : 'List: '}<b>${ordinal(b.place)} of ${b.players}</b> · ${esc(b.event)}${b.record ? ' · ' + esc(b.record) : ''}${when ? ' · ' + when : ''}</p>` : ''}
    <div class="card-box">
      <b>You own ${an.mainHave} of ${an.mainTotal} main-deck cards</b> (${Math.round(an.pct * 100)}% of the whole list)
      <div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>
      <div class="sub" style="margin-top:6px">${an.costMain > 0 ? `Missing cards cost about <b>${money(an.costMain)}</b> (cheapest printings)${an.cost > an.costMain ? `, ${money(an.cost)} with sideboard` : ''}.` : 'You have everything for the main deck. 🎉'}</div>
    </div>
    <div class="seg" id="dk-mode"><button data-m="list" class="${mode === 'list' ? 'on' : ''}">Tournament list</button><button data-m="mine" class="${mode === 'mine' ? 'on' : ''}">My version</button><button data-m="buy" class="${mode === 'buy' ? 'on' : ''}">Buy list</button></div>`;

  if (mode === 'list') {
    for (const [sec, title] of SECTION_ORDER) {
      const ls = an.lines.filter((l) => l.sec === sec); if (!ls.length) continue;
      html += `<div class="dsec">${title} (${ls.reduce((t, l) => t + l.cnt, 0)})</div><ul class="dl">` + ls.map(lineHTML).join('') + '</ul>';
    }
    if (an.side.length) html += `<div class="dsec">Sideboard (${an.side.reduce((t, l) => t + l.cnt, 0)})</div><ul class="dl">` + an.side.map(lineHTML).join('') + '</ul>';
  } else if (mode === 'mine') {
    if (!an.subs.length) html += '<p class="sub">Nothing to swap — you own every card in this list.</p>';
    else {
      html += '<p class="sub">Swaps from your own cards for what you\'re missing, chosen by how often they appear in winning lists of the same domains, then closest cost.</p><ul class="dl">';
      for (const sb of an.subs) {
        const m = sb.miss;
        html += `<li><span class="cnt no">−${m.miss}</span><span class="nm">${esc(m.c.n)}<small>${esc(m.sec)}${m.c.c != null ? ' · ' + m.c.c + ' energy' : ''}</small></span><span class="st">${money(cardPrice(m.c.n)?.m)}</span></li>`;
        for (const p of sb.picks) html += `<li class="sub-line">↳ play <b>${p.take}× ${esc(p.c.n)}</b> (you own it${p.c.c != null ? ' · ' + p.c.c + ' energy' : ''}${D.pop[p.id] ? ' · in ' + Math.round(D.pop[p.id] / D.nLists * 100) + '% of top lists' : ''})</li>`;
        if (sb.still > 0) html += sb.buy
          ? `<li class="sub-line">↳ still short ${sb.still} — budget pick: <b>${esc(sb.buy.c.n)}</b> ${money(sb.buy.p.m)}</li>`
          : `<li class="sub-line">↳ still short ${sb.still} — no owned substitute; get the original</li>`;
      }
      html += '</ul>';
    }
  } else {
    const buy = an.lines.concat(an.side).filter((l) => l.miss > 0);
    if (!buy.length) html += '<p class="sub">Nothing to buy.</p>';
    else {
      html += '<ul class="dl">' + buy.map((l) => { const p = cardPrice(l.c.n), r = cardRef(l.c.n); return `<li data-card="${esc(r ? r.k : '')}"><span class="cnt">${l.miss}×</span><span class="nm">${esc(l.c.n)}<small>${l.sec === 'Side' ? 'Sideboard' : esc(l.sec)}</small></span><span class="st">${p ? money(p.m * l.miss) : '—'}</span></li>`; }).join('') + '</ul>';
      html += `<div class="row"><button class="ghost" id="dk-copy">Copy list</button><span class="sub" style="align-self:center">Paste into TCGplayer Mass Entry</span></div>`;
    }
  }
  html += `<button class="primary ghost" id="dk-save" style="width:100%;padding:13px;margin-top:14px">Save to My decks</button>
    <p><a href="https://riftbound.gg/decks/${esc(b.slug)}/" target="_blank" rel="noopener">View this list on riftbound.gg ↗</a></p></div>`;
  $('#sheet-content').innerHTML = html;
  $$('#dk-mode button').forEach((x) => x.onclick = () => { D.deckMode = x.dataset.m; renderDeck(slug); });
  const sv = $('#dk-save'); if (sv) sv.onclick = () => saveMetaToMine(a);
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
  return `<li data-card="${esc(r ? r.k : '')}"><span class="cnt">${l.cnt}×</span><span class="nm">${esc(l.c.n)}<small>${[l.c.t, l.c.c != null ? l.c.c + ' energy' : '', (l.c.d || []).join('/')].filter(Boolean).map(esc).join(' · ')}</small></span><span class="st">${st}<br><small class="sub">${money(p && p.m)}</small></span></li>`;
}
const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
function wireDecks() {
  D.win = S.prefs.deckWin || '30d';
  $('#dk-tab').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; D.tab = b.dataset.v; renderDecks(); };
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
  $('#dk-list').innerHTML = `<li><button class="primary ghost" id="md-new" style="width:100%;padding:13px;margin-bottom:10px">＋ New deck</button></li>` +
    (rows || '<li class="empty">No decks yet. Tap <b>New deck</b> and pick a legend to start.</li>');
  $('#md-new').onclick = () => pushSheet(renderLegendPicker);
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
  const a = mdArch(dk); const an = analyzeDeck(a); an.all = an.lines.concat(an.side);
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
function saveMetaToMine(a) {
  const dk = { id: Date.now().toString(36), name: a.name.split(' - ')[0] + ' (from meta)', leader: a.list.leader || a.leader, main: { ...a.list.main }, side: { ...(a.list.side || {}) }, created: Date.now(), updated: Date.now() };
  MD.decks.push(dk); saveMD(); toast('Saved to My decks — tweak away');
  pushSheet(() => renderMyDeck(dk.id));
}

/* ---------------------------------------------------------------- events */
const EV_KEY = 'rbt.events.v1';
const EV = Object.assign({ events: [] }, loadJSON(EV_KEY, {}));
const EVS = { tab: 'mine', up: null };
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
  const body = $('#ev-body'); const today = todayISO();
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
    <h2>Coming up</h2>
    <ul class="list">${up.map(row).join('') || '<li class="empty">Nothing scheduled. Add an event, or pick one from <b>Upcoming</b>.</li>'}</ul>
    <h2>Results</h2>
    <ul class="list">${past.map(row).join('') || '<li class="empty">Past events and your results will show here.</li>'}</ul>`;
  $('#ev-new').onclick = () => { const e = newEvent({}); pushSheet(() => renderEvent(e.id)); };
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
    <p class="sub">Nexus Nights, Summoner Skirmishes and store tournaments are listed on the official Riftbound Event Locator. Find one, then tap <b>＋ Add event</b> under My events to track it.</p>
    <a class="ghost" style="display:inline-block;text-decoration:none" href="https://locator.riftbound.uvsgames.com/events" target="_blank" rel="noopener">Open the Event Locator ↗</a></div>
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
  e.rounds = e.rounds || []; e.rounds.push({ res: win ? 'W' : 'L', opp: oppName === 'Opponent' ? '' : oppName, leg: '', g: `${me}-${opp}`, notes: '' });
  saveEV(); toast('Round saved to ' + (e.name || 'event'));
}
function wireEvents() {
  $('#ev-tab').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; EVS.tab = b.dataset.v; renderEvents(); };
}

/* ---------------------------------------------------------------- score counter */
const SC_KEY = 'rbt.score.v1';
const SC = Object.assign({ me: 0, opp: 0, target: 8, gamesMe: 0, gamesOpp: 0, undo: [], hist: [], oppName: 'Opponent', flip: true, done: false }, loadJSON(SC_KEY, {}));
function saveScore() { try { localStorage.setItem(SC_KEY, JSON.stringify({ ...SC, undo: SC.undo.slice(-50) })); } catch {} }
function renderScore() {
  $('#sc-me').textContent = SC.me; $('#sc-opp').textContent = SC.opp;
  $('#sc-target').textContent = SC.target;
  $('#sc-games').textContent = `Games ${SC.gamesMe}–${SC.gamesOpp}`;
  $('#sc-oppname').value = SC.oppName;
  $('#sc-flip').checked = SC.flip;
  $('#pl-opp').classList.toggle('flipped', SC.flip);
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
function wireScore() {
  $$('#v-score [data-p]').forEach((b) => b.onclick = () => scoreBump(b.dataset.p, +b.dataset.d));
  $('#sc-undo').onclick = scoreUndo;
  $('#sc-new').onclick = newGame;
  $('#sc-tminus').onclick = () => { SC.target = Math.max(1, SC.target - 1); saveScore(); renderScore(); };
  $('#sc-tplus').onclick = () => { SC.target = Math.min(30, SC.target + 1); saveScore(); renderScore(); };
  $('#sc-oppname').onchange = (e) => { SC.oppName = e.target.value.trim() || 'Opponent'; saveScore(); };
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
  try { await loadData(); }
  catch { $('#col-empty').classList.remove('hidden'); $('#col-empty').innerHTML = '<p>Price data is still being prepared. Check back in a few minutes.</p>'; return; }
  checkStale();
  show(location.hash === '#scan' ? 'scan' : location.hash === '#score' ? 'score' : location.hash === '#events' ? 'events' : 'collection');
}
init();
