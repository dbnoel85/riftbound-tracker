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
  $('#title').textContent = { collection: 'Collection', scan: 'Scan cards', add: 'Add cards', movers: 'Top movers', more: 'More' }[view];
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
  const chips = [['all', 'All sets'], ...S.cards.groups.slice().reverse().map((g) => [String(g.id), g.abbr || g.name])];
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
  const shown = res.slice(0, 120);
  $('#add-list').innerHTML = shown.map((items) => productRow(items)).join('') +
    (res.length > shown.length ? `<li class="empty">${res.length - shown.length} more — narrow your search</li>` : '') +
    (!res.length ? '<li class="empty">No matches.</li>' : '');
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
  $('#set-list').innerHTML = S.cards.groups.slice().reverse().map((g) => {
    const n = new Set(S.cards.items.filter((i) => i.g === g.id && !i.sealed).map((i) => i.p)).size;
    return `<li><span>${esc(g.name)} ${g.abbr ? `<span class="sub">${esc(g.abbr)}</span>` : ''}</span><span class="sub">${n} cards</span></li>`;
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
async function openDetail(k) {
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
  const wasOpen = !$('#sheet').classList.contains('hidden');
  $('#sheet').classList.remove('hidden');
  $('#sheet .sheet-body').scrollTop = 0;
  // let the phone's Back gesture/button close the card instead of leaving the app
  if (!wasOpen) { try { history.pushState({ sheet: 1 }, '', '#card'); } catch {} }
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
  if (ser.length < 2) { svg.innerHTML = '<text x="150" y="64" fill="#9aa1bd" font-size="12" text-anchor="middle">History builds up week by week</text>'; return; }
  const vs = ser.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const pts = ser.map((p, i) => [8 + (i / (ser.length - 1)) * 284, 108 - ((p.v - lo) / span) * 92]);
  const col = vs[vs.length - 1] >= vs[0] ? '#3ccf8e' : '#ff6b6b';
  svg.innerHTML = `<polyline fill="none" stroke="${col}" stroke-width="2.5" vector-effect="non-scaling-stroke" points="${pts.map((p) => p.join(',')).join(' ')}"/>
    <text x="6" y="12" fill="#9aa1bd" font-size="10">${money(hi)}</text><text x="6" y="118" fill="#9aa1bd" font-size="10">${money(lo)}</text>
    <text x="294" y="118" fill="#9aa1bd" font-size="10" text-anchor="end">${fmtDate(ser[0].d)} – now</text>`;
}
function hideSheet() { $('#sheet').classList.add('hidden'); refreshCurrent(); }
function closeSheet() {
  if ($('#sheet').classList.contains('hidden')) return;
  if (history.state && history.state.sheet) history.back(); // popstate below hides it
  else hideSheet();
}
window.addEventListener('popstate', () => { if (!$('#sheet').classList.contains('hidden')) hideSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
function refreshCurrent() { if (S.view === 'collection') renderCollection(); if (S.view === 'movers') renderMovers(); }

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
    if (e.target.closest('[data-close]')) { e.preventDefault(); closeSheet(); }
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

async function init() {
  if (location.hash === '#card') { try { history.replaceState(null, '', location.pathname); } catch {} }
  wire();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { await loadData(); }
  catch { $('#col-empty').classList.remove('hidden'); $('#col-empty').innerHTML = '<p>Price data is still being prepared. Check back in a few minutes.</p>'; return; }
  checkStale();
  show(location.hash === '#scan' ? 'scan' : 'collection');
}
init();
