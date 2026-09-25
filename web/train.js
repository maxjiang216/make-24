'use strict';

/* ================= TRAIN: flash cards with spaced repetition ================= */
// Two decks share the same scheduler:
//  - recog: all 1820 sets, answer "solvable or not"
//  - solve: the 1362 solvable sets, find a solution
// Each set keeps { lvl, due, n, ok, ema } per deck in localStorage.

const ALL_KEYS = Object.keys(SOLUTIONS);
const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
// Wait before a set comes back, by level. Level 0 = just missed.
const INTERVALS = [30e3, 5 * MIN, 30 * MIN, 4 * HOUR, DAY, 3 * DAY, 8 * DAY, 21 * DAY, 60 * DAY];
const MASTERED = 4; // level reached after surviving the 1-day interval step
const LEARNING_CAP = 8; // new sets are held back while this many are still being learned
const EMA = 0.3; // weight of the latest time in the rolling average

const DECKS = {
  recog: { keys: ALL_KEYS, target: 3 },
  solve: { keys: SOLVABLE_KEYS, target: 10 },
};

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
  stats: null, // key -> { lvl, due, n, ok, ema }
  key: null,
  last: null,
  state: 'idle', // 'asking' | 'revealed'
  ms: 0,
};

/* ---------------- new-card order ---------------- */
// Recognition deck: a fixed shuffle (saved, so "new" stays stable across visits).
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
const newOrder = () => (T.deck === 'recog' ? recogOrder() : solveOrder(T.order));

/* ---------------- scheduler ---------------- */
function pickNext() {
  const now = Date.now();
  const seen = Object.entries(T.stats);
  const notLast = ([k]) => k !== T.last || seen.length === 1;

  // 1. anything due, most overdue first
  const due = seen.filter(([, s]) => s.due <= now).filter(notLast).sort((a, b) => a[1].due - b[1].due);
  if (due.length) return due[0][0];

  // 2. a new set, unless too many are still being learned
  const learning = seen.filter(([, s]) => s.lvl < 2);
  if (learning.length < LEARNING_CAP) {
    const next = newOrder().find((k) => !T.stats[k]);
    if (next) return next;
  }

  // 3. nothing due: practise ahead, soonest due first
  const ahead = seen.filter(notLast).sort((a, b) => a[1].due - b[1].due);
  return ahead.length ? ahead[0][0] : newOrder()[0];
}

function grade(right) {
  const s = T.stats[T.key] || (T.stats[T.key] = { lvl: 0, due: 0, n: 0, ok: 0, ema: null });
  const fast = T.ms <= targetSec() * 1000;
  s.n++;
  s.ema = s.ema == null ? T.ms : EMA * T.ms + (1 - EMA) * s.ema;
  if (!right) s.lvl = 0;
  else {
    s.ok++;
    if (fast) s.lvl = Math.min(s.lvl + 1, INTERVALS.length - 1);
    else s.lvl = Math.max(s.lvl, 1);
  }
  s.due = Date.now() + INTERVALS[s.lvl];
  store.set('stats-' + T.deck, T.stats);
  T.last = T.key;
  ask();
}

/* ---------------- UI ---------------- */
const $ = (id) => document.getElementById(id);
const timer = makeTimer($('t-timer'));
const targetSec = () => Math.max(0.5, +$('target').value || DECKS[T.deck].target);

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
const pct = (a, b) => (b ? Math.round((100 * a) / b) + '%' : '–');

function ask() {
  T.key = pickNext();
  T.state = 'asking';
  renderCards($('t-cards'), shuffle(randomSuits(T.key.split('-').map(Number))));
  $('t-prompt').textContent = T.deck === 'recog'
    ? 'Solvable? Press any key (or tap the cards) when you know.'
    : 'Find a solution. Press any key (or tap the cards) when you have it.';
  $('t-answer').innerHTML = '';
  $('t-grade').classList.add('hidden');
  $('t-card-stats').textContent = setStatsText(T.key);
  timer.start();
  renderProgress();
}

function reveal() {
  if (T.state !== 'asking') return;
  T.ms = timer.stop();
  T.state = 'revealed';
  $('t-prompt').textContent = '';
  const sol = SOLUTIONS[T.key];
  const ans = $('t-answer');
  if (T.deck === 'recog') {
    ans.innerHTML = sol
      ? `<div class="big ok">SOLVABLE</div><div class="dim"></div>`
      : '<div class="big bad">UNSOLVABLE</div>';
    if (sol) ans.lastChild.textContent = 'e.g. ' + sol;
  } else {
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
  $('t-grade').classList.remove('hidden');
}

function setStatsText(k) {
  const s = T.stats[k];
  if (!s) return 'new set';
  return `this set: ${s.ok}/${s.n} right · avg ${fmt(s.ema)}s · level ${s.lvl}`;
}

function renderProgress() {
  const keys = DECKS[T.deck].keys;
  const now = Date.now();
  let seen = 0, mastered = 0, due = 0, n = 0, ok = 0;
  for (const k of keys) {
    const s = T.stats[k];
    if (!s) continue;
    seen++; n += s.n; ok += s.ok;
    if (s.lvl >= MASTERED) mastered++;
    if (s.due <= now) due++;
  }
  $('t-progress').textContent =
    `seen ${seen}/${keys.length} · mastered ${mastered} · due now ${due} · accuracy ${pct(ok, n)}`;

  // Weakest: lowest accuracy, then slowest rolling time.
  const weak = keys.filter((k) => T.stats[k]?.n)
    .map((k) => ({ k, s: T.stats[k] }))
    .sort((a, b) => a.s.ok / a.s.n - b.s.ok / b.s.n || b.s.ema - a.s.ema)
    .slice(0, 10);
  const ol = $('t-weak');
  ol.innerHTML = '';
  for (const { k, s } of weak) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b> <span></span>';
    li.firstChild.textContent = cardText(k);
    li.lastChild.textContent = ` ${pct(s.ok, s.n)} right · ${fmt(s.ema)}s · ${SOLUTIONS[k] ? 'solvable' : 'unsolvable'}`;
    ol.appendChild(li);
  }
}

function setDeck(d) {
  T.deck = d;
  store.set('deck', d);
  T.stats = store.get('stats-' + d, {});
  T.last = null;
  $('deck-recog').classList.toggle('active', d === 'recog');
  $('deck-solve').classList.toggle('active', d === 'solve');
  $('order-wrap').classList.toggle('hidden', d !== 'solve');
  $('target').value = store.get('target-' + d, DECKS[d].target);
  ask();
}

$('deck-recog').addEventListener('click', (e) => { e.currentTarget.blur(); setDeck('recog'); });
$('deck-solve').addEventListener('click', (e) => { e.currentTarget.blur(); setDeck('solve'); });
$('order').value = T.order;
$('order').addEventListener('change', () => {
  T.order = $('order').value;
  store.set('order', T.order);
  $('order').blur();
  if (T.state === 'asking' && !T.stats[T.key]) ask(); // swap an unseen set for the new order's first
});
$('target').addEventListener('change', () => store.set('target-' + T.deck, targetSec()));
$('t-cards').addEventListener('click', reveal);
$('t-right').addEventListener('click', () => T.state === 'revealed' && grade(true));
$('t-wrong').addEventListener('click', () => T.state === 'revealed' && grade(false));
$('t-reset').addEventListener('click', () => {
  if (!confirm('Reset all progress for this deck?')) return;
  T.stats = {};
  store.set('stats-' + T.deck, T.stats);
  ask();
});

document.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
  if (e.target.matches('input, select')) return;
  if (T.state === 'asking') {
    e.preventDefault();
    reveal();
  } else if (T.state === 'revealed') {
    if (e.key === 'ArrowRight') grade(true);
    else if (e.key === 'ArrowLeft') grade(false);
  }
});

setDeck(T.deck);
