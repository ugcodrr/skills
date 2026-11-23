// Shared by the other scripts here, not run directly: running git and gh, which GitHub repo this checkout
// belongs to, the remote that points at a repo, and where the ledger and drafts live.
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";

export function fail(message, code = 2) {
  console.error(`${basename(process.argv[1], ".mjs")}: ${message}`);
  process.exit(code);
}

export function sh(command, args, { allowFail = false, input } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 << 20, input });
  if (result.error) fail(`can't run ${command}: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) fail(`${command} ${args.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`);
  return result;
}

export const git = (...args) => sh("git", args).stdout.trim();
export const gh = (...args) => JSON.parse(sh("gh", args).stdout || "null");

// gh api --paginate prints one page after another; --jq '.[]' turns them into one object per line
export function ghPages(path) {
  return sh("gh", ["api", "--paginate", path, "--jq", ".[]"]).stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

export function repoName(override) {
  if (override) return override;
  const viewed = sh("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { allowFail: true });
  if (viewed.status === 0 && viewed.stdout.trim()) return viewed.stdout.trim();
  const origin = sh("git", ["remote", "get-url", "origin"], { allowFail: true }).stdout.trim();
  return slug(origin) ?? fail("can't tell which GitHub repo this is; pass --repo <owner/name>");
}

export const login = () => sh("gh", ["api", "user", "-q", ".login"]).stdout.trim();

export function remoteFor(nameWithOwner) {
  // A partial clone adds " [blob:none]" after "(fetch)"
  const lines = sh("git", ["remote", "-v"]).stdout.split("\n").filter((line) => line.includes(" (fetch)"));
  const match = lines.map((line) => line.split(/\s+/)).find(([, url]) => slug(url)?.toLowerCase() === nameWithOwner.toLowerCase());
  return match?.[0];
}

// The main checkout's .agents/maintainer-bar, so linked worktrees share one ledger
export function stateDir() {
  const common = git("rev-parse", "--path-format=absolute", "--git-common-dir");
  const root = basename(common) === ".git" ? dirname(common) : git("rev-parse", "--show-toplevel");
  return join(root, ".agents", "maintainer-bar");
}

export const isBot = (user) => user?.type === "Bot" || /\[bot\]$/.test(user?.login ?? "");

function slug(url) {
  return url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
}
