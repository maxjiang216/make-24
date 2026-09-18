'use strict';

/* ---------------- exact rational arithmetic ---------------- */
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a));
function rat(n, d = 1) {
  if (d === 0) return null;
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
}
const R = {
  add: (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d),
  sub: (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d),
  mul: (a, b) => rat(a.n * b.n, a.d * b.d),
  div: (a, b) => (b.n === 0 ? null : rat(a.n * b.d, a.d * b.n)),
};

/* ---------------- expression parser ---------------- */
// Grammar: expr := term (('+'|'-') term)* ; term := unary (('*'|'/') unary)*
// unary := '-'? factor ; factor := number | '(' expr ')'
// Returns { value, cards: [ints used] } or throws Error(message).
function parseExpr(src) {
  const text = src.toUpperCase().replace(/\s+/g, '')
    .replace(/[×✕]/g, '*').replace(/[÷]/g, '/')
    .replace(/[\[\{]/g, '(').replace(/[\]\}]/g, ')');
  let i = 0;
  const cards = [];
  const peek = () => text[i];
  const fail = (m) => { throw new Error(m); };

  function number() {
    // Multi-digit ranks first: 10..13 must not tokenize as 1 followed by a stray digit.
    const m = /^1[0-3]/.exec(text.slice(i, i + 2));
    if (m) { i += 2; return +m[0]; }
    const c = peek();
    if (c === 'A') { i++; return 1; }
    if (c === 'T') { i++; return 10; }
    if (c === 'J') { i++; return 11; }
    if (c === 'Q') { i++; return 12; }
    if (c === 'K') { i++; return 13; }
    if (c >= '1' && c <= '9') { i++; return +c; }
    return null;
  }
  function factor() {
    if (peek() === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') fail('missing )');
      i++;
      return v;
    }
    const n = number();
    if (n === null) fail(peek() ? `unexpected "${peek()}"` : 'unexpected end');
    cards.push(n);
    return rat(n);
  }
  function unary() {
    if (peek() === '-') { i++; const v = unary(); return R.sub(rat(0), v); }
    if (peek() === '+') { i++; return unary(); }
    return factor();
  }
  function term() {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const op = text[i++];
      const r = unary();
      const nv = op === '*' ? R.mul(v, r) : R.div(v, r);
      if (nv === null) fail('division by zero');
      v = nv;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = text[i++];
      v = op === '+' ? R.add(v, term()) : R.sub(v, term());
    }
    return v;
  }
  if (!text) fail('empty');
  const value = expr();
  if (i < text.length) fail(`unexpected "${text[i]}"`);
  return { value, cards };
}

// Validate an answer against the dealt card values. Returns null on success, else message.
function checkAnswer(src, want) {
  let r;
  try { r = parseExpr(src); } catch (e) { return e.message; }
  const a = [...r.cards].sort((x, y) => x - y).join(',');
  const b = [...want].sort((x, y) => x - y).join(',');
  if (a !== b) return `must use each card once (you used ${a || 'nothing'})`;
  if (!(r.value.d === 1 && r.value.n === 24)) {
    return `that is ${r.value.d === 1 ? r.value.n : r.value.n + '/' + r.value.d}, not 24`;
  }
  return null;
}

/* ---------------- cards ---------------- */
const SUITS = ['♠', '♥', '♦', '♣'];
const LABEL = [, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const key4 = (vals) => [...vals].sort((a, b) => a - b).join('-');
const solutionFor = (vals) => SOLUTIONS[key4(vals)];
const isSolvable = (vals) => solutionFor(vals) !== null;

function renderCards(el, cards) {
  el.innerHTML = '';
  for (const c of cards) {
    const d = document.createElement('div');
    d.className = 'card' + (c.suit === '♥' || c.suit === '♦' ? ' red' : '');
    d.innerHTML = `<span class="pip">${LABEL[c.v]}${c.suit}</span>` +
      `<span>${LABEL[c.v]}</span>` +
      `<span class="pip br">${LABEL[c.v]}${c.suit}</span>`;
    el.appendChild(d);
  }
}
function fullDeck() {
  const d = [];
  for (const s of SUITS) for (let v = 1; v <= 13; v++) d.push({ v, suit: s });
  return d;
}
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// Every solvable multiset, for uniform sampling in single mode.
const SOLVABLE_KEYS = Object.keys(SOLUTIONS).filter((k) => SOLUTIONS[k] !== null);

// Uniform over solvable multisets; suits assigned at random, distinct per repeated rank.
function randSolvableCards() {
  const vals = SOLVABLE_KEYS[Math.floor(Math.random() * SOLVABLE_KEYS.length)]
    .split('-').map(Number);
  const used = {};
  return vals.map((v) => {
    const free = SUITS.filter((s) => !(used[v] || []).includes(s));
    const suit = free[Math.floor(Math.random() * free.length)];
    (used[v] = used[v] || []).push(suit);
    return { v, suit };
  });
}

/* ---------------- timing helpers ---------------- */
const fmt = (ms) => (ms == null ? 'DNF' : (ms / 1000).toFixed(2));
function makeTimer(el) {
  let t0 = 0, raf = 0;
  const tick = () => {
    el.textContent = ((performance.now() - t0) / 1000).toFixed(2);
    raf = requestAnimationFrame(tick);
  };
  return {
    start() { t0 = performance.now(); cancelAnimationFrame(raf); tick(); },
    stop() { cancelAnimationFrame(raf); const e = performance.now() - t0; el.textContent = (e / 1000).toFixed(2); return e; },
    reset() { cancelAnimationFrame(raf); el.textContent = '0.00'; },
  };
}

/* ---------------- averages (DNF = null) ---------------- */
function mean(list) {
  if (list.some((x) => x == null)) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}
function olympic(list) {
  const dnfs = list.filter((x) => x == null).length;
  if (dnfs > 1) return null;
  const finite = list.filter((x) => x != null).sort((a, b) => a - b);
  const trimmed = dnfs === 1 ? finite.slice(1) : finite.slice(1, -1);
  if (!trimmed.length) return null;
  return trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
}
// Best value of a rolling stat over the whole history.
function bestRolling(times, n, fn) {
  let best = null;
  for (let i = n; i <= times.length; i++) {
    const v = fn(times.slice(i - n, i));
    if (v != null && (best == null || v < best)) best = v;
  }
  return best;
}

/* ================= SINGLE MODE ================= */
const S = {
  cards: [], times: JSON.parse(localStorage.getItem('make24.times') || '[]'),
  hist: JSON.parse(localStorage.getItem('make24.hist') || '[]'),
  running: false,
};
const sTimer = makeTimer(document.getElementById('s-timer'));
const sInput = document.getElementById('s-input');
const sMsg = document.getElementById('s-msg');

function sSave() {
  localStorage.setItem('make24.times', JSON.stringify(S.times));
  localStorage.setItem('make24.hist', JSON.stringify(S.hist.slice(-200)));
}
function sDeal() {
  S.cards = randSolvableCards();
  renderCards(document.getElementById('s-cards'), S.cards);
  sInput.value = '';
  sInput.focus();
  S.running = true;
  sTimer.start();
}
function sFinish(ms, sol) {
  S.times.push(ms);
  S.hist.push({ cards: S.cards.map((c) => c.v), ms, sol });
  S.running = false;
  sSave();
  sRender();
}
function sRender() {
  const t = S.times;
  const last = (n) => (t.length >= n ? t.slice(-n) : null);
  const put = (id, v) => (document.getElementById(id).textContent = v == null ? '–' : fmt(v));
  const finite = t.filter((x) => x != null);
  put('st-cur', t.length ? t[t.length - 1] : null);
  put('st-best', finite.length ? Math.min(...finite) : null);
  put('mo3-cur', last(3) && mean(last(3)));
  put('mo3-best', bestRolling(t, 3, mean));
  put('ao5-cur', last(5) && olympic(last(5)));
  put('ao5-best', bestRolling(t, 5, olympic));
  put('ao12-cur', last(12) && olympic(last(12)));
  put('ao12-best', bestRolling(t, 12, olympic));
  put('mean-cur', finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null);
  document.getElementById('mean-n').textContent = `${finite.length}/${t.length} solved`;

  const ol = document.getElementById('s-hist');
  ol.innerHTML = '';
  S.hist.slice(-50).reverse().forEach((h) => {
    const li = document.createElement('li');
    if (h.ms == null) li.className = 'dnf';
    li.innerHTML = `<b>${fmt(h.ms)}</b>  ${h.cards.map((v) => LABEL[v]).join(' ')}  ${h.sol || ''}`;
    ol.appendChild(li);
  });
}
sInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (!S.running) { sDeal(); sMsg.textContent = ''; return; }
    const err = checkAnswer(sInput.value, S.cards.map((c) => c.v));
    if (err) {
      sMsg.textContent = err;
      sMsg.className = 'msg bad';
      return;
    }
    const ms = sTimer.stop();
    sMsg.textContent = `solved in ${fmt(ms)}s — Enter for next`;
    sMsg.className = 'msg ok';
    sFinish(ms, sInput.value.trim());
    sInput.value = '';
  } else if (e.key === 'Escape') {
    if (!S.running) return;
    sTimer.stop();
    const sol = solutionFor(S.cards.map((c) => c.v));
    sMsg.textContent = sol ? `DNF — e.g. ${sol}` : 'DNF — this set is unsolvable';
    sMsg.className = 'msg bad';
    sFinish(null, sol ? `(gave up; ${sol})` : '(gave up; unsolvable)');
    sInput.value = '';
  }
});
document.getElementById('d-clear').addEventListener('click', () => {
  if (!confirm('Clear all deck-mode times?')) return;
  D.times = []; D.hist = []; dSave(); dRenderStats();
});
document.getElementById('s-clear').addEventListener('click', () => {
  if (!confirm('Clear all single-mode times?')) return;
  S.times = []; S.hist = []; sSave(); sRender();
});

/* ================= DECK MODE ================= */
let dT0 = 0;
const D = {
  deck: [], idx: 0, splits: [], marks: [], running: false, cards: [],
  times: JSON.parse(localStorage.getItem('make24.deckTimes') || '[]'),
  hist: JSON.parse(localStorage.getItem('make24.deckHist') || '[]'),
};
const dTimer = makeTimer(document.getElementById('d-timer'));
const dInput = document.getElementById('d-input');
const dMsg = document.getElementById('d-msg');
let dLastSplit = 0;

function dStart() {
  D.deck = shuffle(fullDeck());
  D.idx = 0; D.splits = []; D.marks = []; D.running = true;
  dLastSplit = 0;
  document.getElementById('d-result').textContent = '';
  document.getElementById('d-splits').innerHTML = '';
  dMsg.textContent = '';
  dInput.disabled = false;
  dInput.value = '';
  dInput.focus();
  dTimer.start();
  dNext();
}
function dNext() {
  D.cards = D.deck.slice(D.idx * 4, D.idx * 4 + 4);
  renderCards(document.getElementById('d-cards'), D.cards);
  document.getElementById('d-progress').textContent = `set ${D.idx + 1} / 13`;
}
function dLogSplit(split, vals, answer, marked) {
  const li = document.createElement('li');
  const bad = marked && isSolvable(vals);
  if (bad) li.className = 'dnf';
  li.innerHTML = `<b>${fmt(split)}</b>  ${vals.map((v) => LABEL[v]).join(' ')}  ` +
    (marked ? (bad ? `marked unsolvable — WRONG, e.g. ${solutionFor(vals)}` : 'unsolvable ✓') : answer);
  document.getElementById('d-splits').appendChild(li);
}
function dSubmit() {
  const raw = dInput.value.trim();
  const vals = D.cards.map((c) => c.v);
  const marked = /^(u|x|unsolvable|imp|impossible)$/i.test(raw);
  if (!marked) {
    const err = checkAnswer(raw, vals);
    if (err) { dMsg.textContent = err; dMsg.className = 'msg bad'; return; }
  }
  const total = performance.now() - dT0;
  const split = total - dLastSplit;
  dLastSplit = total;
  const wrong = marked && isSolvable(vals);
  D.splits.push(split);
  D.marks.push({ vals, marked, wrong });
  dLogSplit(split, vals, raw, marked);
  dMsg.textContent = '';
  dInput.value = '';
  D.idx++;
  // A wrong "unsolvable" call ends the attempt right there — the run is a DNF either
  // way, so there is nothing left to time. The splits so far stay on screen.
  if (wrong) dEnd(total, { vals, at: D.idx });
  else if (D.idx === 13) dEnd(total);
  else dNext();
}
function dSave() {
  localStorage.setItem('make24.deckTimes', JSON.stringify(D.times));
  localStorage.setItem('make24.deckHist', JSON.stringify(D.hist.slice(-100)));
}
function dRenderStats() {
  const t = D.times;
  const finite = t.filter((x) => x != null);
  const last = (n) => (t.length >= n ? t.slice(-n) : null);
  const put = (id, v) => (document.getElementById(id).textContent = v == null ? '–' : fmt(v));
  put('d-cur', t.length ? t[t.length - 1] : null);
  put('d-best', finite.length ? Math.min(...finite) : null);
  put('d-mo3', last(3) && mean(last(3)));
  put('d-mo3b', bestRolling(t, 3, mean));
  put('d-ao5', last(5) && olympic(last(5)));
  put('d-ao5b', bestRolling(t, 5, olympic));
  put('d-ao12', last(12) && olympic(last(12)));
  put('d-ao12b', bestRolling(t, 12, olympic));
  put('d-mean', finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : null);
  document.getElementById('d-n').textContent = `${finite.length}/${t.length} valid`;
  // per-set pace of the best deck, and the single fastest set ever
  put('d-per', finite.length ? Math.min(...finite) / 13 : null);
  const splits = D.hist.flatMap((h) => h.splits || []);
  put('d-split-best', splits.length ? Math.min(...splits) : null);

  const ol = document.getElementById('d-hist');
  ol.innerHTML = '';
  D.hist.slice(-40).reverse().forEach((h) => {
    const li = document.createElement('li');
    if (h.ms == null) li.className = 'dnf';
    li.innerHTML = `<b>${fmt(h.ms)}</b>  ${h.sets}/13 sets` +
      (h.marked ? `  ·  ${h.marked} unsolvable` : '') +
      (h.ms == null ? `  ·  DNF on ${h.bust}` : `  ·  ${(h.raw / h.sets / 1000).toFixed(2)}s/set`);
    ol.appendChild(li);
  });
}
function dEnd(total, bust) {
  D.running = false;
  dTimer.stop();
  dInput.disabled = true;
  const marked = D.marks.filter((m) => m.marked).length;
  const res = document.getElementById('d-result');
  D.times.push(bust ? null : total);
  D.hist.push({
    ms: bust ? null : total,
    raw: total,
    sets: bust ? bust.at : 13,
    marked,
    splits: bust ? [] : D.splits.slice(),
    bust: bust ? bust.vals.map((v) => LABEL[v]).join(' ') : null,
  });
  dSave();
  dRenderStats();
  if (bust) {
    document.getElementById('d-progress').textContent = `DNF on set ${bust.at} / 13`;
    res.innerHTML = `<span style="color:var(--bad)">DNF on set ${bust.at} — ` +
      `${bust.vals.map((v) => LABEL[v]).join(' ')} is solvable: ${solutionFor(bust.vals)}` +
      `<br>attempt stopped at ${fmt(total)}s after ${bust.at} of 13 sets.</span>`;
  } else {
    res.innerHTML = `<span style="color:var(--ok)">VALID — ${fmt(total)}s for the deck` +
      ` (${marked} set${marked === 1 ? '' : 's'} marked unsolvable, all correct)</span>`;
  }
}
document.getElementById('d-start').addEventListener('click', () => {
  dStart();
  dT0 = performance.now();
});
dInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && D.running) dSubmit();
});

/* ================= tabs ================= */
const MODES = { single: 's', deck: 'd', solve: 'v' };
function show(which) {
  for (const m in MODES) {
    document.getElementById(m).classList.toggle('hidden', m !== which);
    document.getElementById('tab-' + m).classList.toggle('active', m === which);
  }
  document.getElementById(MODES[which] + '-input').focus();
  if (which === 'solve') runSolver();
}
for (const m in MODES) document.getElementById('tab-' + m).addEventListener('click', () => show(m));


/* ================= SOLVER MODE ================= */
// Enumerate every distinct way to make 24, keeping all intermediates non-negative.
// Expressions are deduped by a canonical key: + and * are flattened to sorted n-ary
// lists, so (1+2)+3, 3+(2+1) and 1+(3+2) all collapse to one solution.
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

// Canonical key: two solutions are the same when their trees agree up to commutativity,
// associativity and inverses. Additive nodes normalise to a (positive, negative) multiset
// of terms, multiplicative nodes to a (numerator, denominator) multiset of factors — so
// 2*3*4/1, 2/1*3*4 and 3*2*(4/1) collapse to one, as do 6*6-6-6 and 6*6-(6+6).
const addParts = (n) => (n.op === '+' || n.op === '-' ? [n.pos, n.neg] : [[n.key], []]);
const mulParts = (n) => (n.op === '*' || n.op === '/' ? [n.num, n.den] : [[n.key], []]);
const bag = (tag, a, b) => `${tag}[${[...a].sort()}|${[...b].sort()}]`;

function leaf(n) {
  return { v: rat(n), op: null, disp: String(n), key: 'L' + n };
}
function join(a, b, op) {
  let v;
  if (op === '+') v = R.add(a.v, b.v);
  else if (op === '-') v = R.sub(a.v, b.v);
  else if (op === '*') v = R.mul(a.v, b.v);
  else v = R.div(a.v, b.v);
  if (v === null || v.n < 0) return null; // no negative intermediates

  const side = (c) => (c.op && PREC[c.op] < PREC[op] ? `(${c.disp})` : c.disp);
  // right operand needs parens at equal precedence for the non-commutative ops: 8-(3-1)
  const rhs = (c) =>
    c.op && PREC[c.op] <= PREC[op] && (op === '-' || op === '/') ? `(${c.disp})` : side(c);

  const node = { v, op, disp: `${side(a)}${op}${rhs(b)}` };
  if (op === '+' || op === '-') {
    const [ap, an] = addParts(a), [bp, bn] = addParts(b);
    node.pos = op === '+' ? [...ap, ...bp] : [...ap, ...bn];
    node.neg = op === '+' ? [...an, ...bn] : [...an, ...bp];
    node.key = bag('A', node.pos, node.neg);
  } else {
    const [an2, ad] = mulParts(a), [bn2, bd] = mulParts(b);
    node.num = op === '*' ? [...an2, ...bn2] : [...an2, ...bd];
    node.den = op === '*' ? [...ad, ...bd] : [...ad, ...bn2];
    node.key = bag('M', node.num, node.den);
  }
  return node;
}
function solveAll(values, cap = 400) {
  const out = new Map();
  const walk = (nodes) => {
    if (out.size >= cap) return;
    if (nodes.length === 1) {
      const n = nodes[0];
      if (n.v.d === 1 && n.v.n === 24 && !out.has(n.key)) out.set(n.key, n.disp);
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const rest = nodes.filter((_, k) => k !== i && k !== j);
        for (const op of ['+', '-', '*', '/']) {
          for (const [a, b] of [[nodes[i], nodes[j]], [nodes[j], nodes[i]]]) {
            const m = join(a, b, op);
            if (m) walk([...rest, m]);
            if (op === '+' || op === '*') break; // commutative, one order is enough
          }
        }
      }
    }
  };
  walk(values.map(leaf));
  return [...out.values()].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

const vInput = document.getElementById('v-input');
const vMsg = document.getElementById('v-msg');
function runSolver() {
  const raw = vInput.value.toUpperCase().match(/10|1[0-3]|[1-9]|[AJQKT]/g) || [];
  const map = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
  const vals = raw.map((t) => map[t] ?? +t);
  const list = document.getElementById('v-list');
  const strat = document.getElementById('v-strategy');
  list.innerHTML = '';
  strat.textContent = '';
  if (vals.length !== 4) {
    vMsg.textContent = `need exactly 4 cards, got ${vals.length}`;
    vMsg.className = 'msg bad';
    document.getElementById('v-cards').innerHTML = '';
    return;
  }
  vMsg.textContent = '';
  renderCards(document.getElementById('v-cards'), vals.map((v, i) => ({ v, suit: SUITS[i] })));
  const sols = solveAll(vals);
  const key = key4(vals);
  const canon = typeof CANONICAL !== 'undefined' ? CANONICAL[key] : null;
  if (!sols.length) {
    strat.innerHTML = '<span style="color:var(--bad)">unsolvable</span>';
    return;
  }
  strat.innerHTML = `<span style="color:var(--ok)">${sols.length} distinct solution${sols.length === 1 ? '' : 's'}</span>` +
    (canon ? `  ·  canonical strategy: <b>${canon}</b>` : '');
  for (const s of sols) {
    const li = document.createElement('li');
    li.textContent = s;
    list.appendChild(li);
  }
}
vInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSolver(); });
vInput.addEventListener('input', runSolver);

/* boot */
sRender();
dRenderStats();
sDeal();
