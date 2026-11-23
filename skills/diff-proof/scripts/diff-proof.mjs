#!/usr/bin/env node
// Proves what a branch changes in a program's output. Builds a base and a head checkout, runs the same
// probes from .agents/diff-proof.json on both with a frozen clock and seed, and reports what's identical,
// what differs and by how much, plus timing numbers a PR can quote.
//
//   node diff-proof.mjs [--base <ref|dir>] [--head <ref|dir>] [--probes a,b] [--no-build] [--out <dir>]
//
//   --base      a ref or a checkout. Default: the head's merge-base with the default branch.
//   --head      a ref or a checkout. Default: the checkout you run it from, uncommitted changes included.
//   --probes    run only these probes, by name
//   --no-build  both sides are already built
//   --out       where outputs and report.md go. Default: <tmp>/diff-proof/<repo>/<head>-vs-<base>
//
// A ref gets its own detached worktree under ~/.cache/diff-proof/<repo>-<id>/ (or $XDG_CACHE_HOME),
// reused across runs, so nothing switches branches under your checkout. The config's format is in this
// skill's references/diff-proof.json.
//
// Exits 0 when every probe is identical, 1 when one differs (a changed exit code counts), 2 when it
// couldn't check (no config, a failed setup or build, a probe killed or timed out, bad JSON, no files).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { inflateSync } from "node:zlib";

const PROBE_TIMEOUT_MS = 10 * 60_000;
const TEXT_DIFF_LINES = 60;
const LIST_CAP = 20;
const PATHS_PER_ITEM = 5;
const VISIBLE_DELTA = 16;

const { values: opts } = parseArgs({
  options: {
    base: { type: "string" },
    head: { type: "string" },
    probes: { type: "string" },
    "no-build": { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const stop = (message) => {
  console.error(`diff-proof: ${message}`);
  process.exit(2);
};
process.on("uncaughtException", (error) => stop(error.stack ?? String(error)));

const tryGit = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
};
const git = (dir, ...args) => tryGit(dir, ...args) ?? stop(`git ${args.join(" ")} failed in ${dir}`);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const short = (commit) => (commit ? commit.slice(0, 9) : "dir");
const dirty = (dir) => Boolean(tryGit(dir, "status", "--porcelain", "--untracked-files=no"));

const repo = tryGit(process.cwd(), "rev-parse", "--show-toplevel");
const configPath = join(repo ?? process.cwd(), ".agents", "diff-proof.json");
if (!existsSync(configPath)) stop(`no ${configPath}; copy references/diff-proof.json from this skill and fill it in`);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const wanted = opts.probes?.split(",");
const probes = (config.probes ?? []).filter((probe) => !wanted || wanted.includes(probe.name));
for (const name of wanted ?? []) if (!probes.some((probe) => probe.name === name)) stop(`no probe named ${name} in ${configPath}`);
if (probes.length === 0) stop(`${configPath} has no probes`);
for (const probe of probes) {
  if (!probe.name || !probe.run) stop(`every probe needs a name and a run command`);
  if (!["text", "json", "files", "timing", undefined].includes(probe.kind)) stop(`probe ${probe.name}: kind is text, json, files or timing`);
}

const headIsDir = opts.head ? isDir(opts.head) : Boolean(repo);
const baseIsDir = opts.base !== undefined && isDir(opts.base);
if (!repo && !(headIsDir && baseIsDir)) stop("run it from a git checkout, or pass two directories as --base and --head");

if (repo && tryGit(repo, "remote", "get-url", "origin")) {
  spawnSync("git", ["-C", repo, "fetch", "--quiet", "origin"], { stdio: "ignore", timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

const headDirGiven = headIsDir ? resolve(opts.head ?? repo) : undefined;
const headCommit = headDirGiven ? tryGit(headDirGiven, "rev-parse", "HEAD") : git(repo, "rev-parse", "--verify", `${opts.head}^{commit}`);
if (!headCommit && !opts.base) stop(`${headDirGiven} isn't a git checkout, so pass --base`);

let baseLabel = opts.base;
let baseCommit;
if (baseIsDir) baseCommit = tryGit(opts.base, "rev-parse", "HEAD");
else if (opts.base) baseCommit = git(repo, "rev-parse", "--verify", `${opts.base}^{commit}`);
else {
  const main = defaultBranch(repo);
  baseCommit = git(repo, "merge-base", headCommit, main);
  baseLabel = `merge-base with ${main}`;
}

const headDirty = headDirGiven ? dirty(headDirGiven) : false;
if (!baseIsDir && baseCommit === headCommit && !headDirty) stop(`base and head are the same commit (${short(headCommit)}) with no uncommitted changes`);

const commonDir = repo && git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
const repoName = basename(commonDir ? dirname(commonDir) : headDirGiven);
const cache = commonDir && join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "diff-proof", `${repoName}-${hash(commonDir)}`);
const out = resolve(opts.out ?? join(tmpdir(), "diff-proof", repoName, `${short(headCommit)}-vs-${short(baseCommit)}`));
mkdirSync(out, { recursive: true });

const now = Date.now();
const frozen = {
  TZ: "UTC",
  DIFF_PROOF_NOW: String(now),
  DIFF_PROOF_SEED: "1",
  SOURCE_DATE_EPOCH: String(Math.floor(now / 1000)),
  DIFF_PROOF_FREEZE: pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "freeze.mjs")).href,
  ...config.env,
};

const needsWorktree = !baseIsDir || !headDirGiven;
if (needsWorktree) lock();

const baseDir = baseIsDir ? resolve(opts.base) : prepareWorktree("base", baseCommit);
const headDir = headDirGiven ?? prepareWorktree("head", headCommit);
const sides = [["base", baseDir], ["head", headDir]];
if (config.inputs) frozen.DIFF_PROOF_INPUTS = resolve(headDir, config.inputs);

for (const [side, dir] of sides) {
  if (side === "base" && baseIsDir && dirty(dir)) console.warn(`diff-proof: ${dir} has uncommitted changes, which the base side includes`);
}

if (config.build && !opts["no-build"]) {
  for (const [side, dir] of sides) {
    console.error(`diff-proof: building ${side} (${dir})`);
    if (shell(config.build, dir, join(out, `build-${side}.log`), { DIFF_PROOF_SIDE: side }).status !== 0) {
      stop(`${side} build failed, see ${join(out, `build-${side}.log`)}`);
    }
  }
}

const describe = (commit, dir, label, isDirty) =>
  `${short(commit)}${label ? ` (${label})` : ""}${isDirty ? " plus uncommitted changes" : ""}, ${dir}`;
const frozenLine = [
  `DIFF_PROOF_NOW ${new Date(Number(frozen.DIFF_PROOF_NOW)).toISOString()}`,
  `DIFF_PROOF_SEED ${frozen.DIFF_PROOF_SEED}`,
  `TZ ${frozen.TZ}`,
  ...(frozen.DIFF_PROOF_INPUTS ? [`inputs ${frozen.DIFF_PROOF_INPUTS}`] : []),
].join(", ");

const report = [
  `# diff-proof: head ${short(headCommit)} vs base ${short(baseCommit)}`,
  "",
  `- base: ${describe(baseCommit, baseDir, baseLabel, baseIsDir && dirty(baseDir))}`,
  `- head: ${describe(headCommit, headDir, headDirGiven ? undefined : opts.head, headDirty)}`,
  `- frozen: ${frozenLine}`,
  "",
];
const tally = { identical: 0, differs: 0, timed: 0, failed: 0 };

for (const probe of probes) {
  console.error(`diff-proof: probe ${probe.name}`);
  const dir = join(out, probe.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const section = probe.kind === "timing" ? timingProbe(probe, dir) : outputProbe(probe, dir);
  tally[section.status]++;
  report.push(`## ${probe.name}: ${section.status}`, "", ...section.lines, "");
}

const summary = Object.entries(tally).filter(([, count]) => count > 0).map(([status, count]) => `${count} ${status}`).join(", ");
report.push(`Summary: ${summary}. Outputs: ${out}`);
writeFileSync(join(out, "report.md"), `${report.join("\n")}\n`);
console.log(`${report.join("\n")}\nreport: ${join(out, "report.md")}`);
process.exit(tally.failed ? 2 : tally.differs ? 1 : 0);

function defaultBranch(dir) {
  const remoteHead = tryGit(dir, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  if (remoteHead) return remoteHead;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (tryGit(dir, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)) return ref;
  }
  stop("couldn't find the default branch; pass --base");
}

function hash(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

function lock() {
  mkdirSync(cache, { recursive: true });
  const path = join(cache, "lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      process.on("exit", () => rmSync(path, { force: true }));
      return;
    } catch {
      const pid = Number(readFileSync(path, "utf8"));
      if (!pid || alive(pid)) stop(`another diff-proof run (pid ${pid || "starting"}) is using ${cache}; wait for it, or delete ${path} if none is running`);
      rmSync(path, { force: true });
    }
  }
  stop(`couldn't lock ${cache}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A detached worktree for one side, created on first use and moved to `commit` after that */
function prepareWorktree(side, commit) {
  const dir = join(cache, side);
  const marker = join(cache, `${side}.setup`);
  if (!existsSync(dir)) {
    console.error(`diff-proof: creating the ${side} worktree at ${dir}`);
    // --force: git refuses a path it still has registered after someone deleted the folder by hand
    git(repo, "worktree", "add", "--force", "--quiet", "--detach", dir, commit);
  } else if (tryGit(dir, "rev-parse", "HEAD") !== commit) {
    if (!tryGit(dir, "rev-parse", "--git-dir")) stop(`${dir} exists but isn't a worktree; remove it and rerun`);
    if (dirty(dir)) stop(`${dir} has local changes; clean it up first`);
    git(dir, "checkout", "--quiet", "--detach", commit);
  }

  const setUp = existsSync(marker) && readFileSync(marker, "utf8") === commit;
  if (config.setup && !setUp) {
    console.error(`diff-proof: setting up the ${side} worktree`);
    rmSync(marker, { force: true });
    if (shell(config.setup, dir, join(out, `setup-${side}.log`), { DIFF_PROOF_SIDE: side }).status !== 0) {
      stop(`${side} setup failed, see ${join(out, `setup-${side}.log`)}`);
    }
  }
  writeFileSync(marker, commit);
  return dir;
}

function shell(command, cwd, logFile, env = {}, stdoutFile = logFile) {
  const stdout = openSync(stdoutFile, "a");
  const stderr = stdoutFile === logFile ? stdout : openSync(logFile, "a");
  try {
    return spawnSync(command, {
      shell: true,
      cwd,
      stdio: ["ignore", stdout, stderr],
      env: { ...process.env, ...frozen, ...env },
      timeout: PROBE_TIMEOUT_MS,
    });
  } finally {
    closeSync(stdout);
    if (stderr !== stdout) closeSync(stderr);
  }
}

function runSide(probe, dir, side, checkout) {
  const files = join(dir, side);
  mkdirSync(files, { recursive: true });
  const stdoutFile = join(dir, `${side}.out`);
  const stderrFile = join(dir, `${side}.err`);
  const result = shell(probe.run, checkout, stderrFile, { DIFF_PROOF_SIDE: side, DIFF_PROOF_OUT: files }, stdoutFile);
  return { status: result.status, signal: result.signal, stdoutFile, stderrFile, files };
}

/** The error line of a stderr file (the last line naming an error, panic or exception), or its last lines */
function tail(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter((line) => line.trim());
  if (lines.length === 0) return "(no stderr)";
  const error = lines.findLast((line) => /error|exception|panic/i.test(line) && !/^\s+at\s/.test(line));
  return `${(error ?? lines.slice(-3).join(" / ")).trim().slice(0, 300)} (${file})`;
}

function plural(count, noun) {
  return `${count} ${noun}${Number(count) === 1 ? "" : "s"}`;
}

function exitText(run) {
  return run.signal ? `killed by ${run.signal}` : `exit ${run.status}`;
}

function outputProbe(probe, dir) {
  const [base, head] = sides.map(([side, checkout]) => runSide(probe, dir, side, checkout));
  const lines = [];

  if (base.signal || head.signal) {
    return { status: "failed", lines: [`base ${exitText(base)}, head ${exitText(head)}. stderr: ${tail((base.signal ? base : head).stderrFile)}`] };
  }
  const exitChanged = base.status !== head.status;
  if (exitChanged) lines.push(`Exit code ${base.status} → ${head.status}. head stderr: ${tail(head.stderrFile)}`);
  else if (base.status !== 0) lines.push(`Both sides exited ${base.status}; compared anyway. stderr: ${tail(head.stderrFile)}`);

  const kind = probe.kind ?? "text";
  const compared = kind === "json" ? compareJson(base, head) : kind === "files" ? compareFiles(base.files, head.files) : compareText(base.stdoutFile, head.stdoutFile);
  if (compared.failed) return { status: "failed", lines: [...lines, ...compared.lines] };
  const differs = exitChanged || !compared.identical;
  return { status: differs ? "differs" : "identical", lines: [...lines, ...compared.lines] };
}

function compareText(a, b) {
  const diff = spawnSync("git", ["diff", "--no-index", "--no-color", "--unified=3", a, b], { encoding: "utf8" });
  if (diff.status === 0) return { identical: true, lines: [`stdout identical (${countLines(a)} lines).`] };
  if (diff.status !== 1) return { failed: true, lines: [`git diff couldn't compare ${a} and ${b}: ${diff.stderr.trim()}`] };
  const all = diff.stdout.trimEnd().split("\n");
  const body = all.slice(all.findIndex((line) => line.startsWith("@@")));
  const added = body.filter((line) => line.startsWith("+")).length;
  const removed = body.filter((line) => line.startsWith("-")).length;
  const shown = body.slice(0, TEXT_DIFF_LINES);
  const more = body.length > TEXT_DIFF_LINES ? [`(${body.length - TEXT_DIFF_LINES} more diff lines: git diff --no-index ${a} ${b})`] : [];
  return { identical: false, lines: [`${plural(added, "line")} added, ${removed} removed.`, "", "```diff", ...shown, "```", ...more] };
}

function countLines(file) {
  const text = readFileSync(file, "utf8");
  return text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
}

function compareJson(base, head) {
  const parsed = [];
  for (const [side, run] of [["base", base], ["head", head]]) {
    try {
      parsed.push(JSON.parse(readFileSync(run.stdoutFile, "utf8")));
    } catch (error) {
      return { failed: true, lines: [`${side} stdout isn't JSON (${error.message}). stderr: ${tail(run.stderrFile)}`] };
    }
  }
  return describeJson(...parsed);
}

/** Every leaf path where a and b differ, as [path, a, b]; key order is ignored */
function leafChanges(a, b, path = "", found = []) {
  const container = (value) => value !== null && typeof value === "object";
  if (container(a) && container(b) && Array.isArray(a) === Array.isArray(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const next = Array.isArray(a) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
      leafChanges(a[key], b[key], next, found);
    }
  } else if (JSON.stringify(a) !== JSON.stringify(b)) {
    found.push([path, a, b]);
  }
  return found;
}

function brief(value) {
  const text = value === undefined ? "(none)" : JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function describeJson(a, b) {
  const container = (value) => value !== null && typeof value === "object";
  if (!container(a) || !container(b) || Array.isArray(a) !== Array.isArray(b)) {
    const same = JSON.stringify(a) === JSON.stringify(b);
    return { identical: same, lines: [same ? "JSON identical." : `Whole value ${brief(a)} → ${brief(b)}`] };
  }

  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const label = (key) => (Array.isArray(a) ? `[${key}]` : key);
  const counts = { differ: 0, "only in base": 0, "only in head": 0 };
  let paths = 0;
  const details = [];
  for (const key of keys) {
    if (!(key in a) || !(key in b)) {
      const where = key in a ? "only in base" : "only in head";
      counts[where]++;
      details.push(`- \`${label(key)}\`: ${where}`);
      continue;
    }
    const changes = leafChanges(a[key], b[key]);
    if (changes.length === 0) continue;
    counts.differ++;
    paths += changes.length;
    const shown = changes.slice(0, PATHS_PER_ITEM).map(([path, x, y]) => `\`${path || "(whole)"}\` ${brief(x)} → ${brief(y)}`);
    const more = changes.length > PATHS_PER_ITEM ? `; ${changes.length - PATHS_PER_ITEM} more paths` : "";
    details.push(`- \`${label(key)}\`: ${shown.join("; ")}${more}`);
  }

  if (details.length === 0) return { identical: true, lines: [`JSON identical (${keys.length} items).`] };
  const extra = Object.entries(counts).filter(([where, count]) => where !== "differ" && count > 0).map(([where, count]) => `, ${count} ${where}`);
  const head = `${counts.differ} of ${keys.length} items differ (${paths} paths)${extra.join("")}.`;
  const shown = details.slice(0, LIST_CAP);
  return { identical: false, lines: [head, ...shown, ...(details.length > LIST_CAP ? [`- ${details.length - LIST_CAP} more items`] : [])] };
}

function listFiles(root, dir = root) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
  });
}

function compareFiles(beforeDir, afterDir) {
  const before = new Set(listFiles(beforeDir));
  const after = new Set(listFiles(afterDir));
  const all = [...new Set([...before, ...after])].toSorted();
  if (all.length === 0) return { failed: true, lines: [`Neither side wrote a file to $DIFF_PROOF_OUT.`] };

  const groups = { changed: [], added: [], removed: [] };
  for (const file of all) {
    if (!before.has(file)) groups.added.push(`\`${file}\``);
    else if (!after.has(file)) groups.removed.push(`\`${file}\``);
    else {
      const [x, y] = [readFileSync(join(beforeDir, file)), readFileSync(join(afterDir, file))];
      if (!x.equals(y)) groups.changed.push(`\`${file}\`: ${describeFileChange(file, x, y, join(beforeDir, file), join(afterDir, file))}`);
    }
  }

  const total = groups.changed.length + groups.added.length + groups.removed.length;
  if (total === 0) return { identical: true, lines: [`All ${all.length} files byte-identical.`] };
  const lines = [`${groups.changed.length} changed, ${groups.added.length} added, ${groups.removed.length} removed, ${all.length - total} byte-identical. Folders: ${dirname(beforeDir)}/{base,head}`];
  for (const [label, items] of Object.entries(groups)) {
    lines.push(...items.slice(0, LIST_CAP).map((item) => `- ${label} ${item}`));
    if (items.length > LIST_CAP) lines.push(`- ${items.length - LIST_CAP} more ${label}`);
  }
  return { identical: false, lines };
}

function describeFileChange(file, x, y, xPath, yPath) {
  if (file.endsWith(".png")) return describePng(x, y);
  if (file.endsWith(".json")) {
    try {
      const changes = leafChanges(JSON.parse(x.toString("utf8")), JSON.parse(y.toString("utf8")));
      if (changes.length === 0) return "same JSON, different bytes (formatting or key order)";
      const first = changes.slice(0, 3).map(([path, a, b]) => `\`${path || "(whole)"}\` ${brief(a)} → ${brief(b)}`);
      return `${changes.length} paths differ: ${first.join("; ")}`;
    } catch {
      // not valid JSON on a side: fall through to a line count
    }
  }
  const binary = x.subarray(0, 8000).includes(0) || y.subarray(0, 8000).includes(0);
  if (binary) return `bytes differ (${x.length} → ${y.length} bytes)`;
  const numstat = spawnSync("git", ["diff", "--no-index", "--numstat", xPath, yPath], { encoding: "utf8" }).stdout.split("\t");
  return `${plural(numstat[0], "line")} added, ${numstat[1]} removed`;
}

function describePng(x, y) {
  const a = decodePng(x);
  const b = decodePng(y);
  if (a.error || b.error) return `bytes differ; no pixel diff (${a.error ?? b.error})`;
  if (a.width !== b.width || a.height !== b.height) return `size ${a.width}x${a.height} → ${b.width}x${b.height}`;

  let differing = 0;
  let visible = 0;
  let maxDelta = 0;
  const box = { x0: Infinity, y0: Infinity, x1: -1, y1: -1 };
  for (let i = 0; i < a.width * a.height; i++) {
    const o = i * 4;
    if (a.rgba[o + 3] === 0 && b.rgba[o + 3] === 0) continue;
    let delta = 0;
    for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a.rgba[o + c] - b.rgba[o + c]));
    if (delta === 0) continue;
    differing++;
    if (delta > VISIBLE_DELTA) visible++;
    maxDelta = Math.max(maxDelta, delta);
    const px = i % a.width;
    const py = Math.floor(i / a.width);
    box.x0 = Math.min(box.x0, px);
    box.y0 = Math.min(box.y0, py);
    box.x1 = Math.max(box.x1, px);
    box.y1 = Math.max(box.y1, py);
  }
  if (differing === 0) return "same pixels, different bytes (encoder or metadata)";
  const percent = ((differing / (a.width * a.height)) * 100).toFixed(2);
  return `${differing} of ${a.width * a.height} pixels differ (${percent}%), max delta ${maxDelta}/255, ${visible} visible (delta > ${VISIBLE_DELTA}), within x ${box.x0}-${box.x1}, y ${box.y0}-${box.y1}`;
}

/** Decodes a non-interlaced 8-bit PNG to RGBA; anything else comes back as { error } */
function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) return { error: "not a PNG" };
  let offset = 8;
  let header;
  let palette;
  let transparency;
  const data = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") header = { width: chunk.readUInt32BE(0), height: chunk.readUInt32BE(4), depth: chunk[8], color: chunk[9], interlace: chunk[12] };
    else if (type === "PLTE") palette = chunk;
    else if (type === "tRNS") transparency = chunk;
    else if (type === "IDAT") data.push(chunk);
    else if (type === "IEND") break;
  }
  if (!header) return { error: "no IHDR chunk" };
  const { width, height, depth, color, interlace } = header;
  if (interlace) return { error: "interlaced PNG" };
  if (depth !== 8) return { error: `${depth}-bit PNG` };
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) return { error: `PNG color type ${color}` };

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)];
    const line = raw.subarray(row * (stride + 1) + 1, (row + 1) * (stride + 1));
    const current = pixels.subarray(row * stride, (row + 1) * stride);
    const above = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : undefined;
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? current[i - channels] : 0;
      const up = above ? above[i] : 0;
      const upLeft = above && i >= channels ? above[i - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const [dl, du, dul] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
        predictor = dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
      }
      current[i] = (line[i] + predictor) & 0xff;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const p = i * channels;
    if (color === 0 || color === 4) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = pixels[p];
      rgba[o + 3] = color === 4 ? pixels[p + 1] : transparency && transparency.readUInt16BE(0) === pixels[p] ? 0 : 255;
    } else if (color === 2 || color === 6) {
      rgba[o] = pixels[p];
      rgba[o + 1] = pixels[p + 1];
      rgba[o + 2] = pixels[p + 2];
      const keyed = color === 2 && transparency && [0, 1, 2].every((c) => transparency.readUInt16BE(c * 2) === pixels[p + c]);
      rgba[o + 3] = color === 6 ? pixels[p + 3] : keyed ? 0 : 255;
    } else {
      const index = pixels[p];
      rgba[o] = palette[index * 3];
      rgba[o + 1] = palette[index * 3 + 1];
      rgba[o + 2] = palette[index * 3 + 2];
      rgba[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return { width, height, rgba };
}

function median(values) {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The probe's own numbers when its last stdout line is a JSON object of numbers, else the wall time */
function timedRun(probe, dir, side, checkout) {
  const start = performance.now();
  const run = runSide(probe, dir, side, checkout);
  const wall = performance.now() - start;
  if (run.status !== 0) return { error: `${side} ${exitText(run)}: ${tail(run.stderrFile)}` };
  const last = readFileSync(run.stdoutFile, "utf8").trim().split("\n").at(-1);
  rmSync(run.stdoutFile, { force: true });
  try {
    const metrics = JSON.parse(last);
    if (metrics && typeof metrics === "object" && !Array.isArray(metrics) && Object.values(metrics).every((v) => typeof v === "number")) return { metrics };
  } catch {
    // not JSON: time the whole command
  }
  return { metrics: { "wall ms": wall } };
}

function timingProbe(probe, dir) {
  const runs = probe.runs ?? 10;
  const rounds = { base: [], head: [] };
  for (let round = 0; round < 2; round++) {
    for (const [side, checkout] of sides) {
      const warmup = timedRun(probe, dir, side, checkout);
      if (warmup.error) return { status: "failed", lines: [warmup.error] };
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const result = timedRun(probe, dir, side, checkout);
        if (result.error) return { status: "failed", lines: [result.error] };
        samples.push(result.metrics);
      }
      const names = Object.keys(samples[0]);
      rounds[side].push(Object.fromEntries(names.map((name) => [name, median(samples.map((sample) => sample[name]))])));
    }
  }

  const lines = [
    `p50 of ${runs} runs after a warmup, two rounds run base, head, base, head; each side keeps its lower round, since other load only adds time.`,
    "",
    "| Metric | base | head | change | rounds base / head |",
    "|---|---|---|---|---|",
  ];
  const fixed = (value) => value.toFixed(value < 10 ? 2 : 1);
  for (const name of new Set([...Object.keys(rounds.base[0]), ...Object.keys(rounds.head[0])])) {
    const [b1, b2] = rounds.base.map((round) => round[name]);
    const [h1, h2] = rounds.head.map((round) => round[name]);
    if (b1 === undefined || h1 === undefined) {
      const side = (r1, r2) => (r1 === undefined ? "-" : fixed(Math.min(r1, r2)));
      lines.push(`| ${name} | ${side(b1, b2)} | ${side(h1, h2)} | only in ${b1 === undefined ? "head" : "base"} | |`);
      continue;
    }
    const base = Math.min(b1, b2);
    const head = Math.min(h1, h2);
    const noise = Math.max(Math.abs(b1 - b2), Math.abs(h1 - h2));
    const change = base === 0 ? "n/a" : `${head >= base ? "+" : ""}${(((head - base) / base) * 100).toFixed(1)}%`;
    const note = Math.abs(head - base) <= noise ? " (within noise)" : "";
    lines.push(`| ${name} | ${fixed(base)} | ${fixed(head)} | ${change}${note} | ${fixed(b1)}, ${fixed(b2)} / ${fixed(h1)}, ${fixed(h2)} |`);
  }
  return { status: "timed", lines };
}
