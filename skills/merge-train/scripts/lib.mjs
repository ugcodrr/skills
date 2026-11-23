// Shared by merge-train.mjs, stack-up.mjs and restack.mjs: running git and gh, and finding the GitHub repo,
// the remote that points at it, its default branch, the settings file and the state folder.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const script = basename(process.argv[1] ?? "merge-train", ".mjs");

export const fail = (message, code = 2) => {
  console.error(`${script}: ${message}`);
  process.exit(code);
};

export const sh = (command, args, { allowFail = false, ...options } = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 256 << 20, ...options });
  if (result.error) fail(`${command}: ${result.error.message}`);
  if (result.status !== 0 && !allowFail) fail(`${command} ${args.slice(0, 4).join(" ")} failed: ${result.stderr.trim()}`);
  return result;
};

export const shAsync = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });

export const git = (...args) => sh("git", args).stdout.trim();
export const gh = (...args) => JSON.parse(sh("gh", args).stdout);
export const isAncestor = (ancestor, sha) => sh("git", ["merge-base", "--is-ancestor", ancestor, sha], { allowFail: true }).status === 0;
export const short = (sha) => sha.slice(0, 9);
// Map.groupBy needs Node 21
export const groupBy = (items, key) => {
  const groups = new Map();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
};
export const login = () => sh("gh", ["api", "user", "--jq", ".login"]).stdout.trim();

export function repoContext() {
  const top = sh("git", ["rev-parse", "--show-toplevel"], { allowFail: true });
  if (top.status !== 0) fail("run it from inside a git checkout of the repo");
  const root = top.stdout.trim();
  // The first worktree is the main checkout, so every worktree of the repo shares one state folder
  const mainCheckout = git("worktree", "list", "--porcelain").match(/^worktree (.+)$/m)[1];
  // This checkout's settings, else the main checkout's, where an uncommitted settings file lives
  const settingsPath = [root, mainCheckout].map((dir) => join(dir, ".agents", "merge-train.json")).find((path) => existsSync(path));
  let settings = {};
  try {
    if (settingsPath) settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (error) {
    fail(`can't read ${settingsPath}: ${error.message}`);
  }

  const view = gh("repo", "view", "--json", "nameWithOwner,defaultBranchRef");
  const repo = view.nameWithOwner;
  const escaped = repo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const urlMatches = new RegExp(`[:/]${escaped}(\\.git)?/?$`, "i");
  const remotes = git("remote", "-v")
    .split("\n")
    .filter((line) => line.endsWith("(fetch)"))
    .map((line) => line.split(/\s+/));
  const remote = remotes.find(([, url]) => urlMatches.test(url))?.[0] ?? remotes.find(([name]) => name === "origin")?.[0];
  if (!remote) fail(`no git remote points at ${repo}`);

  return { root, repo, remote, defaultBranch: view.defaultBranchRef.name, settings, stateDir: join(mainCheckout, ".agents", "merge-train") };
}

// A .gitignore of `*` keeps the state folder out of git without touching the project's own .gitignore
export function ensureStateDir(dir) {
  mkdirSync(dir, { recursive: true });
  const ignore = join(dir, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
}

export const readState = (dir) => {
  const path = join(dir, "state.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
};

export const remoteHeads = (remote) =>
  new Map(
    git("ls-remote", "--heads", remote)
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ref] = line.split("\t");
        return [ref.slice("refs/heads/".length), sha];
      }),
  );
