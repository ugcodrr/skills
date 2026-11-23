#!/usr/bin/env node
// Lists the open PRs that touch the given paths, so a finding or a fix doesn't duplicate work in flight.
// A path ending in "/" matches everything under that folder. Read-only.
//
//   node open-prs-touching.mjs <path>... [--repo owner/name] [--json]
//
//   --repo  default: the GitHub repo of the current checkout (gh repo view)
//   --json  print [{ path, prs: [{ number, author, branch, head, draft, title }] }]
//
// gh pr list returns at most 100 files per PR, so a PR at that cap is paged through the REST API,
// which itself stops at 3,000 files. Exits 0 when no open PR touches any path, 1 when one does, and 2
// when it couldn't check every open PR (gh failed, too many PRs, or a file list it couldn't complete).
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const PR_LIMIT = 1000;
const GRAPHQL_FILE_CAP = 100;
const REST_FILE_CAP = 3000;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { repo: { type: "string" }, json: { type: "boolean", default: false } },
});

const stop = (message) => {
  console.error(`open-prs-touching: ${message}`);
  process.exit(2);
};

if (positionals.length === 0) stop("usage: open-prs-touching.mjs <path>... [--repo owner/name] [--json]");
const paths = positionals.map((path) => path.replace(/^\.\//, ""));

const gh = (args) => {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    throw new Error((error.stderr || error.message).trim().split("\n")[0]);
  }
};

let repo = opts.repo;
let prs;
try {
  repo ??= gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
  prs = JSON.parse(gh(["pr", "list", "--repo", repo, "--state", "open", "--limit", String(PR_LIMIT), "--json", "number,title,author,headRefName,headRefOid,isDraft,files"]));
} catch (error) {
  stop(`gh failed: ${error.message}`);
}

const incomplete = [];
if (prs.length >= PR_LIMIT) incomplete.push(`${repo} has ${PR_LIMIT}+ open PRs; only the newest ${PR_LIMIT} were checked`);

for (const pr of prs) {
  pr.filenames = pr.files.map((file) => file.path);
  if (pr.filenames.length < GRAPHQL_FILE_CAP) continue;
  try {
    pr.filenames = gh(["api", "--paginate", `repos/${repo}/pulls/${pr.number}/files?per_page=100`, "--jq", ".[].filename"]).split("\n").filter(Boolean);
    if (pr.filenames.length >= REST_FILE_CAP) incomplete.push(`#${pr.number} has ${REST_FILE_CAP}+ files, past the API's limit`);
  } catch (error) {
    incomplete.push(`#${pr.number}'s file list couldn't be paged (${error.message})`);
  }
}

const matches = (file, path) => (path.endsWith("/") ? file.startsWith(path) : file === path);
const result = paths.map((path) => ({
  path,
  prs: prs
    .filter((pr) => pr.filenames.some((file) => matches(file, path)))
    .map((pr) => ({ number: pr.number, author: pr.author.login, branch: pr.headRefName, head: pr.headRefOid, draft: pr.isDraft, title: pr.title })),
}));

if (opts.json) console.log(JSON.stringify(result, null, 2));
else {
  for (const { path, prs: hits } of result) {
    console.log(hits.length === 0 ? `${path}: no open PR` : `${path}:`);
    for (const pr of hits) console.log(`  #${pr.number} ${pr.author} ${pr.branch} ${pr.head.slice(0, 10)}${pr.draft ? " (draft)" : ""}  ${pr.title}`);
  }
}

for (const line of incomplete) console.error(`incomplete: ${line}`);
process.exit(incomplete.length > 0 ? 2 : result.some(({ prs: hits }) => hits.length > 0) ? 1 : 0);
