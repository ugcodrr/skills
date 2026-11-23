#!/usr/bin/env node
// Checks JSON translation and key files after merging thread branches: conflict markers, invalid JSON,
// a key set twice in one object (JSON.parse would silently keep the last), and keys a locale has that
// the base locale doesn't. Prints `file:line  message`; exits 0 when clean, 1 on findings, 2 when it
// couldn't check. It never runs git add.
//
//   node check-json-keys.mjs locales/en.json locales/fr.json   these files (a folder means every .json under it)
//   node check-json-keys.mjs --resolve locales/                 first keep both sides of each conflict, fix commas
//   node check-json-keys.mjs --base locales/en.json             also flag keys the other locales have and en lacks
//
// --base takes the base locale's file (its sibling .json files are the other locales) or its folder
// (sibling folders are the other locales, compared file by file: locales/fr/app.json with locales/en/app.json).
// --resolve rewrites files in place: it keeps both sides' lines, keeps a line both sides added only once,
// and drops a diff3 base section. When that doesn't parse (both sides added nested objects at the same
// spot, say), it leaves the file and its markers alone. Read `git diff` before you stage the result.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, normalize, relative } from "node:path";
import { parseArgs } from "node:util";

process.on("uncaughtException", (error) => fail(error.message));

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: { resolve: { type: "boolean", default: false }, base: { type: "string" } },
  });
} catch (error) {
  fail(error.message);
}
const { values: options, positionals } = parsed;

const findings = [];
const report = (file, line, message) => findings.push(`${relative(".", file)}${line ? `:${line}` : ""}  ${message}`);

const files = new Set(positionals.flatMap(expand));
const pairs = options.base ? localePairs(normalize(options.base)) : [];
for (const [other, base] of pairs) files.add(other).add(base);
if (files.size === 0 && findings.length === 0) fail("no JSON files to check; pass files or folders, or --base");

const keyLines = new Map();
for (const file of files) checkFile(file);

for (const [other, base] of pairs) {
  if (!keyLines.has(other) || !keyLines.has(base)) continue;
  const baseKeys = keyLines.get(base);
  for (const [key, line] of keyLines.get(other)) {
    if (!baseKeys.has(key)) report(other, line, `"${key}" isn't in the base locale (${relative(".", base)})`);
  }
}

for (const finding of findings) console.log(finding);
console.log(`${findings.length ? "\n" : ""}${files.size} file(s), ${findings.length} finding(s)`);
process.exit(findings.length ? 1 : 0);

function fail(message) {
  console.error(`check-json-keys: ${message}`);
  process.exit(2);
}

function expand(path) {
  if (!existsSync(path)) fail(`${path} not found; run it from the repo root`);
  if (!statSync(path).isDirectory()) return [normalize(path)];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const child = join(path, entry.name);
    return entry.isDirectory() ? expand(child) : entry.name.endsWith(".json") ? [child] : [];
  });
}

function localePairs(base) {
  if (!existsSync(base)) fail(`--base ${base} not found`);
  const parent = dirname(base);
  const siblings = readdirSync(parent, { withFileTypes: true }).filter(
    (entry) => entry.name !== basename(base) && !entry.name.startsWith("."),
  );
  if (!statSync(base).isDirectory()) {
    return siblings.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => [join(parent, entry.name), base]);
  }
  return siblings
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const locale = join(parent, entry.name);
      return expand(locale).flatMap((file) => {
        const counterpart = join(base, relative(locale, file));
        if (existsSync(counterpart)) return [[file, counterpart]];
        report(file, 0, `no ${relative(".", counterpart)} in the base locale`);
        return [];
      });
    });
}

function checkFile(file) {
  let text = readFileSync(file, "utf8");
  if (/^<<<<<<< /m.test(text)) {
    const markerLine = lineOf(text, text.search(/^<<<<<<< /m));
    if (!options.resolve) return report(file, markerLine, "conflict markers; rerun with --resolve to keep both sides");
    const { lines, conflicts } = keepBothSides(text.split("\n"));
    const resolved = fixCommas(lines).join("\n");
    try {
      JSON.parse(resolved);
    } catch {
      return report(file, markerLine, "keeping both sides doesn't give valid JSON here; resolve it by hand (file left as it was)");
    }
    text = resolved;
    writeFileSync(file, text);
    console.log(`${relative(".", file)}  kept both sides of ${conflicts} conflict(s)`);
  }
  try {
    JSON.parse(text);
  } catch (error) {
    const position = error.message.match(/position (\d+)/)?.[1];
    return report(file, position ? lineOf(text, +position) : 0, `invalid JSON: ${error.message}`);
  }
  keyLines.set(file, scanKeys(file, text));
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// A line both sides added (the comma on what used to be the last key, say) is kept once.
function keepBothSides(lines) {
  const out = [];
  let section = null;
  let ours = new Set();
  let conflicts = 0;
  for (const line of lines) {
    if (line.startsWith("<<<<<<< ")) {
      section = "ours";
      ours = new Set();
      conflicts++;
    } else if (section && line.startsWith("||||||| ")) section = "base";
    else if (section && line === "=======") section = "theirs";
    else if (section && line.startsWith(">>>>>>> ")) section = null;
    else if (section === "ours") {
      ours.add(line.replace(/,+$/, ""));
      out.push(line);
    } else if (section === null || (section === "theirs" && !ours.has(line.replace(/,+$/, "")))) out.push(line);
  }
  return { lines: out, conflicts };
}

function fixCommas(lines) {
  const valueEnd = /(["\d}\]]|true|false|null)$/;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trimEnd();
    const after = lines[i + 1].trim();
    if (/^(["{[\d-]|true|false|null)/.test(after) && valueEnd.test(line)) lines[i] = `${line},`;
    else if (/^[}\]]/.test(after) && line.endsWith(",")) lines[i] = line.slice(0, -1);
  }
  return lines;
}

// Walks text that JSON.parse already accepted, so it only has to track strings, nesting and commas.
// Returns each leaf key's dotted path and line (arrays count as leaves), and reports keys set twice in one object.
function scanKeys(file, text) {
  const leaves = new Map();
  const stack = [];
  let line = 1;
  const childPath = () => {
    const top = stack.at(-1);
    return top ? [...top.path, top.object ? top.key : top.index] : [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\n") line++;
    else if (char === "{") stack.push({ object: true, keys: new Set(), expectKey: true, path: childPath() });
    else if (char === "[") stack.push({ object: false, index: 0, path: childPath() });
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack.at(-1);
      if (top.object) top.expectKey = true;
      else top.index++;
    } else if (char === '"') {
      let end = i + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      const top = stack.at(-1);
      if (top?.object && top.expectKey) {
        const key = JSON.parse(text.slice(i, end + 1));
        const path = [...top.path, key].join(".");
        if (top.keys.has(key)) report(file, line, `"${path}" is set twice in one object; keep one`);
        top.keys.add(key);
        top.key = key;
        top.expectKey = false;
        const objectValue = /^\s*:\s*\{/.test(text.slice(end + 1, end + 64));
        if (!objectValue && stack.every((level) => level.object) && !leaves.has(path)) leaves.set(path, line);
      }
      i = end;
    }
  }
  return leaves;
}
