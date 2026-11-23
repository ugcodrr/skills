#!/usr/bin/env node
// Prints the commands that move a stacked PR onto the default branch after its parent squash-merged. Prints
// only: the force-push rewrites a pushed branch, so the user approves it before anything runs.
//
//   node restack.mjs <child pr>
//
// It finds the parent in .agents/merge-train/state.json (from a merge-train.mjs run made while the parent was
// open), or from the child's base branch when GitHub hasn't retargeted it yet. The squash commit doesn't contain
// the parent's own commits, so the rebase needs the parent's old tip, which GitHub keeps on the merged PR.
// Exits 0 when it printed the restack or there's nothing to do, 2 when it couldn't check.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fail, gh, git, isAncestor, login, readState, repoContext, sh, short } from "./lib.mjs";

const child = Number(process.argv[2]?.replace(/^#/, ""));
if (!Number.isInteger(child) || child <= 0) fail("usage: restack.mjs <child pr>");

const { repo, remote, defaultBranch, settings, stateDir } = repoContext();
const state = readState(stateDir);
const now = gh("pr", "view", String(child), "--repo", repo, "--json", "number,headRefName,headRefOid,baseRefName,state,author,isCrossRepository");
if (now.state !== "OPEN") {
  console.log(`#${child} is ${now.state.toLowerCase()}, so there's nothing to restack.`);
  process.exit(0);
}

let parentNumber = state?.prs[child]?.parent;
if (!parentNumber && now.baseRefName !== defaultBranch) {
  // A branch name can have older closed PRs and same-named fork PRs: the live parent is the open one, else the newest merged
  const candidates = gh("pr", "list", "--repo", repo, "--state", "all", "--head", now.baseRefName, "--limit", "20", "--json", "number,state,isCrossRepository").filter((pr) => !pr.isCrossRepository);
  parentNumber = (candidates.find((pr) => pr.state === "OPEN") ?? candidates.find((pr) => pr.state === "MERGED"))?.number;
}
if (!parentNumber) fail(`#${child} has no stack parent in ${state ? `state.json (${state.generatedAt})` : "state.json (none yet)"} or in its base ${now.baseRefName}`);

const parent = gh("pr", "view", String(parentNumber), "--repo", repo, "--json", "number,state,mergedAt,headRefOid");
if (parent.state !== "MERGED") {
  console.log(`#${parentNumber} (the parent) is ${parent.state.toLowerCase()}, not merged. Nothing to restack yet.`);
  process.exit(0);
}

const oldTip = parent.headRefOid ?? state?.prs[parentNumber]?.head;
const branch = now.headRefName;
const base = `${remote}/${defaultBranch}`;
sh("git", ["fetch", "--quiet", remote, `+refs/heads/${defaultBranch}:refs/remotes/${base}`, `+refs/pull/${child}/head:refs/pr/${child}`, `+refs/pull/${parentNumber}/head:refs/pr/${parentNumber}`]);
const head = `refs/pr/${child}`;

if (isAncestor(oldTip, base)) {
  console.log(`#${parentNumber} merged with its commits kept (a merge commit), so #${child} needs no rebase.`);
  if (now.baseRefName !== defaultBranch) console.log(`Retarget it, with the user's OK: gh pr edit ${child} --repo ${repo} --base ${defaultBranch}`);
  process.exit(0);
}

// The rebase drops merge commits (the parent merged up into the child), so list only what it replays
const ownCommits = git("log", "--oneline", "--no-merges", `${oldTip}..${head}`);
const verify = settings.verify ?? "<the project's verify command>";
const temp = join(tmpdir(), `restack-${repo.replace("/", "-")}-${child}`);
const mine = now.author.login === login() && !now.isCrossRepository;

console.log(`#${child} (${branch}) sits on #${parentNumber}, which merged ${parent.mergedAt.slice(0, 10)}. Old parent tip: ${short(oldTip)}.`);
console.log(`Its own commits, which the restack keeps:\n${(ownCommits || "(none)").replace(/^/gm, "  ")}\n`);
if (!mine) {
  console.log(`#${child} is ${now.author.login}'s${now.isCrossRepository ? ", from a fork" : ""}: report the restack to them, don't push it.`);
  process.exit(0);
}
console.log("Ask the user before running these: the push rewrites a pushed branch.\n");
console.log(
  [
    `git worktree add --detach ${temp} ${now.headRefOid}`,
    `git -C ${temp} rebase --onto ${base} ${oldTip}`,
    `git -C ${temp} log --oneline ${base}..HEAD   # should list only the commits above`,
    `(cd ${temp} && ${verify})`,
    `git -C ${temp} push --force-with-lease=refs/heads/${branch}:${now.headRefOid} ${remote} HEAD:refs/heads/${branch}`,
    ...(now.baseRefName === defaultBranch ? [] : [`gh pr edit ${child} --repo ${repo} --base ${defaultBranch}`]),
    `git worktree remove --force ${temp}`,
  ].join("\n"),
);

const upper = gh("pr", "list", "--repo", repo, "--state", "open", "--base", branch, "--json", "number,headRefName");
if (upper.length > 0) {
  console.log(`\nStacked on #${child}, and needing the same move once it's pushed (each its own OK):`);
  for (const pr of upper) console.log(`  #${pr.number} ${pr.headRefName}: git rebase --onto ${remote}/${branch} ${now.headRefOid}, then push --force-with-lease the same way`);
}
