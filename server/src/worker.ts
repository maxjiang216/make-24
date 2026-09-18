import { GameMode, RoomId } from './protocol';

export { RoomDurableObject } from './room-do';
export { LobbyDurableObject } from './lobby-do';

interface Env {
  ROOMS: DurableObjectNamespace;
  LOBBY: DurableObjectNamespace;
}

function cors(resp: Response): Response {
  const r = new Response(resp.body, resp);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Headers', 'content-type');
  r.headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  return r;
}

function genRoomCode(): RoomId {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => alphabet[n % alphabet.length]).join('');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // POST /api/rooms — create a room, returns { roomId }
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      const body = (await request.json()) as {
        isPublic: boolean;
        mode: GameMode;
        faceCards: boolean;
        name: string;
      };
      const roomId = genRoomCode();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      await stub.fetch('https://room/init', {
        method: 'POST',
        body: JSON.stringify({ roomId, ...body }),
      });
      return cors(new Response(JSON.stringify({ roomId }), { headers: { 'content-type': 'application/json' } }));
    }

    // GET /api/rooms — list public rooms with an open seat
    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      const stub = env.LOBBY.get(env.LOBBY.idFromName('singleton'));
      const resp = await stub.fetch('https://lobby/list');
      return cors(new Response(resp.body, resp));
    }

    // GET /ws/room/:id?name=... — join a room's WebSocket
    const roomMatch = url.pathname.match(/^\/ws\/room\/([A-Za-z0-9]+)$/);
    if (roomMatch) {
      const roomId = roomMatch[1];
      const stub = env.ROOMS.get(env.ROOMS.idFromName(roomId));
      return stub.fetch(`https://room/ws?${url.searchParams.toString()}`, request);
    }

    return cors(new Response('not found', { status: 404 }));
  },
};
