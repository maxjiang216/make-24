// Single source of truth for the WebSocket message shapes exchanged between
// web/multiplayer/mp-app.js and the RoomDurableObject / LobbyDurableObject.

export type PlayerId = string;
export type RoomId = string;
export type GameMode = 'single-point' | 'multi-point';

export interface RoomSummary {
  id: RoomId;
  name: string;
  playerCount: number;
  mode: GameMode;
  faceCards: boolean;
}

export interface PlayerScore {
  id: PlayerId;
  name: string;
  score: number;
}

// ---- Client -> Server ----

export type ClientMessage =
  | { type: 'hello'; name: string }
  | { type: 'listRooms' }
  | { type: 'createRoom'; isPublic: boolean; mode: GameMode; faceCards: boolean; name: string }
  | { type: 'joinPublicRoom'; roomId: RoomId }
  | { type: 'joinPrivateRoom'; code: RoomId }
  | { type: 'leaveRoom' }
  | { type: 'ping'; clientSentMs: number; lastRttMs?: number }
  | { type: 'submitAnswer'; expr: string; clientSubmitMs: number }
  | { type: 'readyForNext' };

// ---- Server -> Client ----

export type ServerMessage =
  | { type: 'helloAck'; playerId: PlayerId }
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'roomJoined'; roomId: RoomId; isPublic: boolean; mode: GameMode; faceCards: boolean }
  | { type: 'roomState'; players: PlayerScore[]; mode: GameMode; faceCards: boolean }
  | { type: 'pong'; clientSentMs: number; serverMs: number }
  | { type: 'roundStart'; cards: number[]; serverDealtMs: number; roundNumber: number }
  | {
      type: 'answerResult';
      correct: boolean;
      message: string | null;
      pointAwarded: boolean;
      yourReactionMs?: number;
      key?: string;
    }
  | { type: 'pointScored'; playerId: PlayerId; newScore: number; viaKey: string }
  | { type: 'roundEnd'; winnerId: PlayerId | null; scores: PlayerScore[]; correctSampleSolution?: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'roomClosed'; reason: string };
