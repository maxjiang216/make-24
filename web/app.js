'use strict';

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
  // Deal the first Single set on first visit, so its timer doesn't run in the background.
  if (which === 'single' && !S.cards.length) sDeal();
}
for (const m in MODES) document.getElementById('tab-' + m).addEventListener('click', () => show(m));


/* ================= SOLVER MODE ================= */

const vInput = document.getElementById('v-input');
const vMsg = document.getElementById('v-msg');
let vMode = 'check';
function runSolver() {
  const { vals, err } = parseCards(vInput.value);
  const list = document.getElementById('v-list');
  const strat = document.getElementById('v-strategy');
  list.innerHTML = '';
  strat.textContent = '';
  if (err) {
    vMsg.textContent = err;
    vMsg.className = 'msg bad';
    document.getElementById('v-cards').innerHTML = '';
    return;
  }
  vMsg.textContent = '';
  renderCards(document.getElementById('v-cards'), vals.map((v, i) => ({ v, suit: SUITS[i] })));

  if (vMode === 'check') {
    strat.innerHTML = isSolvable(vals)
      ? '<span style="color:var(--ok)">solvable</span>'
      : '<span style="color:var(--bad)">unsolvable</span>';
    return;
  }

  const ordered = solveClasses(vals);
  const classes = ordered.map((c) => c.forms);
  if (!classes.length) {
    strat.innerHTML = '<span style="color:var(--bad)">unsolvable</span>';
    return;
  }
  const canon = typeof CANONICAL !== 'undefined' ? CANONICAL[key4(vals)] : null;
  const total = classes.reduce((t, c) => t + c.length, 0);
  strat.innerHTML = `<span style="color:var(--ok)">${classes.length} distinct solution${classes.length === 1 ? '' : 's'}</span>` +
    ` (${total} written forms)` + (canon ? `  ·  canonical strategy: <b>${canon}</b>` : '');
  // Bar on the left: bright between classes that differ by a small change, fading as
  // the change touches more cards, absent between unrelated classes.
  const strength = (dd) => (dd <= 2 ? 1 : dd === 3 ? 0.35 : 0);
  let prev = UNRELATED;
  for (const { forms, next } of ordered) {
    const li = document.createElement('li');
    li.style.setProperty('--up', strength(prev));
    li.style.setProperty('--down', strength(next));
    if (next >= UNRELATED) li.classList.add('gap-after');
    prev = next;
    if (forms.length === 1) {
      li.textContent = forms[0];
    } else {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.innerHTML = `<b></b> <span class="dim">+${forms.length - 1} equivalent</span>`;
      sum.firstChild.textContent = forms[0];
      det.appendChild(sum);
      const ul = document.createElement('ul');
      ul.className = 'equiv';
      for (const f of forms.slice(1)) {
        const e = document.createElement('li');
        e.textContent = f;
        ul.appendChild(e);
      }
      det.appendChild(ul);
      li.appendChild(det);
    }
    list.appendChild(li);
  }
}
for (const m of ['check', 'all']) {
  document.getElementById('v-mode-' + m).addEventListener('click', () => {
    vMode = m;
    document.getElementById('v-mode-check').classList.toggle('active', m === 'check');
    document.getElementById('v-mode-all').classList.toggle('active', m === 'all');
    runSolver();
    vInput.focus();
  });
}
vInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSolver(); });
vInput.addEventListener('input', runSolver);

/* boot */
sRender();
dRenderStats();
show('solve');
