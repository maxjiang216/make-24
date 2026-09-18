import { SOLVABLE_KEYS } from './solutions-data';

const NUMERIC_ONLY_KEYS = SOLVABLE_KEYS.filter((k) =>
  k.split('-').map(Number).every((v) => v <= 9)
);

function randomIndex(n: number): number {
  // Workers runtime: Web Crypto API, no Node crypto module.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % n;
}

// Uniform over solvable multisets matching the face-card toggle.
export function dealRound(faceCards: boolean): number[] {
  const pool = faceCards ? SOLVABLE_KEYS : NUMERIC_ONLY_KEYS;
  const key = pool[randomIndex(pool.length)];
  return key.split('-').map(Number);
}
