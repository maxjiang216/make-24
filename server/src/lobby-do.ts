import { RoomSummary, RoomId } from './protocol';

// Singleton Durable Object: in-memory registry of public rooms only.
// Talked to via plain internal fetch() calls from worker.ts / RoomDurableObject
// (not exposed directly to browser clients) — see worker.ts for the public HTTP API.
export class LobbyDurableObject implements DurableObject {
  private rooms = new Map<RoomId, RoomSummary>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/register' && request.method === 'POST') {
      const summary = (await request.json()) as RoomSummary;
      this.rooms.set(summary.id, summary);
      return new Response('ok');
    }

    if (url.pathname === '/update' && request.method === 'POST') {
      const patch = (await request.json()) as { id: RoomId; playerCount: number };
      const existing = this.rooms.get(patch.id);
      if (existing) existing.playerCount = patch.playerCount;
      return new Response('ok');
    }

    if (url.pathname === '/unregister' && request.method === 'POST') {
      const { id } = (await request.json()) as { id: RoomId };
      this.rooms.delete(id);
      return new Response('ok');
    }

    if (url.pathname === '/list' && request.method === 'GET') {
      const list = [...this.rooms.values()].filter((r) => r.playerCount < 2);
      return new Response(JSON.stringify(list), {
        headers: { 'content-type': 'application/json' },
      });
    }

    return new Response('not found', { status: 404 });
  }
}
