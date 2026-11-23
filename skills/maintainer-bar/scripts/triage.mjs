#!/usr/bin/env node
// What changed on each of your open PRs since its ledger row, so a review can cover only that. Read-only,
// apart from fetching the PR heads and bases (no refs are created for the heads).
//
//   node triage.mjs [<n>...] [--repo <owner/name>]    no numbers: every open PR of yours
//
// For each PR: its head against the reviewed head, the base branch's commits since the review that touch
// the PR's files, a test merge with the base, and comments or reviews by anyone but you and bots since then.
// Scope: full (no row, or the head was rewritten), delta (new commits: review <reviewed>..<head>),
// recheck (same head, but the base touched its files, it conflicts, or someone commented), skip (nothing new).
import { parseArgs } from "node:util";
import { cells, row } from "./ledger.mjs";
import { fail, gh, ghPages, isBot, login, remoteFor, repoName, sh } from "./repo.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { repo: { type: "string" } } });
const repo = repoName(values.repo);
const remote = remoteFor(repo) ?? fail(`no git remote points at ${repo}; add one (git remote add upstream <url>)`);
const me = login();
const git = (...args) => sh("git", args, { allowFail: true });

const open = gh("pr", "list", "--repo", repo, "--author", "@me", "--state", "open", "--limit", "300",
  "--json", "number,title,headRefOid,baseRefName,isDraft,additions,deletions");
const wanted = positionals.length ? positionals.map(Number) : open.map((pr) => pr.number).sort((a, b) => b - a);
if (wanted.some((n) => !Number.isInteger(n) || n <= 0)) fail("usage: triage.mjs [<n>...] [--repo <owner/name>]");
if (wanted.length === 0) {
  console.log(`No open PRs by ${me} in ${repo}.`);
  process.exit(0);
}

const bases = [...new Set(open.filter((pr) => wanted.includes(pr.number)).map((pr) => pr.baseRefName))];
const fetched = git("fetch", "-q", remote, ...bases, ...wanted.filter((n) => open.some((pr) => pr.number === n)).map((n) => `pull/${n}/head`));
if (fetched.status !== 0) fail(`git fetch ${remote} failed: ${fetched.stderr.trim()}`);

for (const n of wanted) {
  const pr = open.find((p) => p.number === n);
  if (!pr) {
    console.log(`#${n}: not one of your open PRs`);
    continue;
  }
  const head = pr.headRefOid;
  const base = `${remote}/${pr.baseRefName}`;
  const ledger = row(n);
  const [, reviewed, verdict, date] = ledger ? cells(ledger.line) : [];

  let state;
  let scope;
  if (!ledger) [state, scope] = ["no ledger row", "full"];
  else if (head.startsWith(reviewed)) state = "same head";
  else if (git("merge-base", "--is-ancestor", reviewed, head).status === 0)
    [state, scope] = [`${git("rev-list", "--count", `${reviewed}..${head}`).stdout.trim()} new commit(s)`, `delta ${reviewed}..${head.slice(0, 10)}`];
  else [state, scope] = ["reviewed head isn't an ancestor (rewritten)", "full"];

  const files = git("diff", "--name-only", `${base}...${head}`).stdout.split("\n").filter(Boolean);
  const touching = date && files.length
    ? git("log", "--format=%h %s", `--since=${date}`, base, "--", ...files).stdout.trim().split("\n").filter(Boolean)
    : [];

  // merge-tree exits 1 on conflicts and prints the tree, then the conflicted paths, then a blank line
  const merge = git("merge-tree", "--write-tree", "--name-only", base, head);
  const conflicts = merge.status === 1 ? merge.stdout.split("\n\n")[0].split("\n").slice(1).filter(Boolean) : [];
  const mergeNote = merge.status > 1 ? `couldn't test (${merge.stderr.trim().split("\n")[0]})` : conflicts.length ? `conflicts in ${conflicts.join(", ")}` : "clean";

  const since = date ? `${date}T00:00:00Z` : "1970-01-01T00:00:00Z";
  const others = (list, at) => list.filter((c) => c.user?.login !== me && !isBot(c.user) && (c[at] ?? "") >= since);
  const talk = [
    ...others(ghPages(`repos/${repo}/issues/${n}/comments?since=${since}&per_page=100`), "created_at"),
    ...others(ghPages(`repos/${repo}/pulls/${n}/comments?since=${since}&per_page=100`), "created_at"),
    ...others(ghPages(`repos/${repo}/pulls/${n}/reviews?per_page=100`), "submitted_at"),
  ];
  const authors = [...new Set(talk.map((c) => c.user.login))];

  scope ??= touching.length || conflicts.length || talk.length ? "recheck" : "skip";
  console.log(`#${n} ${pr.isDraft ? "draft " : ""}+${pr.additions}/-${pr.deletions} base ${pr.baseRefName}: ${pr.title}`);
  console.log(`  ledger: ${ledger ? `${reviewed} ${verdict} ${date}` : "none"}; ${state}; scope ${scope}`);
  if (touching.length) console.log(`  ${pr.baseRefName} since review, on its files: ${touching.join("; ")}`);
  console.log(`  merge with ${pr.baseRefName}: ${mergeNote}`);
  if (talk.length) console.log(`  new comments or reviews: ${talk.length} (${authors.join(", ")})`);
}
