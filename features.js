/* Extra features layered on top of app.js (same page, shares its globals):
   alerts, value history, binder view, matchups, meta staples, previews, sealed prices,
   keyword glossary, deck import, scan session list, quick tour, search everywhere. */
'use strict';

/* ---------------------------------------------------------------- alerts */
const AL = { list: [] };
function alertsSeen() { return new Set(S.prefs.alertsSeen || []); }
function markSeen(ids) { const s = alertsSeen(); for (const i of ids) s.add(i); S.prefs.alertsSeen = [...s].slice(-400); savePrefs(); updateBell(); }
function computeAlerts() {
  const out = [];
  const recent = new Date(Date.now() - 30 * 864e5).toLocaleDateString('en-CA');
  for (const a of (BAN.data && BAN.data.announcements || []).slice(0, 3)) {
    if (a.review || (a.announced || '') < recent) continue;
    const mine = (a.cards || []).filter((c) => ownedNameCount(c.name) > 0 || MD.decks.some((dk) => [dk.leader, ...Object.keys(dk.main || {})].some((id) => D.rb && D.rb[id] && banKey(D.rb[id].n) === banKey(c.name))));
    out.push({ id: 'ban:' + a.url, icon: '⛔', title: a.title, body: `${(a.cards || []).length} cards${a.effective ? ', effective ' + shortDate(a.effective) : ''}.${mine.length ? ` Affects you: ${mine.map((c) => c.name).join(', ')}.` : ''}`, go: () => { closeSheet(); show('events'); EVS.tab = 'news'; renderEvents(); }, when: a.announced });
  }
  const hits = Object.entries(WL.items || {}).filter(([k, w]) => { const it = S.byKey.get(k); return it && w.target != null && it.m != null && it.m <= w.target; });
  if (hits.length) out.push({ id: 'wish:' + S.cards.updated + ':' + hits.map(([k]) => k).join(','), icon: '♥', title: `${hits.length} wishlist card${hits.length === 1 ? '' : 's'} at or under your target`, body: hits.slice(0, 4).map(([k]) => S.byKey.get(k).n).join(', '), go: () => { closeSheet(); show('collection'); S.prefs.colView = 'wish'; savePrefs(); renderCollection(); }, when: S.cards.updated });
  for (const r of ownedRows()) {
    const it = r.it; if (it.pc == null || it.m == null || Math.abs(it.pc) < 20 || Math.max(it.m, it.w || 0) < 2) continue;
    out.push({ id: `mv:${it.k}:${S.cards.updated}`, icon: it.pc > 0 ? '📈' : '📉', title: `${it.n} ${it.pc > 0 ? 'up' : 'down'} ${Math.abs(Math.round(it.pc))}% this week`, body: `${money(it.w)} → ${money(it.m)} · you own ${r.e.qty}`, go: () => openDetail(it.k), when: S.cards.updated });
  }
  const pv = previewCards();
  if (pv.length) out.push({ id: 'prev:' + pv.length, icon: '✨', title: `${pv.length} new card${pv.length === 1 ? '' : 's'} revealed`, body: 'Cards announced for upcoming sets that aren\'t on TCGplayer yet.', go: () => pushSheet(renderPreviews), when: S.cards.updated });
  for (const g of S.cards.newGroups || []) out.push({ id: 'set:' + g.id, icon: '🆕', title: `New on TCGplayer: ${g.name}`, body: 'Prices for this set are now tracked.', go: () => { closeSheet(); show('add'); }, when: S.cards.updated });
  return out;
}
function ownedNameCount(name) { let n = 0; const k = banKey(name); for (const r of ownedRows()) if (banKey(r.it.n) === k) n += r.e.qty; return n; }
function updateBell() {
  if (!S.cards) return;
  try { AL.list = computeAlerts(); } catch (e) { console.warn(e); AL.list = []; }
  const seen = alertsSeen(), n = AL.list.filter((a) => !seen.has(a.id)).length;
  const b = $('#hdr-alerts .badge'); if (b) { b.textContent = n > 9 ? '9+' : n || ''; b.classList.toggle('hidden', !n); }
  return n;
}
function renderAlerts() {
  const seen = alertsSeen();
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Alerts</h2>
    <ul class="list">${AL.list.map((a, i) => `<li class="item alert ${seen.has(a.id) ? 'read' : ''}" data-al="${i}"><span class="alicon">${a.icon}</span><div class="info"><div class="nm" style="white-space:normal">${esc(a.title)}</div><div class="meta wrap">${esc(a.body)}</div></div></li>`).join('') || '<li class="empty">Nothing new. Alerts show new bans, wishlist price hits, big moves on cards you own and newly revealed cards.</li>'}</ul>
    <div class="row" style="margin-top:10px"><button class="ghost" id="al-read">Mark all read</button>${'Notification' in window ? `<button class="ghost" id="al-notify">${Notification.permission === 'granted' ? '🔔 Phone notifications on' : 'Turn on phone notifications'}</button>` : ''}</div>
    <p class="sub">Phone notifications appear when the app opens and finds something new. (Alerts that arrive while the app is closed would need a notification server — not set up yet.)</p></div>`;
  $$('#sheet-content [data-al]').forEach((li) => li.onclick = () => { const a = AL.list[+li.dataset.al]; markSeen([a.id]); a.go(); });
  $('#al-read').onclick = () => { markSeen(AL.list.map((a) => a.id)); renderAlerts(); };
  const nb = $('#al-notify'); if (nb) nb.onclick = async () => { const p = await Notification.requestPermission(); S.prefs.notify = p === 'granted'; savePrefs(); renderAlerts(); };
}
async function notifyNew() {
  if (!S.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = alertsSeen(), told = new Set(S.prefs.alertsTold || []);
  const fresh = AL.list.filter((a) => !seen.has(a.id) && !told.has(a.id));
  if (!fresh.length) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const title = fresh.length === 1 ? fresh[0].title : `${fresh.length} new Riftbound alerts`;
    const body = fresh.length === 1 ? fresh[0].body : fresh.slice(0, 3).map((a) => a.title).join(' · ');
    if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'rbt-alerts' }); else new Notification(title, { body });
  } catch {}
  S.prefs.alertsTold = [...told, ...fresh.map((a) => a.id)].slice(-400); savePrefs();
}

/* ---------------------------------------------------------------- collection value over time */
async function renderValueHistory() {
  $('#sheet-content').innerHTML = '<div class="detail"><h2>Collection value</h2><p class="sub">Working it out…</p></div>';
  const rows = ownedRows(); const groups = [...new Set(rows.map((r) => r.it.g))];
  const hs = await Promise.all(groups.map((g) => loadHist(g)));
  // every owned card's price on every date (latest known price; its first price before it existed)
  const series = []; const all = new Set();
  groups.forEach((g, gi) => {
    const h = hs[gi]; if (!h) return;
    for (const r of rows.filter((x) => x.it.g === g)) {
      const s = h.s[r.it.k]; if (!s) continue;
      const pts = h.dates.map((d, i) => [d, s[i]]).filter((x) => x[1] != null); if (!pts.length) continue;
      pts.forEach((x) => all.add(x[0])); series.push({ pts, qty: r.e.qty });
    }
  });
  // start where every owned card has a real price, so cards joining later don't bend the line
  const start = series.reduce((m, sr) => sr.pts[0][0] > m ? sr.pts[0][0] : m, '');
  const dates = [...all].filter((d) => d >= start).sort();
  const byDate = new Map(dates.map((d) => [d, 0]));
  for (const sr of series) {
    let j = 0;
    for (const d of dates) { while (j + 1 < sr.pts.length && sr.pts[j + 1][0] <= d) j++; byDate.set(d, byDate.get(d) + sr.pts[j][1] * sr.qty); }
  }
  const pts = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, v }));
  const now = rows.reduce((t, r) => t + r.value, 0);
  const pick = (days) => { const cut = new Date(Date.now() - days * 864e5).toLocaleDateString('en-CA'); return pts.find((p) => p.d >= cut); };
  const delta = (p) => p ? `<b class="${now >= p.v ? 'pos' : 'neg'}">${now >= p.v ? '+' : '−'}${money(Math.abs(now - p.v))}</b>` : '—';
  const best = rows.filter((r) => r.it.d != null).sort((a, b) => b.it.d * b.e.qty - a.it.d * a.e.qty);
  const W = 320, H = 150;
  let path = '';
  if (pts.length > 1) {
    const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v)), span = max - min || 1;
    path = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * (W - 8) + 4).toFixed(1)},${(H - 14 - (p.v - min) / span * (H - 28)).toFixed(1)}`).join('');
  }
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Collection value</h2>
    <div class="card-box mkt"><span class="label">Today</span><b class="big">${money(now)}</b></div>
    <div class="kv"><div><span class="label">7 days</span>${delta(pick(7))}</div><div><span class="label">30 days</span>${delta(pick(30))}</div><div><span class="label">90 days</span>${delta(pick(90))}</div><div><span class="label">Since tracking</span>${delta(pts[0])}</div></div>
    ${path ? `<svg class="chart" viewBox="0 0 ${W} ${H}"><path d="${path}" fill="none" stroke="var(--gold)" stroke-width="2"/></svg><p class="sub">${fmtDate(pts[0].d)} – ${fmtDate(pts[pts.length - 1].d)}. Uses the cards you own today at each day's market price.</p>` : '<p class="sub">Not enough price history yet.</p>'}
    <div class="dsec">Biggest gains this week</div><ul class="dl">${best.slice(0, 5).filter((r) => r.it.d > 0).map((r) => `<li data-card="${esc(r.it.k)}"><span class="nm">${esc(r.it.n)}<small>×${r.e.qty}</small></span><span class="st">${chg(r.it.d * r.e.qty, r.it.pc)}</span></li>`).join('') || '<li class="sub">None this week.</li>'}</ul>
    <div class="dsec">Biggest drops this week</div><ul class="dl">${best.slice().reverse().slice(0, 5).filter((r) => r.it.d < 0).map((r) => `<li data-card="${esc(r.it.k)}"><span class="nm">${esc(r.it.n)}<small>×${r.e.qty}</small></span><span class="st">${chg(r.it.d * r.e.qty, r.it.pc)}</span></li>`).join('') || '<li class="sub">None this week.</li>'}</ul></div>`;
}

/* ---------------------------------------------------------------- binder view (one set as a grid) */
function renderBinder(groupId) {
  const items = S.cards.items.filter((it) => it.g === +groupId && !it.sealed);
  const byP = new Map(); for (const it of items) { if (!byP.has(it.p)) byP.set(it.p, []); byP.get(it.p).push(it); }
  const prods = [...byP.values()].sort((a, b) => numSort(a[0].num) - numSort(b[0].num) || a[0].n.localeCompare(b[0].n));
  const have = (list) => list.reduce((t, it) => t + ((S.inv.items[it.k] || {}).qty || 0), 0);
  const ownedN = prods.filter((l) => have(l) > 0).length;
  return `<p class="sub">${ownedN} of ${prods.length} cards in this set · tap a card to open it.</p><div class="binder">${prods.map((l) => {
    const q = have(l), it = l[0];
    return `<button class="bslot ${q ? 'own' : ''}" data-k="${esc(it.k)}" title="${esc(it.n)}">${it.img ? `<img loading="lazy" decoding="async" src="${esc(it.img)}" alt="">` : '<div class="thumb"></div>'}${q ? `<span class="bq">×${q}</span>` : ''}<span class="bn">${esc(it.num || '')}</span></button>`;
  }).join('')}</div>`;
}
const numSort = (n) => { const m = String(n || '').match(/(\d+)/); return m ? +m[1] : 9999; };

/* ---------------------------------------------------------------- match log + matchups */
const MT_KEY = 'rbt.matches.v1';
const MT = Object.assign({ list: [] }, loadJSON(MT_KEY, {}));
function saveMT() { try { localStorage.setItem(MT_KEY, JSON.stringify(MT)); } catch {} }
function logMatch(m) { MT.list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), ...m }); saveMT(); }
/** every result with an opponent legend: event rounds + games from the Score screen */
function allResults() {
  const out = [];
  for (const m of MT.list) out.push({ res: m.res, leg: m.leg || '', deck: m.deck || '', date: new Date(m.t).toLocaleDateString('en-CA'), src: 'Score screen' });
  return out;
}
function matchupHTML() {
  const res = allResults(); if (!res.length) return '';
  const by = new Map();
  for (const r of res) { const k = r.leg || 'Unknown legend'; const e = by.get(k) || { W: 0, L: 0, D: 0 }; e[r.res] = (e[r.res] || 0) + 1; by.set(k, e); }
  const tot = res.reduce((t, r) => { t[r.res] = (t[r.res] || 0) + 1; return t; }, {});
  const rows = [...by.entries()].sort((a, b) => (b[1].W + b[1].L + b[1].D) - (a[1].W + a[1].L + a[1].D));
  const pct = (e) => { const n = e.W + e.L + (e.D || 0); return n ? Math.round(e.W / n * 100) + '%' : '—'; };
  return `<div class="card-box"><h3>Game-by-game matchups</h3><p class="sub">${res.length} games kept with the Score screen · ${tot.W || 0}-${tot.L || 0}${tot.D ? '-' + tot.D : ''} (${pct({ W: tot.W || 0, L: tot.L || 0, D: tot.D || 0 })} wins). Set their legend on the Score screen to fill this in.</p>
    <ul class="dl">${rows.slice(0, 12).map(([leg, e]) => `<li><span class="nm">vs ${esc(leg)}<small>${e.W}-${e.L}${e.D ? '-' + e.D : ''}</small></span><span class="st"><b class="${e.W >= e.L ? 'pos' : 'neg'}">${pct(e)}</b></span></li>`).join('')}</ul></div>`;
}

/* ---------------------------------------------------------------- meta staples */
function staples(win) {
  const ws = (D.data && D.data.windows) || {};
  const data = win ? ws[win] : null;
  const arch = (data ? data.archetypes : ranked()).filter((a) => a.list || (a.key || []).length);
  const totalShare = arch.reduce((t, a) => t + (a.share || 0), 0) || 1;
  const totalTop = arch.reduce((t, a) => t + (a.share || 0) * (a.top8 || 0), 0) || 1;
  const m = new Map();
  for (const a of arch) {
    const seen = new Set();
    // the archetype's card play rates (how many of its lists run each card) — falls back to the sample list
    const cards = (a.key || []).length ? a.key.map((k) => [k.id, k.x || 1, k.w || 0]) : Object.entries(a.list.main || {}).map(([id, n]) => [id, n, 1]);
    for (const [id, n, w] of cards) {
      const c = D.rb[id]; if (!c || ['Rune', 'Legend'].includes(c.t)) continue;
      const k = banKey(c.n); if (seen.has(k)) continue; seen.add(k);
      const e = m.get(k) || { n: c.n.replace(/\s*\([^)]*\)$/, ''), t: c.t, d: c.d, share: 0, top: 0, copies: 0, decks: [] };
      e.share += (a.share || 0) * w; e.top += (a.share || 0) * (a.top8 || 0) * w; e.copies += n * (a.share || 0) * w; e.decks.push(a.name);
      m.set(k, e);
    }
  }
  return [...m.values()].map((e) => ({ ...e, pct: e.share / totalShare, win: e.top / totalTop, avg: e.copies / (e.share || 1) })).sort((a, b) => b.pct - a.pct);
}
function renderStaples() {
  const mode = S.prefs.stMode || 'played';
  const now = staples(D.win), base = D.win !== '30d' ? staples('30d') : null;
  const prev = new Map((base || []).map((e) => [banKey(e.n), e.pct]));
  for (const e of now) e.trend = base ? e.pct - (prev.get(banKey(e.n)) || 0) : null;
  let list = now.slice();
  if (mode === 'winning') list.sort((a, b) => b.win - a.win);
  if (mode === 'trending') list = list.filter((e) => e.trend != null).sort((a, b) => b.trend - a.trend);
  list = list.slice(0, 60);
  const owned = ownedCountByName();
  $('#dk-info').innerHTML = `<div class="seg mini" id="st-mode"><button data-m="played" class="${mode === 'played' ? 'on' : ''}">Most played</button><button data-m="winning" class="${mode === 'winning' ? 'on' : ''}">In winning lists</button><button data-m="trending" class="${mode === 'trending' ? 'on' : ''}">Trending</button></div>` + ({
    played: 'Cards across the whole meta, weighted by how popular each deck is and how many of its lists run the card.',
    winning: 'Weighted by how often each deck reaches top-8 cuts — the cards in lists that actually win.',
    trending: D.win === '30d' ? 'Pick <b>Last 7 days</b> or <b>Last 14 days</b> above to compare with the last 30 days and see rising tech cards.' : `Cards gaining the most play in the last ${D.win === '7d' ? 7 : 14} days compared with the last 30 — new tech.`,
  })[mode];
  $('#st-mode').onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; S.prefs.stMode = b.dataset.m; savePrefs(); renderStaples(); };
  $('#dk-list').innerHTML = (mode === 'trending' && D.win === '30d') ? '' : list.map((e, i) => {
    const r = cardRef(e.n), have = owned.get(normName(e.n)) || 0, p = cardPrice(e.n);
    const tr = e.trend != null ? `<span class="${e.trend >= 0 ? 'pos' : 'neg'}">${e.trend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(e.trend * 100))} pts</span>` : '';
    return `<li class="item" ${r ? `data-k="${esc(r.k)}"` : ''}>${img(r && r.img)}<div class="info"><div class="nm"><b class="rk">#${i + 1}</b> ${esc(e.n)}${banTag(e.n)}</div>
      <div class="meta wrap">${esc(e.t)} · in <b>${Math.round(e.pct * 100)}%</b> of meta decks · <b>${Math.round(e.win * 100)}%</b> of top-cut weight · ~${e.avg.toFixed(1)} copies ${tr}</div>
      <div class="meta">${have ? `<span class="ok">✓ you own ${have}</span>` : '<span class="part">not owned</span>'} · ${money(p && p.m)}</div></div></li>`;
  }).join('') || '<li class="empty">No deck lists yet.</li>';
}

/* ---------------------------------------------------------------- previews: revealed cards not on TCGplayer yet */
let PV = null;
function previewCards() {
  if (PV) return PV;
  if (!D.rb || !S.cards) return [];
  const known = new Set(S.cards.items.map((it) => banKey(it.n)));
  const sets = new Set(S.cards.groups.map((g) => g.abbr));
  PV = Object.entries(D.rb).filter(([id, c]) => /^[A-Z]+-\d+$/.test(id) && c.n && !known.has(banKey(c.n)) && !sets.has(id.split('-')[0]) && c.t !== 'Rune')
    .map(([id, c]) => ({ id, ...c })).sort((a, b) => a.id.localeCompare(b.id));
  return PV;
}
function renderPreviews() {
  const pv = previewCards(); const bySet = new Map();
  for (const c of pv) { const s = c.id.split('-')[0]; if (!bySet.has(s)) bySet.set(s, []); bySet.get(s).push(c); }
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Revealed cards</h2><p class="sub">Announced cards that aren't sold on TCGplayer yet, so they have no price. They're added to the app automatically once they are.</p>
    ${[...bySet.entries()].map(([s, l]) => `<div class="dsec">${esc(s)} (${l.length})</div><div class="binder">${l.map((c) => `<button class="bslot own" data-prev="${esc(c.id)}" title="${esc(c.n)}"><img loading="lazy" src="https://static.dotgg.gg/riftbound/cards/${esc(c.id)}.webp" alt="" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'thumb'}))"><span class="bn">${esc(c.n)}</span></button>`).join('')}</div>`).join('') || '<p class="sub">Nothing new right now.</p>'}</div>`;
  $$('#sheet-content [data-prev]').forEach((b) => b.onclick = async () => {
    const c = D.rb[b.dataset.prev]; let txt = '';
    try { await loadCardText(); txt = textOf(c.n) || ''; } catch {}
    $('#sheet-content').insertAdjacentHTML('afterbegin', '');
    toast(`<b>${esc(c.n)}</b> · ${esc(c.t)}${c.c != null ? ' · ' + c.c + ' energy' : ''}${txt ? '<br>' + esc(txt.slice(0, 180)) : ''}`, 6000);
  });
}

/* ---------------------------------------------------------------- sealed product prices */
function sealedRows() {
  return S.cards.items.filter((it) => it.sealed && it.m != null).sort((a, b) => b.m - a.m);
}
/* Is a booster display worth opening? Expected singles value of 24 packs, from the pack layout
   (7 common, 3 uncommon, 1 foil, 2 rare-or-better per pack) and community-counted hit rates
   (~6.5 epics, ~3 alternate/special arts, ~0.9 overnumbered per box; signatures ~1 in 360 packs). */
const BOX = { common: 168, uncommon: 72, foil: 24, epic: 6.5, alt: 3, over: 0.9, sig: 24 / 360, ult: 24 / 4000 };
function boxValue(groupId) {
  const items = S.cards.items.filter((it) => it.g === groupId && !it.sealed && it.m != null);
  const pick = (f) => items.filter(f).map((it) => it.m);
  const avg = (a) => a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0;
  const keep = (a, floor) => a.map((v) => v >= floor ? v : 0);
  const tag = (it) => (it.n.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
  const pools = {
    common: pick((it) => it.r === 'Common' && it.s === 'Normal'),
    uncommon: pick((it) => it.r === 'Uncommon' && it.s === 'Normal'),
    foil: pick((it) => (it.r === 'Common' || it.r === 'Uncommon') && it.s === 'Foil'),
    rare: pick((it) => it.r === 'Rare'),
    epic: pick((it) => it.r === 'Epic'),
    alt: pick((it) => it.r === 'Showcase' && /Alternate|Special Art/.test(tag(it))),
    over: pick((it) => it.r === 'Showcase' && /Overnumbered/.test(tag(it))),
    sig: pick((it) => it.r === 'Showcase' && /Signature/.test(tag(it))),
    ult: pick((it) => it.r === 'Showcase' && /Ultimate/.test(tag(it))),
  };
  if (!pools.rare.length || !pools.common.length) return null;
  const hits = BOX.epic + (pools.alt.length ? BOX.alt : 0) + (pools.over.length ? BOX.over : 0);
  const n = { ...BOX, rare: 48 - hits };
  const calc = (floor) => {
    let t = 0; const parts = {};
    for (const k of ['common', 'uncommon', 'foil', 'rare', 'epic', 'alt', 'over', 'sig', 'ult']) { const v = (pools[k].length ? avg(keep(pools[k], floor)) : 0) * (n[k] || 0); parts[k] = v; t += v; }
    return { total: t, parts };
  };
  const box = S.cards.items.find((it) => it.g === groupId && it.sealed && /Booster (Display|Box)$/.test(it.n));
  return { all: calc(0), real: calc(1), box };
}
function boxEvHTML() {
  const rows = S.cards.groups.map((g) => ({ g, v: boxValue(g.id) })).filter((x) => x.v && x.v.box);
  if (!rows.length) return '';
  return `<li style="list-style:none"><div class="card-box"><h3>Open or keep sealed?</h3><p class="sub">Estimated singles value of one 24-pack display at today's market prices. "Sellable" ignores cards under $1, which are hard to sell. Riot doesn't publish pull rates, so hit counts are community estimates — real boxes vary a lot.</p>
    <ul class="dl">${rows.map(({ g, v }) => { const ratio = v.real.total / v.box.m; return `<li data-k="${esc(v.box.k)}"><span class="nm">${esc(g.name)}<small>Box ${money(v.box.m)} · singles ${money(v.all.total)} · sellable ${money(v.real.total)}</small></span><span class="st"><b class="${ratio >= 1 ? 'pos' : 'neg'}">${ratio >= 1.15 ? 'Open' : ratio >= 0.9 ? 'Close call' : 'Keep sealed'}</b><br><small class="sub">${Math.round(ratio * 100)}% of price</small></span></li>`; }).join('')}</ul></div></li>`;
}

/* ---------------------------------------------------------------- keyword glossary */
let GL = null;
async function loadGlossary() { if (!GL) { try { GL = await (await fetch('data/glossary.json')).json(); } catch { GL = {}; } } return GL; }
function keywordsIn(text) {
  if (!GL || !text) return [];
  const out = []; const re = /\[([A-Z][A-Za-z' ]+?)(?: (\d+|X))?\]/g; let m; const seen = new Set();
  while ((m = re.exec(text))) {
    const base = m[1].trim(), k = m[2] ? base + ' N' : base, g = GL[k] || GL[base];
    if (g && !seen.has(base)) { seen.add(base); out.push({ k: base + (m[2] ? ' ' + m[2] : ''), text: m[2] && GL[base + ' N'] ? GL[base + ' N'].text.replace(/\bN\b/g, m[2]) : g.text }); }
  }
  return out;
}
function renderGlossary() {
  const q = (GLQ || '').toLowerCase();
  const items = Object.entries(GL || {}).filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.text.toLowerCase().includes(q));
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Keyword glossary</h2><p class="sub">What each keyword means, taken from the reminder text printed on the cards. For full rules and rulings see the <a href="https://playriftbound.com/en-us/rules-hub/" target="_blank" rel="noopener">Riftbound Rules Hub ↗</a>.</p>
    <input type="search" id="gl-q" placeholder="Search keywords" value="${esc(GLQ || '')}" style="width:100%;margin-bottom:8px">
    <ul class="dl">${items.map(([k, v]) => `<li style="display:block"><b>${esc(k.replace(/ N$/, ' X'))}</b> <small class="sub">· on ${v.cards} cards</small><div class="sub" style="margin-top:2px">${esc(v.text.replace(/\bN\b/g, 'X'))}</div></li>`).join('')}</ul></div>`;
  const inp = $('#gl-q'); inp.oninput = () => { GLQ = inp.value; const pos = inp.selectionStart; renderGlossary(); const n = $('#gl-q'); n.focus(); n.setSelectionRange(pos, pos); };
}
let GLQ = '';

/* ---------------------------------------------------------------- deck import */
function renderDeckImport() {
  $('#sheet-content').innerHTML = `<div class="detail form"><h2>Import a deck list</h2>
    <p class="sub">Paste a list from riftbound.gg, TCGplayer, a friend or a notes app — one card per line like <code>3 Defy</code> or <code>3x Defy</code>. Put your legend on its own line (e.g. <code>1 Jinx - Loose Cannon</code>). Lines after "Sideboard" go to the sideboard.</p>
    <label>Deck name</label><input id="imp-name" placeholder="My imported deck">
    <label>List</label><textarea id="imp-text" rows="14" placeholder="1 Riven - The Exile\n3 Defy\n3 Discipline\n…"></textarea>
    <button class="primary" id="imp-go" style="width:100%;margin-top:10px">Import</button><div id="imp-out" class="sub"></div></div>`;
  $('#imp-go').onclick = () => {
    const byName = new Map();
    for (const [id, c] of Object.entries(D.rb)) { if (!/^[A-Z]+-\d+$/.test(id)) continue; const k = banKey(c.n).replace(/ - /g, ' ').replace(/[^a-z0-9 ]/g, ''); if (!byName.has(k)) byName.set(k, id); }
    const find = (n) => byName.get(banKey(n).replace(/, /g, ' - ').replace(/ - /g, ' ').replace(/[^a-z0-9 ]/g, '').trim());
    const dk = { id: Date.now().toString(36), name: $('#imp-name').value.trim() || 'Imported deck', leader: '', main: {}, side: {}, created: Date.now(), updated: Date.now() };
    let zone = 'main'; const miss = [];
    for (const raw of $('#imp-text').value.split(/\r?\n/)) {
      const line = raw.trim(); if (!line) continue;
      if (/^(side ?board|sideboard:)/i.test(line)) { zone = 'side'; continue; }
      const m = line.match(/^(\d+)\s*[x×]?\s+(.+?)\s*(?:\([^)]*\))?\s*(?:\[[^\]]*\])?\s*$/i);
      if (!m) { if (!/^(main|deck|legend|runes?|battlefields?|champion)/i.test(line)) miss.push(line); continue; }
      const id = find(m[2]); if (!id) { miss.push(m[2]); continue; }
      if (D.rb[id].t === 'Legend' && !dk.leader) { dk.leader = id; continue; }
      dk[zone][id] = (dk[zone][id] || 0) + +m[1];
    }
    if (!dk.leader) { $('#imp-out').innerHTML = '⚠ No legend found — add a line with your legend\'s name.'; return; }
    MD.decks.push(dk); saveMD();
    toast(`Imported ${Object.values(dk.main).reduce((t, n) => t + n, 0)} cards${miss.length ? ` · ${miss.length} line${miss.length === 1 ? '' : 's'} not recognised` : ''}`, 4000);
    SHEET[SHEET.length - 1] = () => renderMyDeck(dk.id); renderMyDeck(dk.id);
    if (miss.length) setTimeout(() => toast('Not recognised: ' + esc(miss.slice(0, 6).join(', ')), 6000), 600);
  };
}

/* ---------------------------------------------------------------- scan session list (with undo) */
const SESS = { list: [] };
function sessionAdd(k) { SESS.list.push({ k, t: Date.now() }); const b = $('#scan-session'); if (b) { b.textContent = `This session (${SESS.list.length})`; b.classList.remove('hidden'); } }
function renderSession() {
  const counts = new Map(); for (const s of SESS.list) counts.set(s.k, (counts.get(s.k) || 0) + 1);
  const total = [...counts.entries()].reduce((t, [k, n]) => t + n * ((S.byKey.get(k) || {}).m || 0), 0);
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Scanned this session</h2><p class="sub">${SESS.list.length} cards · about ${money(total)}. Tap − to undo one.</p>
    <ul class="list">${[...counts.entries()].reverse().map(([k, n]) => { const it = S.byKey.get(k); return it ? `<li class="item">${img(it.img)}<div class="info"><div class="nm">${esc(it.n)}${variantTags(it)}</div><div class="meta">${metaLine(it)} · ×${n} added · ${money(it.m)}</div></div><button class="ghost sm" data-undo="${esc(k)}">−</button></li>` : ''; }).join('')}</ul></div>`;
  $$('#sheet-content [data-undo]').forEach((b) => b.onclick = () => {
    const k = b.dataset.undo, e = S.inv.items[k]; if (!e) return;
    e.qty -= 1; if (e.qty <= 0) delete S.inv.items[k]; saveInv();
    const i = SESS.list.map((x) => x.k).lastIndexOf(k); if (i >= 0) SESS.list.splice(i, 1);
    const sb = $('#scan-session'); if (sb) sb.textContent = `This session (${SESS.list.length})`;
    renderSession();
  });
}

/* ---------------------------------------------------------------- quick tour */
const TOUR = [
  ['Welcome to Riftbound Tracker', 'Your collection, prices, decks and events in one place. Here\'s a 30-second tour.'],
  ['Add cards', 'Tap <b>Scan</b> and hold a card in the frame — it\'s added automatically. Or tap <b>＋</b> to search by name or card text.'],
  ['Collection', 'See what your cards are worth at TCGplayer market price, filter by set, open the binder view, and track your wishlist.'],
  ['Decks', 'Top meta decks, which ones you can build with what you own, swaps for missing or banned cards, and your own decks. Search by legend or card.'],
  ['Events & News', 'Ban list, upcoming sets, big tournament results, and your own event log with matchup stats.'],
  ['Stay in sync', 'In Settings, sign in with Google or email to keep everything the same on your phone, iPad and computer. Backups and daily snapshots keep your data safe.'],
];
function showTour(i = 0) {
  let el = $('#tour'); if (!el) { el = document.createElement('div'); el.id = 'tour'; document.body.appendChild(el); }
  const [t, b] = TOUR[i];
  el.innerHTML = `<div class="tour-card"><div class="tour-step">${i + 1} / ${TOUR.length}</div><h2>${t}</h2><p>${b}</p>
    <div class="row" style="justify-content:space-between;margin-top:14px"><button class="ghost" id="tour-skip">${i === TOUR.length - 1 ? 'Close' : 'Skip'}</button>${i < TOUR.length - 1 ? '<button class="primary" id="tour-next">Next</button>' : '<button class="primary" id="tour-done">Let\'s go</button>'}</div></div>`;
  el.classList.remove('hidden');
  const done = () => { el.classList.add('hidden'); S.prefs.tourDone = 1; savePrefs(); };
  $('#tour-skip').onclick = done;
  const n = $('#tour-next'); if (n) n.onclick = () => showTour(i + 1);
  const d = $('#tour-done'); if (d) d.onclick = done;
}

/* ---------------------------------------------------------------- wiring */
(function wireFeatures() {
  const bell = $('#hdr-alerts'); if (bell) bell.onclick = () => { updateBell(); pushSheet(renderAlerts); };
  const tb = $('#btn-tour'); if (tb) tb.onclick = () => showTour(0);
  const gb = $('#btn-gloss'); if (gb) gb.onclick = async () => { await loadGlossary(); GLQ = ''; pushSheet(renderGlossary); };
  const vh = $('#sum-history'); if (vh) vh.onclick = () => pushSheet(renderValueHistory);
  const sb = $('#scan-session'); if (sb) sb.onclick = () => pushSheet(renderSession);
  window.addEventListener('rbt-sync', () => { MT.list = (loadJSON(MT_KEY, {}).list) || []; });
})();
/** called by app.js once data is loaded */
async function featuresReady() {
  try { if (!D.rb) await loadDecks(); } catch {}
  loadGlossary();
  updateBell(); notifyNew();
  if (!S.prefs.tourDone && !Object.keys(S.inv.items).length) setTimeout(() => showTour(0), 800);
}

/** card page: printed text with keyword explanations */
async function fillDetailText(it) {
  const box = $('#detail-text'); if (!box) return;
  try { await Promise.all([loadCardText(), loadGlossary()]); } catch { return; }
  const tx = textOf(it.n); if (!tx || !tx.text || $('#detail-text') !== box) { fillErrata(it); return; }
  const kws = keywordsIn(tx.text + ' ' + (tx.extra || ''));
  box.innerHTML = `<div class="card-box ctext"><span class="label">Card text</span><p>${esc(tx.text).replace(/\[([^\]]+)\]/g, '<b>[$1]</b>')}</p>
    ${kws.length ? `<div class="kws">${kws.map((k) => `<div><b>${esc(k.k)}</b> — ${esc(k.text)}</div>`).join('')}</div>` : ''}</div>`;
  fillErrata(it);
}

/** card page: official errata (from Riot's errata articles) */
let ERR = null;
async function loadErrata() { if (!ERR) { try { ERR = await (await fetch('data/errata.json')).json(); } catch { ERR = {}; } } return ERR; }
async function fillErrata(it) {
  const e = await loadErrata(); const list = e[banKey(it.n).replace(/\b\w/g, (c) => c)] || null;
  const key = Object.keys(e).find((k) => banKey(k) === banKey(it.n)); const x = key && e[key];
  const box = $('#detail-text'); if (!x || !box) return;
  box.insertAdjacentHTML('beforeend', `<div class="card-box errata"><span class="label">Errata · ${esc(fmtDate(x[0].date))}</span><p><b>Current official text:</b><br>${esc(x[0].new).replace(/\n/g, '<br>')}</p><details><summary class="sub">Printed text</summary><p class="sub">${esc(x[0].old).replace(/\n/g, '<br>')}</p></details><a class="sub" href="${esc(x[0].url)}" target="_blank" rel="noopener">${esc(x[0].title)} ↗</a></div>`);
}
