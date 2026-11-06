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
  $('#title').textContent = { collection: 'Collection', scan: 'Scan cards', add: 'Add cards', movers: 'Top movers', decks: 'Meta decks', score: 'Score', more: 'Settings' }[view];
  $('#hdr-add').classList.toggle('hidden', view === 'add' || view === 'score');
  $('#hdr-more').classList.toggle('hidden', view === 'more' || view === 'score');
  if (view === 'score') { renderScore(); keepAwake(true); } else keepAwake(false);
  if (view === 'decks') renderDecks();
  if (view === 'scan') startCamera(); else stopCamera();
  if (view === 'collection') renderCollection();
  if (view === 'add') renderAdd();
  if (view === 'movers') renderMovers();
  if (view === 'more') renderMore();
  window.scrollTo(0, 0);
}

function renderCollection() {
  if (!S.cards) return;
  const rows = ownedRows();
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
  const cmp = {
    value: (a, b) => b.value - a.value,
    'gain$': (a, b) => nz(b.dval, -1e9) - nz(a.dval, -1e9),
    'gain%': (a, b) => nz(b.it.pc, -1e9) - nz(a.it.pc, -1e9),
    'loss%': (a, b) => nz(a.it.pc, 1e9) - nz(b.it.pc, 1e9),
    name: (a, b) => a.it.n.localeCompare(b.it.n),
    set: (a, b) => (a.it.g - b.it.g) || String(a.it.num).localeCompare(String(b.it.num), undefined, { numeric: true }),
    added: (a, b) => b.e.added - a.e.added,
  }[sort];
  list.sort(cmp);
  $('#col-empty').classList.toggle('hidden', rows.length > 0);
  $('#col-list').innerHTML = list.map((r) => `
    <li class="item" data-k="${esc(r.it.k)}">
      ${img(r.it.img)}
      <div class="info">
        <div class="nm">${esc(r.it.n)}${variantTags(r.it)}</div>
        <div class="meta"><span class="qty">×${r.e.qty}</span>${metaLine(r.it)}</div>
        <div class="meta">${money(r.it.m)} each</div>
      </div>
      <div class="px"><b>${money(r.value)}</b><small>${chg(r.dval, r.it.pc)}</small></div>
    </li>`).join('');

  // new-set banner
  const fresh = (S.cards.newGroups || []).filter((g) => !S.prefs.seenNew.includes(g.id));
  const nb = $('#newset');
  if (fresh.length) {
    nb.innerHTML = `🆕 New set added: <b>${fresh.map((g) => esc(g.name)).join(', ')}</b> — now searchable and scannable. <a href="#" id="newset-ok">OK</a>`;
    nb.classList.remove('hidden');
    $('#newset-ok').onclick = (e) => { e.preventDefault(); S.prefs.seenNew.push(...fresh.map((g) => g.id)); savePrefs(); nb.classList.add('hidden'); };
  } else nb.classList.add('hidden');
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
function renderAdd() {
  if (!S.cards) return;
  const chips = [['all', 'All sets'], ...S.cards.groups.map((g) => [String(g.id), g.abbr || g.name])];
  $('#add-sets').innerHTML = chips.map(([v, l]) => `<button data-set="${v}" class="${S.prefs.addSet === v ? 'on' : ''}">${esc(l)}</button>`).join('');
  const q = $('#add-q').value.trim().toLowerCase();
  const sealed = $('#add-sealed').checked;
  const toks = q.split(/\s+/).filter(Boolean);
  const res = [];
  for (const [pid, items] of S.byPid) {
    const it = items[0];
    if (!sealed && it.sealed) continue;
    if (S.prefs.addSet !== 'all' && String(it.g) !== S.prefs.addSet) continue;
    const hay = `${it.n} ${it.num} ${setName(it.g)} ${setAbbr(it.g)} ${it.r}`.toLowerCase().replace(/[^\w/*\- ]/g, '');
    const hay2 = hay.replace(/-/g, ' ');
    if (toks.length && !toks.every((t) => hay.includes(t.replace(/[^\w/*\-]/g, '')) || hay2.includes(t))) continue;
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
const ADD = { res: [], n: 0, obs: null };
function addMore() {
  const list = $('#add-list');
  $('#add-sentinel')?.remove();
  const next = ADD.res.slice(ADD.n, ADD.n + 60);
  ADD.n += next.length;
  list.insertAdjacentHTML('beforeend', next.map((items) => productRow(items)).join(''));
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
    <div class="kv">
      <div><span class="label">Market</span><b>${money(it.m)}</b></div>
      <div><span class="label">This week</span><b>${chg(it.d, it.pc)}</b></div>
      <div><span class="label">Last week</span><b>${money(it.w)}</b></div>
      <div><span class="label">Lowest listing</span><b>${money(it.low)}</b></div>
    </div>
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
function refreshCurrent() { if (S.view === 'collection') renderCollection(); if (S.view === 'movers') renderMovers(); if (S.view === 'decks') renderDecks(); }

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
    getOCR(); loadHashes(); // warm up while aiming
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
  const c = document.createElement('canvas'); c.width = 630; c.height = 880;
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
/** From a still photo: assume the card fills most of the frame; crop to card shape around the centre. */
async function grabFromFile(file) {
  const bmp = await createImageBitmap(file);
  const r = 63 / 88; let w = bmp.width, h = bmp.height;
  let cw = w, ch = cw / r; if (ch > h) { ch = h; cw = ch * r; }
  cw *= 0.94; ch *= 0.94;
  const c = document.createElement('canvas'); c.width = 630; c.height = 880;
  c.getContext('2d').drawImage(bmp, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, 630, 880);
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

function parseNum(s) {
  // "OGN-066a/298", "OGN-001*/298", "OGN 66/298" -> {set, n, suf, tot}
  const m = String(s || '').toUpperCase().match(/([A-Z]{2,4})?[\s\-•·.]*0*(\d{1,3})\s*([A-Z*]?)\s*\/\s*0*(\d{2,3})/);
  return m ? { set: m[1] || '', n: +m[2], suf: (m[3] || '').toLowerCase(), tot: +m[4] } : null;
}
function ocrCodes(text) {
  const out = []; const t = text.toUpperCase().replace(/[|]/g, '1').replace(/O(?=\d)/g, '0');
  const re = /([A-Z]{2,4})?[\s\-•·.:]*0*(\d{1,3})\s*([A-Z*]?)\s*[\/\\]\s*0*(\d{2,3})/g; let m;
  while ((m = re.exec(t))) out.push({ set: m[1] || '', n: +m[2], suf: (m[3] || '').toLowerCase(), tot: +m[4] });
  return out;
}
const norm = (s) => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function scanCanvas(canvas) {
  const status = $('#scan-status');
  status.textContent = 'Reading card…';
  $('#scan-results').innerHTML = '';
  const hashes = await loadHashes();
  const h = dhash(canvas);
  let text = '';
  try {
    const w = await Promise.race([getOCR(), new Promise((_, r) => setTimeout(() => r(new Error('slow')), 20000))]);
    const big = document.createElement('canvas'); big.width = 900; big.height = 1257;
    const bx = big.getContext('2d'); bx.filter = 'grayscale(1) contrast(1.4)'; bx.drawImage(canvas, 0, 0, big.width, big.height);
    const r = await w.recognize(big); text = r.data.text || '';
  } catch (e) { console.warn('OCR', e); }
  const codes = ocrCodes(text);
  const words = new Set(norm(text).split(' ').filter((x) => x.length > 2));

  const scored = [];
  for (const [pid, items] of S.byPid) {
    const it = items[0]; if (it.sealed) continue;
    let s = 0; const why = [];
    const pn = parseNum(it.num);
    if (pn) for (const c of codes) {
      if (c.n === pn.n && c.tot === pn.tot) {
        let add = 45; if (c.set && pn.set && c.set === pn.set) add += 15; if (c.suf === pn.suf) add += 8; else add -= 6;
        if (add > s) { s = add; } why.push('number');
        break;
      }
    }
    const nw = norm(it.n).split(' ').filter((x) => x.length > 2);
    if (nw.length && words.size) {
      const hit = nw.filter((x) => words.has(x)).length / nw.length;
      if (hit > 0) { s += 30 * hit; why.push('name'); }
    }
    const ph = hashes[String(pid)];
    if (ph) { const d = hamming(h, ph); const sim = Math.max(0, 1 - d / 110); s += 40 * sim * sim; if (d < 70) why.push('art'); }
    scored.push({ items, s, why });
  }
  scored.sort((a, b) => b.s - a.s);
  const top = scored.slice(0, 6);
  if (!top.length) { status.textContent = 'No price data loaded yet.'; return; }
  status.innerHTML = codes.length || words.size ? 'Tap the exact version to add it:' : 'Couldn\'t read the text — best guesses by artwork. Or use <b>Add</b> to search.';
  const foil = $('#scan-foil').checked;
  $('#scan-results').innerHTML = top.map((x, i) => {
    const pref = x.items.find((v) => (foil ? v.s !== 'Normal' : v.s === 'Normal')) || x.items[0];
    return productRow(x.items, `<div class="match">${i === 0 ? '<b>Best match</b> · ' : ''}${x.why.length ? 'matched ' + [...new Set(x.why)].join(', ') : 'possible'}</div>`)
      .replace(`data-add="${esc(pref.k)}"`, `data-add="${esc(pref.k)}" style="border-color:var(--gold)"`);
  }).join('');
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
  download(`riftbound-collection-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'riftbound-tracker', version: 1, items }, null, 1), 'application/json');
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
    saveInv(); toast('Backup restored'); show('collection');
  } catch { toast('That file isn\'t a Riftbound Tracker backup'); }
}

/* ---------------------------------------------------------------- wiring */
function wire() {
  $$('.tabs button').forEach((b) => b.onclick = () => show(b.dataset.view));
  $('#hdr-add').onclick = () => show('add');
  $('#hdr-more').onclick = () => show('more');
  wireDecks(); wireScore();
  $('#col-filter').oninput = renderCollection;
  $('#col-sort').value = S.prefs.sort;
  $('#col-sort').onchange = (e) => { S.prefs.sort = e.target.value; savePrefs(); renderCollection(); };
  let t; $('#add-q').oninput = () => { clearTimeout(t); t = setTimeout(renderAdd, 150); };
  $('#add-sealed').onchange = renderAdd;
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
  });
  $('#btn-capture').onclick = async () => {
    const c = grabFromVideo(); if (!c) { toast('Camera not ready — try Photo'); return; }
    if (navigator.vibrate) navigator.vibrate(30);
    scanCanvas(c);
  };
  $('#scan-file').onchange = async (e) => { const f = e.target.files[0]; if (f) scanCanvas(await grabFromFile(f)); e.target.value = ''; };
  $('#btn-export').onclick = exportBackup;
  $('#btn-csv').onclick = exportCSV;
  $('#import-file').onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('#btn-clear').onclick = async () => { if (await confirmBox('Delete every card from your collection? Make a backup first if unsure.')) { S.inv = { items: {} }; saveInv(); toast('Collection cleared'); } };
  $('#btn-refresh').onclick = async () => { try { await loadData(true); S.history = null; renderMore(); checkStale(); toast('Prices are up to date (' + fmtDate(S.cards.updated) + ')'); } catch { toast('Could not reach the price data'); } };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); else if (S.view === 'scan') startCamera(); });
}

/* ---------------------------------------------------------------- meta decks */
const D = { data: null, rb: null, loading: null, tab: 'meta', byName: null, pop: null };
const normName = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/\s-\s(starter)$/, '').replace(/[^a-z0-9]/g, '');
const SECTION_ORDER = [['Legend', 'Legend'], ['Champion', 'Chosen champion'], ['Unit', 'Units'], ['Spell', 'Spells'], ['Gear', 'Gear'], ['Battlefield', 'Battlefields'], ['Rune', 'Runes']];

function loadDecks() {
  if (D.data) return Promise.resolve();
  if (!D.loading) D.loading = Promise.all([fetch('data/decks.json').then((r) => r.json()), fetch('data/rbcards.json').then((r) => r.json())])
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
function cardRef(name) { // a TCGplayer printing to open (prefer normal, then cheapest)
  const list = D.byName.get(normName(name)) || [];
  return list.find((i) => i.s === 'Normal') || list[0] || null;
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

function deckCandidates() {
  const all = D.data.archetypes;
  if (D.tab === 'meta') return all.filter((a) => a.rank <= 10);
  if (D.tab === 'other') return all.filter((a) => a.rank > 10).sort((x, y) => (tierRank(x.tier) - tierRank(y.tier)) || ((y.winrate || 0) - (x.winrate || 0)));
  return all.filter((a) => a.list).map((a) => ({ a, an: analyzeDeck(a) })).sort((x, y) => (y.an.pct - x.an.pct) || (x.an.costMain - y.an.costMain)).slice(0, 20).map((x) => x.a);
}
const tierRank = (t) => ({ S: 0, A: 1, B: 2, C: 3, D: 4 }[t] ?? 5);
const pctTxt = (v) => v == null ? '—' : Math.round(v * 100) + '%';
const domTags = (cols) => (cols || []).map((c) => `<span class="dom ${esc(c)}">${esc(c)}</span>`).join('');

async function renderDecks() {
  if (!S.cards) return;
  $$('#dk-tab button').forEach((b) => b.classList.toggle('on', b.dataset.v === D.tab));
  try { await loadDecks(); } catch { $('#dk-list').innerHTML = '<li class="empty">Deck data isn\'t available yet — check back after the next daily update.</li>'; return; }
  const d = D.data;
  const upd = d.updated ? new Date(d.updated * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  $('#dk-info').textContent = {
    meta: `Most-played legends in the last ${d.window || '30 days'} (${(d.sample.decks || 0).toLocaleString()} decks, ${d.sample.events || 0} events). Updated ${upd}.`,
    other: 'Every other legend, strongest first (tier, then win rate). Each shows its best recent tournament list.',
    ready: 'Lists you\'re closest to building with the cards you own.',
  }[D.tab];
  const rows = deckCandidates();
  $('#dk-list').innerHTML = rows.map((a) => {
    const an = a.list ? analyzeDeck(a) : null;
    const leg = cardRef(D.rb[a.leader]?.n || a.name);
    return `<li class="item" data-deck="${esc(a.slug)}">
      ${img(leg && leg.img)}
      <div class="info">
        <div class="nm">${a.tier ? `<span class="tier ${esc(a.tier)}">${esc(a.tier)}</span>` : ''}${esc(a.name)}</div>
        <div class="meta">${domTags(a.colors)} #${a.rank} · ${a.share}% meta · ${pctTxt(a.winrate)} wins</div>
        ${an ? `<div class="meta">You own ${Math.round(an.pct * 100)}% · ${an.costMain > 0 ? money(an.costMain) + ' to finish' : 'ready to play'}</div><div class="bar"><i style="width:${Math.round(an.pct * 100)}%"></i></div>`
        : '<div class="meta">No public decklist yet</div>'}
      </div>
    </li>`;
  }).join('') || '<li class="empty">Nothing here yet.</li>';
}

function openDeck(slug) { pushSheet(() => renderDeck(slug)); }
function renderDeck(slug) {
  const a = D.data.archetypes.find((x) => x.slug === slug); if (!a) return;
  const leg = cardRef(D.rb[a.leader]?.n || a.name);
  const b = a.best;
  const when = b && b.date ? new Date(b.date * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  let html = `<div class="detail">
    ${leg ? `<img class="detail-img" style="width:44%" src="${esc(bigImg(leg.img))}" onerror="this.onerror=null;this.src='${esc(leg.img)}'" alt="">` : ''}
    <h2>${a.tier ? `<span class="tier ${esc(a.tier)}">${esc(a.tier)}</span>` : ''}${esc(a.name)}</h2>
    <div class="sub">${domTags(a.colors)} Meta rank #${a.rank}</div>
    <div class="kv">
      <div><span class="label">Meta share</span><b>${a.share}%</b></div>
      <div><span class="label">Win rate</span><b>${pctTxt(a.winrate)}</b><small class="sub">${a.winrateN ? a.winrateN.toLocaleString() + ' matches' : ''}</small></div>
      <div><span class="label">Decks played</span><b>${(a.decks || 0).toLocaleString()}</b></div>
      <div><span class="label">Top-8 rate</span><b>${pctTxt(a.top8)}</b></div>
    </div>`;
  if (!a.list) {
    html += `<p class="sub">No full decklist has been published for this legend yet.</p>
      ${a.key && a.key.length ? `<div class="dsec">Key cards</div><ul class="dl">${a.key.map((k) => `<li><span class="cnt">${k.x || ''}×</span><span class="nm">${esc(k.n)}</span><span class="st">${Math.round((k.w || 0) * 100)}% of lists</span></li>`).join('')}</ul>` : ''}</div>`;
    $('#sheet-content').innerHTML = html; return;
  }
  const an = analyzeDeck(a);
  const mode = D.deckMode || 'list';
  html += `${b ? `<p class="sub">List: <b>${ordinal(b.place)} of ${b.players}</b> · ${esc(b.event)}${b.record ? ' · ' + esc(b.record) : ''}${when ? ' · ' + when : ''}</p>` : ''}
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
  html += `<p><a href="https://riftbound.gg/decks/${esc(b.slug)}/" target="_blank" rel="noopener">View this list on riftbound.gg ↗</a></p></div>`;
  $('#sheet-content').innerHTML = html;
  $$('#dk-mode button').forEach((x) => x.onclick = () => { D.deckMode = x.dataset.m; renderDeck(slug); });
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
  $('#dk-tab').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; D.tab = b.dataset.v; renderDecks(); };
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
  if (SC.gamesMe === 2 || SC.gamesOpp === 2) { msg = SC.gamesMe === 2 ? `Match won ${SC.gamesMe}–${SC.gamesOpp}!` : `Match lost ${SC.gamesMe}–${SC.gamesOpp}`; SC.gamesMe = SC.gamesOpp = 0; }
  SC.me = SC.opp = 0; SC.undo = []; SC.done = false;
  saveScore(); renderScore(); if (msg) toast(msg, 3500);
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
  if (location.hash === '#card') { try { history.replaceState(null, '', location.pathname); } catch {} }
  wire();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { await loadData(); }
  catch { $('#col-empty').classList.remove('hidden'); $('#col-empty').innerHTML = '<p>Price data is still being prepared. Check back in a few minutes.</p>'; return; }
  checkStale();
  show(location.hash === '#scan' ? 'scan' : location.hash === '#score' ? 'score' : 'collection');
}
init();
