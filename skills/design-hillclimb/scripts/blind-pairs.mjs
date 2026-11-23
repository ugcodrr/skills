#!/usr/bin/env node
// Compares two folders of captures (before and after) case by case, and with --out writes a blind A/B set
// for a judge. Cases match by relative path. Prints each one as same, changed (with PNG sizes before -> after),
// only-before or only-after. Exits 0 when both folders hold the same cases, 1 when a case is missing on one
// side (the comparison is void until it's captured again), 2 when it couldn't read them.
//
//   node blind-pairs.mjs <before-dir> <after-dir>
//   node blind-pairs.mjs <before-dir> <after-dir> --out <judge-dir> --key <key.json> [--seed <n>] [--width <px>]
//
// --out copies every case found on both sides, unchanged ones included so a judge's side bias shows, into a
// new <judge-dir> as c01-A.png and c01-B.png, with case order and sides shuffled, plus index.html showing
// A beside B at most --width px wide (default 400; click for full size). --key gets the mapping back to
// paths, sides and whether the case changed, and must sit outside <judge-dir>. The same seed gives the
// same shuffle.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: "string" },
      key: { type: "string" },
      seed: { type: "string", default: "1" },
      width: { type: "string", default: "400" },
    },
  });
} catch (error) {
  fail(error.message);
}
const { values: options, positionals } = parsed;
const [beforeDir, afterDir] = positionals;
if (!beforeDir || !afterDir) fail("usage: blind-pairs.mjs <before-dir> <after-dir> [--out <judge-dir> --key <key.json>]");
for (const dir of [beforeDir, afterDir]) if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${dir} is not a folder`);
if (options.out && !options.key) fail("--out needs --key, a file outside the judge folder");
if (options.out && !relative(resolve(options.out), resolve(options.key)).startsWith("..")) fail("--key must be outside --out, or the judge can read it");
if (options.out && existsSync(options.out) && readdirSync(options.out).length) fail(`${options.out} isn't empty; use a new folder per batch`);

const before = listFiles(beforeDir);
const after = listFiles(afterDir);
const cases = [...new Set([...before, ...after])].sort();
const matched = [];
const changed = new Set();
const counts = { same: 0, changed: 0, "only-before": 0, "only-after": 0 };

for (const path of cases) {
  const a = join(beforeDir, path);
  const b = join(afterDir, path);
  let state;
  if (!before.includes(path)) state = "only-after";
  else if (!after.includes(path)) state = "only-before";
  else state = hash(a) === hash(b) ? "same" : "changed";
  counts[state]++;
  const sizes = state === "changed" ? `  ${pngSize(a)} -> ${pngSize(b)}` : "";
  console.log(`${state.padEnd(11)}  ${path}${sizes}`);
  if (state === "changed") changed.add(path);
  if (state === "changed" || state === "same") matched.push(path);
}
console.log(`\n${cases.length} case(s): ${counts.changed} changed, ${counts.same} same, ${counts["only-before"] + counts["only-after"]} missing on one side`);

if (options.out) writeBlindSet();
process.exit(counts["only-before"] + counts["only-after"] ? 1 : 0);

function fail(message) {
  console.error(`blind-pairs: ${message}`);
  process.exit(2);
}

function listFiles(dir, prefix = "") {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(dir, path) : [path];
  });
}

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function pngSize(file) {
  const head = readFileSync(file).subarray(0, 24);
  if (head.length < 24 || head.toString("latin1", 1, 4) !== "PNG") return "?";
  return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`;
}

function writeBlindSet() {
  let state = Number(options.seed) >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = [...matched];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  mkdirSync(options.out, { recursive: true });
  const key = { seed: options.seed, before: resolve(beforeDir), after: resolve(afterDir), cases: {} };
  const figures = [];
  // Changed cases alternate sides, so a judge that always prefers one side can't pass every candidate
  let changedSide = random() < 0.5;
  order.forEach((path, index) => {
    const id = `c${String(index + 1).padStart(2, "0")}`;
    const beforeIsA = changed.has(path) ? (changedSide = !changedSide) : random() < 0.5;
    const ext = extname(path);
    copyFileSync(join(beforeIsA ? beforeDir : afterDir, path), join(options.out, `${id}-A${ext}`));
    copyFileSync(join(beforeIsA ? afterDir : beforeDir, path), join(options.out, `${id}-B${ext}`));
    key.cases[id] = { path, changed: changed.has(path), A: beforeIsA ? "before" : "after", B: beforeIsA ? "after" : "before" };
    const side = (s) => `<figure><a href="${id}-${s}${ext}"><img src="${id}-${s}${ext}"></a><figcaption>${id} ${s}</figcaption></figure>`;
    figures.push(`<section><h2>${id}</h2>${side("A")}${side("B")}</section>`);
  });

  const style = `body{font:14px system-ui;margin:24px}section{margin-bottom:32px}figure{display:inline-block;vertical-align:top;margin:0 24px 0 0}img{max-width:${Number(options.width)}px;height:auto}`;
  writeFileSync(join(options.out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Blind A/B</title><style>${style}</style>\n${figures.join("\n")}\n`);
  writeFileSync(options.key, `${JSON.stringify(key, null, 2)}\n`);
  console.log(`blind set: ${order.length} case(s) in ${options.out}, key in ${options.key}`);
}
