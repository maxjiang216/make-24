import { ClientMessage, ServerMessage, GameMode, PlayerId, PlayerScore, RoomId } from './protocol';
import { RttTracker, serverNowMs, estimateReactionMs } from './timing';
import { startRound, submitAnswer, RoundState } from './match';

interface Env {
  LOBBY: DurableObjectNamespace;
}

interface RoomPlayer {
  id: PlayerId;
  name: string;
  ws: WebSocket;
  score: number;
  rtt: RttTracker;
}

interface RoomConfig {
  isPublic: boolean;
  mode: GameMode;
  faceCards: boolean;
  name: string;
}

// One instance per active room, addressed by env.ROOMS.idFromName(roomId).
// Holds all room state (players, scores, round) in memory for its lifetime.
export class RoomDurableObject implements DurableObject {
  private roomId: RoomId = '';
  private config: RoomConfig | null = null;
  private players: RoomPlayer[] = [];
  private round: RoundState | null = null;
  private roundNumber = 0;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/init' && request.method === 'POST') {
      const body = (await request.json()) as RoomConfig & { roomId: RoomId };
      this.roomId = body.roomId;
      this.config = { isPublic: body.isPublic, mode: body.mode, faceCards: body.faceCards, name: body.name };
      return new Response('ok');
    }

    if (url.pathname === '/ws') {
      if (!this.config) return new Response('room not initialized', { status: 400 });
      if (this.players.length >= 2) return new Response('room full', { status: 409 });
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });

      const name = url.searchParams.get('name') || 'player';
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      server.accept();
      this.acceptPlayer(server, name);

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('not found', { status: 404 });
  }

  private acceptPlayer(ws: WebSocket, name: string) {
    const player: RoomPlayer = {
      id: crypto.randomUUID(),
      name,
      ws,
      score: 0,
      rtt: new RttTracker(),
    };
    this.players.push(player);

    this.send(player, { type: 'helloAck', playerId: player.id });
    this.send(player, {
      type: 'roomJoined',
      roomId: this.roomId,
      isPublic: this.config!.isPublic,
      mode: this.config!.mode,
      faceCards: this.config!.faceCards,
    });
    this.broadcastRoomState();

    ws.addEventListener('message', (evt: MessageEvent) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : '');
      } catch {
        return;
      }
      this.handleMessage(player, msg);
    });
    ws.addEventListener('close', () => this.handleDisconnect(player));
    ws.addEventListener('error', () => this.handleDisconnect(player));

    if (this.players.length === 2) this.dealNextRound();
    void this.notifyLobby();
  }

  private handleMessage(player: RoomPlayer, msg: ClientMessage) {
    switch (msg.type) {
      case 'ping': {
        const serverMs = serverNowMs();
        // Client reports its own freshly-measured RTT (from the *previous*
        // ping/pong) alongside each new ping — the server can't measure a
        // round trip on its own without a further hop, so it adopts the
        // client's own estimate as its rolling sample. Both sides converge
        // on the same value within a couple of ping intervals (~4s).
        if (typeof msg.lastRttMs === 'number') player.rtt.record(msg.lastRttMs);
        this.send(player, { type: 'pong', clientSentMs: msg.clientSentMs, serverMs });
        return;
      }
      case 'submitAnswer':
        this.handleSubmitAnswer(player, msg.expr);
        return;
      case 'readyForNext':
        return; // v1: rounds auto-advance a fixed short delay after roundEnd; no-op placeholder
      case 'leaveRoom':
        player.ws.close();
        return;
      default:
        return;
    }
  }

  private handleSubmitAnswer(player: RoomPlayer, expr: string) {
    if (!this.round || !this.config) {
      this.send(player, { type: 'error', code: 'no-round', message: 'no active round' });
      return;
    }
    const serverRecvMs = serverNowMs();
    const outcome = submitAnswer(this.round, this.config.mode, player.id, expr);

    if (outcome.kind === 'invalid') {
      this.send(player, { type: 'answerResult', correct: false, message: outcome.message, pointAwarded: false });
      return;
    }
    if (outcome.kind === 'duplicate') {
      this.send(player, {
        type: 'answerResult',
        correct: true,
        message: 'already scored that solution',
        pointAwarded: false,
        key: outcome.key,
      });
      return;
    }

    // scored
    player.score += 1;
    const reactionMs = estimateReactionMs(serverRecvMs, player.rtt.median(), this.round.dealtAtServerMs);
    this.send(player, {
      type: 'answerResult',
      correct: true,
      message: null,
      pointAwarded: true,
      yourReactionMs: reactionMs,
      key: outcome.key,
    });
    this.broadcast({ type: 'pointScored', playerId: player.id, newScore: player.score, viaKey: outcome.key });

    if (outcome.roundEnds) {
      this.broadcast({
        type: 'roundEnd',
        winnerId: outcome.winnerId,
        scores: this.playerScores(),
      });
      this.round = null;
      setTimeout(() => this.dealNextRound(), 1500);
    }
  }

  private dealNextRound() {
    if (this.players.length < 2 || !this.config) return;
    this.roundNumber += 1;
    this.round = startRound(this.config.faceCards, this.roundNumber, serverNowMs());
    this.broadcast({
      type: 'roundStart',
      cards: this.round.cards,
      serverDealtMs: this.round.dealtAtServerMs,
      roundNumber: this.round.roundNumber,
    });
  }

  private handleDisconnect(player: RoomPlayer) {
    this.players = this.players.filter((p) => p.id !== player.id);
    for (const other of this.players) {
      this.send(other, { type: 'roomClosed', reason: 'opponent disconnected' });
    }
    this.round = null;
    void this.notifyLobby(true);
  }

  private async notifyLobby(unregister = false) {
    if (!this.config?.isPublic) return;
    const id = this.env.LOBBY.idFromName('singleton');
    const stub = this.env.LOBBY.get(id);
    if (unregister || this.players.length === 0) {
      await stub.fetch('https://lobby/unregister', {
        method: 'POST',
        body: JSON.stringify({ id: this.roomId }),
      });
      return;
    }
    await stub.fetch('https://lobby/register', {
      method: 'POST',
      body: JSON.stringify({
        id: this.roomId,
        name: this.config.name,
        playerCount: this.players.length,
        mode: this.config.mode,
        faceCards: this.config.faceCards,
      }),
    });
  }

  private playerScores(): PlayerScore[] {
    return this.players.map((p) => ({ id: p.id, name: p.name, score: p.score }));
  }

  private broadcastRoomState() {
    if (!this.config) return;
    this.broadcast({ type: 'roomState', players: this.playerScores(), mode: this.config.mode, faceCards: this.config.faceCards });
  }

  private send(player: RoomPlayer, msg: ServerMessage) {
    try {
      player.ws.send(JSON.stringify(msg));
    } catch {
      // socket already gone; disconnect handler will clean up
    }
  }

  private broadcast(msg: ServerMessage) {
    for (const p of this.players) this.send(p, msg);
  }
}
