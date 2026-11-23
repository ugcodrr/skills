#!/usr/bin/env node
// What a maintainer changed themselves on other people's PRs before merging them: every non-merge commit
// they authored on a merged PR, with its added and removed lines. It's the strongest evidence for a
// maintainer bar, so read it first when writing or recalibrating one. Read-only: gh queries only.
//
//   node maintainer-edits.mjs --maintainer <login> [--since <YYYY-MM-DD>] [--author <login>] [--repo <owner/name>]
//
// --since defaults to 90 days ago. --author narrows it to one author's PRs (@me for yours); by default it
// covers everyone's but the maintainer's own. GitHub search stops at 1,000 PRs, so narrow --since on a busy
// repo. Each file's patch is cut at 80 changed lines.
import { parseArgs } from "node:util";
import { fail, gh, repoName, sh } from "./repo.mjs";

const { values: opts } = parseArgs({
  options: {
    maintainer: { type: "string" },
    since: { type: "string", default: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10) },
    author: { type: "string" },
    repo: { type: "string" },
  },
});
if (!opts.maintainer) fail("usage: maintainer-edits.mjs --maintainer <login> [--since <YYYY-MM-DD>] [--author <login>] [--repo <owner/name>]");
if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.since)) fail("--since takes a date like 2026-01-31");

const repo = repoName(opts.repo);
const MAX_LINES = 80;
const search = [`repo:${repo}`, "is:pr", "is:merged", `merged:>=${opts.since}`, `-author:${opts.maintainer}`, opts.author && `author:${opts.author}`]
  .filter(Boolean)
  .join(" ");

// gh pr list --json commits asks for every co-author of every commit and trips GraphQL's node limit, so
// this asks only for each commit's git author, which GitHub always lists first
const QUERY = `query($q: String!, $endCursor: String) {
  search(query: $q, type: ISSUE, first: 50, after: $endCursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title author { login }
      commits(first: 100) { nodes { commit { oid messageHeadline parents { totalCount } authors(first: 1) { nodes { user { login } } } } } } } }
  }
}`;
const prs = sh("gh", ["api", "graphql", "--paginate", "-F", `q=${search}`, "-f", `query=${QUERY}`, "--jq", ".data.search.nodes[]"])
  .stdout.split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .sort((a, b) => a.number - b.number);

const lower = opts.maintainer.toLowerCase();
let edited = 0;

for (const pr of prs) {
  // Merges of the base into the branch carry other PRs' changes, not the maintainer's edits
  const theirs = pr.commits.nodes
    .map((node) => node.commit)
    .filter((commit) => commit.parents.totalCount === 1 && commit.authors.nodes[0]?.user?.login?.toLowerCase() === lower);
  if (theirs.length === 0) continue;
  edited++;
  console.log(`## #${pr.number} ${pr.title} (by ${pr.author?.login ?? "a deleted user"})`);

  for (const commit of theirs) {
    console.log(`### ${commit.oid.slice(0, 10)} ${commit.messageHeadline}`);
    for (const file of gh("api", `repos/${repo}/commits/${commit.oid}`).files ?? []) {
      const lines = (file.patch ?? "").split("\n").filter((line) => /^[+-]/.test(line));
      console.log(file.filename);
      for (const line of lines.slice(0, MAX_LINES)) console.log(line);
      if (lines.length > MAX_LINES) console.log(`… ${lines.length - MAX_LINES} more changed lines`);
    }
  }
  console.log();
}

console.log(`${edited} of ${prs.length} PRs merged since ${opts.since}${opts.author ? ` by ${opts.author}` : ""} have commits by ${opts.maintainer}.`);
