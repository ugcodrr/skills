#!/usr/bin/env node
// Works out what can merge next among this repo's open PRs, and in what order. It never pushes, comments,
// merges or deletes anything: it fetches each PR head into refs/pr/<n> and test-merges with `git merge-tree`,
// which writes objects but no branches.
//
//   node merge-train.mjs [--author <login>|@me|any] [--bots]   write .agents/merge-train/plan.md and state.json
//   node merge-train.mjs --only <n>... [--author ...]           two lines per named PR; writes no plan or state
//   node merge-train.mjs --check                                is plan.md still current? Writes nothing
//
//   --author  whose PRs to plan: "author" in .agents/merge-train.json, else @me; any means everyone's
//   --bots    keep bot PRs (gh's is_bot, [bot] and app/ logins, and "botAuthors" in the settings)
//
// state.json records each PR's head, base and stack parent. restack.mjs reads it after a parent squash-merges,
// because GitHub then retargets the child to the default branch. cache.json keeps merge-tree and diff results
// by commit, so a rerun only tests what moved. Notes in .agents/merge-train/notes.md are quoted in plan.md.
// Exits 0, or 1 when --check finds the plan stale, or 2 when it couldn't check.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { parseArgs } from "node:util";
import { ensureStateDir, fail, gh, git, readState, remoteHeads, repoContext, sh, shAsync, short } from "./lib.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    author: { type: "string" },
    bots: { type: "boolean", default: false },
    only: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
  },
});

const only = new Set(positionals.map((n) => Number(n.replace(/^#/, ""))));
if (opts.only && (only.size === 0 || [...only].some((n) => !Number.isInteger(n) || n <= 0))) fail("--only takes PR numbers: merge-train.mjs --only 12 15");
if (!opts.only && positionals.length > 0) fail(`unexpected arguments: ${positionals.join(" ")} (did you mean --only?)`);

const { repo, remote, defaultBranch, settings, stateDir } = repoContext();

// A pair whose only conflict is a lockfile is fixed by regenerating it, so it's counted, not listed
const LOCKFILES = new Set(
  settings.lockfiles ?? [
    "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb", "deno.lock",
    "Cargo.lock", "go.sum", "go.work.sum", "poetry.lock", "uv.lock", "pdm.lock", "Pipfile.lock", "Gemfile.lock",
    "composer.lock", "mix.lock", "pubspec.lock", "Package.resolved", "Podfile.lock", "packages.lock.json",
    "gradle.lockfile", "flake.lock",
  ],
);
const isLockfile = (file) => LOCKFILES.has(posix.basename(file));
const botAuthors = new Set(settings.botAuthors ?? []);
const isBot = (pr) => pr.author.is_bot || /\[bot\]$|^app\//.test(pr.author.login) || botAuthors.has(pr.author.login);
const CONCURRENCY = 8;
const LIMIT = "500";

const listOpen = (author, fields) =>
  gh("pr", "list", "--repo", repo, "--state", "open", "--limit", LIMIT, ...(author === "any" ? [] : ["--author", author]), "--json", fields);

/** Runs fn over items, CONCURRENCY at a time, and keeps the results in order */
const pool = async (items, fn) => {
  const results = Array.from({ length: items.length });
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
};

if (opts.check) {
  const state = readState(stateDir);
  if (!state) fail("no state.json yet: run merge-train.mjs first");
  const heads = remoteHeads(remote);
  const live = new Map(
    listOpen(state.author, "number,headRefOid,baseRefName,author")
      .filter((pr) => state.bots || !isBot(pr))
      .map((pr) => [String(pr.number), pr]),
  );

  const movedTrunks = Object.entries(state.trunks).filter(([name, sha]) => heads.get(name) !== sha);
  const moved = [];
  for (const [number, recorded] of Object.entries(state.prs)) {
    const now = live.get(number);
    if (!now) continue;
    const changes = [];
    if (now.headRefOid !== recorded.head) changes.push(`head ${short(recorded.head)} -> ${short(now.headRefOid)}`);
    if (now.baseRefName !== recorded.base) changes.push(`base ${recorded.base} -> ${now.baseRefName}`);
    if (changes.length > 0) moved.push({ number, changes });
  }
  const closed = Object.keys(state.prs).filter((number) => !live.has(number));
  const added = [...live.keys()].filter((number) => !state.prs[number]);

  // A moved, closed or retargeted PR, or anything stacked above one, makes its recorded pairs stale
  const changed = new Set([...moved.map(({ number }) => number), ...closed]);
  for (let size = -1; size !== changed.size; ) {
    size = changed.size;
    for (const [number, recorded] of Object.entries(state.prs)) if (changed.has(String(recorded.parent))) changed.add(number);
  }
  const stalePairs = state.pairs.filter(([a, b]) => changed.has(String(a)) || changed.has(String(b))).length;

  console.log(`state.json from ${state.generatedAt}, ${state.author === "any" ? "every author" : `PRs by ${state.author}`}${state.bots ? "" : ", bots left out"}`);
  console.log(
    movedTrunks.length === 0
      ? `Base branches unchanged (${Object.keys(state.trunks).join(", ")})`
      : `Moved: ${movedTrunks.map(([name, sha]) => `${name} ${short(sha)} -> ${heads.has(name) ? short(heads.get(name)) : "deleted"}`).join(", ")}, so their base-conflict rows are stale`,
  );
  console.log(`\nMoved PRs (${moved.length}):${moved.map(({ number, changes }) => `\n  #${number} ${changes.join(", ")}`).join("")}`);
  console.log(`New PRs (${added.length}): ${added.map((n) => `#${n}`).join(" ")}`);
  console.log(`Closed or merged (${closed.length}): ${closed.map((n) => `#${n}`).join(" ")}`);
  console.log(`\n${stalePairs} of the plan's ${state.pairs.length} conflicting pairs involve a moved or closed PR or one stacked on it.`);
  const fresh = movedTrunks.length === 0 && moved.length === 0 && added.length === 0 && closed.length === 0;
  console.log(fresh ? "Fresh: plan.md matches the live PRs." : "Stale: rerun merge-train.mjs before acting on plan.md.");
  process.exit(fresh ? 0 : 1);
}

ensureStateDir(stateDir);
const author = opts.author ?? settings.author ?? "@me";
const fields = "number,title,author,headRefName,baseRefName,headRefOid,isDraft,isCrossRepository,statusCheckRollup";
const prs = listOpen(author, fields)
  .filter((pr) => opts.bots || !isBot(pr))
  .toSorted((a, b) => a.number - b.number);

// Stacks can sit on PRs outside the author filter, so read every open PR's branch
const everyOpen = author === "any" ? prs : listOpen("any", "number,headRefName,baseRefName,isCrossRepository");
const prByHead = new Map(everyOpen.filter((pr) => !pr.isCrossRepository).map((pr) => [pr.headRefName, pr.number]));
const scope = new Map(prs.map((pr) => [pr.number, pr]));
const baseOf = new Map([...everyOpen.map((pr) => [pr.number, pr.baseRefName]), ...prs.map((pr) => [pr.number, pr.baseRefName])]);
const parentOf = (number) => prByHead.get(baseOf.get(number));
const ancestors = (number) => {
  const chain = [];
  for (let p = parentOf(number); p && !chain.includes(p); p = parentOf(p)) chain.push(p);
  return chain;
};
// The branch a PR, or the bottom of its stack, merges into
const trunkOf = (number) => baseOf.get(ancestors(number).at(-1) ?? number);

const heads = remoteHeads(remote);
const trunks = [...new Set([defaultBranch, ...prs.map((pr) => trunkOf(pr.number))])].filter((name) => heads.has(name));
sh("git", [
  "fetch", "--quiet", remote,
  ...trunks.map((name) => `+refs/heads/${name}:refs/remotes/${remote}/${name}`),
  ...prs.map((pr) => `+refs/pull/${pr.number}/head:refs/pr/${pr.number}`),
]);
const trunkTip = new Map(trunks.map((name) => [name, git("rev-parse", `refs/remotes/${remote}/${name}`)]));

// GitHub can stop moving a PR's head after a push, so compare it with the branch
const stuck = prs.filter((pr) => !pr.isCrossRepository && heads.has(pr.headRefName) && heads.get(pr.headRefName) !== pr.headRefOid);

// Keyed by commit SHAs, so an entry never goes stale; a full run drops the ones it didn't use
const CACHE = join(stateDir, "cache.json");
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const used = {};
const cached = async (key, compute) => {
  used[key] = cache[key] ?? (await compute());
  return used[key];
};

/** Conflicted file names, or [] when the two commits merge cleanly */
const conflicts = (a, b) =>
  cached(`merge:${a}:${b}`, async () => {
    const result = await shAsync("git", ["merge-tree", "--write-tree", "--name-only", "--no-messages", a, b]);
    if (result.status === 0) return [];
    if (result.status !== 1) return [`(merge-tree failed: ${result.stderr.trim().split("\n")[0]})`];
    return result.stdout.trim().split("\n").slice(1).filter(Boolean);
  });

// GitHub lists a renamed file under its new path only, which misses a rename against an edit or
// delete of the old path, so take both paths from git
const changedFiles = (base, head) =>
  cached(`diff:${base}:${head}`, async () => (await shAsync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`])).stdout.split("\n").filter(Boolean));

const behind = (base, head) => cached(`behind:${base}:${head}`, async () => Number((await shAsync("git", ["rev-list", "--count", `${head}..${base}`])).stdout.trim()));

const perPr = await pool(prs, async (pr) => {
  const trunk = trunkOf(pr.number);
  const tip = trunkTip.get(trunk);
  if (!tip) return { trunk, gone: true, trunkConflicts: [], behind: 0, files: await changedFiles(trunkTip.get(defaultBranch), pr.headRefOid) };
  return { trunk, trunkConflicts: await conflicts(tip, pr.headRefOid), behind: await behind(tip, pr.headRefOid), files: await changedFiles(tip, pr.headRefOid) };
});

const info = new Map();
for (const [index, pr] of prs.entries()) {
  const name = (check) => check.name ?? check.context;
  // A superseded run (canceled when a newer push started one) stays in the rollup; judge each check by its latest run
  const when = (check) => check.startedAt ?? check.completedAt ?? "";
  const latest = new Map();
  for (const check of pr.statusCheckRollup ?? []) {
    const key = `${check.workflowName ?? ""}/${name(check)}`;
    if (!latest.has(key) || when(check) > when(latest.get(key))) latest.set(key, check);
  }
  const checks = [...latest.values()];
  const failing = checks.filter((c) => ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"].includes(c.conclusion ?? c.state)).map(name);
  const pending = checks.filter((c) => (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED").map(name);
  info.set(pr.number, { pr, parent: parentOf(pr.number), ...perPr[index], failing, pending });
}

// Pairwise: only PRs that share a file and merge into the same branch can conflict
const byFile = new Map();
for (const pr of prs) for (const file of info.get(pr.number).files) byFile.set(file, [...(byFile.get(file) ?? []), pr]);
const related = (a, b) => ancestors(a.number).includes(b.number) || ancestors(b.number).includes(a.number);
const pairs = new Map();
for (const group of byFile.values()) {
  for (const [i, a] of group.entries()) {
    for (const b of group.slice(i + 1)) {
      if (related(a, b) || info.get(a.number).trunk !== info.get(b.number).trunk) continue;
      if (opts.only && !only.has(a.number) && !only.has(b.number)) continue;
      pairs.set(`${a.number}:${b.number}`, [a, b]);
    }
  }
}

const untested = [...pairs.values()].filter(([a, b]) => !cache[`merge:${a.headRefOid}:${b.headRefOid}`]).length;
console.error(`merge-train: ${prs.length} PRs, ${pairs.size} pairs share a file; test-merging ${untested} new to the cache`);
const pairResults = await pool([...pairs.values()], async ([a, b]) => {
  // A file that already conflicts with the base branch is a rebase problem, not a pair problem
  const own = new Set([...info.get(a.number).trunkConflicts, ...info.get(b.number).trunkConflicts]);
  const files = (await conflicts(a.headRefOid, b.headRefOid)).filter((file) => !own.has(file));
  return { a: a.number, b: b.number, files, lockfileOnly: files.every(isLockfile) };
});
const pairConflicts = pairResults.filter(({ files }) => files.length > 0);
const realConflicts = pairConflicts.filter(({ lockfileOnly }) => !lockfileOnly);

const countBy = (list) => {
  const counts = new Map();
  for (const { a, b } of list) for (const n of [a, b]) counts.set(n, (counts.get(n) ?? 0) + 1);
  return counts;
};
const conflictCount = countBy(realConflicts);
const lockfileCount = countBy(pairConflicts.filter(({ lockfileOnly }) => lockfileOnly));

writeFileSync(CACHE, JSON.stringify(opts.only ? { ...cache, ...used } : used));

const title = (n) => `#${n} ${scope.get(n)?.title ?? ""}`.trimEnd();
const lockfileNote = (n) => (lockfileCount.has(n) ? `, plus lockfile-only conflicts with ${lockfileCount.get(n)}` : "");

if (opts.only) {
  for (const n of [...only].toSorted((a, b) => a - b)) {
    const i = info.get(n);
    if (!i) {
      console.log(`#${n}: not an open PR${author === "any" ? "" : ` by ${author} (pass --author any)`}`);
      continue;
    }
    // Stacked PRs share their conflicts, so group partners by the files they conflict in
    const byFiles = new Map();
    for (const { a, b, files } of realConflicts.filter(({ a, b }) => a === n || b === n)) {
      const key = files.join(", ");
      byFiles.set(key, [...(byFiles.get(key) ?? []), `#${a === n ? b : a}`]);
    }
    const partners = [...byFiles].map(([files, numbers]) => `${numbers.join(" ")} (${files})`);
    const state = [
      i.pr.isDraft && "draft",
      i.parent && `stacked on #${i.parent}`,
      i.gone ? `its base ${i.trunk} no longer exists` : i.trunkConflicts.length ? `conflicts with ${i.trunk} in ${i.trunkConflicts.join(", ")}` : `merges into ${i.trunk} (${i.behind} behind)`,
      i.failing.length && `failing: ${i.failing.join(", ")}`,
      i.pending.length && `running: ${i.pending.join(", ")}`,
    ].filter(Boolean).join("; ");
    console.log(`${title(n)}: ${state}`);
    console.log(`  ${partners.length ? `conflicts with ${partners.join("; ")}` : "no conflicts with other open PRs"}${lockfileNote(n)}`);
  }
  process.exit(0);
}

const all = [...info.values()];
const ready = all.filter((i) => !i.pr.isDraft && !i.parent && !i.gone && i.trunkConflicts.length === 0 && i.failing.length === 0);
const into = (i) => (i.trunk === defaultBranch ? "" : ` (into ${i.trunk})`);
const lines = [
  `# Merge train for ${repo}, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
  "",
  `${defaultBranch} ${short(trunkTip.get(defaultBranch) ?? heads.get(defaultBranch) ?? "")}. ${prs.length} open PRs${author === "any" ? "" : ` by ${author}`}${opts.bots ? "" : " (bots left out)"}; ${pairs.size} pairs share a file, ${realConflicts.length} of them conflict, and ${pairConflicts.length - realConflicts.length} more only in lockfiles.`,
  "",
  "## Ready, no conflicts with anything open",
  "",
  ...(lockfileCount.size ? ["Whichever of a lockfile-only pair merges second regenerates the lockfile.", ""] : []),
  ...ready.filter((i) => !conflictCount.has(i.pr.number)).map((i) => `- ${title(i.pr.number)}${into(i)}${lockfileNote(i.pr.number)}${i.pending.length ? ` (checks running: ${i.pending.join(", ")})` : ""}`),
  "",
  "## Ready, but conflicts with another open PR",
  "",
  "Whichever merges second needs the conflict fixed (see the pairs below).",
  "",
  ...ready
    .filter((i) => conflictCount.has(i.pr.number))
    .toSorted((a, b) => conflictCount.get(a.pr.number) - conflictCount.get(b.pr.number))
    .map((i) => `- ${title(i.pr.number)}${into(i)}: ${conflictCount.get(i.pr.number)} conflicting PR(s)${lockfileNote(i.pr.number)}`),
  "",
  "## Stacks (merge the parent first, then restack the child)",
  "",
  ...all
    .filter((i) => i.parent)
    .map((i) => {
      const chain = [...ancestors(i.pr.number).toReversed(), i.pr.number].map((n) => `#${n}`).join(" -> ");
      const parentHead = scope.get(i.parent)?.headRefOid ?? heads.get(baseOf.get(i.pr.number));
      const trunkNote = i.trunkConflicts.length ? `; with its parent it conflicts with ${i.trunk} in ${i.trunkConflicts.join(", ")}` : "";
      return `- ${chain}: ${i.pr.title}. Parent tip ${parentHead ? short(parentHead) : "unknown"}${trunkNote}`;
    }),
  ...all.filter((i) => i.gone).map((i) => `- ${title(i.pr.number)}: based on ${i.pr.baseRefName}, which no longer exists (merged? then retarget it)`),
  "",
  "## Conflicts with its base branch (merge the base in, or rebase, first)",
  "",
  ...all.filter((i) => i.trunkConflicts.length && !i.parent).map((i) => `- ${title(i.pr.number)}: ${i.trunkConflicts.join(", ")} (${i.behind} commits behind ${i.trunk})`),
  "",
  "## PR heads behind their branch (push a new commit, even an empty one, so GitHub catches up)",
  "",
  "The rest of this plan tests the PR heads, which is what a merge would take.",
  "",
  ...stuck.map((pr) => `- ${title(pr.number)}: the PR is at ${short(pr.headRefOid)}, ${pr.headRefName} at ${short(heads.get(pr.headRefName))}`),
  "",
  "## Failing checks",
  "",
  ...all.filter((i) => i.failing.length).map((i) => `- ${title(i.pr.number)}: ${i.failing.join(", ")}`),
  "",
  "## Drafts",
  "",
  ...all.filter((i) => i.pr.isDraft).map((i) => `- ${title(i.pr.number)}`),
  "",
  "## Conflicting pairs",
  "",
  "| PRs | Files |",
  "|---|---|",
  ...realConflicts.map(({ a, b, files }) => `| #${a} and #${b} | ${files.join(", ")} |`),
  "",
];

const notes = join(stateDir, "notes.md");
if (existsSync(notes)) lines.push("## Notes (.agents/merge-train/notes.md)", "", readFileSync(notes, "utf8").trim(), "");

writeFileSync(join(stateDir, "plan.md"), lines.join("\n"));
writeFileSync(
  join(stateDir, "state.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      repo,
      remote,
      defaultBranch,
      author,
      bots: opts.bots,
      trunks: Object.fromEntries(trunkTip),
      prs: Object.fromEntries(prs.map((pr) => [pr.number, { head: pr.headRefOid, headRefName: pr.headRefName, base: pr.baseRefName, parent: info.get(pr.number).parent ?? null }])),
      pairs: realConflicts.map(({ a, b }) => [a, b]),
    },
    null,
    1,
  ),
);

// The plan can run to hundreds of lines, so print its counts and leave the detail in the file
const sections = [];
for (const line of lines) {
  if (line.startsWith("## ")) sections.push([line.slice(3), 0]);
  else if (sections.length && /^(- |\| #)/.test(line)) sections.at(-1)[1]++;
}
console.log(lines[2]);
for (const [name, count] of sections) if (count && !name.startsWith("Notes")) console.log(`${name}: ${count}`);
console.log(`Full plan: ${join(stateDir, "plan.md")}`);
