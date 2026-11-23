#!/usr/bin/env node
// Lists the working tree's changes as hunks with stable ids, and stages a chosen set of them, so a messy
// tree can be split into commits without the interactive `git add -p`. Only `stage` writes, and only to
// the index: the working tree is never touched.
//
//   node hunks.mjs [list] [-- <path>...]   every change not yet staged, grouped by file
//   node hunks.mjs stage <id|path>...      stage these hunks (git apply --cached), or whole files and folders (git add)
//
// Run it from the repo root. Text hunks have no context lines (git diff -U0), so each run of changed
// lines is its own hunk. An id hashes the file and the changed lines, so it stays the same while other
// hunks get staged and committed. New, deleted, binary, submodule and mode-only changes are one
// whole-file item each. Exits 0 when list finds nothing or stage worked, 1 when list finds changes,
// 2 on a git error or an id that no longer matches anything.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`hunks: ${message}`);
  process.exit(2);
};
// latin1 keeps every byte as one char, so patches round-trip exactly whatever the files' encoding
const git = (args, input) => {
  const result = spawnSync("git", args, { encoding: "latin1", input, maxBuffer: 1 << 30 });
  if (result.status !== 0) fail(`git ${args.filter((arg) => !arg.startsWith("-")).slice(0, 2).join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
  return result.stdout;
};
const utf8 = (latin1) => Buffer.from(latin1, "latin1").toString("utf8");
const hash = (...parts) => createHash("sha1").update(parts.join("\0")).digest("hex").slice(0, 7);
const clip = (line) => (line.length > 72 ? `${line.slice(0, 71)}…` : line);

process.chdir(utf8(git(["rev-parse", "--show-toplevel"])).trim());
const rest = process.argv.slice(2);
const command = ["list", "stage"].includes(rest[0]) ? rest.shift() : "list";
if (git(["ls-files", "-u"]).trim()) fail("the index has unmerged paths; finish the merge or rebase first");

const DIFF = ["-c", "core.quotePath=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "-U0", "--inter-hunk-context=0"];

function collect(pathspec) {
  const files = [];
  for (const block of git([...DIFF, "--", ...pathspec]).split(/^(?=diff --git )/m).filter(Boolean)) {
    const lines = block.replace(/\n$/, "").split("\n");
    const first = lines.findIndex((line) => line.startsWith("@@"));
    const header = first === -1 ? lines : lines.slice(0, first);
    const path = utf8(parsePath(header[0]));
    const kind =
      header.some((line) => line.startsWith("new file mode")) ? "new file" :
      header.some((line) => line.startsWith("deleted file mode")) ? "deleted" :
      header.some((line) => /^(Binary files|GIT binary patch)/.test(line)) ? "binary" :
      header.some((line) => /^(index \S+ 160000|(old|new) mode 160000)/.test(line)) ? "submodule" :
      first === -1 ? "mode change" : "text";
    const mode = header.find((line) => line.startsWith("old mode"))?.slice(9);
    const modeNote = mode ? ` (mode ${mode} → ${header.find((line) => line.startsWith("new mode")).slice(9)}, staged with its first hunk)` : "";
    if (kind !== "text") {
      files.push({ path, note: "", items: [{ id: hash(path, kind), whole: true, label: `${kind}, whole file` }] });
      continue;
    }
    const items = [];
    const seen = new Map();
    for (let i = first; i < lines.length; ) {
      const end = lines.findIndex((line, j) => j > i && line.startsWith("@@"));
      const body = lines.slice(i + 1, end === -1 ? lines.length : end);
      const [, oldStart, oldCount = "1", newStart, newCount = "1"] = lines[i].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const key = body.join("\n");
      seen.set(key, (seen.get(key) ?? 0) + 1);
      const hunk = { oldStart: +oldStart, oldCount: +oldCount, newStart: +newStart, newCount: +newCount, body };
      const where = hunk.newCount === 0 ? `after ${hunk.newStart}` : hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}`;
      const counts = [hunk.newCount && `+${hunk.newCount}`, hunk.oldCount && `-${hunk.oldCount}`].filter(Boolean).join(" ");
      const preview = body.filter((line) => /^[-+]/.test(line)).slice(0, 2).map((line) => clip(utf8(line)));
      items.push({ id: hash(path, key, seen.get(key)), hunk, label: `${where.padEnd(9)} ${counts.padEnd(9)} ${preview[0] ?? ""}`, more: preview.slice(1) });
      i = end === -1 ? lines.length : end;
    }
    files.push({ path, header, note: modeNote, items });
  }
  for (const raw of git(["-c", "core.quotePath=false", "ls-files", "--others", "--exclude-standard", "-z", "--", ...pathspec]).split("\0").filter(Boolean)) {
    const path = utf8(raw).replace(/\/$/, "");
    files.push({ path, note: "", items: [{ id: hash(path, "new file"), whole: true, label: describeUntracked(path) }] });
  }
  return files;
}

// `diff --git a/<path> b/<path>` with the same path twice, since renames are off
function parsePath(line) {
  const pair = line.slice("diff --git ".length);
  if (!pair.startsWith('"')) return pair.slice(2, 2 + (pair.length - 5) / 2);
  const quoted = pair.match(/^"a\/((?:[^"\\]|\\.)*)"/);
  try {
    return JSON.parse(`"${quoted[1]}"`);
  } catch {
    fail(`can't read the path in: ${line}; stage that file with git add`);
  }
}

function describeUntracked(path) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return "new symlink, whole file";
  if (stat.isDirectory()) return "new directory (a nested repo), whole";
  const content = readFileSync(path);
  if (content.subarray(0, 8000).includes(0)) return `new binary, ${content.length} bytes, whole file`;
  const text = content.toString("utf8");
  const count = text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
  return `new file, ${count} line${count === 1 ? "" : "s"}, whole file${text.trim() ? `: ${clip(text.trim().split("\n")[0])}` : ""}`;
}

if (command === "list") {
  const files = collect(rest[0] === "--" ? rest.slice(1) : rest);
  const staged = spawnSync("git", ["diff", "--cached", "--quiet"]).status === 1;
  if (staged) console.log("Note: the index already has staged changes, and they'll go into the next commit. `git reset -q` unstages them and keeps the files as they are.\n");
  if (files.length === 0) {
    console.log("No unstaged changes.");
    process.exit(0);
  }
  for (const file of files) {
    console.log(`${file.path}${file.note}`);
    for (const item of file.items) {
      console.log(`  ${item.id}  ${item.label}`.trimEnd());
      for (const line of item.more ?? []) console.log(`${" ".repeat(31)}${line}`);
    }
  }
  const count = files.reduce((sum, file) => sum + file.items.length, 0);
  console.log(`\n${count} item(s) in ${files.length} file(s). Stage with: node <this script> stage <id|path>...`);
  process.exit(1);
}

if (command !== "stage" || rest.length === 0) fail("usage: hunks.mjs [list] [-- <path>...] | hunks.mjs stage <id|path>...");

const files = collect([]);
const byId = new Map(files.flatMap((file) => file.items.map((item) => [item.id, { file, item }])));
const wholePaths = new Set();
const picked = new Map();
for (const arg of rest) {
  const prefix = arg.replace(/\/$/, "");
  const under = files.filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`));
  if (under.length) for (const file of under) wholePaths.add(file.path);
  else if (byId.has(arg)) {
    const { file: owner, item } = byId.get(arg);
    if (item.whole) wholePaths.add(owner.path);
    else picked.set(owner, [...(picked.get(owner) ?? []), item]);
  } else fail(`${arg} matches no unstaged hunk or changed file; run list again for current ids`);
}

const patch = [];
for (const [file, items] of picked) {
  if (wholePaths.has(file.path)) continue;
  patch.push(...file.header);
  let delta = 0;
  for (const { hunk } of file.items.filter((item) => items.includes(item))) {
    // New-side starts shift with the hunks left out; zero-length sides count from the line before
    const start = hunk.oldCount === 0 ? hunk.oldStart + delta + 1 : hunk.newCount === 0 ? hunk.oldStart + delta - 1 : hunk.oldStart + delta;
    patch.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${start},${hunk.newCount} @@`, ...hunk.body);
    delta += hunk.newCount - hunk.oldCount;
  }
}
if (patch.length) git(["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"], Buffer.from(`${patch.join("\n")}\n`, "latin1"));
if (wholePaths.size) git(["add", "-A", "--", ...wholePaths]);

const hunks = [...picked].filter(([file]) => !wholePaths.has(file.path)).reduce((sum, [, items]) => sum + items.length, 0);
console.log(`Staged ${hunks} hunk(s) and ${wholePaths.size} whole file(s). The index now holds:\n`);
console.log(utf8(git(["-c", "core.quotePath=false", "diff", "--cached", "--stat"])).trimEnd());
