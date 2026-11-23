#!/usr/bin/env node
/**
 * The git and PR facts a thread checks before it settles: uncommitted work in this worktree, every
 * stash, and for each branch (plus the current one, or a detached HEAD) where it stands against the
 * remote's live heads, where it's checked out and its PRs. Read-only with no fetch: one ls-remote
 * per remote and one gh call per branch. Exits 0, or 2 when a fact couldn't be read (an UNKNOWN line).
 *
 *   node <this skill's folder>/scripts/settle-facts.mjs [branch…] [--remote <name>] [--no-gh]
 *
 * --remote picks the remote to compare with (default: the branch's upstream, else origin); --no-gh
 * skips PRs, for repos outside GitHub.
 */

import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    remote: { type: "string" },
    "no-gh": { type: "boolean", default: false },
  },
});

// A credential prompt would hang the script, and status shouldn't take the index lock
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

function run(command, args, input) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env,
      input,
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return undefined;
  }
}

const git = (...args) => run("git", args);
const lines = (text) => (text ?? "").split("\n").filter(Boolean);
const short = (sha) => sha.slice(0, 10);

let incomplete = false;
function unknown(message) {
  incomplete = true;
  console.log(`  UNKNOWN: ${message}`);
}

const top = git("rev-parse", "--show-toplevel");
if (!top) {
  console.error("settle-facts: not inside a git worktree");
  process.exit(2);
}

const current = git("symbolic-ref", "--quiet", "--short", "HEAD");
const branches = [...new Set([...positionals, ...(current ? [current] : [])])];
const remotes = lines(git("remote"));
const snapshots = new Map();

console.log(`worktree ${top} (${current ?? "detached HEAD"})`);

const status = git("status", "--porcelain");
if (status === undefined) unknown("git status failed");
else {
  const changed = lines(status);
  console.log(`  ${changed.length === 0 ? "clean" : `${changed.length} uncommitted`}`);
  for (const line of changed.slice(0, 10)) console.log(`    ${line}`);
  if (changed.length > 10) console.log(`    … ${changed.length - 10} more`);
}

// Every worktree shares one stash list, and a stash's subject only hints at who made it
const stashes = git("stash", "list", "--format=%gd %gs");
if (stashes === undefined) unknown("git stash list failed");
for (const stash of lines(stashes)) console.log(`  ${stash}`);

const checkouts = new Map();
const worktrees = git("worktree", "list", "--porcelain");
if (worktrees === undefined) unknown("git worktree list failed");
let worktree;
for (const line of lines(worktrees)) {
  if (line.startsWith("worktree ")) worktree = line.slice("worktree ".length);
  else if (line.startsWith("branch refs/heads/")) checkouts.set(line.slice("branch refs/heads/".length), worktree);
}

for (const branch of branches) {
  const local = git("rev-parse", "-q", "--verify", `refs/heads/${branch}^{commit}`);
  console.log(`\nbranch ${branch}${local ? ` at ${short(local)}` : ""}`);
  if (!local) unknown("no local branch");
  else standing(local, branch, remoteFor(branch));

  const checkout = checkouts.get(branch);
  if (checkout) console.log(`  checked out ${checkout === top ? "here" : `in ${checkout}`}`);

  if (!values["no-gh"]) pullRequests(branch, local);
}

if (!current) {
  const head = git("rev-parse", "-q", "--verify", "HEAD^{commit}");
  console.log(`\ndetached HEAD${head ? ` at ${short(head)}` : ""}`);
  if (!head) unknown("HEAD has no commit");
  else standing(head, undefined, remoteFor());
}

if (incomplete) process.exitCode = 2;

function remoteFor(branch) {
  if (values.remote) return values.remote;
  const upstream = branch && git("for-each-ref", "--format=%(upstream:remotename)", `refs/heads/${branch}`);
  if (upstream && upstream !== ".") return upstream;
  return remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : undefined;
}

// Tracking refs outlive deleted remote branches, so only the heads ls-remote lists right now count
function liveHeads(remote) {
  if (snapshots.has(remote)) return snapshots.get(remote);

  const listed = git("ls-remote", "--heads", remote);
  let snapshot;
  if (listed !== undefined) {
    const heads = new Map(lines(listed).map((line) => {
      const [sha, ref] = line.split("\t");
      return [ref.slice("refs/heads/".length), sha];
    }));

    const shas = [...new Set(heads.values())];
    const types = shas.length === 0 ? "" : run("git", ["cat-file", "--batch-check=%(objectname) %(objecttype)"], `${shas.join("\n")}\n`);
    const fetched = types === undefined ? undefined : new Set(lines(types).filter((line) => line.endsWith(" commit")).map((line) => line.split(" ")[0]));
    snapshot = { heads, fetched, unfetched: fetched ? shas.length - fetched.size : 0 };
  }

  snapshots.set(remote, snapshot);
  return snapshot;
}

function count(revisions) {
  const counted = run("git", ["rev-list", "--count", "--stdin"], `${revisions.join("\n")}\n`);
  return counted !== undefined && /^\d+$/.test(counted) ? Number(counted) : undefined;
}

function standing(local, branch, remote) {
  if (!remote) return unknown("no remote to compare with (pass --remote)");

  const snapshot = liveHeads(remote);
  if (!snapshot) return unknown(`couldn't reach ${remote}, so whether it has these commits is unknown`);
  if (!snapshot.fetched) return unknown("git cat-file failed");

  const { heads, fetched, unfetched } = snapshot;
  const same = branch && heads.get(branch);
  if (branch && !same) console.log(`  no ${remote}/${branch}`);
  else if (same === local) console.log(`  same as ${remote}/${branch}`);
  else if (same && !fetched.has(same)) console.log(`  ${remote}/${branch} is at ${short(same)}, which isn't fetched`);
  else if (same) {
    const ahead = count([local, `^${same}`]);
    const behind = count([same, `^${local}`]);
    if (ahead === undefined || behind === undefined) unknown("git rev-list failed");
    else console.log(`  ${remote}/${branch} at ${short(same)}: ${ahead} to push, ${behind} behind${ahead && behind ? " (diverged)" : ""}`);
  }

  const missing = count([local, ...[...fetched].map((sha) => `^${sha}`)]);
  if (missing === undefined) unknown("git rev-list failed");
  else if (missing === 0) console.log(`  every commit is on a live ${remote} branch`);
  else {
    const caveat = unfetched > 0 ? `; ${unfetched} live heads aren't fetched and might hold some` : "";
    console.log(`  ${missing} ${missing === 1 ? "commit" : "commits"} on no live ${remote} branch${caveat}`);
  }
}

function pullRequests(branch, local) {
  const limit = 20;
  const fields = "number,title,state,isDraft,reviewDecision,mergeable,baseRefName,headRefOid,isCrossRepository,headRepositoryOwner,statusCheckRollup,url";
  const json = run("gh", ["pr", "list", "--head", branch, "--state", "all", "--limit", String(limit), "--json", fields]);

  let prs;
  try {
    prs = JSON.parse(json);
  } catch {
    return unknown("couldn't list PRs with gh (pass --no-gh outside GitHub)");
  }

  // gh matches the branch name only, so a fork's branch of the same name shows up too
  for (const pr of prs) {
    const state = pr.state === "OPEN" ? (pr.isDraft ? "draft" : "open") : pr.state.toLowerCase();
    const review = pr.reviewDecision ? `, ${pr.reviewDecision.toLowerCase().replaceAll("_", " ")}` : "";
    const fork = pr.isCrossRepository ? ` from ${pr.headRepositoryOwner?.login ?? "a fork"}` : "";
    const conflicts = pr.state === "OPEN" && pr.mergeable === "CONFLICTING" ? ", conflicts" : "";
    const head = !pr.headRefOid ? "unknown" : local && pr.headRefOid === local ? "same as local" : `at ${short(pr.headRefOid)}`;
    console.log(`  PR #${pr.number} "${pr.title}"${fork}: ${state}${review}${conflicts}, base ${pr.baseRefName}, head ${head}, checks ${checks(pr.statusCheckRollup ?? [])}  ${pr.url}`);
  }

  if (prs.length === limit) console.log(`  (the first ${limit} PRs only)`);
}

function checks(rollup) {
  if (rollup.length === 0) return "none";

  // A rerun leaves the old run in the rollup; keep the latest when every run has its own start time
  const groups = new Map();
  for (const check of rollup) {
    const key = `${check.__typename} ${check.workflowName ?? ""} ${check.name ?? check.context}`;
    groups.set(key, [...(groups.get(key) ?? []), check]);
  }
  const counted = [...groups.values()].flatMap((group) => {
    const starts = group.map((check) => Date.parse(check.startedAt));
    if (group.length === 1 || starts.some(Number.isNaN) || new Set(starts).size < group.length) return group;
    return [group[starts.indexOf(Math.max(...starts))]];
  });

  const tally = { pass: 0, fail: 0, pending: 0, other: 0 };
  for (const check of counted) {
    const result = check.__typename === "CheckRun" ? (check.status === "COMPLETED" ? check.conclusion : check.status) : check.state;
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(result)) tally.pass++;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(result)) tally.fail++;
    else if (["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"].includes(result)) tally.pending++;
    else tally.other++;
  }

  return `${tally.pass} pass, ${tally.fail} fail, ${tally.pending} pending${tally.other > 0 ? `, ${tally.other} other` : ""}`;
}
