#!/usr/bin/env node
// The GitHub and git facts behind an inbox: your open PRs (review state, threads awaiting your reply,
// failing checks, conflicts), open PRs that request your review, and, in each repo you name, worktrees
// with uncommitted work, branches with commits no live remote branch has, and stashes.
// Read-only with no fetch: two paged GitHub searches and one ls-remote per remote.
// Exits 0 when nothing needs you, 1 when something does, 2 when a fact couldn't be read.
//
//   node inbox-facts.mjs [repo…] [--no-gh]
//
// Repos default to `repos` in ~/.agents/inbox.json, then the current repo. That file's `ignoreChecks`
// lists check names (regexes) that never make a PR red:
//   { "repos": ["~/src/api", "~/src/web"], "ignoreChecks": ["^Vercel$"] }
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { "no-gh": { type: "boolean", default: false } },
});

const COLLAPSE = 10;
const FAILED = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];
const PENDING = ["PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"];

// A credential prompt would hang the script, and status shouldn't take the index lock
const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1" };

const settingsPath = join(homedir(), ".agents", "inbox.json");
let settings = {};
if (existsSync(settingsPath)) {
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch {
    console.error(`inbox-facts: ${settingsPath} isn't valid JSON`);
    process.exit(2);
  }
}
const ignoreChecks = (settings.ignoreChecks ?? []).map((pattern) => new RegExp(pattern, "i"));
const expand = (path) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);
const tilde = (path) => (path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path);

let incomplete = false;
let needsYou = 0;
function unknown(message) {
  incomplete = true;
  console.log(`  UNKNOWN: ${message}`);
}

function run(command, args, input) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env,
      input,
      timeout: 60_000,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "ignore"],
    }).trimEnd();
  } catch {
    return undefined;
  }
}
const lines = (text) => (text ?? "").split("\n").filter(Boolean);
const short = (sha) => sha.slice(0, 10);

let repos = positionals.length ? positionals : (settings.repos ?? []);
if (repos.length === 0 && run("git", ["rev-parse", "--show-toplevel"])) repos = ["."];
if (options["no-gh"] && repos.length === 0) {
  console.error(`inbox-facts: nothing to check (name repos, list them in ${settingsPath}, or drop --no-gh)`);
  process.exit(2);
}

if (!options["no-gh"]) github();
const seen = new Set();
for (const repo of repos) local(resolve(expand(repo)));

process.exitCode = incomplete ? 2 : needsYou > 0 ? 1 : 0;

function github() {
  const viewer = run("gh", ["api", "user", "--jq", ".login"]);
  console.log(`github${viewer ? ` (as ${viewer})` : ""}`);
  if (!viewer) return unknown("couldn't reach GitHub with gh (log in, or pass --no-gh)");

  const authored = search("is:pr is:open author:@me archived:false");
  const requested = search("is:pr is:open review-requested:@me archived:false");
  if (!authored || !requested) return;

  const needs = [];
  const waiting = [];
  const drafts = [];
  for (const pr of requested) needs.push({ rank: 0, verb: "review", pr, why: `by ${pr.author?.login ?? "ghost"}` });
  for (const pr of authored) {
    const reasons = [];
    let rank = Infinity;
    const flag = (level, reason) => {
      reasons.push(reason);
      rank = Math.min(rank, level);
    };
    const awaiting = pr.reviewThreads.nodes.filter(
      (thread) => !thread.isResolved && thread.comments.nodes[0]?.author?.login !== viewer,
    ).length;
    const checks = checkState(pr);
    if (pr.reviewDecision === "CHANGES_REQUESTED") flag(1, "changes requested");
    if (awaiting) flag(1, `${awaiting} ${awaiting === 1 ? "thread awaits" : "threads await"} your reply`);
    if (checks.failed.length) flag(2, `checks failing: ${checks.failed.join(", ")}`);
    if (pr.mergeable === "CONFLICTING") flag(2, "conflicts with its base");

    if (reasons.length && pr.isDraft) reasons.unshift("draft");
    if (reasons.length) needs.push({ rank, verb: rank === 1 ? "reply" : "fix", pr, why: reasons.join(", ") });
    else if (pr.isDraft) drafts.push({ pr, why: `draft, checks ${checks.summary}` });
    else if (pr.reviewDecision === "APPROVED" && checks.pending === 0)
      needs.push({ rank: 3, verb: "merge", pr, why: `approved, checks ${checks.summary}` });
    else {
      const review = pr.reviewDecision ? pr.reviewDecision.toLowerCase().replaceAll("_", " ") : "no review required";
      waiting.push({ pr, why: `${review}, checks ${checks.summary}` });
    }
  }

  needs.sort((a, b) => a.rank - b.rank || Date.parse(a.pr.updatedAt) - Date.parse(b.pr.updatedAt));
  needsYou += needs.length;
  console.log(`  needs you: ${needs.length}`);
  for (const { verb, pr, why } of needs) console.log(`    ${verb.padEnd(6)} ${line(pr, why)}`);
  group("waiting", waiting, "-draft:true");
  group("drafts", drafts, "draft:true");
}

function search(query) {
  const gql = `query($q: String!, $endCursor: String) {
    search(query: $q, type: ISSUE, first: 50, after: $endCursor) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest {
        number title url isDraft reviewDecision mergeable updatedAt
        author { login }
        repository { nameWithOwner }
        reviewThreads(first: 100) { nodes { isResolved comments(last: 1) { nodes { author { login } } } } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes {
          __typename
          ... on CheckRun { name status conclusion startedAt checkSuite { workflowRun { workflow { name } } } }
          ... on StatusContext { context state }
        } } } } } }
      } }
    }
  }`;
  const json = run("gh", ["api", "graphql", "--paginate", "--slurp", "-f", `query=${gql}`, "-f", `q=${query}`]);
  let pages;
  try {
    pages = JSON.parse(json);
  } catch {
    return unknown(`GitHub search failed: ${query}`);
  }
  const total = pages[0]?.data?.search?.issueCount ?? 0;
  const prs = pages.flatMap((page) => page.data?.search?.nodes ?? []).filter((pr) => pr.number);
  if (prs.length < total) console.log(`  (search returned ${prs.length} of ${total} for "${query}"; GitHub stops at 1000)`);
  return prs;
}

function checkState(pr) {
  const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  // A rerun leaves the earlier run in the rollup, so keep only the latest run of each check
  const latest = new Map();
  for (const check of contexts) {
    const name = check.__typename === "CheckRun" ? check.name : check.context;
    if (ignoreChecks.some((pattern) => pattern.test(name))) continue;
    const key = `${check.checkSuite?.workflowRun?.workflow.name ?? ""} ${name}`;
    const previous = latest.get(key);
    if (!previous || Date.parse(check.startedAt ?? 0) >= Date.parse(previous.startedAt ?? 0)) latest.set(key, check);
  }
  const failed = [];
  let pending = 0;
  for (const [key, check] of latest) {
    const result = check.__typename === "CheckRun" ? (check.status === "COMPLETED" ? check.conclusion : check.status) : check.state;
    if (FAILED.includes(result)) failed.push(key.trim());
    else if (PENDING.includes(result)) pending++;
  }
  const summary = latest.size === 0 ? "none" : failed.length ? `${failed.length} failing` : pending ? `${pending} pending` : "green";
  return { failed, pending, summary };
}

function line(pr, why) {
  return `${pr.repository.nameWithOwner}#${pr.number} "${pr.title}": ${why}, updated ${age(pr.updatedAt)}  ${pr.url}`;
}

function group(label, items, filter) {
  console.log(`  ${label}: ${items.length}`);
  // Map.groupBy needs Node 21
  const byRepo = new Map();
  for (const item of items) byRepo.set(item.pr.repository.nameWithOwner, [...(byRepo.get(item.pr.repository.nameWithOwner) ?? []), item]);
  for (const [repo, prs] of byRepo) {
    if (prs.length <= COLLAPSE) {
      for (const { pr, why } of prs) console.log(`    ${line(pr, why)}`);
      continue;
    }
    const oldest = prs.reduce((a, b) => (Date.parse(a.pr.updatedAt) < Date.parse(b.pr.updatedAt) ? a : b));
    const query = encodeURIComponent(`is:pr is:open author:@me ${filter}`);
    console.log(`    ${repo}: ${prs.length} PRs, oldest updated ${age(oldest.pr.updatedAt)}  https://github.com/${repo}/pulls?q=${query}`);
  }
}

function age(timestamp) {
  const hours = Math.floor((Date.now() - Date.parse(timestamp)) / 3_600_000);
  return hours < 1 ? "just now" : hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function local(path) {
  const git = (...args) => run("git", ["-C", path, ...args]);
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  console.log(`\nrepo ${tilde(path)}`);
  if (!common) return unknown("not a git repo");
  if (seen.has(common)) return console.log("  (same repo as above)");
  seen.add(common);

  let clean = 0;
  let worktree;
  const worktrees = [];
  const listed = git("worktree", "list", "--porcelain");
  if (listed === undefined) unknown("git worktree list failed");
  for (const entry of lines(listed)) {
    if (entry.startsWith("worktree ")) worktrees.push((worktree = { path: entry.slice(9) }));
    else if (entry.startsWith("branch refs/heads/")) worktree.branch = entry.slice(18);
    else if (entry === "detached") worktree.detached = true;
    else if (entry === "bare") worktree.bare = true;
    else if (entry.startsWith("prunable")) worktree.prunable = true;
  }
  for (const tree of worktrees.filter((tree) => !tree.bare)) {
    const label = `worktree ${tilde(tree.path)} [${tree.branch ?? "detached"}]`;
    if (tree.prunable) {
      console.log(`  ${label}: missing on disk (prunable)`);
      continue;
    }
    const status = run("git", ["-C", tree.path, "status", "--porcelain"]);
    if (status === undefined) unknown(`${label}: git status failed`);
    else if (status) {
      needsYou++;
      console.log(`  ${label}: ${lines(status).length} uncommitted`);
    } else clean++;
  }

  const remotes = lines(git("remote"));
  const tips = [];
  for (const remote of remotes) {
    // Tracking refs outlive deleted remote branches, so only the heads ls-remote lists right now count
    const heads = git("ls-remote", "--heads", remote);
    if (heads === undefined) unknown(`couldn't reach ${remote}, so unpushed counts may be wrong`);
    else tips.push(...lines(heads).map((head) => head.split("\t")[0]));
  }
  const types = run("git", ["-C", path, "cat-file", "--batch-check=%(objectname) %(objecttype)"], `${tips.join("\n")}\n`);
  if (types === undefined) return unknown("git cat-file failed");
  const known = new Set(lines(types).filter((entry) => entry.endsWith(" commit")).map((entry) => entry.split(" ")[0]));
  const unfetched = new Set(tips).size - known.size;

  const checkedOut = new Set(worktrees.map((tree) => tree.branch).filter(Boolean));
  const refs = lines(git("for-each-ref", "--format=%(refname:short) %(objectname)", "refs/heads"));
  for (const tree of worktrees.filter((tree) => tree.detached && !tree.prunable)) {
    const head = run("git", ["-C", tree.path, "rev-parse", "HEAD"]);
    if (head) refs.push(`(detached in ${tilde(tree.path)}) ${head}`);
  }
  let saved = 0;
  if (remotes.length === 0) console.log("  no remotes: every commit exists only here");
  else {
    const exclude = [...known].map((tip) => `^${tip}`).join("\n");
    for (const ref of refs) {
      const split = ref.lastIndexOf(" ");
      const [name, sha] = [ref.slice(0, split), ref.slice(split + 1)];
      const count = run("git", ["-C", path, "rev-list", "--count", "--stdin"], `${sha}\n${exclude}\n`);
      if (count === undefined) unknown(`${name}: git rev-list failed`);
      else if (count === "0") saved++;
      else {
        needsYou++;
        const where = name.startsWith("(") || checkedOut.has(name) ? "" : ", not checked out";
        console.log(`  branch ${name} at ${short(sha)}: ${count} ${count === "1" ? "commit" : "commits"} on no live remote branch${where}`);
      }
    }
  }
  if (unfetched > 0) console.log(`  (${unfetched} live remote heads aren't fetched and might hold some of these commits)`);

  for (const stash of lines(git("stash", "list", "--format=%gd %cr: %gs"))) console.log(`  ${stash}`);
  const pushed = remotes.length ? `, ${saved} ${saved === 1 ? "branch" : "branches"} with every commit on a remote` : "";
  console.log(`  ${clean} clean ${clean === 1 ? "worktree" : "worktrees"}${pushed}`);
}
