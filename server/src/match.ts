import { checkAnswer, canonicalizeExpr } from './core';
import { dealRound } from './dealer';
import { GameMode, PlayerId } from './protocol';

export interface RoundState {
  cards: number[];
  dealtAtServerMs: number;
  roundNumber: number;
  firstCorrectBy: PlayerId | null; // single-point: round ends once set
  leaderId: PlayerId | null; // multi-point: first player to score this round
  acceptedKeys: Map<PlayerId, Set<string>>; // multi-point: canonical keys already scored per player
  otherPlayerHasScored: boolean; // multi-point: round-end condition
}

export function startRound(faceCards: boolean, roundNumber: number, nowMs: number): RoundState {
  return {
    cards: dealRound(faceCards),
    dealtAtServerMs: nowMs,
    roundNumber,
    firstCorrectBy: null,
    leaderId: null,
    acceptedKeys: new Map(),
    otherPlayerHasScored: false,
  };
}

export type SubmitOutcome =
  | { kind: 'invalid'; message: string }
  | { kind: 'duplicate'; key: string } // multi-point: correct but already scored by this player
  | { kind: 'scored'; key: string; roundEnds: boolean; winnerId: PlayerId | null };

// All scoring decisions in one place, called synchronously (no await between
// read and write) from the RoomDurableObject's message handler.
export function submitAnswer(
  round: RoundState,
  mode: GameMode,
  playerId: PlayerId,
  expr: string
): SubmitOutcome {
  const err = checkAnswer(expr, round.cards);
  if (err) return { kind: 'invalid', message: err };

  const { key } = canonicalizeExpr(expr);

  if (mode === 'single-point') {
    if (round.firstCorrectBy !== null) {
      // Round already decided; treat as invalid (too late) rather than scoring.
      return { kind: 'invalid', message: 'round already over' };
    }
    round.firstCorrectBy = playerId;
    return { kind: 'scored', key, roundEnds: true, winnerId: playerId };
  }

  // multi-point mode
  if (round.leaderId === null) round.leaderId = playerId;

  let keys = round.acceptedKeys.get(playerId);
  if (!keys) {
    keys = new Set();
    round.acceptedKeys.set(playerId, keys);
  }
  if (keys.has(key)) return { kind: 'duplicate', key };
  keys.add(key);

  const roundEnds = playerId !== round.leaderId; // the trailing player just landed their first key
  if (roundEnds) round.otherPlayerHasScored = true;

  return { kind: 'scored', key, roundEnds, winnerId: round.leaderId };
}
