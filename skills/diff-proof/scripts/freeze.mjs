// Freezes a Node probe's clock and randomness to the values diff-proof gives both sides. Preload it:
//
//   node --import "$DIFF_PROOF_FREEZE" dist/cli.js
//
// Date.now() and new Date() return DIFF_PROOF_NOW and never move. Math.random is a seeded generator
// (mulberry32) started from DIFF_PROOF_SEED, and crypto.randomUUID counts up from 1. performance.now()
// and timers keep real time, so timing probes still measure.
import crypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";

const now = Number(process.env.DIFF_PROOF_NOW);
if (Number.isFinite(now)) {
  const RealDate = Date;
  const FrozenDate = class extends RealDate {
    constructor(...args) {
      super(...(args.length > 0 ? args : [now]));
    }

    static now() {
      return now;
    }
  };
  // A class can't be called without new, and Date() must return the date as a string
  globalThis.Date = new Proxy(FrozenDate, { apply: () => new RealDate(now).toString() });
}

let state = Number(process.env.DIFF_PROOF_SEED ?? 1) >>> 0;
Math.random = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let counter = 0;
crypto.randomUUID = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, "0")}`;
// Without this, `import { randomUUID } from "node:crypto"` keeps the real function
syncBuiltinESMExports();
