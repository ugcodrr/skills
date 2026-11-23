#!/usr/bin/env node
// Lists, finds and numbers hiccup entries: one markdown file per hiccup, with front matter. Read-only, no fetch.
//
//   node hiccups.mjs list [--all]     open entries ranked by seen × cost ÷ fix size (--all: every status)
//   node hiccups.mjs find <words…>    entries whose id, title or body mention every word
//   node hiccups.mjs next-id          the next free id and the file to write it to
//
// Entries live in .agents/hiccups/entries/ of the repo's main checkout, so every worktree shares one log,
// or in the folder ~/.agents/hiccups.json names: { "entries": "~/notes/hiccups/entries" }.
// Exits 0, or 2 when the settings or an entry can't be read.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const SIZE_WEIGHT = { XS: 1, S: 2, M: 4, L: 8 };

function fail(message) {
  console.error(`hiccups: ${message}`);
  process.exit(2);
}

function git(cwd, ...args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

function entriesDir() {
  const settings = join(homedir(), ".agents", "hiccups.json");
  if (existsSync(settings)) {
    let entries;
    try {
      entries = JSON.parse(readFileSync(settings, "utf8")).entries;
    } catch (error) {
      fail(`can't read ${settings}: ${error.message}`);
    }
    if (typeof entries !== "string") fail(`${settings} has no "entries" folder`);
    return resolve(entries.replace(/^~(?=$|\/)/, homedir()));
  }
  // --git-common-dir is the main checkout's .git from every linked worktree
  const common = git(".", "rev-parse", "--path-format=absolute", "--git-common-dir");
  const root = common && basename(common) === ".git" ? dirname(common) : git(".", "rev-parse", "--show-toplevel");
  return join(root ?? process.cwd(), ".agents", "hiccups", "entries");
}

function readEntries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const text = readFileSync(join(dir, file), "utf8").replace(/\r\n/g, "\n");
      const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) fail(`${join(dir, file)} has no front matter`);
      const fields = Object.fromEntries(
        match[1]
          .split("\n")
          .map((line) => line.match(/^(\w+):\s*(.*)$/))
          .filter(Boolean)
          .map(([, key, value]) => [key, value.trim()]),
      );
      const seen = Number(fields.seen) || 1;
      const cost = Number(fields.cost) || 1;
      const weight = SIZE_WEIGHT[fields.fix_size] ?? 4;
      return { file, ...fields, body: match[2], score: (seen * cost) / weight };
    });
}

function idNumber(id) {
  const number = Number(/^H(\d+)$/.exec(id ?? "")?.[1]);
  return Number.isFinite(number) ? number : undefined;
}

// Ids committed on any local ref (branches, remote-tracking refs from the last fetch), including deleted entries
function committedIds(dir) {
  let existing = dir;
  while (!existsSync(existing)) existing = dirname(existing);
  const paths = git(existing, "log", "--all", "--no-renames", "--format=", "--name-only", "--", relative(existing, dir) || ".") ?? "";
  return paths.split("\n").map((path) => idNumber(basename(path).match(/^H\d+/)?.[0]));
}

function duplicates(entries) {
  const byId = new Map();
  for (const entry of entries) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  return [...byId].filter(([id, group]) => id && group.length > 1);
}

const [command, ...args] = process.argv.slice(2);
const dir = entriesDir();
const entries = readEntries(dir);

if (command === "list") {
  const shown = args.includes("--all") ? entries : entries.filter((entry) => entry.status === "open");
  shown.sort((a, b) => b.score - a.score);
  for (const entry of shown) {
    console.log(
      `${entry.score.toFixed(1).padStart(5)}  ${(entry.id ?? "?").padEnd(5)} ${(entry.status ?? "?").padEnd(9)} ` +
        `seen ${String(entry.seen ?? 1).padStart(2)}  cost ${entry.cost ?? "?"}  ${(entry.fix_size ?? "?").padEnd(2)}  ${entry.title ?? entry.file}`,
    );
  }
  console.log(`${shown.length} of ${entries.length} entries in ${dir}`);
  for (const [id, group] of duplicates(entries)) {
    console.log(`duplicate id ${id}: ${group.map((entry) => entry.file).join(", ")}`);
  }
} else if (command === "find" && args.length) {
  const words = args.map((word) => word.toLowerCase());
  for (const entry of entries) {
    const haystack = `${entry.id} ${entry.title} ${entry.body}`.toLowerCase();
    if (words.every((word) => haystack.includes(word))) {
      console.log(`${entry.id}  ${entry.status}  ${entry.title}  (${join(dir, entry.file)})`);
    }
  }
} else if (command === "next-id") {
  const numbers = [...entries.map((entry) => idNumber(entry.id)), ...committedIds(dir)].filter(Number.isFinite);
  const id = `H${Math.max(0, ...numbers) + 1}`;
  console.log(`${id}  ${join(dir, `${id}-<slug>.md`)}`);
} else {
  fail("usage: hiccups.mjs list [--all] | find <words…> | next-id");
}
