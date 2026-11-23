#!/usr/bin/env node
// Collects what reviewers said on your open PRs in the current GitHub repo that still needs an answer, so
// fixes and replies can be drafted. Read-only on GitHub: gh queries only. Locally it fetches each waiting
// PR's head into refs/pr/<n> and writes the state files. It never posts, resolves, reacts or requests a review.
//
//   node review-threads.mjs [<pr>...] [--author <login>]
//
// Without PR numbers it checks every open PR by --author (default "author" in .agents/review-replies.json,
// else @me). For each PR with something waiting it writes .agents/review-replies/<n>.threads.md,
// regenerated every run, and it removes the file of a checked PR with nothing waiting: unresolved review threads whose last word isn't the PR author's, and reviews and
// top-level comments from others since the author last wrote, each with the diff hunk and the PR's commits
// since. Bots are skipped unless their login is in "reviewBots" in .agents/review-replies.json.
// Exits 0 when nothing is waiting, 1 when something is, 2 when gh or git failed.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { spawnSync } from "node:child_process";

const sh = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 << 20 });
  if (result.status !== 0) {
    console.error(`review-threads: ${command} ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || result.error?.message || "").trim()}`);
    process.exit(2);
  }
  return result.stdout;
};

const root = sh("git", ["rev-parse", "--show-toplevel"]).trim();
const configPath = join(root, ".agents", "review-replies.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: { author: { type: "string", default: config.author ?? "@me" } },
});
const login = (name) => name.replace(/\[bot\]$/, "").toLowerCase();
const reviewBots = new Set((config.reviewBots ?? []).map(login));

const repo = sh("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
const [owner, name] = repo.split("/");
// PR heads live on the base repo, which isn't origin when you work from a fork
const remote =
  sh("git", ["-C", root, "remote", "-v"])
    .split("\n")
    .map((line) => line.split(/\s+/))
    .find(([, url]) => new RegExp(`[/:]${repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\.git)?/?$`, "i").test(url ?? ""))?.[0] ?? "origin";
const dir = join(root, ".agents", "review-replies");

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url headRefName headRefOid isCrossRepository headRepository { nameWithOwner } author { login }
      reviews(last: 100) { nodes { author { login __typename } state body submittedAt url } }
      comments(last: 100) { nodes { author { login __typename } body createdAt url } }
      reviewThreads(last: 100) {
        nodes {
          isResolved isOutdated path line originalLine subjectType
          comments(first: 50) { nodes { author { login __typename } body createdAt url diffHunk } }
        }
      }
      timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT]) {
        nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } ... on Bot { login } } } }
      }
    }
  }
}`;

const numbers =
  positionals.length > 0
    ? positionals.map(Number)
    : JSON.parse(sh("gh", ["pr", "list", "--repo", repo, "--author", opts.author, "--state", "open", "--limit", "200", "--json", "number"])).map((pr) => pr.number);

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, ".gitignore"), "*\n");
const isBot = (author) => !author || ((author.__typename === "Bot" || author.login.endsWith("[bot]")) && !reviewBots.has(login(author.login)));
const list = (log) => {
  const commits = log ? log.split("\n") : [];
  if (commits.length === 0) return " none";
  const shown = [...commits.slice(0, 6), ...(commits.length > 6 ? [`… ${commits.length - 6} more`] : [])];
  return `\n\n${shown.map((commit) => `- ${commit}`).join("\n")}`;
};
const quote = (text) => text.trim().split("\n").map((line) => `> ${line}`.trimEnd()).join("\n");
const day = (iso) => iso.slice(0, 10);
let waiting = 0;

for (const number of numbers) {
  const pr = JSON.parse(sh("gh", ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`])).data.repository.pullRequest;
  const me = pr.author.login;
  const lastAuthor = (thread) => thread.comments.nodes.at(-1)?.author;

  const threads = pr.reviewThreads.nodes.filter((t) => !t.isResolved && lastAuthor(t)?.login !== me && !isBot(lastAuthor(t)));
  const waitingOnReviewer = pr.reviewThreads.nodes.filter((t) => !t.isResolved && lastAuthor(t)?.login === me).length;

  // The author's last written word anywhere on the PR; reviews and comments before it count as answered
  const mine =
    [
      ...pr.comments.nodes.filter((c) => c.author?.login === me).map((c) => c.createdAt),
      ...pr.reviews.nodes.filter((r) => r.author?.login === me && r.body.trim()).map((r) => r.submittedAt),
      ...pr.reviewThreads.nodes.flatMap((t) => t.comments.nodes).filter((c) => c.author?.login === me).map((c) => c.createdAt),
    ]
      .toSorted()
      .at(-1) ?? "";
  // Re-requesting a review hands it back to the reviewer, even with "changes requested" still showing
  const rerequested = (review) =>
    pr.timelineItems.nodes.some((event) => event.requestedReviewer?.login === review.author.login && event.createdAt > review.submittedAt);
  const reviews = pr.reviews.nodes.filter(
    (r) => r.author?.login !== me && !isBot(r.author) && r.submittedAt > mine && (r.body.trim() || r.state === "CHANGES_REQUESTED") && !rerequested(r),
  );
  const comments = pr.comments.nodes.filter((c) => c.author?.login !== me && !isBot(c.author) && c.createdAt > mine);

  const file = join(dir, `${number}.threads.md`);
  if (threads.length + reviews.length + comments.length === 0) {
    rmSync(file, { force: true });
    continue;
  }
  waiting++;

  sh("git", ["-C", root, "fetch", "-q", remote, `+refs/pull/${number}/head:refs/pr/${number}`]);
  const since = (iso, path) => sh("git", ["-C", root, "log", `--since=${iso}`, "--format=%h %s", `refs/pr/${number}`, "--", ...(path ? [path] : [])]).trim();

  const head = pr.isCrossRepository ? `${pr.headRepository?.nameWithOwner ?? "a fork"}:${pr.headRefName}` : pr.headRefName;
  const lines = [
    `# #${number} ${pr.title}`,
    "",
    `${pr.url} · branch \`${head}\` · head ${pr.headRefOid.slice(0, 9)} · fetched to refs/pr/${number}${waitingOnReviewer ? ` · ${waitingOnReviewer} thread(s) waiting on the reviewer` : ""}`,
    "",
  ];

  threads.forEach((thread, i) => {
    const [first, ...rest] = thread.comments.nodes;
    const last = thread.comments.nodes.at(-1);
    const where = thread.subjectType === "FILE" ? `\`${thread.path}\` (the whole file)` : `\`${thread.path}:${thread.line ?? thread.originalLine}\``;
    lines.push(
      `## T${i + 1} ${where}${thread.isOutdated ? " (outdated: the code moved since)" : ""}`,
      "",
      first.url,
      "",
      ...(first.diffHunk.trim() ? ["```diff", ...first.diffHunk.split("\n").slice(-8), "```", ""] : []),
      ...thread.comments.nodes.flatMap((c) => [`**${c.author?.login ?? "ghost"}**, ${day(c.createdAt)}:`, "", quote(c.body), ""]),
      `Commits to this file since ${rest.length ? "the last comment" : "the comment"}:${list(since(last.createdAt, thread.path))}`,
      "",
    );
  });

  for (const review of reviews) {
    lines.push(
      `## Review: ${review.state.toLowerCase().replace("_", " ")} by ${review.author.login}, ${day(review.submittedAt)}`,
      "",
      review.url,
      "",
      review.body.trim() ? quote(review.body) : "(no summary; see its threads above)",
      "",
      `Commits since:${list(since(review.submittedAt))}`,
      "",
    );
  }

  for (const comment of comments) {
    lines.push(`## Comment by ${comment.author.login}, ${day(comment.createdAt)}`, "", comment.url, "", quote(comment.body), "", `Commits since:${list(since(comment.createdAt))}`, "");
  }

  writeFileSync(file, lines.join("\n"));
  console.log(`#${number} ${pr.title}: ${threads.length} thread(s), ${reviews.length} review(s), ${comments.length} comment(s) → ${relative(process.cwd(), file)}`);
}

const who = positionals.length > 0 ? "the PR authors" : opts.author;
console.log(waiting ? `${waiting} of ${numbers.length} PR(s) have something waiting on ${who}.` : `Nothing waiting on ${who} across ${numbers.length} PR(s).`);
process.exit(waiting ? 1 : 0);
