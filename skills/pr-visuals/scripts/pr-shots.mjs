#!/usr/bin/env node
// Before/after screenshots for a PR that changes what users see in a web app. Builds and serves the
// base and the head, captures the same routes on both with Playwright under a frozen clock and seed with
// animations off, and frames each pair side by side (or stacked, when that's too wide) in one PNG.
//
//   node pr-shots.mjs [--pr <n>] [--base <ref|dir>] [--head <ref|dir>] [--only <name>]...
//                     [--no-build] [--reframe] [--out <dir>]
//
//   --pr        a GitHub PR: its branches come from gh, and files go to .agents/pr-visuals/<n>/
//               Without it: the head is this checkout, the base its merge-base with the default
//               branch, and files go to .agents/pr-visuals/<branch, with / as ->/
//   --base, --head  a ref or a directory, instead of those defaults
//   --only      capture just this shot (repeatable)
//   --no-build  skip the build on both sides
//   --reframe   redraw the frames from the saved captures; no checkouts, build, server or capture
//   --out       the folder that holds shots.json and gets the images
//
// Settings come from .agents/pr-visuals.json (setup, build, serve, ready, env and capture defaults) and
// <out>/shots.json (the shots); their formats are in this skill's references/. Playwright is loaded from
// $PW_DIR, then the project, then ~/.cache/pr-visuals/playwright; it's never installed by this script.
// A ref gets a detached worktree under ~/.cache/pr-visuals/<repo>-<id>/, reused across runs.
//
// Writes <out>/<name>.png per shot, the raw captures under <out>/raw/{before,after}/, and <out>/README.md.
// Exits 0 when every shot was captured and differs, 1 when a shot looks the same before and after,
// 2 when something couldn't be captured.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const SCALE = 2;
const ROW_MAX_WIDTH = 1900;
const MAX_SCREENSHOT = 16_000;
const READY_TIMEOUT_MS = 120_000;
const THEMES = {
  blurple: "radial-gradient(120% 140% at 0% 0%,#5865f2 0%,#8b5cf6 40%,#ec4899 75%,#f59e0b 120%)",
  ocean: "radial-gradient(120% 140% at 100% 0%,#0ea5e9 0%,#6366f1 45%,#a855f7 100%)",
  mint: "radial-gradient(120% 140% at 0% 100%,#34d399 0%,#06b6d4 45%,#6366f1 100%)",
  sunset: "radial-gradient(120% 140% at 100% 100%,#fbbf24 0%,#f97316 35%,#e11d48 75%,#7e22ce 120%)",
  graphite: "radial-gradient(120% 140% at 50% 0%,#6b7280 0%,#374151 50%,#111827 100%)",
};
const FRAME_CSS = `
html,body{margin:0;background:transparent}
body{font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
#root{display:inline-block}
.frame{display:inline-block;padding:24px;border-radius:16px;width:max-content}
.window{min-width:420px;border-radius:12px;overflow:hidden;background:#232428;box-shadow:0 0 0 1px rgba(0,0,0,.4),0 10px 20px -8px rgba(0,0,0,.55),0 4px 10px -4px rgba(0,0,0,.3)}
.titlebar{display:grid;grid-template-columns:72px 1fr 72px;align-items:center;height:40px;padding:0 14px;background:#18191c;box-shadow:inset 0 -1px 0 rgba(0,0,0,.3)}
.lights{display:flex;gap:8px}
.lights span{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 0 0 .5px rgba(0,0,0,.25)}
.lights span:nth-child(1){background:#ff5f57}.lights span:nth-child(2){background:#febc2e}.lights span:nth-child(3){background:#28c840}
.title{padding:0 12px;text-align:center;line-height:40px;color:#9a9ba1;white-space:nowrap}
.title b{font-weight:600;color:#f2f3f5}
.title .sep{margin:0 7px}
.body{display:flex}
.body.column{flex-direction:column}
.body.row{flex-direction:row;align-items:flex-start}
.side{display:flex;flex-direction:column;align-items:flex-start;padding:12px 16px 16px}
.body.row>.side{align-self:stretch}
.label{margin:2px 0 10px;font-size:12px;font-weight:600;color:#9a9ba1}
.label.before{color:#ff8a8e}
.label.after{color:#5bd88f}
.divider{flex-shrink:0;background:#3a3c42}
.body.column>.divider{height:1px;align-self:stretch}
.body.row>.divider{width:1px;align-self:stretch}
.px-box{display:block;overflow:hidden;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.06)}
.px{display:block;transform-origin:0 0;image-rendering:pixelated}
`;

const { values: opts } = parseArgs({
  options: {
    pr: { type: "string" },
    base: { type: "string" },
    head: { type: "string" },
    only: { type: "string", multiple: true },
    "no-build": { type: "boolean", default: false },
    reframe: { type: "boolean", default: false },
    out: { type: "string" },
  },
});

const children = new Set();
const stop = (message) => {
  console.error(`pr-shots: ${message}`);
  process.exit(2);
};
process.on("exit", () => children.forEach(kill));
process.on("SIGINT", () => process.exit(130));

const tryGit = (dir, ...args) => {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
};
const git = (dir, ...args) => tryGit(dir, ...args) ?? stop(`git ${args.join(" ")} failed in ${dir}`);
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();
const short = (commit) => (commit ? commit.slice(0, 8) : "no commit");
const dirty = (dir) => Boolean(tryGit(dir, "status", "--porcelain", "--untracked-files=no"));

const repo = tryGit(process.cwd(), "rev-parse", "--show-toplevel");
const settingsPath = repo && join(repo, ".agents", "pr-visuals.json");
const settings = settingsPath && existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};

const pr = opts.pr && (gh(["pr", "view", opts.pr, "--json", "number,headRefName,headRefOid,baseRefName"]) ?? stop(`gh couldn't read PR ${opts.pr}`));
const branch = repo && tryGit(repo, "symbolic-ref", "--quiet", "--short", "HEAD");
const folderName = pr ? String(pr.number) : (branch ?? "detached").replaceAll("/", "-");
if (!opts.out && !repo) stop("run it from a git checkout, or pass --out");
const out = resolve(opts.out ?? join(repo, ".agents", "pr-visuals", folderName));
const shotsPath = join(out, "shots.json");
if (!existsSync(shotsPath)) stop(`no ${shotsPath}; write one (see references/shots.json in this skill)`);
const shotFile = JSON.parse(readFileSync(shotsPath, "utf8"));
const allShots = shotFile.shots ?? [];
const shots = allShots.filter((shot) => !opts.only || opts.only.includes(shot.name));
for (const name of opts.only ?? []) if (!shots.some((shot) => shot.name === name)) stop(`no shot named ${name} in ${shotsPath}`);
if (shots.length === 0) stop(`${shotsPath} has no shots`);
for (const shot of shots) if (!shot.name || !shot.path) stop(`every shot needs a name and a path`);

const defaults = { ...settings, ...shotFile };
const now = new Date(defaults.now ?? Math.floor(Date.now() / 3_600_000) * 3_600_000);
if (Number.isNaN(now.getTime())) stop(`now ${defaults.now} isn't a date`);
const seed = Number(defaults.seed ?? 1);

const playwright = loadPlaywright();
const browser = await launch();
const results = [];
let sides = {};
try {
  if (!opts.reframe) sides = await captureAll();
  for (const shot of shots) results.push(await frame(shot));
} finally {
  await browser.close();
}
if (!opts.reframe) writeReadme();

for (const { shot, png, same, error } of results) {
  if (error) console.error(`pr-shots: ${shot.name}: ${error}`);
  else console.log(`${png}${same ? "  (looks the same before and after)" : ""}`);
}
process.exit(results.some((result) => result.error) ? 2 : results.some((result) => result.same) ? 1 : 0);

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  return result.status === 0 ? JSON.parse(result.stdout) : undefined;
}

function loadPlaywright() {
  const places = [process.env.PW_DIR, repo, join(homedir(), ".cache", "pr-visuals", "playwright")].filter(Boolean);
  for (const place of places) {
    const require = createRequire(join(resolve(place), "noop.js"));
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return require(name);
      } catch {
        // not installed there: try the next place
      }
    }
  }
  stop("Playwright isn't installed. Put it in a scratch folder, not the project: npm i --prefix ~/.cache/pr-visuals/playwright playwright");
}

async function launch() {
  // sRGB everywhere, so colors aren't converted to the display's profile and match across machines
  const args = ["--force-color-profile=srgb", "--disable-lcd-text"];
  const attempts = process.env.CHROMIUM_PATH ? [{ executablePath: process.env.CHROMIUM_PATH, args }] : [{ args }, { channel: "chrome", args }];
  const errors = [];
  for (const options of attempts) {
    try {
      return await playwright.chromium.launch(options);
    } catch (error) {
      errors.push(error.message.split("\n")[0]);
    }
  }
  stop(`couldn't launch Chromium or Chrome. Run npx playwright install chromium, or set CHROMIUM_PATH.\n  ${errors.join("\n  ")}`);
}

/** Resolves both checkouts, then builds, serves and captures each side in turn */
async function captureAll() {
  const head = resolveHead();
  const needBase = shots.some((shot) => shot.only !== "after");
  const base = needBase ? resolveBase(head) : undefined;
  if ((head.managed || base?.managed) && repo) lock();
  for (const side of [base, head].filter(Boolean)) {
    side.captures = {};
    if (side.managed) side.dir = prepareWorktree(side.name, side.commit);
    side.dirty = side.commit ? dirty(side.dir) : false;
    if (side.dirty) console.warn(`pr-shots: ${side.dir} has uncommitted changes, which the ${side.name === "base" ? "before" : "after"} images include`);
  }

  for (const side of [base, head].filter(Boolean)) {
    const tone = side.name === "base" ? "before" : "after";
    const sideShots = shots.filter((shot) => tone === "after" || shot.only !== "after");
    if (settings.build && !opts["no-build"]) {
      console.error(`pr-shots: building ${side.name} (${side.dir})`);
      if (run(settings.build, side.dir, join(out, "raw", `build-${side.name}.log`)).status !== 0) stop(`${side.name} build failed, see ${join(out, "raw", `build-${side.name}.log`)}`);
    }
    const server = settings.serve ? await serve(side) : undefined;
    try {
      for (const shot of sideShots) {
        console.error(`pr-shots: ${tone} ${shot.name}`);
        side.captures[shot.name] = await capture(shot, tone, side.dir, server?.url).catch((error) => ({ error: error.message.split("\n")[0] }));
      }
    } finally {
      if (server) kill(server.child);
    }
  }
  return { base, head };
}

function resolveHead() {
  if (opts.head && isDir(opts.head)) return { name: "head", dir: resolve(opts.head), commit: tryGit(opts.head, "rev-parse", "HEAD"), label: basename(resolve(opts.head)) };
  if (opts.head) return { name: "head", managed: true, commit: git(repo, "rev-parse", "--verify", `${opts.head}^{commit}`), label: opts.head };
  if (!pr) return { name: "head", dir: repo, commit: tryGit(repo, "rev-parse", "HEAD"), label: branch ?? "this checkout" };

  if (!tryGit(repo, "cat-file", "-e", `${pr.headRefOid}^{commit}`)) git(repo, "fetch", "--quiet", "origin", `pull/${pr.number}/head`);
  const worktrees = git(repo, "worktree", "list", "--porcelain").split("\n\n");
  const entry = worktrees.find((block) => block.split("\n").includes(`branch refs/heads/${pr.headRefName}`));
  const dir = entry?.match(/^worktree (.+)$/m)?.[1];
  if (dir) {
    const commit = git(dir, "rev-parse", "HEAD");
    if (commit !== pr.headRefOid) console.warn(`pr-shots: ${dir} is at ${short(commit)}, not the PR head ${short(pr.headRefOid)}`);
    return { name: "head", dir, commit, label: pr.headRefName };
  }
  return { name: "head", managed: true, commit: pr.headRefOid, label: pr.headRefName };
}

function resolveBase(head) {
  if (opts.base && isDir(opts.base)) return { name: "base", dir: resolve(opts.base), commit: tryGit(opts.base, "rev-parse", "HEAD"), label: basename(resolve(opts.base)) };
  if (opts.base) return { name: "base", managed: true, commit: git(repo, "rev-parse", "--verify", `${opts.base}^{commit}`), label: opts.base };
  if (!repo || !head.commit) stop("pass --base: the head isn't a git checkout");
  const target = pr ? `origin/${pr.baseRefName}` : defaultBranch();
  // An explicit refspec, since a single-branch clone's default one wouldn't create origin/<base>
  const refspec = `+refs/heads/${pr?.baseRefName}:refs/remotes/origin/${pr?.baseRefName}`;
  if (pr) spawnSync("git", ["-C", repo, "fetch", "--quiet", "origin", refspec], { stdio: "ignore", timeout: 60_000 });
  const commit = git(repo, "merge-base", target, head.commit);
  if (commit === head.commit && !(head.dir && dirty(head.dir))) stop(`the head is ${target}'s merge-base itself, so there's nothing to compare; pass --base`);
  return { name: "base", managed: true, commit, label: target.replace(/^origin\//, "") };
}

function defaultBranch() {
  const remoteHead = tryGit(repo, "symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD");
  if (remoteHead) return remoteHead;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if (tryGit(repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`)) return ref;
  }
  stop("couldn't find the default branch; pass --base");
}

function cacheDir() {
  const common = git(repo, "rev-parse", "--path-format=absolute", "--git-common-dir");
  const id = createHash("sha1").update(common).digest("hex").slice(0, 8);
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "pr-visuals", `${basename(dirname(common))}-${id}`);
}

function lock() {
  const path = join(cacheDir(), "lock");
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      process.on("exit", () => rmSync(path, { force: true }));
      return;
    } catch {
      const pid = Number(readFileSync(path, "utf8"));
      if (!pid || alive(pid)) stop(`another pr-shots run (pid ${pid || "starting"}) is using ${dirname(path)}; wait for it, or delete ${path} if none is running`);
      rmSync(path, { force: true });
    }
  }
  stop(`couldn't lock ${path}`);
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** A detached worktree for one side, created on first use, moved to `commit` and set up after that */
function prepareWorktree(name, commit) {
  const dir = join(cacheDir(), name);
  const marker = join(cacheDir(), `${name}.setup`);
  if (!existsSync(dir)) {
    console.error(`pr-shots: creating the ${name} worktree at ${dir}`);
    // --force: git refuses a path it still has registered after someone deleted the folder by hand
    git(repo, "worktree", "add", "--force", "--quiet", "--detach", dir, commit);
  } else if (tryGit(dir, "rev-parse", "HEAD") !== commit) {
    if (dirty(dir)) stop(`${dir} has local changes; clean it up first`);
    git(dir, "checkout", "--quiet", "--detach", commit);
  }
  if (settings.setup && !(existsSync(marker) && readFileSync(marker, "utf8") === commit)) {
    console.error(`pr-shots: setting up the ${name} worktree`);
    rmSync(marker, { force: true });
    if (run(settings.setup, dir, join(out, "raw", `setup-${name}.log`)).status !== 0) stop(`${name} setup failed, see ${join(out, "raw", `setup-${name}.log`)}`);
  }
  writeFileSync(marker, commit);
  return dir;
}

function sideEnv(extra = {}) {
  return { ...process.env, TZ: defaults.timezone ?? "UTC", PR_VISUALS_SEED: String(seed), PR_VISUALS_NOW: String(now.getTime()), ...settings.env, ...extra };
}

function run(command, cwd, log) {
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "w");
  try {
    return spawnSync(command, { shell: true, cwd, stdio: ["ignore", fd, fd], env: sideEnv() });
  } finally {
    closeSync(fd);
  }
}

function freePort() {
  return new Promise((done, failed) => {
    const server = createServer().once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

/** Starts the serve command with $PORT and waits until `ready` answers */
async function serve(side) {
  const port = await freePort();
  const log = join(out, "raw", `serve-${side.name}.log`);
  mkdirSync(dirname(log), { recursive: true });
  const fd = openSync(log, "w");
  const child = spawn(settings.serve, { shell: true, cwd: side.dir, stdio: ["ignore", fd, fd], env: sideEnv({ PORT: String(port) }), detached: process.platform !== "win32" });
  closeSync(fd);
  children.add(child);
  let exited = false;
  child.once("exit", () => (exited = true));

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) stop(`the ${side.name} server exited before it was ready, see ${log}`);
    try {
      await fetch(new URL(settings.ready ?? "/", url), { signal: AbortSignal.timeout(2000) });
      return { url, child };
    } catch {
      await new Promise((done) => setTimeout(done, 300));
    }
  }
  kill(child);
  stop(`the ${side.name} server didn't answer ${new URL(settings.ready ?? "/", url)} within ${READY_TIMEOUT_MS / 1000} s, see ${log}`);
}

function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  children.delete(child);
  // The shell's children (the dev server itself) only go down with the whole process group
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
}

function settingsFor(shot, tone) {
  return { ...defaults, ...shot, ...shot[tone === "before" ? "before" : "after"] };
}

async function capture(shot, tone, dir, serverUrl) {
  const s = settingsFor(shot, tone);
  const [path, suffix = ""] = s.path.split(/(?=[?#])/);
  const url = serverUrl ? new URL(s.path, serverUrl).href : `${pathToFileURL(join(dir, path)).href}${suffix}`;
  const context = await browser.newContext({
    viewport: s.viewport ?? { width: 1280, height: 800 },
    deviceScaleFactor: SCALE,
    colorScheme: s.colorScheme ?? "light",
    reducedMotion: "reduce",
    locale: s.locale ?? "en-US",
    timezoneId: s.timezone ?? "UTC",
  });
  context.setDefaultTimeout(15_000);
  try {
    await context.clock.setFixedTime(now);
    await context.addInitScript((start) => {
      let state = start >>> 0;
      Math.random = () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), state | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, seed);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await settle(page, s.wait);
    for (const action of s.prep ?? []) await act(page, action);
    if (s.prep?.length) await settle(page, s.wait);

    const file = join(out, "raw", tone, `${shot.name}.png`);
    mkdirSync(dirname(file), { recursive: true });
    const options = { path: file, animations: "disabled", caret: "hide" };
    if (s.selector) await page.locator(s.selector).first().screenshot(options);
    else await page.screenshot({ ...options, fullPage: Boolean(s.fullPage) });
    return { file };
  } finally {
    await context.close();
  }
}

async function settle(page, wait = 300) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
  });
  await page.waitForTimeout(wait);
}

async function act(page, action) {
  const target = (selector) => page.locator(selector).first();
  if (action.click) await target(action.click).click();
  else if (action.hover) await target(action.hover).hover();
  else if (action.fill) await target(action.fill[0]).fill(action.fill[1]);
  else if (action.press) await page.keyboard.press(action.press);
  else if (action.waitFor) await target(action.waitFor).waitFor();
  else if (action.wait) await page.waitForTimeout(action.wait);
  else throw new Error(`unknown prep action ${JSON.stringify(action)}`);
}

function pngSize(file) {
  const header = readFileSync(file).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function escape(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

/**
 * An image at its native resolution: laid out at its pixel size and scaled by 1/SCALE with a transform,
 * since sizing it to width/SCALE directly lets Chrome round half pixels and stretch odd sizes by one
 */
function exactImage(file) {
  const { width, height } = pngSize(file);
  const src = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
  return `<span class="px-box" style="width:${width / SCALE}px;height:${height / SCALE}px"><img class="px" src="${src}" style="width:${width}px;height:${height}px;transform:scale(${1 / SCALE})"></span>`;
}

async function frame(shot) {
  const raw = (tone) => {
    const saved = sides[tone === "before" ? "base" : "head"]?.captures[shot.name];
    if (saved) return saved;
    const file = join(out, "raw", tone, `${shot.name}.png`);
    return existsSync(file) ? { file } : { error: `no saved ${tone} capture; run without --reframe` };
  };
  const after = raw("after");
  const before = shot.only === "after" ? undefined : raw("before");
  for (const [tone, side] of [["before", before], ["after", after]]) if (side?.error) return { shot, error: `${tone}: ${side.error}` };

  const baseLabel = sides.base?.label ?? savedLabel("Before") ?? "base";
  const panels = before ?
    [{ file: before.file, label: `Before · ${baseLabel}`, tone: "before" }, { file: after.file, label: "After", tone: "after" }] :
    [{ file: after.file }];
  const width = panels.reduce((sum, panel) => sum + pngSize(panel.file).width, 0);
  const layout = shot.layout ?? (panels.length > 1 && width <= ROW_MAX_WIDTH ? "row" : "column");
  const themeNames = Object.keys(THEMES);
  const theme = THEMES[shot.theme] ?? THEMES[themeNames[allShots.indexOf(shot) % themeNames.length]];
  const subtitle = pr ? `#${pr.number}` : sides.head?.label ?? savedLabel("After");

  const body = panels.map((panel) => `<div class="side">${panel.label ? `<span class="label ${panel.tone}">${escape(panel.label)}</span>` : ""}${exactImage(panel.file)}</div>`).join('<div class="divider"></div>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${FRAME_CSS}</style></head><body><div id="root"><div class="frame" style="background:${theme}"><div class="window"><div class="titlebar"><div class="lights"><span></span><span></span><span></span></div><div class="title"><b>${escape(shot.title ?? shot.path)}</b>${subtitle ? `<span class="sep">·</span>${escape(subtitle)}` : ""}</div><div></div></div><div class="body ${layout}">${body}</div></div></div></div></body></html>`;

  const page = await browser.newPage({ viewport: { width: 4000, height: 2000 }, deviceScaleFactor: SCALE });
  try {
    await page.setContent(html, { waitUntil: "load" });
    const size = await page.evaluate(async () => {
      await document.fonts.ready;
      const root = document.querySelector("#root");
      const box = root.getBoundingClientRect();
      const fitted = { width: Math.ceil(box.width), height: Math.ceil(box.height) };
      root.style.width = `${fitted.width}px`;
      root.style.height = `${fitted.height}px`;
      return fitted;
    });
    if (size.width * SCALE > MAX_SCREENSHOT || size.height * SCALE > MAX_SCREENSHOT) {
      return { shot, error: `the frame would be ${size.width * SCALE}x${size.height * SCALE} px, past Chromium's limit; use a selector, a smaller viewport or no fullPage` };
    }
    await page.setViewportSize(size);
    // A screenshot right after the resize can catch the old surface tiled across the image
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const png = join(out, `${shot.name}.png`);
    await page.screenshot({ path: png, omitBackground: true });
    const same = before !== undefined && readFileSync(before.file).equals(readFileSync(after.file));
    return { shot, png, same };
  } finally {
    await page.close();
  }
}

/** The branch an earlier run's README recorded for a side, for --reframe */
function savedLabel(word) {
  const readme = join(out, "README.md");
  if (!existsSync(readme)) return undefined;
  return readFileSync(readme, "utf8").match(new RegExp(`\\b${word}: (\\S+) at`))?.[1];
}

function writeReadme() {
  const state = (side) => (side ? `${side.label} at ${short(side.commit)}${side.dirty ? " plus uncommitted changes" : ""}` : "not captured (after-only shots)");
  const lines = [
    `# ${pr ? `PR #${pr.number}` : folderName} visuals`,
    "",
    `Before: ${state(sides.base)}. After: ${state(sides.head)}.`,
    "",
    `Frozen: clock ${now.toISOString()}, Math.random seed ${seed}, ${defaults.timezone ?? "UTC"}, ${defaults.locale ?? "en-US"}, reduced motion, animations off.`,
    "",
  ];
  for (const shot of allShots) {
    const png = join(out, `${shot.name}.png`);
    if (!existsSync(png)) continue;
    const same = results.find((result) => result.shot === shot)?.same;
    lines.push(`## ${shot.name}`, "", `\`${shot.path}\`${same ? " (looks the same before and after)" : ""}`, "", `![${shot.name}](${shot.name}.png)`, "");
  }
  writeFileSync(join(out, "README.md"), lines.join("\n"));
}
