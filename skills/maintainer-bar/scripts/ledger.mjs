#!/usr/bin/env node
// The maintainer-bar ledger (.agents/maintainer-bar/ledger.md in the main checkout): one row per open PR of
// yours a sweep reviewed, with the head it finished with, the verdict, the date and a short note of your
// calls and open items. Details go in reports/<n>.md, so the table stays small enough to read every sweep.
//
//   node ledger.mjs archive [--repo <owner/name>]   move rows of merged and closed PRs to ledger-archive.md
//   node ledger.mjs <n>                             print a PR's row
//
// triage.mjs reads rows and pr-apply.mjs updates them through the exports below.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fail, gh, repoName, sh, stateDir } from "./repo.mjs";

export const NOTE_LIMIT = 250;
export const VERDICTS = ["ready as is", "cleaned up", "needs you"];

const TABLE = "| PR | Head reviewed | Verdict | Date | Notes |\n| --- | --- | --- | --- | --- |\n";
const HEADER = `# Maintainer bar ledger

Read before each sweep. "Head reviewed" is the PR head the sweep last finished with; triage.mjs skips a PR whose head, base and comments haven't changed since. Notes are the user's calls on a PR and its open items, which override the bar, in at most ${NOTE_LIMIT} characters. Details go in reports/<n>.md.

${TABLE}`;
const ARCHIVE_HEADER = `# Maintainer bar ledger archive

Rows \`ledger.mjs archive\` moved out of ledger.md once their PR merged or closed, newest first.

${TABLE}`;

const paths = () => ({ ledger: join(stateDir(), "ledger.md"), archive: join(stateDir(), "ledger-archive.md") });
const escape = (text) => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

function rows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => /^\| #\d+ \|/.test(line))
    .map((line) => ({ pr: Number(line.match(/^\| #(\d+) \|/)[1]), line }));
}

function write(file, header, list) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, header + list.map((row) => row.line).join("\n") + (list.length ? "\n" : ""));
}

// PR, head, verdict, date and note. A pipe in a note is stored as \|, which " | " never matches
export function cells(line) {
  const parts = line.slice(2, -2).split(" | ");
  return [...parts.slice(0, 4), parts.slice(4).join(" | ").replace(/\\\|/g, "|")];
}

export function row(pr) {
  return rows(paths().ledger).find((r) => r.pr === Number(pr));
}

// Sets a PR's row, keeping its verdict and note when they're not given. New rows go on top.
export function upsert({ pr, head, verdict, note, date = new Date().toLocaleDateString("en-CA") /* YYYY-MM-DD, local */ }) {
  if (note !== undefined && note.length > NOTE_LIMIT)
    throw new Error(`the note is ${note.length} characters. Keep it under ${NOTE_LIMIT} and put the rest in reports/${pr}.md`);
  const { ledger } = paths();
  const list = rows(ledger);
  const old = list.find((r) => r.pr === Number(pr));
  const [, , oldVerdict = "", , oldNote = ""] = old ? cells(old.line) : [];
  const line = `| #${pr} | ${head.slice(0, 10)} | ${verdict ?? oldVerdict} | ${date} | ${escape(note ?? oldNote)} |`;
  write(ledger, HEADER, old ? list.map((r) => (r === old ? { pr: r.pr, line } : r)) : [{ pr: Number(pr), line }, ...list]);
  return line;
}

// A one-line warning when the state folder isn't ignored, so a stray `git add -A` can't put it in a PR
export function ignoreWarning() {
  const ignored = sh("git", ["check-ignore", "-q", join(stateDir(), "ledger.md")], { allowFail: true }).status === 0;
  return ignored ? "" : "note: .agents/maintainer-bar/ isn't ignored. Add it to .git/info/exclude so it never lands in a commit";
}

function archive(repo) {
  const { ledger, archive: archiveFile } = paths();
  const list = rows(ledger);
  if (list.length === 0) return console.log(`No ledger rows yet (${ledger}).`);
  const open = new Set(gh("pr", "list", "--repo", repo, "--author", "@me", "--state", "open", "--limit", "500", "--json", "number").map((pr) => pr.number));
  const done = list.filter((r) => !open.has(r.pr));
  if (done.length === 0) return console.log(`Nothing to archive: all ${list.length} rows are open PRs.`);
  write(archiveFile, ARCHIVE_HEADER, [...done, ...rows(archiveFile).filter((r) => !done.some((d) => d.pr === r.pr))]);
  write(ledger, HEADER, list.filter((r) => open.has(r.pr)));
  console.log(`Archived ${done.length} rows of merged or closed PRs (${done.map((r) => `#${r.pr}`).join(" ")}). ${list.length - done.length} rows left.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { repo: { type: "string" } } });
  const [command] = positionals;
  if (command === "archive") archive(repoName(values.repo));
  else if (/^\d+$/.test(command ?? "")) console.log(row(command)?.line ?? `#${command} has no row`);
  else fail("usage: ledger.mjs archive | ledger.mjs <pr>");
  const warning = ignoreWarning();
  if (warning) console.log(warning);
}
