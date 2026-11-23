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
  // Riot sign-ups: product drawings, registrations, pre-orders — flag them so they aren't missed
  for (const h of (typeof EVS !== 'undefined' && EVS.news && EVS.news.headlines) || []) {
    if ((h.date || '') < recent || !/drawing|raffle|lottery|sign[- ]?up|register|registration|pre-?order|apply|giveaway|ticket/i.test(h.title)) continue;
    out.push({ id: 'news:' + h.url, icon: '📝', title: h.title, body: 'Sign-up or drawing announced — tap to read the details before it closes.', go: () => window.open(h.url, '_blank', 'noopener'), when: h.date });
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
    <ul class="list">${AL.list.map((a, i) => `<li class="item alert ${seen.has(a.id) ? 'read' : ''}" data-al="${i}"><span class="alicon">${a.icon}</span><div class="info"><div class="nm" style="white-space:normal">${esc(a.title)}</div><div class="meta wrap">${esc(a.body)}</div></div></li>`).join('') || '<li class="empty">Nothing new. Alerts show new bans, sign-ups and product drawings, wishlist price hits, big moves on cards you own and newly revealed cards.</li>'}</ul>
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

/* ---------------------------------------------------------------- scan session: review list, repeats, commit */
// Entries are kept on this device (not synced) so a half-reviewed batch survives closing the app.
// e = { id, k, qty, done }  — done: already counted in the collection (instant mode or committed)
const SESS_KEY = 'rbt.session.v1';
const SESS = Object.assign({ list: [] }, loadJSON(SESS_KEY, {}));
const saveSess = () => { try { localStorage.setItem(SESS_KEY, JSON.stringify(SESS)); } catch {} updateSessBtn(); };
const scanReview = () => S.prefs.scanReview !== false;
const scanNoRepeat = () => S.prefs.scanNoRepeat !== false;
const sessProd = (k) => (S.byKey.get(k) || {}).p + '~' + langOf(k);
const sessGet = (id) => SESS.list.find((e) => e.id === id);
function sessCount() { return SESS.list.reduce((t, e) => t + e.qty, 0); }
function sessPending() { return SESS.list.filter((e) => !e.done).reduce((t, e) => t + e.qty, 0); }
function updateSessBtn() {
  const b = $('#scan-session'); if (!b) return;
  const n = sessCount(), p = sessPending();
  b.textContent = p ? `Review (${p})` : `This session (${n})`;
  b.classList.toggle('hidden', !n); b.classList.toggle('pending', !!p);
}
function invBump(k, d, col) { // quiet inventory change (no toast); col = collection id, default the one in view
  if (!d) return; const items = colItems(col ?? curCol()); const e = items[k] || { qty: 0, added: Date.now() };
  e.qty += d; e.added = Date.now(); if (e.qty <= 0) delete items[k]; else items[k] = e; saveInv();
}
/** a scanned card: returns { e, dup } — dup when the same card (any finish) is already in this session */
function sessionAdd(k, { force = false } = {}) {
  k = addKey(k);
  const p = sessProd(k);
  const seen = SESS.list.find((x) => sessProd(x.k) === p);
  if (seen && !force && scanNoRepeat()) return { e: seen, dup: true };
  const review = scanReview();
  const col = curCol();
  let e = SESS.list.find((x) => x.k === k && x.done === !review && (x.col || '') === col);
  if (e) e.qty += 1; else { e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), k, qty: 1, done: !review, col }; SESS.list.push(e); }
  if (e.done) invBump(k, 1, col);
  saveSess(); if (S.view === 'collection') renderCollection();
  return { e, dup: false };
}
function sessSetQty(id, q) {
  const e = sessGet(id); if (!e) return; q = Math.max(0, Math.min(999, Math.round(q) || 0));
  if (e.done) invBump(e.k, q - e.qty, e.col || '');
  if (q === 0) SESS.list = SESS.list.filter((x) => x !== e); else e.qty = q;
  saveSess();
}
function sessSwap(id, k) {
  const e = sessGet(id); if (!e || e.k === k) return e;
  if (e.done) { invBump(e.k, -e.qty, e.col || ''); invBump(k, e.qty, e.col || ''); }
  const twin = SESS.list.find((x) => x !== e && x.k === k && x.done === e.done && (x.col || '') === (e.col || ''));
  if (twin) { twin.qty += e.qty; SESS.list = SESS.list.filter((x) => x !== e); saveSess(); return twin; }
  e.k = k; saveSess(); return e;
}
function sessCommit() {
  const todo = SESS.list.filter((e) => !e.done); if (!todo.length) return 0;
  let n = 0; for (const e of todo) { invBump(e.k, e.qty, e.col || ''); e.done = true; n += e.qty; }
  // merge rows that are now the same card in the same collection
  const m = new Map(); for (const e of SESS.list) { const id = e.k + '@' + (e.col || ''); const o = m.get(id); if (o) o.qty += e.qty; else m.set(id, e); } SESS.list = [...m.values()];
  saveSess(); return n;
}
async function sessClear() {
  const p = sessPending();
  if (p && !(await confirmBox(`${p} card${p === 1 ? ' hasn\'t' : 's haven\'t'} been added to your collection yet. Clear the list anyway?`))) return false;
  SESS.list = []; saveSess(); return true;
}
function renderSession() {
  const rows = SESS.list.slice().reverse();
  const val = (e) => e.qty * ((S.byKey.get(e.k) || {}).m || 0);
  const total = rows.reduce((t, e) => t + val(e), 0), pend = sessPending();
  const finishes = (k) => { const it = S.byKey.get(k); return it ? (S.byPid.get(it.p) || [it]).map((v) => S.byKey.get(withLang(v.k, langOf(k)))) : []; };
  $('#sheet-content').innerHTML = `<div class="detail sess"><h2>Scanned this session</h2>
    <p class="sub">${sessCount()} cards · about ${money(total)}.${pend ? ` <b class="part">${pend} waiting for review</b> — check each one, fix the finish or count, then add them all.` : ' Everything here is already in your collection; changes you make here update it.'}</p>
    ${pend ? '<button class="primary" id="ss-commit" style="width:100%;padding:13px">Add ' + pend + ' card' + (pend === 1 ? '' : 's') + ' to my collection</button>' : ''}
    <ul class="list sesslist">${rows.map((e) => { const it = S.byKey.get(e.k); if (!it) return ''; const fs = finishes(e.k);
      return `<li class="item ${e.done ? '' : 'pending'}">${img(it.img)}<div class="info"><div class="nm">${esc(it.n)}</div>
        <div class="meta">${metaLine(it)} · ${money(it.m)}${e.done ? ' · <span class="ok">in collection</span>' : ' · <span class="part">to review</span>'}${colList().length > 1 ? ` · → ${esc(colName(e.col || ''))}` : ''}</div>
        ${fs.length > 1 ? `<div class="finrow">${fs.map((v) => `<button class="${v.k === e.k ? 'on' : ''}" data-fin="${esc(e.id)}|${esc(v.k)}">${esc(v.s)}</button>`).join('')}</div>` : ''}
        <div class="qtyrow"><button data-qty="${esc(e.id)}|-1" aria-label="One fewer">−</button><input type="number" inputmode="numeric" min="0" max="999" value="${e.qty}" data-qin="${esc(e.id)}" aria-label="Copies"><button data-qty="${esc(e.id)}|1" aria-label="One more">+</button><button class="rm" data-qty="${esc(e.id)}|x" aria-label="Remove">Remove</button></div>
      </div></li>`; }).join('') || '<li class="empty">Nothing scanned yet.</li>'}</ul>
    <div class="row" style="margin-top:12px">${rows.length ? '<button class="ghost" id="ss-clear">Clear list &amp; start a new batch</button>' : ''}</div>
    <p class="sub">Tip: with <b>Review before adding</b> on, scans wait here until you add them. With <b>Ignore repeats</b> on, showing the same card again is skipped — use + here for real extra copies.</p></div>`;
  const re = () => renderSession();
  $$('#sheet-content [data-qty]').forEach((b) => b.onclick = () => { const [id, d] = b.dataset.qty.split('|'); const e = sessGet(id); if (!e) return; sessSetQty(id, d === 'x' ? 0 : e.qty + +d); re(); });
  $$('#sheet-content [data-qin]').forEach((i) => i.onchange = () => { sessSetQty(i.dataset.qin, +i.value); re(); });
  $$('#sheet-content [data-fin]').forEach((b) => b.onclick = () => { const [id, k] = b.dataset.fin.split('|'); sessSwap(id, k); re(); });
  const c = $('#ss-commit'); if (c) c.onclick = () => { const n = sessCommit(); toast(`Added ${n} card${n === 1 ? '' : 's'} to your collection`); if (S.view === 'collection') renderCollection(); re(); };
  const cl = $('#ss-clear'); if (cl) cl.onclick = async () => { if (await sessClear()) { closeSheet(); toast('Ready for the next batch'); } };
}
/** the big "got it" moment over the camera */
function scanFlash(it, kind) {
  const f = $('#scan-flash'); if (!f || !it) return;
  const txt = { added: 'Added to collection', review: 'Added to review list', dup: 'Already scanned — skipped' }[kind];
  f.className = 'scan-flash show ' + kind;
  f.innerHTML = `<div class="sf-card">${it.img ? `<img src="${esc(it.img)}" alt="">` : ''}<div class="sf-txt"><b>${kind === 'dup' ? '↺' : '✓'} ${esc(it.n)}</b><span>${it.lang && it.lang !== 'en' ? esc(langTag(it.lang)) + ' · ' : ''}${esc(it.s !== 'Normal' ? it.s + ' · ' : '')}${money(it.m)}</span><small>${txt}</small></div></div>`;
  $('.cam-wrap')?.classList.remove('hit', 'hitdup', 'hitrev'); void f.offsetWidth; $('.cam-wrap')?.classList.add(kind === 'dup' ? 'hitdup' : kind === 'review' ? 'hitrev' : 'hit');
  clearTimeout(scanFlash.t); scanFlash.t = setTimeout(() => { f.classList.remove('show'); $('.cam-wrap')?.classList.remove('hit', 'hitdup', 'hitrev'); }, kind === 'dup' ? 1100 : 1500);
}

/* ---------------------------------------------------------------- quick tour */
const TOUR = [
  ['Welcome to Riftbound Tracker', 'Your collection, prices, decks and events in one place. Here\'s a 30-second tour.'],
  ['Add cards', 'Tap <b>Scan</b> and hold a card in the frame. Scans wait in a review list until you add them. You can also search by name, or import a list from another app in Settings.'],
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
  const rv = $('#scan-review'); if (rv) { rv.checked = scanReview(); rv.onchange = () => { S.prefs.scanReview = rv.checked; savePrefs(); toast(rv.checked ? 'Scans wait in the review list until you add them' : 'Scans go straight into your collection'); }; }
  const nr = $('#scan-norepeat'); if (nr) { nr.checked = scanNoRepeat(); nr.onchange = () => { S.prefs.scanNoRepeat = nr.checked; savePrefs(); }; }
  const bn = $('#scan-byname'); if (bn) bn.onclick = () => show('add');
  for (const id of ['#scan-lang', '#add-lang']) { const sel = $(id); if (!sel) continue;
    sel.innerHTML = LANGS.map(([l, n]) => `<option value="${l}">${esc(n)}</option>`).join(''); sel.value = S.prefs.cardLang || 'en';
    sel.onchange = () => { S.prefs.cardLang = sel.value; savePrefs(); $$('#scan-lang, #add-lang').forEach((x) => { x.value = sel.value; x.closest('label')?.classList.toggle('langon', sel.value !== 'en'); }); toast(sel.value === 'en' ? 'Adding English cards' : `Adding <b>${esc(langName(sel.value))}</b> cards — switch back to English when you're done`); if (S.view === 'add') renderAdd(); };
    sel.closest('label')?.classList.toggle('langon', (S.prefs.cardLang || 'en') !== 'en'); }
  const cl = $('#col-lang'); if (cl) cl.onchange = () => { S.prefs.colLang = cl.value; savePrefs(); renderCollection(); };
  updateSessBtn();
  window.addEventListener('rbt-sync', () => { MT.list = (loadJSON(MT_KEY, {}).list) || []; });
})();
/** called by app.js once data is loaded */
async function featuresReady() {
  try { if (!D.rb) await loadDecks(); } catch {}
  loadGlossary();
  if (!EVS.news) { try { EVS.news = await (await fetch('data/news.json')).json(); } catch {} }
  checkShareLink();
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
    </div>
    ${(R.articles || []).length ? `<div class="dsec">Rules updates &amp; FAQs</div><ul class="dl">${R.articles.slice(0, 12).map((a) => `<li><a href="${esc(a.url)}" target="_blank" rel="noopener" class="nm" style="color:var(--text);text-decoration:none">${esc(a.title)}<small>${esc(fmtDate(a.date))}</small></a><span class="st">↗</span></li>`).join('')}</ul>` : ''}
    <p class="sub">Quick guide written for this app; when in doubt the official Core Rules win.</p></div>`;
  $$('#sheet-content details').forEach((d) => d.ontoggle = () => { if (d.open) { S.prefs.learnOpen = +d.dataset.i; savePrefs(); } });
  $('#lr-gloss').onclick = () => { GLQ = ''; pushSheet(renderGlossary); };
  $('#lr-bans').onclick = () => pushSheet(renderBanList);
  $('#lr-errata').onclick = () => pushSheet(renderErrataList);
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
  const allMode = S.prefs.mxAll === true;
  let order = [...M.legends.entries()].filter(([, e]) => e.n).sort((a, b) => b[1].n - a[1].n).map(([k]) => k);
  if (allMode && typeof legendNames === 'function') for (const n0 of legendNames()) { const a = mxArch(n0), n = a ? a.name : n0; if (!M.legends.has(n)) { M.legends.set(n, { n: 0, w: 0, a }); order.push(n); } }
  if (!order.length) { $('#dk-info').innerHTML = ''; $('#dk-list').innerHTML = '<li class="empty">No matchup data yet — check back after the next daily update.</li>'; return; }
  let focus = S.prefs.mxFocus && M.legends.has(S.prefs.mxFocus) ? S.prefs.mxFocus : order[0];
  const days = { '30d': 30, '14d': 14, '7d': 7 }[D.win] || 30;
  const pc = (c) => (c.w + c.d / 2) / c.n;
  const short = (s) => s.replace(/\s+-\s+Starter$/, '').split(' - ')[0];
  const fe = M.legends.get(focus);
  const rows = order.filter((o) => o !== focus).map((o) => ({ o, c: M.get(focus, o) })).filter((r) => r.c && r.c.n >= minN).sort((a, b) => pc(b.c) - pc(a.c));
  const top = allMode ? order : order.slice(0, Math.min(order.length, 14));
  const legImg = (k) => { const a = M.legends.get(k)?.a; const r = a && cardRef(D.rb[a.leader]?.n || a.name); return r && r.img; };

  $('#dk-info').innerHTML = `How each legend does against the others in tournament play over the last ${days} days. Pick a legend to see its best and worst matchups; the grid reads across a row (row legend's win rate vs the column).
    <span class="flat">(${M.matches.toLocaleString()} matches · ${esc(M.src)})</span>
    ${M.sparse ? '<br><span class="part">Only the strongest and weakest matchup per legend is published in the free deck data, so many grid cells are empty. The full grid fills in once tournament round data is connected.</span>' : ''}
    <div class="mx-ctl"><label>Legend <select id="mx-focus">${order.map((k) => `<option ${k === focus ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></label>
    <div class="seg mini" id="mx-all"><button data-a="0" class="${allMode ? '' : 'on'}">Most played</button><button data-a="1" class="${allMode ? 'on' : ''}">All legends</button></div>
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
    }).join('')}</tr>`).join('') + `</tbody></table></div><p class="sub">${allMode ? `All ${top.length} legends` : `Most-played ${top.length} legends`}. Big number = row legend's win %, small = games. Tap a row name to focus it.</p></li>`;

  $('#dk-list').innerHTML = focusHTML + grid + (M.src.includes('TopDeck') ? '<li class="sub center">Matchup data provided by <a href="https://topdeck.gg" target="_blank" rel="noopener">TopDeck.gg</a></li>' : '');
  const setFocus = (k) => { S.prefs.mxFocus = k; savePrefs(); renderMatrix(); $('#v-decks').scrollIntoView({ block: 'start' }); };
  $('#mx-focus').onchange = (e) => setFocus(e.target.value);
  $('#mx-all').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mxAll = b.dataset.a === '1'; savePrefs(); renderMatrix(); };
  $('#mx-min').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; S.prefs.mxMin = +b.dataset.n; savePrefs(); renderMatrix(); };
  $('#dk-list').querySelectorAll('[data-mxf]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); setFocus(el.dataset.mxf); }));
  $('#dk-list').querySelectorAll('[data-mxc]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation(); const [r, c] = el.dataset.mxc.split('|'), x = M.get(r, c);
    toast(`${short(r)} vs ${short(c)}: ${Math.round(pc(x) * 100)}% (${x.w}-${x.l}${x.d ? '-' + x.d : ''}, ${x.n} games)`);
  }));
}

/* ---------------------------------------------------------------- import a collection from another app */
// Accepts CSV exports (TCGplayer app/collection, Collectr, ManaBox-style, spreadsheets) or plain lines
// like "3 Jinx, Loose Cannon", "2x OGN-251 foil", "OGN-066". Matching order: TCGplayer product ID,
// set code + number, then name (preferring the set if one is given). Nothing is added until you confirm.
const impKey = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9()]+/g, ' ').replace(/\s+/g, ' ').trim();
let IMPIDX = null;
function impIndex() {
  if (IMPIDX) return IMPIDX;
  const byName = new Map(), byCode = new Map(), abbr = new Map(S.cards.groups.map((g) => [g.id, (g.abbr || '').toUpperCase()]));
  for (const items of S.byPid.values()) {
    const it = items[0]; if (it.sealed) continue;
    const add = (m, k) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(items); };
    add(byName, impKey(it.n)); add(byName, impKey(it.n.replace(/\s*\([^)]*\)\s*$/, '')) + ' §base');
    const m = String(it.num || '').match(/^0*(\d{1,3})([a-z*]?)/i), ab = abbr.get(it.g);
    if (m && ab) add(byCode, `${ab}-${+m[1]}${(m[2] || '').toLowerCase()}`);
  }
  return (IMPIDX = { byName, byCode });
}
function splitCSV(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out.map((x) => x.trim());
}
function parseImport(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/\t/g) || []).length > (lines[0].match(/,/g) || []).length ? '\t' : lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = splitCSV(lines[0], sep).map((h) => h.toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n || h.replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, '')));
  const ci = { qty: col('quantity', 'qty', 'count', 'total quantity', 'add to quantity', 'amount', 'owned'), name: col('name', 'card name', 'product name', 'card', 'title', 'simple name'),
    set: col('set', 'set name', 'edition', 'expansion', 'group'), code: col('set code', 'setcode'), num: col('card number', 'number', 'collector number', 'no', '#'),
    foil: col('printing', 'foil', 'finish', 'variance', 'treatment', 'foil type'), variant: col('variant', 'version', 'art', 'edition type'), rarity: col('rarity'), lang: col('language', 'lang'), pid: col('product id', 'tcgplayer id', 'tcgplayer product id', 'productid') };
  const rows = [];
  if (ci.name >= 0 || ci.pid >= 0 || ci.num >= 0) {
    for (const l of lines.slice(1)) { const c = splitCSV(l, sep), g = (i) => (i >= 0 ? c[i] || '' : '');
      const f = g(ci.foil); rows.push({ raw: l, csv: true, fRaw: f, qty: parseInt(g(ci.qty), 10) || (ci.qty >= 0 ? 0 : 1), name: g(ci.name), set: g(ci.set), code: g(ci.code), num: g(ci.num), pid: g(ci.pid), rarity: g(ci.rarity), variant: g(ci.variant), lang: impLang(g(ci.lang)), foil: /foil|holo/i.test(f) && !/non/i.test(f) ? true : f && /normal|non/i.test(f) ? false : null }); }
  } else {
    for (const l of lines) { let t = l.trim(); let qty = 1; const m = t.match(/^(\d+)\s*x?\s+(.*)$/i) || t.match(/^(.*?)\s+x\s*(\d+)$/i);
      if (m) { if (/^\d/.test(m[1])) { qty = +m[1]; t = m[2]; } else { t = m[1]; qty = +m[2]; } }
      const lang = impLang(t); if (lang !== 'en') t = t.replace(/\s*[\[(]?\b(chinese|simplified|traditional|japanese|korean|french|german|spanish|italian|portuguese|zh|cn|jp|ja|kr|ko)\b[\])]?|中文|简体|繁體|日本語|한국어/ig, ' ').trim();
      const VW = /\s*[\[(]?\b(alt(ernate)?[\s-]*art|alt|over[\s-]*numbered|signature|signed|showcase|promo)\b[\])]?/ig;
      const variant = (t.match(VW) || []).join(' '); t = t.replace(VW, ' ').replace(/\s+/g, ' ').trim();
      const foil = /\b(foil|holo)\b/i.test(t) ? true : null; t = t.replace(/\s*[\[(]?\b(foil|holo|normal|non-foil)\b[\])]?/ig, '').trim();
      const cm = t.match(/^([A-Z]{2,4})[-\s]?0*(\d{1,3}[a-z*]?)\b\s*(.*)$/i);
      rows.push({ raw: l, variant, qty, name: cm ? cm[3] : t, code: cm ? cm[1] : '', num: cm ? cm[2] : '', set: '', pid: '', foil, lang }); }
  }
  return rows.filter((r) => r.qty > 0 && (r.name || r.pid || r.num));
}
function impLang(v) {
  v = String(v || '');
  if (/traditional|繁|zh-?tw|zh-?hant/i.test(v)) return 'zh-tw';
  if (/chinese|simplified|中文|简|\bzh\b|\bcn\b|zh-?cn|zh-?hans/i.test(v)) return 'zh';
  if (/japanese|日本|\bja\b|\bjp\b/i.test(v)) return 'ja';
  if (/korean|한국|\bko\b|\bkr\b/i.test(v)) return 'ko';
  if (/french|fran[cç]ais/i.test(v)) return 'fr'; if (/german|deutsch/i.test(v)) return 'de'; if (/spanish|espa[nñ]ol/i.test(v)) return 'es';
  if (/italian|italiano/i.test(v)) return 'it'; if (/portug/i.test(v)) return 'pt';
  return 'en';
}
/* which set a row means: set code column, a code inside the number ("OGN-027a"), or a set name written loosely */
function impGroups(r) {
  const out = new Set(), groups = S.cards.groups;
  const code = String(r.code || '').trim().toUpperCase() || (String(r.num || '').match(/^\s*([A-Z]{2,4})[-\s]/i) || [])[1]?.toUpperCase();
  if (code) for (const g of groups) if ((g.abbr || '').toUpperCase() === code) out.add(g.id);
  if (r.set) { const w = impKey(r.set).replace(/^riftbound\s*/, '');
    for (const g of groups) { const gn = impKey(g.name).replace(/^riftbound\s*/, ''); if (w && gn && (gn === w || gn.includes(w) || w.includes(gn) || (g.abbr || '').toLowerCase() === w)) out.add(g.id); } }
  return out;
}
const impNum = (s) => { const m = String(s || '').replace(/^\s*[A-Z]{2,4}[-\s]+/i, '').match(/0*(\d{1,3})([a-z*]?)/i); return m ? `${+m[1]}${(m[2] || '').toLowerCase()}` : ''; };
/** words in the row that point to a special printing */
function impVariantWant(r) {
  const t = (r.csv ? [r.name, r.variant, r.rarity, r.fRaw].join(' ') : r.raw + ' ' + (r.variant || '')).toLowerCase();
  return { alt: /alt(ernate)?[\s-]*art|\balt\b/.test(t), over: /over[\s-]*number/.test(t), sig: /signature|signed/.test(t), show: /showcase/.test(t), promo: /\bpromo/.test(t) };
}
function matchImport(r) {
  const X = impIndex();
  if (r.pid && S.byPid.get(+r.pid)) return impLangPick(S.byPid.get(+r.pid), r);
  // every printing this row could be: by name (with or without a variant tag) and by set + number
  const pool = new Map(); const addL = (l) => { for (const items of l || []) pool.set(items[0].p, items); };
  if (r.name) { addL(X.byName.get(impKey(r.name))); addL(X.byName.get(impKey(r.name.replace(/\s*\([^)]*\)\s*/g, ' ')) + ' §base')); }
  const gs = impGroups(r), num = impNum(r.num);
  if (num) for (const [code, l] of X.byCode) if (code.endsWith('-' + num) && (!gs.size || l.some((x) => gs.has(x[0].g)))) addL(l.filter((x) => !gs.size || gs.has(x[0].g)));
  let l = [...pool.values()]; if (!l.length) return null;
  const nm = (x) => (r.name ? printBase(x[0].n) === printBase(r.name) : true);
  if (r.name && l.some(nm)) l = l.filter(nm);
  // narrow down: exact number first (027a = alternate art, 299 = overnumbered), then set, then variant words
  const numOf = (x) => impNum(x[0].num), want = impVariantWant(r), wantAny = Object.values(want).some(Boolean);
  // a plain number ("240") next to words like "Alternate Art" may be the base number: then only the digits must agree
  const loose = wantAny && /^\d+$/.test(num);
  const numOk = (x) => (loose ? parseInt(numOf(x), 10) === +num : numOf(x) === num);
  if (num && l.some(numOk)) l = l.filter(numOk);
  if (gs.size && l.some((x) => gs.has(x[0].g))) l = l.filter((x) => gs.has(x[0].g));
  const tags = (x) => x[0].n.toLowerCase();
  const prefer = [[want.alt, (x) => /alternate art/.test(tags(x))], [want.over, (x) => /overnumbered/.test(tags(x))], [want.sig, (x) => /signature/.test(tags(x))],
    [want.show, (x) => x[0].r === 'Showcase'], [want.promo, (x) => x[0].r === 'Promo' || !!PROMO_GROUPS[x[0].g]]];
  for (const [on, fn] of prefer) if (on && l.some(fn)) l = l.filter(fn);
  if (l.length > 1 && !(num && !loose) && !wantAny) { // nothing says it's special: standard art from a main set
    const g2 = impGroupSize();
    l.sort((a, b) => /\(/.test(a[0].n) - /\(/.test(b[0].n) || (g2.get(b[0].g) || 0) - (g2.get(a[0].g) || 0) || (a[0].m ?? 1e9) - (b[0].m ?? 1e9));
  }
  return impLangPick(l[0], r);
}
function impLangPick(items, r) {
  if (!items) return null;
  const lang = r.lang && r.lang !== 'en' ? r.lang : (IMP.lang || 'en');
  const it = pickFinish0(items, r);
  return it && (lang === 'en' ? it : S.byKey.get(withLang(it.k, lang)));
}
function pickFinish0(items, r) {
  const pick = r.foil === true ? items.find((v) => v.s !== 'Normal') : r.foil === false ? items.find((v) => v.s === 'Normal') : items.find((v) => v.s === 'Normal');
  return pick || items[0];
}
let IMPGS = null;
function impGroupSize() { if (!IMPGS) { IMPGS = new Map(); for (const it of S.cards.items) if (!it.sealed) IMPGS.set(it.g, (IMPGS.get(it.g) || 0) + 1); } return IMPGS; }
function openImport() { pushSheet(renderImport); }
let IMP = { text: '', rows: null };
function renderImport() {
  const res = IMP.rows;
  const ok = res ? res.filter((x) => x.it) : [], bad = res ? res.filter((x) => !x.it) : [];
  const n = ok.reduce((t, x) => t + x.r.qty, 0), val = ok.reduce((t, x) => t + x.r.qty * (x.it.m || 0), 0);
  $('#sheet-content').innerHTML = `<div class="detail form"><h2>Import cards</h2>
    ${colList().length > 1 ? `<label>Import into</label><select id="imp-col">${colList().map((c) => `<option value="${esc(c.id)}" ${c.id === (IMP.col ?? curCol()) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
    <p class="sub">Export your collection from the other app as a CSV or text list, then pick the file or paste it here. Works with TCGplayer exports and most collection apps (columns like Quantity, Name, Set, Number, Printing/Foil). Plain lists work too: <i>3 Jinx, Loose Cannon</i>, <i>2x OGN-251 foil</i>.</p>
    <label>Card language (when the list doesn't say)</label><select id="imp-lang">${LANGS.map(([l, n]) => `<option value="${l}" ${l === (IMP.lang || 'en') ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    <label class="ghost filebtn" for="imp-file" style="display:block;text-align:center">Choose a file…</label><input type="file" id="imp-file" accept=".csv,.txt,.tsv,text/*" hidden>
    <textarea id="imp-text" rows="6" placeholder="…or paste the list here" style="width:100%;margin-top:8px">${esc(IMP.text)}</textarea>
    <button class="ghost" id="imp-check" style="width:100%;margin-top:8px">Check the list</button>
    ${res ? `<div class="card-box" style="margin-top:12px"><b>${ok.length} of ${res.length} lines matched</b> · ${n.toLocaleString()} cards · about ${money(val)}
        ${bad.length ? `<p class="sub" style="margin:6px 0 0">${bad.length} not recognised (listed below) — fix the name or number in the box and check again, or add them by hand later.</p>` : ''}
        ${(() => { const sp = ok.filter((x) => /\(/.test(x.it.n) || x.it.r === 'Showcase' || promoKind(x.it)); return sp.length ? `<p class="sub" style="margin:6px 0 0">Includes <b>${sp.reduce((t, x) => t + x.r.qty, 0)}</b> alternate art, overnumbered, signature, showcase or promo cards.</p>` : ''; })()}
        <div class="seg mini" id="imp-mode" style="margin-top:10px"><button data-m="add" class="${IMP.mode !== 'replace' ? 'on' : ''}">Add to what I have</button><button data-m="replace" class="${IMP.mode === 'replace' ? 'on' : ''}">Replace with this list</button></div>
        <button class="primary" id="imp-go" style="width:100%;margin-top:10px" ${ok.length ? '' : 'disabled'}>${IMP.mode === 'replace' ? `Replace "${esc(colName(IMP.col ?? curCol()))}" with these ${n.toLocaleString()} cards` : `Add ${n.toLocaleString()} cards to my collection`}</button>
        <p class="sub" style="margin:6px 0 0">${IMP.mode === 'replace' ? 'Use this to redo an earlier import: the collection is emptied first, then filled from this list.' : 'Adds to what you already have.'} A backup snapshot is saved first, so you can undo from Settings → Backup.</p></div>
      ${bad.length ? `<div class="dsec">Not recognised</div><ul class="dl">${bad.slice(0, 40).map((x) => `<li><span class="nm">${esc(x.r.raw)}</span></li>`).join('')}</ul>` : ''}
      <div class="dsec">Matched</div><ul class="dl">${ok.slice(0, 150).map((x) => `<li><span class="cnt">${x.r.qty}×</span><span class="nm">${esc(x.it.n)}<small>${esc(setName(x.it.g))} · ${esc(x.it.num || '')} · ${esc(x.it.s)}${x.it.lang && x.it.lang !== 'en' ? ' · ' + esc(langName(x.it.lang)) : ''}</small></span><span class="st">${money(x.it.m)}</span></li>`).join('')}${ok.length > 150 ? `<li class="sub">…and ${ok.length - 150} more</li>` : ''}</ul>` : ''}</div>`;
  const ic = $('#imp-col'); if (ic) ic.onchange = () => { IMP.col = ic.value; };
  const il = $('#imp-lang'); if (il) il.onchange = () => { IMP.lang = il.value; if (IMP.rows) check(); };
  $('#imp-file').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; IMP.text = await f.text(); check(); };
  const check = () => { IMP.text = IMP.text || $('#imp-text').value; IMP.rows = parseImport(IMP.text).map((r) => ({ r, it: matchImport(r) })); renderImport(); };
  $('#imp-check').onclick = () => { IMP.text = $('#imp-text').value; check(); };
  const md = $('#imp-mode'); if (md) md.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; IMP.mode = b.dataset.m; renderImport(); };
  const go = $('#imp-go'); if (go) go.onclick = async () => {
    const rep = IMP.mode === 'replace';
    if (!(await confirmBox(rep ? `Empty "${colName(IMP.col ?? curCol())}" and replace it with these ${n.toLocaleString()} cards? A backup is saved first.` : `Add ${n.toLocaleString()} cards (${ok.length} different) to "${colName(IMP.col ?? curCol())}"?`))) return;
    try { await takeSnapshot('before import'); } catch {}
    const col = IMP.col ?? curCol();
    if (rep) { const items = colItems(col); for (const k of Object.keys(items)) delete items[k]; saveInv(); }
    for (const x of ok) invBump(x.it.k, x.r.qty, col);
    IMP = { text: '', rows: null, lang: IMP.lang, mode: 'add' }; S.prefs.colId = col; savePrefs(); closeSheet(); show('collection'); toast(`Imported ${n.toLocaleString()} cards into ${esc(colName(col))}`);
  };
}

/* ---------------------------------------------------------------- several collections (e.g. Chinese cards kept apart) */
function newColId() { return 'c' + Date.now().toString(36); }
function switchCol(id) { S.prefs.colId = id; S.prefs.colSet = 'all'; savePrefs(); renderColPickers(); if (S.view === 'collection') renderCollection(); }
function renderColPickers() {
  const list = colList(), cur = curCol();
  const opts = list.map((c) => `<option value="${esc(c.id)}" ${c.id === cur ? 'selected' : ''}>${esc(c.name)}</option>`).join('') + '<option value="__new">＋ New collection…</option>';
  for (const sel of $$('#col-pick, #scan-col')) if (sel.innerHTML !== opts) sel.innerHTML = opts;
  const sw = $('#scan-colwrap'); if (sw) sw.classList.toggle('hidden', list.length < 2);
}
function newColSheet(back) {
  pushSheet(() => {
    $('#sheet-content').innerHTML = `<div class="detail form"><h2>New collection</h2>
      <p class="sub">Keep a separate set of cards — for example Chinese-language cards, a trade binder, or cards you're selling. Pick which collection to look at from the top of Collection, and which one scans go into on the Scan screen.</p>
      <label>Name</label><input id="nc-name" maxlength="40" placeholder="e.g. Chinese cards">
      <label class="toggle small" style="margin-top:10px"><input type="checkbox" id="nc-decks"> Count these cards for deck building and the wishlist</label>
      <button class="primary" id="nc-go" style="width:100%;margin-top:14px">Create collection</button></div>`;
    setTimeout(() => $('#nc-name').focus(), 50);
    $('#nc-go').onclick = () => {
      const name = $('#nc-name').value.trim(); if (!name) { toast('Give it a name'); return; }
      const id = newColId(); INV.cols = INV.cols || {}; INV.cols[id] = { name, items: {}, decks: $('#nc-decks').checked, created: Date.now() }; saveInv();
      closeSheet(); switchCol(id); toast(`Now showing "${esc(name)}" — scans go here too`);
    };
  });
}
function renderManageCols() {
  const list = colList(), counts = (id) => Object.values(colItems(id)).reduce((t, e) => t + (e.qty || 0), 0);
  const val = (id) => Object.entries(colItems(id)).reduce((t, [k, e]) => t + (e.qty || 0) * ((S.byKey.get(k) || {}).m || 0), 0);
  $('#sheet-content').innerHTML = `<div class="detail form"><h2>Collections</h2>
    <p class="sub">Each collection has its own cards and value. Deck building and the wishlist count the collections ticked below.</p>
    <ul class="list colman">${list.map((c) => `<li class="item"><div class="info">
      <input data-cname="${esc(c.id)}" value="${esc(c.name)}" maxlength="40" aria-label="Collection name">
      <div class="meta">${counts(c.id).toLocaleString()} cards · ${money(val(c.id))}${c.id === curCol() ? ' · <span class="ok">showing now</span>' : ''}</div>
      <label class="toggle small"><input type="checkbox" data-cdecks="${esc(c.id)}" ${c.decks ? 'checked' : ''} ${c.id ? '' : 'disabled'}> Count for decks &amp; wishlist</label>
      <div class="row" style="gap:6px;margin-top:6px">${c.id === curCol() ? '' : `<button class="ghost sm" data-cshow="${esc(c.id)}">Show</button>`}
        ${list.length > 1 && counts(c.id) ? `<select data-cmove="${esc(c.id)}"><option value="">Move all cards to…</option>${list.filter((o) => o.id !== c.id).map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select>` : ''}
        ${c.id ? `<button class="ghost sm danger" data-cdel="${esc(c.id)}">Delete</button>` : ''}</div>
    </div></li>`).join('')}</ul>
    <button class="primary ghost" id="cm-new" style="width:100%;padding:13px;margin-top:10px">＋ New collection</button></div>`;
  const re = () => { renderManageCols(); renderColPickers(); if (S.view === 'collection') renderCollection(); };
  $$('#sheet-content [data-cname]').forEach((i) => i.onchange = () => { const v = i.value.trim(); if (!v) return; if (i.dataset.cname) INV.cols[i.dataset.cname].name = v; else INV.name = v; saveInv(); re(); });
  $$('#sheet-content [data-cdecks]').forEach((i) => i.onchange = () => { INV.cols[i.dataset.cdecks].decks = i.checked; saveInv(); re(); });
  $$('#sheet-content [data-cshow]').forEach((b) => b.onclick = () => { switchCol(b.dataset.cshow); re(); });
  $$('#sheet-content [data-cmove]').forEach((sel) => sel.onchange = async () => {
    const from = sel.dataset.cmove, to = sel.value; if (!to && to !== '') return; if (sel.selectedIndex === 0) return;
    if (!(await confirmBox(`Move every card from "${colName(from)}" into "${colName(to)}"?`))) { sel.selectedIndex = 0; return; }
    try { await takeSnapshot('before moving cards'); } catch {}
    const src = colItems(from), dst = colItems(to);
    for (const [k, e] of Object.entries(src)) { const o = dst[k]; dst[k] = o ? { ...o, qty: (o.qty || 0) + (e.qty || 0) } : e; delete src[k]; }
    saveInv(); toast('Cards moved'); re();
  });
  $$('#sheet-content [data-cdel]').forEach((b) => b.onclick = async () => {
    const id = b.dataset.cdel, n = counts(id);
    if (!(await confirmBox(`Delete "${colName(id)}"${n ? ` and its ${n} cards` : ''}? A snapshot is kept under Settings → Backup.`))) return;
    try { await takeSnapshot('before deleting a collection'); } catch {}
    delete INV.cols[id]; if (S.prefs.colId === id) { S.prefs.colId = ''; savePrefs(); } saveInv(); re();
  });
  $('#cm-new').onclick = () => newColSheet();
}
(function wireCols() {
  const onPick = (sel) => sel && (sel.onchange = () => { if (sel.value === '__new') { renderColPickers(); newColSheet(); return; } switchCol(sel.value); toast(`Showing "${esc(colName())}"`); });
  onPick($('#col-pick')); onPick($('#scan-col'));
  const m = $('#col-manage'); if (m) m.onclick = () => pushSheet(renderManageCols);
})();

/* ---------------------------------------------------------------- collection filters (variant · type · price & more) */
// Within a group, chips are OR (Foil or Promo); between groups they're AND (Foil and Unit and $20–30).
const CF_TAGS = (it) => (it.n.match(/\(([^)]*)\)/g) || []).join(' ');
const CF_PROMO_G = (g) => /promo/i.test(setName(g));
const CF_GROUPS = [
  { id: 'v', title: 'Variant', chips: [
    ['foil', 'Foil', (it) => it.s !== 'Normal'],
    ['base', 'Base (non-foil)', (it) => it.s === 'Normal'],
    ['promo', 'Promo', (it) => it.r === 'Promo' || CF_PROMO_G(it.g)],
    ['op', 'Nexus Night / Org Play', (it) => it.g === 24528],
    ['champ', 'Champion', (it) => /champion/i.test(CF_TAGS(it))],
    ['serial', 'Serialized', (it) => /serial/i.test(CF_TAGS(it))],
    ['signed', 'Signed', (it) => /signature/i.test(CF_TAGS(it))],
    ['alt', 'Alternate art', (it) => it.r === 'Showcase' || /alternate|overnumbered|metal|special art|prize wall|best of/i.test(CF_TAGS(it))],
  ] },
  { id: 't', title: 'Type', chips: (() => {
    const T = (it) => String(it.t || ''), P = (it) => new Set(T(it).split(';'));
    return [
      ['battlefield', 'Battlefield', (it) => P(it).has('Battlefield') && !P(it).has('Token')],
      ['champion', 'Champion', (it) => T(it) === 'Champion Unit'],
      ['gear', 'Gear', (it) => T(it) === 'Gear'],
      ['legend', 'Legend', (it) => T(it) === 'Legend'],
      ['rune', 'Rune', (it) => T(it) === 'Rune'],
      ['sig', 'Signature', (it) => T(it).startsWith('Signature')],
      ['sigspell', 'Signature spell', (it) => T(it) === 'Signature Spell'],
      ['sigunit', 'Signature unit', (it) => T(it) === 'Signature Unit'],
      ['siggear', 'Signature gear', (it) => T(it) === 'Signature Gear'],
      ['spell', 'Spell', (it) => T(it) === 'Spell'],
      ['token', 'Token', (it) => P(it).has('Token')],
      ['tokbf', 'Token battlefield', (it) => P(it).has('Token') && P(it).has('Battlefield')],
      ['unit', 'Unit', (it) => P(it).has('Unit') || T(it).endsWith(' Unit')],
      ['unitgear', 'Unit gear', (it) => P(it).has('Unit') && P(it).has('Gear') && !P(it).has('Token')],
    ];
  })() },
  { id: 'p', title: 'Price (each)', chips: [
    ['p0', 'Under $1', (it) => it.m != null && it.m < 1], ['p1', '$1–5', (it) => it.m >= 1 && it.m < 5], ['p5', '$5–10', (it) => it.m >= 5 && it.m < 10],
    ['p10', '$10–20', (it) => it.m >= 10 && it.m < 20], ['p20', '$20–30', (it) => it.m >= 20 && it.m < 30], ['p30', '$30–50', (it) => it.m >= 30 && it.m < 50],
    ['p50', '$50–100', (it) => it.m >= 50 && it.m < 100], ['p100', '$100+', (it) => it.m >= 100], ['pnone', 'No price', (it) => it.m == null],
  ] },
  { id: 'o', title: 'More', chips: [
    ['up', 'Up this week', (it) => it.pc != null && it.pc > 0], ['down', 'Down this week', (it) => it.pc != null && it.pc < 0],
    ['dupes', 'Duplicates (2+)', (it, r) => r.e.qty >= 2], ['playset', 'Playset (3+)', (it, r) => r.e.qty >= 3], ['single', 'Only one copy', (it, r) => r.e.qty === 1],
    ['new', 'Added in last 7 days', (it, r) => Date.now() - (r.e.added || 0) < 7 * 864e5],
    ['paid', 'Purchase price set', (it, r) => r.e.cost != null], ['profit', 'In profit', (it, r) => r.e.cost != null && it.m != null && it.m > r.e.cost],
    ['loss', 'At a loss', (it, r) => r.e.cost != null && it.m != null && it.m < r.e.cost], ['graded', 'Graded', (it, r) => !!r.e.grader], ['played', 'Not Near Mint', (it, r) => !!r.e.cond && r.e.cond !== 'NM'],
  ] },
  { id: 'r', title: 'Rarity', chips: ['Common', 'Uncommon', 'Rare', 'Epic', 'Showcase', 'Promo'].map((x) => [x, x, (it) => it.r === x]) },
  { id: 'd', title: 'Domain', needsInfo: true, chips: ['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order', 'Colorless'].map((x) => [x, x, (it) => { const c = cardInfo(it.n); const d = (c && c.d) || []; return x === 'Colorless' ? c && !d.filter((y) => y !== 'Colorless').length : d.includes(x); }]) },
];
const CF = () => (S.prefs.cf = S.prefs.cf || {});
function cfActive() { const f = CF(); let n = 0; for (const g of CF_GROUPS) n += (f[g.id] || []).length; if (f.min != null) n++; if (f.max != null) n++; return n; }
function cfPass(r) {
  const f = CF(), it = r.it;
  for (const g of CF_GROUPS) {
    const on = f[g.id] || []; if (!on.length) continue;
    if (g.needsInfo && !D.rb) continue;
    if (!g.chips.some(([id, , fn]) => on.includes(id) && fn(it, r))) return false;
  }
  if (f.min != null && !(it.m != null && it.m >= f.min)) return false;
  if (f.max != null && !(it.m != null && it.m <= f.max)) return false;
  return true;
}
function cfSummary(list, rows) {
  const n = cfActive(), b = $('#col-fcount'), act = $('#col-factive');
  const shown = list.reduce((t, r) => t + r.e.qty, 0); const dn = $('#cf-done'); if (dn) dn.textContent = `Show ${shown.toLocaleString()} card${shown === 1 ? '' : 's'}`;
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); $('#col-fbtn').classList.toggle('on', !!n); }
  if (!act) return;
  if (!n) { act.classList.add('hidden'); act.innerHTML = ''; return; }
  const f = CF(), chips = [];
  for (const g of CF_GROUPS) for (const [id, label] of g.chips) if ((f[g.id] || []).includes(id)) chips.push(`<button data-cfx="${g.id}|${esc(id)}">${esc(label)} ✕</button>`);
  if (f.min != null) chips.push(`<button data-cfx="min|">Over ${money(f.min)} ✕</button>`);
  if (f.max != null) chips.push(`<button data-cfx="max|">Under ${money(f.max)} ✕</button>`);
  const v = list.reduce((t, r) => t + r.value, 0), q = list.reduce((t, r) => t + r.e.qty, 0);
  act.innerHTML = `<div class="fa-line"><b>${q.toLocaleString()}</b> of ${rows.reduce((t, r) => t + r.e.qty, 0).toLocaleString()} cards match · <b>${money(v)}</b> <button class="linkbtn" id="cf-clear">Clear all</button></div><div class="fa-chips">${chips.join('')}</div>`;
  act.classList.remove('hidden');
  act.querySelectorAll('[data-cfx]').forEach((x) => x.onclick = () => { const [g, id] = x.dataset.cfx.split('|'); if (g === 'min' || g === 'max') delete f[g]; else f[g] = (f[g] || []).filter((y) => y !== id); savePrefs(); renderCollection(); renderCFPanel(); });
  $('#cf-clear').onclick = () => { S.prefs.cf = {}; savePrefs(); renderCollection(); renderCFPanel(); };
}
function renderCFPanel() {
  const pn = $('#col-fpanel'); if (!pn || pn.classList.contains('hidden')) return;
  const f = CF();
  // only offer chips that match something you own (keeps the panel short), plus anything already switched on
  const rows = ownedRows();
  const has = (g, id, fn) => (f[g.id] || []).includes(id) || (g.needsInfo && !D.rb) || rows.some((r) => fn(r.it, r));
  pn.innerHTML = CF_GROUPS.map((g) => {
    const chips = g.chips.filter(([id, , fn]) => has(g, id, fn));
    if (!chips.length) return '';
    return `<div class="fgroup"><div class="fg-h">${esc(g.title)}${(f[g.id] || []).length ? ` <button class="linkbtn" data-cfg="${g.id}">clear</button>` : ''}</div>
      <div class="fchips">${chips.map(([id, label]) => `<button class="${(f[g.id] || []).includes(id) ? 'on' : ''}" data-cf="${g.id}|${esc(id)}">${esc(label)}</button>`).join('')}</div>
      ${g.id === 'p' ? `<div class="frange"><span>Custom</span><input type="number" inputmode="decimal" min="0" step="1" id="cf-min" placeholder="Min $" value="${f.min ?? ''}"><span>to</span><input type="number" inputmode="decimal" min="0" step="1" id="cf-max" placeholder="Max $" value="${f.max ?? ''}"></div>` : ''}</div>`;
  }).join('') + `<div class="row" style="margin-top:8px"><button class="primary" id="cf-done" style="flex:1">Show cards</button><button class="ghost" id="cf-reset">Clear all</button></div>`;
  pn.querySelectorAll('[data-cf]').forEach((b) => b.onclick = () => {
    const [g, id] = b.dataset.cf.split('|'); const a = f[g] = f[g] || []; const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else a.push(id);
    if (g === 'd' && !D.rb) loadDecks().then(() => { renderCollection(); renderCFPanel(); }, () => {});
    savePrefs(); renderCollection(); renderCFPanel();
  });
  pn.querySelectorAll('[data-cfg]').forEach((b) => b.onclick = () => { f[b.dataset.cfg] = []; savePrefs(); renderCollection(); renderCFPanel(); });
  const num = (v) => (v === '' || v == null || isNaN(+v) ? null : +v);
  const mn = $('#cf-min'), mx = $('#cf-max');
  const upd = () => { const a = num(mn.value), b = num(mx.value); if (a == null) delete f.min; else f.min = a; if (b == null) delete f.max; else f.max = b; savePrefs(); renderCollection(); };
  if (mn) { mn.onchange = upd; mx.onchange = upd; }
  $('#cf-done').onclick = () => toggleCF(false);
  renderCollection();
  $('#cf-reset').onclick = () => { S.prefs.cf = {}; savePrefs(); renderCollection(); renderCFPanel(); };
}
function toggleCF(open) {
  const pn = $('#col-fpanel'), b = $('#col-fbtn'); if (!pn) return;
  open = open ?? pn.classList.contains('hidden');
  pn.classList.toggle('hidden', !open); b.setAttribute('aria-expanded', open);
  if (open) { if ((CF().d || []).length && !D.rb) loadDecks().then(renderCollection, () => {}); renderCFPanel(); }
}
(function wireCF() { const b = $('#col-fbtn'); if (b) b.onclick = () => toggleCF(); })();

/* ---------------------------------------------------------------- add a card to one of my decks (from any card page) */
let RBID = null;
function rbIdOf(name) {
  if (!D.rb) return null;
  if (!RBID) { RBID = new Map(); for (const [id, c] of Object.entries(D.rb)) { const n = normName(c.n); if (n && (!RBID.has(n) || isBaseId(id))) RBID.set(n, id); } }
  return RBID.get(normName(name)) || null;
}
async function openAddToDeck(name) {
  if (!D.rb) { toast('Loading cards…'); try { await loadDecks(); } catch { toast('Could not load deck data — check your connection'); return; } }
  const cid = rbIdOf(name); if (!cid) { toast("That card can't go in a deck"); return; }
  MDS.zone2 = MDS.zone2 || 'main';
  pushSheet(() => renderAddToDeck(cid));
}
function renderAddToDeck(cid) {
  const c = D.rb[cid], legend = c.t === 'Legend', r = cardRef(c.n);
  const zone = legend ? 'main' : MDS.zone2;
  const decks = MD.decks.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const fits = (dk) => { const l = D.rb[dk.leader]; if (!l || legend) return true; return (c.d || []).every((d) => d === 'Colorless' || l.d.includes(d)); };
  $('#sheet-content').innerHTML = `<div class="detail"><div class="row atd-head" style="gap:12px;align-items:center">${img(r && r.img)}<div><h2 style="margin:0">${esc(c.n)}</h2><div class="sub">${esc([c.t, c.c != null ? c.c + ' energy' : '', (c.d || []).join('/')].filter(Boolean).join(' · '))}</div></div></div>
    ${legend ? '<p class="sub">Legends lead a deck — picking a deck makes this its legend.</p>' : `<div class="seg" id="atd-zone" style="margin-top:12px"><button data-z="main" class="${zone === 'main' ? 'on' : ''}">Main deck</button><button data-z="side" class="${zone === 'side' ? 'on' : ''}">Sideboard</button></div>`}
    <button class="primary" id="atd-new" style="width:100%;padding:13px;margin:12px 0">＋ New deck ${legend ? 'with this legend' : 'starting with this card'}</button>
    ${decks.length ? `<div class="dsec">My decks</div><ul class="dl atd">${decks.map((dk) => { const z = zone === 'side' ? dk.side : dk.main, n = legend ? (dk.leader === cid ? 1 : 0) : (z[cid] || 0), cn = mdCounts(dk), lg = D.rb[dk.leader];
      return `<li><span class="nm">${esc(dk.name)}<small>${lg ? esc(lg.n.split(' - ')[0]) : 'No legend yet'} · ${cn.main}/40${!fits(dk) ? ' · <span class="part">outside its domains</span>' : ''}</small></span>
        <span class="mstep">${legend ? `<button class="ghost sm" data-atdleg="${esc(dk.id)}" ${n ? 'disabled' : ''}>${n ? '✓ Legend' : 'Make legend'}</button>` : `<button data-atd="${esc(dk.id)}|-1" aria-label="Remove one" ${n ? '' : 'disabled'}>−</button><b>${n}</b><button data-atd="${esc(dk.id)}|1" aria-label="Add one">+</button>`}</span></li>`; }).join('')}</ul>` : '<p class="sub">No decks yet — start one above.</p>'}</div>`;
  const re = () => renderAddToDeck(cid);
  const zs = $('#atd-zone'); if (zs) zs.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; MDS.zone2 = b.dataset.z; re(); };
  $('#atd-new').onclick = () => pushSheet(() => renderNewDeck(cid));
  $$('#sheet-content [data-atd]').forEach((b) => b.onclick = () => {
    const [id, d] = b.dataset.atd.split('|'); const dk = mdGet(id), z = zone === 'side' ? dk.side : dk.main;
    if (+d > 0 && c.t !== 'Rune') { let total = 0; for (const zz of [dk.main, dk.side]) for (const [k2, n2] of Object.entries(zz)) if (D.rb[k2] && normName(D.rb[k2].n) === normName(c.n)) total += n2; if (total >= 3) { toast('Max 3 copies of a card'); return; } }
    mdBump(id, cid, zone, +d); toast(+d > 0 ? `Added to <b>${esc(dk.name)}</b>` : `Removed from <b>${esc(dk.name)}</b>`); re();
  });
  $$('#sheet-content [data-atdleg]').forEach((b) => b.onclick = () => { const dk = mdGet(b.dataset.atdleg); if (dk.leader) delete dk.main[dk.leader]; dk.leader = cid; dk.main[cid] = 1; dk.updated = Date.now(); saveMD(); toast(`${esc(c.n.split(' - ')[0])} now leads <b>${esc(dk.name)}</b>`); re(); });
}

/* ---------------------------------------------------------------- deck testing: sample hands, mulligan, turns, odds */
// Core rules: each player draws 4; mulligan = set aside up to 2, draw that many, recycle them (bottom of deck).
// 1v1: you draw 1 each turn (including the first), channel 2 runes each turn; the player going second channels 1 extra on their first turn.
// The chosen champion starts in its own zone, so one copy is taken out of the deck you draw from.
const DT = {};
function hyperAtLeast1(N, K, n) { if (K <= 0) return 0; if (n >= N) return 1; let p = 1; for (let i = 0; i < n; i++) p *= (N - K - i) / (N - i); return 1 - Math.max(0, p); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function openDeckTest(main, leader, name) {
  const leg = D.rb[leader];
  const deck = [], runes = []; let champ = null;
  for (const [id, n] of Object.entries(main)) { const c = D.rb[id]; if (!c) continue;
    if (c.t === 'Rune') { for (let i = 0; i < n; i++) runes.push(id); continue; }
    if (c.t === 'Legend' || c.t === 'Battlefield') continue;
    for (let i = 0; i < n; i++) deck.push(id); }
  if (leg && leg.tg && leg.tg.length) { const i = deck.findIndex((id) => D.rb[id].st === 'Champion' && (D.rb[id].tg || []).some((t) => leg.tg.includes(t))); if (i >= 0) champ = deck.splice(i, 1)[0]; }
  Object.assign(DT, { name, deckAll: deck, runesAll: runes, champ, second: DT.second || false });
  dtNewHand(); pushSheet(renderDeckTest);
}
function dtNewHand() {
  DT.lib = shuffle(DT.deckAll.slice()); DT.rlib = shuffle(DT.runesAll.slice());
  DT.hand = DT.lib.splice(0, 4); DT.sel = new Set(); DT.mull = false; DT.turn = 0; DT.pool = []; DT.drawn = [];
}
function dtNextTurn() {
  DT.turn += 1; DT.mull = true;
  if (DT.lib.length) { const c = DT.lib.shift(); DT.hand.push(c); DT.drawn.push(c); }
  const ch = 2 + (DT.second && DT.turn === 1 ? 1 : 0);
  for (let i = 0; i < ch && DT.rlib.length; i++) DT.pool.push(DT.rlib.shift());
}
function renderDeckTest() {
  const N = DT.deckAll.length, card = (id, i, opts = {}) => { const c = D.rb[id], r = cardRef(c.n), en = DT.pool.length;
    const can = DT.turn > 0 && c.c != null && c.c <= en;
    return `<button class="dt-card ${DT.sel.has(i) ? 'sel' : ''} ${can ? 'can' : ''}" data-dti="${i}" ${opts.lock ? 'disabled' : ''} title="${esc(c.n)}">${r && r.img ? `<img src="${esc(r.img)}" alt="">` : `<span>${esc(c.n)}</span>`}<small>${c.c != null ? c.c + '⚡ ' : ''}${esc(c.n.split(',')[0])}</small>${can ? '<i>playable</i>' : ''}</button>`; };
  const runeDom = {}; for (const id of DT.pool) for (const d of D.rb[id].d) runeDom[d] = (runeDom[d] || 0) + 1;
  // odds: chance to have at least one copy by the opening hand and by each of your first turns
  const counts = new Map(); for (const id of DT.deckAll) counts.set(id, (counts.get(id) || 0) + 1);
  const seen = (t) => 4 + t; // 1v1: draw each turn, including the first
  const odds = [...counts.entries()].sort((a, b) => b[1] - a[1] || (D.rb[a[0]].c ?? 99) - (D.rb[b[0]].c ?? 99)).map(([id, k]) => ({ id, k, p: [0, 1, 2, 3].map((t) => hyperAtLeast1(N, k, seen(t))) }));
  const curve = {}; for (const id of DT.deckAll) { const c = D.rb[id].c; const b = c == null ? '–' : c >= 7 ? '7+' : String(c); curve[b] = (curve[b] || 0) + 1; }
  const cmax = Math.max(1, ...Object.values(curve));
  const pc = (p) => `${Math.round(p * 100)}%`;
  $('#sheet-content').innerHTML = `<div class="detail dtest"><h2>Test draw</h2><div class="sub">${esc(DT.name)} · ${N} cards to draw from${DT.champ ? ` · ${esc(D.rb[DT.champ].n.split(',')[0])} starts in the champion zone` : ''}</div>
    <div class="seg mini" id="dt-order" style="margin-top:10px"><button data-s="0" class="${DT.second ? '' : 'on'}">Going first</button><button data-s="1" class="${DT.second ? 'on' : ''}">Going second</button></div>
    <div class="dsec">${DT.turn ? `Turn ${DT.turn} — hand (${DT.hand.length})` : 'Opening hand'}</div>
    <div class="dt-hand">${DT.hand.map((id, i) => card(id, i, { lock: DT.mull })).join('')}</div>
    ${!DT.mull ? `<p class="sub">Tap up to 2 cards to send back, then Mulligan — or keep.</p><div class="row" style="gap:8px"><button class="ghost" id="dt-mull" ${DT.sel.size ? '' : 'disabled'}>Mulligan ${DT.sel.size || ''}</button><button class="primary" id="dt-keep" style="flex:1">Keep &amp; start turn 1</button></div>`
      : `<div class="dt-runes"><b>${DT.pool.length} rune${DT.pool.length === 1 ? '' : 's'}</b> channeled${Object.keys(runeDom).length ? ': ' + Object.entries(runeDom).map(([d, n]) => `${domTags([d])} ×${n}`).join(' ') : ''} · cards marked <i>playable</i> cost ${DT.pool.length} or less</div>
         <div class="row" style="gap:8px"><button class="primary" id="dt-next" style="flex:1" ${DT.lib.length ? '' : 'disabled'}>Next turn (draw 1, channel 2)</button><button class="ghost" id="dt-new">New hand</button></div>`}
    <div class="dsec">Odds of seeing at least one</div>
    <table class="dt-odds"><thead><tr><th>Card</th><th>#</th><th>Opening</th><th>Turn 1</th><th>Turn 2</th><th>Turn 3</th></tr></thead><tbody>
      ${odds.slice(0, DT.all ? 99 : 10).map((o) => `<tr><td>${esc(D.rb[o.id].n)}</td><td>${o.k}</td>${o.p.map((p) => `<td style="--p:${p}">${pc(p)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    ${odds.length > 10 ? `<button class="linkbtn" id="dt-all">${DT.all ? 'Show fewer' : `Show all ${odds.length}`}</button>` : ''}
    <p class="sub">Counts every card you've seen: the 4 in your opening hand plus one draw a turn (mulligans not included).</p>
    <div class="dsec">Energy curve</div>
    <div class="dt-curve">${['0', '1', '2', '3', '4', '5', '6', '7+', '–'].filter((b) => curve[b]).map((b) => `<div><i style="height:${Math.round(curve[b] / cmax * 100)}%"></i><b>${curve[b]}</b><small>${b === '–' ? 'n/a' : b}</small></div>`).join('')}</div></div>`;
  const re = () => renderDeckTest();
  $('#dt-order').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; DT.second = b.dataset.s === '1'; dtNewHand(); re(); };
  $$('#sheet-content [data-dti]').forEach((b) => b.onclick = () => { if (DT.mull) return; const i = +b.dataset.dti; if (DT.sel.has(i)) DT.sel.delete(i); else if (DT.sel.size < 2) DT.sel.add(i); re(); });
  const m = $('#dt-mull'); if (m) m.onclick = () => { const out = [...DT.sel].sort((a, b) => b - a).map((i) => DT.hand.splice(i, 1)[0]); DT.hand.push(...DT.lib.splice(0, out.length)); DT.lib.push(...out); DT.sel = new Set(); DT.mull = true; DT.turn = 0; dtNextTurn(); re(); };
  const k = $('#dt-keep'); if (k) k.onclick = () => { DT.sel = new Set(); dtNextTurn(); re(); };
  const n = $('#dt-next'); if (n) n.onclick = () => { dtNextTurn(); re(); };
  const nw = $('#dt-new'); if (nw) nw.onclick = () => { dtNewHand(); re(); };
  const al = $('#dt-all'); if (al) al.onclick = () => { DT.all = !DT.all; re(); };
}

/* ---------------------------------------------------------------- trade helper */
const TR_KEY = 'rbt.trade.v1';
const TR = Object.assign({ give: [], get: [] }, loadJSON(TR_KEY, {}));
const saveTR = () => { try { localStorage.setItem(TR_KEY, JSON.stringify(TR)); } catch {} };
function trSide(side) { return side === 'give' ? TR.give : TR.get; }
function trTotal(side) { return trSide(side).reduce((t, x) => t + x.q * ((S.byKey.get(x.k) || {}).m || 0), 0); }
function openTrade() { pushSheet(renderTrade); }
function renderTrade() {
  const g = trTotal('give'), r = trTotal('get'), diff = r - g, base = Math.max(g, r, 0.01), pct = diff / base;
  const fair = Math.abs(pct) <= 0.05;
  const meter = Math.max(-1, Math.min(1, pct / 0.3));
  const row = (side) => (x, i) => { const it = S.byKey.get(x.k); if (!it) return ''; const own = S.inv.items[x.k]?.qty || 0;
    return `<li>${img(it.img)}<span class="nm">${esc(it.n)}${variantTags(it)}<small>${money(it.m)} each${side === 'give' ? ` · you own ${own}` : own ? ` · you own ${own}` : ''}</small></span>
      <span class="mstep"><button data-trq="${side}|${i}|-1">−</button><b>${x.q}</b><button data-trq="${side}|${i}|1">+</button></span></li>`; };
  $('#sheet-content').innerHTML = `<div class="detail trade"><h2>Trade</h2>
    <div class="tr-meter ${fair ? 'fair' : diff > 0 ? 'up' : 'down'}"><div class="tr-bar"><i style="left:${50 + meter * 50}%"></i></div>
      <div class="tr-sum"><span>You give <b>${money(g)}</b></span><span>You get <b>${money(r)}</b></span></div>
      <div class="tr-verdict">${!g && !r ? 'Add cards to both sides' : fair ? 'Fair trade (within 5%)' : diff > 0 ? `You come out ${money(diff)} ahead (${Math.round(pct * 100)}%)` : `You give ${money(-diff)} more (${Math.round(-pct * 100)}%)`}</div></div>
    ${['give', 'get'].map((side) => `<div class="dsec">${side === 'give' ? 'I give' : 'I get'} (${trSide(side).reduce((t, x) => t + x.q, 0)})</div>
      <input type="search" class="tr-q" data-trside="${side}" placeholder="${side === 'give' ? 'Search your cards…' : 'Search any card…'}" autocomplete="off">
      <ul class="dl tr-res" id="tr-res-${side}"></ul>
      <ul class="dl tr-list">${trSide(side).map(row(side)).join('') || '<li class="sub">Nothing yet</li>'}</ul>`).join('')}
    <div class="row" style="gap:8px;margin-top:14px"><button class="primary" id="tr-done" style="flex:1" ${TR.give.length || TR.get.length ? '' : 'disabled'}>Complete trade</button><button class="ghost" id="tr-clear">Clear</button></div>
    <p class="sub">Prices are TCGplayer market. Completing the trade takes the cards you give out of "${esc(colName())}" and adds the cards you get (a backup is saved first).</p></div>`;
  const re = () => renderTrade();
  $$('#sheet-content [data-trq]').forEach((b) => b.onclick = () => { const [side, i, d] = b.dataset.trq.split('|'); const l = trSide(side), x = l[+i]; x.q += +d; if (x.q <= 0) l.splice(+i, 1); saveTR(); re(); });
  $$('#sheet-content .tr-q').forEach((inp) => inp.oninput = () => {
    const side = inp.dataset.trside, q = normName(inp.value), out = $('#tr-res-' + side);
    if (q.length < 2) { out.innerHTML = ''; return; }
    let pool = side === 'give' ? Object.keys(S.inv.items).map((k) => S.byKey.get(k)).filter(Boolean) : S.cards.items.filter((i) => !i.sealed);
    pool = pool.filter((it) => normName(it.n).includes(q)).sort((a, b) => (b.m || 0) - (a.m || 0)).slice(0, 12);
    out.innerHTML = pool.map((it) => `<li data-tradd="${side}|${esc(it.k)}">${img(it.img)}<span class="nm">${esc(it.n)}${variantTags(it)}<small>${esc(setAbbr(it.g))} · ${esc(it.num || '')}${S.inv.items[it.k] ? ` · own ${S.inv.items[it.k].qty}` : ''}</small></span><span class="st"><b>${money(it.m)}</b></span></li>`).join('') || '<li class="sub">No match</li>';
    out.querySelectorAll('[data-tradd]').forEach((li) => li.onclick = () => { const v = li.dataset.tradd, cut = v.indexOf('|'), sd = v.slice(0, cut), k = v.slice(cut + 1); const l = trSide(sd), x = l.find((y) => y.k === k); if (x) x.q++; else l.push({ k, q: 1 }); saveTR(); re(); });
  });
  $('#tr-clear').onclick = () => { TR.give = []; TR.get = []; saveTR(); re(); };
  $('#tr-done').onclick = async () => {
    const short = TR.give.filter((x) => (S.inv.items[x.k]?.qty || 0) < x.q);
    if (!(await confirmBox(`Complete this trade?${short.length ? ` You don't own enough of ${short.length} card${short.length === 1 ? '' : 's'} you're giving — those will just go to zero.` : ''}`))) return;
    try { await takeSnapshot('before trade'); } catch {}
    for (const x of TR.give) invBump(x.k, -Math.min(x.q, S.inv.items[x.k]?.qty || 0));
    for (const x of TR.get) invBump(x.k, x.q);
    const log = loadJSON('rbt.trades.v1', []); log.push({ t: Date.now(), give: TR.give, get: TR.get, g: trTotal('give'), r: trTotal('get') }); try { localStorage.setItem('rbt.trades.v1', JSON.stringify(log.slice(-100))); } catch {}
    TR.give = []; TR.get = []; saveTR(); closeSheet(); if (S.view === 'collection') renderCollection(); toast('Trade done — collection updated');
  };
}

/* ---------------------------------------------------------------- shareable links (trade binder, wishlist, a filtered view) */
// Everything travels inside the link itself (compressed), so friends can open it without an account.
async function packShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let out = bytes, z = 0;
  if (window.CompressionStream) { try { out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()); z = 1; } catch { out = bytes; } }
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
  return z + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackShare(s) {
  const z = s[0] === '1', b64 = s.slice(1).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64), bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const raw = z ? new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}
const shareItems = (entries) => entries.map(([k, q]) => [k, q]);
function openShare() { pushSheet(renderShare); }
function renderShare() {
  const own = Object.entries(S.inv.items);
  const extras = own.map(([k, e]) => { const it = S.byKey.get(k); return it && !it.sealed && e.qty > 3 ? [k, e.qty - 3] : null; }).filter(Boolean);
  const wish = Object.entries(WL.items || {}).map(([k, w]) => [k, w.qty || 1]);
  const view = [...document.querySelectorAll('#col-list li.item[data-k]')].map((li) => li.dataset.k).filter((k) => S.inv.items[k]).map((k) => [k, S.inv.items[k].qty]);
  const opts = [['extras', 'My trade binder', `Copies beyond a playset (3) — ${extras.reduce((t, x) => t + x[1], 0)} cards`, extras],
    ['wish', 'My wishlist', `${wish.length} cards you're looking for`, wish],
    ['view', 'What I\'m looking at', `The ${view.length} cards in the current list (with your filters and search)`, view]];
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Share a list</h2><p class="sub">Makes a link anyone can open — prices included, no account needed. Nothing is uploaded; the list travels inside the link.</p>
    <ul class="dl shareopts">${opts.map(([id, t, d, l]) => `<li><span class="nm">${t}<small>${d}</small></span><span class="st"><button class="primary sm" data-share="${id}" ${l.length ? '' : 'disabled'}>Share</button></span></li>`).join('')}</ul></div>`;
  $$('#sheet-content [data-share]').forEach((b) => b.onclick = async () => {
    const o = opts.find((x) => x[0] === b.dataset.share);
    const code = await packShare({ v: 1, t: o[0] === 'wish' ? 'wish' : 'have', n: o[1], d: Date.now(), i: shareItems(o[3]) });
    const url = location.origin + location.pathname + '#share=' + code;
    if (navigator.share) { try { await navigator.share({ title: o[1] + ' — Riftbound', url }); return; } catch {} }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
  });
}
async function checkShareLink() {
  const m = location.hash.match(/^#share=(.+)$/); if (!m) return;
  let data; try { data = await unpackShare(m[1]); } catch { toast("That share link couldn't be read"); return; }
  history.replaceState(null, '', location.pathname + location.search);
  pushSheet(() => renderShared(data));
}
function renderShared(data) {
  const rows = (data.i || []).map(([k, q]) => ({ it: S.byKey.get(k), k, q })).filter((x) => x.it);
  const tot = rows.reduce((t, x) => t + x.q * (x.it.m || 0), 0);
  const wishSide = data.t === 'wish';
  $('#sheet-content').innerHTML = `<div class="detail"><h2>${esc(data.n || 'Shared list')}</h2><div class="sub">Shared ${data.d ? new Date(data.d).toLocaleDateString() : ''} · ${rows.reduce((t, x) => t + x.q, 0)} cards · about ${money(tot)} today</div>
    <div class="row" style="gap:8px;margin:12px 0"><button class="primary" id="sh-trade" style="flex:1">${wishSide ? 'Offer these in a trade' : 'Start a trade with these'}</button><button class="ghost" id="sh-wish">${wishSide ? '' : 'Add all to my wishlist'}</button></div>
    <ul class="dl prints">${rows.sort((a, b) => (b.it.m || 0) - (a.it.m || 0)).map((x) => `<li data-open="${esc(x.k)}">${img(x.it.img)}<span class="nm">${x.q}× ${esc(x.it.n)}${variantTags(x.it)}<small>${esc(setAbbr(x.it.g))} · ${esc(x.it.num || '')}${S.inv.items[x.k] ? ` · you own ${S.inv.items[x.k].qty}` : ''}</small></span><span class="st"><b>${money(x.it.m)}</b></span></li>`).join('')}</ul></div>`;
  if (wishSide) $('#sh-wish').remove();
  $('#sh-trade').onclick = () => { const side = wishSide ? TR.give : TR.get; for (const x of rows) { const y = side.find((z) => z.k === x.k); if (y) y.q = Math.max(y.q, x.q); else side.push({ k: x.k, q: wishSide ? Math.min(x.q, S.inv.items[x.k]?.qty || 0) || 1 : x.q }); } saveTR(); openTrade(); };
  const w = $('#sh-wish'); if (w) w.onclick = () => { for (const x of rows) if (!WL.items[x.k]) WL.items[x.k] = { qty: x.q, max: null, added: Date.now() }; saveWL(); toast(`${rows.length} cards added to your wishlist`); };
  $$('#sheet-content [data-open]').forEach((li) => li.onclick = () => openDetail(li.dataset.open));
}
(function wireTools() {
  const t = $('#t-trade'); if (t) t.onclick = openTrade;
  const s = $('#t-share'); if (s) s.onclick = openShare;
  window.addEventListener('hashchange', checkShareLink);
})();

/* ---------------------------------------------------------------- holo tilt on card pages */
// Foils and special printings get a moving shine; any card tilts with your finger, or with the phone (after you allow motion).
function holoKind(it) { return it.s !== 'Normal' || it.r === 'Showcase' || /\(/.test(it.n) ? (/(overnumbered|signature|serial)/i.test(it.n) ? 'rainbow' : it.r === 'Showcase' || /alternate/i.test(it.n) ? 'prism' : 'foil') : ''; }
function holoWire(it) {
  const img = $('#sheet .detail-img'); if (!img || img.closest('.holo')) return;
  const wrap = document.createElement('div'); wrap.className = 'holo ' + holoKind(it); img.replaceWith(wrap); wrap.appendChild(img);
  const shine = document.createElement('i'); shine.className = 'holo-shine'; wrap.appendChild(shine);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const set = (x, y) => { wrap.style.setProperty('--rx', ((0.5 - y) * 18).toFixed(2) + 'deg'); wrap.style.setProperty('--ry', ((x - 0.5) * 22).toFixed(2) + 'deg'); wrap.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); wrap.style.setProperty('--my', (y * 100).toFixed(1) + '%'); };
  const rest = () => { wrap.classList.remove('live'); set(0.5, 0.5); };
  wrap.addEventListener('pointermove', (e) => { const r = wrap.getBoundingClientRect(); wrap.classList.add('live'); set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); });
  wrap.addEventListener('pointerleave', rest); wrap.addEventListener('pointerup', () => setTimeout(rest, 600));
  const onTilt = (e) => { if (!document.body.contains(wrap)) { removeEventListener('deviceorientation', onTilt); return; } if (e.gamma == null) return; wrap.classList.add('live'); set(Math.max(0, Math.min(1, 0.5 + e.gamma / 50)), Math.max(0, Math.min(1, 0.5 + (e.beta - 45) / 60))); };
  if (S.prefs.tilt) addEventListener('deviceorientation', onTilt);
  else if (window.DeviceOrientationEvent && holoKind(it)) {
    const b = document.createElement('button'); b.className = 'ghost sm holo-btn'; b.textContent = '✨ Tilt with my phone'; wrap.after(b);
    b.onclick = async () => { try { if (DeviceOrientationEvent.requestPermission) { const r = await DeviceOrientationEvent.requestPermission(); if (r !== 'granted') { toast('Motion access not allowed'); return; } } S.prefs.tilt = true; savePrefs(); addEventListener('deviceorientation', onTilt); b.remove(); toast('Tilt your phone to catch the light'); } catch { toast('Motion not available here'); } };
  }
  rest();
}

/* ---------------------------------------------------------------- milestones */
function allOwned() { const out = []; for (const c of colList()) for (const [k, e] of Object.entries(colItems(c.id))) { const it = S.byKey.get(k); if (it && !it.sealed) out.push({ k, it, e }); } return out; }
function milestones() {
  const own = allOwned(), cards = own.reduce((t, x) => t + x.e.qty, 0), value = own.reduce((t, x) => t + x.e.qty * (x.it.m || 0), 0);
  const has = (fn) => own.some(fn), out = [];
  const step = (id, icon, title, cur, goal, unit = '') => out.push({ id, icon, title, done: cur >= goal, prog: Math.min(1, cur / goal), note: cur >= goal ? '' : `${unit === '$' ? money(cur) : Math.floor(cur).toLocaleString()} / ${unit === '$' ? money(goal) : goal.toLocaleString()}` });
  for (const n of [1, 100, 500, 1000, 2500, 5000]) step('cards' + n, '🃏', n === 1 ? 'First card' : `${n.toLocaleString()} cards`, cards, n);
  for (const v of [100, 500, 1000, 5000, 10000]) step('value' + v, '💰', `Collection worth ${money(v).replace('.00', '')}`, value, v, '$');
  const first = [['foil', '✨', 'First foil', (x) => x.it.s !== 'Normal'], ['alt', '🎨', 'First alternate art', (x) => /alternate art/i.test(x.it.n)], ['over', '🌌', 'First overnumbered', (x) => /overnumbered/i.test(x.it.n)],
    ['sig', '✍️', 'First signature card', (x) => /signature/i.test(x.it.n)], ['serial', '🔢', 'First serialized card', (x) => /serial/i.test(x.it.n)], ['promo', '🎟️', 'First promo', (x) => !!promoKind(x.it)],
    ['graded', '🏆', 'First graded card', (x) => !!x.e.grader], ['lang', '🌏', 'First card in another language', (x) => langOf(x.k) !== 'en'], ['hundred', '💎', 'A single card worth $100+', (x) => (x.it.m || 0) >= 100]];
  for (const [id, icon, title, fn] of first) out.push({ id, icon, title, done: has(fn), prog: has(fn) ? 1 : 0, note: '' });
  // set completion: one of every card in each main set (any finish or version counts)
  const bySet = new Map(); for (const items of S.byPid.values()) { const f = items[0]; if (f.sealed || /\(/.test(f.n) || PROMO_GROUPS[f.g]) continue; if (!bySet.has(f.g)) bySet.set(f.g, new Set()); bySet.get(f.g).add(printBase(f.n)); }
  const ownNames = new Map(); for (const x of own) { if (!ownNames.has(x.it.g)) ownNames.set(x.it.g, new Set()); ownNames.get(x.it.g).add(printBase(x.it.n)); }
  for (const [g, names] of bySet) { if (names.size < 40) continue; const got = [...names].filter((n) => ownNames.get(g)?.has(n)).length; for (const pct of [50, 100]) step(`set${g}-${pct}`, pct === 100 ? '👑' : '📚', `${setName(g)} ${pct === 100 ? 'complete' : 'half done'}`, got, Math.ceil(names.size * pct / 100)); }
  const trades = loadJSON('rbt.trades.v1', []).length; step('trade1', '🤝', 'First trade', trades, 1);
  if (MD.decks.length) step('deck1', '🛡️', 'Built a deck', MD.decks.length, 1);
  return out;
}
function checkMilestones(quiet) {
  const ms = milestones(), seen = new Set(S.prefs.badges || []), fresh = ms.filter((m) => m.done && !seen.has(m.id));
  if (!fresh.length) return;
  S.prefs.badges = [...seen, ...fresh.map((m) => m.id)]; savePrefs();
  if (!quiet && seen.size) toast(`${fresh[0].icon} Milestone: <b>${esc(fresh[0].title)}</b>${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, 3500);
}
function renderMilestones() {
  const ms = milestones(), done = ms.filter((m) => m.done);
  const next = ms.filter((m) => !m.done).sort((a, b) => b.prog - a.prog);
  const tile = (m) => `<div class="ms ${m.done ? 'done' : ''}"><span class="ms-i">${m.icon}</span><b>${esc(m.title)}</b>${m.done ? '' : `<div class="bar"><i style="width:${Math.round(m.prog * 100)}%"></i></div><small>${esc(m.note)}</small>`}</div>`;
  $('#sheet-content').innerHTML = `<div class="detail"><h2>Milestones</h2><div class="sub">${done.length} of ${ms.length} earned</div>
    ${next.length ? `<div class="dsec">Closest next</div><div class="msgrid">${next.slice(0, 6).map(tile).join('')}</div>` : ''}
    <div class="dsec">Earned</div><div class="msgrid">${done.map(tile).join('') || '<p class="sub">Add some cards to start.</p>'}</div>
    ${next.length > 6 ? `<div class="dsec">Still to go</div><div class="msgrid">${next.slice(6).map(tile).join('')}</div>` : ''}</div>`;
}

/* ---------------------------------------------------------------- Today: what changed since you last looked */
function renderToday() {
  const el = $('#today'); if (!el) return;
  const today = new Date().toISOString().slice(0, 10);
  if (S.prefs.todayHide === today || (S.prefs.colSet && S.prefs.colSet !== 'all') || !Object.keys(S.inv.items).length) { el.classList.add('hidden'); return; }
  const rows = ownedRows().filter((r) => r.dval);
  const up = rows.slice().sort((a, b) => b.dval - a.dval).filter((r) => r.dval > 0).slice(0, 2);
  const down = rows.slice().sort((a, b) => a.dval - b.dval).filter((r) => r.dval < 0).slice(0, 1);
  const items = [];
  for (const r of up.concat(down)) items.push(`<button class="td" data-tdk="${esc(r.it.k)}">${img(r.it.img)}<span><b>${esc(r.it.n.split(',')[0])}</b><small class="${r.dval > 0 ? 'up' : 'down'}">${r.dval > 0 ? '▲' : '▼'} ${money(Math.abs(r.dval))} this week</small></span></button>`);
  const news = (EVS.news && EVS.news.headlines || []).find((h) => (Date.now() - new Date(h.date || 0)) < 3 * 864e5);
  if (news) items.push(`<a class="td" href="${esc(news.url)}" target="_blank" rel="noopener"><span class="ti">📰</span><span><b>${esc(news.title)}</b><small>News · ${esc(fmtDate(news.date))}</small></span></a>`);
  const pv = typeof previewCards === 'function' ? previewCards() : []; if (pv.length) items.push(`<button class="td" data-tdgo="previews"><span class="ti">👁️</span><span><b>${pv.length} newly revealed card${pv.length === 1 ? '' : 's'}</b><small>See the previews</small></span></button>`);
  const nextEv = (EV.events || []).filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (nextEv) items.push(`<button class="td" data-tdgo="events"><span class="ti">🏆</span><span><b>${esc(nextEv.name || 'Event')}</b><small>${nextEv.date === today ? 'Today' : esc(fmtDate(nextEv.date))}</small></span></button>`);
  const ms = milestones().filter((m) => !m.done && m.prog >= 0.6).sort((a, b) => b.prog - a.prog)[0];
  if (ms) items.push(`<button class="td" data-tdgo="badges"><span class="ti">${ms.icon}</span><span><b>${esc(ms.title)}</b><small>${Math.round(ms.prog * 100)}% there</small></span></button>`);
  if (!items.length) { el.classList.add('hidden'); return; }
  el.innerHTML = `<div class="td-h"><b>Today</b><button class="linkbtn" id="td-hide">Hide for today</button></div><div class="td-row">${items.join('')}</div>`;
  el.classList.remove('hidden');
  $('#td-hide').onclick = () => { S.prefs.todayHide = today; savePrefs(); el.classList.add('hidden'); };
  el.querySelectorAll('[data-tdk]').forEach((b) => b.onclick = () => openDetail(b.dataset.tdk));
  el.querySelectorAll('[data-tdgo]').forEach((b) => b.onclick = () => { const g = b.dataset.tdgo; if (g === 'events') show('events'); else if (g === 'badges') pushSheet(renderMilestones); else if (g === 'previews' && typeof renderPreviews === 'function') pushSheet(renderPreviews); });
}
(function wireMs() { const b = $('#t-badges'); if (b) b.onclick = () => pushSheet(renderMilestones); })();
