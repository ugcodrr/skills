#!/usr/bin/env node
// Applies one reviewed PR: fast-forward pushes the reviewed head to the PR's branch (on whichever remote holds
// it, a fork included), replaces the description after saving the old one, and updates the PR's ledger row.
// Without --apply it only prints what it would do: the commits it would push and the description diff.
// It never force-pushes and only touches your own open PRs.
//
//   node pr-apply.mjs <n> [--sha <sha>] [--from <path>] [--draft <file>] [--verdict <v>] [--note <text>] [--apply]
//
//   --sha      push this commit. It must fast-forward the PR's branch
//   --from     fetch --sha from this worktree or clone first, when this checkout doesn't have it
//   --draft    replace the description with this file. The old one is saved to .agents/maintainer-bar/bodies/
//   --verdict  "ready as is", "cleaned up" or "needs you" (default: the ledger row's)
//   --note     the ledger note, at most 250 characters (default: the ledger row's)
//   --apply    do it. Without it, nothing is pushed, edited or written
//   --repo     <owner/name>, when gh can't tell from this checkout
//
// Exits 0 when it applied (or would apply), 1 when it refuses (not your PR, not a fast-forward), 2 on errors.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { ignoreWarning, NOTE_LIMIT, upsert, VERDICTS } from "./ledger.mjs";
import { fail, gh, login, remoteFor, repoName, sh, stateDir } from "./repo.mjs";

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    sha: { type: "string" },
    from: { type: "string" },
    draft: { type: "string" },
    verdict: { type: "string" },
    note: { type: "string" },
    apply: { type: "boolean", default: false },
    repo: { type: "string" },
  },
});

const n = positionals[0];
if (!/^\d+$/.test(n ?? "")) fail("usage: pr-apply.mjs <n> [--sha <sha>] [--from <path>] [--draft <file>] [--verdict <v>] [--note <text>] [--apply]");
if (opts.verdict && !VERDICTS.includes(opts.verdict)) fail(`--verdict is one of: ${VERDICTS.join(", ")}`);
if (opts.note && opts.note.length > NOTE_LIMIT) fail(`the note is ${opts.note.length} characters. Keep it under ${NOTE_LIMIT} and put details in reports/${n}.md`);
if (opts.draft && !existsSync(opts.draft)) fail(`no draft at ${opts.draft}`);
const refuse = (message) => fail(message, 1);

const repo = repoName(opts.repo);
const me = login();
const pr = gh("pr", "view", n, "--repo", repo, "--json", "title,url,state,author,headRefName,headRefOid,headRepository,headRepositoryOwner,body");
if (pr.state !== "OPEN" || pr.author.login !== me)
  refuse(`#${n} is ${pr.state.toLowerCase()} and by ${pr.author.login}. pr-apply only touches your own (${me}) open PRs`);

console.log(`#${n} ${pr.title}${opts.apply ? "" : "  (dry run)"}`);
let head = pr.headRefOid;

if (opts.sha) {
  const headRepo = `${pr.headRepositoryOwner.login}/${pr.headRepository.name}`;
  const remote = remoteFor(headRepo) ?? refuse(`no git remote points at ${headRepo}, where ${pr.headRefName} lives. Add one first`);
  const hasCommit = (ref) => sh("git", ["rev-parse", "--verify", "-q", `${ref}^{commit}`], { allowFail: true }).stdout.trim();

  // A clone that isn't a worktree of this one may only serve its advertised refs, so try HEAD too
  if (opts.from && !hasCommit(opts.sha) && sh("git", ["fetch", "-q", opts.from, opts.sha], { allowFail: true }).status !== 0)
    sh("git", ["fetch", "-q", opts.from, "HEAD"]);
  const sha = hasCommit(opts.sha) || refuse(`${opts.sha} isn't in this checkout. Pass --from <the reviewer's worktree>`);

  const listed = sh("git", ["ls-remote", remote, `refs/heads/${pr.headRefName}`]).stdout.split(/\s/)[0];
  if (!listed) refuse(`${remote} has no branch ${pr.headRefName}`);
  sh("git", ["fetch", "-q", remote, pr.headRefName]);
  const isAncestor = sh("git", ["merge-base", "--is-ancestor", listed, sha], { allowFail: true }).status === 0;

  if (sha === listed) console.log(`push: ${sha.slice(0, 10)} is already the head of ${pr.headRefName}`);
  else if (!isAncestor) refuse(`${sha.slice(0, 10)} doesn't fast-forward ${remote}/${pr.headRefName} (${listed.slice(0, 10)}). Never force-push: redo the commits on the current head`);
  else {
    const commits = sh("git", ["log", "--oneline", `${listed}..${sha}`]).stdout.trimEnd();
    if (opts.apply) sh("git", ["push", "-q", remote, `${sha}:refs/heads/${pr.headRefName}`]);
    console.log(`push${opts.apply ? "" : " (would)"}: ${remote} ${pr.headRefName} ${listed.slice(0, 10)} -> ${sha.slice(0, 10)}`);
    console.log(commits.replace(/^/gm, "  "));
  }
  head = sha;
}

if (opts.draft) {
  const old = (pr.body ?? "").replace(/\r\n/g, "\n").trim();
  const body = readFileSync(opts.draft, "utf8").replace(/\r\n/g, "\n").trim();
  const images = (text) => new Set(text.match(/!\[[^\]]*\]\([^)]+\)|<img\b[^>]*>|https:\/\/\S+\.(?:png|jpe?g|gif|webp)\b|https:\/\/github\.com\/user-attachments\/\S+/gi) ?? []);
  const dropped = [...images(old)].filter((image) => !body.includes(image));

  if (body === old) console.log("description: unchanged");
  else {
    const before = join(tmpdir(), `pr-apply-${n}-before.md`);
    const after = join(tmpdir(), `pr-apply-${n}-after.md`);
    writeFileSync(before, `${old}\n`);
    writeFileSync(after, `${body}\n`);

    let saved = "";
    if (opts.apply) {
      const bodies = join(stateDir(), "bodies");
      mkdirSync(bodies, { recursive: true });
      let backup = join(bodies, `${n}.md`);
      for (let revision = 2; existsSync(backup); revision++) backup = join(bodies, `${n}-r${revision}.md`);
      if (old) {
        writeFileSync(backup, `${old}\n`);
        saved = `, old one saved to ${backup}`;
      }
      sh("gh", ["pr", "edit", n, "--repo", repo, "--body-file", after]);
    }

    console.log(`description${opts.apply ? "" : " (would change)"}: ${old.length} -> ${body.length} characters${saved}`);
    if (dropped.length) console.log(`WARN  the new description drops ${dropped.length} image(s) the old one had: ${dropped.join(" ")}`);
    const diff = sh("git", ["diff", "--no-index", "--no-color", "-U2", before, after], { allowFail: true }).stdout.split("\n").slice(4);
    console.log(diff.slice(0, 80).join("\n") + (diff.length > 80 ? `\n… ${diff.length - 80} more diff lines` : ""));
  }
}

if (!opts.apply) {
  console.log("dry run: nothing pushed, edited or recorded. Rerun with --apply once the user has OK'd it.");
  process.exit(0);
}

console.log(`ledger: ${upsert({ pr: n, head, verdict: opts.verdict, note: opts.note })}`);
const warning = ignoreWarning();
if (warning) console.log(warning);

// Right after a push the new head has no checks yet, and gh exits non-zero when none are reported
const checks = sh("gh", ["pr", "checks", n, "--repo", repo, "--json", "name,bucket"], { allowFail: true });
const list = checks.stdout.trim().startsWith("[") ? JSON.parse(checks.stdout) : [];
const buckets = {};
for (const check of list) (buckets[check.bucket] ??= []).push(check.name);
console.log(
  list.length === 0
    ? "checks: none reported yet"
    : `checks: ${Object.entries(buckets).map(([bucket, names]) => `${names.length} ${bucket}${bucket === "pass" ? "" : ` (${names.join(", ")})`}`).join(", ")}`,
);
console.log(`url: ${pr.url}`);
