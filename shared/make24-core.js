'use strict';

// Shared between the browser (web/app.js companion pages, web/multiplayer/mp-app.js)
// and the Cloudflare Workers backend (server/src). No DOM, no Node-only APIs.
//
// Everything below except `joinAny`/`canonicalizeExpr` is moved verbatim from
// web/app.js (exact-rational arithmetic, the expression parser, answer
// validation, and the solver's equivalence-canonicalization engine). web/app.js
// itself is left untouched and keeps its own copy — see the multiplayer plan
// for why duplication here is the deliberate, lower-risk choice.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Make24Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {

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

const key4 = (vals) => [...vals].sort((a, b) => a - b).join('-');

/* ---------------- equivalence canonicalization ---------------- */
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 };

// Canonical key: two solutions are the same when their trees agree up to commutativity,
// associativity and inverses. Additive nodes normalise to a (positive, negative) multiset
// of terms, multiplicative nodes to a (numerator, denominator) multiset of factors — so
// 2*3*4/1, 2/1*3*4 and 3*2*(4/1) collapse to one, as do 6*6-6-6 and 6*6-(6+6), and
// (per the multiplayer equivalence spec) 3+4-4 / 3-4+4 and 3*2/2 / 3/2*2 collapse too.
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

function leaf(n) {
  return { v: rat(n), op: null, disp: String(n), key: 'L' + n };
}
function buildJoin(a, b, op, allowNegative) {
  let v;
  if (op === '+') v = R.add(a.v, b.v);
  else if (op === '-') v = R.sub(a.v, b.v);
  else if (op === '*') v = R.mul(a.v, b.v);
  else v = R.div(a.v, b.v);
  if (v === null) return null; // division by zero
  if (!allowNegative && v.n < 0) return null; // no negative intermediates (solveAll only)

  const side = (c) => (c.op && PREC[c.op] < PREC[op] ? `(${c.disp})` : c.disp);
  const rhs = (c) =>
    c.op && PREC[c.op] <= PREC[op] && (op === '-' || op === '/') ? `(${c.disp})` : side(c);

  const node = { v, op, disp: `${side(a)}${op}${rhs(b)}` };
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
// join: used by solveAll's brute-force search — rejects negative intermediates
// so only "nice" solutions are enumerated (matches web/app.js exactly).
const join = (a, b, op) => buildJoin(a, b, op, false);
// joinAny: used by canonicalizeExpr for arbitrary player-submitted expressions,
// which may legally pass through negative intermediates (e.g. 1-5+... ).
const joinAny = (a, b, op) => buildJoin(a, b, op, true);

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

// Canonicalize a single submitted expression by parsing it directly into
// join-shaped nodes (via joinAny), instead of brute-forcing all pairings.
// Returns { value, cards, key, disp } or throws Error(message), same contract
// as parseExpr. Call checkAnswer first for validity; this assumes it's valid.
function canonicalizeExpr(src) {
  const text = src.toUpperCase().replace(/\s+/g, '')
    .replace(/[×✕]/g, '*').replace(/[÷]/g, '/')
    .replace(/[\[\{]/g, '(').replace(/[\]\}]/g, ')');
  let i = 0;
  const cards = [];
  const peek = () => text[i];
  const fail = (m) => { throw new Error(m); };

  function number() {
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
    return leaf(n);
  }
  function unary() {
    if (peek() === '-') { i++; const v = unary(); const n = joinAny(leaf(0), v, '-'); if (n === null) fail('division by zero'); return n; }
    if (peek() === '+') { i++; return unary(); }
    return factor();
  }
  function term() {
    let v = unary();
    while (peek() === '*' || peek() === '/') {
      const op = text[i++];
      const r = unary();
      const nv = joinAny(v, r, op);
      if (nv === null) fail('division by zero');
      v = nv;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = text[i++];
      const nv = joinAny(v, term(), op);
      if (nv === null) fail('division by zero');
      v = nv;
    }
    return v;
  }
  if (!text) fail('empty');
  const node = expr();
  if (i < text.length) fail(`unexpected "${text[i]}"`);
  return { value: node.v, cards, key: node.key, disp: node.disp };
}

return {
  gcd, rat, R,
  parseExpr, checkAnswer, key4,
  PREC, addNodes, mulNodes, moveNeutral, bag, leaf, join, joinAny, solveAll,
  canonicalizeExpr,
};

});
