#!/usr/bin/env node
// Flags what a script can catch in a branch's diff before hand-back, so the review can spend its
// attention on the judgment calls. Read-only: it never edits files.
//
//   node check-diff.mjs                               working tree against the base it picks
//   node check-diff.mjs --base origin/main            against a specific ref
//   node check-diff.mjs --base <sha>^ --head <sha>    one commit, or another branch, without the working tree
//
// The base defaults to the ref the current branch was created from (its reflog), else the branch with the
// nearest merge-base. Without --head, uncommitted and untracked files count.
//
// Settings come from .agents/self-review.json in the repo, over ~/.agents/self-review.json; see
// references/self-review.example.json. Every key is optional.
//
// Prints `LEVEL  file:line  message`. ERROR = a rule is broken, WARN = needs judgment.
// Exits 1 on any ERROR, 0 otherwise, 2 when it couldn't check.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: options } = parseArgs({ options: { base: { type: "string" }, head: { type: "string" } } });

const git = (...args) =>
  execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    stdio: ["pipe", "pipe", "ignore"],
  });
const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return undefined;
  }
};
const stop = (message) => {
  console.error(`check-diff: ${message}`);
  process.exit(2);
};

const root = tryGit("rev-parse", "--show-toplevel")?.trim();
if (!root) stop("not inside a git repository.");
process.chdir(root);

const KNOWN_KEYS = ["verify", "protected", "licenseHeader", "deny", "americanSpelling", "commentBlockLines"];
const SETTINGS = ".agents/self-review.json";
const configFiles = [join(homedir(), SETTINGS), SETTINGS].filter((path) => existsSync(path));
const config = Object.assign({}, ...configFiles.map(readConfig));
const commentLimit = config.commentBlockLines ?? 2;
const licenseHeader = config.licenseHeader && settingRegExp(config.licenseHeader.pattern, "licenseHeader.pattern", "m");

const LOCKFILES = [
  [/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/, "js"],
  [/(^|\/)composer\.lock$/, "php"],
  [/(^|\/)(poetry\.lock|uv\.lock|Pipfile\.lock|pdm\.lock)$/, "python"],
  [/(^|\/)Cargo\.lock$/, "rust"],
  [/(^|\/)go\.sum$/, "go"],
  [/(^|\/)Gemfile\.lock$/, "ruby"],
];
const COMMENT_STYLES = [
  [/\.(m|c)?[jt]sx?$|\.(go|rs|java|kts?|scala|swift|c|h|cc|cpp|hpp|cs|php|dart|css|scss|less|groovy|zig|vue|svelte)$/, "slash"],
  [/\.(py|rb|sh|bash|zsh|fish|pl|r|ya?ml|toml|exs?|tf|ps1)$|(^|\/)(Dockerfile|Makefile)$/i, "hash"],
  [/\.(sql|lua|hs|elm)$/, "dash"],
];

const findings = [];
const report = (level, where, message) => findings.push({ level, where, message });

for (const key of Object.keys(config).filter((key) => !KNOWN_KEYS.includes(key)))
  report("WARN", configFiles.at(-1), `unknown setting "${key}" (known: ${KNOWN_KEYS.join(", ")})`);

// ---------------------------------------------------------------------------------------------------
// What changed

const [base, baseReason] = resolveBase();
const headRef = options.head ?? "HEAD";
const mergeBase = tryGit("merge-base", base, headRef)?.trim() ?? stop(`no merge-base between ${base} and ${headRef}.`);
const range = options.head ? [mergeBase, options.head] : [mergeBase];
const short = mergeBase.slice(0, 10);

const changes = [];
const nameStatus = git("diff", "--name-status", "-M", "-z", ...range).split("\0");
for (let i = 0; i < nameStatus.length - 1; ) {
  const status = nameStatus[i++][0];
  const oldPath = nameStatus[i++];
  const path = status === "R" || status === "C" ? nameStatus[i++] : oldPath;
  changes.push({ status, path, oldPath });
}
const untracked = options.head ? [] : git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
for (const path of untracked) changes.push({ status: "?", path, oldPath: path });

const numstat = readNumstat();
const whitespaceBlind = readNumstat("-w", "--ignore-blank-lines");
const addedByFile = readAddedLines();

const headText = (path) => {
  if (options.head) return tryGit("show", `${options.head}:${path}`);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
};
const baseText = (path) => tryGit("show", `${mergeBase}:${path}`);

const live = changes.filter((change) => change.status !== "D" && !isBinary(change));
const generated = generatedFiles();
const authored = live.filter((change) => !generated.has(change.path));
const added = (change) => addedByFile.get(change.path) ?? [];

// ---------------------------------------------------------------------------------------------------
// Paths: protected, secrets files, license headers

const protectedRules = (config.protected ?? []).map((rule) => (typeof rule === "string" ? { glob: rule } : rule));
const protectedMatchers = protectedRules.map((rule) => ({ ...rule, regex: globToRegExp(rule.glob) }));

for (const change of changes) {
  for (const path of new Set([change.oldPath, change.path])) {
    const rule = protectedMatchers.find(({ regex }) => regex.test(path));
    if (rule)
      report("ERROR", path, `touched a protected path (${rule.glob}${rule.reason ? `: ${rule.reason}` : ""}). Undo it unless you were asked to make this change; \`git diff ${short} -- ${path}\` shows it`);
  }
}

const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$|dist$|defaults$)[\w.-]+)?|id_(rsa|dsa|ecdsa|ed25519)|credentials\.json|\.netrc|[^/]+\.(p12|pfx|jks|keystore))$/;
for (const change of changes) {
  if ("A?".includes(change.status) && SECRET_FILE.test(change.path))
    report("ERROR", change.path, change.status === "?"
      ? "untracked file that usually holds secrets, and `git add -A` would commit it. Delete it or add it to .gitignore"
      : "added a file that usually holds secrets. Take it out of the branch, and add it to .gitignore if it belongs on disk");
}

if (licenseHeader) {
  const scoped = (config.licenseHeader.files ?? []).map(globToRegExp);
  for (const change of live) {
    if (!"A?RC".includes(change.status) || !scoped.some((regex) => regex.test(change.path))) continue;
    const head = (headText(change.path) ?? "").replace(/^#!.*\n/, "").split("\n").slice(0, 30).join("\n");
    if (!licenseHeader.test(head)) report("ERROR", `${change.path}:1`, "new file is missing the license header; copy it from a neighboring file");
  }
}

// ---------------------------------------------------------------------------------------------------
// Added lines: conflict markers, secrets, deny patterns, to-do markers, debug leftovers

const SECRETS = [
  [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, "a private key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key id"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/, "a GitHub token"],
  [/\bglpat-[A-Za-z0-9_-]{20,}/, "a GitLab token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/\bhooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/, "a Slack webhook"],
  [/\b[sr]k_live_[A-Za-z0-9]{20,}/, "a Stripe live key"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, "a Google API key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic API key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9]{32,}/, "an OpenAI API key"],
  [/\bnpm_[A-Za-z0-9]{36}\b/, "an npm token"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, "a JWT"],
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?):\/\/[^\s:@/]+:[^\s@/]{3,}@/, "a connection string with a password"],
];
const denyRules = (config.deny ?? []).map((rule) => (typeof rule === "string" ? { pattern: rule } : rule));
const denyMatchers = denyRules.map((rule) => ({ ...rule, regex: settingRegExp(rule.pattern, "deny") }));
const CONFLICT = /^(<{7}|>{7}|\|{7})( |$)/;
// In prose only the marker form counts, so a doc can still name the rule
const TODO_IN_CODE = /\b(T[O]DO|F[I]XME)\b/;
const TODO_IN_PROSE = /\b(T[O]DO|F[I]XME)\b[:(]/;
// [files, leftovers, prints]. Prints are skipped in scripts (a shebang, or under scripts/ or bin/), where they're the real output
const DEBUG = [
  [/\.(m|c)?[jt]sx?$|\.(vue|svelte)$/, /^\s*debugger;?\s*$|\b(it|test|describe|context)\.only\(|\bf(it|describe)\(/, /\bconsole\.(log|debug|trace|dir)\(/],
  [/\.py$/, /\bbreakpoint\(\)|\bi?pdb\.set_trace\(|^\s*import i?pdb\b/],
  [/\.rs$/, /\bdbg!\(/],
  [/\.rb$/, /\bbinding\.(pry|irb)\b|^\s*byebug\b/],
  [/\.php$/, /\b(var_dump|dd)\(/],
  [/\.exs?$/, /\bIEx\.pry\b/, /\bIO\.inspect\(/],
];
const hasShebang = (change) => (headText(change.path) ?? "").startsWith("#!");
const isScript = (change) => /(^|\/)(scripts|bin)\//.test(change.path) || hasShebang(change);

for (const change of live) {
  const lines = added(change);
  const isGenerated = generated.has(change.path);
  const [, leftovers, prints] = DEBUG.find(([files]) => files.test(change.path)) ?? [];
  const debug = [leftovers, isScript(change) ? undefined : prints].filter(Boolean);
  const todo = COMMENT_STYLES.some(([files]) => files.test(change.path)) ? TODO_IN_CODE : TODO_IN_PROSE;
  const hits = { conflict: [], todo: [], debug: [] };

  for (const [n, line] of lines) {
    const where = `${change.path}:${n}`;
    if (CONFLICT.test(line)) hits.conflict.push(n);

    const secret = SECRETS.find(([regex]) => regex.test(line));
    if (secret) {
      const shown = secret[1] === "a private key" ? "" : ` (${line.match(secret[0])[0].slice(0, 6)}…)`;
      report("ERROR", where, `looks like ${secret[1]}${shown}. Take it out and load it from the environment or a secrets store; if it's a fake fixture, keep it and say so`);
    }
    for (const rule of change.path === SETTINGS ? [] : denyMatchers) {
      if (rule.regex.test(line)) report("ERROR", where, rule.message ?? `matches the deny pattern /${rule.pattern}/`);
    }

    if (isGenerated) continue;
    if (todo.test(line)) hits.todo.push(n);
    if (debug.some((regex) => regex.test(line))) hits.debug.push(n);
  }

  if (hits.conflict.length) report("ERROR", `${change.path}:${hits.conflict[0]}`, `conflict markers (${lineList(hits.conflict)}). Finish the merge by hand`);
  if (hits.todo.length) report("ERROR", `${change.path}:${hits.todo[0]}`, `to-do marker on an added line (${lineList(hits.todo)}). Do the work now, or drop the note and list the follow-up in your report`);
  if (hits.debug.length) report("WARN", `${change.path}:${hits.debug[0]}`, `debug leftover? (${lineList(hits.debug)}): a print, breakpoint or focused test. Remove it unless it's the program's real output`);
}

// ---------------------------------------------------------------------------------------------------
// Dependencies

const MANIFESTS = [
  [/(^|\/)package\.json$/, "js", (text) => jsonDeps(text, ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])],
  [/(^|\/)composer\.json$/, "php", (text) => jsonDeps(text, ["require", "require-dev"])],
  [/(^|\/)(pyproject\.toml|Pipfile)$/, "python", tomlDeps],
  [/(^|\/)requirements[^/]*\.txt$|(^|\/)requirements\/[^/]+\.txt$/, "python", requirementsDeps],
  [/(^|\/)Cargo\.toml$/, "rust", tomlDeps],
  [/(^|\/)go\.mod$/, "go", goDeps],
  [/(^|\/)Gemfile$/, "ruby", gemfileDeps],
];
const changedEcosystems = new Set();

for (const change of changes) {
  const manifest = MANIFESTS.find(([regex]) => regex.test(change.path) || regex.test(change.oldPath));
  if (!manifest || change.path.includes("node_modules/")) continue;
  const [, ecosystem, extract] = manifest;
  const before = change.status === "A" || change.status === "?" ? new Map() : extract(baseText(change.oldPath));
  const after = change.status === "D" ? new Map() : extract(headText(change.path));

  const diffs = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const [from, to] = [before.get(name), after.get(name)];
    if (from !== to) diffs.push(`${name} ${from ?? "(none)"} -> ${to ?? "(removed)"}`);
  }
  if (diffs.length === 0) continue;
  changedEcosystems.add(ecosystem);
  const shown = diffs.slice(0, 6).join("; ") + (diffs.length > 6 ? `; and ${diffs.length - 6} more` : "");
  report("WARN", change.path, `dependency change: ${shown}. Needs OK: keep it if the user agreed to it and name it in the report; otherwise take it out and recommend it, marked "needs OK"`);
}

for (const change of changes) {
  const lockfile = LOCKFILES.find(([regex]) => regex.test(change.path));
  if (lockfile && !changedEcosystems.has(lockfile[1]))
    report("WARN", change.path, `lockfile changed with no dependency change, usually an install with another tool version. Undo it (\`git diff ${short} -- ${change.path}\`) unless you were asked to update it`);
}

// ---------------------------------------------------------------------------------------------------
// Comment blocks, reformatting, spelling

for (const change of authored) {
  const style = COMMENT_STYLES.find(([regex]) => regex.test(change.path))?.[1];
  const own = new Set(added(change).map(([n]) => n));
  if (!style || own.size === 0) continue;
  const usageHeader = isScript(change) ? (hasShebang(change) ? 2 : 1) : undefined;
  const long = commentBlocks((headText(change.path) ?? "").split("\n"), style).filter(
    ({ start, lines, text }) => start !== usageHeader && text > commentLimit && lines.filter((_, k) => own.has(start + k)).length * 2 > lines.length,
  );
  if (long.length > 0) {
    const spans = long.map(({ start, lines }) => `${start}-${start + lines.length - 1}`).join(", ");
    report("WARN", `${change.path}:${long[0].start}`, `${long.length === 1 ? "comment block" : `${long.length} comment blocks`} over ${commentLimit} lines (lines ${spans}). Cut ${long.length === 1 ? "it" : "each"} to the line or two of reason the code can't show, or delete it. Required API docs and license headers stay`);
  }
}

for (const change of authored) {
  if (!"MR".includes(change.status)) continue;
  const total = numstat.get(change.path);
  const real = whitespaceBlind.get(change.path) ?? 0;
  if (total === undefined || total < 10) continue;
  if (total - real >= 10 && real * 2 <= total)
    report("WARN", change.path, `${total - real} of ${total} changed lines only change whitespace: likely reformatting. Revert those hunks unless the task was to reformat (\`git diff -w ${short} -- ${change.path}\` shows the real change)`);
}

if (config.americanSpelling) {
  const BRITISH = britishWords();
  const SPELLED = /\.((m|c)?[jt]sx?|py|rb|go|rs|java|kts?|swift|cs|php|vue|svelte|md|mdx|txt|rst|html|css|scss|ya?ml|toml|sh)$/;

  for (const change of authored) {
    if (!SPELLED.test(change.path)) continue;
    const found = new Map();
    for (const [n, line] of added(change)) {
      for (const swap of britishIn(line, BRITISH)) found.set(swap, [...(found.get(swap) ?? []), n]);
    }
    if (found.size === 0) continue;
    const words = [...found].map(([swap, lines]) => `${swap} (${lineList(lines)})`).join(", ");
    report("ERROR", `${change.path}:${[...found.values()][0][0]}`, `British spelling: ${words}. Use the American word; an outside API key or proper name keeps its own spelling, so name it in the report`);
  }

  for (const entry of git("log", "--no-merges", "--format=%h%x00%B%x01", `${mergeBase}..${headRef}`).split("\x01")) {
    const [hash, message] = entry.trim().split("\0");
    const swaps = [...new Set((message ?? "").split("\n").flatMap((line) => britishIn(line, BRITISH)))];
    if (swaps.length > 0) report("WARN", `commit ${hash}`, `British spelling in its message: ${swaps.join(", ")}. Reword it before pushing`);
  }
}

// ---------------------------------------------------------------------------------------------------
// Output

const status = [];
const statusFields = options.head ? [] : git("status", "--porcelain", "-z").split("\0");
for (let i = 0; i < statusFields.length; i++) {
  if (!statusFields[i]) continue;
  status.push(statusFields[i]);
  if (/^[RC]|^.[RC]/.test(statusFields[i])) i++;
}
const untrackedCount = status.filter((line) => line.startsWith("??")).length;
const uncommitted = status.length - untrackedCount;
if (status.length > 0) {
  const parts = [uncommitted && `${uncommitted} modified`, untrackedCount && `${untrackedCount} untracked`].filter(Boolean).join(", ");
  report("WARN", "working tree", `uncommitted work (${parts}). Commit it before you hand back, or delete scratch files`);
}

console.log(`base: ${base} (${baseReason}), merge-base ${short}`);
console.log(`files: ${changes.length - untracked.length} changed${untracked.length ? `, ${untracked.length} untracked` : ""}${generated.size ? `, ${generated.size} generated or vendored (line checks skipped)` : ""}`);
console.log(`config: ${configFiles.length ? configFiles.join(" over ") : "none, using defaults"}`);
console.log(`verify: ${verifyHint()}`);
console.log("");

for (const level of ["ERROR", "WARN"]) {
  for (const { where, message } of findings.filter((finding) => finding.level === level)) console.log(`${level.padEnd(5)}  ${where}  ${message}`);
}

const errors = findings.filter((finding) => finding.level === "ERROR").length;
console.log(`\n${errors} error(s), ${findings.length - errors} warning(s)`);
process.exit(errors > 0 ? 1 : 0);

// ---------------------------------------------------------------------------------------------------

function settingRegExp(pattern, key, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (error) {
    stop(`${key} in the settings isn't a valid regex: ${error.message}`);
  }
}

function readConfig(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    stop(`can't read ${path}: ${error.message}`);
  }
}

function resolveBase() {
  if (options.base) {
    if (!tryGit("rev-parse", "--verify", "--quiet", `${options.base}^{commit}`)) stop(`--base ${options.base} isn't a commit.`);
    return [options.base, "--base"];
  }

  const branch = git("branch", "--show-current").trim();
  const created = branch &&
    tryGit("reflog", "show", "--format=%gs", `refs/heads/${branch}`)?.trim().split("\n").at(-1)?.match(/^branch: Created from (.+)$/)?.[1];
  if (created && created !== "HEAD" && tryGit("rev-parse", "--verify", "--quiet", `${created}^{commit}`))
    return [created, `${branch} was created from it`];
  // `checkout -b` records "Created from HEAD"; HEAD's reflog names what was checked out then
  if (created === "HEAD") {
    const moved = new RegExp(`^checkout: moving from (.+) to ${branch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
    const from = tryGit("reflog", "show", "--format=%gs", "HEAD")?.trim().split("\n").reverse().map((line) => line.match(moved)?.[1]).find(Boolean);
    if (from && from !== branch && tryGit("rev-parse", "--verify", "--quiet", `${from}^{commit}`)) return [from, `${branch} was created from it`];
  }

  // A pushed feature branch's own remote copy would make only the unpushed commits count, but on the default
  // branch that copy is the right base
  const isDefault = branch && tryGit("symbolic-ref", "--short", "refs/remotes/origin/HEAD")?.trim() === `origin/${branch}`;
  const skip = (ref, symref) => !ref || symref || ref === branch || (!isDefault && ref.endsWith(`/${branch}`));
  let best;
  const consider = (ref, behind, ahead) => {
    if (!best || behind < best[1] || (behind === best[1] && ahead < best[2])) best = [ref, behind, ahead];
  };
  // ahead-behind (git 2.41+) counts every ref in one call; older git takes three calls per ref
  const counted = tryGit("for-each-ref", "--format=%(refname:short)%00%(symref)%00%(ahead-behind:HEAD)", "refs/heads", "refs/remotes");
  if (counted !== undefined) {
    const total = Number(git("rev-list", "--count", "HEAD"));
    for (const entry of counted.split("\n")) {
      const [ref, symref, counts] = entry.split("\0");
      if (skip(ref, symref) || !counts) continue;
      const [ahead, behind] = counts.split(" ").map(Number);
      if (behind === 0 || behind === total) continue;
      consider(ref, behind, ahead);
    }
  } else {
    const head = git("rev-parse", "HEAD").trim();
    for (const entry of git("for-each-ref", "--format=%(refname:short)%00%(symref)", "refs/heads", "refs/remotes").split("\n")) {
      const [ref, symref] = entry.split("\0");
      if (skip(ref, symref)) continue;
      const mb = tryGit("merge-base", ref, "HEAD")?.trim();
      if (!mb || mb === head) continue;
      consider(ref, Number(git("rev-list", "--count", `${mb}..HEAD`)), Number(git("rev-list", "--count", `${mb}..${ref}`)));
    }
  }
  if (best) return [best[0], "nearest merge-base; pass --base if that's not the branch you started from"];

  const upstream = tryGit("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")?.trim();
  if (upstream) return [upstream, "the upstream; every other branch already has these commits"];
  return ["HEAD", "every branch already has these commits, so only uncommitted work counts; pass --base to review commits"];
}

function readNumstat(...flags) {
  const counts = new Map();
  const fields = git("diff", "--numstat", "-M", "-z", ...flags, ...range).split("\0");
  for (let i = 0; i < fields.length - 1; ) {
    const [addedCount, deletedCount, path] = fields[i++].split("\t");
    const target = path === "" ? (i++, fields[i++]) : path;
    counts.set(target, addedCount === "-" ? undefined : Number(addedCount) + Number(deletedCount));
  }
  return counts;
}

function isBinary(change) {
  if (change.status !== "?") return numstat.has(change.path) && numstat.get(change.path) === undefined;
  try {
    return readFileSync(change.path).subarray(0, 8000).includes(0);
  } catch {
    return true;
  }
}

// Added lines and their numbers in the new file, from one -U0 diff plus the untracked files
function readAddedLines() {
  const out = new Map();
  let current;
  let inHeader = false;
  let next = 0;
  const diff = git("diff", "-U0", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "-M", ...range);
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) [current, inHeader] = [undefined, true];
    else if (inHeader && line.startsWith("+++ ")) {
      // git ends the name with a tab when it contains a space
      const target = unquote(line.slice(4).replace(/\t$/, ""));
      current = target === "/dev/null" ? undefined : target.replace(/^b\//, "");
      if (current) out.set(current, []);
    } else if (line.startsWith("@@")) [next, inHeader] = [Number(line.match(/\+(\d+)/)?.[1] ?? 0), false];
    else if (current && !inHeader && line.startsWith("+")) out.get(current).push([next++, line.slice(1)]);
  }
  for (const path of untracked) {
    const change = { status: "?", path };
    if (!isBinary(change)) out.set(path, readFileSync(path, "utf8").split("\n").map((line, i) => [i + 1, line]));
  }
  return out;
}

function unquote(path) {
  if (!path.startsWith('"')) return path;
  return path.slice(1, -1).replace(/\\(["\\tn])/g, (_, char) => ({ t: "\t", n: "\n" })[char] ?? char);
}

function generatedFiles() {
  const BUILT_IN = /(^|\/)(vendor|third_party|node_modules)\/|\.min\.(js|css)$|\.map$|\.snap$/;
  const set = new Set(live.filter((change) => BUILT_IN.test(change.path) || LOCKFILES.some(([regex]) => regex.test(change.path))).map((change) => change.path));

  if (live.length > 0) {
    const input = live.map((change) => change.path).join("\0") + "\0";
    const attrs = execFileSync("git", ["check-attr", "-z", "linguist-generated", "linguist-vendored", "--stdin"], { input, encoding: "utf8" }).split("\0");
    for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === "set" || attrs[i + 2] === "true") set.add(attrs[i]);
  }
  for (const change of live) {
    const top = (headText(change.path) ?? "").split("\n", 5).join("\n");
    if (/@generated\b|\bDO NOT EDIT\b/.test(top)) set.add(change.path);
  }
  return set;
}

function verifyHint() {
  if (config.verify) return `${config.verify} (from settings)`;
  const found = [];
  const pkg = existsSync("package.json") ? safeJson(readFileSync("package.json", "utf8")) : undefined;
  const runner = existsSync("pnpm-lock.yaml") ? "pnpm" : existsSync("yarn.lock") ? "yarn" : existsSync("bun.lockb") || existsSync("bun.lock") ? "bun run" : "npm run";
  for (const name of ["verify", "check", "ci", "validate", "test", "lint", "typecheck", "build"])
    if (pkg?.scripts?.[name]) found.push(`${runner} ${name}`);
  const makefile = ["Makefile", "makefile", "GNUmakefile"].find((name) => existsSync(name));
  if (makefile) {
    const targets = readFileSync(makefile, "utf8").match(/^(verify|check|ci|test|lint)(?=\s*:(?!=))/gm) ?? [];
    found.push(...new Set(targets.map((target) => `make ${target}`)));
  }
  const candidates = found.length ? `; candidates: ${found.join(", ")}` : "";
  return `not in settings. Use the project's instructions (AGENTS.md, CLAUDE.md, CONTRIBUTING.md)${candidates}`;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function lineList(lines) {
  const unique = [...new Set(lines)];
  const shown = unique.slice(0, 6).join(", ") + (unique.length > 6 ? ` and ${unique.length - 6} more` : "");
  return `${unique.length === 1 ? "line" : "lines"} ${shown}`;
}

// gitignore-style: a glob with no slash matches at any depth, ** spans folders, and a folder matches what's in it
function globToRegExp(glob) {
  const anchored = glob.replace(/\/$/, "").includes("/");
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${source.replace(/^\//, "").replace(/\/$/, "")}(?:/.*)?$`);
}

function jsonDeps(text, sections) {
  const json = safeJson(text ?? "");
  return new Map(sections.flatMap((section) => Object.entries(json?.[section] ?? {}).map(([name, spec]) => [`${section}: ${name}`, String(spec)])));
}

// Enough TOML for pyproject.toml, Pipfile and Cargo.toml: keys in dependency tables, and the strings in
// dependency arrays (PEP 508 specs, keyed by package name)
function tomlDeps(text) {
  const deps = new Map();
  const DEP_TABLE = /(^|\.)(dependencies|dev-dependencies|build-dependencies|optional-dependencies|dependency-groups|packages|dev-packages)(\.|$)/;
  const addSpecs = (owner, value) => {
    for (const [, spec] of value.matchAll(/["']([^"']+)["']/g)) deps.set(`${owner}: ${pep508Name(spec)}`, pep508Spec(spec));
  };
  let section = "";
  let array;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\s#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[\[?\s*([^\]]+?)\s*\]\]?$/);
    if (header) {
      [section, array] = [header[1], undefined];
      continue;
    }
    if (array) {
      addSpecs(array, line);
      if (line.includes("]")) array = undefined;
      continue;
    }
    const pair = line.match(/^["']?([\w.-]+)["']?\s*=\s*(.*)$/);
    if (!pair) continue;
    const [, key, value] = pair;
    const inTable = DEP_TABLE.test(section);
    if (value.startsWith("[") && (inTable || /(^|-)dependencies$/.test(key))) {
      addSpecs(`${section}.${key}`, value);
      if (!value.includes("]")) array = `${section}.${key}`;
    } else if (inTable) deps.set(`${section}: ${key}`, value);
  }
  return deps;
}

function requirementsDeps(text) {
  const lines = (text ?? "").split("\n").map((line) => line.replace(/\s#.*$/, "").trim());
  return new Map(lines.filter((line) => line && !line.startsWith("#")).map((line) => [pep508Name(line), pep508Spec(line)]));
}

function goDeps(text) {
  const deps = new Map();
  let block = false;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) block = true;
    else if (block && line === ")") block = false;
    else {
      const entry = (block ? line : line.match(/^require\s+(.*)$/)?.[1] ?? "").match(/^(\S+)\s+(v\S+)/);
      if (entry) deps.set(entry[1], entry[2]);
    }
  }
  return deps;
}

function gemfileDeps(text) {
  const entries = [...(text ?? "").matchAll(/^\s*gem\s+["']([^"']+)["']\s*,?\s*(.*)$/gm)];
  return new Map(entries.map(([, name, rest]) => [name, rest.trim() || "(any)"]));
}

function pep508Name(spec) {
  return spec.match(/^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/)?.[1]?.toLowerCase() ?? spec.trim();
}

function pep508Spec(spec) {
  const name = spec.match(/^\s*[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0];
  return name ? spec.slice(name.length).trim() || "(any)" : spec.trim();
}

// Comment blocks (a /* */ block or a run of line comments), with the count of lines that hold text
function commentBlocks(lines, style) {
  const blocks = [];
  const linePrefix = { slash: "//", hash: "#", dash: "--" }[style];
  for (let i = 0; i < lines.length; ) {
    const start = i;
    const first = lines[i].trim();
    if (style === "slash" && /^(\{\s*)?\/\*/.test(first)) {
      while (i < lines.length && !lines[i].includes("*/")) i++;
      i++;
    } else if (first.startsWith(linePrefix) && !(style === "hash" && i === 0 && first.startsWith("#!"))) {
      while (i < lines.length && lines[i].trim().startsWith(linePrefix)) i++;
    } else {
      i++;
      continue;
    }
    const block = lines.slice(start, i);
    const joined = block.join("\n");
    if (/copyright|spdx-license-identifier|licensed under/i.test(joined)) continue;
    if (licenseHeader?.test(joined)) continue;
    const text = block.filter((line) => !/^\s*(\{?\s*\/\*+|\*+\/\s*\}?|\*|\/\/+|#+|--)\s*$/.test(line)).length;
    blocks.push({ start: start + 1, lines: block, text });
  }
  return blocks;
}

// British word -> American word, with the common suffixes
function britishWords() {
  const words = new Map();
  const our = ["colour", "behaviour", "favourite", "neighbour", "honour", "flavour", "armour", "humour", "rumour", "harbour", "vapour", "labour", "odour", "endeavour"];
  for (const root of our) {
    for (const suffix of ["", "s", "d", "ed", "ing", "ful", "less", "able", "er", "ers", "ise", "ised", "ises", "ising", "isation"])
      words.set(root + suffix, root.replace("our", "or") + suffix.replace(/^is/, "iz"));
  }
  for (const [british, american] of [["centre", "center"], ["metre", "meter"], ["litre", "liter"], ["fibre", "fiber"], ["theatre", "theater"], ["calibre", "caliber"]]) {
    words.set(british, american).set(`${british}s`, `${american}s`).set(`${british}d`, `${american}ed`);
    words.set(`${british.slice(0, -2)}ring`, `${american}ing`);
  }
  for (const verb of ["cancel", "label", "model", "travel", "signal", "level", "fuel", "total", "channel", "tunnel", "marshal", "counsel", "dial", "jewel"]) {
    for (const suffix of ["ed", "ing", "er", "ers"]) words.set(`${verb}l${suffix}`, verb + suffix);
  }
  const ise = [
    "initial", "normal", "serial", "optim", "summar", "priorit", "recogn", "organ", "final", "minim", "maxim", "custom", "visual",
    "sanit", "synchron", "categor", "util", "memo", "local", "capital", "standard", "material", "token", "parallel", "central",
    "special", "emphas", "stabil", "author", "random", "raster", "quant", "digit", "linear", "general", "neutral", "real",
    "apolog", "critic", "modern", "harmon", "symbol", "character", "penal", "fertil", "steril", "global", "vector",
  ];
  for (const stem of ise) {
    for (const suffix of ["ise", "ised", "ises", "ising", "iser", "isers", "isation", "isations", "isable"])
      words.set(stem + suffix, stem + suffix.replace("is", "iz"));
  }
  const single = {
    licence: "license", licences: "licenses", defence: "defense", offence: "offense", pretence: "pretense",
    catalogue: "catalog", catalogues: "catalogs", catalogued: "cataloged", grey: "gray", greys: "grays", greyed: "grayed",
    greying: "graying", greyish: "grayish", greyscale: "grayscale", whilst: "while", amongst: "among", amidst: "amid",
    learnt: "learned", analyse: "analyze", analysed: "analyzed", analysing: "analyzing", analyser: "analyzer",
    paralyse: "paralyze", paralysed: "paralyzed", programme: "program", programmes: "programs", manoeuvre: "maneuver",
    artefact: "artifact", artefacts: "artifacts", judgement: "judgment", acknowledgement: "acknowledgment", ageing: "aging",
    practise: "practice", practised: "practiced", practising: "practicing", fulfil: "fulfill", fulfilment: "fulfillment",
    enrol: "enroll", enrolment: "enrollment", instalment: "installment", sceptical: "skeptical", cosy: "cozy",
  };
  for (const [british, american] of Object.entries(single)) words.set(british, american);
  return words;
}

// "british → american" for each British word in a line, camelCase and UPPER_SNAKE parts included. Lower
// snake_case tokens are skipped: they're usually keys an outside API or data file spells its own way.
function britishIn(line, british) {
  const swaps = [];
  for (const [token] of line.replace(/https?:\/\/\S+/g, "").matchAll(/\w+/g)) {
    if (token.includes("_") && /[a-z]/.test(token)) continue;
    for (const part of token.split(/_|(?<=[a-z\d])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const word = part.toLowerCase();
      const prefix = ["", "un", "re", "dis", "de", "pre", "non"].find((p) => word.startsWith(p) && british.has(word.slice(p.length)));
      if (prefix !== undefined) swaps.push(`${word} → ${prefix}${british.get(word.slice(prefix.length))}`);
    }
  }
  return swaps;
}
