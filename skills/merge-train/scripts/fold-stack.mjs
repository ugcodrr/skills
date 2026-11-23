#!/usr/bin/env node
// Folds `fixup!` commits into their targets across a local stack whose branches are joined by merges
// (each parent merged into its child with `git merge`), which `git rebase --autosquash` can't do.
// It replays <base>..<branches> with `git merge-tree` and `git commit-tree`: each rewritten commit keeps
// its old tree plus the folded changes, so every merge keeps its old conflict resolution. That needs no
// worktree and no rerere. It never pushes. Run it from any checkout of the repo.
//
//   node fold-stack.mjs --base <ref> <top branch> [--apply]      move every local branch inside base..top
//   node fold-stack.mjs --base <ref> <branch>... [--apply]       move exactly these branches
//
//   --apply     move the branches; without it, it prints the plan and moves nothing
//   --explicit  the branches given are the whole list, even one: no other branch at a tip in the range moves
//   --map       a file of `<sha> <target sha>` lines, each folding an existing commit like a fixup;
//               `<sha> drop` lines, allowed only for a revert and its target whose changes cancel out; and
//               `<sha> keep` lines, keeping a fixup!/amend! commit as an ordinary commit, which an amend!
//               mapped onto it has to rename
//
// A fixup's target is the one commit in the range with that subject; missing or repeated subjects stop it.
// An `amend! <subject>` commit folds the same way and also replaces the target's message with its own,
// minus its first line (git's convention), so a commit deep in the stack can be reworded.
// A --map line wins over the subject. A target has to stay: no chains, cycles or folding into a merge.
// It checks every branch's new tree is its old tree plus exactly the fixups that now land in it, minus
// the dropped commits inside it. --apply
// backs up each moved branch as refs/fold-backup/<stamp>/<branch> (not a branch, so no `git branch -D`),
// moves it with `git update-ref`, or with `git reset --keep` where a worktree has it checked out, and
// refuses when that worktree has uncommitted changes.
// Exits 0 after a clean dry run or apply, 1 when it can't fold, 2 on bad usage or a git failure.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { groupBy } from "./lib.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    base: { type: "string" },
    apply: { type: "boolean", default: false },
    explicit: { type: "boolean", default: false },
    map: { type: "string" },
  },
});

const fail = (message, code = 1) => {
  console.error(`fold-stack: ${message}`);
  process.exit(code);
};

if (!opts.base || positionals.length === 0) fail("usage: fold-stack.mjs --base <ref> <top branch> | <branch>... [--explicit] [--map <file>] [--apply]", 2);

const sh = (args, { cwd = ".", input, env, allowFail = false } = {}) => {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 256 << 20, input, env: env && { ...process.env, ...env } });
  if (result.status !== 0 && !allowFail) fail(`git ${args.slice(0, 4).join(" ")} failed: ${result.stderr.trim()}`, 2);
  return result;
};
const git = (...args) => sh(args).stdout.trim();
const repo = git("rev-parse", "--show-toplevel");
const isAncestor = (ancestor, sha) => sh(["merge-base", "--is-ancestor", ancestor, sha], { allowFail: true }).status === 0;
const short = (sha) => sha.slice(0, 9);
const describe = (commit) => `${short(commit.sha)} "${commit.subject}"`;
const FIXUP = /^((fixup|amend)! )+/;

const base = git("rev-parse", "--verify", `${opts.base}^{commit}`);
const tipOf = (name) => sh(["rev-parse", "--verify", "--quiet", `refs/heads/${name}^{commit}`], { allowFail: true }).stdout.trim();
let branches = positionals.map((name) => ({ name, old: tipOf(name) || fail(`${name} isn't a local branch`) }));

// Parents before children, so every parent is replayed before the commits on top of it
const commits = git("log", "--topo-order", "--reverse", "--format=%H %P%x00%s", ...branches.map((branch) => branch.old), `^${base}`)
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [shas, subject] = line.split("\0");
    const [sha, ...parents] = shas.split(" ");
    return { sha, parents, subject };
  });
const position = new Map(commits.map((commit, i) => [commit.sha, i]));
if (commits.length === 0) fail(`nothing in ${opts.base}..${positionals.join(" ")}`);

if (positionals.length === 1 && !opts.explicit) {
  branches = git("for-each-ref", "--format=%(objectname) %(refname:strip=2)", "refs/heads")
    .split("\n")
    .map((line) => ({ old: line.slice(0, line.indexOf(" ")), name: line.slice(line.indexOf(" ") + 1) }))
    .filter((branch) => position.has(branch.old));
  // A backup branch at a stack branch's tip looks the same, and moving it would lose the backup
  const shared = [...groupBy(branches, (branch) => branch.old).values()].filter((group) => group.length > 1);
  if (shared.length > 0)
    fail(`these branches share a tip, so pass the branches to move yourself:\n${shared.map((group) => `  ${group.map((branch) => branch.name).join(", ")} at ${short(group[0].old)}`).join("\n")}`);
}
branches.sort((a, b) => (position.get(a.old) ?? -1) - (position.get(b.old) ?? -1));

const problems = [];
const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
const inRange = (ref) => bySha.get(sh(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { allowFail: true }).stdout.trim());

// Each mapped or fixup commit's target commit, "drop" or "keep"
const chosen = new Map();
if (opts.map) {
  for (const [i, line] of readFileSync(opts.map, "utf8").split("\n").entries()) {
    const words = line.replace(/#.*/, "").trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const where = `${opts.map}:${i + 1}`;
    const commit = inRange(words[0]);
    const target = words[1] === "drop" || words[1] === "keep" ? words[1] : words[1] && inRange(words[1]);
    if (words.length !== 2) problems.push(`${where}: expected "<sha> <target sha>", "<sha> drop" or "<sha> keep"`);
    else if (!commit) problems.push(`${where}: ${words[0]} isn't a commit in the range`);
    else if (!target) problems.push(`${where}: ${words[1]} isn't a commit in the range`);
    else if (chosen.has(commit.sha)) problems.push(`${where}: ${short(commit.sha)} is mapped twice`);
    else chosen.set(commit.sha, target);
  }
}

const bySubject = groupBy(commits.filter((commit) => !FIXUP.test(commit.subject)), (commit) => commit.subject);
for (const fixup of commits.filter((commit) => FIXUP.test(commit.subject) && !chosen.has(commit.sha))) {
  const matches = bySubject.get(fixup.subject.replace(FIXUP, "")) ?? [];
  if (matches.length === 0) problems.push(`${describe(fixup)}: no commit in the range has that subject`);
  else if (matches.length > 1) problems.push(`${describe(fixup)}: ${matches.length} commits have that subject (${matches.map((match) => short(match.sha)).join(", ")})`);
  else chosen.set(fixup.sha, matches[0]);
}

const folds = new Map();
for (const commit of commits.filter((commit) => chosen.has(commit.sha))) {
  const target = chosen.get(commit.sha);
  if (commit.parents.length !== 1) problems.push(`${describe(commit)} is a merge`);
  else if (target === "drop") commit.dropped = true;
  else if (target === "keep") {
    if (FIXUP.test(commit.subject)) commit.kept = true;
    else problems.push(`${describe(commit)} is kept, but only a fixup! or amend! commit needs keeping`);
  } else if (chosen.has(target.sha) && chosen.get(target.sha) !== "keep") problems.push(`${describe(commit)}: its target ${describe(target)} is folded or dropped too, so point it at where that one goes`);
  else if (target.parents.length !== 1) problems.push(`${describe(commit)}: its target ${short(target.sha)} is a merge`);
  else if (target === commit || !isAncestor(target.sha, commit.sha)) problems.push(`${describe(commit)}: its target ${short(target.sha)} isn't below it`);
  else {
    commit.target = target;
    folds.set(target.sha, [...(folds.get(target.sha) ?? []), commit]);
  }
}
const fixups = commits.filter((commit) => commit.target);
const dropped = commits.filter((commit) => commit.dropped);

// A drop only takes out a revert and the commit it reverts, so the stack's top keeps its tree
const patchId = (from, to) => sh(["patch-id", "--stable"], { input: sh(["diff", "--binary", from, to]).stdout }).stdout.split(" ")[0];
const unpaired = new Set(dropped);
for (const commit of dropped) {
  if (!unpaired.delete(commit)) continue;
  const undo = patchId(commit.sha, commit.parents[0]);
  const partner = [...unpaired].find((other) => patchId(other.parents[0], other.sha) === undo);
  if (partner) {
    unpaired.delete(partner);
    commit.partner = partner;
    partner.partner = commit;
  } else problems.push(`${describe(commit)} is dropped, but no other dropped commit undoes exactly its changes`);
}
if (problems.length > 0) fail(`can't fold:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
if (fixups.length + dropped.length === 0) fail(`nothing to fold or drop in ${opts.base}..${positionals.join(" ")}`);

const threeWay = (mergeBase, ours, theirs, what) => {
  const result = sh(["merge-tree", "--write-tree", "--name-only", "--no-messages", `--merge-base=${mergeBase}`, ours, theirs], { allowFail: true });
  const [tree, ...files] = result.stdout.trim().split("\n");
  if (result.status === 1)
    fail(
      `${what} conflicts in:\n${files.filter(Boolean).map((file) => `  ${file}`).join("\n")}\n` +
        "A commit between the fixup and its target changes the same lines: make it a fixup of that commit, or fold it by hand.\n" +
        "Or keep the fixup as its own commit where it is: add `<fixup sha> keep` to the --map file, then commit an empty\n" +
        "`amend! <fixup subject>` (git commit --allow-empty -F <file>: that line, a blank line, the real message) and map it\n" +
        `as \`<amend sha> <fixup sha>\`. The fixups in this fold:\n${[...folds.values()].flat().map((fixup) => `  ${describe(fixup)}`).join("\n")}\n` +
        "Nothing was moved.",
    );
  if (result.status !== 0) fail(`git merge-tree failed: ${result.stderr.trim()}`, 2);
  return tree;
};

const messageOf = (sha) => {
  const raw = sh(["cat-file", "commit", sha]).stdout;
  return raw.slice(raw.indexOf("\n\n") + 2);
};

// An amend! commit's message after its subject line and the blank line under it
const amendedMessage = (fixup) => messageOf(fixup.sha).split("\n").slice(2).join("\n");

// A kept fixup! or amend! commit would otherwise keep that subject, so an amend! mapped onto it has to give it one
const unnamed = commits.filter((commit) => {
  if (!commit.kept) return false;
  const amend = (folds.get(commit.sha) ?? []).findLast((fixup) => fixup.subject.startsWith("amend! "));
  const message = amend ? amendedMessage(amend) : "";
  return !message.trim() || FIXUP.test(message);
});
if (unnamed.length > 0) fail(`kept without a new message (map an amend! commit onto each):\n${unnamed.map((commit) => `  ${describe(commit)}`).join("\n")}`);

// Keeping the original committer date makes the dry run's new SHAs the ones --apply moves the branches to
const commitTree = (sha, tree, parents, message = messageOf(sha)) => {
  const raw = sh(["cat-file", "commit", sha]).stdout;
  const headers = raw.slice(0, raw.indexOf("\n\n"));
  const person = (role) => headers.match(new RegExp(`^${role} (.*) <(.*)> (\\d+ [+-]\\d{4})$`, "m"));
  const [, name, email, authored] = person("author");
  const committed = person("committer")[3];
  return sh(["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], {
    input: message,
    env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: authored, GIT_COMMITTER_DATE: committed },
  }).stdout.trim();
};

const rewritten = new Map();
const mapped = (sha) => rewritten.get(sha) ?? sha;

for (const commit of commits) {
  if (commit.target || commit.dropped) {
    rewritten.set(commit.sha, mapped(commit.parents[0]));
    continue;
  }
  const parents = commit.parents.map(mapped);
  const own = folds.get(commit.sha) ?? [];
  if (own.length === 0 && parents.every((parent, i) => parent === commit.parents[i])) continue;

  let tree = git("rev-parse", `${commit.sha}^{tree}`);
  commit.parents.forEach((parent, i) => {
    if (parents[i] !== parent) tree = threeWay(parent, tree, parents[i], `Replaying ${describe(commit)} on its new parent ${short(parents[i])}`);
  });
  for (const fixup of own) tree = threeWay(fixup.parents[0], tree, fixup.sha, `Folding ${describe(fixup)} into ${short(commit.sha)}`);
  const amend = own.findLast((fixup) => fixup.subject.startsWith("amend! "));
  rewritten.set(commit.sha, commitTree(commit.sha, tree, parents, amend && amendedMessage(amend)));
}

const worktrees = git("worktree", "list", "--porcelain")
  .split("\n\n")
  .map((block) => ({ path: block.match(/^worktree (.+)$/m)?.[1], branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] }));
const count = (...args) => Number(git("rev-list", "--count", ...args));
const shape = (tip) => ({ firstParent: count("--first-parent", tip, `^${base}`), merges: count("--first-parent", "--merges", tip, `^${base}`) });

for (const branch of branches) {
  branch.new = mapped(branch.old);
  branch.worktree = worktrees.find((worktree) => worktree.branch === branch.name)?.path;
  branch.landed = fixups.filter((fixup) => isAncestor(fixup.target.sha, branch.old) && !isAncestor(fixup.sha, branch.old));
  let expected = git("rev-parse", `${branch.old}^{tree}`);
  for (const fixup of branch.landed) expected = threeWay(fixup.parents[0], expected, fixup.sha, `Checking ${branch.name}: ${describe(fixup)}`);
  // Newest first, so a revert comes back out before the commit it reverts
  branch.without = dropped.filter((commit) => isAncestor(commit.sha, branch.old));
  // Patch ids ignore line positions, so a pair inside the branch must also leave its tree as it was
  const folded = expected;
  let canceled = folded;
  for (const commit of branch.without.filter((commit) => branch.without.includes(commit.partner)).toReversed())
    canceled = threeWay(commit.sha, canceled, commit.parents[0], `Checking ${branch.name} without ${describe(commit)}`);
  for (const commit of branch.without.toReversed()) expected = threeWay(commit.sha, expected, commit.parents[0], `Checking ${branch.name} without ${describe(commit)}`);
  const actual = git("rev-parse", `${branch.new}^{tree}`);
  if (canceled !== folded) branch.mismatch = "a dropped revert and its target don't cancel out";
  else branch.mismatch = actual === expected ? "" : git("diff", "--name-only", expected, actual);
  branch.before = shape(branch.old);
  branch.after = shape(branch.new);
}

const lowest = (sha) => branches.find((branch) => isAncestor(sha, branch.old))?.name;
console.log(`${fixups.length} folds and ${dropped.length} drops in ${opts.base}..${positionals.join(" ")} (${commits.length} commits):`);
for (const fixup of fixups) console.log(`  ${short(fixup.sha)} -> ${describe(fixup.target)}, first in ${lowest(fixup.target.sha)}`);
for (const commit of dropped) console.log(`  ${describe(commit)} dropped`);

const rows = [
  ["branch", "old", "new", "first-parent", "merges", "tree"],
  ...branches.map((branch) => [
    branch.name,
    short(branch.old),
    branch.new === branch.old ? "unchanged" : short(branch.new),
    `${branch.before.firstParent} -> ${branch.after.firstParent}`,
    `${branch.before.merges} -> ${branch.after.merges}`,
    branch.mismatch ?
      "MISMATCH" :
      branch.landed.length + branch.without.length > 0 ?
        ["old", ...branch.landed.map((fixup) => `+ ${short(fixup.sha)}`), ...branch.without.map((commit) => `- ${short(commit.sha)}`)].join(" ") :
        "same as old",
  ]),
];
const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
console.log(`\n${rows.map((row) => row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()).join("\n")}`);

const movedNames = new Set(branches.map((branch) => branch.name));
const left = new Set(
  [...folds.keys()].flatMap((target) => git("for-each-ref", `--contains=${target}`, "--format=%(refname:strip=2)", "refs/heads").split("\n").filter(Boolean)),
);
const leftBehind = [...left].filter((name) => !movedNames.has(name));
if (leftBehind.length > 0) console.log(`\nNot moved, so still on the old commits: ${leftBehind.join(", ")}`);

const mismatched = branches.filter((branch) => branch.mismatch);
if (mismatched.length > 0)
  fail(`the new tree isn't the old one plus its folds and minus its drops, so nothing was moved:\n${mismatched.map((branch) => `  ${branch.name}: ${branch.mismatch.split("\n").join(", ")}`).join("\n")}`);

const moving = branches.filter((branch) => branch.new !== branch.old);
if (!opts.apply) {
  console.log(`\nDry run, nothing moved. The new commits exist already, so git show or diff them; then rerun with --apply.`);
  process.exit(0);
}

for (const branch of moving.filter((branch) => branch.worktree)) {
  if (sh(["status", "--porcelain", "--untracked-files=no"], { cwd: branch.worktree }).stdout.trim())
    fail(`${branch.worktree} has ${branch.name} checked out with uncommitted changes. Commit them or set them aside, then rerun. Nothing was moved.`);
  if (sh(["rev-parse", "HEAD"], { cwd: branch.worktree }).stdout.trim() !== branch.old) fail(`${branch.worktree} isn't at ${branch.name}'s tip ${short(branch.old)}. Nothing was moved.`);
}

const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const backup = (branch) => `refs/fold-backup/${stamp}/${branch.name}`;
const undo = (branch) => (branch.worktree ? `git -C ${branch.worktree} reset --keep ${backup(branch)}` : `git -C ${repo} update-ref refs/heads/${branch.name} ${backup(branch)}`);

// update-ref --stdin is one transaction: every backup and move happens, or none if a branch moved meanwhile
sh(["update-ref", "--stdin"], {
  input: [
    ...moving.map((branch) => `create ${backup(branch)} ${branch.old}`),
    ...moving.filter((branch) => !branch.worktree).map((branch) => `update refs/heads/${branch.name} ${branch.new} ${branch.old}`),
    "",
  ].join("\n"),
});
const moved = moving.filter((branch) => !branch.worktree);
for (const branch of moving.filter((branch) => branch.worktree)) {
  const reset = sh(["reset", "-q", "--keep", branch.new], { cwd: branch.worktree, allowFail: true });
  if (reset.status !== 0) fail(`git reset --keep in ${branch.worktree} failed: ${reset.stderr.trim()}\nThese branches moved already. To undo them:\n${moved.map((done) => `  ${undo(done)}`).join("\n")}`);
  moved.push(branch);
}

console.log(`\nMoved ${moving.length} branches. Backups are under refs/fold-backup/${stamp}/. To undo:`);
console.log(moving.map((branch) => `  ${undo(branch)}`).join("\n"));
console.log("Once the user is happy with the new tips, the backups can go (their call):");
console.log(moving.map((branch) => `  git -C ${repo} update-ref -d ${backup(branch)}`).join("\n"));
