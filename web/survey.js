'use strict';

/* ================= SURVEY: one timed pass through every solvable set ================= */
// A pass is a fixed random order of the 1362 solvable sets plus one result per set
// ({ ms, flag }). Nothing is graded; the times give a rough map of what's slow.

const $ = (id) => document.getElementById(id);
const KEY = 'make24.survey.pass';
const strategyOf = (k) => (CANONICAL[k] || '').replace(/ \d+$/, '');
const cardText = (k) => k.split('-').map((v) => LABEL[v]).join(' ');

function loadPass() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY));
    if (p && p.order && p.order.length === SOLVABLE_KEYS.length) return p;
  } catch { /* fall through to a new pass */ }
  return newPass();
}
function newPass() {
  return { started: new Date().toISOString(), order: shuffle([...SOLVABLE_KEYS]), results: [] };
}
function savePass() {
  try { localStorage.setItem(KEY, JSON.stringify(P)); } catch { /* storage full or blocked */ }
}

let P = loadPass();
let state = 'ready'; // 'ready' (face down) | 'asking' (clock running) | 'shown' | 'done'
const timer = makeTimer($('s-timer'));
const current = () => P.order[P.results.length];

function randomSuits(vals) {
  const used = {};
  return vals.map((v) => {
    const free = SUITS.filter((s) => !(used[v] || []).includes(s));
    const suit = free[Math.floor(Math.random() * free.length)];
    (used[v] = used[v] || []).push(suit);
    return { v, suit };
  });
}

function showReady() {
  if (P.results.length >= P.order.length) return showDone();
  state = 'ready';
  $('s-cards').innerHTML = '<div class="card back"></div>'.repeat(4);
  $('s-prompt').textContent = 'Press any key (or tap) to turn the cards over.';
  $('s-answer').innerHTML = '';
  timer.reset();
  render();
}

function flip() {
  state = 'asking';
  renderCards($('s-cards'), shuffle(randomSuits(current().split('-').map(Number))));
  $('s-prompt').textContent = 'Any key when you have it · ← if you give up';
  $('s-answer').innerHTML = '';
  timer.start();
}

function stop(flag) {
  const ms = Math.round(timer.stop());
  const k = current();
  P.results.push({ ms, flag });
  savePass();
  state = 'shown';
  const classes = solveClasses(k.split('-').map(Number));
  const ans = $('s-answer');
  ans.innerHTML = '<div class="big"></div><div class="dim"></div><div></div>';
  ans.children[0].textContent = `${fmt(ms)}s` + (flag ? ' · flagged' : '');
  ans.children[0].className = 'big ' + (flag ? 'bad' : 'ok');
  ans.children[1].textContent =
    `${classes.length} distinct solution${classes.length === 1 ? '' : 's'} (${FORM_COUNT[k]} written) · ${strategyOf(k)}`;
  ans.children[2].textContent = classes[0].forms[0];
  $('s-prompt').textContent = P.results.length >= P.order.length
    ? 'Pass complete. Press any key.'
    : 'Any key for the next set.';
  render();
}

function showDone() {
  state = 'done';
  $('s-cards').innerHTML = '';
  $('s-prompt').textContent = 'Pass complete. Export it from ⋯, or start a new pass there.';
  $('s-answer').innerHTML = '';
  render();
}

function render() {
  const n = P.results.length, total = P.order.length;
  const times = P.results.map((r) => r.ms);
  const sum = times.reduce((a, b) => a + b, 0);
  const flags = P.results.filter((r) => r.flag).length;
  const avg = n ? sum / n : 0;
  const eta = n ? Math.round(((total - n) * avg) / 60000) : null;
  $('s-progress').textContent = `${n} / ${total} sets` +
    (n ? ` · avg ${fmt(avg)}s · ${flags} flagged · about ${eta} min of solving left` : '');
  $('s-fill').style.width = `${(100 * n) / total}%`;

  const slow = P.results.map((r, i) => ({ k: P.order[i], ...r }))
    .sort((a, b) => (b.flag - a.flag) || b.ms - a.ms)
    .slice(0, 15);
  const ol = $('s-slow');
  ol.innerHTML = '';
  for (const r of slow) {
    const li = document.createElement('li');
    li.innerHTML = '<b></b><span></span>';
    li.firstChild.textContent = cardText(r.k);
    li.lastChild.textContent = `  ${fmt(r.ms)}s${r.flag ? ' · flagged' : ''} · ${strategyOf(r.k)}`;
    ol.appendChild(li);
  }
}

function exportCsv() {
  const cols = ['order', 'set', 'cards', 'ms', 'flagged', 'distinct', 'written', 'strategy'];
  const rows = [cols.join(',')];
  P.results.forEach((r, i) => {
    const k = P.order[i];
    rows.push([i + 1, k, cardText(k), r.ms, r.flag ? 1 : 0, CLASS_COUNT[k], FORM_COUNT[k], `"${strategyOf(k)}"`].join(','));
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }));
  a.download = `make24-survey-${P.started.slice(0, 10)}-${P.results.length}of${P.order.length}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function advance(flag = false) {
  if (state === 'ready') flip();
  else if (state === 'asking') stop(flag);
  else if (state === 'shown') {
    if (P.results.length >= P.order.length) showDone();
    else flip(); // the key press that dismisses the answer also starts the next set
  }
}

$('s-cards').addEventListener('click', () => advance());
$('s-prompt').addEventListener('click', () => advance());
$('s-export').addEventListener('click', exportCsv);
$('s-new').addEventListener('click', () => {
  if (P.results.length && !confirm('Start a new pass? Export this one first if you want to keep it.')) return;
  P = newPass();
  savePass();
  $('s-menu').open = false;
  showReady();
});
document.addEventListener('click', (e) => {
  const m = $('s-menu');
  if (m.open && !e.composedPath().includes(m)) m.open = false;
});
document.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab', 'Escape'].includes(e.key)) return;
  if (e.target.closest('.t-menu') || state === 'done') return;
  e.preventDefault();
  advance(e.key === 'ArrowLeft' && state === 'asking');
});

showReady();
