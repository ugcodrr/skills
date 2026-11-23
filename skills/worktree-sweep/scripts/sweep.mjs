#!/usr/bin/env node
// Lists this repo's worktrees, local branches and temporary refs whose work is done or safe to drop, in
// groups, with one delete command per group. Read-only: it deletes nothing. A group's command takes only its
// safe items: never a dirty, locked, kept or recently touched worktree, a checked-out branch, or a branch
// with commits no remote has.
//
//   node sweep.mjs                 one line per group, with its command
//   node sweep.mjs --all           every item in every group
//   node sweep.mjs --list <group>  the names the group's command takes, one per line (the commands pipe this)
//
// Run it from any checkout of the repo. Settings in .agents/worktree-sweep.json, all optional:
//   { "recentDays": 3, "keep": ["<regex on a worktree path or branch name>"], "buildOutput": ["<regex on an ignored path>"],
//     "tempRefs": ["refs/<prefix>/"] }
// Exits 0 when nothing can go, 1 when some group's command has something to take, 2 when it couldn't check.
import { execFile, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs, promisify } from "node:util";

const { values: opts } = parseArgs({ options: { all: { type: "boolean", default: false }, list: { type: "string" } } });

const fail = (message) => {
  console.error(`sweep: ${message}`);
  process.exit(2);
};
const run = promisify(execFile);
const lines = (text) => text.split("\n").filter(Boolean);
const sh = (args, { cwd, input, allowFail = false } = {}) => {
  const result = spawnSync("git", cwd ? ["-C", cwd, ...args] : args, { encoding: "utf8", input, maxBuffer: 256 << 20 });
  if (result.error) fail(`git: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) fail(`git ${args.slice(0, 4).join(" ")} failed: ${result.stderr.trim()}`);
  return result;
};
const git = (...args) => sh(args).stdout.trim();
const gitAsync = async (args, cwd) => (await run("git", cwd ? ["-C", cwd, ...args] : args, { maxBuffer: 256 << 20 })).stdout;
const isAncestor = (a, b) => sh(["merge-base", "--is-ancestor", a, b], { allowFail: true }).status === 0;
const short = (sha) => sha?.slice(0, 9) ?? "";
const tilde = (path) => (path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);
// A quoted ~ doesn't expand, so a path that needs quotes stays absolute
const shellPath = (path) => (/^[\w@%+=:,./-]+$/.test(path) ? tilde(path) : `'${path.replaceAll("'", `'\\''`)}'`);

async function mapLimit(items, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

if (sh(["rev-parse", "--show-toplevel"], { allowFail: true }).status !== 0) fail("run it from inside a git checkout of the repo");
const here = resolve(git("rev-parse", "--show-toplevel"));
const mainPath = git("worktree", "list", "--porcelain").match(/^worktree (.+)$/m)[1];
// This checkout's settings, else the main checkout's, where an uncommitted settings file lives
const settingsPath = [here, mainPath].map((dir) => join(dir, ".agents", "worktree-sweep.json")).find((path) => existsSync(path)) ?? "";
const readSettings = () => {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    fail(`can't read ${settingsPath}: ${error.message}`);
  }
};
const settings = settingsPath ? readSettings() : {};
const RECENT_DAYS = settings.recentDays ?? 3;
const keep = (settings.keep ?? []).map((pattern) => new RegExp(pattern));
const extraBuild = (settings.buildOutput ?? []).map((pattern) => new RegExp(pattern));
const tempRefs = settings.tempRefs ?? [];
// Ignored files that are build output or installed dependencies, so they don't count as work
const BUILD_DIRS = new Set([
  "node_modules", "dist", "build", "out", "target", "coverage", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  ".parcel-cache", ".vite", ".output", ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
  ".tox", ".gradle", ".dart_tool", "Pods", "DerivedData", "vendor", "tmp",
]);
const isBuildOutput = (path) =>
  path.split("/").some((part) => BUILD_DIRS.has(part)) || /(^|\/)\.DS_Store$|\.(pyc|tsbuildinfo|log)$|\.egg-info\/?$/.test(path) || extraBuild.some((re) => re.test(path));

// Worktrees, main checkout first
const worktrees = [];
for (const block of git("worktree", "list", "--porcelain").split("\n\n")) {
  const path = block.match(/^worktree (.+)$/m)?.[1];
  if (!path) continue;
  worktrees.push({
    path,
    head: block.match(/^HEAD (\w+)$/m)?.[1],
    branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1],
    locked: /^locked/m.test(block),
    missing: /^prunable/m.test(block),
    bare: /^bare$/m.test(block),
  });
}
const main = worktrees[0];
const checkedOut = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch, w]));

// The remote PRs merge into, and its default branch: gh's view of the repo first, then origin's HEAD
const remotes = lines(git("remote"));
const gh = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"], { encoding: "utf8" });
const view = gh.status === 0 ? JSON.parse(gh.stdout) : undefined;
const urlOf = (name) => sh(["remote", "get-url", name], { allowFail: true }).stdout.trim();
const ghRemote = view && remotes.find((name) => new RegExp(`[:/]${view.nameWithOwner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.git)?/?$`, "i").test(urlOf(name)));
const remote = ghRemote ?? (remotes.includes("origin") ? "origin" : remotes[0]);
const originHead = remote && sh(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`], { allowFail: true }).stdout.trim().replace(`${remote}/`, "");
const defaultBranch =
  (ghRemote && view.defaultBranchRef?.name) || originHead || ["main", "master"].find((name) => sh(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], { allowFail: true }).status === 0);
if (!defaultBranch) fail("can't tell the default branch: set origin's HEAD with `git remote set-head origin --auto`");
const baseRef = [`refs/remotes/${remote}/${defaultBranch}`, `refs/heads/${defaultBranch}`].find((ref) => sh(["rev-parse", "--verify", "--quiet", ref], { allowFail: true }).status === 0);
if (!baseRef) fail(`no ${remote}/${defaultBranch} or local ${defaultBranch} to compare with`);
const base = git("rev-parse", baseRef);
const baseTree = git("rev-parse", `${base}^{tree}`);

// Live branch tips on every remote, so a branch deleted on the remote no longer counts as pushed
const notes = remotes.length ? [] : ["This repo has no remotes, so every commit counts as unpushed."];
const liveHeads = [];
let liveBase;
for (const name of remotes) {
  const result = sh(["ls-remote", "--heads", name], { allowFail: true });
  if (result.status !== 0) {
    notes.push(`Couldn't reach ${name}, so its remote-tracking branches stand in for it (they may be stale).`);
    liveHeads.push(...lines(git("for-each-ref", "--format=%(objectname)", `refs/remotes/${name}`)));
    continue;
  }
  for (const [sha, ref] of lines(result.stdout).map((line) => line.split("\t"))) {
    liveHeads.push(sha);
    if (name === remote && ref === `refs/heads/${defaultBranch}`) liveBase = sha;
  }
}
const present = lines(sh(["cat-file", "--batch-check=%(objectname) %(objecttype)"], { input: `${[...new Set(liveHeads)].join("\n")}\n` }).stdout)
  .filter((line) => line.endsWith(" commit"))
  .map((line) => line.split(" ")[0]);
const missingHeads = new Set(liveHeads).size - present.length;
if (missingHeads > 0) notes.push(`${missingHeads} live remote branches aren't fetched here, so "unpushed" may still be on a remote. git fetch --all, then rerun.`);
if (liveBase && liveBase !== base && !isAncestor(liveBase, base)) notes.push(`${baseRef.replace("refs/remotes/", "")} is behind the remote, so recent merges don't show yet. git fetch ${remote}, then rerun.`);

const unpushedCache = new Map();
const unpushed = (sha) => {
  if (!unpushedCache.has(sha))
    unpushedCache.set(sha, Number(sh(["rev-list", "--count", "--stdin"], { input: [sha, ...present.map((head) => `^${head}`), ""].join("\n") }).stdout.trim()));
  return unpushedCache.get(sha);
};
const hasGh = gh.status === 0;
if (!hasGh) notes.push("gh isn't available here, so a squash-merged branch shows as merged only when merging it into the default branch would change nothing.");

const mergedCache = new Map();
const mergedReason = (sha, branch) => {
  const key = `${sha} ${branch ?? ""}`;
  if (!mergedCache.has(key)) mergedCache.set(key, findMerged(sha, branch));
  return mergedCache.get(key);
};

// One listing for every branch, newest first, instead of a GitHub round trip per branch
let prIndex;
function prsByHead() {
  if (!prIndex) {
    const listed = spawnSync("gh", ["pr", "list", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName,headRefOid,isCrossRepository"], { encoding: "utf8", maxBuffer: 64 << 20 });
    prIndex = new Map();
    for (const pr of JSON.parse(listed.stdout || "[]").filter((pr) => !pr.isCrossRepository)) prIndex.set(pr.headRefName, [...(prIndex.get(pr.headRefName) ?? []), pr]);
  }
  return prIndex;
}

/** Why the work at sha is already in the default branch, or "" when it isn't */
function findMerged(sha, branch) {
  const ahead = Number(git("rev-list", "--count", `${base}..${sha}`));
  if (ahead === 0) return { ahead, reason: `no commits beyond ${defaultBranch}` };
  if (lines(git("cherry", base, sha)).every((line) => line.startsWith("-"))) return { ahead, reason: "every patch is upstream (git cherry)" };
  const merge = sh(["merge-tree", "--write-tree", base, sha], { allowFail: true });
  if (merge.status === 0 && merge.stdout.split("\n")[0] === baseTree) return { ahead, reason: `merging it into ${defaultBranch} changes nothing` };
  if (!branch || !hasGh) return { ahead, reason: "" };
  const prs = prsByHead().get(branch) ?? [];
  for (const pr of prs.filter((pr) => pr.state === "MERGED")) {
    // The PR's final head may not be fetched; fetching it by its PR ref writes only FETCH_HEAD
    if (sh(["cat-file", "-e", `${pr.headRefOid}^{commit}`], { allowFail: true }).status !== 0)
      sh(["fetch", "--quiet", remote, `refs/pull/${pr.number}/head`], { allowFail: true });
    if (isAncestor(sha, pr.headRefOid)) return { ahead, reason: `PR #${pr.number} merged` };
    return { ahead, reason: "", pr: `PR #${pr.number} merged, but the branch has commits after it` };
  }
  return { ahead, reason: "", pr: prs[0] ? `PR #${prs[0].number} ${prs[0].state.toLowerCase()}` : "" };
}

const groups = [];
const self = shellPath(resolve(process.argv[1]));
const repoArg = shellPath(main.path);

// Worktrees: every one but the main checkout and this one
const cutoff = Date.now() - RECENT_DAYS * 86_400_000;
const linked = worktrees.slice(1).filter((w) => !w.bare && resolve(w.path) !== here);
if (!opts.list || opts.list.startsWith("worktrees/")) {
  await mapLimit(linked.filter((w) => !w.missing), 8, async (w) => {
    try {
      // Without --no-optional-locks, status may rewrite the index, whose mtime is the "touched" signal
      const status = lines(await gitAsync(["--no-optional-locks", "status", "--porcelain", "--ignored"], w.path));
      w.changes = status.filter((line) => !line.startsWith("!! ")).length;
      w.ignored = status.filter((line) => line.startsWith("!! ")).map((line) => line.slice(3)).filter((path) => !isBuildOutput(path));
      w.recent = statSync(join((await gitAsync(["rev-parse", "--absolute-git-dir"], w.path)).trim(), "index")).mtimeMs > cutoff;
    } catch (error) {
      w.error = error.message.split("\n")[0];
    }
  });
  for (const w of linked.filter((w) => !w.missing && !w.error)) {
    Object.assign(w, mergedReason(w.head, w.branch));
    w.unpushed = unpushed(w.head);
    // Commits only this checkout's HEAD holds: no branch, tag or remote has them
    w.orphaned = !w.branch && Number(git("rev-list", "--count", w.head, "--not", "--branches", "--tags", "--remotes")) > 0 && w.unpushed > 0;
  }

  const files = (w) =>
    w.error ? `unreadable: ${w.error}` : [`${w.changes} changed`, w.ignored.length ? `${w.ignored.length} ignored (${w.ignored.slice(0, 2).join(", ")})` : ""].filter(Boolean).join(", ");
  const heldBack = (w) => (w.locked ? "locked" : w.recent ? `touched in the last ${RECENT_DAYS} days` : keep.some((re) => re.test(w.path) || re.test(w.branch ?? "")) ? "kept by settings" : "");
  const worktreeItem = (w, removable) => ({
    name: w.path,
    row: [tilde(w.path), w.branch ?? `(detached ${short(w.head)})`, files(w), w.error ? "" : w.unpushed ? `${w.unpushed} unpushed` : "on a remote", w.reason || w.pr || "", heldBack(w)],
    takes: removable && !heldBack(w),
  });
  const isDirty = (w) => Boolean(w.error || w.changes || w.ignored?.length);
  const removeCommand = (id) => `node ${self} --list ${id} | xargs -I{} git -C ${repoArg} worktree remove {}`;
  const worktreeGroups = [
    ["worktrees/merged", "clean, and its work is in the default branch", (w) => !isDirty(w) && w.reason, removeCommand("worktrees/merged")],
    ["worktrees/unmerged", "clean, not merged; its branch or a remote keeps every commit", (w) => !isDirty(w) && !w.reason && !w.orphaned, removeCommand("worktrees/unmerged")],
    ["worktrees/detached", "clean, but its detached HEAD has commits nothing else keeps", (w) => !isDirty(w) && !w.reason && w.orphaned, "none: give HEAD a branch first (git -C <worktree> switch -c <name>)"],
    ["worktrees/dirty", "uncommitted, untracked or ignored files beyond build output, or unreadable", isDirty, "none: it holds work"],
  ];
  const header = ["worktree", "branch", "files", "commits", "why", "held back"];
  for (const [id, title, test, command] of worktreeGroups) {
    const items = linked.filter((w) => !w.missing && test(w)).map((w) => worktreeItem(w, !command.startsWith("none")));
    if (items.length > 0) groups.push({ id, title, kind: "Worktrees", header, items, command });
  }
  const missing = linked.filter((w) => w.missing && !w.locked);
  if (missing.length > 0)
    groups.push({
      id: "worktrees/missing",
      title: "its folder is gone; prune drops the bookkeeping",
      kind: "Worktrees",
      header: ["worktree", "branch"],
      items: missing.map((w) => ({ name: w.path, row: [tilde(w.path), w.branch ?? `(detached ${short(w.head)})`], takes: true })),
      command: `git -C ${repoArg} worktree prune`,
    });
}

// Local branches, but not the default branch
if (!opts.list || opts.list.startsWith("branches/")) {
  const branchGroups = new Map([
    ["branches/merged", { title: "its work is in the default branch", items: [] }],
    ["branches/pushed", { title: "not merged, but a remote has every commit, so only the local name goes", items: [] }],
    ["branches/unpushed", { title: "commits no remote has", items: [] }],
  ]);
  const branches = lines(git("for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads"))
    .map((line) => line.split(" "))
    .filter(([, name]) => name !== defaultBranch);
  for (const [sha, name] of branches) {
    const { reason, pr } = mergedReason(sha, name);
    const count = unpushed(sha);
    const tree = checkedOut.get(name);
    const kept = keep.some((re) => re.test(name));
    const id = reason ? "branches/merged" : count === 0 ? "branches/pushed" : "branches/unpushed";
    const held = tree ? `checked out at ${tilde(tree.path)}` : kept ? "kept by settings" : "";
    branchGroups.get(id).items.push({
      name,
      row: [name, short(sha), count ? `${count} unpushed` : "on a remote", reason || pr || "", held],
      takes: id !== "branches/unpushed" && !held,
    });
  }
  for (const [id, { title, items }] of branchGroups) {
    if (items.length === 0) continue;
    const command = id === "branches/unpushed" ? "none: push it, or keep it" : `node ${self} --list ${id} | xargs git -C ${repoArg} branch -D`;
    groups.push({ id, title, kind: "Branches", header: ["branch", "commit", "commits", "why", "held back"], items, command });
  }
}

// Refs outside the namespaces git and its tools use for live state
if (!opts.list || opts.list.startsWith("refs/")) {
  const LIVE = /^refs\/(heads|remotes|tags|notes|stash|replace|prefetch|bisect|rewritten|worktree)(\/|$)/;
  // Other tools keep live state in their own namespaces (T3 Code's refs/t3, Gerrit's refs/changes), so only
  // refs known to be leftovers get a delete command.
  const TEMP = /^refs\/(pr|backup|fold-backup|original)(\/|$)/;
  const isTemp = (ref) => TEMP.test(ref) || tempRefs.some((prefix) => ref.startsWith(prefix));
  const refGroups = new Map();
  for (const [sha, ref] of lines(git("for-each-ref", "--format=%(objectname) %(refname)")).map((line) => line.split(" "))) {
    if (LIVE.test(ref)) continue;
    const parts = ref.split("/");
    const id = parts.slice(0, parts.length > 3 ? 3 : 2).join("/");
    const only = Number(git("rev-list", "--count", sha, "--not", "--branches", "--remotes", "--tags")) > 0;
    if (!refGroups.has(id)) refGroups.set(id, []);
    refGroups.get(id).push({ name: ref, row: [ref, short(sha), only ? "only copy" : "kept elsewhere too"], takes: isTemp(ref), only });
  }
  for (const [id, items] of refGroups) {
    const only = items.filter((item) => item.only).length;
    const temp = items.every((item) => item.takes);
    groups.push({
      id,
      title: only ? `${only} hold the only copy of a commit` : "every commit is kept elsewhere too",
      kind: temp ? "Temporary refs" : "Other refs",
      header: ["ref", "commit", "commit kept"],
      items,
      command: temp
        ? `node ${self} --list ${id} | xargs -n 1 git -C ${repoArg} update-ref -d`
        : "none: another tool may own these; add the prefix to tempRefs in the settings if you know it's a leftover",
    });
  }
}

if (opts.list) {
  const group = groups.find(({ id }) => id === opts.list);
  if (!group) fail(`no group ${opts.list}; run it without --list to see them`);
  for (const item of group.items.filter((item) => item.takes)) console.log(item.name);
  process.exit(0);
}

console.log(`${tilde(main.path)}, compared with ${baseRef.replace(/^refs\/(remotes|heads)\//, "")} at ${short(base)}. Read-only: nothing here is deleted.`);
for (const note of notes) console.log(note);
console.log("A worktree may belong to another agent thread or session: check the host's thread list before removing one.");

let kind;
let takeable = 0;
for (const group of groups) {
  if (group.kind !== kind) console.log(`\n# ${(kind = group.kind)}`);
  const takes = group.items.filter((item) => item.takes).length;
  const hasCommand = !group.command.startsWith("none");
  if (hasCommand) takeable += takes;
  const held = group.items.length - takes;
  console.log(`\n${group.id} (${group.title}): ${group.items.length}${hasCommand && held ? `, ${held} held back` : ""}`);
  if (opts.all) {
    const rows = [group.header, ...group.items.map((item) => item.row)];
    const widths = group.header.map((_, i) => Math.max(...rows.map((row) => String(row[i] ?? "").length)));
    for (const row of rows) console.log(`  ${row.map((cell, i) => String(cell ?? "").padEnd(widths[i])).join("  ").trimEnd()}`);
  }
  console.log(`  ${hasCommand && takes ? "delete" : "command"}: ${group.command}`);
}
if (groups.length === 0) console.log("\nNothing to sweep.");
process.exit(takeable > 0 ? 1 : 0);
