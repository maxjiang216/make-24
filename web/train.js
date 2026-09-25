'use strict';

/* ================= TRAIN: flash cards with a priority queue ================= */
// Two decks share one scheduler:
//  - recog: all 1820 sets, answer "solvable or not"
//  - solve: the 1362 solvable sets, find a solution
// No calendar: the next set is always the weakest one that isn't cooling down.
// Per set and deck we keep { n, ok, acc, ema, streak, last }:
//   acc    rolling correctness (1 = right), weights recent answers more
//   ema    rolling time in ms
//   streak right-and-fast answers in a row
//   last   turn number of the last answer (turns count up per deck)

const ALL_KEYS = Object.keys(SOLUTIONS);
const ALPHA = 0.35; // weight of the latest answer in the rolling accuracy and time
const MISS_GAP = 4; // turns a missed set sits out
const MAX_GAP = 300; // longest a well-known set sits out
const gapFor = (s) => (s.streak ? Math.min(MISS_GAP * 2 ** s.streak, MAX_GAP) : MISS_GAP);

const DECKS = {
  recog: { keys: ALL_KEYS, target: 3 },
  solve: { keys: SOLVABLE_KEYS, target: 10 },
};

// localStorage (about 5 MB per site) rather than cookies (4 KB each, sent with every
// request): a deck's progress is ~100 KB once every set has been seen.
const store = {
  get(name, fallback) {
    try { return JSON.parse(localStorage.getItem('make24.train.' + name)) ?? fallback; } catch { return fallback; }
  },
  set(name, v) {
    try { localStorage.setItem('make24.train.' + name, JSON.stringify(v)); } catch { /* storage full or blocked */ }
  },
};

const T = {
  deck: store.get('deck', 'recog'),
  order: store.get('order', 'hard'),
  stats: null, // key -> set stats
  turn: 0,
  key: null,
  state: 'ready', // 'ready' (face down) | 'asking' (timer running) | 'revealed' | 'result'
  ms: 0,
};

/* ---------------- new-set order ---------------- */
// Recognition deck: a fixed shuffle, saved so "next new set" is stable across visits.
function recogOrder() {
  let o = store.get('recog-order', null);
  if (!o || o.length !== ALL_KEYS.length) {
    o = shuffle([...ALL_KEYS]);
    store.set('recog-order', o);
  }
  return o;
}
const strategyOf = (k) => (CANONICAL[k] || '').replace(/ \d+$/, '');
// Solve deck difficulty: fewer distinct solutions is harder; among equal counts, a
// rarer strategy (fractions, 48/2, ...) is harder than a common one (3x8).
function solveOrder(how) {
  const keys = [...SOLVABLE_KEYS];
  const freq = {};
  for (const k of keys) freq[strategyOf(k)] = (freq[strategyOf(k)] || 0) + 1;
  const byName = (a, b) => a.localeCompare(b, 'en', { numeric: true });
  if (how === 'strategy') {
    return keys.sort((a, b) =>
      freq[strategyOf(a)] - freq[strategyOf(b)] ||
      strategyOf(a).localeCompare(strategyOf(b)) ||
      CLASS_COUNT[a] - CLASS_COUNT[b] || byName(a, b));
  }
  const hard = (a, b) => CLASS_COUNT[a] - CLASS_COUNT[b] || freq[strategyOf(a)] - freq[strategyOf(b)] || byName(a, b);
  return keys.sort(how === 'easy' ? (a, b) => hard(b, a) : hard);
}
const newOrder = () => (T.deck === 'recog' ? recogOrder() : solveOrder(T.order)).filter((k) => POOL_SET.has(k));

/* ---------------- filters ---------------- */
// Which sets of the deck are in play. Each group is a list of allowed values; the
// strategy group matches either the set's canonical strategy or any of its tags.
const FACE = new Set([11, 12, 13]);
const RANKS = [...Array(13)].map((_, i) => i + 1);
const COUNTS = [...new Set(Object.values(CLASS_COUNT))].sort((a, b) => a - b);
const STRATS = (() => {
  // ladder order, as the tags are listed
  const seen = [];
  for (const tags of Object.values(STRATEGY_TAGS)) for (const t of tags) if (!seen.includes(t)) seen.push(t);
  const firstPos = (t) => Math.min(...Object.values(STRATEGY_TAGS).map((v) => (v.includes(t) ? v.indexOf(t) : 99)));
  return seen.sort((a, b) => firstPos(a) - firstPos(b));
})();
const defaultFilter = () => ({
  ranks: RANKS, faces: [0, 1, 2, 3, 4], counts: COUNTS, strats: STRATS, stratMode: 'canonical',
});
function inFilter(k, f) {
  const cards = k.split('-').map(Number);
  if (!cards.every((c) => f.ranks.includes(c))) return false;
  if (!f.faces.includes(cards.filter((c) => FACE.has(c)).length)) return false;
  if (T.deck !== 'solve') return true;
  if (!f.counts.includes(CLASS_COUNT[k])) return false;
  if (f.strats.length === STRATS.length) return true;
  return f.stratMode === 'canonical'
    ? f.strats.includes(CANONICAL[k])
    : STRATEGY_TAGS[k].some((t) => f.strats.includes(t));
}
let POOL = []; // keys currently in play
let POOL_SET = new Set();
function applyFilter() {
  POOL = DECKS[T.deck].keys.filter((k) => inFilter(k, T.filter));
  POOL_SET = new Set(POOL);
}

/* ---------------- scheduler ---------------- */
const known = (s) => s.acc >= 0.9 && s.ema <= targetMs();
// Weakest first: lower rolling accuracy (in steps of 0.1, so time can break ties),
// then slower rolling time.
const weaker = (a, b) => Math.round(a.acc * 10) - Math.round(b.acc * 10) || b.ema - a.ema;

function pickNext() {
  if (!POOL.length) return null;
  const seen = Object.entries(T.stats).filter(([k]) => POOL_SET.has(k));
  const ready = seen.filter(([, s]) => T.turn - s.last >= gapFor(s)).sort((a, b) => weaker(a[1], b[1]));
  if (ready.length && !known(ready[0][1])) return ready[0][0];

  const fresh = newOrder().find((k) => !T.stats[k]);
  if (fresh) return fresh;
  if (ready.length) return ready[0][0];

  // Everything is cooling down: take the one closest to coming back, never a repeat.
  const soonest = seen.filter(([k]) => k !== T.key || seen.length === 1)
    .sort((a, b) => (a[1].last + gapFor(a[1])) - (b[1].last + gapFor(b[1])));
  return soonest.length ? soonest[0][0] : seen[0][0];
}

function record(right) {
  const s = T.stats[T.key] || (T.stats[T.key] = { n: 0, ok: 0, acc: right ? 1 : 0, ema: T.ms, streak: 0, last: 0 });
  s.n++;
  if (right) s.ok++;
  if (s.n > 1) {
    s.acc = ALPHA * (right ? 1 : 0) + (1 - ALPHA) * s.acc;
    s.ema = ALPHA * T.ms + (1 - ALPHA) * s.ema;
  }
  s.streak = right && T.ms <= targetMs() ? s.streak + 1 : 0;
  s.last = ++T.turn;
  saveDeck();
  renderProgress();
}
function grade(right) {
  record(right);
  deal();
}

/* ---------------- persistence, import / export ---------------- */
function loadDeck() {
  const d = store.get('deck-' + T.deck, null);
  T.stats = d?.stats ?? {};
  T.turn = d?.turn ?? 0;
}
const saveDeck = () => store.set('deck-' + T.deck, { stats: T.stats, turn: T.turn });

const CSV_COLS = ['deck', 'set', 'n', 'ok', 'acc', 'avg_ms', 'streak', 'last_turn'];
function exportCsv() {
  const rows = [CSV_COLS.join(',')];
  for (const deck of Object.keys(DECKS)) {
    const d = deck === T.deck ? { stats: T.stats, turn: T.turn } : store.get('deck-' + deck, { stats: {}, turn: 0 });
    for (const [k, s] of Object.entries(d.stats)) {
      rows.push([deck, k, s.n, s.ok, s.acc.toFixed(4), Math.round(s.ema), s.streak, s.last].join(','));
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `make24-progress-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function importCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',').map((h) => h.trim());
  if (CSV_COLS.some((c) => !head.includes(c))) throw new Error('missing columns; expected ' + CSV_COLS.join(', '));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  const decks = {};
  let rows = 0;
  for (const line of lines) {
    const f = line.split(',');
    const deck = f[col.deck], k = f[col.set];
    if (!DECKS[deck] || !DECKS[deck].keys.includes(k)) continue;
    const d = decks[deck] || (decks[deck] = { stats: {}, turn: 0 });
    const s = {
      n: +f[col.n] || 0, ok: +f[col.ok] || 0, acc: +f[col.acc] || 0,
      ema: +f[col.avg_ms] || 0, streak: +f[col.streak] || 0, last: +f[col.last_turn] || 0,
    };
    d.stats[k] = s;
    d.turn = Math.max(d.turn, s.last);
    rows++;
  }
  for (const [deck, d] of Object.entries(decks)) store.set('deck-' + deck, d);
  return rows;
}

/* ---------------- UI ---------------- */
function renderFilter() {
  const f = T.filter;
  const body = $('t-filter-body');
  body.innerHTML = '';
  const group = (title, field, values, label = String) => {
    const g = document.createElement('div');
    g.className = 't-fgroup';
    g.innerHTML = '<div class="t-fhead"><span></span><button class="link">all</button><button class="link">none</button></div><div class="chips"></div>';
    g.querySelector('span').textContent = title;
    const [all, none] = g.querySelectorAll('.link');
    all.onclick = () => setField(field, [...values]);
    none.onclick = () => setField(field, []);
    const chips = g.querySelector('.chips');
    for (const v of values) {
      const c = document.createElement('button');
      c.className = 'chip' + (f[field].includes(v) ? ' on' : '');
      c.textContent = label(v);
      c.onclick = () => setField(field, f[field].includes(v) ? f[field].filter((x) => x !== v) : [...f[field], v]);
      chips.appendChild(c);
    }
    body.appendChild(g);
    return g;
  };
  group('ranks allowed', 'ranks', RANKS, (v) => LABEL[v]);
  group('face cards (J Q K)', 'faces', [0, 1, 2, 3, 4]);
  if (T.deck === 'solve') {
    group('distinct solutions', 'counts', COUNTS);
    const g = group('strategy', 'strats', STRATS);
    const mode = document.createElement('div');
    mode.className = 't-fmode';
    for (const [val, text] of [['canonical', 'canonical (one per set)'], ['any', 'any solution uses it']]) {
      const b = document.createElement('button');
      b.className = 'chip' + (f.stratMode === val ? ' on' : '');
      b.textContent = text;
      b.onclick = () => setField('stratMode', val);
      mode.appendChild(b);
    }
    g.insertBefore(mode, g.querySelector('.chips'));
  }
  const foot = document.createElement('div');
  foot.className = 't-ffoot';
  foot.innerHTML = '<span></span><button class="link">reset filter</button>';
  foot.firstChild.textContent = `${POOL.length} of ${DECKS[T.deck].keys.length} sets`;
  foot.lastChild.onclick = () => { T.filter = defaultFilter(); onFilterChange(); };
  body.appendChild(foot);
  const whole = POOL.length === DECKS[T.deck].keys.length;
  $('t-filter-sum').textContent = whole ? 'filter' : `filter · ${POOL.length}`;
  $('t-filter').classList.toggle('active', !whole);
}
function setField(field, v) {
  T.filter[field] = v;
  onFilterChange();
}
function onFilterChange() {
  store.set('filter-' + T.deck, T.filter);
  applyFilter();
  renderFilter();
  if (T.state !== 'asking' || !POOL_SET.has(T.key)) deal();
  else renderProgress();
}

const $ = (id) => document.getElementById(id);
const timer = makeTimer($('t-timer'));
const targetMs = () => 1000 * Math.max(0.5, +$('target').value || DECKS[T.deck].target);

function randomSuits(vals) {
  const used = {};
  return vals.map((v) => {
    const free = SUITS.filter((s) => !(used[v] || []).includes(s));
    const suit = free[Math.floor(Math.random() * free.length)];
    (used[v] = used[v] || []).push(suit);
    return { v, suit };
  });
}
const cardText = (k) => k.split('-').map((v) => LABEL[v]).join(' ');
const pct = (x) => Math.round(100 * x) + '%';

// Face-down cards; the timer starts only when the player asks for the deal.
function deal() {
  renderProgress();
  T.key = pickNext();
  if (!T.key) {
    T.state = 'empty';
    $('t-cards').innerHTML = '';
    $('t-prompt').textContent = 'No sets match the filter.';
    $('t-answer').innerHTML = '';
    $('t-grade').classList.add('hidden');
    $('t-card-stats').textContent = '';
    return;
  }
  T.state = 'ready';
  const el = $('t-cards');
  el.innerHTML = '<div class="card back"></div>'.repeat(4);
  timer.reset();
  $('t-prompt').textContent = 'Press any key (or tap) to turn the cards over.';
  $('t-answer').innerHTML = '';
  $('t-grade').classList.add('hidden');
  $('t-card-stats').textContent = '';
}

function flip() {
  T.state = 'asking';
  renderCards($('t-cards'), shuffle(randomSuits(T.key.split('-').map(Number))));
  $('t-answer').innerHTML = '';
  if (T.deck === 'recog') {
    $('t-prompt').textContent = 'Solvable?';
    showButtons('← unsolvable', 'solvable →');
  } else {
    $('t-prompt').textContent = 'Find a solution. Press any key (or tap) when you have it.';
    $('t-grade').classList.add('hidden');
  }
  $('t-card-stats').textContent = setStatsText(T.key);
  timer.start();
}
function showButtons(left, right) {
  $('t-wrong').textContent = left;
  $('t-right').textContent = right;
  $('t-grade').classList.remove('hidden');
}

// Solvable? deck: the answer is checked, no self-grading. Any key then deals the next set.
function answerRecog(saysSolvable) {
  T.ms = timer.stop();
  const truth = SOLUTIONS[T.key] !== null;
  const right = saysSolvable === truth;
  const sol = SOLUTIONS[T.key];
  $('t-answer').innerHTML = `<div class="big ${right ? 'ok' : 'bad'}">${right ? 'right' : 'wrong'}: ` +
    `${truth ? 'solvable' : 'unsolvable'}</div><div class="dim"></div>`;
  $('t-answer').lastChild.textContent = sol ? 'e.g. ' + sol : '';
  $('t-grade').classList.add('hidden');
  $('t-prompt').textContent = 'Press any key (or tap) for the next set.';
  record(right);
  T.state = 'result';
}

// Solve deck: stop the clock, show the solutions, then the player grades themselves.
function reveal() {
  T.ms = timer.stop();
  T.state = 'revealed';
  $('t-prompt').textContent = '';
  const ans = $('t-answer');
  {
    const classes = solveClasses(T.key.split('-').map(Number));
    const head = document.createElement('div');
    head.className = 'dim';
    head.textContent = `${classes.length} distinct solution${classes.length === 1 ? '' : 's'}` +
      (CANONICAL[T.key] ? ` · strategy: ${strategyOf(T.key)}` : '');
    const ul = document.createElement('ul');
    ul.className = 't-sols';
    for (const c of classes) {
      const li = document.createElement('li');
      li.textContent = c.forms[0];
      ul.appendChild(li);
    }
    ans.replaceChildren(head, ul);
  }
  showButtons('← wrong', 'right →');
}

function advance() {
  if (T.state === 'ready') flip();
  else if (T.state === 'asking' && T.deck === 'solve') reveal();
  else if (T.state === 'result') { deal(); flip(); }
}

function setStatsText(k) {
  const s = T.stats[k];
  if (!s) return 'new set';
  return `this set: ${s.ok}/${s.n} right · recent ${pct(s.acc)} · avg ${fmt(s.ema)}s`;
}

function renderProgress() {
  const keys = POOL;
  let seen = 0, good = 0, n = 0, ok = 0;
  for (const k of keys) {
    const s = T.stats[k];
    if (!s) continue;
    seen++; n += s.n; ok += s.ok;
    if (known(s)) good++;
  }
  $('t-progress').textContent =
    `seen ${seen}/${keys.length} · right and fast ${good} · overall ${n ? pct(ok / n) : '–'} over ${n} answers`;

  const weak = keys.filter((k) => T.stats[k])
    .map((k) => ({ k, s: T.stats[k] }))
    .sort((a, b) => weaker(a.s, b.s))
    .slice(0, 10);
  const ol = $('t-weak');
  ol.innerHTML = '';
  for (const { k, s } of weak) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span></span>';
    li.firstChild.textContent = cardText(k);
    li.lastChild.textContent = `  recent ${pct(s.acc)} · ${fmt(s.ema)}s · ${SOLUTIONS[k] ? 'solvable' : 'unsolvable'}`;
    ol.appendChild(li);
  }
}

function setDeck(d) {
  T.deck = d;
  store.set('deck', d);
  loadDeck();
  T.filter = { ...defaultFilter(), ...store.get('filter-' + d, {}) };
  applyFilter();
  renderFilter();
  $('deck').value = d;
  // Same toolbar in both decks; "new sets" order only applies to Solve.
  $('order').disabled = d !== 'solve';
  $('order-wrap').classList.toggle('disabled', d !== 'solve');
  $('target').value = store.get('target-' + d, DECKS[d].target);
  deal();
}

$('deck').addEventListener('change', () => { $('deck').blur(); setDeck($('deck').value); });
$('order').value = T.order;
$('order').addEventListener('change', () => {
  T.order = $('order').value;
  store.set('order', T.order);
  $('order').blur();
  if (T.state === 'ready') deal();
});
$('target').addEventListener('change', () => { store.set('target-' + T.deck, targetMs() / 1000); renderProgress(); });
$('t-export').addEventListener('click', exportCsv);
$('t-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const rows = importCsv(await file.text());
    alert(`Imported ${rows} set${rows === 1 ? '' : 's'}.`);
    setDeck(T.deck);
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
});
$('t-reset').addEventListener('click', () => {
  if (!confirm('Reset all progress for this deck?')) return;
  T.stats = {};
  T.turn = 0;
  saveDeck();
  $('t-menu').open = false;
  deal();
});
document.addEventListener('click', (e) => {
  // composedPath still lists a chip that re-rendering has just removed from the page
  const path = e.composedPath();
  for (const m of document.querySelectorAll('.t-menu[open]')) if (!path.includes(m)) m.open = false;
});
$('t-cards').addEventListener('click', advance);
$('t-prompt').addEventListener('click', advance);
const choose = (right) => {
  if (T.state === 'revealed') grade(right);
  else if (T.state === 'asking' && T.deck === 'recog') answerRecog(right);
};
$('t-right').addEventListener('click', () => choose(true));
$('t-wrong').addEventListener('click', () => choose(false));

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(e.key)) return;
  if (e.target.matches('input, select, summary') || e.target.closest('.t-menu')) return;
  if (T.state === 'empty') return;
  const arrow = e.key === 'ArrowRight' ? true : e.key === 'ArrowLeft' ? false : null;
  if (T.state === 'revealed' || (T.state === 'asking' && T.deck === 'recog')) {
    if (arrow !== null) { e.preventDefault(); choose(arrow); }
    return;
  }
  e.preventDefault();
  advance();
});

setDeck(T.deck);
