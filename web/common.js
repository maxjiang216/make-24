'use strict';

// Shared by index.html (app.js) and train.html (train.js): exact arithmetic, the
// expression parser, card rendering, timers, and the solver's equivalence classes.

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


/* ================= SOLVER MODE ================= */
// Enumerate every distinct way to make 24, keeping all intermediates non-negative.
// Expressions are deduped by a canonical key: + and * are flattened to sorted n-ary
// lists, so (1+2)+3, 3+(2+1) and 1+(3+2) all collapse to one solution.
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

// Canonical key: two solutions are the same when their trees agree up to commutativity,
// associativity and inverses. Additive nodes normalise to a (positive, negative) multiset
// of terms, multiplicative nodes to a (numerator, denominator) multiset of factors — so
// 2*3*4/1, 2/1*3*4, 3*2*(4/1) and 2*3*4*1 collapse to one, as do 6*6-6-6 and 6*6-(6+6).
// Flattened operands of a sum (added, subtracted) or product (multiplied, divided).
// Children are kept as nodes so the representative can be rebuilt from them.
const addNodes = (n) => (n.op === '+' || n.op === '-' ? [n.posN, n.negN] : [[n], []]);
const mulNodes = (n) => (n.op === '*' || n.op === '/' ? [n.numN, n.denN] : [[n], []]);
const keyOf = (n) => n.key;
// Subtracting 0 is the same as adding it, and dividing by 1 the same as multiplying
// by it: 6*4/1 ~ 6*4*1 and 6*4/(2-1) ~ 6*4*(2-1).
function moveNeutral(up, down, id) {
  const keep = down.filter((c) => !(c.v.d === 1 && c.v.n === id));
  return [[...up, ...down.filter((c) => !keep.includes(c))], keep];
}
const bag = (tag, a, b) => `${tag}[${[...a].sort()}|${[...b].sort()}]`;


// Standard written form of a class: for a sum, added terms first then subtracted
// terms, each group sorted by value from largest to smallest; products likewise
// (multiplied factors, then divisors). Applied recursively to every subexpression.
// Ties in value fall back to the text so the choice is deterministic.
const cmpRat = (a, b) => a.n * b.d - b.n * a.d;
function canonDisp(n) {
  if (!n.op) return n.disp;
  const additive = n.op === '+' || n.op === '-';
  const order = (list) => list
    .map((c) => ({ v: c.v, s: wrap(c, additive), t: canonDisp(c) }))
    .sort((x, y) => cmpRat(y.v, x.v) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0))
    .map((c) => c.s);
  const [up, down] = additive ? [n.posN, n.negN] : [n.numN, n.denN];
  const [plus, minus] = additive ? ['+', '-'] : ['*', '/'];
  return order(up).join(plus) + order(down).map((s) => minus + s).join('');
}
// Children of a flattened sum are never sums, so they need no parens;
// children of a flattened product need parens only when they are sums.
function wrap(c, parentAdditive) {
  const s = canonDisp(c);
  return !parentAdditive && (c.op === '+' || c.op === '-') ? `(${s})` : s;
}

function leaf(n) {
  return { v: rat(n), op: null, disp: String(n), key: 'L' + n, cards: [n] };
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

  const node = {
    v, op, a, b, cards: [...a.cards, ...b.cards].sort((x, y) => x - y),
    disp: `${side(a)}${op}${rhs(b)}`,
  };
  if (op === '+' || op === '-') {
    const [aP, aN] = addNodes(a), [bP, bN] = addNodes(b);
    [node.posN, node.negN] = moveNeutral(
      op === '+' ? [...aP, ...bP] : [...aP, ...bN],
      op === '+' ? [...aN, ...bN] : [...aN, ...bP], 0);
    node.key = bag('A', node.posN.map(keyOf), node.negN.map(keyOf));
  } else {
    const [aU, aD] = mulNodes(a), [bU, bD] = mulNodes(b);
    [node.numN, node.denN] = moveNeutral(
      op === '*' ? [...aU, ...bU] : [...aU, ...bD],
      op === '*' ? [...aD, ...bD] : [...aD, ...bU], 1);
    node.key = bag('M', node.numN.map(keyOf), node.denN.map(keyOf));
  }
  return node;
}
// Rebuild a tree after replacing some subtrees (Map old node -> new node).
// Returns null if the result would divide by zero or go negative.
function rebuild(n, repl) {
  if (repl.has(n)) return repl.get(n);
  if (!n.op) return n;
  const a = rebuild(n.a, repl), b = rebuild(n.b, repl);
  return a && b ? join(a, b, n.op) : null;
}
const subtrees = (n, acc = []) => {
  acc.push(n);
  if (n.op) { subtrees(n.a, acc); subtrees(n.b, acc); }
  return acc;
};
const valKey = (n) => `${n.v.n}/${n.v.d}`;
const isVal = (n, k) => n.v.d === 1 && n.v.n === k;

// Distance between two classes: the number of cards touched by the smallest change
// that turns one into the other. Changes that count:
//  - substitute: rebuild one piece from the same cards to the same value
//    (8*(5-4/2) ~ 8*(5+2-4): the 3 is made from 2, 4, 5 either way; 3 cards)
//  - swap: exchange two pieces of equal value (9*6/2-3 ~ 9*3-6/2; 3 cards)
//  - pad: the same expression with a +0 or *1 piece attached elsewhere
//    (6*4*1*1 ~ 6*4+1-1; 2 cards)
// Classes with no such link are unrelated. This only affects display order.
function classDistances(trees) {
  const dist = new Map(); // "k1|k2" -> cards touched
  const link = (k1, k2, cost) => {
    if (k1 === k2) return;
    const id = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    if (!(dist.get(id) <= cost)) dist.set(id, cost);
  };
  // Every piece that appears in some solution, by (cards, value).
  const pieces = new Map();
  for (const t of trees) {
    for (const x of subtrees(t)) {
      if (!x.op || x === t) continue;
      const id = `${x.cards}|${valKey(x)}`;
      if (!pieces.has(id)) pieces.set(id, new Map());
      pieces.get(id).set(x.key, x);
    }
  }
  const cores = new Map(); // core key -> Map(class key -> cards dropped)
  for (const t of trees) {
    const all = subtrees(t);
    for (let i = 0; i < all.length; i++) {
      const x = all[i];
      if (x.op && x !== t) {
        for (const y of pieces.get(`${x.cards}|${valKey(x)}`).values()) {
          if (y.key === x.key) continue;
          const u = rebuild(t, new Map([[x, y]]));
          if (u) link(t.key, u.key, x.cards.length);
        }
      }
      const xs = subtrees(x);
      for (let j = i + 1; j < all.length; j++) {
        const y = all[j];
        if (xs.includes(y) || subtrees(y).includes(x) || valKey(x) !== valKey(y)) continue;
        const u = rebuild(t, new Map([[x, y], [y, x]]));
        if (u) link(t.key, u.key, x.cards.length + y.cards.length);
      }
      if (!x.op) continue;
      const drop = []; // [kept child, dropped child]
      if (x.op === '+' || x.op === '*') {
        const id = x.op === '+' ? 0 : 1;
        if (isVal(x.a, id)) drop.push([x.b, x.a]);
        if (isVal(x.b, id)) drop.push([x.a, x.b]);
      } else if (isVal(x.b, x.op === '-' ? 0 : 1)) drop.push([x.a, x.b]);
      for (const [keep, gone] of drop) {
        const core = rebuild(t, new Map([[x, keep]]));
        if (!core) continue;
        if (!cores.has(core.key)) cores.set(core.key, new Map());
        const m = cores.get(core.key);
        if (!(m.get(t.key) <= gone.cards.length)) m.set(t.key, gone.cards.length);
      }
    }
  }
  for (const m of cores.values()) {
    const es = [...m];
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) link(es[i][0], es[j][0], Math.max(es[i][1], es[j][1]));
    }
  }
  return dist;
}

// Order classes so neighbours are as close as possible (shortest path through all of
// them). Exact for small lists; nearest-neighbour plus 2-opt beyond that.
const UNRELATED = 10;
function orderClasses(n, d) {
  if (n <= 2) return [...Array(n).keys()];
  let best;
  if (n <= 12) {
    const full = (1 << n) - 1;
    const cost = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
    const from = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
    for (let i = 0; i < n; i++) cost[1 << i][i] = i * 1e-6; // prefer starting early in the list
    for (let m = 1; m <= full; m++) {
      for (let i = 0; i < n; i++) {
        if (!(m >> i & 1) || cost[m][i] === Infinity) continue;
        for (let j = 0; j < n; j++) {
          if (m >> j & 1) continue;
          const c = cost[m][i] + d(i, j), m2 = m | (1 << j);
          if (c < cost[m2][j]) { cost[m2][j] = c; from[m2][j] = i; }
        }
      }
    }
    let end = 0;
    for (let i = 1; i < n; i++) if (cost[full][i] < cost[full][end]) end = i;
    best = [];
    for (let m = full, i = end; i >= 0;) { best.push(i); const p = from[m][i]; m ^= 1 << i; i = p; }
    best.reverse();
  } else {
    best = [0];
    const left = new Set([...Array(n).keys()].slice(1));
    while (left.size) {
      const last = best[best.length - 1];
      let pick = -1;
      for (const j of left) if (pick < 0 || d(last, j) < d(last, pick)) pick = j;
      best.push(pick);
      left.delete(pick);
    }
    const len = (p) => p.slice(1).reduce((s, x, k) => s + d(p[k], x), 0);
    for (let improved = true; improved;) {
      improved = false;
      for (let i = 1; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const q = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
          if (len(q) < len(best) - 1e-9) { best = q; improved = true; }
        }
      }
    }
  }
  return best[0] > best[best.length - 1] ? best.reverse() : best;
}

// Group every expression for 24 by equivalence class. Unlike the in-game search this
// explores both operand orders for + and *, so a class lists all its written forms.
// Returns classes in display order: { forms: [representative, ...others], next }
// where next is the distance to the following class (UNRELATED if none).
function solveClasses(values) {
  const classes = new Map(); // key -> Set of display strings
  const lead = new Map(); // key -> standard written form
  const trees = [];
  const walk = (nodes) => {
    if (nodes.length === 1) {
      const n = nodes[0];
      if (n.v.d === 1 && n.v.n === 24) {
        if (!classes.has(n.key)) classes.set(n.key, new Set());
        classes.get(n.key).add(n.disp);
        if (!lead.has(n.key)) lead.set(n.key, canonDisp(n));
        trees.push(n);
      }
      return;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = 0; j < nodes.length; j++) {
        if (i === j) continue;
        const rest = nodes.filter((_, k) => k !== i && k !== j);
        for (const op of ['+', '-', '*', '/']) {
          const m = join(nodes[i], nodes[j], op);
          if (m) walk([...rest, m]);
        }
      }
    }
  };
  walk(values.map(leaf));

  const byLen = (a, b) => a.length - b.length || a.localeCompare(b);
  const list = [...classes]
    .map(([k, set]) => {
      const rep = lead.get(k);
      return { key: k, forms: [rep, ...[...set].filter((f) => f !== rep).sort(byLen)] };
    })
    .sort((a, b) => byLen(a.forms[0], b.forms[0]));
  const dist = classDistances(trees);
  const d = (i, j) => {
    const [x, y] = [list[i].key, list[j].key].sort();
    return dist.get(`${x}|${y}`) ?? UNRELATED;
  };
  const order = orderClasses(list.length, d);
  return order.map((i, k) => ({
    forms: list[i].forms,
    next: k + 1 < order.length ? d(i, order[k + 1]) : UNRELATED,
  }));
}

// Input: "1 2 3 4", "1,2,3,4", or "1234". With separators each token is a card
// (1..13, 0 = 10, A/T/J/Q/K). Without, each character is one card.
const CARD_CHARS = { A: 1, T: 10, J: 11, Q: 12, K: 13, 0: 10 };
function parseCards(raw) {
  const s = raw.trim().toUpperCase();
  if (!s) return { vals: [], err: 'enter four cards' };
  const tokens = /[\s,]/.test(s) ? s.split(/[\s,]+/).filter(Boolean) : [...s];
  const vals = [];
  for (const t of tokens) {
    let v = CARD_CHARS[t] ?? (/^\d+$/.test(t) ? +t : NaN);
    if (!(v >= 1 && v <= 13)) return { vals, err: `"${t}" is not a card (use 1-13, 0 = 10, A T J Q K)` };
    vals.push(v);
  }
  if (vals.length !== 4) return { vals, err: `need exactly 4 cards, got ${vals.length}` };
  return { vals, err: null };
}
