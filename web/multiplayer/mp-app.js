'use strict';

// Client for the online multiplayer mode. Talks to the Cloudflare Workers
// backend in server/src over HTTP (room create/list) + WebSocket (gameplay).
// Set WORKER_ORIGIN to your deployed Worker's origin (e.g. after
// `wrangler deploy`, something like "https://make24-server.<subdomain>.workers.dev").
const WORKER_ORIGIN = window.MAKE24_WORKER_ORIGIN || 'http://localhost:8787';
const WS_ORIGIN = WORKER_ORIGIN.replace(/^http/, 'ws');

const SUITS = ['♠', '♥', '♦', '♣'];
const LABEL = [, 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

/* ---------------- DOM ---------------- */
const lobbySection = document.getElementById('lobby');
const roomSection = document.getElementById('room');
const lobbyMsg = document.getElementById('lobby-msg');
const cName = document.getElementById('c-name');
const cPublic = document.getElementById('c-public');
const cMode = document.getElementById('c-mode');
const cFace = document.getElementById('c-face');
const cRoomName = document.getElementById('c-roomname');
const cCreate = document.getElementById('c-create');
const jCode = document.getElementById('j-code');
const jJoin = document.getElementById('j-join');
const lRefresh = document.getElementById('l-refresh');
const lRooms = document.getElementById('l-rooms');

const rCode = document.getElementById('r-code');
const rStatus = document.getElementById('r-status');
const rTimerEl = document.getElementById('r-timer');
const rScores = document.getElementById('r-scores');
const rCards = document.getElementById('r-cards');
const rInput = document.getElementById('r-input');
const rMsg = document.getElementById('r-msg');
const rLog = document.getElementById('r-log');

/* ---------------- state ---------------- */
const S = {
  ws: null,
  myId: null,
  roomId: null,
  mode: 'single-point',
  players: [], // {id, name, score}
  rttSamples: [],
  offsetMs: 0, // serverNow - clientNow, best estimate
  lastRttMs: 0,
  pingTimer: 0,
  roundRaf: 0,
  roundServerStart: 0,
};

function log(text) {
  const li = document.createElement('li');
  li.textContent = text;
  rLog.prepend(li);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ---------------- lobby ---------------- */
async function refreshRooms() {
  try {
    const resp = await fetch(`${WORKER_ORIGIN}/api/rooms`);
    const rooms = await resp.json();
    lRooms.innerHTML = '';
    if (!rooms.length) {
      const li = document.createElement('li');
      li.textContent = 'no public rooms open right now';
      lRooms.appendChild(li);
      return;
    }
    for (const r of rooms) {
      const li = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${r.name} — ${r.playerCount}/2 — ${r.mode}${r.faceCards ? '' : ' — numbers only'}`;
      const btn = document.createElement('button');
      btn.textContent = 'Join';
      btn.onclick = () => joinRoom(r.id);
      li.append(label, btn);
      lRooms.appendChild(li);
    }
  } catch (e) {
    lobbyMsg.textContent = 'could not reach server: ' + e.message;
    lobbyMsg.className = 'msg bad';
  }
}

async function createRoom() {
  const name = cName.value.trim();
  if (!name) { lobbyMsg.textContent = 'enter your name first'; lobbyMsg.className = 'msg bad'; return; }
  const isPublic = cPublic.value === 'public';
  const body = {
    isPublic,
    mode: cMode.value,
    faceCards: cFace.checked,
    name: cRoomName.value.trim() || `${name}'s room`,
  };
  try {
    const resp = await fetch(`${WORKER_ORIGIN}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const { roomId } = await resp.json();
    connectWs(roomId, name, body.mode);
  } catch (e) {
    lobbyMsg.textContent = 'could not create room: ' + e.message;
    lobbyMsg.className = 'msg bad';
  }
}

function joinRoom(roomId) {
  const name = cName.value.trim();
  if (!name) { lobbyMsg.textContent = 'enter your name first'; lobbyMsg.className = 'msg bad'; return; }
  connectWs(roomId, name, null);
}

cCreate.onclick = createRoom;
jJoin.onclick = () => {
  const code = jCode.value.trim().toUpperCase();
  if (!code) return;
  joinRoom(code);
};
lRefresh.onclick = refreshRooms;

/* ---------------- websocket / gameplay ---------------- */
function connectWs(roomId, name, mode) {
  S.roomId = roomId;
  S.mode = mode || 'single-point';
  const url = `${WS_ORIGIN}/ws/room/${roomId}?name=${encodeURIComponent(name)}`;
  const ws = new WebSocket(url);
  S.ws = ws;

  ws.onopen = () => {
    lobbySection.classList.add('hidden');
    roomSection.classList.remove('hidden');
    rStatus.textContent = 'connected — waiting for opponent';
    startPingLoop();
  };
  ws.onmessage = (evt) => handleServerMessage(JSON.parse(evt.data));
  ws.onclose = () => {
    stopPingLoop();
    if (rStatus.textContent !== 'opponent disconnected') rStatus.textContent = 'disconnected';
  };
  ws.onerror = () => {
    lobbyMsg.textContent = 'connection failed — is the server reachable?';
    lobbyMsg.className = 'msg bad';
  };
}

function startPingLoop() {
  const ping = () => {
    if (!S.ws || S.ws.readyState !== WebSocket.OPEN) return;
    S.ws.send(JSON.stringify({ type: 'ping', clientSentMs: performance.now(), lastRttMs: S.lastRttMs || undefined }));
  };
  ping();
  S.pingTimer = setInterval(ping, 2000);
}
function stopPingLoop() {
  clearInterval(S.pingTimer);
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case 'helloAck':
      S.myId = msg.playerId;
      return;
    case 'roomJoined':
      rCode.textContent = `room: ${msg.roomId}`;
      S.mode = msg.mode;
      return;
    case 'roomState':
      S.players = msg.players;
      renderScores();
      if (msg.players.length < 2) rStatus.textContent = 'waiting for opponent';
      return;
    case 'pong': {
      const rtt = performance.now() - msg.clientSentMs;
      const offset = msg.serverMs - (msg.clientSentMs + rtt / 2);
      S.rttSamples.push(rtt);
      if (S.rttSamples.length > 8) S.rttSamples.shift();
      S.lastRttMs = median(S.rttSamples);
      S.offsetMs = offset;
      return;
    }
    case 'roundStart':
      rStatus.textContent = `round ${msg.roundNumber}`;
      renderCards(msg.cards);
      rInput.disabled = false;
      rInput.value = '';
      rInput.focus();
      rMsg.textContent = '';
      rMsg.className = 'msg';
      startRoundTimer(msg.serverDealtMs);
      return;
    case 'answerResult':
      rMsg.textContent = msg.correct
        ? (msg.pointAwarded ? `correct! +1${msg.yourReactionMs != null ? ` (${(msg.yourReactionMs / 1000).toFixed(2)}s)` : ''}` : msg.message)
        : msg.message;
      rMsg.className = 'msg ' + (msg.correct && msg.pointAwarded ? 'ok' : msg.correct ? '' : 'bad');
      if (msg.pointAwarded) rInput.value = '';
      return;
    case 'pointScored': {
      const p = S.players.find((x) => x.id === msg.playerId);
      if (p) p.score = msg.newScore;
      renderScores();
      const who = msg.playerId === S.myId ? 'you' : (p ? p.name : 'opponent');
      log(`${who} scored — ${msg.newScore}`);
      return;
    }
    case 'roundEnd':
      S.players = msg.scores;
      renderScores();
      rInput.disabled = true;
      stopRoundTimer();
      rStatus.textContent = msg.winnerId === S.myId ? 'you won the round' : 'opponent won the round';
      log(`round over — ${msg.scores.map((s) => `${s.name}: ${s.score}`).join(', ')}`);
      return;
    case 'error':
      rMsg.textContent = msg.message;
      rMsg.className = 'msg bad';
      return;
    case 'roomClosed':
      rStatus.textContent = 'opponent disconnected';
      rInput.disabled = true;
      stopRoundTimer();
      return;
    default:
      return;
  }
}

function renderScores() {
  rScores.innerHTML = '';
  for (const p of S.players) {
    const span = document.createElement('span');
    span.className = p.id === S.myId ? 'you' : '';
    span.textContent = `${p.name}: ${p.score}`;
    rScores.appendChild(span);
  }
}

function renderCards(vals) {
  rCards.innerHTML = '';
  for (const v of vals) {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const d = document.createElement('div');
    d.className = 'card' + (suit === '♥' || suit === '♦' ? ' red' : '');
    d.innerHTML = `<span class="pip">${LABEL[v]}${suit}</span>` +
      `<span>${LABEL[v]}</span>` +
      `<span class="pip br">${LABEL[v]}${suit}</span>`;
    rCards.appendChild(d);
  }
}

function startRoundTimer(serverDealtMs) {
  stopRoundTimer();
  // Align the displayed "0.00" to the server's own deal instant, corrected
  // by our measured clock offset, rather than to whenever this client
  // happened to receive the message.
  const localStart = serverDealtMs - S.offsetMs;
  const tick = () => {
    const elapsed = performance.now() - localStart;
    rTimerEl.textContent = (Math.max(0, elapsed) / 1000).toFixed(2);
    S.roundRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stopRoundTimer() {
  cancelAnimationFrame(S.roundRaf);
}

rInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const expr = rInput.value.trim();
  if (!expr || !S.ws || S.ws.readyState !== WebSocket.OPEN) return;
  S.ws.send(JSON.stringify({ type: 'submitAnswer', expr, clientSubmitMs: performance.now() }));
});

refreshRooms();
