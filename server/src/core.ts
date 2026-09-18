// @ts-ignore - shared/make24-core.js is a plain UMD module (no type declarations);
// wrangler's esbuild bundler handles the CommonJS/ESM interop.
import Core from '../../shared/make24-core.js';

export const checkAnswer: (src: string, want: number[]) => string | null = Core.checkAnswer;
export const canonicalizeExpr: (src: string) => { value: { n: number; d: number }; cards: number[]; key: string; disp: string } =
  Core.canonicalizeExpr;
export const key4: (vals: number[]) => string = Core.key4;
