#!/usr/bin/env node
// Carries a change up a stack of PRs: merges each PR's branch into the branch of each PR on top of it, one level
// at a time, with `git merge-tree` and `git commit-tree`, so it needs no worktree and moves no local branch.
// Without --push it stops there and prints the plan (the merge commits exist already, so `git show` them).
// With --push it runs the verify command on every merged tip in one temporary worktree and, only if every run
// passes, pushes the merge commits in one atomic push. Merges only add commits, so nothing is ever forced.
//
//   node stack-up.mjs <pr> [--push] [--verify '<command>' | --no-verify] [--link]
//
//   <pr>         the PR that just changed; only the user's own PRs above it are pushed to
//   --verify     the project's verify command (default: "verify" in .agents/merge-train.json)
//   --no-verify  skip it, only when it just passed on these same merged trees
//   --link       after the push, link the chain as a GitHub stack with `gh stack link` (github/gh-stack)
//
// It stops at the first conflict. With --push it still verifies and pushes the clean merges below it, so the
// conflicting level can be merged by hand against the pushed parent. Exits 0 when done, 1 on a conflict, a failed
// verify or a PR that isn't the user's, 2 when it couldn't check.
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";
import { fail, gh, git, isAncestor, login, repoContext, sh, short } from "./lib.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    push: { type: "boolean", default: false },
    verify: { type: "string" },
    "no-verify": { type: "boolean", default: false },
    link: { type: "boolean", default: false },
  },
});

const start = Number(positionals[0]?.replace(/^#/, ""));
if (positionals.length !== 1 || !Number.isInteger(start) || start <= 0) fail("usage: stack-up.mjs <pr> [--push] [--verify '<command>' | --no-verify] [--link]");

const { repo, remote, settings } = repoContext();
const verify = opts["no-verify"] ? undefined : (opts.verify ?? settings.verify);
if (opts.push && !opts["no-verify"] && !verify)
  fail(`no verify command: pass --verify '<command>' (read it from the project's AGENTS.md, CONTRIBUTING.md or package.json) or set "verify" in .agents/merge-train.json`);
const me = login();

const open = gh("pr", "list", "--repo", repo, "--state", "open", "--limit", "500", "--json", "number,title,headRefName,baseRefName,author,isCrossRepository");
const sameRepo = open.filter((pr) => !pr.isCrossRepository);
const byBranch = new Map(sameRepo.map((pr) => [pr.headRefName, pr]));
const above = (pr) => sameRepo.filter((other) => other.baseRefName === pr.headRefName);

const first = open.find((pr) => pr.number === start);
if (!first) fail(`#${start} isn't an open PR in ${repo}`);
if (first.isCrossRepository) fail(`#${start} comes from a fork, so no PR here can be stacked on its branch`);

const below = [];
for (let pr = byBranch.get(first.baseRefName); pr && !below.includes(pr); pr = byBranch.get(pr.baseRefName)) below.unshift(pr);

// Every PR above <pr>, parents before children. A PR with two PRs on top makes it a tree
const merges = [];
let forked = false;
for (const queue = [first]; queue.length > 0; ) {
  const parent = queue.shift();
  const children = above(parent);
  if (children.length > 1) forked = true;
  for (const child of children) {
    merges.push({ parent, child });
    queue.push(child);
  }
}
if (merges.length === 0) console.log(`Nothing is stacked on #${start} (${first.headRefName}).`);

const label = ({ parent, child }) => `#${parent.number} ${parent.headRefName} -> #${child.number} ${child.headRefName}`;
const branches = [first, ...merges.map(({ child }) => child)].map((pr) => pr.headRefName);
git("fetch", "--quiet", remote, ...branches.map((branch) => `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`));
const tips = new Map(branches.map((branch) => [branch, git("rev-parse", `refs/remotes/${remote}/${branch}`)]));

// A branch needs a merge when its parent's tip is missing or its parent gets one; only those must be yours
const moving = new Set();
for (const { parent, child } of merges) {
  if (moving.has(parent.headRefName) || !isAncestor(tips.get(parent.headRefName), tips.get(child.headRefName))) moving.add(child.headRefName);
}
const theirs = merges.filter(({ child }) => moving.has(child.headRefName) && child.author.login !== me);
if (theirs.length > 0)
  fail(`these aren't your PRs, so nothing was merged or pushed. Report them instead:\n${theirs.map((m) => `  ${label(m)}: #${m.child.number} is ${m.child.author.login}'s`).join("\n")}`, 1);

const done = [];
let conflict;
for (const merge of merges) {
  const { parent, child } = merge;
  const parentTip = tips.get(parent.headRefName);
  const childTip = tips.get(child.headRefName);
  if (isAncestor(parentTip, childTip)) {
    console.log(`${label(merge)}: already has it`);
    continue;
  }
  const result = sh("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", childTip, parentTip], { allowFail: true });
  const [tree, ...files] = result.stdout.trim().split("\n");
  if (result.status === 1) {
    conflict = { merge, files: files.filter(Boolean) };
    break;
  }
  if (result.status !== 0) fail(`git merge-tree failed: ${result.stderr.trim()}`);
  const sha = sh("git", ["commit-tree", tree, "-p", childTip, "-p", parentTip], { input: `Merge branch '${parent.headRefName}' into ${child.headRefName}\n` }).stdout.trim();
  tips.set(child.headRefName, sha);
  done.push({ pr: child, sha, old: childTip });
  console.log(`${label(merge)}: merged as ${short(sha)}`);
}

const conflictReport = () => {
  const { merge, files } = conflict;
  console.log(`\n${label(merge)}: the merge conflicts in\n${files.map((file) => `  ${file}`).join("\n")}`);
  console.log(
    `Merge it by hand in a checkout of ${merge.child.headRefName}, after the merges below it are pushed:\n` +
      `  git fetch ${remote} && git merge ${remote}/${merge.parent.headRefName}\n` +
      "  resolve, then git commit --no-edit --cleanup=strip, run the verify command, and push with the same OK.\n" +
      `Then run stack-up.mjs ${merge.child.number} for the PRs above it.`,
  );
};

if (!opts.push) {
  const verifyStep = verify ? `run \`${verify}\` on ${done.length} merged tip(s), then` : opts["no-verify"] ? "skip verify, then" : "need --verify '<command>' (none is set), then";
  if (done.length > 0) console.log(`\nDry run: --push would ${verifyStep} push ${done.length} merge commit(s) to ${remote}.`);
  if (conflict) conflictReport();
  process.exit(conflict ? 1 : 0);
}

if (done.length > 0 && verify) {
  const temp = join(tmpdir(), `stack-up-${repo.replace("/", "-")}-${start}`);
  if (existsSync(temp)) fail(`${temp} is left from an earlier run. Look at it, remove it with \`git worktree remove --force ${temp}\`, then rerun.`);
  git("worktree", "add", "--quiet", "--detach", temp, done[0].sha);
  for (const { pr, sha } of done) {
    sh("git", ["-C", temp, "checkout", "--quiet", "--detach", sha]);
    console.log(`\nVerify on #${pr.number} ${pr.headRefName} at ${short(sha)}: ${verify}`);
    if (spawnSync(verify, { cwd: temp, shell: true, stdio: "inherit" }).status !== 0) {
      const unpushed = done.map(({ pr, sha }) => `  #${pr.number} ${pr.headRefName}: ${sha}`).join("\n");
      fail(`verify failed on #${pr.number}'s merged tip, so nothing was pushed. The worktree stays at ${temp}.\nFix the layer that owns the failing line, push it, and run stack-up again. The unpushed merges:\n${unpushed}`, 1);
    }
  }
  git("worktree", "remove", "--force", temp);
} else if (done.length > 0) console.log("Skipping verify (--no-verify).");

if (done.length > 0) {
  // Plain refspecs, so the remote refuses anything but a fast-forward; --atomic pushes all or none
  const push = sh("git", ["push", "--quiet", "--atomic", remote, ...done.map(({ pr, sha }) => `${sha}:refs/heads/${pr.headRefName}`)], { allowFail: true });
  if (push.status !== 0) fail(`the push was refused, so nothing moved (did someone push meanwhile? rerun stack-up):\n${push.stderr.trim()}`, 1);
  for (const { pr, sha } of done) console.log(`#${pr.number} ${pr.headRefName}: pushed ${short(sha)}`);
  const local = done.filter(({ pr }) => sh("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${pr.headRefName}`], { allowFail: true }).status === 0);
  if (local.length > 0)
    console.log(`Local branches now behind ${remote}: ${local.map(({ pr }) => pr.headRefName).join(", ")}. In each checkout, git merge --ff-only ${remote}/<branch> before committing there.`);
}

if (conflict) {
  conflictReport();
  process.exit(1);
}

const chain = [...below, first];
for (let pr = first; above(pr).length === 1; ) chain.push((pr = above(pr)[0]));
const numbers = chain.map((pr) => pr.number).join(" ");
const hasGhStack = () => sh("gh", ["stack", "--help"], { allowFail: true }).status === 0;
if (forked) console.log("\nNot linking: a PR in the stack has two PRs on top, so link each chain by hand with gh stack link <bottom pr> ... <top pr>.");
else if (opts.link) {
  // PR numbers, not branch names: given branches, gh stack link pushes them and opens PRs for any without one
  const link = sh("gh", ["stack", "link", ...chain.map((pr) => String(pr.number))], { allowFail: true });
  console.log(`\ngh stack link ${numbers}: ${(link.stdout + link.stderr).trim() || `exit ${link.status}`}`);
} else if (hasGhStack()) console.log(`\nIf these PRs are a GitHub stack, link them: gh stack link ${numbers} (or rerun with --link). Never pass --open.`);
