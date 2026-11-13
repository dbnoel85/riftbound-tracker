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
  return `<li style="list-style:none"><div class="card-box"><h3>Open or keep sealed?</h3><p class="sub">Estimated singles value of one 24-pack display at today's market prices. "Sellable" ignores cards under $1, which are hard to sell; "Open" needs sellable singles about 25% above the box price to cover selling fees and effort. Riot doesn't publish pull rates, so hit counts are community estimates — real boxes vary a lot.</p>
    <ul class="dl">${rows.map(({ g, v }) => { const ratio = v.real.total / v.box.m; return `<li data-k="${esc(v.box.k)}"><span class="nm">${esc(g.name)}<small>Box ${money(v.box.m)} · singles ${money(v.all.total)} · sellable ${money(v.real.total)}</small></span><span class="st"><b class="${ratio >= 1 ? 'pos' : 'neg'}">${ratio >= 1.25 ? 'Open' : ratio >= 0.95 ? 'Close call' : 'Keep sealed'}</b><br><small class="sub">${Math.round(ratio * 100)}% of price</small></span></li>`; }).join('')}</ul></div></li>`;
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
  box.insertAdjacentHTML('beforeend', `<div class="card-box errata"><span class="label">Errata · ${esc(fmtDate(x[0].date))}</span><p><b>Current official text:</b><br>${symText(x[0].new)}</p><details><summary class="sub">Printed text</summary><p class="sub">${symText(x[0].old)}</p></details><a class="sub" href="${esc(x[0].url)}" target="_blank" rel="noopener">${esc(x[0].title)} ↗</a></div>`);
}

/* ---------------------------------------------------------------- Rules & guide (learn the game) */
let RULES = null;
async function loadRules() { if (!RULES) { try { RULES = await (await fetch('data/rules.json', { cache: 'no-cache' })).json(); } catch { RULES = { docs: [], articles: [] }; } } return RULES; }
/** official text uses symbols like [M] (might) and [A] (a rune of any color) */
const symText = (t) => esc(t).replace(/\[M\]/g, 'might').replace(/\[A\]/g, '<i>any rune</i>').replace(/\n/g, '<br>');
const LEARN = [
  ['Goal', `<p>Be the first to <b>8 points</b> (11 in 2v2). You score by taking and keeping <b>battlefields</b>:</p>
    <ul><li><b>Conquer</b> — win control of a battlefield on your turn: +1 point.</li><li><b>Hold</b> — still control it at the start of your turn: +1 point.</li></ul>
    <p class="sub"><b>Final-point rule:</b> your winning point can't come from a single conquer. Get it by holding, or by scoring every battlefield in play that turn. Otherwise that conquer draws you a card instead.</p>`],
  ['Your deck', `<ul><li><b>1 Legend</b> — your champion's legend card. It sets your two <b>domains</b> and starts in play.</li>
    <li><b>Main deck: 40 cards</b> — units, spells and gear from your legend's domains (plus colorless). Max 3 copies of a card. Includes your <b>chosen champion</b>, a champion unit matching your legend, set aside to start.</li>
    <li><b>Rune deck: 12 runes</b> — your resources, from your domains.</li>
    <li><b>3 battlefields</b> — you choose one to put into play each game.</li></ul>
    <p class="sub">The app checks these rules for you in My decks.</p>`],
  ['Domains', `<p>Every card belongs to one of six domains (or none):</p><p>${['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order'].map((d) => `<span class="dom ${d}">${d}</span>`).join(' ')}</p>
    <p class="sub">Fury is aggressive damage, Calm protection and patience, Mind tricks and card advantage, Body big sturdy units, Chaos disruption and surprise, Order teamwork and control. Your legend picks two.</p>`],
  ['A turn (A-B-C-D)', `<ol><li><b>Awaken</b> — ready everything you exhausted.</li><li><b>Beginning</b> — score 1 point for each battlefield you hold; start-of-turn effects.</li>
    <li><b>Channel</b> — put the top 2 runes of your rune deck into play (the second player channels 3 on their first turn).</li><li><b>Draw</b> — draw 1 card.</li></ol>
    <p>Then your <b>action phase</b>: exhaust runes for energy and power to play cards, move units from base to battlefields (and back) to attack.</p>`],
  ['Showdowns & combat', `<p>Moving into a battlefield the opponent controls (or contests) starts a <b>showdown</b>: players take turns playing <b>[Action]</b> and <b>[Reaction]</b> cards, then units deal damage equal to their <b>might</b>. Whoever has units left controls the battlefield.</p>
    <p class="sub">[Reaction] cards can be played any time, even mid-showdown or on the opponent's turn. See the keyword glossary for the rest.</p>`],
  ['Starting a game', `<ul><li>Shuffle, choose battlefields, place your legend and chosen champion.</li><li>Draw <b>4 cards</b>; you may recycle up to 2 and redraw that many (mulligan).</li><li>Going second? You channel 3 runes on your first turn to catch up.</li></ul>`],
  ['Formats', `<ul><li><b>Standard</b> — 1v1 Constructed with all legal sets, first to 8. The main tournament format.</li><li><b>2v2 Constructed</b> — teams of two, first to 11, with a few extra bans. Pick yours in Settings.</li><li><b>Sealed / draft</b> — build from packs opened at the event (Legacy is the first draft-focused set).</li></ul>`],
];
async function renderLearn() {
  const R = await loadRules(); await Promise.all([loadGlossary(), loadErrata()]);
  const open = S.prefs.learnOpen ?? 0;
  const docs = (R.docs || []).filter((d) => d.url);
  $('#sheet-content').innerHTML = `<div class="detail learn"><h2>Rules &amp; guide</h2>
    <p class="sub">Everything about how Riftbound works. Official documents are refreshed daily from Riot's Rules Hub and saved in the app so they open offline.</p>
    <div class="dsec">Official rules</div>
    <ul class="list">${docs.map((d) => `<li class="item"><span class="alicon">📘</span><div class="info"><div class="nm" style="white-space:normal">${esc(d.title)}</div><div class="meta">${d.kb ? d.kb.toLocaleString() + ' KB · ' : ''}PDF${d.changed ? ' · <span class="pos">updated</span>' : ''}</div></div>
      <div class="col">${d.local ? `<a class="ghost sm" href="${esc(d.local)}" target="_blank" rel="noopener">Open</a>` : ''}<a class="sub" href="${esc(d.url)}" target="_blank" rel="noopener">Riot ↗</a></div></li>`).join('') || `<li class="item"><div class="info"><div class="nm">Riftbound Rules Hub</div><div class="meta">Core rules, tournament rules and more</div></div><a class="ghost sm" href="${esc(R.hub || 'https://playriftbound.com/en-us/rules-hub/')}" target="_blank" rel="noopener">Open ↗</a></li>`}</ul>
    <div class="dsec">Learn to play</div>
    <div class="acc">${LEARN.map(([t, b], i) => `<details ${i === open ? 'open' : ''} data-i="${i}"><summary>${t}</summary><div class="accb">${b}</div></details>`).join('')}</div>
    <div class="dsec">Look things up</div>
    <div class="tiles">
      <button class="tile" id="lr-gloss"><b>Keywords</b><span>${Object.keys(GL || {}).length} explained</span></button>
      <button class="tile" id="lr-bans"><b>Ban list</b><span>${BAN.byKey.size} cards</span></button>
      <button class="tile" id="lr-errata"><b>Errata</b><span>${Object.keys(ERR || {}).length} updated cards</span></button>
      <button class="tile" id="lr-score"><b>Score counter</b><span>First to 8</span></button>
    </div>
    ${(R.articles || []).length ? `<div class="dsec">Rules updates &amp; FAQs</div><ul class="dl">${R.articles.slice(0, 12).map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener" class="nm" style="color:var(--text);text-decoration:none">${esc(a.title)}<small>${esc(fmtDate(a.date))}</small></a><span class="st">↗</span></li>`).join('')}</ul>` : ''}
    <p class="sub">Quick guide written for this app; when in doubt the official Core Rules win.</p></div>`;
  $$('#sheet-content details').forEach((d) => d.ontoggle = () => { if (d.open) { S.prefs.learnOpen = +d.dataset.i; savePrefs(); } });
  $('#lr-gloss').onclick = () => { GLQ = ''; pushSheet(renderGlossary); };
  $('#lr-bans').onclick = () => pushSheet(renderBanList);
  $('#lr-errata').onclick = () => pushSheet(renderErrataList);
  $('#lr-score').onclick = () => { closeSheet(); show('score'); };
}
function renderErrataList() {
  const e = ERR || {};
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Errata</h2><p class="sub">Cards whose official text changed after printing. The current text is what counts in play. Also shown on each card's page.</p>
    <ul class="dl">${Object.entries(e).sort((a, b) => (b[1][0].date || '').localeCompare(a[1][0].date || '')).map(([n, x]) => { const r = cardRef(n); return `<li style="display:block" ${r ? `data-card="${esc(r.k)}"` : ''}><b>${esc(n)}</b> <small class="sub">· ${esc(fmtDate(x[0].date))}</small><div class="sub" style="margin-top:3px">${symText(x[0].new)}</div></li>`; }).join('') || '<li class="sub">No errata loaded yet.</li>'}</ul></div>`;
}
(function wireLearn() { const b = $('#hdr-learn'); if (b) b.onclick = () => pushSheet(renderLearn); })();

/* ---------------------------------------------------------------- legend vs legend matchup matrix */
let MX = null;           // data/matrix.json (TopDeck.gg rounds), when the daily job has a key
function loadMatrix() {
  if (MX !== null) return Promise.resolve(MX);
  return fetch('data/matrix.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : false)).catch(() => false).then((j) => (MX = j));
}
const mxChamp = (s) => normDeckName(s).split(/\s*[-,–]\s*/)[0];
/** map a legend string from any source onto a meta archetype (for names, art and deck links) */
function mxArch(name) {
  const arch = ranked(), k = normDeckName(name);
  let a = arch.find((x) => normDeckName(x.name) === k);
  if (!a) { const c = mxChamp(name), hits = arch.filter((x) => mxChamp(x.name) === c); if (hits.length === 1 || (hits.length && !/-/.test(name))) a = hits[0]; }
  return a || null;
}
/** {legends: Map(name -> {n, w, a}), get(A, B) -> {w, l, d, n} | null, src, matches} */
function matrixData() {
  const legends = new Map(), cells = new Map();
  const put = (x, y, w, l, d) => { cells.set(x + '|' + y, { w, l, d, n: w + l + d }); cells.set(y + '|' + x, { w: l, l: w, d, n: w + l + d }); };
  const win = MX && MX.windows && (MX.windows[D.win] || MX.windows['30d']);
  let src, matches = 0;
  if (win && win.matches) {
    src = MX.source || 'TopDeck.gg'; matches = win.matches;
    const nm = (s) => (mxArch(s) || { name: s }).name;
    for (const [s, e] of Object.entries(win.legends || {})) { const k = nm(s), o = legends.get(k) || { n: 0, w: 0 }; o.n += e.n; o.w += e.w; legends.set(k, o); }
    for (const [key, [w, l, d]] of Object.entries(win.cells || {})) {
      const [x0, y0] = key.split('|'), x = nm(x0), y = nm(y0); if (x === y) continue;
      const old = cells.get(x + '|' + y); if (old) put(x, y, old.w + w, old.l + l, old.d + d); else put(x, y, w, l, d);
    }
  } else {
    src = 'riftbound.gg deck data';
    const ws = winData();
    for (const a of ws.archetypes) {
      legends.set(a.name, { n: a.winrateN || 0, w: Math.round((a.winrate || 0) * (a.winrateN || 0)) });
      for (const m of a.mu || []) {
        if (!m.n || m.vs === a.name) continue;
        const ex = cells.get(a.name + '|' + m.vs); if (ex && ex.n >= m.n) continue;   // the same games seen from the other side
        const w = Math.round(m.wr * m.n); put(a.name, m.vs, w, m.n - w, 0); matches += m.n;
      }
    }
  }
  for (const [k, e] of legends) e.a = mxArch(k);
  return { legends, get: (x, y) => cells.get(x + '|' + y) || null, src, matches, sparse: !win || !win.matches };
}
function mxColor(p, n) {
  // ember below 50%, rift above; strength grows with distance from even and with sample size
  const t = Math.min(1, Math.abs(p - 0.5) / 0.25) * Math.min(1, 0.35 + n / 60);
  return p >= 0.5 ? `rgba(69,224,208,${(0.12 + t * 0.6).toFixed(2)})` : `rgba(255,106,87,${(0.12 + t * 0.6).toFixed(2)})`;
}
async function renderMatrix() {
  await loadMatrix();
  const M = matrixData();
  const minN = +(S.prefs.mxMin ?? 10);
  const order = [...M.legends.entries()].filter(([, e]) => e.n).sort((a, b) => b[1].n - a[1].n).map(([k]) => k);
  if (!order.length) { $('#dk-info').innerHTML = ''; $('#dk-list').innerHTML = '<li class="empty">No matchup data yet — check back after the next daily update.</li>'; return; }
  let focus = S.prefs.mxFocus && M.legends.has(S.prefs.mxFocus) ? S.prefs.mxFocus : order[0];
  const days = { '30d': 30, '14d': 14, '7d': 7 }[D.win] || 30;
  const pc = (c) => (c.w + c.d / 2) / c.n;
  const short = (s) => s.replace(/\s+-\s+Starter$/, '').split(' - ')[0];
  const fe = M.legends.get(focus);
  const rows = order.filter((o) => o !== focus).map((o) => ({ o, c: M.get(focus, o) })).filter((r) => r.c && r.c.n >= minN).sort((a, b) => pc(b.c) - pc(a.c));
  const top = order.slice(0, Math.min(order.length, 14));
  const legImg = (k) => { const a = M.legends.get(k)?.a; const r = a && cardRef(D.rb[a.leader]?.n || a.name); return r && r.img; };

  $('#dk-info').innerHTML = `How each legend does against the others in tournament play over the last ${days} days. Pick a legend to see its best and worst matchups; the grid reads across a row (row legend's win rate vs the column).
    <span class="flat">(${M.matches.toLocaleString()} matches · ${esc(M.src)})</span>
    ${M.sparse ? '<br><span class="part">Only the strongest and weakest matchup per legend is published in the free deck data, so many grid cells are empty. The full grid fills in once tournament round data is connected.</span>' : ''}
    <div class="mx-ctl"><label>Legend <select id="mx-focus">${order.map((k) => `<option ${k === focus ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    <div class="seg mini" id="mx-min">${[0, 10, 30].map((n) => `<button data-n="${n}" class="${n === minN ? 'on' : ''}">${n ? n + '+ games' : 'All'}</button>`).join('')}</div></div>`;

  const bar = (p) => { const d = Math.round((p - 0.5) * 100); return `<span class="mx-bar"><i class="${d >= 0 ? 'p' : 'n'}" style="${d >= 0 ? 'left:50%' : `right:50%`};width:${Math.min(50, Math.abs(d))}%"></i></span>`; };
  const focusHTML = `<li class="mx-focus">${img(legImg(focus))}<div class="info"><div class="nm">${esc(focus)}</div>
      <div class="meta">${fe.n ? `${Math.round(fe.w / fe.n * 100)}% overall · ${fe.n.toLocaleString()} games` : ''}${fe.a ? ` · <button class="mx-open" data-deck="${esc(fe.a.slug)}">Open deck list</button>` : ''}</div></div></li>` +
    (rows.length ? rows.map(({ o, c }) => { const p = pc(c), a = M.legends.get(o)?.a; return `<li class="mx-row" ${a ? `data-mxf="${esc(o)}"` : ''}>
      <span class="nm">vs ${esc(o)}<small>${c.w}-${c.l}${c.d ? '-' + c.d : ''} · ${c.n.toLocaleString()} games${c.n < 20 ? ' · small sample' : ''}</small></span>${bar(p)}<b class="${p >= 0.5 ? 'pos' : 'neg'}">${Math.round(p * 100)}%</b></li>`; }).join('')
      : `<li class="empty">No matchups for ${esc(short(focus))} with ${minN}+ games${M.sparse ? ' in the free deck data' : ''}. Try <b>All</b>.</li>`);

  const grid = `<li class="mx-wrap"><div class="mx-scroll"><table class="mx"><thead><tr><th class="corner">vs →</th>${top.map((c) => `<th title="${esc(c)}"><span>${esc(short(c))}</span></th>`).join('')}</tr></thead><tbody>` +
    top.map((r) => `<tr class="${r === focus ? 'on' : ''}"><th data-mxf="${esc(r)}">${esc(short(r))}</th>${top.map((c) => {
      if (r === c) return '<td class="self"></td>';
      const x = M.get(r, c); if (!x || x.n < minN) return '<td class="nil">·</td>';
      const p = pc(x); return `<td style="background:${mxColor(p, x.n)}" data-mxc="${esc(r)}|${esc(c)}">${Math.round(p * 100)}<small>${x.n}</small></td>`;
    }).join('')}</tr>`).join('') + `</tbody></table></div><p class="sub">Most-played ${top.length} legends. Big number = row legend's win %, small = games. Tap a row name to focus it.</p></li>`;

  $('#dk-list').innerHTML = focusHTML + grid + (M.src.includes('TopDeck') ? '<li class="sub center">Matchup data provided by <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg</a></li>' : '');
  const setFocus = (k) => { S.prefs.mxFocus = k; savePrefs(); renderMatrix(); $('#v-decks').scrollIntoView({ block: 'start' }); };
  $('#mx-focus').onchange = (e) => setFocus(e.target.value);
  $('#mx-min').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mxMin = +b.dataset.n; savePrefs(); renderMatrix(); };
  $('#dk-list').querySelectorAll('[data-mxf]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); setFocus(el.dataset.mxf); }));
  $('#dk-list').querySelectorAll('[data-mxc]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation(); const [r, c] = el.dataset.mxc.split('|'), x = M.get(r, c);
    toast(`${short(r)} vs ${short(c)}: ${Math.round(pc(x) * 100)}% (${x.w}-${x.l}${x.d ? '-' + x.d : ''}, ${x.n} games)`);
  }));
}
